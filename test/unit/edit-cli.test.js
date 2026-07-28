import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { autoTmpDir } from '../helpers/tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CSV = existsSync(DEFAULT_CSV_PATH);
const quiet = () => {};

const countSubq = (html) => (html.match(/class="qnum">/g) || []).length;

// US-M4-3 수용: "3번 문항 빼고 성찰 추가" 가 매니페스트·HTML 양쪽에 왕복 반영(재렌더는 render 테스트에서).
// G4: 기본은 원본 보존 — 편집본은 -v2 접미사로 저장되고 원본 파일은 그대로 남는다.
test('US-M4-3: edit 왕복 — 편집본은 -v2 로 저장되고 원본은 보존(--no-render)', { skip: !HAS_CSV }, async () => {
  const dir = await autoTmpDir('wsg-edit-');

  // 1) 생성 → manifest.json 확보(Chrome 불필요: --pdf 미지정)
  const g = await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  assert.equal(g, 0, 'generate 성공');
  const manifestPath = join(dir, 'science-광합성.manifest.json');
  assert.ok(existsSync(manifestPath), 'manifest.json 산출');

  const beforeManifest = await readFile(manifestPath, 'utf8');
  const beforeStudent = await readFile(join(dir, 'science-광합성-student.html'), 'utf8');
  // 편집 전: 3번 문항(실험 과정 지시)과 성찰 부재 확인
  assert.match(beforeStudent, /실험 과정에 따라 측정하고/, '편집 전 3번 문항(내용 기준) 존재');

  // 2) 편집: "3번 문항 빼고 성찰 추가" (--no-render) → 편집본은 -v2
  const e = await run(
    ['edit', manifestPath, '3번 문항 빼고 성찰 추가', '--out', dir, '--no-render'],
    { root: ROOT, log: quiet, err: quiet },
  );
  assert.equal(e, 0, 'edit 성공');

  // 3) 원본 보존(매니페스트·HTML 모두 불변)
  assert.equal(await readFile(manifestPath, 'utf8'), beforeManifest, '원본 매니페스트 불변');
  assert.equal(
    await readFile(join(dir, 'science-광합성-student.html'), 'utf8'), beforeStudent, '원본 student HTML 불변',
  );

  // 4) 편집본(-v2)에 반영
  const v2Manifest = join(dir, 'science-광합성-v2.manifest.json');
  assert.ok(existsSync(v2Manifest), '-v2 매니페스트 산출');
  const after = JSON.parse(await readFile(v2Manifest, 'utf8'));
  assert.ok(JSON.stringify(after).includes('성찰'), '매니페스트에 성찰 추가');

  const afterStudent = await readFile(join(dir, 'science-광합성-v2-student.html'), 'utf8');
  const afterTeacher = await readFile(join(dir, 'science-광합성-v2-teacher.html'), 'utf8');
  assert.doesNotMatch(afterStudent, /실험 과정에 따라 측정하고/, '편집 후 3번 문항(내용 기준) 없음');
  assert.equal(countSubq(afterStudent), countSubq(beforeStudent) - 1, 'subq 1개 감소');
  assert.match(afterStudent, /성찰/, '편집 후 HTML 에 성찰 추가');
  assert.match(afterTeacher, /성찰/, 'teacher 벌에도 성찰 반영');
});

test('US-M4-3: edit 플래그 경로(--remove/--add)도 동일 동작(-v2 산출)', { skip: !HAS_CSV }, async () => {
  const dir = await autoTmpDir('wsg-editf-');
  await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  const manifestPath = join(dir, 'science-광합성.manifest.json');
  const code = await run(
    ['edit', manifestPath, '--remove', '2', '--add', 'reflection', '--out', dir, '--no-render'],
    { root: ROOT, log: quiet, err: quiet },
  );
  assert.equal(code, 0);
  const after = await readFile(join(dir, 'science-광합성-v2-student.html'), 'utf8');
  assert.doesNotMatch(after, /실험을 설계하며 변인을 정리해 보자/, '2번(내용 기준) 제거');
  assert.match(after, /성찰/, '성찰 추가');
});

test('G4: --in-place 지정 시에만 원본을 덮어쓴다', { skip: !HAS_CSV }, async () => {
  const dir = await autoTmpDir('wsg-editip-');
  await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  const manifestPath = join(dir, 'science-광합성.manifest.json');
  const before = await readFile(manifestPath, 'utf8');

  const code = await run(
    ['edit', manifestPath, '3번 문항 빼줘', '--out', dir, '--no-render', '--in-place'],
    { root: ROOT, log: quiet, err: quiet },
  );
  assert.equal(code, 0);
  assert.notEqual(await readFile(manifestPath, 'utf8'), before, '--in-place: 원본 매니페스트 갱신');
  assert.ok(!existsSync(join(dir, 'science-광합성-v2.manifest.json')), '--in-place: -v2 미산출');
});

test('G4: 연속 편집은 v2 → v3 로 증가(기존 버전 덮어쓰지 않음)', { skip: !HAS_CSV }, async () => {
  const dir = await autoTmpDir('wsg-editv-');
  await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  const m1 = join(dir, 'science-광합성.manifest.json');
  await run(['edit', m1, '3번 문항 빼줘', '--out', dir, '--no-render'], { root: ROOT, log: quiet, err: quiet });
  const m2 = join(dir, 'science-광합성-v2.manifest.json');
  assert.ok(existsSync(m2), '1차 편집 → v2');
  await run(['edit', m2, '성찰 추가해줘', '--out', dir, '--no-render'], { root: ROOT, log: quiet, err: quiet });
  assert.ok(existsSync(join(dir, 'science-광합성-v3.manifest.json')), '2차 편집(v2 입력) → v3');
});
