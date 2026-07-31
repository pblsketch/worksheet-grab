// 하네스 경계 회귀 잠금 — 제품(2층)에 개발(3층) 어휘가 재유입되거나 배포 번들에 3층이 섞이면 빨간불.
// 근거·어휘 사전: docs/HARNESS-MAP.md §5. 매니페스트만으로는 경계가 침식되므로 테스트로 잠근다.
//
// 경계 대상 = 제품 하네스의 "행동 규칙 산문"(SKILL.md·에이전트·CLAUDE.md·AGENTS.md).
// 제외 = worksheet-consult/{references,examples} 는 upstream verbatim 코퍼스(원문 편집 금지)라 스캔 예외.
// 허용 = 엔진 인터페이스명(ValidateObjectTree 등)과 `import ... from './src/...'` 예시는 1↔2 계약이라 누출 아님.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 전체 텍스트에 적용하는 개발(3층) 어휘 탐지기 (HARNESS-MAP §5-1)
const DEV_PATTERNS = [
  { name: '개발자 PC 절대경로', re: /\b[A-Za-z]:[\\/]/ },
  { name: '마일스톤/이슈/규칙 코드', re: /\b(M[1-6]|S[0-9]\.[0-9]|US-1[0-9]|S4\.0|F[1-6]|editor-v[0-9]|R[0-9]|R2-[0-9]|D-A)\b/ },
  { name: 'ISO 개발 날짜', re: /\b20\d\d-\d{2}-\d{2}\b/ },
  { name: '개발문서 참조', re: /HANDOFF|DEFECTS|docs\/PRD|docs\/DECISION/ },
  { name: '개발 프로세스 어휘', re: /병행\s?세션|변이\s?실험|worktree|git add/ },
  { name: '리팩토링 배너', re: /제품 하네스 자산 — 교사 배포용/ },
  { name: '개발 로드맵/미배선', re: /서버 구현.{0,10}별도 예정|서버 계약 이관|미배선|배선 단계|서기 전까지|아직 반영되지 않/ },
];

// verbatim 코퍼스(원문 편집 금지 — 각색은 SKILL 오버레이에만)는 경계 스캔 예외
const CORPUS = /[\\/]worksheet-consult[\\/](references|examples)[\\/]/;
// 허용되는 엔진 import 예시 라인 — 엔진 공개 계약(usecases 진입점)만. 그 밖의 src/ 참조는 누출로 본다.
const ALLOWED_IMPORT = /^\s*import\b.*from\s+'\.\/src\/usecases\/[A-Za-z0-9]+\.js'/;

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

function scanLeaks(files, stripBase) {
  const leaks = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = f.replace(stripBase, '.');
    const flat = text.replace(/\s+/g, ' ');  // 줄바꿈으로 쪼갠 로드맵/문구도 잡도록 공백 평탄화
    for (const { name, re } of DEV_PATTERNS) {
      const m = flat.match(re);
      if (m) leaks.push(`${rel}  [${name}] "${m[0]}"`);
    }
    // 내부 소스 경로 노출(poc/, src/) — 단, 엔진 import 예시 라인은 허용(1↔2 계약)
    text.split('\n').forEach((ln, i) => {
      if (/\b(poc|src)\//.test(ln) && !ALLOWED_IMPORT.test(ln)) {
        leaks.push(`${rel}:${i + 1}  [내부 소스 경로] "${ln.trim().slice(0, 60)}"`);
      }
    });
  }
  return leaks;
}

function productFiles(base) {
  return [
    ...walkMd(join(base, '.claude', 'skills')),
    ...walkMd(join(base, '.claude', 'agents')),
  ].filter((f) => !CORPUS.test(f));
}

// 1) 소스트리의 제품 하네스에 개발어휘가 없다
test('2층 제품 하네스(소스)에 개발(3층) 어휘가 없다', () => {
  const files = productFiles(ROOT);
  const claude = join(ROOT, 'CLAUDE.md');
  if (existsSync(claude)) files.push(claude);
  const agents = join(ROOT, 'AGENTS.md');
  if (existsSync(agents)) files.push(agents);

  assert.ok(files.length > 0, '스캔 대상 제품 하네스 파일을 찾지 못함(경로 확인)');
  const leaks = scanLeaks(files, ROOT);
  assert.equal(leaks.length, 0, `제품 하네스에 개발어휘 누출 ${leaks.length}건:\n  ${leaks.join('\n  ')}`);
});

