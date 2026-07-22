import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Theme, THEME_TOKENS } from '../../src/domain/index.js';

// 테마 순수성 가드(합의 계획 C8) + Theme.toScopedCss 단위 테스트.
//
// 자료집(합본)은 각 멤버 테마를 [data-wb-member="i"] 로 스코프해 방출한다. 그런데 팔레트
// 원천은 themes/*.css 의 `:root` 단일 블록이다 — 만약 미래에 어떤 테마가 :root 밖 규칙이나
// THEME_TOKENS 외 토큰을 추가하면, 스코프 방출(parseRootTokens → toScopedCss)이 그 규칙을
// **조용히 누락**해 합본 색이 원본과 어긋난다. 이 가드가 그 회귀를 차단한다.

const THEMES_DIR = fileURLToPath(new URL('../../themes/', import.meta.url));
const THEME_FILES = readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css'));

// 순수 파서: 주석 제거 → 규칙 블록 추출. { selector, body, blockCount, remainder }.
function parseCssBlocks(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  let matched = '';
  while ((m = re.exec(noComments)) !== null) {
    blocks.push({ selector: m[1].trim(), body: m[2] });
    matched += m[0];
  }
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

test('C8: themes/ 에 최소 4종 테마 CSS 가 존재', () => {
  assert.ok(THEME_FILES.length >= 4, `테마 CSS 4종 이상 필요 (발견: ${THEME_FILES.join(', ')})`);
});

for (const file of THEME_FILES) {
  test(`C8: ${file} — :root 단일 블록 + 정확히 6토큰(THEME_TOKENS)만`, () => {
    const css = readFileSync(new URL(file, new URL('../../themes/', import.meta.url)), 'utf8');
    const { blocks, remainder } = parseCssBlocks(css);

    // (a) 규칙 블록은 정확히 1개.
    assert.equal(blocks.length, 1, `${file}: 규칙 블록은 정확히 1개여야 한다(발견 ${blocks.length})`);
    // (b) 그 셀렉터는 :root 단일.
    assert.equal(blocks[0].selector, ':root', `${file}: 유일 블록 셀렉터는 :root 여야 한다`);
    // (c) 블록 밖 잔여물은 공백뿐(다른 규칙·선언 없음).
    assert.equal(remainder, '', `${file}: :root 블록 밖에 다른 규칙이 있으면 안 된다`);

    // (d) 선언은 정확히 THEME_TOKENS 6종 — 추가 토큰·비-변수 선언 없음.
    const props = declProps(blocks[0].body);
    assert.equal(props.length, THEME_TOKENS.length, `${file}: 토큰 수는 정확히 ${THEME_TOKENS.length}개여야 한다`);
    assert.deepEqual([...props].sort(), [...THEME_TOKENS].sort(), `${file}: 선언 토큰이 THEME_TOKENS 와 정확히 일치해야 한다`);
  });
}

// ── Theme.toScopedCss ──────────────────────────────────────────────────

const TOKENS = { '--c': '#00838f', '--c2': '#26a69a', '--clite': '#e0f2f1', '--cstrip': '#4db6ac', '--clabel': '#b2dfdb', '--cink': '#00695c' };

test('toScopedCss: 셀렉터만 교체하고 6토큰은 toRootCss 와 동일하게 방출', () => {
  const t = new Theme({ name: 'sci', tokens: TOKENS });
  const scoped = t.toScopedCss('[data-wb-member="0"]');
  // 셀렉터가 교체됐다.
  assert.ok(scoped.startsWith('[data-wb-member="0"] {\n'));
  assert.ok(!scoped.includes(':root'));
  // 본문(토큰 6줄)은 toRootCss 의 :root 본문과 바이트 동일.
  const rootBody = t.toRootCss().replace(/^:root/, '');
  const scopedBody = scoped.replace(/^\[data-wb-member="0"\]/, '');
  assert.equal(scopedBody, rootBody);
  // 6토큰 전부 포함.
  for (const k of THEME_TOKENS) assert.match(scoped, new RegExp(`${k}: ${TOKENS[k].replace(/[-]/g, '\\$&')};`));
});

test('toScopedCss: 빈/비문자열 셀렉터는 TypeError', () => {
  const t = new Theme({ name: 'sci', tokens: TOKENS });
  assert.throws(() => t.toScopedCss(''), TypeError);
  assert.throws(() => t.toScopedCss('   '), TypeError);
  assert.throws(() => t.toScopedCss(null), TypeError);
});
