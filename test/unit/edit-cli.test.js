import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CSV = existsSync(DEFAULT_CSV_PATH);
const quiet = () => {};

// US-M4-3 수용: "3번 문항 빼고 성찰 추가" 가 매니페스트·HTML 양쪽에 왕복 반영(재렌더는 render 테스트에서).
test('US-M4-3: edit 왕복 — manifest.json 과 HTML 에 편집 반영(--no-render)', { skip: !HAS_CSV }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-edit-'));

  // 1) 생성 → manifest.json 확보(Chrome 불필요: --pdf 미지정)
  const g = await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  assert.equal(g, 0, 'generate 성공');
  const manifestPath = join(dir, 'science-광합성.manifest.json');
  assert.ok(existsSync(manifestPath), 'manifest.json 산출');

  const before = JSON.parse(await readFile(manifestPath, 'utf8'));
  const beforeStudent = await readFile(join(dir, 'science-광합성-student.html'), 'utf8');
  // 편집 전: 3번 문항(실험 과정)과 성찰 부재 확인
  assert.match(beforeStudent, /class="qnum">3</, '편집 전 3번 문항 존재');

  // 2) 편집: "3번 문항 빼고 성찰 추가" (--no-render)
  const e = await run(
    ['edit', manifestPath, '3번 문항 빼고 성찰 추가', '--out', dir, '--no-render'],
    { root: ROOT, log: quiet, err: quiet },
  );
  assert.equal(e, 0, 'edit 성공');

  // 3) 매니페스트에 반영
  const after = JSON.parse(await readFile(manifestPath, 'utf8'));
  const numOf = (b) => {
    const h = b.html || '';
    const m = /class="qnum">\s*(\d+)/.exec(h) || /class="n">\s*(\d+)/.exec(h);
    return m ? Number(m[1]) : null;
  };
  const numsBefore = before.pages.flat().map(numOf).filter((x) => x != null);
  const numsAfter = after.pages.flat().map(numOf).filter((x) => x != null);
  assert.ok(numsBefore.includes(3), '편집 전 매니페스트에 3번 존재');
  assert.ok(!numsAfter.includes(3), '편집 후 매니페스트에 3번 없음');
  assert.ok(JSON.stringify(after).includes('성찰'), '매니페스트에 성찰 추가');

  // 4) HTML(student/teacher)에 반영
  const afterStudent = await readFile(join(dir, 'science-광합성-student.html'), 'utf8');
  const afterTeacher = await readFile(join(dir, 'science-광합성-teacher.html'), 'utf8');
  assert.doesNotMatch(afterStudent, /class="qnum">3</, '편집 후 HTML 에 3번 문항 없음');
  assert.match(afterStudent, /성찰/, '편집 후 HTML 에 성찰 추가');
  assert.match(afterTeacher, /성찰/, 'teacher 벌에도 성찰 반영');
});

test('US-M4-3: edit 플래그 경로(--remove/--add)도 동일 동작', { skip: !HAS_CSV }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-editf-'));
  await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  const manifestPath = join(dir, 'science-광합성.manifest.json');
  const code = await run(
    ['edit', manifestPath, '--remove', '2', '--add', 'reflection', '--out', dir, '--no-render'],
    { root: ROOT, log: quiet, err: quiet },
  );
  assert.equal(code, 0);
  const after = await readFile(join(dir, 'science-광합성-student.html'), 'utf8');
  assert.doesNotMatch(after, /class="qnum">2</, '2번 제거');
  assert.match(after, /성찰/, '성찰 추가');
});
