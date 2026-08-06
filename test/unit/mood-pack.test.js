import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { THEME_TOKENS } from '../../src/domain/index.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

// P2-a 무드 팩 게이트 — 무드는 "값 세트 데이터"(themes/moods/*.css)이고, AssembleWorksheet 가
// theme 레이어 뒤에 한 겹 주입한다. 두 축을 검증한다:
//   A) 카탈로그 정합 — 각 무드 파일은 :root 단일 블록이며 닫힌 13토큰(--wg-*)에만 값을 준다
//      (theme 색토큰 --c* 나 개체별 오버라이드 토큰을 절대 건드리지 않는다 = 직교 보장).
//   B) 주입 무회귀 — 무드 미지정이면 산출 바이트가 현행과 동일, 지정이면 오직 무드 레이어 한 겹만
//      더해진다(그 외 전부 바이트 동일). 미지 무드는 fail-closed 로 차단된다.
//
// 설계: docs/design-diversification/02-mood-pack.md. L0(blocks-token-equivalence)는 blocks.css 소비를,
// 이 파일은 무드 데이터 + 주입을 지킨다(blocks.css 는 P2-a 에서 무변경이라 L0 단정은 그대로다).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MOODS_DIR = resolve(ROOT, 'themes/moods');

// 무드가 값을 줄 수 있는 유일한 어휘 = blocks.css 가 var(--wg-*, 리터럴) 로 소비하는 13토큰(P1).
// 이 목록은 blocks-token-equivalence.test.js L0-1 의 도입 토큰 집합과 정확히 같아야 한다(단일 어휘).
const MOOD_TOKENS = [
  '--wg-rule-color', '--wg-rule-w',
  '--wg-radius-sm', '--wg-radius-md', '--wg-radius-lg',
  '--wg-space-block', '--wg-space-block-sm',
  '--wg-fs-title', '--wg-fs-heading', '--wg-fs-pill', '--wg-fs-label', '--wg-fs-body', '--wg-fs-caption',
];
const MOOD_TOKEN_SET = new Set(MOOD_TOKENS);

// 무드가 절대 건드리면 안 되는 토큰(직교 위반 방지) — theme 색토큰 + 기존 개체별 인라인 오버라이드.
const FORBIDDEN_EXACT = new Set([
  ...THEME_TOKENS,
  '--wg-fill', '--wg-stroke', '--wg-sw', '--wg-dash', '--wg-fs', '--wg-color', '--wg-align', '--wg-left', '--wg-right',
]);
const FORBIDDEN_PREFIXES = ['--wg-ps-', '--wg-tb-'];

// ── 파서(theme-purity.test.js 와 동형) ──────────────────────────────────────
function parseCssBlocks(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(noComments)) !== null) blocks.push({ selector: m[1].trim(), body: m[2] });
  const remainder = noComments.replace(re, '').trim();
  return { blocks, remainder };
}

function declProps(body) {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const dm = /^(--[a-z0-9-]+)\s*:/i.exec(d);
      return dm ? dm[1] : `__NONVAR__(${d})`;
    });
}

const MOOD_FILES = existsSync(MOODS_DIR)
  ? readdirSync(MOODS_DIR).filter((f) => f.endsWith('.css')).sort()
  : [];

// ── A. 무드 카탈로그 정합 ────────────────────────────────────────────────

test('무드팩: themes/moods/ 에 최소 2종 무드 CSS 가 존재하고 exam/soft/angular 를 포함', () => {
  assert.ok(MOOD_FILES.length >= 2, `무드 CSS 2종 이상 필요(발견: ${MOOD_FILES.join(', ') || '없음'})`);
  for (const expected of ['exam.css', 'soft.css', 'angular.css']) {
    assert.ok(MOOD_FILES.includes(expected), `${expected} 이 themes/moods/ 에 있어야 함(발견: ${MOOD_FILES.join(', ')})`);
  }
});

// 무드 레이아웃 변형(P2-c): 무드 파일은 :root 토큰 블록(블록1) 뒤에 "레이아웃 오버라이드 규칙"을
// 가질 수 있다(예: 시험지형 밑줄 헤더). 규칙은 전역이지만 해당 무드가 활성일 때만 로드된다.
// 단 fail-closed 가드로 페이지 기하(.sheet=float 원점)·정답안전(.answer/.plot-ans)·크롬(러닝헤더/모드
// 배지)·float 은 절대 못 건드리고, 위치(position 등) 속성·url() 도 금지한다(불변식 보호).
const LAYOUT_FORBIDDEN_SELECTOR = /\.(sheet|answer|plot-ans|mode-badge|run-head|run-foot|wg-float)\b|[@*]|:root/;
const LAYOUT_FORBIDDEN_PROP = new Set(['position', 'z-index', 'float', 'content', 'inset', 'top', 'right', 'bottom', 'left']);

