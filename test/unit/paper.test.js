import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPER_SIZES, DEFAULT_A4_MARGINS,
  resolvePaper, paperDims, paperMargins, paperCss, paperToPx, paperToPt, paperMarginMinMm,
} from '../../src/usecases/paper.js';

test('PAPER_SIZES: A4/A3/B4(JIS) 치수', () => {
  assert.deepEqual(PAPER_SIZES.A4, { w: 210, h: 297 });
  assert.deepEqual(PAPER_SIZES.A3, { w: 297, h: 420 });
  assert.deepEqual(PAPER_SIZES.B4, { w: 257, h: 364 }); // JIS — ISO(250×353) 아님
});

test('resolvePaper: 미지정 → null (주입 없음 = 현행 기본)', () => {
  assert.equal(resolvePaper(null), null);
  assert.equal(resolvePaper(undefined), null);
});

test('resolvePaper: A4 portrait 기본 margins 는 현행 비대칭(20mm 아님)', () => {
  const r = resolvePaper({ size: 'A4' });
  assert.deepEqual(r, { size: 'A4', orientation: 'portrait', margins: DEFAULT_A4_MARGINS, columns: 1 });
  assert.equal(r.margins, '12mm 15mm 10mm 15mm');
});

test('resolvePaper: 소문자 size·명시 margins·columns 정규화', () => {
  const r = resolvePaper({ size: 'b4', orientation: 'portrait', margins: '20mm', columns: 2 });
  assert.deepEqual(r, { size: 'B4', orientation: 'portrait', margins: '20mm', columns: 2 });
});

test('resolvePaper: 잘못된 입력은 fail-closed', () => {
  assert.throws(() => resolvePaper({ size: 'letter' }), /지원하지 않는 용지/);
  assert.throws(() => resolvePaper({ size: 'A4', orientation: 'wide' }), /orientation/);
  assert.throws(() => resolvePaper({ size: 'A4', margins: '12px' }), /mm 단위/);
  assert.throws(() => resolvePaper({ size: 'A4', columns: 0 }), /columns/);
});

test('paperDims: landscape 는 장·단변 swap', () => {
  assert.deepEqual(paperDims(resolvePaper({ size: 'A3', orientation: 'landscape' })), { w: 420, h: 297 });
  assert.deepEqual(paperDims(resolvePaper({ size: 'A3' })), { w: 297, h: 420 });
});

test('paperMargins: shorthand 1·2·3·4값 파싱', () => {
  assert.deepEqual(paperMargins(resolvePaper({ size: 'A4', margins: '20mm' })),
    { top: 20, right: 20, bottom: 20, left: 20 });
  assert.deepEqual(paperMargins(resolvePaper({ size: 'A4', margins: '10mm 15mm' })),
    { top: 10, right: 15, bottom: 10, left: 15 });
  assert.deepEqual(paperMargins(resolvePaper({ size: 'A4' })),
    { top: 12, right: 15, bottom: 10, left: 15 });
});

test('paperCss: null → 빈 문자열(주입 0)', () => {
  assert.equal(paperCss(null), '');
});

test('paperCss: @page 는 숫자 mm 리터럴, :root 변수 emit, --sheet-cols 미emit', () => {
  const css = paperCss(resolvePaper({ size: 'A3', orientation: 'landscape' }));
  assert.ok(css.includes('@page { size: 420mm 297mm; margin: 0; }'), '@page 숫자 리터럴(swap 반영)');
  assert.ok(css.includes('--sheet-w: 420mm;'));
  assert.ok(css.includes('--sheet-h: 297mm;'));
  assert.ok(css.includes('--sheet-pad: 20mm 20mm 20mm 20mm;'), '비A4 기본 여백 20mm');
  assert.ok(css.includes('--sheet-pad-l: 20mm;'));
  assert.ok(css.includes('--sheet-pad-r: 20mm;'));
  assert.ok(!css.includes('--sheet-cols'), 'columns 는 스키마 저장까지만(소비 CSS 없는 var 금지)');
  assert.ok(!/size:\s*(A3|A4|B4)/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'named 키워드 금지');
});

test('paperCss: B4(JIS) 세로 = 257mm 364mm', () => {
  const css = paperCss(resolvePaper({ size: 'B4' }));
  assert.ok(css.includes('@page { size: 257mm 364mm; margin: 0; }'));
});

test('paperCss: columns>1 → --sheet-cols/--sheet-colgap 방출(.sheet-body 가 소비)', () => {
  const css = paperCss(resolvePaper({ size: 'B4', orientation: 'portrait', columns: 2 }));
  assert.ok(css.includes('--sheet-cols: 2;'), 'columns 값 그대로 방출');
  assert.ok(css.includes('--sheet-colgap: 8mm;'), '적정 기본 열 간격 방출');
  // 다른 용지 파라미터는 그대로(치수·여백)
  assert.ok(css.includes('@page { size: 257mm 364mm; margin: 0; }'));
  assert.ok(css.includes('--sheet-w: 257mm;'));
});

test('paperCss: columns 미지정/1 → --sheet-cols 미방출(바이트 불변)', () => {
  const none = paperCss(resolvePaper({ size: 'B4' })); // columns 기본 1
  const one = paperCss(resolvePaper({ size: 'B4', columns: 1 }));
  assert.ok(!none.includes('--sheet-cols'), 'columns 기본(1)은 미방출');
  assert.ok(!none.includes('--sheet-colgap'), 'colgap 도 미방출');
  assert.equal(one, none, 'columns:1 명시 = 미지정과 바이트 동일(무-op)');
});

test('paperCss: column-fill 은 정적 paper.css 소관(paperCss 는 var 만 방출)', () => {
  const css = paperCss(resolvePaper({ size: 'B4', columns: 2 }));
  assert.ok(!css.includes('column-fill'), 'column-fill 규칙은 assets/paper.css 에서 선언');
});

test('paperToPx: 96dpi 픽셀 치수', () => {
  assert.deepEqual(paperToPx(resolvePaper({ size: 'A4' })), { width: 794, height: 1123 }); // 현행 하드코딩값과 일치
  // 297mm = 1122.52px → round 1123 (A4 세로폭과 동일 값 — 현행 A4 height 하드코딩과 일관)
  assert.deepEqual(paperToPx(resolvePaper({ size: 'A3', orientation: 'landscape' })), { width: 1587, height: 1123 });
});

test('paperToPt: MediaBox 기대치(pt)', () => {
  const a4 = paperToPt(resolvePaper({ size: 'A4' }));
  assert.ok(Math.abs(a4.w - 595.3) < 0.1 && Math.abs(a4.h - 841.9) < 0.1);
  const a3l = paperToPt(resolvePaper({ size: 'A3', orientation: 'landscape' }));
  assert.ok(Math.abs(a3l.w - 1190.6) < 0.1 && Math.abs(a3l.h - 841.9) < 0.1);
  const b4 = paperToPt(resolvePaper({ size: 'B4' }));
  assert.ok(Math.abs(b4.w - 728.5) < 0.1 && Math.abs(b4.h - 1031.8) < 0.1);
});

test('paperMarginMinMm: 4방향 최소', () => {
  assert.equal(paperMarginMinMm(resolvePaper({ size: 'A4' })), 10);
  assert.equal(paperMarginMinMm(resolvePaper({ size: 'A4', margins: '5mm 15mm 10mm 15mm' })), 5);
});
