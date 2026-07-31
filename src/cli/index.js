import { readFile, writeFile, mkdir, rm, mkdtemp, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { normalizeDocName } from '../usecases/workspace.js';
import { FsBlockRepository } from '../adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../adapters/GepaiCurriculum.js';
import { ChromeRenderer } from '../adapters/ChromeRenderer.js';
import { BuildVariants } from '../usecases/BuildVariants.js';
import { ValidateWorksheet } from '../usecases/ValidateWorksheet.js';
import { AssembleWorksheet } from '../usecases/AssembleWorksheet.js';
import { ArchetypeLibrary } from '../usecases/ArchetypeLibrary.js';
import { GenerateWorksheet, parseGradeSubject } from '../usecases/GenerateWorksheet.js';
import { ComposeWorksheet } from '../usecases/ComposeWorksheet.js';
import { RunPipeline } from '../usecases/RunPipeline.js';
import { EditWorksheet } from '../usecases/EditWorksheet.js';
import { RenderPdf, DEFAULT_VIRTUAL_TIME_BUDGET } from '../usecases/RenderPdf.js';
import { RenderImage } from '../usecases/RenderImage.js';
import { resolvePaper, paperToPx } from '../usecases/paper.js';
import { FsWorkspaceRepository } from '../adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../usecases/SaveDocument.js';
import { OpenDocument } from '../usecases/OpenDocument.js';
import { RegeneratePage } from '../usecases/RegeneratePage.js';
import { ExportDocument } from '../usecases/ExportDocument.js';
import { FsWorkbookRepository } from '../adapters/FsWorkbookRepository.js';
import { WorkbookAssemble } from '../usecases/WorkbookAssemble.js';
import { WorkbookExport } from '../usecases/WorkbookExport.js';
import {
  orderedMembers, memberStartPages, resolveWorkbookPaper, buildDocName, upsertMember,
  assertNoRowCollisions, canTransitionStatus, WORKBOOK_STATUSES,
} from '../usecases/workbook.js';
import { parseBatchList } from '../usecases/batchList.js';
import { annotateCanvaPages, canvaHtmlPath } from '../usecases/canvaExport.js';
import { createEditorServer, listenEditorServer } from '../adapters/EditorHttpServer.js';
import { PresetLibrary } from '../usecases/PresetLibrary.js';
import { FsPresetRepository } from '../adapters/FsPresetRepository.js';
import { FsAiBridgeRepository } from '../adapters/FsAiBridgeRepository.js';
import { AI_SCHEMA_VERSION, validateResponse } from '../usecases/aiBridge.js';
import { loadKnownSubjectHexes } from '../usecases/renderAssets.js';

const USAGE = `worksheet-grab — 활동지 제작·편집 도구 (베타)

사용법:
  worksheet-grab build-variants <in.html> --out <dir>
      MODE_TOKEN 을 student/teacher 로 치환한 2벌(<base>-student.html, <base>-teacher.html) 생성.
  worksheet-grab render <in.html> [--out <file.pdf>] [--png <file.png>] [--virtual-time-budget 15000] [--chrome <path>]
      Chrome 헤드리스로 PDF/PNG 렌더(페이지 잘림 방지·웹폰트/KaTeX 로딩 대기). --png 는 첫 A4 미리보기/카드.
  worksheet-grab validate <in.html>
      정답 누출·하드코딩 교과색·최소폰트 정적 검사. 정답 누출 시 종료코드 1.
  worksheet-grab assemble <manifest> --out <file.html>
      블록 라이브러리 + 테마 + 성취기준(CSV)에서 활동지 HTML 재조립.
  worksheet-grab generate <학년교과> <주제> [--out <dir>] [--pdf] [--png] [--standards <코드,..>] [--limit <N>]
      예: generate 중2과학 광합성 — 성취기준을 CSV(MCP 옵션)에서 조회해 교과 템플릿으로
      활동지 + student/teacher 2벌 생성. --pdf 지정 시 A4 PDF, --png 지정 시 미리보기 PNG(첫 페이지) 렌더.
      --standards [9과12-01],[9과12-02] 로 성취기준을 직접 선택, --limit 로 자동 조회 개수 제한(기본 6).
      "중2 과학 광합성" 처럼 학년·교과를 띄어 써도 된다.
      학습목표(저작 영역) — generate/compose 공통:
        --objectives "광합성에 필요한 요소를 말할 수 있다.|광합성 산물을 설명할 수 있다."  (구분자 |)
        --objectives-heading "오늘의 목표"   박스 제목(기본 "학습 목표")
        --show-standards                     근거 성취기준을 교사용에 함께 표기(기본 미표기)
      미지정 시 종전대로 성취기준 문장을 기계 변환해 목표 자리에 쓴다(하위호환).
  worksheet-grab pipeline <학년교과> <주제> [--out <dir>] [--no-render] [--standards <코드,..>] [--limit <N>]
      전체 제작: 성취기준 조회→조립→학생·교사용 생성→검수→(통과 시) 렌더.
      검수에 실패하면 학생용 출력을 중단하고 수정할 항목을 안내한다.
  worksheet-grab compose <학년교과> <주제> [--archetype <id>] [--standards <코드,..>] [--out <dir>] [--render]
      동적 조립: 주제에 맞는 활동 구조를 골라 성취기준·제목을 채운 초안과
      블록별 작성 안내를 만든다. 교육 내용은 AI 또는 교사가 작성해 채운다.
      --archetype 로 활동 구조를 직접 지정할 수 있고, --render 로 자리표시 미리보기를 만든다.
      예: compose 중2과학 광합성 --archetype experimental-inquiry
  worksheet-grab edit <manifest.json> "<지시>" [--out <dir>] [--no-render] [--in-place]
      대화형 편집 루프: 기존 매니페스트에 편집 지시를 반영해 매니페스트·HTML 을 왕복 갱신 후 재렌더.
      기본은 원본 보존(-v2, -v3 … 접미사로 저장). --in-place 지정 시에만 원본을 덮어쓴다.
      예: edit out/science-광합성.manifest.json "3번 문항 빼고 성찰 추가"
      지시 대신 플래그도 가능: --remove <N> (반복 가능) · --add reflection
  worksheet-grab doc <list|open|save|history|restore|regenerate-page|export> …
      문서 워크스페이스(worksheets/<문서명>/ — manifest·학생/교사 HTML·meta·히스토리).
        doc list                            문서 목록(제목·교과·수정 번호·정답 누출 경고)
        doc open <문서명>                   문서 로드·상태 표시(편집은 edit-ui)
        doc save <문서명> --from <manifest.json>   manifest 를 문서로 저장(재렌더·누출검증·스냅샷)
        doc history <문서명>                히스토리 스냅샷 목록
        doc restore <문서명> <일련번호>     스냅샷 복원(비파괴 — 새 리비전으로 저장)
        doc regenerate-page <문서명> <N> --from <page.json>
                                            N(1-based) 페이지만 page.json(블록 배열)로 교체 후 SaveDocument 재저장.
                                            성취기준·저작권 보호 블록은 삭제·변조·위조 시 거부.
                                            타 페이지는 바이트 불변. 번호 불연속은 경고(에러 아님).
        doc export <문서명> [--canva]        저장본 → 학생/교사 PDF 2벌(worksheets/<문서명>/worksheet-*.pdf).
                                            정답 누출 위험이 있으면 학생용을 차단하고 교사용만 산출
                                            --canva 지정 시 worksheet-{student,teacher}-canva.html
                                            부가 산출(Canva 반입용 페이지 주석). 학생용 안전검수는 동일하게 적용
      generate/pipeline/edit 에 --doc <문서명> 을 주면 out/ 대신 워크스페이스 문서로 산출.
      edit 는 경로 대신 --doc <문서명> 으로도 편집 가능. 정답 누출 시 student.html 은
      보류되고 정답 누출 경고가 표시된다(작업은 저장되지만 학생용 내보내기는 차단).
  worksheet-grab workbook <create|add|remove|order|list|show|export|batch-plan|status|mark> …
      자료집(합본) 장부(workbooks/<명>/workbook.json). 멤버 문서(worksheets/)는 참조만
      하고 절대 쓰지 않는다(교차 저장 금지). 신규 --workbooks-dir <경로>(기본 <cwd>/workbooks).
        workbook create <명> [--title <t>] [--paper a4|a3|b4]   자료집 생성(--title 생략 시 <명>)
        workbook add <명> <문서명> [--toc-title <t>]            멤버 등록(존재하지 않는 문서·중복 등록 거부)
        workbook remove <명> <문서명>                           멤버 제거
        workbook order <명> <문서명...>                         전체 멤버를 지정 순서로 재배열(부분 지정 거부)
        workbook list                                          자료집 목록
        workbook show <명>                                     멤버·status·본문상대 시작쪽 요약
        workbook batch-plan <명> --from <list.json|.jsonl|.csv> [--csv]
                                            무API — 콘텐츠는 생성하지 않고 장부만 등록한다(멱등).
                                            JSON·JSONL·CSV 목록을 읽어 각 행을
                                            <자료집명>-NN-<주제> 문서명으로 등록한다.
                                            재실행 시 기존 멤버 status 보존·스킵, 신규만 추가.
        workbook status <명>                                   pending/saved/failed 집계 + 재개 대상(≠saved) 목록
        workbook mark <명> <문서명> <saved|failed>              제작 결과를 자료집 장부에 기록
        workbook export <명> [--out <dir>] [--workspaces-dir <dir>] [--portable]
                                            합본을 조립하고 실제 쪽수를 확인한 뒤 PDF 2벌을 만든다. 기본 출력:
                                            workbooks/<명>/workbook-{student,teacher}.pdf.
                                            정답 누출 위험 문서가 있으면 학생용 미산출+문서명 안내
                                            +종료코드 1(teacher 는 항상 산출). --portable 은 멤버
                                            자산을 렌더용 임시 디렉터리에 복사해 상대경로로 참조.
  worksheet-grab edit-ui <문서명> [--port <n>] [--workspaces-dir <dir>]
      브라우저 에디터: 문서를 내 컴퓨터의 로컬 서버로 띄워 편집한다.
      인쇄정밀 캔버스(실제 paper.css·용지 치수) + 여백선/넘침 배지 + 학생/교사 토글(물리 2벌)
      + 공통 툴바(폰트·크기·B/I/U·색·정렬·목록·표·이미지·↶↷) + ⭐정답 표시·✏️답란 삽입
      + 라이브 검수 바. 저장(Ctrl+S)은 manifest 역동기화 → SaveDocument(누출 게이트·히스토리).
      정답 마크 해제로 인한 누출은 세션 태깅·confirm·저장 시 마크 소멸 감지로 3중 방어.
  worksheet-grab preset <list|delete|restore> …
      사용자 프리셋(재사용 블록) 자산 관리. 저장은 에디터(edit-ui)의 "내 블록으로 저장".
        preset list [--json]     라이브러리 목록(기본 제공 + 내 블록, 워크스페이스 공유)
        preset delete <id>       내 블록 삭제 / 기본 제공은 숨김(비파괴)
        preset restore <id>      숨긴 기본 제공 복원
      저장 위치: <워크스페이스>/.presets/presets.json (쓰기 시 .bak 백업·원자 교체).
  worksheet-grab ai <pending|respond|list|clear> …
      AI 요청 연결: 에디터의 "AI 재작성/예시 채우기" 요청을 현재 사용 중인 AI
      (이 CLI 를 모는 Claude/Codex 세션)가 파일 큐로 주고받는다.
        ai pending [--json] [--watch] [--once]   대기 요청 조회/감시(1s 폴링)
        ai respond <id> --ops <file.json>|--objects <file.json>|--blocks <file.json>|--from <file>|--html <…>
                                                  재작성 결과 회신(취소된 요청은 거부).
                                                  --ops 는 [{op:'replace'|'insert'|'delete'|'insert-section',…}] JSON.
                                                  insert-section 은 여러 개체를 한 번에 순서대로 생성한다.
                                                  --objects 는 [{id,object}] JSON
                                                  --fragment <file.json> [--after <id>|--before <id>] 는 id 없는
                                                   새 구역 개체 배열이다. 좌표·조판·답안은 허용하지 않으며
                                                   에디터가 구조와 안전 규칙을 검사한 뒤 삽입한다.
        ai list [--all] · ai clear [<id>]        상태 조회·terminal 정리
      큐 위치: <워크스페이스>/.ai-bridge/. 성취기준·저작권 지문 블록은 대상에서 제외.
  worksheet-grab list-blocks
      블록 타입 exemplar 파일 목록(core/*, pack-*/*). 재사용 부품·폴백·few-shot 시드.
  worksheet-grab list-vocab [--subject <교과>] [--json]
      블록 타입 어휘 + 계약(blocks/vocabulary.json): 타입별 코어/교과팩·허용 교과·슬롯.
      --subject science 로 해당 교과에서 쓸 수 있는 타입만(코어 + 그 교과팩) 필터.
  worksheet-grab list-archetypes [--subject <교과>] [--json]
      아키타입(교과 초월 구조 패턴, blocks/archetypes.json): 어느 타입을 어떤 순서로.
      --subject science 로 해당 교과에 바인딩된 구체 블록 시퀀스까지 표시.
  worksheet-grab list-themes

공통 옵션:
  --csv <경로>     성취기준 CSV 위치(기본: data/achievement-standards.csv 번들). GEPAI_CSV 환경변수로도 지정 가능.
  --chrome <경로>  Chrome 실행 파일(render 계열). CHROME_PATH 환경변수로도 지정 가능.
  --workspaces-dir <경로>  문서 워크스페이스 루트(doc/--doc). 기본 <현재 디렉토리>/worksheets.
`;

/** 인자 파서: 위치 인자 + --flag value / --flag=value / --bool. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); }
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[a.slice(2)] = argv[++i]; }
      else { flags[a.slice(2)] = true; }
    } else positionals.push(a);
  }
  return { positionals, flags };
}

/**
 * generate/pipeline 위치 인자 해석. "중2과학 광합성"(2개) 외에
 * "중2 과학 광합성"(3개, 학년·교과 띄어쓰기)도 재조합해 허용한다.
 */
function gradeTopicArgs(positionals) {
  const [, a, b, c] = positionals;
  // 다단어 주제("광합성 작용")는 남은 위치 인자를 모두 주제로 흡수한다 —
  // 조용히 잘라내면 exit 0 으로 오생성을 성공처럼 보이게 한다(fail-open 방지).
  if (c && /^[초중고]\s*\d*$/.test(String(a || '').trim())) {
    return { gradeSubject: `${a}${b}`, topic: positionals.slice(3).join(' ') };
  }
  return { gradeSubject: a, topic: positionals.slice(2).join(' ') || undefined };
}

/** --standards "[9과12-01],[9과12-02]" → 코드 배열(없으면 null). */
function parseStandardsFlag(flags) {
  if (typeof flags.standards !== 'string' || !flags.standards.trim()) return null;
  return flags.standards.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * `--objectives "문장1|문장2"` — 학습목표(저작 문장). 구분자가 쉼표가 아니라 `|` 인 이유는
 * 목표 문장에 쉼표가 흔히 들어가기 때문이다(`--standards` 는 코드 목록이라 쉼표로 충분하다).
 * 미지정이면 빈 배열 → 엔진이 종전대로 성취기준 문장을 기계 변환해 목표 자리에 쓴다(하위호환).
 */
function parseObjectivesFlag(flags) {
  if (typeof flags.objectives !== 'string' || !flags.objectives.trim()) return [];
  return flags.objectives.split('|').map((s) => s.trim()).filter(Boolean);
}

/** --limit N (기본 6). */
function parseLimitFlag(flags, fallback = 6) {
  const n = Number(flags.limit);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** --workspaces-dir 플래그(기본 <cwd>/worksheets)로 워크스페이스 리포지토리 구성. */
function wsRepoFromFlags(flags) {
  return new FsWorkspaceRepository({
    baseDir: typeof flags['workspaces-dir'] === 'string' ? flags['workspaces-dir'] : null,
  });
}

/** --workbooks-dir 플래그(기본 <cwd>/workbooks)로 자료집 장부 리포지토리 구성. */
function wbRepoFromFlags(flags) {
  return new FsWorkbookRepository({
    baseDir: typeof flags['workbooks-dir'] === 'string' ? flags['workbooks-dir'] : null,
  });
}

/** 자료집 용지 요약 1줄(workbook.paper 는 문자열('a4')|객체 — resolveWorkbookPaper 로 정규화). */
function workbookPaperLine(paper) {
  const p = resolveWorkbookPaper(paper);
  return `${p.size} ${p.orientation === 'landscape' ? '가로' : '세로'} · 여백 ${p.margins}${p.columns > 1 ? ` · ${p.columns}단` : ''}`;
}

/** 자료집이 없으면 명확한 오류(존재 확인 후 로드) — OpenDocument 스타일. */
async function readWorkbookOrThrow(wb, name) {
  if (!wb.exists(name)) {
    throw new Error(`자료집이 없습니다: ${name}. "workbook list" 로 확인하거나 "workbook create ${name}" 로 새로 만드세요.`);
  }
  return wb.readWorkbook(name);
}

/**
 * 워크스페이스 저장의 단일 CLI 배선점 — generate/pipeline/edit 의 --doc 와
 * doc save/restore 가 전부 여기를 거친다. 반드시 SaveDocument.execute 를 경유한다
 * (writeVariantTrio 재사용 금지 — 정답 누출 게이트가 우회되면 안 된다).
 * @param {{isNew?:boolean}} opts isNew: 생성 경로(--doc)의 동일 문서명 충돌 방지.
 */
async function emitToWorkspace(manifest, docName, flags, repo, { log }, { isNew = false } = {}) {
  const ws = wsRepoFromFlags(flags);
  if (isNew && ws.docExists(docName)) {
    const meta = await ws.readMeta(docName);
    if (meta) {
      throw new Error(`문서 "${docName}" 가 이미 있습니다. "doc open ${docName}" 으로 열어 편집하거나 다른 이름을 쓰세요.`);
    }
    throw new Error(`문서 "${docName}" 디렉토리가 있으나 meta 가 없습니다(미완성/부분쓰기 의심). 디렉토리를 정리하거나 다른 이름을 쓰세요.`);
  }
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const saver = new SaveDocument({ workspace: ws, blockRepository: repo, curriculum });
  const result = await saver.execute({ name: docName, manifest });
  log(`  워크스페이스 → ${result.paths.dir} (rev ${result.meta.revision})`);
  log(`  ${result.paths.manifestPath}`);
  log(`  ${result.paths.teacherPath}`);
  if (result.unsafe) {
    log('  ⚠ 정답 누출 감지 → 학생용 HTML 저장과 내보내기를 보류합니다. 콘텐츠를 수정한 뒤 다시 저장하세요.');
    for (const f of result.leakFindings) log(`     ✗ [${f.rule}] ${f.message} (근거: ${f.evidence})`);
  } else {
    log(`  ${result.paths.studentPath}`);
  }
  return result;
}

/** 산출물 용지 추적 로그 1줄(관측성): size/orientation/margins. */
function paperLine(paper) {
  const p = resolvePaper(paper);
  return `${p.size} ${p.orientation === 'landscape' ? '가로' : '세로'} · 여백 ${p.margins}`;
}

/** 안전한 출력 파일명 베이스(subject-topic, 비허용 문자는 _). */
function worksheetBase(subject, topic) {
  return `${subject}-${topic}`.replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

/** 조립 HTML + student/teacher 2벌을 out 디렉토리에 쓰고 경로를 반환. */
async function writeVariantTrio(outDir, base, { html, student, teacher }) {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });
  const htmlPath = join(dir, `${base}.html`);
  const sPath = join(dir, `${base}-student.html`);
  const tPath = join(dir, `${base}-teacher.html`);
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(sPath, student, 'utf8');
  await writeFile(tPath, teacher, 'utf8');
  return { htmlPath, sPath, tPath };
}

/** 편집본 저장 베이스: 기존 -vN 접미사는 스템으로 환원하고, 비어 있는 다음 버전을 찾는다. */
function nextVersionBase(dir, base) {
  const m = /^(.*)-v(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  let n = m ? Number(m[2]) + 1 : 2;
  while (existsSync(join(dir, `${stem}-v${n}.manifest.json`))) n++;
  return `${stem}-v${n}`;
}

/** 재편집 가능한 매니페스트(inline html 블록 + 성취기준 원문 포함)를 out 에 저장하고 경로 반환. */
async function writeManifest(outDir, base, manifest) {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });
  const mPath = join(dir, `${base}.manifest.json`);
  await writeFile(mPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return mPath;
}

/**
 * student/teacher 2벌을 Chrome 으로 렌더(PDF·옵션 PNG)하고 산출 경로를 반환.
 * 로깅은 호출부가 담당(명령별 문구 차이 보존).
 * @returns {Promise<Array<{mode:string, pdf?:string, png?:string}>>}
 */
async function renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf = true, png = false, paper = null } = {}) {
  const renderer = new ChromeRenderer({ chromePath: flags.chrome || null });
  const rp = pdf ? new RenderPdf({ renderer }) : null;
  const ri = png ? new RenderImage({ renderer }) : null;
  const vtb = flags['virtual-time-budget'] ? Number(flags['virtual-time-budget']) : DEFAULT_VIRTUAL_TIME_BUDGET;
  // PNG 뷰포트: manifest.paper 가 있으면 용지 픽셀 치수로(PDF 는 @page CSS 가 지배하므로 무관).
  const px = paper ? paperToPx(resolvePaper(paper)) : null;
  const dir = resolve(outDir);
  const results = [];
  for (const [mode, inPath] of [['student', sPath], ['teacher', tPath]]) {
    const entry = { mode };
    if (rp) {
      entry.pdf = join(dir, `${base}-${mode}.pdf`);
      await rp.execute({ inputPath: inPath, outputPath: entry.pdf, virtualTimeBudget: vtb });
    }
    if (ri) {
      entry.png = join(dir, `${base}-${mode}.png`);
      await ri.execute({
        inputPath: inPath, outputPath: entry.png, virtualTimeBudget: vtb,
        ...(px ? { width: px.width, height: px.height } : {}),
      });
    }
    results.push(entry);
  }
  return results;
}

