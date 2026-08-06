import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { THEME_TOKENS } from '../../src/domain/index.js';

// P1 L0 게이트: blocks.css 토큰화 무회귀 (괘선색·모서리·괘선폭·블록리듬·타이포 — --wg-rule-*/--wg-radius-*/--wg-space-block*/--wg-fs-*).
// 설계 문서: wsdemo/design-tokens/02-baseline-and-regression-gate.md §3.2.
// `theme-purity.test.js`/`paper-fallback-equivalence.test.js`의 파서 스타일을 재사용한다.
//
// 원칙: "무드 미지정 = 바이트 무회귀" — 새 토큰(--wg-rule-color)은 폴백값만 제공하고
// 어디에도 정의되지 않아야 한다. 정적 텍스트는 반드시 바뀌지만(리터럴 → var(token,리터럴)),
// 그 var() 를 "언랩"하면 정확히 원래 리터럴로 돌아와야 한다는 것이 이 게이트의 핵심 불변식이다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BLOCKS_CSS_PATH = resolve(ROOT, 'assets/blocks.css');
const PAPER_CSS_PATH = resolve(ROOT, 'assets/paper.css');
const THEMES_DIR = resolve(ROOT, 'themes');
const BASELINE_PATH = resolve(ROOT, 'test/fixtures/golden/blocks-css-baseline.json');

// ── 파서(theme-purity.test.js 의 parseCssBlocks 와 동형) ──────────────────

function parseCssBlocks(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(noComments)) !== null) {
    blocks.push({ selector: m[1].trim(), body: m[2] });
  }
  const remainder = noComments.replace(re, '').trim();
  return { blocks, remainder };
}

function splitDeclBody(body) {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const idx = d.indexOf(':');
      const prop = idx === -1 ? d : d.slice(0, idx).trim();
      const value = idx === -1 ? '' : d.slice(idx + 1).trim().replace(/\s+/g, ' ');
      return { prop, value };
    });
}

/** css 텍스트(파일 전체 또는 스니펫) → { blockIndex, selector, propIndex, prop, value }[]. */
function parseDecls(css) {
  const { blocks, remainder } = parseCssBlocks(css);
  assert.equal(remainder, '', `CSS 파싱 잔여물이 있으면 안 됨(중괄호 밖 텍스트): ${JSON.stringify(remainder)}`);
  const records = [];
  blocks.forEach((b, blockIndex) => {
    splitDeclBody(b.body).forEach((d, propIndex) => {
      records.push({ blockIndex, selector: b.selector, propIndex, prop: d.prop, value: d.value });
    });
  });
  return records;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * value 안에서 newTokens 에 속한 토큰의 var(--TOKEN, LITERAL) 감싸기만 반복적으로 벗겨
 * LITERAL 로 치환한다(중첩된 경우 안쪽부터 고정점까지). 그 외 var() 참조(기존 토큰,
 * 예: --wg-tb-color)는 건드리지 않는다 — "이번 스윕이 새로 만든 겹만" 벗기는 것이 목적.
 */
function unwrapNewTokens(value, newTokens) {
  let cur = value;
  let prev;
  do {
    prev = cur;
    for (const tok of newTokens) {
      const re = new RegExp(`var\\(\\s*${escapeRegExp(tok)}\\s*,\\s*([^()]*)\\)`, 'g');
      cur = cur.replace(re, '$1');
    }
  } while (cur !== prev);
  return cur.replace(/\s+/g, ' ').trim();
}

/** css 텍스트 안에서 var(--X ...) 형태로 "참조"된 모든 커스텀 프로퍼티 이름 집합. */
function referencedTokenNames(css) {
  const out = new Set();
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]);
  return out;
}

/**
 * before/after 레코드 배열의 구조적·값 등가성을 검증한다. 위반 시 Error를 던진다
 * (selector/prop/before/after 를 메시지에 포함 — 디버그 가능하게).
 * 반환값: { newTokens } — after 에서 새로 "참조"되기 시작한 토큰명 목록.
 */
