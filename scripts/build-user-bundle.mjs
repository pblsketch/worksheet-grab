#!/usr/bin/env node
// 제품(교사 배포) 번들 생성 — {엔진(1층) + 제품 하네스(2층)}만 담고 개발(3층)은 제외한다.
// 경계는 아래 INCLUDE 화이트리스트가 강제한다(allowlist = HARD 경계). docs/HARNESS-MAP.md 참조.
//
// 사용:  node scripts/build-user-bundle.mjs [출력경로]
// 기본 출력:  dist/worksheet-grab-user/
//
// 의존성 0 — Node 표준 라이브러리만 사용(개발 불변식 §2).

import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'dist', 'worksheet-grab-user');

// 안전장치(QA Critical) — 임의 경로 재귀 삭제 방지. 저장소 루트/조상/소스로는 출력 불가.
{
  const outAbs = resolve(OUT);
  const rootAbs = resolve(ROOT);
  const distAbs = resolve(ROOT, 'dist');
  if (outAbs === rootAbs || rootAbs.startsWith(outAbs + sep)) {
    throw new Error(`출력 경로가 저장소 루트/조상이라 거부합니다(재귀 삭제 위험): ${outAbs}`);
  }
  if (outAbs.startsWith(rootAbs + sep) && !(outAbs === distAbs || outAbs.startsWith(distAbs + sep))) {
    throw new Error(`저장소 내부 출력은 dist/ 아래만 허용됩니다: ${outAbs}`);
  }
  if (existsSync(outAbs) && !existsSync(join(outAbs, '.wsg-user-bundle'))) {
    throw new Error(`출력 경로가 이미 존재하며 이 도구가 만든 번들이 아니라 덮어쓰기를 거부합니다: ${outAbs}`);
  }
}

// 1층 엔진 + 2층 제품 하네스 (있을 때만 복사)
const INCLUDE = [
  // 1층 엔진 (package.json 은 아래서 교사용으로 정제 생성; README/tools 는 개발 자산이라 제외)
  'bin', 'src', 'assets', 'themes', 'templates', 'data', 'blocks', 'manifests', 'schema',
  // 2층 제품 하네스
  '.claude/skills', '.claude/agents',
];

// 필수 자산 — 없으면 fail-closed(완성 위장 금지, QA High)
const ESSENTIAL = new Set(['bin', 'src', 'schema', '.claude/skills', '.claude/agents']);

// 선택 포함 — 있으면 담되 없어도 정상(예: gepai MCP 설정, CSV 폴백이 있어 optional)
const INCLUDE_OPTIONAL = ['.mcp.json'];

// 3층(개발) — 절대 번들에 들어가면 안 되는 것들. 화이트리스트 밖이라 애초에 안 들어오지만,
// 빌드 후 자기점검(assertNoDevLayer)으로 이중 방어한다.
const FORBID_TOP = [
  'docs', 'test', 'scripts', 'README.md', 'tools', 'poc', 'node_modules',
  '.omc', '.omo', '.omx', '.fablize', '.codegraph', '.git',
];
const FORBID_UNDER_CLAUDE = ['hooks', 'commands', 'settings.json', 'settings.local.json', 'PRODUCT-CLAUDE.md'];

function copy(rel) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) {
    if (ESSENTIAL.has(rel)) throw new Error(`필수 자산 누락(fail-closed): ${rel}`);
    console.warn(`  [skip] 없음: ${rel}`);
    return false;
  }
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
writeFileSync(join(OUT, '.wsg-user-bundle'), '이 폴더는 build-user-bundle.mjs 가 생성·관리합니다. 직접 편집 금지.\n');

console.log('[1층 엔진 + 2층 제품 하네스]');
for (const rel of INCLUDE) copy(rel);
for (const rel of INCLUDE_OPTIONAL) copy(rel);

// 교사용 package.json 생성 — 개발 scripts/files 제거(번들에 없는 test/tools 참조로 깨지는 것 방지, QA High)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
writeFileSync(join(OUT, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, description: pkg.description,
  type: pkg.type, bin: pkg.bin, engines: pkg.engines, license: pkg.license,
}, null, 2) + '\n');
console.log('  [+] package.json  (교사용 — 개발 scripts/files 제거)');

// 제품 루트 CLAUDE.md = 교사용 조각(개발 CLAUDE.md 대신) — 필수(fail-closed)
const productClaude = join(ROOT, '.claude', 'PRODUCT-CLAUDE.md');
if (!existsSync(productClaude)) throw new Error('필수 자산 누락(fail-closed): .claude/PRODUCT-CLAUDE.md');
cpSync(productClaude, join(OUT, 'CLAUDE.md'));
console.log('  [+] CLAUDE.md  (<- .claude/PRODUCT-CLAUDE.md)');

assertNoDevLayer();
console.log('[done] 개발(3층) 자산 유입 없음 확인 · 사용자 번들 완성');