// 값 필수 플래그: 값 없이 오면(--out) parseArgs 가 true 를 남겨 하류에서 경로로
// 쓰이며 원인 불명 타입 오류가 된다 — 진입점에서 fail-fast 로 막는다.
const VALUE_FLAGS = ['out', 'csv', 'chrome', 'workspaces-dir', 'from', 'standards',
  'limit', 'port', 'archetype', 'virtual-time-budget', 'doc', 'html', 'remove', 'add',
  'title', 'paper', 'toc-title', 'workbooks-dir', 'blocks', 'objects'];

export async function run(argv, { root, log = console.log, err = console.error, onServer = null, renderer = null } = {}) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  for (const name of VALUE_FLAGS) {
    // --csv 는 다른 명령에선 값 필수(CurriculumProvider CSV 경로)지만, workbook batch-plan
    // 에서만 값 없는 불리언(형식 힌트: CSV 강제)으로 쓰인다 — 이 명령에 한해 예외.
    if (name === 'csv' && command === 'workbook') continue;
    if (flags[name] === true) { err(`오류: --${name} 플래그에 값이 필요합니다. (예: --${name} <값>)`); return 2; }
  }
  const repo = new FsBlockRepository({ root });

  switch (command) {
    case 'build-variants': return cmdBuildVariants(positionals[1], flags, { log });
    case 'render': return cmdRender(positionals[1], flags, { log });
    case 'validate': return cmdValidate(positionals[1], repo, { log, err });
    case 'assemble': return cmdAssemble(positionals[1], flags, repo, { log });
    case 'generate': {
      const { gradeSubject, topic } = gradeTopicArgs(positionals);
      return cmdGenerate(gradeSubject, topic, flags, repo, { log });
    }
    case 'pipeline': {
      const { gradeSubject, topic } = gradeTopicArgs(positionals);
      return cmdPipeline(gradeSubject, topic, flags, repo, { log, err });
    }
    case 'compose': {
      const { gradeSubject, topic } = gradeTopicArgs(positionals);
      return cmdCompose(gradeSubject, topic, flags, repo, { log, err });
    }
    case 'edit': return cmdEdit(positionals[1], positionals[2], flags, repo, { log, err });
    case 'doc': return cmdDoc(positionals.slice(1), flags, repo, { log, err });
    case 'workbook': return cmdWorkbook(positionals.slice(1), flags, repo, { log, err, renderer });
    case 'edit-ui': return cmdEditUi(positionals[1], flags, repo, { root, log, onServer });
    case 'preset': return cmdPreset(positionals.slice(1), flags, repo, { log, err });
    case 'ai': return cmdAi(positionals.slice(1), flags, { log, err });
    case 'list-blocks': return cmdListBlocks(repo, { log });
    case 'list-vocab': return cmdListVocab(flags, repo, { log, err });
    case 'list-archetypes': return cmdListArchetypes(flags, repo, { log, err });
    case 'list-themes': return cmdListThemes(repo, { log });
    case 'help': case undefined: log(USAGE); return 0;
    default: err(`알 수 없는 명령: ${command}\n\n${USAGE}`); return 2;
  }
}