function splitDecls(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return { prop: (i === -1 ? d : d.slice(0, i)).trim().toLowerCase(), value: (i === -1 ? '' : d.slice(i + 1)).trim() };
  });
}

/** 무드 파일 1개의 정합/안전성을 검증한다(위반 시 Error). 퍼-파일 테스트와 자기검증(변이)이 공유. */
function assertMoodFileSafe(css, file) {
  const { blocks, remainder } = parseCssBlocks(css);
  if (remainder !== '') throw new Error(`${file}: 규칙 블록 밖 텍스트가 있으면 안 된다`);
  if (blocks.length < 1) throw new Error(`${file}: 최소 :root 블록 1개가 있어야 한다`);

  // 블록1 = :root, 선언 ⊆ 닫힌 13토큰(비변수·미지·중복·금지토큰 차단) — 값 세트 축.
  if (blocks[0].selector !== ':root') throw new Error(`${file}: 첫 블록은 :root(값 세트) 여야 한다`);
  const props = declProps(blocks[0].body);
  if (props.length < 1) throw new Error(`${file}: :root 는 최소 1개 토큰을 정의해야 한다`);
  for (const p of props) {
    if (p.startsWith('__NONVAR__')) throw new Error(`${file}: :root 는 커스텀 프로퍼티(--*)만 선언한다(발견: ${p})`);
    if (!MOOD_TOKEN_SET.has(p)) throw new Error(`${file}: 미지 무드 토큰 "${p}" (닫힌 13토큰 밖)`);
    if (FORBIDDEN_EXACT.has(p) || FORBIDDEN_PREFIXES.some((pre) => p.startsWith(pre))) {
      throw new Error(`${file}: 무드가 금지 토큰 "${p}"(테마색/개체오버라이드)을 건드림(직교 위반)`);
    }
  }
  if (new Set(props).size !== props.length) throw new Error(`${file}: :root 에 같은 토큰을 두 번 선언`);

  // 블록2+ = 레이아웃 오버라이드(선택). fail-closed 가드: 금지 선택자/속성/url() 차단.
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (LAYOUT_FORBIDDEN_SELECTOR.test(b.selector)) {
      throw new Error(`${file}: 레이아웃 규칙이 금지 선택자를 건드림(페이지 기하/정답안전/크롬/float 불가): "${b.selector}"`);
    }
    for (const d of splitDecls(b.body)) {
      if (LAYOUT_FORBIDDEN_PROP.has(d.prop)) {
        throw new Error(`${file}: 레이아웃 규칙 금지 속성 "${d.prop}"("${b.selector}") — 위치/부동 속성은 페이지 기하를 흔든다`);
      }
      if (/url\(/i.test(d.value)) {
        throw new Error(`${file}: 레이아웃 규칙 값에 url() 금지("${b.selector}" ${d.prop}) — 원격/장식 자산 통로는 별도(P5)`);
      }
    }
  }
}

for (const file of MOOD_FILES) {
  test(`무드팩: ${file} — 블록1 :root(⊆13토큰) + (선택)안전한 레이아웃 오버라이드만`, () => {
    assert.doesNotThrow(() => assertMoodFileSafe(readFileSync(resolve(MOODS_DIR, file), 'utf8'), file));
  });
}

test('무드팩 가드 자기검증(변이): 위험한 무드 파일은 반드시 거부된다', () => {
  const ok = ':root{ --wg-fs-body: 10pt; }\n.std-box .std-head{ background:none; border-bottom:1.4px solid var(--c2); }';
  assert.doesNotThrow(() => assertMoodFileSafe(ok, 'ok.css'));
  assert.throws(() => assertMoodFileSafe(':root{--wg-fs-body:10pt;}\n.sheet{border:1px solid red;}', 'x'), /금지 선택자/, '.sheet(float 원점) 차단');
  assert.throws(() => assertMoodFileSafe(':root{--wg-fs-body:10pt;}\n.answer{display:none;}', 'x'), /금지 선택자/, '.answer(정답안전) 차단');
  assert.throws(() => assertMoodFileSafe(':root{--wg-fs-body:10pt;}\n.run-head{color:red;}', 'x'), /금지 선택자/, '크롬 차단');
  assert.throws(() => assertMoodFileSafe(':root{--wg-fs-body:10pt;}\n.std-head{position:absolute;}', 'x'), /금지 속성/, 'position 차단');
  assert.throws(() => assertMoodFileSafe(':root{--wg-fs-body:10pt;}\n.std-head{background:url(http://x.png);}', 'x'), /url\(\) 금지/, 'url() 차단');
  assert.throws(() => assertMoodFileSafe(':root{--wg-bogus:1px;}', 'x'), /미지 무드 토큰/, '미지 토큰 차단');
  assert.throws(() => assertMoodFileSafe(':root{--c:#fff;}', 'x'), /미지 무드 토큰|직교 위반/, '테마색 토큰 차단(13토큰 화이트리스트 밖)');
});

