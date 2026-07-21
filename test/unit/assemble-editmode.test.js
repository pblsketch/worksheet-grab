import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { RenderEditorShell } from '../../src/usecases/RenderEditorShell.js';

// E3 M1: editMode 블록 경계 래퍼 — opt-in, 기본 경로 바이트 불변.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function assembleSci(opts) {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const manifest = await repo.readManifest('sci');
  const { html } = await asm.execute(manifest, opts);
  return { html, manifest };
}

test('editMode 미지정/false 는 현행 산출과 바이트 동일(하위호환)', async () => {
  const { html: plain } = await assembleSci(undefined);
  const { html: explicitFalse } = await assembleSci({ editMode: false });
  assert.equal(explicitFalse, plain);
  assert.ok(!plain.includes('wg-block'), '기본 경로에 래퍼 무존재');
});

test('editMode=true: 블록 수만큼 래퍼, data-bp/bi/bt 정확', async () => {
  const { html, manifest } = await assembleSci({ editMode: true });
  const totalBlocks = manifest.pages.reduce((n, p) => n + p.length, 0);
  const wrappers = [...html.matchAll(/<div class="wg-block" data-bp="(\d+)" data-bi="(\d+)" data-bt="([^"]+)">/g)];
  assert.equal(wrappers.length, totalBlocks, '래퍼 수 = 전체 블록 수');
  // 첫 페이지 첫 블록: sci 는 header 타입
  assert.deepEqual([wrappers[0][1], wrappers[0][2], wrappers[0][3]], ['0', '0', 'header']);
  // 페이지별 블록 인덱스가 0 부터 순증가
  const page0 = wrappers.filter((w) => w[1] === '0').map((w) => Number(w[2]));
  assert.deepEqual(page0, page0.map((_, i) => i), '페이지 내 bi 연속');
});

test('RenderEditorShell: teacher 만 래퍼, student 는 clean 파생', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const manifest = await repo.readManifest('sci');
  const shell = new RenderEditorShell({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const r = await shell.execute({ manifest, docName: '문서' });
  assert.ok(r.teacherHtml.includes('wg-block'), 'teacher 캔버스 = 편집 모드');
  assert.ok(!r.studentHtml.includes('wg-block'), 'student 미리보기 = 무래퍼(무오염)');
  assert.equal(r.docName, '문서');
  assert.ok(!r.studentHtml.includes('전압이 커질수록 전류의 세기도'), 'student 정답 물리 부재 유지');
});
