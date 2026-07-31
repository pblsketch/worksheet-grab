#!/usr/bin/env node
// 제품(교사 배포) 번들 생성 — {엔진(1층) + 제품 하네스(2층)}만 담고 개발(3층)은 제외한다.
// 경계는 아래 INCLUDE 화이트리스트가 강제한다(allowlist = HARD 경계). docs/HARNESS-MAP.md 참조.
//
// 사용:  node scripts/build-user-bundle.mjs [출력경로]
// 기본 출력:  dist/worksheet-grab-user/
//
// 원자적 빌드: 스테이징 디렉터리에 조립·검증한 뒤 성공했을 때만 최종 출력과 교체한다(실패 시 기존 번들 보존).
// 의존성 0 — Node 표준 라이브러리만 사용(개발 불변식 §2).

import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, realpathSync, renameSync } from 'node:fs';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'dist', 'worksheet-grab-user');

// 경로를 안전 비교용으로 정규화 — 존재하는 최근접 조상까지 realpath 로 풀고(=symlink/junction 우회 차단)
// 미존재 꼬리를 다시 붙인다. Windows 는 대소문자 비구분이라 소문자화. realpath 실패는 fail-closed(throw).
function canonical(p) {
  let cur = resolve(p);
  const tail = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break; // 파일시스템 루트 도달
    tail.unshift(basename(cur));
    cur = parent;
  }
  let real;
  try { real = realpathSync(cur); }
  catch (e) { throw new Error(`경로 정규화 실패(안전상 중단): ${p} — ${e.message}`); }
  const full = tail.length ? join(real, ...tail) : real;
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

// 안전장치(QA Critical) — 임의 경로 재귀 삭제 방지. 저장소 루트/조상/소스로는 출력 불가.
{
  const outAbs = canonical(OUT);
  const rootAbs = canonical(ROOT);
  const distAbs = canonical(join(ROOT, 'dist'));
  if (outAbs === rootAbs || rootAbs.startsWith(outAbs + sep)) {
    throw new Error(`출력 경로가 저장소 루트/조상이라 거부합니다(재귀 삭제 위험): ${OUT}`);
  }
  if (outAbs.startsWith(rootAbs + sep) && !(outAbs === distAbs || outAbs.startsWith(distAbs + sep))) {
    throw new Error(`저장소 내부 출력은 dist/ 아래만 허용됩니다: ${OUT}`);
  }
  if (existsSync(resolve(OUT)) && !existsSync(join(resolve(OUT), '.wsg-user-bundle'))) {
    throw new Error(`출력 경로가 이미 존재하며 이 도구가 만든 번들이 아니라 덮어쓰기를 거부합니다: ${OUT}`);
  }
}

// 1층 엔진 + 2층 제품 하네스
const INCLUDE = [
  // 1층 엔진 (package.json 은 아래서 교사용으로 정제 생성; README/tools 는 개발 자산이라 제외)
  'bin', 'src', 'assets', 'themes', 'templates', 'data', 'blocks', 'manifests', 'schema',
  // 2층 제품 하네스
  '.claude/skills', '.claude/agents', 'AGENTS.md',
];

// 필수 자산 — 없으면 fail-closed(완성 위장 금지)
const ESSENTIAL = new Set(['bin', 'src', 'schema', '.claude/skills', '.claude/agents', 'AGENTS.md']);

// 선택 포함 — 있으면 담되 없어도 정상(gepai MCP 설정; CSV 폴백이 있어 optional)
const INCLUDE_OPTIONAL = ['.mcp.json'];

// 3층(개발) — 절대 번들에 들어가면 안 되는 것들. 화이트리스트 밖이라 애초에 안 들어오지만,
// 조립 후 자기점검(assertNoDevLayer)으로 이중 방어한다.
const FORBID_TOP = [
  'docs', 'test', 'scripts', 'README.md', 'tools', 'poc', 'node_modules',
  '.omc', '.omo', '.omx', '.fablize', '.codegraph', '.git',
];
const FORBID_UNDER_CLAUDE = ['hooks', 'commands', 'settings.json', 'settings.local.json', 'PRODUCT-CLAUDE.md'];

