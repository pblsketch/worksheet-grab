import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { RenderEditorShell } from '../../src/usecases/RenderEditorShell.js';

// E2 셸 합성(순수): 2벌 분기·정답 물리부재·canvasMeta 파생·여백선 무주입.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function shellFor(mutate) {
  const repo = new FsBlockRepository({ root: ROOT });
  const manifest = await repo.readManifest('sci');
  if (mutate) mutate(manifest);
  const shell = new RenderEditorShell({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  return shell.execute({ manifest, knownSubjectHexes: ['#00838f'] });
}

test('2벌 분기: teacher 에 정답·data-mode, student 에 정답 물리 부재', async () => {
  const r = await shellFor(null);
  assert.ok(r.teacherHtml.includes('data-mode="teacher"'));
  assert.ok(r.studentHtml.includes('data-mode="student"'));
  assert.ok(r.teacherHtml.includes('전압이 커질수록 전류의 세기도'), 'teacher 정답 존재');
  assert.ok(!r.studentHtml.includes('전압이 커질수록 전류의 세기도'), 'student 정답 물리 제거');
});

test('canvasMeta: paper 미지정 → A4 기본(794×1123, 현행 비대칭 여백)', async () => {
  const r = await shellFor(null);
  assert.equal(r.canvasMeta.paper.size, 'A4');
  assert.deepEqual(r.canvasMeta.dims, { width: 794, height: 1123 });
  assert.deepEqual(r.canvasMeta.margins, { top: 12, right: 15, bottom: 10, left: 15 });
  assert.equal(r.validationSeed.paper, null, 'validate 시드는 manifest 원형(주입 0 규약) 유지');
});

test('canvasMeta: paper 지정 시 해당 용지 파생(A3 가로)', async () => {
  const r = await shellFor((m) => { m.paper = { size: 'A3', orientation: 'landscape' }; });
  assert.equal(r.canvasMeta.paper.orientation, 'landscape');
  assert.deepEqual(r.canvasMeta.dims, { width: 1587, height: 1123 });
  assert.deepEqual(r.validationSeed.paper, { size: 'A3', orientation: 'landscape' });
});

test('여백선 마크업은 두 HTML 어디에도 주입되지 않는다(부모 오버레이 소관)', async () => {
  const r = await shellFor(null);
  for (const html of [r.teacherHtml, r.studentHtml]) {
    assert.ok(!/margin-guide|여백선|guide-overlay/.test(html), '조립본 원형 무오염');
  }
});