async function cmdBuildVariants(input, flags, { log }) {
  if (!input) throw new Error('build-variants: 입력 HTML 경로가 필요합니다.');
  const outDir = flags.out || 'out';
  const html = await readFile(resolve(input), 'utf8');
  const { student, teacher } = new BuildVariants().execute(html);
  await mkdir(resolve(outDir), { recursive: true });
  const base = basename(input).replace(/\.html?$/i, '');
  const sPath = join(resolve(outDir), `${base}-student.html`);
  const tPath = join(resolve(outDir), `${base}-teacher.html`);
  await writeFile(sPath, student, 'utf8');
  await writeFile(tPath, teacher, 'utf8');
  log(`✔ build-variants → ${sPath}`);
  log(`✔ build-variants → ${tPath}`);
  return 0;
}

async function cmdRender(input, flags, { log }) {
  if (!input) throw new Error('render: 입력 HTML 경로가 필요합니다.');
  if (!flags.out && !flags.png) throw new Error('render: --out <file.pdf> 또는 --png <file.png> 가 필요합니다.');
  const vtb = flags['virtual-time-budget'] ? Number(flags['virtual-time-budget']) : DEFAULT_VIRTUAL_TIME_BUDGET;
  const renderer = new ChromeRenderer({ chromePath: flags.chrome || null });
  if (flags.out) {
    const { outputPath } = await new RenderPdf({ renderer })
      .execute({ inputPath: input, outputPath: flags.out, virtualTimeBudget: vtb });
    log(`✔ render(pdf) → ${outputPath} (virtual-time-budget=${vtb})`);
  }
  if (flags.png) {
    const pngOut = flags.png === true ? input.replace(/\.html?$/i, '.png') : flags.png;
    const { outputPath } = await new RenderImage({ renderer })
      .execute({ inputPath: input, outputPath: pngOut, virtualTimeBudget: vtb });
    log(`✔ render(png) → ${outputPath} (첫 페이지 미리보기)`);
  }
  return 0;
}

async function cmdValidate(input, repo, { log, err }) {
  if (!input) throw new Error('validate: 입력 HTML 경로가 필요합니다.');
  const html = await readFile(resolve(input), 'utf8');
  const knownSubjectHexes = await loadKnownSubjectHexes(repo);
  const { ok, findings } = new ValidateWorksheet({ knownSubjectHexes }).execute(html);
  if (findings.length === 0) {
    log('✔ validate: 문제 없음(정답 누출·하드코딩색·최소폰트 모두 통과).');
    return 0;
  }
  for (const f of findings) {
    const tag = f.severity === 'error' ? '✗ FAIL' : '⚠ WARN';
    (f.severity === 'error' ? err : log)(`${tag} [${f.rule}] ${f.message} (근거: ${f.evidence})`);
  }
  return ok ? 0 : 1;
}

async function cmdAssemble(manifestName, flags, repo, { log }) {
  if (!manifestName) throw new Error('assemble: 매니페스트 이름/경로가 필요합니다.');
  if (!flags.out) throw new Error('assemble: --out <file.html> 가 필요합니다.');
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
  const manifest = await repo.readManifest(manifestName);
  const { html, worksheet } = await asm.execute(manifest);
  await mkdir(resolve(flags.out, '..'), { recursive: true });
  await writeFile(resolve(flags.out), html, 'utf8');
  log(`✔ assemble → ${resolve(flags.out)} (${worksheet.pageCount()}쪽, 성취기준 ${worksheet.standards.map((s) => s.bracketedCode()).join(', ')})`);
  return 0;
}

async function cmdGenerate(gradeSubject, topic, flags, repo, { log }) {
  if (!gradeSubject || !topic) throw new Error('generate: <학년교과> <주제> 가 필요합니다. 예: generate 중2과학 광합성');
  const outDir = flags.out || 'out';
  const { grade, subject } = parseGradeSubject(gradeSubject);
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum });
  const { html, worksheet, standards, manifest } =
    await gen.execute({
      grade, subject, topic, limit: parseLimitFlag(flags), codes: parseStandardsFlag(flags),
      objectives: parseObjectivesFlag(flags),
      objectivesHeading: typeof flags['objectives-heading'] === 'string' ? flags['objectives-heading'] : null,
      showStandards: flags['show-standards'] === true,
    });

  log(`✔ generate: ${grade} ${subject} "${topic}" (${worksheet.pageCount()}쪽, 성취기준 ${standards.map((s) => s.code).join(', ')})`);
  if (manifest.paper) log(`  용지: ${paperLine(manifest.paper)}`);

  // --doc: 워크스페이스 문서로 산출(단일 SaveDocument 경유). out/ 납작 경로는 건드리지 않는다.
  if (typeof flags.doc === 'string') {
    const result = await emitToWorkspace(manifest, flags.doc, flags, repo, { log }, { isNew: true });
    if (flags.pdf || flags.png) log('  (워크스페이스 문서의 PDF/PNG export 는 후속(E6) — HTML 2벌까지 산출)');
    return result.unsafe ? 1 : 0;
  }

  const { student, teacher } = new BuildVariants().execute(html);
  const base = worksheetBase(worksheet.subject, topic);
  const { htmlPath, sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, manifest);
  log(`  ${htmlPath}`);
  log(`  ${sPath}`);
  log(`  ${tPath}`);
  log(`  ${mPath} (재편집용 매니페스트 — edit 명령 입력)`);

  if (flags.pdf || flags.png) {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags,
      { pdf: !!flags.pdf, png: !!flags.png, paper: manifest.paper });
    for (const e of rendered) {
      if (e.pdf) log(`  ✔ render(pdf) → ${e.pdf}`);
      if (e.png) log(`  ✔ render(png) → ${e.png} (첫 페이지 미리보기)`);
    }
  }
  return 0;
}

