import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { RunPipeline } from '../../src/usecases/RunPipeline.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function mockCurriculum(standards) {
  return { async search() { return standards; }, async resolve() { return null; } };
}

test('M3: RunPipeline 종단 구동(조회→조립→2벌→검수 게이트), Chrome 불필요', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [{ code: '[9과12-01]', text: '광합성 과정을 이해한다.', subject: '과학' }];
  const pipeline = new RunPipeline({ blockRepository: repo, curriculum: mockCurriculum(standards) });

  const r = await pipeline.execute({ grade: '중2', subject: '과학', topic: '광합성' });

  assert.equal(r.worksheet.pageCount(), 3);
  assert.ok(r.student && r.teacher, 'student/teacher 2벌 산출');
  assert.ok(!r.student.includes('MODE_TOKEN') && !r.teacher.includes('MODE_TOKEN'), '토큰 치환됨');
  assert.equal(r.gate, true, '깨끗한 생성물은 검수 게이트 PASS');
  assert.equal(r.review.student.ok, true);
  assert.equal(r.review.teacher.ok, true);
  assert.match(r.html, /광합성 과정을 이해한다/, '헤더 성취기준 원문');
});

test('M3: 검수 게이트는 student/teacher 두 벌 모두 검증(fail-closed 합성)', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [{ code: '[9과12-01]', text: '광합성 과정을 이해한다.', subject: '과학' }];
  const r = await new RunPipeline({ blockRepository: repo, curriculum: mockCurriculum(standards) })
    .execute({ grade: '중2', subject: '과학', topic: '광합성' });
  // gate 는 두 벌 ok 의 AND. 정답 누출 탐지 자체는 validate.test.js 의 픽스처가 보증.
  assert.equal(r.gate, r.review.student.ok && r.review.teacher.ok);
});
