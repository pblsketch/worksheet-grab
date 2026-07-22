import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

// AssembleWorksheet × paper 주입 통합: manifest.paper 유무에 따른 두 경로.
// Chrome 불필요(HTML 문자열 단정).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function assemble(mutate, opts) {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const manifest = await repo.readManifest('sci');
  if (mutate) mutate(manifest);
  const { html } = await asm.execute(manifest, opts);
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

// ── F2 다단(columns) 주입/래핑 ─────────────────────────────────────────

test('columns:2 → .sheet-body 래퍼 + --sheet-cols:2 방출', async () => {
  const html = await assemble((m) => { m.paper = { size: 'B4', orientation: 'portrait', columns: 2 }; });
  assert.ok(html.includes('<div class="sheet-body">'), '본문이 .sheet-body 로 래핑');
  assert.ok(html.includes('--sheet-cols: 2;'), '열 수 변수 방출');
  assert.ok(html.includes('--sheet-colgap: 8mm;'), '열 간격 변수 방출');
  // 크롬(run-head/foot/mode-badge)은 .sheet 직속 유지 — .sheet-body 밖.
  assert.match(html, /<span class="mode-badge"><\/span>\s*\n\s*<div class="run-head">/, 'mode-badge·run-head 는 래퍼 밖 .sheet 직속');
  assert.ok(html.includes('<div class="run-foot">'), 'run-foot 존재(래퍼 밖)');
});

test('columns 미지정/1 → .sheet-body 래퍼 무·--sheet-cols 선언 무(바이트 불변)', async () => {
  // 주의: assets/paper.css 는 항상 인라인되므로 '.sheet-body' 선택자·'var(--sheet-cols, 1)'
  // 문자열은 상존한다. 방출 여부는 래퍼 요소(<div class="sheet-body">)와 선언(--sheet-cols:)로 판정.
  const none = await assemble(null);
  assert.ok(!none.includes('<div class="sheet-body">'), 'paper 미지정: 래퍼 요소 부재');
  assert.ok(!none.includes('--sheet-cols:'), 'columns 변수 선언 부재(var 사용부와 구분)');

  // columns:1 명시는 columns 키 생략과 정확히 같은 바이트(무-op)여야 한다.
  const b4plain = await assemble((m) => { m.paper = { size: 'B4', orientation: 'portrait' }; });
  const b4col1 = await assemble((m) => { m.paper = { size: 'B4', orientation: 'portrait', columns: 1 }; });
  assert.equal(b4col1, b4plain, 'columns:1 = columns 생략과 바이트 동일');
  assert.ok(!b4plain.includes('<div class="sheet-body">'), 'columns<=1 은 래퍼 미방출');
});

test('editMode + columns:2 → .wg-block 이 .sheet-body 내부에 위치', async () => {
  const html = await assemble((m) => { m.paper = { size: 'B4', orientation: 'portrait', columns: 2 }; }, { editMode: true });
  assert.ok(html.includes('<div class="sheet-body">'), '.sheet-body 래퍼 존재');
  // .sheet-body 개시 뒤 첫 요소가 .wg-block 인지(래퍼 내부 배치) 확인.
  assert.match(html, /<div class="sheet-body">\s*\n\s*<div class="wg-block"/, '.wg-block 은 .sheet-body 내부');
});

test('assets/paper.css: .sheet-body 가 --sheet-cols 소비 + column-fill:auto 선언', async () => {
  const css = await readFile(resolve(ROOT, 'assets/paper.css'), 'utf8');
  assert.match(css, /\.sheet-body\s*\{[^}]*column-count:\s*var\(--sheet-cols,\s*1\)/, 'column-count 가 --sheet-cols 소비(폴백 1)');
  assert.match(css, /\.sheet-body\s*\{[^}]*column-gap:\s*var\(--sheet-colgap/, 'column-gap 가 --sheet-colgap 소비');
  assert.match(css, /\.sheet-body\s*\{[^}]*column-fill:\s*auto/, 'column-fill:auto(신문식 순차 채움 — 좌우 반토막 방지)');
  assert.match(css, /\.sheet-body\s*>\s*\*\s*\{[^}]*break-inside:\s*avoid/, '블록 열 경계 잘림 방지');
});