async function cmdPipeline(gradeSubject, topic, flags, repo, { log, err }) {
  if (!gradeSubject || !topic) throw new Error('pipeline: <학년교과> <주제> 가 필요합니다. 예: pipeline 중2과학 광합성');
  const outDir = flags.out || 'out';
  const { grade, subject } = parseGradeSubject(gradeSubject);
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const { html, student, teacher, worksheet, standards, review, gate, manifest } =
    await new RunPipeline({ blockRepository: repo, curriculum })
      .execute({ grade, subject, topic, limit: parseLimitFlag(flags), codes: parseStandardsFlag(flags) });

  log(`▶ 파이프라인: ${grade} ${subject} "${topic}"`);
  log(`  1) 성취기준 조회: ${standards.map((s) => s.code).join(', ')}`);
  log(`  2) 조립 + 2벌 분기: ${worksheet.pageCount()}쪽 (student/teacher)`);
  if (manifest.paper) log(`     용지: ${paperLine(manifest.paper)}`);

  const useDoc = typeof flags.doc === 'string';
  // base 는 렌더 분기(아래 renderVariantFiles)에서도 쓰므로 함수 스코프여야 한다 —
  // if 블록 안 선언 시 기본 렌더 경로가 ReferenceError 로 전멸한다(QA 발견).
  const base = worksheetBase(worksheet.subject, topic);

  // 3) 검수 게이트 — 디스크 쓰기보다 먼저. FAIL 이면 어떤 산출물도 남기지 않는다
  //    (fail-closed): 학생 HTML 을 먼저 써 두면 누출분이 디스크에 잔존하는 벡터가 된다.
  const findings = [...review.student.findings, ...review.teacher.findings];
  const errors = findings.filter((f) => f.severity === 'error');
  log(`  3) 검수 게이트: ${gate ? 'PASS' : 'FAIL'} (error ${errors.length}건, warning ${findings.length - errors.length}건)`);
  for (const f of findings) {
    const tag = f.severity === 'error' ? '✗' : '⚠';
    log(`       ${tag} [${f.rule}] ${f.message} (근거: ${f.evidence})`);
  }

  if (!gate) {
    err('  ✗ 안전검수 실패(정답 누출 등) → 산출물을 만들지 않았습니다. 콘텐츠를 수정한 뒤 다시 실행하세요.');
    return 1;
  }

  // --doc: 게이트 통과분을 워크스페이스 문서로 저장(단일 SaveDocument 경유). 렌더는 E6.
  if (useDoc) {
    const result = await emitToWorkspace(manifest, flags.doc, flags, repo, { log }, { isNew: true });
    log('  4) 렌더: 저장한 문서를 교사가 검토한 뒤 PDF로 내보내고 인쇄하세요.');
    return result.unsafe ? 1 : 0;
  }

  // 게이트 통과 후에만 out/ 에 2벌 + 매니페스트를 기록한다.
  const { sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, manifest);
  log(`     매니페스트: ${mPath} (재편집용 — edit 명령 입력)`);

  // 4) 렌더 (게이트 통과 시)
  if (flags['no-render']) {
    log('  4) 렌더 생략(--no-render). 교사가 검토한 뒤 render 명령으로 인쇄 파일을 만드세요.');
  } else {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: true, paper: manifest.paper });
    for (const e of rendered) log(`  4) 렌더 → ${e.pdf}`);
  }
  log('  ✔ 산출물을 교사가 검토한 뒤 인쇄·배포하세요(성취기준·정답 표시·저작권 지문 확인).');
  return 0;
}

async function cmdCompose(gradeSubject, topic, flags, repo, { log, err }) {
  if (!gradeSubject || !topic) throw new Error('compose: <학년교과> <주제> 가 필요합니다. 예: compose 중2과학 광합성');
  const outDir = flags.out || 'out';
  const { grade, subject } = parseGradeSubject(gradeSubject);
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const compose = new ComposeWorksheet({ blockRepository: repo, curriculum });
  const { manifest, brief, archetype, archetypeReason, standards } = await compose.execute({
    grade, subject, topic,
    archetype: typeof flags.archetype === 'string' ? flags.archetype : null,
    codes: parseStandardsFlag(flags),
    limit: parseLimitFlag(flags),
    objectives: parseObjectivesFlag(flags),
    objectivesHeading: typeof flags['objectives-heading'] === 'string' ? flags['objectives-heading'] : null,
    showStandards: flags['show-standards'] === true,
  });

  const base = worksheetBase(manifest.subject, topic) + '.scaffold';
  const mPath = await writeManifest(outDir, base, manifest);

  log(`▶ compose: ${grade} ${subject} "${topic}"`);
  log(`  1) 성취기준: ${standards.map((s) => s.code).join(', ')}`);
  log(`  2) 아키타입: ${archetype} · ${brief.name} (${archetypeReason})`);
  log(`  3) 초안 구조: ${mPath} (${manifest.pages.length}쪽 · 내용 작성 대기)`);
  // 학습목표는 인라인 html 이 아니라 매니페스트 필드라 브리프만 보면 놓치기 쉽다 — 상태를 명시한다.
  if (Array.isArray(manifest.objectives) && manifest.objectives.length > 0) {
    log(`     학습목표(저작됨, ${manifest.objectives.length}개): ${manifest.objectives.join(' / ')}`);
  } else {
    log('     학습목표: 미저작 — 성취기준 문장을 그대로 목표 자리에 씁니다.');
    log('       직접 저작: --objectives "…할 수 있다.|…할 수 있다." (매니페스트 objectives 필드를 고쳐도 됩니다)');
  }
  log('  4) 작성 안내 — AI 또는 교사가 각 블록의 내용을 주제에 맞게 작성:');
  brief.pages.forEach((pg, i) => {
    log(`     · p${i + 1}`);
    for (const b of pg) {
      const tag = b.packRole ? `${b.type}*` : b.type;
      log(`        [${b.role}] ${tag} — ${b.authoring}`);
    }
  });
  log('  ── 초안 내용을 작성한 뒤 pipeline 또는 assemble 명령으로 렌더하세요.');
  log('     안전검사가 정답 누출과 미기입 항목을 점검합니다. 성취기준 원문과 저작권 지문은 그대로 두세요.');

  if (flags.render) {
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
    const { html } = await asm.execute(manifest);
    const { student, teacher } = new BuildVariants().execute(html);
    const { sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
    log(`  5) 초안 미리보기(자리표시): ${sPath} / ${tPath}`);
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: false, png: true });
    for (const e of rendered) if (e.png) log(`     ✔ render(png) → ${e.png}`);
  }
  return 0;
}

async function cmdEdit(manifestPath, instruction, flags, repo, { log }) {
  const outDir = flags.out || 'out';
  const ws = wsRepoFromFlags(flags);
  let docName = typeof flags.doc === 'string' ? flags.doc : null;
  // 문서명 해석: `edit --doc <name> "<지시>"` — 경로 자리에 온 지시문을 재배치.
  if (docName && manifestPath && instruction === undefined && !/\.json$/i.test(manifestPath)) {
    instruction = manifestPath;
    manifestPath = null;
  }
  let manifest;
  if (manifestPath) {
    manifest = await repo.readManifest(manifestPath);
    // 입력이 워크스페이스 문서(worksheets/<name>/worksheet.manifest.json)면 컨텍스트 자동 추론.
    const abs = resolve(manifestPath);
    if (abs.startsWith(ws.baseDir + sep) && basename(abs) === 'worksheet.manifest.json') {
      const inferred = basename(dirname(abs));
      if (docName && normalizeDocName(docName) !== inferred) {
        throw new Error(`--doc "${docName}" 가 입력 문서("${inferred}")와 다릅니다. 의도치 않은 교차 저장을 막기 위해 중단합니다.`);
      }
      docName = inferred;
    }
  } else if (docName) {
    if (!ws.docExists(docName)) throw new Error(`문서가 없습니다: ${docName}. "doc list" 로 문서 목록을 확인하세요.`);
    manifest = await ws.readManifest(docName);
  } else {
    throw new Error('edit: <manifest.json> 경로 또는 --doc <문서명> 이 필요합니다.');
  }

  // 편집 오퍼레이션: 자연어 지시("3번 문항 빼고 성찰 추가") 또는 --remove/--add 플래그.
  let ops;
  if (instruction) {
    ops = EditWorksheet.parseInstruction(instruction);
  } else {
    ops = [];
    if (flags.remove != null && flags.remove !== true) {
      for (const tok of String(flags.remove).split(',')) {
        const n = Number(tok.trim());
        if (Number.isInteger(n)) ops.push({ op: 'removeItem', n });
      }
    }
    if (flags.add) ops.push({ op: 'addSection', kind: flags.add === true ? 'reflection' : String(flags.add) });
    if (ops.length === 0) throw new Error('edit: 편집 지시("…") 또는 --remove <N> / --add reflection 플래그가 필요합니다.');
  }

  const { manifest: edited, applied } = new EditWorksheet().execute(manifest, ops);

  // 워크스페이스 컨텍스트: SaveDocument 경유 저장(히스토리 스냅샷 = 무료 undo, -vN 불필요).
  if (docName) {
    log(`✔ edit(doc): ${docName}`);
    for (const a of applied) log(`  · ${a}`);
    const result = await emitToWorkspace(edited, docName, flags, repo, { log });
    log('  ✔ 편집 결과를 교사가 검토한 뒤 PDF로 내보내 인쇄·배포하세요.');
    return result.unsafe ? 1 : 0;
  }

  // 편집된 매니페스트로 재조립 + 2벌 분기(왕복).
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
  const { html, worksheet } = await asm.execute(edited);
  const { student, teacher } = new BuildVariants().execute(html);

  // 원본 보존이 기본: 입력 매니페스트와 같은 베이스로 덮어쓰지 않고 -vN 접미사를 붙인다.
  // 잘못된 편집을 되돌릴 수 없는 인쇄물 특성상 --in-place 는 명시 옵트인.
  const inputBase = /\.manifest\.json$/i.test(manifestPath)
    ? basename(manifestPath).replace(/\.manifest\.json$/i, '')
    : worksheetBase(edited.subject, edited.docTitle || 'worksheet');
  const base = flags['in-place'] ? inputBase : nextVersionBase(resolve(outDir), inputBase);
  const { sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, edited);

  log(`✔ edit: ${manifestPath}`);
  for (const a of applied) log(`  · ${a}`);
  if (!flags['in-place']) log(`  원본 보존 → 편집본은 "${base}.*" 로 저장(덮어쓰려면 --in-place).`);
  log(`  ${worksheet.pageCount()}쪽 재조립 → ${mPath}`);
  log(`  ${sPath}`);
  log(`  ${tPath}`);

  if (flags['no-render']) {
    log('  렌더 생략(--no-render). 교사가 검토한 뒤 render 명령으로 인쇄 파일을 만드세요.');
  } else {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: true, paper: edited.paper });
    for (const e of rendered) log(`  ✔ render → ${e.pdf}`);
  }
  log('  ✔ 편집 결과를 교사가 검토한 뒤 인쇄·배포하세요.');
  return 0;
}