function assertTokenEquivalence(beforeRecords, afterRecords) {
  if (beforeRecords.length !== afterRecords.length) {
    throw new Error(
      `선언 개수 불일치(규칙 추가/삭제 금지): before=${beforeRecords.length}개 after=${afterRecords.length}개`
    );
  }

  const beforeTokens = new Set();
  for (const r of beforeRecords) for (const t of referencedTokenNames(r.value)) beforeTokens.add(t);
  const afterTokens = new Set();
  for (const r of afterRecords) for (const t of referencedTokenNames(r.value)) afterTokens.add(t);
  const newTokens = [...afterTokens].filter((t) => !beforeTokens.has(t));

  for (let i = 0; i < beforeRecords.length; i++) {
    const b = beforeRecords[i];
    const a = afterRecords[i];
    if (b.selector !== a.selector || b.prop !== a.prop) {
      throw new Error(
        `구조 불일치(선택자/속성 순서가 어긋남) idx=${i}: ` +
        `before(selector="${b.selector}", prop="${b.prop}") !== after(selector="${a.selector}", prop="${a.prop}")`
      );
    }
    if (a.value === b.value) continue; // 치환 안 된 선언 — 케이스 (a)
    const unwrapped = unwrapNewTokens(a.value, newTokens);
    if (unwrapped !== b.value) {
      throw new Error(
        `LITERAL 불일치(폴백이 원본과 다름): selector="${a.selector}" prop="${a.prop}" ` +
        `before="${b.value}" after="${a.value}" (언랩결과="${unwrapped}")`
      );
    }
  }
  return { newTokens };
}

// ── (사전 준비) 골든 베이스라인 로드 + 현행 blocks.css 파싱 ──────────────

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const blocksCssCurrent = readFileSync(BLOCKS_CSS_PATH, 'utf8');
const currentRecords = parseDecls(blocksCssCurrent);

// ── 기존 인라인 오버라이드 계열(§1.4/§3.2-3 발견 사항) — 충돌 금지 대상 ──

const KNOWN_OVERRIDE_PREFIXES = ['--wg-ps-', '--wg-tb-'];
const KNOWN_OVERRIDE_EXACT = [
  '--wg-fill', '--wg-stroke', '--wg-sw', '--wg-dash',
  '--wg-fs', '--wg-color', '--wg-align', '--wg-left', '--wg-right',
];

function collidesWithKnownOverride(token) {
  return KNOWN_OVERRIDE_EXACT.includes(token) || KNOWN_OVERRIDE_PREFIXES.some((p) => token.startsWith(p));
}

// ── T1: 선언 카운트 불변 + 값 등가성(리터럴 그대로 또는 var(token,LITERAL)) ──

test('L0-1: blocks.css baseline ↔ 현행 — 선언 개수·순서·값 등가성(리터럴==원본 또는 var(token,원본))', () => {
  const { newTokens } = assertTokenEquivalence(baseline.records, currentRecords);
  // 문서화용 sanity: 지금까지 도입된 토큰은 정확히 이 집합이어야 한다(예기치 않은 신규 토큰 방지).
  // P1-a 괘선색 + P1-b 모서리 + P1-c 괘선폭 + P1-d 블록 리듬 + P1-e 타이포(--wg-fs-*)
  // + 감사 C2~C6 정제 토큰(강조괘선 --wg-rule-w-emph · radius-xl · fs-sub/body-sm/directive/fine — 전부 fallback=현행 zero-change).
  assert.deepEqual(
    newTokens.slice().sort(),
    [
      '--wg-fs-body', '--wg-fs-body-sm', '--wg-fs-caption', '--wg-fs-directive', '--wg-fs-fine',
      '--wg-fs-heading', '--wg-fs-label', '--wg-fs-pill', '--wg-fs-sub', '--wg-fs-title',
      '--wg-radius-lg', '--wg-radius-md', '--wg-radius-sm', '--wg-radius-xl',
      '--wg-rule-color', '--wg-rule-w', '--wg-rule-w-emph',
      '--wg-space-block', '--wg-space-block-sm',
    ],
    `도입 토큰 집합이 예상과 다름(발견: ${JSON.stringify(newTokens.slice().sort())})`
  );
});

