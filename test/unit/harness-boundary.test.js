// 하네스 경계 회귀 잠금 — 제품(2층)에 개발(3층) 어휘가 재유입되거나 배포 번들에 3층이 섞이면 빨간불.
// 근거·어휘 사전: docs/HARNESS-MAP.md §5. 매니페스트만으로는 경계가 침식되므로 테스트로 잠근다.
//
// 경계 대상 = 제품 하네스의 "행동 규칙 산문"(SKILL.md·에이전트·PRODUCT-CLAUDE).
// 제외 = worksheet-consult/{references,examples} 는 upstream verbatim 코퍼스(원문 편집 금지)라 스캔 예외.
//        엔진 인터페이스명(ValidateObjectTree·BuildVariants 등)·엔진 모듈 import 예시는 1↔2 계약이라 누출 아님.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 개발(3층) 어휘 탐지기 (HARNESS-MAP §5-1)
const DEV_PATTERNS = [
  { name: '개발자 PC 절대경로', re: /\b[A-Za-z]:[\\/](github|Users|home)\b/i },
  { name: '마일스톤/이슈/규칙 코드', re: /\b(M[1-6]|S[0-9]\.[0-9]|US-1[0-9]|S4\.0|F[1-6]|editor-v[0-9]|R[0-9]|R2-[0-9]|D-A)\b/ },
  { name: '개발 연혁 날짜', re: /\b20\d\d-\d{2}-\d{2}[^)\n]*(전환|델타|신설|개정)/ },
  { name: '개발문서 참조', re: /HANDOFF|DEFECTS|docs\/PRD|docs\/DECISION/ },
  { name: '개발 프로세스 어휘', re: /병행\s?세션|변이\s?실험|worktree|git add/ },
  { name: '리팩토링 배너', re: /제품 하네스 자산 — 교사 배포용/ },
  { name: '개발 로드맵', re: /서버 구현.{0,10}별도 예정|서버 계약 이관/ },
];

// verbatim 코퍼스(원문 편집 금지 — 각색은 SKILL 오버레이에만)는 경계 스캔 예외
const CORPUS = /[\\/]worksheet-consult[\\/](references|examples)[\\/]/;

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
    for (const { name, re } of DEV_PATTERNS) {
      const m = text.match(re);
      if (m) leaks.push(`${f.replace(stripBase, '.')}  [${name}] "${m[0]}"`);
    }
  }
  return leaks;
}

// 1) 소스트리의 제품 하네스에 개발어휘가 없다
test('2층 제품 하네스(소스)에 개발(3층) 어휘가 없다', () => {
  const files = [
    ...walkMd(join(ROOT, '.claude', 'skills')),
    ...walkMd(join(ROOT, '.claude', 'agents')),
  ].filter((f) => !CORPUS.test(f));
  const pc = join(ROOT, '.claude', 'PRODUCT-CLAUDE.md');
  if (existsSync(pc)) files.push(pc);

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
      join('.claude', 'skills'), join('.claude', 'agents'), 'CLAUDE.md', 'package.json']) {
      assert.ok(existsSync(join(out, f)), `번들에 필수 자산 누락: ${f}`);
    }
    // 번들 CLAUDE.md = 교사용(개발 헌장 아님)
    const cl = readFileSync(join(out, 'CLAUDE.md'), 'utf8');
    assert.ok(cl.includes('교사용 활동지 제작') && !cl.includes('개발 불변식 헌장'),
      '번들 CLAUDE.md 가 교사용이 아님');
    // package.json 정제(개발 scripts 없음)
    const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
    assert.ok(!pkg.scripts, '번들 package.json 에 개발 scripts 잔존');
    // 번들 제품 하네스 .md 개발어휘 0 (코퍼스 제외)
    const md = [
      ...walkMd(join(out, '.claude', 'skills')),
      ...walkMd(join(out, '.claude', 'agents')),
    ].filter((f) => !CORPUS.test(f));
    const leaks = scanLeaks(md, out);
    assert.equal(leaks.length, 0, `번들 제품 하네스에 개발어휘 누출:\n  ${leaks.join('\n  ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
