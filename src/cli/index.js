import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { FsBlockRepository } from '../adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../adapters/GepaiCurriculum.js';
import { ChromeRenderer } from '../adapters/ChromeRenderer.js';
import { BuildVariants } from '../usecases/BuildVariants.js';
import { ValidateWorksheet } from '../usecases/ValidateWorksheet.js';
import { AssembleWorksheet } from '../usecases/AssembleWorksheet.js';
import { GenerateWorksheet, parseGradeSubject } from '../usecases/GenerateWorksheet.js';
import { RunPipeline } from '../usecases/RunPipeline.js';
import { EditWorksheet } from '../usecases/EditWorksheet.js';
import { RenderPdf, DEFAULT_VIRTUAL_TIME_BUDGET } from '../usecases/RenderPdf.js';
import { RenderImage } from '../usecases/RenderImage.js';

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
  worksheet-grab generate <학년교과> <주제> [--out <dir>] [--pdf] [--png]
      예: generate 중2과학 광합성 — 성취기준을 CSV(MCP 옵션)에서 조회해 교과 템플릿으로
      활동지 + student/teacher 2벌 생성. --pdf 지정 시 A4 PDF, --png 지정 시 미리보기 PNG 까지 렌더.
  worksheet-grab pipeline <학년교과> <주제> [--out <dir>] [--no-render]
      종단 파이프라인: 조회→조립→2벌→검수 게이트→(통과 시) 렌더. 검수 실패 시 렌더 중단(fail-closed).
      HITL: 산출 후 교사 검토를 거쳐 인쇄하도록 안내.
  worksheet-grab edit <manifest.json> "<지시>" [--out <dir>] [--no-render]
      대화형 편집 루프: 기존 매니페스트에 편집 지시를 반영해 매니페스트·HTML 을 왕복 갱신 후 재렌더.
      예: edit out/science-광합성.manifest.json "3번 문항 빼고 성찰 추가"
      지시 대신 플래그도 가능: --remove <N> (반복 가능) · --add reflection
  worksheet-grab list-blocks
  worksheet-grab list-themes
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
async function renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf = true, png = false } = {}) {
  const renderer = new ChromeRenderer({ chromePath: flags.chrome || null });
  const rp = pdf ? new RenderPdf({ renderer }) : null;
  const ri = png ? new RenderImage({ renderer }) : null;
  const dir = resolve(outDir);
  const results = [];
  for (const [mode, inPath] of [['student', sPath], ['teacher', tPath]]) {
    const entry = { mode };
    if (rp) {
      entry.pdf = join(dir, `${base}-${mode}.pdf`);
      await rp.execute({ inputPath: inPath, outputPath: entry.pdf, virtualTimeBudget: 15000 });
    }
    if (ri) {
      entry.png = join(dir, `${base}-${mode}.png`);
      await ri.execute({ inputPath: inPath, outputPath: entry.png, virtualTimeBudget: 15000 });
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
    case 'generate': return cmdGenerate(positionals[1], positionals[2], flags, repo, { log });
    case 'pipeline': return cmdPipeline(positionals[1], positionals[2], flags, repo, { log, err });
    case 'edit': return cmdEdit(positionals[1], positionals[2], flags, repo, { log, err });
    case 'list-blocks': return cmdListBlocks(repo, { log });
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
    log(`✔ render(png) → ${outputPath}`);
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
  const curriculum = new GepaiCurriculum({});
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
  const curriculum = new GepaiCurriculum({});
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum });
  const { html, worksheet, standards, manifest } = await gen.execute({ grade, subject, topic });

  const { student, teacher } = new BuildVariants().execute(html);
  const base = worksheetBase(worksheet.subject, topic);
  const { htmlPath, sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, manifest);

  log(`✔ generate: ${grade} ${subject} "${topic}" (${worksheet.pageCount()}쪽, 성취기준 ${standards.map((s) => s.code).join(', ')})`);
  log(`  ${htmlPath}`);
  log(`  ${sPath}`);
  log(`  ${tPath}`);
  log(`  ${mPath} (재편집용 매니페스트 — edit 명령 입력)`);

  if (flags.pdf || flags.png) {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: !!flags.pdf, png: !!flags.png });
    for (const e of rendered) {
      if (e.pdf) log(`  ✔ render(pdf) → ${e.pdf}`);
      if (e.png) log(`  ✔ render(png) → ${e.png}`);
    }
  }
  return 0;
}

async function cmdPipeline(gradeSubject, topic, flags, repo, { log, err }) {
  if (!gradeSubject || !topic) throw new Error('pipeline: <학년교과> <주제> 가 필요합니다. 예: pipeline 중2과학 광합성');
  const outDir = flags.out || 'out';
  const { grade, subject } = parseGradeSubject(gradeSubject);
  const curriculum = new GepaiCurriculum({});
  const { html, student, teacher, worksheet, standards, review, gate, manifest } =
    await new RunPipeline({ blockRepository: repo, curriculum }).execute({ grade, subject, topic });

  log(`▶ 파이프라인: ${grade} ${subject} "${topic}"`);
  log(`  1) 성취기준 조회: ${standards.map((s) => s.code).join(', ')}`);
  log(`  2) 조립 + 2벌 분기: ${worksheet.pageCount()}쪽 (student/teacher)`);

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
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: true });
    for (const e of rendered) log(`  4) 렌더 → ${e.pdf}`);
  }
  log('  ✔ HITL: 산출물을 교사가 검토한 뒤 인쇄/배포하세요(성취기준·정답 토글·저작권 지문 확인).');
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
  const curriculum = new GepaiCurriculum({});
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
  const { html, worksheet } = await asm.execute(edited);
  const { student, teacher } = new BuildVariants().execute(html);

  const base = worksheetBase(edited.subject, edited.docTitle || 'worksheet');
  const { sPath, tPath } = await writeVariantTrio(outDir, base, { html, student, teacher });
  const mPath = await writeManifest(outDir, base, edited);

  log(`✔ edit: ${manifestPath}`);
  for (const a of applied) log(`  · ${a}`);
  log(`  ${worksheet.pageCount()}쪽 재조립 → ${mPath}`);
  log(`  ${sPath}`);
  log(`  ${tPath}`);

  if (flags['no-render']) {
    log('  렌더 생략(--no-render). HITL: 교사 검토 후 render 로 인쇄하세요.');
  } else {
    const rendered = await renderVariantFiles(outDir, base, { sPath, tPath }, flags, { pdf: true });
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

async function cmdListThemes(repo, { log }) {
  const themes = await repo.listThemes();
  log(`테마 ${themes.length}개:`);
  for (const t of themes) {
    log(`  ${t.name}: ${['--c', '--c2', '--clite', '--cstrip', '--clabel', '--cink'].map((k) => `${k}=${t.tokens[k]}`).join(' ')}`);
  }
  return 0;
}