test('L0-1b: 치환된 선언 수는 정확히 29건(01 인벤토리 실측과 일치)', () => {
  const replaced = currentRecords.filter((r) => /var\(\s*--wg-rule-color\s*,/.test(r.value));
  assert.equal(replaced.length, 29, `var(--wg-rule-color, ...) 를 포함하는 선언은 29건이어야 함(발견: ${replaced.length})`);
  // 01 분석대로 전부 border 계열 속성이어야 한다.
  for (const r of replaced) {
    assert.match(r.prop, /^border(-bottom)?$/, `--wg-rule-color 는 border 계열에만 등장해야 함(발견: prop="${r.prop}" selector="${r.selector}")`);
  }
});

test('L0-1c: 모서리 토큰(--wg-radius-*)은 정확히 24건, 전부 border-radius 속성', () => {
  const replaced = currentRecords.filter((r) => /var\(\s*--wg-radius-(sm|md|lg)\s*,/.test(r.value));
  assert.equal(replaced.length, 24, `var(--wg-radius-*, ...) 를 포함하는 선언은 24건이어야 함(발견: ${replaced.length})`);
  for (const r of replaced) {
    assert.equal(r.prop, 'border-radius', `--wg-radius-* 는 border-radius 에만 등장해야 함(발견: prop="${r.prop}" selector="${r.selector}")`);
  }
});

test('L0-1d: 괘선폭 토큰(--wg-rule-w)은 정확히 43건, 전부 border 계열 속성', () => {
  const replaced = currentRecords.filter((r) => /var\(\s*--wg-rule-w\s*,/.test(r.value));
  assert.equal(replaced.length, 43, `var(--wg-rule-w, ...) 를 포함하는 선언은 43건이어야 함(발견: ${replaced.length})`);
  for (const r of replaced) {
    assert.match(r.prop, /^border(-top|-bottom)?$/, `--wg-rule-w 는 border 계열에만 등장해야 함(발견: prop="${r.prop}" selector="${r.selector}")`);
  }
});

test('L0-1e: 블록 리듬 토큰(--wg-space-block*)은 정확히 23건, 전부 margin-top 속성', () => {
  const replaced = currentRecords.filter((r) => /var\(\s*--wg-space-block/.test(r.value));
  assert.equal(replaced.length, 23, `var(--wg-space-block*, ...) 를 포함하는 선언은 23건이어야 함(발견: ${replaced.length})`);
  for (const r of replaced) {
    assert.equal(r.prop, 'margin-top', `--wg-space-block* 는 margin-top 에만 등장해야 함(발견: prop="${r.prop}" selector="${r.selector}")`);
  }
});

test('L0-1f: 타이포 토큰(--wg-fs-*)은 정확히 74건, 전부 font-size 속성', () => {
  const replaced = currentRecords.filter((r) => /var\(\s*--wg-fs-/.test(r.value));
  assert.equal(replaced.length, 74, `var(--wg-fs-*, ...) 를 포함하는 선언은 74건이어야 함(발견: ${replaced.length})`);
  for (const r of replaced) {
    assert.equal(r.prop, 'font-size', `--wg-fs-* 는 font-size 에만 등장해야 함(발견: prop="${r.prop}" selector="${r.selector}")`);
  }
});

// ── T2: 토큰 이름 충돌 금지(THEME_TOKENS + 기존 인라인 오버라이드) ──────────

test('L0-2: 신규 토큰명은 THEME_TOKENS/기존 인라인 오버라이드와 충돌하지 않음', () => {
  const { newTokens } = assertTokenEquivalence(baseline.records, currentRecords);
  for (const token of newTokens) {
    assert.ok(
      !THEME_TOKENS.includes(token),
      `신규 토큰 "${token}" 이 THEME_TOKENS(${THEME_TOKENS.join(', ')}) 와 충돌 — 이미 테마별 :root 에서 값이 세팅되는 토큰이라 폴백 무회귀 가정이 깨진다`
    );
    assert.ok(
      !collidesWithKnownOverride(token),
      `신규 토큰 "${token}" 이 기존 개체별 인라인 오버라이드(--wg-ps-*/--wg-tb-*/--wg-fill/--wg-stroke/--wg-sw/--wg-dash/--wg-fs/--wg-color/--wg-align/--wg-left/--wg-right) 와 충돌 — 이미 런타임에 값이 세팅되는 토큰이라 폴백 무회귀 가정이 깨진다`
    );
  }
});

// ── T3: 신규 토큰은 blocks.css/paper.css/themes/*.css 어디에도 정의되지 않음 ──

// 실제 "정의"(선언 좌변, `{`/`;` 직후의 --token:)만 잡고 var(--token, ...) "참조"는
// 잡지 않는 경량 정규식 스캔. blocks.css/themes/*.css는 중첩 `{}` 가 없어 parseDecls로도
// 검사 가능하지만, paper.css는 `@media screen { .sheet { ... } } ` 처럼 중첩 블록이 있어
// (non-nested 전제인) parseDecls가 실패한다 — 세 파일 모두에 안전하게 쓸 수 있도록
// 블록 파싱 없이 raw 텍스트에서 직접 "정의 위치"만 정규식으로 판별한다.
function isTokenDefined(css, token) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`(^|[;{])\\s*${escapeRegExp(token)}\\s*:`, 'm');
  return re.test(noComments);
}

test('L0-3: 신규 토큰(--wg-*)은 blocks.css/paper.css/themes/*.css 어느 :root/선택자에도 정의되지 않음(폴백만 존재)', () => {
  const { newTokens } = assertTokenEquivalence(baseline.records, currentRecords);

  const definedIn = (label, css) => {
    for (const token of newTokens) {
      assert.ok(!isTokenDefined(css, token), `신규 토큰 "${token}" 이 ${label} 에 정의되어 있음(폴백이 아니라 그 값이 항상 이김 — 구조적 무회귀 보장 위반)`);
    }
  };

  definedIn('assets/blocks.css(현행)', blocksCssCurrent);
  definedIn('assets/paper.css', readFileSync(PAPER_CSS_PATH, 'utf8'));
  // themes/*.css 는 "항상 로드되는" 캐스케이드(과목 테마) — 여기에 토큰이 정의되면 폴백 무회귀가 깨진다.
  // readdirSync 는 비재귀라 themes/moods/ 하위폴더(P2-a 무드 팩)는 자연히 제외된다. 무드 파일은 의도적으로
  // 이 13토큰을 "정의"하는 옵트인 오버라이드 계층(무드 지정 시에만 로드)이므로 여기서 검사하면 안 되며,
  // 무드 파일의 정합/직교는 test/unit/mood-pack.test.js 가 별도로 지킨다.
  for (const file of readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css'))) {
    definedIn(`themes/${file}`, readFileSync(resolve(THEMES_DIR, file), 'utf8'));
  }
});

// ── T4: 자기검증(합성 사보타주) — 비교기 자체의 검출력을 매 실행마다 증명 ──

test('회귀탐지 자기검증: 폴백 리터럴을 원본과 다르게 바꾸면 비교기가 반드시 실패를 던진다', () => {
  const before = parseDecls('.x { padding: 8px; }');
  const mutatedWrong = parseDecls('.x { padding: var(--wg-tok-x, 9px); }');
  assert.throws(() => assertTokenEquivalence(before, mutatedWrong), /LITERAL 불일치|폴백.*다름/);

  const mutatedRight = parseDecls('.x { padding: var(--wg-tok-x, 8px); }');
  assert.doesNotThrow(() => assertTokenEquivalence(before, mutatedRight));
});

test('회귀탐지 자기검증(중첩 var): 기존 var() 폴백 안에 새 토큰을 겹쳐 넣는 케이스도 정상 검출한다', () => {
  // .obj-table th, .obj-table td 의 실제 패턴을 축소 재현: 기존 --wg-tb-color 폴백 안에
  // 신규 --wg-rule-color 를 한 겹 더 씌우는 것은 정상(치환된 리터럴이 결국 동일).
  const before = parseDecls('.y { border: var(--wg-tb-width, 1px) solid var(--wg-tb-color, #cbd5c0); }');
  const nestedRight = parseDecls('.y { border: var(--wg-tb-width, 1px) solid var(--wg-tb-color, var(--wg-rule-color, #cbd5c0)); }');
  assert.doesNotThrow(() => assertTokenEquivalence(before, nestedRight));

  const nestedWrong = parseDecls('.y { border: var(--wg-tb-width, 1px) solid var(--wg-tb-color, var(--wg-rule-color, #dddddd)); }');
  assert.throws(() => assertTokenEquivalence(before, nestedWrong), /LITERAL 불일치|폴백.*다름/);
});

test('회귀탐지 자기검증: 선언이 추가/삭제되면(카운트 불변 위반) 비교기가 반드시 실패를 던진다', () => {
  const before = parseDecls('.x { padding: 8px; } .z { margin: 1px; }');
  const removed = parseDecls('.x { padding: 8px; }');
  assert.throws(() => assertTokenEquivalence(before, removed), /선언 개수 불일치/);

  const added = parseDecls('.x { padding: 8px; } .z { margin: 1px; } .w { color: red; }');
  assert.throws(() => assertTokenEquivalence(before, added), /선언 개수 불일치/);
});
