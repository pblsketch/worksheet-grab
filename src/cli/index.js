import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
import { createEditorServer, listenEditorServer } from '../adapters/EditorHttpServer.js';

const USAGE = `worksheet-grab — 활동지 코어 엔진 (M1)

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
  worksheet-grab pipeline <학년교과> <주제> [--out <dir>] [--no-render] [--standards <코드,..>] [--limit <N>]
      종단 파이프라인: 조회→조립→2벌→검수 게이트→(통과 시) 렌더. 검수 실패 시 렌더 중단(fail-closed).
      HITL: 산출 후 교사 검토를 거쳐 인쇄하도록 안내.
  worksheet-grab compose <학년교과> <주제> [--archetype <id>] [--standards <코드,..>] [--out <dir>] [--render]
      동적 조립: 주제에 맞는 아키타입(구조)을 골라 성취기준·제목을 채운 "저작 대기 스캐폴드" 매니페스트 +
      블록별 저작 브리프를 만든다. 콘텐츠(교육적 본문)는 designer AI/교사가 인라인 html 을 저작해 채운다(무API).
      --archetype 로 아키타입을 직접 지정(미지정 시 주제 키워드로 추천). --render 로 스캐폴드 자리표시 미리보기.
      예: compose 중2과학 광합성 --archetype experimental-inquiry
  worksheet-grab edit <manifest.json> "<지시>" [--out <dir>] [--no-render] [--in-place]
      대화형 편집 루프: 기존 매니페스트에 편집 지시를 반영해 매니페스트·HTML 을 왕복 갱신 후 재렌더.
      기본은 원본 보존(-v2, -v3 … 접미사로 저장). --in-place 지정 시에만 원본을 덮어쓴다.
      예: edit out/science-광합성.manifest.json "3번 문항 빼고 성찰 추가"
      지시 대신 플래그도 가능: --remove <N> (반복 가능) · --add reflection
  worksheet-grab doc <list|open|save|history|restore> …
      문서 워크스페이스(worksheets/<문서명>/ — manifest·학생/교사 HTML·meta·히스토리).
        doc list                            문서 목록(제목·교과·리비전·unsafe 배지)
        doc open <문서명>                   문서 로드·상태 표시(편집은 edit-ui)
        doc save <문서명> --from <manifest.json>   manifest 를 문서로 저장(재렌더·누출검증·스냅샷)
        doc history <문서명>                히스토리 스냅샷 목록
        doc restore <문서명> <일련번호>     스냅샷 복원(비파괴 — 새 리비전으로 저장)
      generate/pipeline/edit 에 --doc <문서명> 을 주면 out/ 대신 워크스페이스 문서로 산출.
      edit 는 경로 대신 --doc <문서명> 으로도 편집 가능. 정답 누출 시 student.html 은
      보류되고 meta.unsafe 가 표시된다(작업은 저장됨 · export 는 차단).
  worksheet-grab edit-ui <문서명> [--port <n>] [--workspaces-dir <dir>]
      브라우저 에디터(E3): 문서를 127.0.0.1 로컬 서버로 띄워 편집한다.
      인쇄정밀 캔버스(실제 paper.css·용지 치수) + 여백선/넘침 배지 + 학생/교사 토글(물리 2벌)
      + 공통 툴바(폰트·크기·B/I/U·색·정렬·목록·표·이미지·↶↷) + ⭐정답 표시·✏️답란 삽입
      + 라이브 검수 바. 저장(Ctrl+S)은 manifest 역동기화 → SaveDocument(누출 게이트·히스토리).
      정답 마크 해제로 인한 누출은 세션 태깅·confirm·저장 시 마크 소멸 감지로 3중 방어.
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
  --csv <경로>     성취기준 CSV 위치(assemble/generate/pipeline/edit). GEPAI_CSV 환경변수로도 지정 가능.
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
  if (c && /^[초중고]\s*\d*$/.test(String(a || '').trim())) {
    return { gradeSubject: `${a}${b}`, topic: c };
  }
  return { gradeSubject: a, topic: b };
}

/** --standards "[9과12-01],[9과12-02]" → 코드 배열(없으면 null). */
function parseStandardsFlag(flags) {
  if (typeof flags.standards !== 'string' || !flags.standards.trim()) return null;
  return flags.standards.split(',').map((s) => s.trim()).filter(Boolean);
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
    log('  ⚠ 정답 누출 감지 → student.html 쓰기 보류(meta.unsafe=true). export 는 차단됩니다. 콘텐츠 수정 후 재저장하세요.');
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

export async function run(argv, { root, log = console.log, err = console.error, onServer = null } = {}) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
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
    case 'edit-ui': return cmdEditUi(positionals[1], flags, repo, { root, log, onServer });
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
  const themes = await repo.listThemes();
  const knownSubjectHexes = [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
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
    await gen.execute({ grade, subject, topic, limit: parseLimitFlag(flags), codes: parseStandardsFlag(flags) });

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
  let sPath, tPath;
  if (!useDoc) {
    const base = worksheetBase(worksheet.subject, topic);
    ({ sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher }));
    const mPath = await writeManifest(outDir, base, manifest);
    log(`     매니페스트: ${mPath} (재편집용 — edit 명령 입력)`);
  }

  // 3) 검수 게이트
  const findings = [...review.student.findings, ...review.teacher.findings];
  const errors = findings.filter((f) => f.severity === 'error');
  log(`  3) 검수 게이트: ${gate ? 'PASS' : 'FAIL'} (error ${errors.length}건, warning ${findings.length - errors.length}건)`);
  for (const f of findings) {
    const tag = f.severity === 'error' ? '✗' : '⚠';
    log(`       ${tag} [${f.rule}] ${f.message} (근거: ${f.evidence})`);
  }

  if (!gate) {
    err('  ✗ 검수 게이트 실패(정답 누출 등) → 렌더 중단(fail-closed). 콘텐츠 수정 후 재실행하세요.');
    return 1;
  }

  // --doc: 게이트 통과분을 워크스페이스 문서로 저장(단일 SaveDocument 경유). 렌더는 E6.
  if (useDoc) {
    const result = await emitToWorkspace(manifest, flags.doc, flags, repo, { log }, { isNew: true });
    log('  4) 렌더: 워크스페이스 문서의 PDF export 는 후속(E6). HITL: 교사 검토 후 인쇄하세요.');
    return result.unsafe ? 1 : 0;
  }

  // 4) 렌더 (게이트 통과 시)
  if (flags['no-render']) {
    log('  4) 렌더 생략(--no-render). HITL: 교사 검토 후 render 로 인쇄하세요.');
  } else {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: true, paper: manifest.paper });
    for (const e of rendered) log(`  4) 렌더 → ${e.pdf}`);
  }
  log('  ✔ HITL: 산출물을 교사가 검토한 뒤 인쇄/배포하세요(성취기준·정답 토글·저작권 지문 확인).');
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
  });

  const base = worksheetBase(manifest.subject, topic) + '.scaffold';
  const mPath = await writeManifest(outDir, base, manifest);

  log(`▶ compose: ${grade} ${subject} "${topic}"`);
  log(`  1) 성취기준: ${standards.map((s) => s.code).join(', ')}`);
  log(`  2) 아키타입: ${archetype} · ${brief.name} (${archetypeReason})`);
  log(`  3) 스캐폴드: ${mPath} (${manifest.pages.length}쪽 · 인라인 저작 대기)`);
  log('  4) 저작 브리프 — designer AI/교사가 각 블록의 인라인 html 을 주제에 맞게 저작:');
  brief.pages.forEach((pg, i) => {
    log(`     · p${i + 1}`);
    for (const b of pg) {
      const tag = b.packRole ? `${b.type}*` : b.type;
      log(`        [${b.role}] ${tag} — ${b.authoring}`);
    }
  });
  log('  ── HITL: 스캐폴드를 designer 에이전트/교사가 저작한 뒤 pipeline/assemble 로 렌더하세요.');
  log('     검수 게이트(fail-closed)가 정답 누출·미기입 슬롯을 점검합니다. 성취기준 원문·저작권 지문은 그대로 두세요.');

  if (flags.render) {
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
    const { html } = await asm.execute(manifest);
    const { student, teacher } = new BuildVariants().execute(html);
    const { sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
    log(`  5) 스캐폴드 미리보기(자리표시): ${sPath} / ${tPath}`);
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
    log('  ✔ HITL: 편집 결과를 교사가 검토한 뒤 인쇄/배포하세요. (PDF export 는 후속 E6)');
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
    log('  렌더 생략(--no-render). HITL: 교사 검토 후 render 로 인쇄하세요.');
  } else {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: true, paper: edited.paper });
    for (const e of rendered) log(`  ✔ render → ${e.pdf}`);
  }
  log('  ✔ HITL: 편집 결과를 교사가 검토한 뒤 인쇄/배포하세요.');
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
  });
  const addr = await listenEditorServer(server, { port: flags.port ? Number(flags.port) : 0 });
  log(`✔ edit-ui: ${opened.name} — http://127.0.0.1:${addr.port}/ (브라우저 에디터 · Ctrl+C 종료)`);
  for (const w of opened.warnings) log(`  ⚠ ${w}`);
  process.once('SIGINT', () => server.close(() => process.exit(0)));
  if (onServer) onServer(server, addr);
  return 0;
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
          const unsafeTag = d.meta.unsafe ? ' · ⚠ UNSAFE(정답 누출 — student 보류)' : '';
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
    default:
      err(`doc: 알 수 없는 서브명령 "${sub ?? ''}". 지원: list · open · save · history · restore`);
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
