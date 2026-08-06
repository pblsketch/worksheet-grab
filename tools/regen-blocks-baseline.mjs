#!/usr/bin/env node
/*
 * blocks.css L0 골든 baseline 재생성기
 * ----------------------------------
 * blocks.css 를 **의도적으로** 변경(디자인 개선)한 뒤 실행해
 * test/fixtures/golden/blocks-css-baseline.json 을 갱신한다.
 *
 * baseline = 현행 blocks.css 의 13개 P1 토큰(--wg-fs/rule/radius/space-*)을 폴백 리터럴로
 *   언랩한 "승인 스냅샷". test/unit/blocks-token-equivalence.test.js 의 parseDecls·unwrap
 *   과 동형 로직이라, 재생성 후 그 테스트가 통과한다.
 *
 * ⚠ 이 스크립트는 "현행 blocks.css 를 승인"한다. 반드시 렌더·편집==인쇄 parity·design-lint·
 *   육안 검증과 함께 써서 의도된 변경만 blessing 되게 한다.
 *
 * 사용: node tools/regen-blocks-baseline.mjs [출력경로]
 *   출력경로 생략 시 실제 baseline 갱신. 검증용으로 임시경로를 줄 수 있다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKS = resolve(ROOT, 'assets/blocks.css');
const OUT = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(ROOT, 'test/fixtures/golden/blocks-css-baseline.json');

// blocks-token-equivalence.test.js L0-1 이 단정하는 정확한 13토큰(이 목록 변경 시 그 테스트도 갱신).
const P1_TOKENS = [
  '--wg-fs-body', '--wg-fs-body-sm', '--wg-fs-caption', '--wg-fs-directive', '--wg-fs-fine',
  '--wg-fs-heading', '--wg-fs-label', '--wg-fs-pill', '--wg-fs-sub', '--wg-fs-title',
  '--wg-radius-lg', '--wg-radius-md', '--wg-radius-sm', '--wg-radius-xl',
  '--wg-rule-color', '--wg-rule-w', '--wg-rule-w-emph',
  '--wg-space-block', '--wg-space-block-sm',
];

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseCssBlocks(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(noComments)) !== null) blocks.push({ selector: m[1].trim(), body: m[2] });
  const remainder = noComments.replace(re, '').trim();
  if (remainder) throw new Error('CSS 파싱 잔여물(중괄호 밖 텍스트): ' + JSON.stringify(remainder));
  return blocks;
}
function splitDeclBody(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const idx = d.indexOf(':');
    const prop = idx === -1 ? d : d.slice(0, idx).trim();
    const value = idx === -1 ? '' : d.slice(idx + 1).trim().replace(/\s+/g, ' ');
    return { prop, value };
  });
}
function unwrap(value) {
  let cur = value, prev;
  do {
    prev = cur;
    for (const tok of P1_TOKENS) {
      const re = new RegExp(`var\\(\\s*${escapeRegExp(tok)}\\s*,\\s*([^()]*)\\)`, 'g');
      cur = cur.replace(re, '$1');
    }
  } while (cur !== prev);
  return cur.replace(/\s+/g, ' ').trim();
}

const css = readFileSync(BLOCKS, 'utf8');
const records = [];
parseCssBlocks(css).forEach((b, blockIndex) => {
  splitDeclBody(b.body).forEach((d, propIndex) => {
    records.push({ blockIndex, selector: b.selector, propIndex, prop: d.prop, value: unwrap(d.value) });
  });
});

const out = {
  _comment: 'L0 baseline golden — assets/blocks.css 의 P1 토큰(--wg-fs/rule/radius/space-*)을 폴백 리터럴로 언랩한 승인 스냅샷. 의도적 디자인 변경 시 tools/regen-blocks-baseline.mjs 로 재생성(반드시 렌더·편집==인쇄 parity·design-lint·육안 검증 동반). (blockIndex, selector, propIndex, prop) 로 각 선언 식별, value 는 언랩된 리터럴.',
  sourceFile: 'assets/blocks.css',
  totalDeclarations: records.length,
  records,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`baseline 재생성: ${records.length} 선언 → ${OUT}`);
