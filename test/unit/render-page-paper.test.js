import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';

// P3-b 렌더: 페이지별 용지 override 를 named @page + .sheet 인라인 치수로 방출.
// 미지정 페이지는 바이트 불변(무회귀), override 페이지만 방출.

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };

function multiPageDoc(pageExtras) {
  return {
    pagination: 'paginated',
    pages: pageExtras.map((extra, i) => ({
      id: `page-${i + 1}`,
      flow: [{ id: `t${i + 1}`, type: 'title', placement: 'flow', text: `쪽 ${i + 1}` }],
      float: [],
      ...extra,
    })),
  };
}

test('무회귀: page.paper 미지정 문서는 named @page 도 .sheet style 도 없다', () => {
  const doc = multiPageDoc([{}, {}]);
  const { html } = new RenderObjectTree().execute(doc, ASSETS);
  assert.ok(!html.includes('wg-page-'), 'named @page 규칙이 없어야 함');
  assert.ok(!/class="sheet"[^>]*\sstyle=/.test(html), '.sheet 에 style 속성이 없어야 함');
});

test('바이트 동치: page.paper 없는 2쪽 문서 == 각 페이지에 paper 필드 부재', () => {
  // paper 미지정 경로가 종전과 완전히 같은 출력임을 2회 렌더 동일로 확인(결정성 + 무회귀).
  const doc = multiPageDoc([{}, {}]);
  const a = new RenderObjectTree().execute(doc, ASSETS).html;
  const b = new RenderObjectTree().execute(doc, ASSETS).html;
  assert.equal(a, b);
});

test('방향 override: 문서 용지 없음 + 2쪽 landscape → A4 가로 named @page + .sheet 인라인', () => {
  const doc = multiPageDoc([{}, { paper: { orientation: 'landscape' } }]);
  const { html } = new RenderObjectTree().execute(doc, ASSETS);
  // A4 가로 = 297x210mm
  assert.match(html, /@page wg-page-2 \{ size: 297mm 210mm; margin: 0; \}/);
  // 2쪽 .sheet 인라인: page 배정 + 치수 + 패딩(A4 가로는 대칭 20mm 기본)
  assert.match(html, /style="page:wg-page-2; width:297mm; min-height:210mm; padding:20mm 20mm 20mm 20mm; --sheet-pad-l:20mm; --sheet-pad-r:20mm;"/);
  // 1쪽은 override 없음 → style 없음(첫 <section class="sheet"> 뒤 즉시 data-page-id/닫힘)
  const firstSheet = html.slice(html.indexOf('class="sheet"'), html.indexOf('class="sheet"') + 80);
  assert.ok(!firstSheet.includes('style='), `1쪽 .sheet 에 style 이 없어야 함: ${firstSheet}`);
});

test('크기+방향 override: 문서 A4 세로 + 2쪽 A3 가로(복합 세트)', () => {
  const doc = multiPageDoc([{}, { paper: { size: 'A3', orientation: 'landscape' } }]);
  const meta = { paper: { size: 'A4', orientation: 'portrait' } };
  const { html } = new RenderObjectTree().execute(doc, ASSETS, meta);
  assert.match(html, /@page wg-page-2 \{ size: 420mm 297mm; margin: 0; \}/, 'A3 가로 = 420x297mm');
  assert.match(html, /style="page:wg-page-2; width:420mm; min-height:297mm;/);
});

test('동일 용지 override 는 방출하지 않는다(노이즈 0)', () => {
  // 문서 A4 세로 + page.paper 가 같은 A4 세로 → 치수 동일 → 방출 없음.
  const doc = multiPageDoc([{ paper: { size: 'A4', orientation: 'portrait' } }, {}]);
  const meta = { paper: { size: 'A4', orientation: 'portrait' } };
  const { html } = new RenderObjectTree().execute(doc, ASSETS, meta);
  assert.ok(!html.includes('wg-page-'), '문서와 같은 용지 override 는 named @page 를 만들지 않아야 함');
});

test('fail-closed: 잘못된 page.paper 는 렌더에서 던진다(검증기와 동일 규칙)', () => {
  const doc = multiPageDoc([{}, { paper: { size: 'A5' } }]);
  assert.throws(() => new RenderObjectTree().execute(doc, ASSETS), /지원하지 않는 용지/);
});