/**
 * E2 에디터 셸: 문서를 로컬 서버(127.0.0.1)로 띄운다(읽기 전용 — 편집은 E3).
 * onServer 는 테스트 시임: 기동된 서버·주소를 넘겨 인프로세스 close 를 가능하게 한다.
 */
async function cmdEditUi(name, flags, repo, { root, log, onServer }) {
  if (!name) throw new Error('edit-ui: <문서명> 이 필요합니다. 예: edit-ui 광합성탐구');
  const ws = wsRepoFromFlags(flags);
  const opened = await new OpenDocument({ workspace: ws }).execute({ name });
  const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
  const server = createEditorServer({
    root, docName: opened.name, workspace: ws, blockRepository: repo, curriculum,
    testSeed: flags['test-seed'] === true, // 렌더 테스트 전용 시드 훅 게이트
    chromePath: typeof flags.chrome === 'string' ? flags.chrome : null, // E6 export·정밀 미리보기
  });
  const addr = await listenEditorServer(server, { port: flags.port ? Number(flags.port) : 0 });
  log(`✔ edit-ui: ${opened.name} — http://127.0.0.1:${addr.port}/ (브라우저 에디터 · Ctrl+C 종료)`);
  for (const w of opened.warnings) log(`  ⚠ ${w}`);
  process.once('SIGINT', () => server.close(() => process.exit(0)));
  if (onServer) onServer(server, addr);
  return 0;
}

/**
 * E5 AI 브리지 — 구독 AI(이 CLI 를 모는 Claude/Codex 세션)가 에디터의 AI 요청을
 * 읽고 응답하는 표면. 무API(§3.5): 여기에 LLM 호출은 없다 — 파일 큐 왕복뿐.
 */
async function cmdAi(args, flags, { log, err }) {
  const [sub, id] = args;
  const ws = wsRepoFromFlags(flags);
  const bridge = new FsAiBridgeRepository({ baseDir: ws.baseDir });
  // v1(단일 block)·v2(blocks[])·v3(objects[], US-19)·v4(objects[] + 페이지 컨텍스트, Phase 4) 양형을
  // 무크래시로 렌더한다(r.block 직접 접근 금지).
  const printRequest = (r) => {
    if (flags.json) { log(JSON.stringify(r, null, 2)); return; }
    if (Array.isArray(r.objects)) {
      const summary = r.objects.map((o) => `${o.type}(${o.id})`).join(', ');
      // v4 는 어느 페이지의 어떤 상태를 근거로 한 요청인지도 싣는다 — 구독 AI 가 "페이지 전체"
      // 요청임을 알아야 개수를 바꾸는 계획(ops)을 세울 수 있다.
      const pageInfo = r.scope === 'page' ? ` · 범위: 페이지 전체(${r.pageId || '?'})` : '';
      log(`  ${r.id} — ${r.docName} · ${r.action} · ${r.objects.length}개체 [${summary}]${pageInfo}${r.instruction ? ` · 지시: ${r.instruction}` : ''}`);
      return;
    }
    const blocks = r.blocks ?? (r.block ? [r.block] : []);
    const summary = blocks.map((b) => `${b.bt || 'content'}(${(b.html ?? '').length}자)`).join(', ');
    log(`  ${r.id} — ${r.docName} · ${r.action} · ${blocks.length}블록 [${summary}]${r.instruction ? ` · 지시: ${r.instruction}` : ''}`);
  };
  switch (sub) {
    case 'pending': {
      const initial = await bridge.listPending();
      if (initial.length === 0 && !flags.watch) { log('대기 중인 AI 요청 없음.'); return 0; }
      for (const r of initial) printRequest(r);
      if (!flags.watch) return 0;
      // --watch: 새 요청 도착을 폴링 감시(Windows fs.watch 불신뢰 → 1s 폴링 루프).
      log(`● AI 브리지 감시 중 (${ws.baseDir}) — Ctrl+C 종료${flags.once ? ' · 첫 새 요청 후 종료' : ''}`);
      const seen = new Set(initial.map((r) => r.id));
      if (flags.once && initial.length > 0) return 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const fresh = (await bridge.listPending()).filter((r) => !seen.has(r.id));
        for (const r of fresh) { seen.add(r.id); printRequest(r); }
        if (flags.once && fresh.length > 0) return 0;
      }
    }
    case 'respond': {
      if (!id) throw new Error('ai respond: <id> 가 필요합니다.');
      const status = await bridge.getStatus(id);
      if (!status) throw new Error(`요청을 찾을 수 없습니다: ${id}`);
      if (status === 'cancelled') { err(`✗ 취소된 요청입니다(terminal): ${id} — 응답할 수 없습니다.`); return 1; }
      if (status !== 'pending') { err(`✗ ${status} 상태 요청입니다: ${id} — pending 만 응답 가능합니다.`); return 1; }
      // 입력형별 리터럴 태깅: --from/--html → v1(단일 html), --blocks → v2(blocks[{slot,html}]),
      // --objects → v3(objects[{id,object}], US-19 개체 ID 에코), --ops → v4(ops[{op,…}], Phase 4
      // 개수·종류가 자유로운 계획). AI_SCHEMA_VERSION 상수는 **현행 신규 쓰기(v4)** 에만 쓴다 —
      // v1/v2/v3 는 디스크에 남은 in-flight 요청·기존 입력형의 고정 형태라 리터럴로 유지한다
      // (상수 승격이 과거 회신을 오태깅하는 것 방지).
      let response;
      if (typeof flags.ops === 'string') {
        const parsed = JSON.parse(await readFile(resolve(flags.ops), 'utf8'));
        const ops = Array.isArray(parsed) ? parsed : parsed?.ops;
        if (!Array.isArray(ops) || ops.length === 0) {
          throw new Error('ai respond --ops: [{op,…}] 배열(또는 {ops:[…]}) JSON 파일이 필요합니다.');
        }
        response = { schemaVersion: AI_SCHEMA_VERSION, id, ops };
        if (!validateResponse(response)) {
          throw new Error("ai respond --ops: 응답 형태가 v4 스키마와 맞지 않습니다 — replace={op,id,object}, insert={op,object,afterId|beforeId}, delete={op,id}, insert-section={op,objects:[…],afterId|beforeId}(여러 개체 한 번에). insert·insert-section 에 afterId 와 beforeId 를 동시에 줄 수 없습니다.");
        }
      } else if (typeof flags.fragment === 'string') {
        // B′ 프래그먼트 저작(ADR-bspike-ai-fragment.md): id 없는 scaffold 개체 배열을 그대로 싣는다.
        // 좌표·조판·답안·미허용 HTML 의 결정 검증은 **에디터 적용 시** validateAiFragment 가 수행하고,
        // 여기(전송 계층)서는 봉투 형태(비어있지 않은 {type,…} 배열 + anchor 동시금지)만 본다.
        const parsed = JSON.parse(await readFile(resolve(flags.fragment), 'utf8'));
        const fragment = Array.isArray(parsed) ? parsed : parsed?.fragment;
        if (!Array.isArray(fragment) || fragment.length === 0) {
          throw new Error('ai respond --fragment: [{type,…}] scaffold 개체 배열(또는 {fragment:[…]}) JSON 파일이 필요합니다.');
        }
        const anchor = {};
        if (typeof flags.after === 'string' && flags.after) anchor.afterId = flags.after;
        if (typeof flags.before === 'string' && flags.before) anchor.beforeId = flags.before;
        response = { schemaVersion: AI_SCHEMA_VERSION, id, fragment, ...anchor };
        if (!validateResponse(response)) {
          throw new Error('ai respond --fragment: 봉투 형태가 맞지 않습니다 — fragment 는 비어있지 않은 {type,…} 배열이어야 하고 --after/--before 를 동시에 줄 수 없습니다. (개체 결정 검증은 에디터 적용 시 validateAiFragment 소관)');
        }
      } else if (typeof flags.objects === 'string') {
        const parsed = JSON.parse(await readFile(resolve(flags.objects), 'utf8'));
        const objects = Array.isArray(parsed) ? parsed : parsed?.objects;
        if (!Array.isArray(objects) || objects.length === 0) {
          throw new Error('ai respond --objects: [{id,object}] 배열(또는 {objects:[…]}) JSON 파일이 필요합니다.');
        }
        // v3 고정 형태(objects[] = 개체 ID 에코)라 리터럴 3 으로 태깅한다 — AI_SCHEMA_VERSION 은
        // Phase 4 에서 4(ops[]) 로 승격됐고, 신규 쓰기 상수를 이 v3 shape 에 쓰면 형태-버전
        // 불일치로 validateResponse 가 거부한다(위 v1/v2 리터럴 유지와 동일 근거).
        response = { schemaVersion: 3, id, objects };
        if (!validateResponse(response)) {
          throw new Error('ai respond --objects: 응답 형태가 v3 스키마([{id,object:{id,type,…}}])와 맞지 않습니다.');
        }
      } else if (typeof flags.blocks === 'string') {
        const parsed = JSON.parse(await readFile(resolve(flags.blocks), 'utf8'));
        const blocks = Array.isArray(parsed) ? parsed : parsed?.blocks;
        if (!Array.isArray(blocks) || blocks.length === 0) {
          throw new Error('ai respond --blocks: [{slot,html}] 배열(또는 {blocks:[…]}) JSON 파일이 필요합니다.');
        }
        response = { schemaVersion: 2, id, blocks: blocks.map((b) => ({ slot: b.slot, html: b.html })) };
      } else if (typeof flags.from === 'string') {
        response = { schemaVersion: 1, id, html: await readFile(resolve(flags.from), 'utf8') };
      } else if (typeof flags.html === 'string') {
        response = { schemaVersion: 1, id, html: flags.html };
      } else if (typeof flags.unsupported === 'string') {
        // 열화 반려(M5): AI 가 "이 지시는 ops 어휘로 표현할 수 없다"를 명시 반려한다 — 무응답(에디터 5분
        // 타임아웃) 대신 reason 을 즉시 돌려보낸다. reason 은 그대로 사용자에게 표시된다.
        response = { schemaVersion: AI_SCHEMA_VERSION, id, unsupported: true, reason: flags.unsupported };
        if (!validateResponse(response)) {
          throw new Error('ai respond --unsupported "<사유>": 비어 있지 않은 사유 문자열이 필요합니다.');
        }
      } else {
        throw new Error('ai respond: --from <file> / --html <inline> / --blocks <file.json> / --objects <file.json> / --ops <file.json> / --fragment <file.json> / --unsupported "<사유>" 중 하나가 필요합니다.');
      }
      await bridge.putResponse(response);
      // 양형 방어(v1~v4·반려): 없는 필드에 직접 접근하면 다른 형태 회신에서 크래시한다.
      const detail = response.unsupported ? `반려("${response.reason}")`
        : response.fragment ? `새 구역 ${response.fragment.length}개체`
          : response.ops ? `${response.ops.length}계획(${response.ops.map((o) => o.op).join('·')})`
            : response.objects ? `${response.objects.length}개체`
              : response.blocks ? `${response.blocks.length}블록`
                : `${(response.html ?? '').length}자`;
      log(`✔ 응답 기록: ${id} (${detail}) — 에디터가 폴링으로 수신합니다.`);
      return 0;
    }
    case 'list': {
      const all = await bridge.listAll();
      const items = flags.all ? all : all.filter((r) => r.status === 'pending' || r.status === 'answered');
      log(`AI 요청 ${items.length}건${flags.all ? '(전체)' : '(활성)'}:`);
      for (const r of items) {
        if (Array.isArray(r.objects)) {
          log(`  [${r.status}] ${r.id} — ${r.docName} · ${r.action} · ${r.objects.length}개체 [${r.objects.map((o) => o.type).join(', ')}]`);
          continue;
        }
        const blocks = r.blocks ?? (r.block ? [r.block] : []);
        log(`  [${r.status}] ${r.id} — ${r.docName} · ${r.action} · ${blocks.length}블록 [${blocks.map((b) => b.bt || 'content').join(', ')}]`);
      }
      return 0;
    }
    case 'clear': {
      const removed = id ? await bridge.prune({ ids: [id] }) : await bridge.prune();
      log(`✔ 브리지 정리: ${removed.length}건 (${removed.join(', ') || '없음'})`);
      return 0;
    }
    default:
      err(`ai: 알 수 없는 서브명령 "${sub ?? ''}". 지원: pending [--json|--watch|--once] · respond <id> --ops|--objects|--blocks|--from|--html · list [--all] · clear [<id>]`);
      return 2;
  }
}

