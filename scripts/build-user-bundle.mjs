#!/usr/bin/env node
// 제품(교사 배포) 번들 생성 — {엔진(1층) + 제품 하네스(2층)}만 담고 개발(3층)은 제외한다.
// 경계는 아래 INCLUDE 화이트리스트가 강제한다(allowlist = HARD 경계). docs/HARNESS-MAP.md 참조.
//
// 사용:  node scripts/build-user-bundle.mjs [출력경로]
// 기본 출력:  dist/worksheet-grab-user/
//
// 의존성 0 — Node 표준 라이브러리만 사용(개발 불변식 §2).

import { cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'dist', 'worksheet-grab-user');

// 1층 엔진 + 2층 제품 하네스 (있을 때만 복사)
const INCLUDE = [
  // 1층 엔진
  'bin', 'src', 'assets', 'themes', 'templates', 'data', 'blocks', 'manifests', 'tools',
  'package.json', 'README.md',
  // 2층 제품 하네스
  '.claude/skills', '.claude/agents',
];

// 선택 포함 — 있으면 담되 없어도 정상(예: gepai MCP 설정, CSV 폴백이 있어 optional)
const INCLUDE_OPTIONAL = ['.mcp.json'];

// 3층(개발) — 절대 번들에 들어가면 안 되는 것들. 화이트리스트 밖이라 애초에 안 들어오지만,
// 빌드 후 자기점검(assertNoDevLayer)으로 이중 방어한다.
const FORBID_TOP = [
  'docs', 'test', 'scripts',
  '.omc', '.omo', '.omx', '.fablize', '.codegraph', '.git',
];
const FORBID_UNDER_CLAUDE = ['hooks', 'commands', 'settings.local.json', 'PRODUCT-CLAUDE.md'];

function copy(rel) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) { console.warn(`  [skip] 없음: ${rel}`); return false; }
  cpSync(src, join(OUT, rel), { recursive: true });
  console.log(`  [+] ${rel}`);
  return true;
}

function assertNoDevLayer() {
  const bad = [];
  for (const rel of FORBID_TOP) if (existsSync(join(OUT, rel))) bad.push(rel);
  for (const rel of FORBID_UNDER_CLAUDE) if (existsSync(join(OUT, '.claude', rel))) bad.push(`.claude/${rel}`);
  // 번들 루트 CLAUDE.md 는 교사용(제품)이어야 한다 — 개발 CLAUDE.md 가 유입되면 개발 헌장 문구가 잡힌다.
  const bundleClaude = join(OUT, 'CLAUDE.md');
  if (existsSync(bundleClaude) && readFileSync(bundleClaude, 'utf8').includes('개발 불변식 헌장')) {
    bad.push('CLAUDE.md (개발용 유입 — 교사용이어야 함)');
  }
  if (bad.length) {
    throw new Error(`개발(3층) 자산이 번들에 유입됨(HARD 경계 위반):\n  ${bad.join('\n  ')}`);
  }
}

console.log(`[build-user-bundle] 출력: ${OUT}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('[1층 엔진 + 2층 제품 하네스]');
for (const rel of INCLUDE) copy(rel);
for (const rel of INCLUDE_OPTIONAL) copy(rel);

// 제품 루트 CLAUDE.md = 교사용 조각(개발 CLAUDE.md 대신)
const productClaude = join(ROOT, '.claude', 'PRODUCT-CLAUDE.md');
if (existsSync(productClaude)) {
  cpSync(productClaude, join(OUT, 'CLAUDE.md'));
  console.log('  [+] CLAUDE.md  (<- .claude/PRODUCT-CLAUDE.md)');
} else {
  console.warn('  [warn] .claude/PRODUCT-CLAUDE.md 없음 — 번들에 교사용 CLAUDE.md 미포함');
}

assertNoDevLayer();
console.log('[done] 개발(3층) 자산 유입 없음 확인 · 사용자 번들 완성');