function copy(dest, rel) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) {
    if (ESSENTIAL.has(rel)) throw new Error(`필수 자산 누락(fail-closed): ${rel}`);
    console.warn(`  [skip] 없음: ${rel}`);
    return false;
  }
  cpSync(src, join(dest, rel), { recursive: true });
  console.log(`  [+] ${rel}`);
  return true;
}

function assertNoDevLayer(dest) {
  const bad = [];
  for (const rel of FORBID_TOP) if (existsSync(join(dest, rel))) bad.push(rel);
  for (const rel of FORBID_UNDER_CLAUDE) if (existsSync(join(dest, '.claude', rel))) bad.push(`.claude/${rel}`);
  // 번들 루트 CLAUDE.md 는 교사용(제품)이어야 한다 — 개발 CLAUDE.md 가 유입되면 개발 헌장 문구가 잡힌다.
  const bundleClaude = join(dest, 'CLAUDE.md');
  if (existsSync(bundleClaude) && readFileSync(bundleClaude, 'utf8').includes('개발 불변식 헌장')) {
    bad.push('CLAUDE.md (개발용 유입 — 교사용이어야 함)');
  }
  if (bad.length) {
    throw new Error(`개발(3층) 자산이 번들에 유입됨(HARD 경계 위반):\n  ${bad.join('\n  ')}`);
  }
}

console.log(`[build-user-bundle] 출력: ${OUT}`);

// 삭제 전 preflight — 필수 자산이 없으면 아무것도 지우기 전에 멈춘다(비원자 파괴 방지).
for (const rel of ESSENTIAL) {
  if (!existsSync(join(ROOT, rel))) throw new Error(`필수 자산 누락(preflight, fail-closed): ${rel}`);
}
const productClaude = join(ROOT, '.claude', 'PRODUCT-CLAUDE.md');
if (!existsSync(productClaude)) throw new Error('필수 자산 누락(preflight, fail-closed): .claude/PRODUCT-CLAUDE.md');

// 스테이징에 조립·검증한 뒤 성공했을 때만 최종 출력과 교체한다(원자적 — 실패 시 기존 번들 무손상).
const STAGING = resolve(OUT) + '.staging';
rmSync(STAGING, { recursive: true, force: true });
try {
  mkdirSync(STAGING, { recursive: true });
  writeFileSync(join(STAGING, '.wsg-user-bundle'), '이 폴더는 build-user-bundle.mjs 가 생성·관리합니다. 직접 편집 금지.\n');

  console.log('[1층 엔진 + 2층 제품 하네스]');
  for (const rel of INCLUDE) copy(STAGING, rel);
  for (const rel of INCLUDE_OPTIONAL) copy(STAGING, rel);

  // 교사용 package.json 생성 — 개발 scripts/files/description 제거(번들에 없는 test/tools 참조 방지 + dev 자rgon 누출 방지)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  writeFileSync(join(STAGING, 'package.json'), JSON.stringify({
    name: pkg.name, version: pkg.version,
    type: pkg.type, bin: pkg.bin, engines: pkg.engines, license: pkg.license,
  }, null, 2) + '\n');
  console.log('  [+] package.json  (교사용 — 개발 scripts/files/description 제거)');

  // 제품 루트 CLAUDE.md = 교사용 조각(개발 CLAUDE.md 대신)
  cpSync(productClaude, join(STAGING, 'CLAUDE.md'));
  console.log('  [+] CLAUDE.md  (<- .claude/PRODUCT-CLAUDE.md)');

  assertNoDevLayer(STAGING);

  // 검증 통과 — 이제서야 기존 출력을 교체한다(여기 도달 전 실패했으면 기존 번들은 그대로).
  rmSync(resolve(OUT), { recursive: true, force: true });
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  renameSync(STAGING, resolve(OUT));
} catch (e) {
  rmSync(STAGING, { recursive: true, force: true }); // 실패 시 스테이징만 청소(기존 번들 무손상)
  throw e;
}
console.log('[done] 개발(3층) 자산 유입 없음 확인 · 사용자 번들 완성');