/** E4 프리셋 자산 관리(생성은 에디터 전용 — 선택 컨텍스트 필요). */
async function cmdPreset(args, flags, repo, { log, err }) {
  const [sub, id] = args;
  const ws = wsRepoFromFlags(flags);
  const lib = new PresetLibrary({
    presetRepository: new FsPresetRepository({ baseDir: ws.baseDir }),
    blockRepository: repo,
  });
  switch (sub) {
    case 'list': {
      const { presets, skipped, warning } = await lib.list();
      if (flags.json) { log(JSON.stringify({ presets, skipped, warning }, null, 2)); return 0; }
      log(`프리셋 ${presets.length}개 (${ws.baseDir}${sep}.presets):`);
      for (const p of presets) log(`  ${p.id} — ${p.name} · ${p.type} · ${p.source === 'builtin' ? '기본 제공' : '내 블록'}`);
      if (skipped.length) log(`  ⚠ 빌트인 스킵(exemplar 부재): ${skipped.join(', ')}`);
      if (warning) log(`  ⚠ ${warning}`);
      return 0;
    }
    case 'delete': {
      if (!id) throw new Error('preset delete: <id> 가 필요합니다.');
      const r = await lib.delete(id);
      log(r.action === 'hidden'
        ? `✔ 기본 제공 프리셋 숨김: ${id} ("preset restore ${id}" 로 복원)`
        : `✔ 프리셋 삭제: ${id}`);
      return 0;
    }
    case 'restore': {
      if (!id) throw new Error('preset restore: <id> 가 필요합니다.');
      await lib.restore(id);
      log(`✔ 기본 제공 프리셋 복원: ${id}`);
      return 0;
    }
    default:
      err(`preset: 알 수 없는 서브명령 "${sub ?? ''}". 지원: list [--json] · delete <id> · restore <id>`);
      return 2;
  }
}

async function cmdDoc(args, flags, repo, { log, err }) {
  const [sub, name, extra] = args;
  const ws = wsRepoFromFlags(flags);
  switch (sub) {
    case 'list': {
      const docs = await ws.listDocuments();
      if (docs.length === 0) { log(`문서 없음 (${ws.baseDir})`); return 0; }
      log(`문서 ${docs.length}개 (${ws.baseDir}):`);
      for (const d of docs) {
        if (d.meta) {
          const unsafeTag = d.meta.unsafe ? ' · ⚠ 정답 누출 위험(학생용 보류)' : '';
          log(`  ${d.name} — ${d.meta.title} · ${d.meta.subject} · rev ${d.meta.revision} · ${d.meta.updatedAt}${unsafeTag}`);
        } else {
          log(`  ${d.name} — (meta 없음 · 미완성/외부 생성 의심)`);
        }
      }
      return 0;
    }
    case 'open': {
      if (!name) throw new Error('doc open: <문서명> 이 필요합니다.');
      const r = await new OpenDocument({ workspace: ws }).execute({ name });
      log(`✔ doc open: ${r.name} (로드·상태 표시 — 편집은 "edit-ui ${r.name}")`);
      log(`  경로: ${r.paths.dir}`);
      if (r.meta) {
        log(`  제목: ${r.meta.title} · 교과: ${r.meta.subject} · rev ${r.meta.revision} · 수정 ${r.meta.updatedAt}`);
        log(`  성취기준: ${(r.meta.standards || []).join(', ') || '없음'} · 용지: ${r.meta.paper ? paperLine(r.meta.paper) : 'A4 기본'}`);
      }
      log(`  히스토리: 스냅샷 ${r.history.length}개 (doc history ${r.name})`);
      for (const w of r.warnings) log(`  ⚠ ${w}`);
      return 0;
    }
    case 'save': {
      if (!name) throw new Error('doc save: <문서명> 이 필요합니다.');
      if (typeof flags.from !== 'string') throw new Error('doc save: --from <manifest.json> 이 필요합니다.');
      const manifest = JSON.parse(await readFile(resolve(flags.from), 'utf8'));
      const result = await emitToWorkspace(manifest, name, flags, repo, { log });
      log(`✔ doc save: ${result.name} → rev ${result.meta.revision}`);
      return result.unsafe ? 1 : 0;
    }
    case 'history': {
      if (!name) throw new Error('doc history: <문서명> 이 필요합니다.');
      if (!ws.docExists(name)) throw new Error(`문서가 없습니다: ${name}`);
      const snaps = await ws.listSnapshots(name);
      log(`히스토리 ${snaps.length}개 (${name}):`);
      for (const s of snaps) log(`  ${s}`);
      return 0;
    }
    case 'restore': {
      if (!name || !extra) throw new Error('doc restore: <문서명> <일련번호> 가 필요합니다. 예: doc restore 광합성탐구 0001');
      const snapshot = await ws.readSnapshot(name, extra);
      const result = await emitToWorkspace(snapshot, name, flags, repo, { log });
      log(`✔ doc restore: ${result.name} ← 스냅샷 ${extra} (새 rev ${result.meta.revision} — 비파괴, 복원도 히스토리에 남습니다)`);
      return result.unsafe ? 1 : 0;
    }
    case 'regenerate-page': {
      // Phase 1 §2(d): pages[N-1] 만 교체 → SaveDocument 재저장(aiBridge 대칭 가드, C7·C9).
      if (!name) throw new Error('doc regenerate-page: <문서명> 이 필요합니다.');
      if (!extra) throw new Error('doc regenerate-page: <N>(1-based 페이지 번호) 이 필요합니다.');
      const pageNum = Number(extra);
      if (!Number.isInteger(pageNum)) throw new Error(`doc regenerate-page: 페이지 번호는 정수여야 합니다: "${extra}"`);
      if (typeof flags.from !== 'string') throw new Error('doc regenerate-page: --from <page.json> 이 필요합니다.');
      const newPageBlocks = JSON.parse(await readFile(resolve(flags.from), 'utf8'));
      const curriculum = new GepaiCurriculum({ csvPath: typeof flags.csv === 'string' ? flags.csv : null });
      const result = await new RegeneratePage({ workspace: ws, blockRepository: repo, curriculum })
        .execute({ docName: name, page: pageNum, newPageBlocks });
      log(`✔ doc regenerate-page: ${result.name} 페이지 ${pageNum} 재생성 → rev ${result.meta.revision}`);
      if (result.continuityWarning) log(`  ⚠ ${result.continuityWarning}`);
      if (result.unsafe) {
        log('  ⚠ 정답 누출 감지 → 학생용 HTML 저장과 내보내기를 보류합니다.');
        for (const f of result.leakFindings) log(`     ✗ [${f.rule}] ${f.message} (근거: ${f.evidence})`);
      }
      return result.unsafe ? 1 : 0;
    }
    case 'export': {
      // E6: 저장본 → PDF 2벌(에디터 POST /export 와 동일 코어 = ExportDocument 단일 경유).
      // meta.unsafe 는 fail-closed — student 차단·teacher 산출·비영 종료.
      if (!name) throw new Error('doc export: <문서명> 이 필요합니다. 예: doc export 광합성탐구');
      const renderer = new ChromeRenderer({ chromePath: typeof flags.chrome === 'string' ? flags.chrome : null });
      const exporter = new ExportDocument({ workspace: ws, renderer, fileExists: existsSync, removeFile: rm });
      const result = await exporter.execute({ name });
      for (const r of result.rendered) log(`✔ ${r.variant} PDF: ${r.path}`);
      if (result.skipped.student) log(`⚠ 학생용 건너뜀(${result.skipped.student}): ${result.reason}`);
      // --canva: Canva 반입용 HTML(-canva.html) 부가 산출. student 는 ExportDocument 의
      // fail-closed(unsafe/부재) 판정과 대칭으로 미생성 + 스테일 -canva.html 물리 제거.
      // 미지정 시 이 블록은 실행되지 않아 doc export 기존 산출은 완전 불변.
      if (flags.canva) {
        const layout = ws.layout(name);
        const manifest = await ws.readManifest(name);
        const docTitle = manifest.docTitle || '';

        const teacherHtml = await readFile(layout.teacherPath, 'utf8');
        const teacherCanvaPath = canvaHtmlPath(layout.teacherPath);
        await writeFile(teacherCanvaPath, annotateCanvaPages(teacherHtml, { docTitle }), 'utf8');
        const canvaPaths = [teacherCanvaPath];

        const studentCanvaPath = canvaHtmlPath(layout.studentPath);
        if (!result.unsafe && existsSync(layout.studentPath)) {
          const studentHtml = await readFile(layout.studentPath, 'utf8');
          await writeFile(studentCanvaPath, annotateCanvaPages(studentHtml, { docTitle }), 'utf8');
          canvaPaths.push(studentCanvaPath);
        } else if (existsSync(studentCanvaPath)) {
          await rm(studentCanvaPath);
          log('⚠ Canva 학생용 건너뜀(정답 누출 방지) — 스테일 -canva.html 제거');
        }

        log(`✔ Canva HTML: ${canvaPaths.join(', ')} — 공개 HTTPS URL로 호스팅 후 Canva 연동(import-design-from-url)으로 임포트. 공개 URL이 없으면 PDF를 Canva UI에 직접 업로드하세요.`);
      }
      return result.skipped.student ? 1 : 0;
    }
    default:
      err(`doc: 알 수 없는 서브명령 "${sub ?? ''}". 지원: list · open · save · history · restore · regenerate-page · export`);
      return 2;
  }
}