// 2) 실제 빌드된 사용자 번들에 개발(3층)이 없고 교사용으로 구성된다
test('빌드된 사용자 번들에 개발(3층)이 없고 교사용으로 구성된다', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wsg-bundle-'));
  const out = join(tmp, 'bundle');
  try {
    execSync(`node ${JSON.stringify(join(ROOT, 'scripts', 'build-user-bundle.mjs'))} ${JSON.stringify(out)}`,
      { cwd: ROOT, stdio: 'pipe' });

    // 3층 부재
    for (const d of ['docs', 'test', 'scripts', 'README.md', 'tools', '.omc', '.omo', '.omx',
      join('.claude', 'hooks'), join('.claude', 'commands'), join('.claude', 'settings.json'),
      join('.claude', 'PRODUCT-CLAUDE.md')]) {
      assert.ok(!existsSync(join(out, d)), `번들에 3층 유입: ${d}`);
    }
    // 필수 존재
    for (const f of ['bin', 'src', join('schema', 'worksheet-object.schema.json'),
      join('.claude', 'skills'), join('.claude', 'agents'), 'AGENTS.md', 'CLAUDE.md',
      'LICENSE', 'package.json']) {
      assert.ok(existsSync(join(out, f)), `번들에 필수 자산 누락: ${f}`);
    }
    // 번들 CLAUDE.md = 교사용(개발 헌장 아님)
    const cl = readFileSync(join(out, 'CLAUDE.md'), 'utf8');
    assert.ok(cl.includes('교사용 활동지 제작') && !cl.includes('개발 불변식 헌장'),
      '번들 CLAUDE.md 가 교사용이 아님');
    // package.json 계약: 허용 필드만(scripts/files/description/private 없음)
    const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
    const allowed = new Set(['name', 'version', 'type', 'bin', 'engines', 'license']);
    const extra = Object.keys(pkg).filter((k) => !allowed.has(k));
    assert.equal(extra.length, 0, `번들 package.json 에 허용외 필드: ${extra.join(', ')}`);
    // 번들 제품 하네스 개발어휘 0 (코퍼스 제외)
    const files = productFiles(out);
    files.push(join(out, 'AGENTS.md'));
    const leaks = scanLeaks(files, out);
    assert.equal(leaks.length, 0, `번들 제품 하네스에 개발어휘 누출:\n  ${leaks.join('\n  ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 3) 빌드 안전장치가 위험/비관리 출력 경로를 삭제 전에 거부한다(음성 테스트)
test('빌드 안전장치: 위험/비관리 출력 경로를 거부한다', () => {
  const buildScript = join(ROOT, 'scripts', 'build-user-bundle.mjs');
  const expectReject = (target, reMatch, label) => {
    let err;
    try {
      execSync(`node ${JSON.stringify(buildScript)} ${JSON.stringify(target)}`, { cwd: ROOT, stdio: 'pipe' });
    } catch (e) { err = e; }
    assert.ok(err, `${label}: 거부(비정상 종료)해야 함`);
    const out = `${err.stderr || ''}${err.stdout || ''}${err.message || ''}`;
    assert.match(out, reMatch, `${label}: 거부 사유 불일치`);
  };

  // 저장소 루트·소스 디렉터리로의 출력 거부(재귀 삭제 방지)
  expectReject(ROOT, /저장소 루트\/조상|dist\/ 아래만/, '저장소 루트');
  expectReject(join(ROOT, 'src'), /dist\/ 아래만|저장소 루트\/조상/, 'src 디렉터리');

  // 이 도구가 만들지 않은 기존 폴더(마커 없음) 거부 + 거부 시 그 폴더 보존
  const tmp = mkdtempSync(join(tmpdir(), 'wsg-unmanaged-'));
  try {
    expectReject(tmp, /덮어쓰기를 거부/, '비관리 기존 폴더');
    assert.ok(existsSync(tmp), '거부 시 기존 폴더가 보존돼야 함');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
