import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GenerateWorksheet } from '../../src/usecases/GenerateWorksheet.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function mockCurriculum(standards) {
  return {
    async search() { return standards; },
    async resolve() { return null; }, // standardsText 폴백으로 재조립
  };
}

// US-M4-1: generate 가 산출하는 manifest 는 재편집·재조립 가능한 아티팩트여야 한다.
// 근거: JSON 직렬화 → 재파싱 → assemble → 원 HTML 과 바이트 동일(왕복).
test('US-M4-1: manifest JSON 왕복 → assemble 이 원 HTML 을 동일 재현', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [
    { code: '[9과12-01]', text: '광합성 과정을 이해하고 관계를 탐구한다.', subject: '과학' },
  ];
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum(standards) });
  const { html, manifest } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });

  // 매니페스트는 순수 데이터(직렬화 가능)여야 한다.
  const json = JSON.stringify(manifest, null, 2);
  const reparsed = JSON.parse(json);

  // 저장된 매니페스트만으로(같은 커리큘럼 폴백) 재조립하면 동일 HTML.
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: mockCurriculum(standards) });
  const { html: rebuilt } = await asm.execute(reparsed);

  assert.equal(rebuilt, html, 'manifest 왕복 재조립 = 원 HTML');
});

test('US-M4-1: manifest 는 재편집에 필요한 필드(pages/standards/theme/docTitle)를 보존', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [{ code: '[9과12-01]', text: '광합성.', subject: '과학' }];
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum(standards) });
  const { manifest } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });

  assert.ok(Array.isArray(manifest.pages) && manifest.pages.length === 3, '3쪽 페이지 배열');
  assert.ok(manifest.pages.every((p) => Array.isArray(p)), '각 페이지는 블록 배열');
  assert.deepEqual(manifest.standards, ['[9과12-01]']);
  assert.equal(manifest.theme, 'sci');
  assert.equal(manifest.docTitle, '광합성');
  // 인라인 블록은 재조립을 위해 html 문자열을 보존(외부 파일 의존 없이 왕복).
  const flat = manifest.pages.flat();
  assert.ok(flat.some((b) => typeof b.html === 'string'), '인라인 html 블록 보존');
});