/**
 * workbook <sub> — 자료집(합본) 장부 관리 + 내보내기(합의 계획 §4 Phase 2). workbooks/<명>/
 * workbook.json 만 쓴다 — 멤버 문서(worksheets/)는 wsRepoFromFlags 로 읽기 전용 참조만
 * 한다(교차 저장 금지, cmdDoc 정신). 콘텐츠 저작은 하지 않는다(무API — doc save/generate 소관).
 */
async function cmdWorkbook(args, flags, repo, { log, err, renderer: injectedRenderer = null }) {
  const [sub, name, arg2, arg3] = args;
  const wb = wbRepoFromFlags(flags);
  switch (sub) {
    case 'create': {
      if (!name) throw new Error('workbook create: <명> 이 필요합니다.');
      if (wb.exists(name)) {
        throw new Error(`자료집 "${name}" 가 이미 있습니다. "workbook show ${name}" 으로 확인하세요.`);
      }
      const title = typeof flags.title === 'string' ? flags.title : name;
      const workbook = { title, members: [] };
      if (typeof flags.paper === 'string') workbook.paper = flags.paper;
      const created = await wb.create(name, workbook);
      log(`✔ workbook create: ${created.name} → ${created.workbookPath}`);
      log(`  제목: ${title} · 용지: ${workbookPaperLine(workbook.paper)}`);
      return 0;
    }
    case 'add': {
      if (!name || !arg2) throw new Error('workbook add: <자료집명> <문서명> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const wsRepo = wsRepoFromFlags(flags);
      if (!wsRepo.docExists(arg2)) {
        throw new Error(`문서가 없습니다: ${arg2}. "doc list" 로 문서 목록을 확인하세요.`);
      }
      const docName = normalizeDocName(arg2);
      if (workbook.members.some((m) => m.docName === docName)) {
        throw new Error(`자료집 "${name}" 에 이미 등록된 문서입니다: ${docName}. ("workbook remove" 후 재등록하세요.)`);
      }
      const order = workbook.members.reduce((mx, m) => Math.max(mx, m.order), -1) + 1;
      const member = { docName, order };
      if (typeof flags['toc-title'] === 'string') member.tocTitle = flags['toc-title'];
      await wb.writeWorkbook(name, { ...workbook, members: [...workbook.members, member] });
      log(`✔ workbook add: ${docName} → ${name}(order ${order})`);
      return 0;
    }
    case 'remove': {
      if (!name || !arg2) throw new Error('workbook remove: <자료집명> <문서명> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const docName = normalizeDocName(arg2);
      if (!workbook.members.some((m) => m.docName === docName)) {
        throw new Error(`자료집 "${name}" 에 등록되지 않은 문서입니다: ${docName}.`);
      }
      await wb.writeWorkbook(name, { ...workbook, members: workbook.members.filter((m) => m.docName !== docName) });
      log(`✔ workbook remove: ${docName} ← ${name}`);
      return 0;
    }
    case 'order': {
      if (!name) throw new Error('workbook order: <자료집명> <문서명...> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const wanted = args.slice(2).map((d) => normalizeDocName(d));
      const existing = workbook.members.map((m) => m.docName);
      const wantedSet = new Set(wanted);
      const valid = wanted.length > 0 && wanted.length === existing.length
        && wantedSet.size === wanted.length && existing.every((d) => wantedSet.has(d));
      if (!valid) {
        throw new Error(
          `workbook order: 자료집의 전체 멤버를 중복 없이 모두 지정해야 합니다 `
          + `(현재 멤버: ${existing.join(', ') || '없음'} / 입력: ${wanted.join(', ') || '없음'}).`,
        );
      }
      const orderOf = new Map(wanted.map((d, i) => [d, i]));
      await wb.writeWorkbook(name, {
        ...workbook,
        members: workbook.members.map((m) => ({ ...m, order: orderOf.get(m.docName) })),
      });
      log(`✔ workbook order: ${name} → ${wanted.join(' → ')}`);
      return 0;
    }
    case 'list': {
      const items = await wb.list();
      if (items.length === 0) { log(`자료집 없음 (${wb.baseDir})`); return 0; }
      log(`자료집 ${items.length}개 (${wb.baseDir}):`);
      for (const it of items) {
        if (it.workbook) {
          log(`  ${it.name} — ${it.workbook.title} · 멤버 ${it.workbook.members.length}개 · 용지 ${workbookPaperLine(it.workbook.paper)}`);
        } else {
          log(`  ${it.name} — (workbook.json 없음/파손)`);
        }
      }
      return 0;
    }
    case 'show': {
      if (!name) throw new Error('workbook show: <자료집명> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const layout = wb.layout(name);
      const wsRepo = wsRepoFromFlags(flags);
      const ordered = orderedMembers(workbook);
      const sectionCounts = [];
      for (const m of ordered) {
        if (wsRepo.docExists(m.docName)) {
          const manifest = await wsRepo.readManifest(m.docName);
          sectionCounts.push(Array.isArray(manifest.pages) ? manifest.pages.length : 0);
        } else {
          sectionCounts.push(0);
        }
      }
      const starts = memberStartPages(sectionCounts);
      log(`✔ workbook show: ${layout.name}`);
      log(`  경로: ${layout.dir}`);
      log(`  제목: ${workbook.title} · 용지: ${workbookPaperLine(workbook.paper)} · 멤버 ${ordered.length}개`);
      ordered.forEach((m, i) => {
        const tag = wsRepo.docExists(m.docName) ? '' : ' ⚠ 문서 없음';
        const tocTitle = m.tocTitle ? ` "${m.tocTitle}"` : '';
        log(`  [${i + 1}] ${m.docName}${tocTitle} — order ${m.order} · status ${m.status} · 본문상대 시작쪽 ${starts[i]}${tag}`);
      });
      return 0;
    }
    case 'batch-plan': {
      // 무API(§4 Phase 3): 배치는 콘텐츠를 저작하는 CLI 명령이 아니라 멱등 장부 등록만
      // 한다 — 실제 저작은 하네스가 pending 멤버를 순회하며 기존 파이프라인(compose→
      // 디자이너 저작→--doc 저장=SaveDocument 게이트)으로 수행하고 workbook mark 로 기록한다.
      if (!name) throw new Error('workbook batch-plan: <자료집명> 이 필요합니다.');
      if (typeof flags.from !== 'string') throw new Error('workbook batch-plan: --from <list.json|.jsonl|.csv> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const text = await readFile(resolve(flags.from), 'utf8');
      const rows = parseBatchList(text, flags.csv ? 'csv' : 'auto');
      if (rows.length === 0) throw new Error('workbook batch-plan: 등록할 행이 없습니다.');

      // 결정적 docName(<자료집명>-NN-<주제슬러그>, NN=행의 1-based 파일 내 순번) — 재실행 시
      // 동일 목록이면 항상 동일 docName 을 산출해 upsertMember 의 멱등 스킵을 가능하게 한다.
      const incoming = rows.map((r) => ({
        docName: buildDocName(name, r.row, r.topic),
        __row: r.row,
        tocTitle: r.title || undefined,
        tocStandards: r.standardCode ? [r.standardCode] : undefined,
        status: 'pending',
      }));
      assertNoRowCollisions(incoming); // 행-충돌(서로 다른 행이 같은 docName) fail-closed 방어선.

      let members = workbook.members;
      let added = 0;
      let skipped = 0;
      for (const inc of incoming) {
        const res = upsertMember(members, inc);
        members = res.members;
        if (res.added) added++; else skipped++;
      }
      await wb.writeWorkbook(name, { ...workbook, members });
      log(`✔ workbook batch-plan: ${name} ← ${rows.length}행 (신규 ${added}개 · 스킵(기존 status 보존) ${skipped}개)`);
      return 0;
    }
    case 'status': {
      if (!name) throw new Error('workbook status: <자료집명> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const counts = { pending: 0, saved: 0, failed: 0 };
      for (const m of workbook.members) counts[m.status] = (counts[m.status] ?? 0) + 1;
      log(`✔ workbook status: ${name} — 전체 ${workbook.members.length}개(pending ${counts.pending} · saved ${counts.saved} · failed ${counts.failed})`);
      const resumeTargets = orderedMembers(workbook).filter((m) => m.status !== 'saved');
      if (resumeTargets.length === 0) {
        log('  재개 대상 없음(전부 saved).');
      } else {
        log(`  재개 대상(status≠saved) ${resumeTargets.length}개:`);
        for (const m of resumeTargets) log(`    ${m.docName} — status ${m.status}`);
      }
      return 0;
    }
    case 'mark': {
      // 하네스 저작 루프가 결과를 장부에 기록하는 유일한 전이 경로(계획의 "status 전이" 실행부).
      if (!name || !arg2 || !arg3) throw new Error('workbook mark: <자료집명> <문서명> <saved|failed> 가 필요합니다.');
      if (arg3 !== 'saved' && arg3 !== 'failed') {
        throw new Error(`workbook mark: 상태는 saved|failed 여야 합니다: "${arg3}"`);
      }
      const workbook = await readWorkbookOrThrow(wb, name);
      const docName = normalizeDocName(arg2);
      const member = workbook.members.find((m) => m.docName === docName);
      if (!member) throw new Error(`자료집 "${name}" 에 등록되지 않은 문서입니다: ${docName}. "workbook batch-plan" 또는 "workbook add" 로 먼저 등록하세요.`);
      if (!canTransitionStatus(member.status, arg3)) {
        throw new Error(`workbook mark: "${member.status}" → "${arg3}" 전이는 허용되지 않습니다(허용 상태: ${WORKBOOK_STATUSES.join(', ')}; saved 는 terminal).`);
      }
      const members = workbook.members.map((m) => (m.docName === docName ? { ...m, status: arg3 } : m));
      await wb.writeWorkbook(name, { ...workbook, members });
      log(`✔ workbook mark: ${docName} → ${arg3}(자료집 ${name})`);
      return 0;
    }
    case 'export': {
      // 슬라이스 하이브리드 합본(§2(a)): WorkbookAssemble 로 저장본 섹션을 슬라이스·재조립
      // 하고, WorkbookExport 로 PDF 2벌을 렌더(C4 countPdfPages fail-closed 게이트).
      if (!name) throw new Error('workbook export: <자료집명> 이 필요합니다.');
      const workbook = await readWorkbookOrThrow(wb, name);
      const wsRepo = wsRepoFromFlags(flags);
      const outDir = typeof flags.out === 'string' ? resolve(flags.out) : wb.layout(name).dir;
      await mkdir(outDir, { recursive: true });
      const outputs = {
        teacherPdfPath: join(outDir, 'workbook-teacher.pdf'),
        studentPdfPath: join(outDir, 'workbook-student.pdf'),
      };
      const portable = !!flags.portable;
      // renderer 주입점(테스트 전용 — run({renderer}) 로 목 Chrome 대체): 미주입 시 실 ChromeRenderer.
      const renderer = injectedRenderer || new ChromeRenderer({ chromePath: typeof flags.chrome === 'string' ? flags.chrome : null });

      // 렌더 임시 디렉터리: 임시 HTML(+ --portable 시 자산 복사본)을 여기 모아 상대경로
      // "assets/<slug>/…" 가 렌더 시점 file:// 기준과 일치하게 하고, 종료 시 반드시 정리한다
      // (디스크 소진 방지 — 렌더 성공/실패 무관 finally).
      const tmpDir = await mkdtemp(join(tmpdir(), 'wsg-workbook-'));
      try {
        const assembler = new WorkbookAssemble({
          workspace: wsRepo,
          blockRepository: repo,
          readTextFile: (p) => readFile(p, 'utf8'),
          fileExists: existsSync,
          copyDir: portable ? async (from, to) => { await mkdir(dirname(to), { recursive: true }); await cp(from, to, { recursive: true }); } : null,
        });
        log(`▶ workbook export: ${workbook.title}(멤버 ${workbook.members.length}개) 수집 중…`);
        const assembled = await assembler.execute({
          workbook,
          portable,
          portableAssetsDir: portable ? join(tmpDir, 'assets') : null,
          onProgress: (ev) => {
            if (ev.phase === 'collect') log(`  [${ev.index}/${ev.total}] 수집: ${ev.docName}`);
          },
        });
        if (assembled.unsafeMembers.length > 0) {
          log(`  ⚠ 정답 누출 멤버(학생용 합본 전체 차단): ${assembled.unsafeMembers.join(', ')}`);
        }

        const renderPdf = async ({ html, outputPath, budget, label }) => {
          const htmlPath = join(tmpDir, `${label}.html`);
          await writeFile(htmlPath, html, 'utf8');
          const pdfPath = outputPath || join(tmpDir, `${label}.pdf`);
          await renderer.renderToPdf(htmlPath, pdfPath, { virtualTimeBudget: budget.virtualTimeBudget, timeoutMs: budget.timeoutMs });
          return pdfPath;
        };
        const exporter = new WorkbookExport({
          renderPdf,
          onProgress: (ev) => {
            if (ev.phase === 'render') {
              log(`  렌더 중(${ev.variant}): 예상 ${ev.totalPages}쪽(표지목차 ${ev.coverToc}+본문 ${ev.sigma}) · 예산 vtb=${ev.budget.virtualTimeBudget}ms`);
            }
            if (ev.phase === 'done') log(`  ✔ ${ev.variant} 렌더 완료: ${ev.pages}쪽`);
          },
        });
        const result = await exporter.execute({ assembled, outputs });
        for (const r of result.rendered) {
          log(`✔ ${r.variant} PDF: ${outputs[`${r.variant}PdfPath`]} (${r.pages}쪽)`);
        }
        if (assembled.unsafeMembers.length > 0) {
          log(`⚠ 학생용 미산출(정답 누출 멤버: ${assembled.unsafeMembers.join(', ')}) — 해당 문서를 재저장(doc save/edit)해 누출을 해소한 뒤 재시도하세요.`);
        }
        return assembled.unsafeMembers.length > 0 ? 1 : 0;
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
    default:
      err(`workbook: 알 수 없는 서브명령 "${sub ?? ''}". 지원: create · add · remove · order · list · show · batch-plan · status · mark · export`);
      return 2;
  }
}

async function cmdListBlocks(repo, { log }) {
  const blocks = await repo.listBlocks();
  log(`블록 ${blocks.length}개:`);
  for (const b of blocks) log(`  ${b}`);
  return 0;
}

async function cmdListVocab(flags, repo, { log, err }) {
  const vocab = await repo.readVocabulary();
  if (!vocab || !vocab.types) {
    err('list-vocab: blocks/vocabulary.json 을 찾지 못했습니다.');
    return 1;
  }
  const subject = typeof flags.subject === 'string' ? flags.subject.trim() : null;
  const entries = Object.entries(vocab.types).filter(([, t]) => {
    if (!subject) return true;
    // 코어(모든 교과) + 지정 교과의 교과팩만.
    return t.subjects.includes('*') || t.subjects.includes(subject);
  });

  if (flags.json) {
    log(JSON.stringify(subject ? Object.fromEntries(entries) : vocab, null, 2));
    return 0;
  }

  const core = entries.filter(([, t]) => t.category === 'core');
  const pack = entries.filter(([, t]) => t.category === 'pack');
  const title = subject ? `블록 어휘 — ${subject}에서 사용 가능` : '블록 어휘(vocabulary.json)';
  log(`${title}: 코어 ${core.length} · 교과팩 ${pack.length} (전체 등록 ${vocab.counts?.total ?? Object.keys(vocab.types).length})`);
  const fmt = ([type, t]) => {
    const tags = [];
    if (t.gen) tags.push('gen');
    if (t.keepTogether) tags.push('keep');
    if (t.requiresKatex) tags.push('katex');
    if (t.copyrightSlot) tags.push('저작권슬롯');
    const slots = t.slots && t.slots.length ? ` {${t.slots.join(',')}}` : '';
    const tagStr = tags.length ? ` [${tags.join(',')}]` : '';
    return `  ${type.padEnd(18)} ${t.desc}${slots}${tagStr}`;
  };
  log('■ 코어(≥2교과, var(--*)만):');
  for (const e of core) log(fmt(e));
  log(`■ 교과팩(${subject || '전체'} 전용):`);
  for (const e of pack) log(`  [${(e[1].subjects.join('/'))}] ${fmt(e).trimStart()}`);
  return 0;
}

async function cmdListArchetypes(flags, repo, { log, err }) {
  const [archetypes, vocabulary] = await Promise.all([repo.readArchetypes(), repo.readVocabulary()]);
  if (!archetypes || !archetypes.archetypes) {
    err('list-archetypes: blocks/archetypes.json 을 찾지 못했습니다.');
    return 1;
  }
  const lib = new ArchetypeLibrary({ archetypes, vocabulary });
  const subject = typeof flags.subject === 'string' ? flags.subject.trim() : null;

  if (flags.json) {
    if (subject) {
      const out = lib.list()
        .filter((a) => lib.subjectsFor(a.id).includes(subject))
        .map((a) => lib.resolve(a.id, subject));
      log(JSON.stringify(out, null, 2));
    } else {
      log(JSON.stringify(archetypes, null, 2));
    }
    return 0;
  }

  const items = lib.list();
  log(`아키타입 ${items.length}개 (교과 초월 구조 패턴)${subject ? ` — ${subject} 바인딩` : ''}:`);
  for (const a of items) {
    const applies = lib.subjectsFor(a.id).includes(subject);
    if (subject && !applies) continue;
    const subjTag = a.subjects.includes('*') ? '전교과' : a.subjects.join('/');
    log(`\n■ ${a.id} · ${a.name} [${subjTag}] — ${a.pages}쪽/${a.blocks}블록`);
    log(`  ${a.desc}`);
    if (subject) {
      const r = lib.resolve(a.id, subject);
      r.pages.forEach((pg, i) => {
        const seq = pg.map((b) => (b.packRole ? `${b.type}*` : b.type)).join(' → ');
        log(`  p${i + 1}: ${seq}`);
      });
      log('  (* = packRole 바인딩, 교과별로 달라지는 자리)');
    }
  }
  return 0;
}

async function cmdListThemes(repo, { log }) {
  const themes = await repo.listThemes();
  log(`테마 ${themes.length}개:`);
  for (const t of themes) {
    log(`  ${t.name}: ${['--c', '--c2', '--clite', '--cstrip', '--clabel', '--cink'].map((k) => `${k}=${t.tokens[k]}`).join(' ')}`);
  }
  return 0;
}
