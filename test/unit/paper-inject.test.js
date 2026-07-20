import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

// AssembleWorksheet × paper 주입 통합: manifest.paper 유무에 따른 두 경로.
// Chrome 불필요(HTML 문자열 단정).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function assemble(mutate) {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const manifest = await repo.readManifest('sci');
  if (mutate) mutate(manifest);
  const { html } = await asm.execute(manifest);
  return html;
}

test('paper 미지정: 오버라이드 스니펫 부재(주입 0)', async () => {
  const html = await assemble(null);
  assert.ok(!html.includes('용지 오버라이드'), '스니펫 헤더 부재');
  assert.ok(!html.includes('--sheet-w:'), ':root 변수 주입 부재');
  assert.ok(html.includes('@page { size: A4; margin: 0; }'), 'paper.css 기본 @page 만 존재');
});

test('paper A3 landscape: @page 숫자 리터럴 + :root 변수가 paper.css 뒤에 주입', async () => {
  const html = await assemble((m) => { m.paper = { size: 'A3', orientation: 'landscape' }; });
  assert.ok(html.includes('@page { size: 420mm 297mm; margin: 0; }'), 'swap 반영 숫자 리터럴');
  assert.ok(html.includes('--sheet-w: 420mm;'));
  assert.ok(html.includes('--sheet-h: 297mm;'));
  // 캐스케이드 순서: 기본 @page(A4) 가 먼저, 오버라이드가 나중이어야 이긴다.
  assert.ok(html.indexOf('@page { size: A4; margin: 0; }') < html.indexOf('@page { size: 420mm 297mm; margin: 0; }'));
});

test('paper:{size:A4} 는 스니펫 외 산출 동일(등가 렌더의 HTML 수준 증명)', async () => {
  const plain = await assemble(null);
  const withA4 = await assemble((m) => { m.paper = { size: 'A4' }; });
  // 오버라이드 스니펫(주입 1블록)을 걷어내면 paper-absent 산출과 정확히 같아야 한다.
  const stripped = withA4.replace(/\n\/\* ===== 용지 오버라이드[\s\S]*?\n\}/, '');
  assert.equal(stripped, plain, 'A4+paper = paper-absent + 스니펫 (그 외 바이트 동일)');
  // 주입값 자체도 폴백과 동일 계약(등가성 테스트가 별도 강제) — 여기서는 값 존재만 확인.
  assert.ok(withA4.includes('--sheet-pad: 12mm 15mm 10mm 15mm;'), 'A4 기본 여백은 현행 비대칭');
});
