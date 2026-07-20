import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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

export async function run(argv, { root, log = console.log, err = console.error } = {}) {
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

  const { student, teacher } = new BuildVariants().execute(html);
  const base = worksheetBase(worksheet.subject, topic);
  const { htmlPath, sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, manifest);

  log(`✔ generate: ${grade} ${subject} "${topic}" (${worksheet.pageCount()}쪽, 성취기준 ${standards.map((s) => s.code).join(', ')})`);
  if (manifest.paper) log(`  용지: ${paperLine(manifest.paper)}`);
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

  const base = worksheetBase(worksheet.subject, topic);
  const { sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, manifest);
  log(`     매니페스트: ${mPath} (재편집용 — edit 명령 입력)`);

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
  if (!manifestPath) throw new Error('edit: <manifest.json> 경로가 필요합니다.');
  const outDir = flags.out || 'out';
  const manifest = await repo.readManifest(manifestPath);

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
