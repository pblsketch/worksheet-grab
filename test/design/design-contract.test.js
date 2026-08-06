import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { lint, ROOT } from '../../tools/design-lint.mjs';

// P2 · 디자인 계약 검출기 게이트.
// 단일 파일에 모아 순차 실행한다 — 변이 프로브가 임시 파일을 쓰므로 다른 테스트 파일과
// 병렬로 돌면 '현행 clean' 검사와 레이스가 난다(node:test 는 파일 간 병렬, 파일 내 순차).

test('AC2a · 현행 코드베이스는 신규 계약 이탈 0 (baseline 정합)', () => {
  const { violations } = lint();
  assert.equal(violations.length, 0, '신규 이탈 발생:\n' + JSON.stringify(violations, null, 2));
});

test('baseline.json 이 존재·유효하며 시그니처를 담는다', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'test', 'design', 'baseline.json'), 'utf8'));
  assert.ok(Object.keys(b).length > 0, 'baseline 이 비어 있으면 안 됨');
});

test('design-tokens.json 이 유효하고 필수 그룹을 담는다', () => {
  const t = JSON.parse(readFileSync(join(ROOT, 'docs', 'design-system', 'design-tokens.json'), 'utf8'));
  assert.ok(t.designTokens.typography['--wg-fs-body'], '타이포 토큰');
  assert.equal(t.borderWeights.emphasis, '--wg-rule-w-emph', '강조 괘선 토큰(AC6)');
  assert.ok(Array.isArray(t.semanticColors.answer), '의미색 allowlist');
});

test('AC1 · themes.md 팔레트가 실제 themes/*.css :root 와 일치(드리프트 가드)', () => {
  const md = readFileSync(join(ROOT, '.claude', 'skills', 'worksheet-design', 'references', 'themes.md'), 'utf8').toLowerCase();
  for (const subj of ['neutral', 'ko', 'sci', 'social', 'english']) {
    const css = readFileSync(join(ROOT, 'themes', subj + '.css'), 'utf8');
    const hexes = [...css.matchAll(/--c[a-z0-9]*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
    assert.equal(hexes.length, 6, subj + ' 는 교과색 6종이어야 함');
    for (const h of hexes) assert.ok(md.includes(h), `themes.md 에 ${subj} 색 ${h} 가 있어야 함(드리프트)`);
  }
});

// ── 변이 실험(AC2b): 신규 하드코딩은 잡고, 토큰/allowlist 준수는 통과 ──
const PROBE = join(ROOT, 'themes', '__mutation_probe__.css');

test('AC2b · 검출기가 신규 하드코딩(폰트 pt·임의 hex·url·.sheet)을 잡고 토큰/allowlist 준수는 통과', () => {
  const css = [
    '.__probe_bad { font-size: 13pt; color: #ff00aa; background: url(evil.png); }',
    '.sheet.__probe_bad { border-bottom: 1px solid #123456; }',
    '.__probe_ok { border: var(--wg-rule-w-emph, 1.6px) solid var(--wg-rule-color, #cbd5c0);',
    '  font-size: var(--wg-fs-body, 9.5pt); color: var(--cink); }',
    '.__probe_ok2 { color: #1a5fb4; }', // 의미색 allowlist — 재사용 허용
  ].join('\n');
  writeFileSync(PROBE, css);
  try {
    const { violations } = lint();
    const probe = violations.filter((v) => v.rel.includes('__mutation_probe__'));
    const kinds = probe.map((v) => `${v.kind}:${v.val}`);
    // 잡아야 하는 것
    assert.ok(kinds.includes('font-size:13pt'), '신규 13pt 를 잡아야 함: ' + JSON.stringify(kinds));
    assert.ok(kinds.includes('hex:#ff00aa'), '임의 hex(#ff00aa)를 잡아야 함: ' + JSON.stringify(kinds));
    assert.ok(kinds.includes('hex:#123456'), '임의 hex(#123456)를 잡아야 함');
    assert.ok(kinds.includes('url:url()'), 'url() 을 잡아야 함');
    assert.ok(kinds.some((k) => k.startsWith('sheet-selector')), '.sheet 셀렉터를 잡아야 함');
    // 잡으면 안 되는 것(계약 준수)
    assert.ok(!kinds.includes('hex:#1a5fb4'), '의미색 allowlist(#1a5fb4)는 통과해야 함(균질화 방지·재사용)');
    assert.ok(!kinds.some((k) => k.startsWith('font-size') && k !== 'font-size:13pt'), 'var() 토큰 폰트는 통과해야 함');
  } finally {
    rmSync(PROBE, { force: true });
  }
});

test('변이 프로브 제거 후 현행은 다시 clean(부작용 없음)', () => {
  rmSync(PROBE, { force: true });
  const { violations } = lint();
  assert.equal(violations.length, 0, '프로브 잔존/부작용: ' + JSON.stringify(violations, null, 2));
});
