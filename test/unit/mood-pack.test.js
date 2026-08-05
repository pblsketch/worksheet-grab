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

for (const file of MOOD_FILES) {
  test(`무드팩: ${file} — :root 단일 블록 + 선언은 닫힌 13토큰(--wg-*) 부분집합만`, () => {
    const css = readFileSync(resolve(MOODS_DIR, file), 'utf8');
    const { blocks, remainder } = parseCssBlocks(css);

    // (a) 규칙 블록은 정확히 1개, 셀렉터는 :root, 블록 밖 잔여물 없음(theme-purity 와 같은 형태 계약).
    assert.equal(blocks.length, 1, `${file}: 규칙 블록은 정확히 1개여야 한다(발견 ${blocks.length})`);
    assert.equal(blocks[0].selector, ':root', `${file}: 유일 블록 셀렉터는 :root 여야 한다`);
    assert.equal(remainder, '', `${file}: :root 블록 밖에 다른 규칙이 있으면 안 된다`);

    // (b) 모든 선언은 --변수 이며 닫힌 13토큰 어휘 안에 있다(비-변수 선언·미지 토큰 금지).
    const props = declProps(blocks[0].body);
    assert.ok(props.length >= 1, `${file}: 최소 1개 토큰을 정의해야 한다`);
    for (const p of props) {
      assert.ok(!p.startsWith('__NONVAR__'), `${file}: 무드는 커스텀 프로퍼티(--*)만 선언한다(발견: ${p})`);
      assert.ok(MOOD_TOKEN_SET.has(p), `${file}: 무드 토큰 "${p}" 이 닫힌 13토큰 어휘 밖이다(오타/범위이탈)`);
    }

    // (c) 중복 선언 금지(같은 토큰 두 번).
    assert.equal(new Set(props).size, props.length, `${file}: 같은 토큰을 두 번 선언하면 안 된다(발견: ${props.join(', ')})`);

    // (d) 직교 보장 — theme 색토큰(--c*)·개체별 오버라이드 토큰을 절대 건드리지 않는다.
    for (const p of props) {
      assert.ok(!FORBIDDEN_EXACT.has(p), `${file}: 무드가 금지 토큰 "${p}"(테마색/개체오버라이드)을 건드리면 안 된다(내용/디자인 직교 위반)`);
      assert.ok(!FORBIDDEN_PREFIXES.some((pre) => p.startsWith(pre)), `${file}: 무드가 개체별 오버라이드 계열 "${p}" 을 건드리면 안 된다`);
    }
  });
}

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
