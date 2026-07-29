// 하네스 경계 회귀 잠금 — 제품(2층) 하네스에 개발(3층) 어휘가 재유입되면 빨간불.
// 근거·어휘 사전: docs/HARNESS-MAP.md §5. 매니페스트만으로는 시간이 지나며 경계가 침식되므로 테스트로 잠근다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 개발어휘 탐지기 (HARNESS-MAP §5-1)
const DEV_PATTERNS = [
  { name: '개발자 PC 절대경로', re: /E:\/github\/worksheet-grab/ },
  { name: '마일스톤/이슈 코드', re: /\b(M[1-6]|S[0-9]\.[0-9]|US-1[0-9]|S4\.0|F[1-6]|editor-v[0-9])\b/ },
  { name: '개발 연혁 날짜', re: /2026-0[0-9]-[0-9]{2}[^)]*(전환|델타|신설|개정)/ },
  { name: '개발문서 참조', re: /HANDOFF|DEFECTS|docs\/PRD|docs\/DECISION/ },
  { name: '개발 프로세스 어휘', re: /병행\s?세션|변이\s?실험|worktree/ },
];

function walkMd(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// 스캔 대상 = 2층 제품 하네스 (교사에게 배포되는 파일)
function productFiles() {
  const files = [
    ...walkMd(join(ROOT, '.claude', 'skills')),
    ...walkMd(join(ROOT, '.claude', 'agents')),
  ];
  const productClaude = join(ROOT, '.claude', 'PRODUCT-CLAUDE.md');
  if (existsSync(productClaude)) files.push(productClaude);
  return files;
}

test('2층 제품 하네스에 개발(3층) 어휘가 없다', () => {
  const files = productFiles();
  assert.ok(files.length > 0, '스캔 대상 제품 하네스 파일을 찾지 못함(경로 확인)');
  const leaks = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const { name, re } of DEV_PATTERNS) {
      const m = text.match(re);
      if (m) leaks.push(`${f.replace(ROOT, '.')}  [${name}] "${m[0]}"`);
    }
  }
  assert.equal(leaks.length, 0, `제품 하네스에 개발어휘 누출 ${leaks.length}건:\n  ${leaks.join('\n  ')}`);
});