test('무드팩: exam(시험지형)은 밑줄형 헤더 레이아웃 변형을 포함한다(메커니즘 증명)', () => {
  const examCss = readFileSync(resolve(MOODS_DIR, 'exam.css'), 'utf8');
  const { blocks } = parseCssBlocks(examCss);
  assert.ok(blocks.length > 1, 'exam 은 :root 외 레이아웃 규칙을 가져야 한다(밑줄 헤더)');
  assert.ok(blocks.some((b) => b.selector.includes('.std-head') && /border-bottom/.test(b.body)),
    '.std-head 를 밑줄(border-bottom)로 바꾸는 레이아웃 규칙이 있어야 한다');
});

// ── B. 주입 무회귀(AssembleWorksheet manifest 경로, Chrome 불필요) ──────────

const BASE_MANIFEST = Object.freeze({
  subject: 'sci', theme: 'sci', docTitle: '무드 주입 테스트',
  pages: [[{ html: '<p class="probe">x</p>' }]],
});

function makeUseCase() {
  const repo = new FsBlockRepository({ root: ROOT });
  return new AssembleWorksheet({ blockRepository: repo, curriculum: null });
}

test('무드 주입: 미지정 문서는 무드 레이어가 전혀 없다(현행 산출 그대로)', async () => {
  const { html } = await makeUseCase().execute({ ...BASE_MANIFEST });
  assert.ok(!html.includes('무드 오버라이드'), '무드 미지정인데 무드 레이어가 주입되었다');
  assert.ok(!html.includes('themes/moods/'), '무드 미지정인데 무드 파일 주석이 들어갔다');
});

test('무드 주입: mood 빈문자열/null 은 미지정과 동일(무주입)', async () => {
  const { html: base } = await makeUseCase().execute({ ...BASE_MANIFEST });
  const { html: empty } = await makeUseCase().execute({ ...BASE_MANIFEST, mood: '' });
  const { html: nul } = await makeUseCase().execute({ ...BASE_MANIFEST, mood: null });
  assert.equal(empty, base, "mood:'' 는 미지정과 바이트 동일해야 한다");
  assert.equal(nul, base, 'mood:null 은 미지정과 바이트 동일해야 한다');
});

test('무드 주입: mood 지정 시 오직 무드 레이어 한 겹만 더해진다(그 외 전부 바이트 동일 — 무회귀)', async () => {
  const uc = makeUseCase();
  const { html: base } = await uc.execute({ ...BASE_MANIFEST });
  const { html: moody } = await uc.execute({ ...BASE_MANIFEST, mood: 'exam' });

  // 주입 레이어 = theme 뒤에 붙는 정확한 문자열(헤더 주석 + 무드 파일 원문).
  const examCss = readFileSync(resolve(MOODS_DIR, 'exam.css'), 'utf8');
  const moodLayer = `\n\n/* ===== 무드 오버라이드 (themes/moods/exam.css) ===== */\n${examCss}`;

  assert.ok(moody.includes(moodLayer), '무드 지정 산출에 정확한 무드 레이어가 있어야 한다');
  // 그 레이어를 도로 떼어내면 미지정 산출과 완전히 동일해야 한다(무드는 오직 한 겹만 바꾼다).
  assert.equal(moody.replace(moodLayer, ''), base, '무드 주입이 무드 레이어 외의 바이트를 바꾸면 안 된다(무회귀)');
  // 무드 토큰 실측값이 실제로 실렸는지(대표 1개).
  assert.match(moody, /--wg-fs-body:\s*9\.5pt/, 'exam 무드의 --wg-fs-body 값이 주입되어야 한다');
});

test('무드 주입: 미지 무드는 fail-closed 로 차단(조용한 무시 금지)', async () => {
  await assert.rejects(
    () => makeUseCase().execute({ ...BASE_MANIFEST, mood: 'no-such-mood' }),
    /알 수 없는 무드|fail-closed/,
    '등록되지 않은 무드는 반드시 에러를 던져야 한다',
  );
});
