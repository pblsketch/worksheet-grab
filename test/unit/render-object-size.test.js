import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { WIDTH_PCT_MIN, WIDTH_PCT_MAX } from '../../src/domain/schema/ObjectCatalog.js';

// 개체 크기·정렬 렌더(2026-07-28 — docs/DECISION-object-resize.md §2).
//
// **이 파일이 지키는 것은 R2-1(편집==인쇄) 하나다.**
// `.wg-obj` 래퍼는 원래 editMode 에서만 방출됐다(renderFlowObject). 크기를 그 래퍼에 얹으면서 방출
// 조건을 그대로 뒀다면 편집 렌더에만 폭이 들어가고 인쇄 렌더에는 빠져, 리플로우가 잰 높이와 실제
// 인쇄 높이가 갈린다 → 페이지 수가 조용히 어긋난다. 편집 전용 CSS 를 피하고도 같은 붕괴가 나는
// 더 은밀한 경로라 계약으로 못 박는다.
//
//   1) 크기 없는 개체 → 인쇄 출력이 종전과 **바이트 동일**(회귀 0)
//   2) 크기 있는 개체 → 편집·인쇄의 래퍼 style 이 **문자 그대로 동일**

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };
const r = new RenderObjectTree();

const docWith = (flow) => ({ pagination: 'paginated', pages: [{ flow, float: [] }] });
const render = (flow, opts) => r.execute(docWith(flow), ASSETS, {}, opts).html;

/** 개체 하나의 `.wg-obj` 래퍼 여는 태그만 뽑는다(없으면 null). */
function wrapperTag(html) {
  const m = /<div class="wg-obj"[^>]*>/.exec(html);
  return m ? m[0] : null;
}
/** 래퍼의 style 속성값만 뽑는다(없으면 null). */
function wrapperStyle(html) {
  const tag = wrapperTag(html);
  if (!tag) return null;
  const m = /style="([^"]*)"/.exec(tag);
  return m ? m[1] : null;
}

const table = (extra = {}) => ({
  id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]], ...extra,
});

// ── 1) 회귀 0 — 크기를 안 준 개체는 종전 출력 그대로 ──────────────────────────

test('크기 없는 개체: 인쇄 렌더에 래퍼가 생기지 않는다(종전 동작)', () => {
  const html = render([table()], { editMode: false });
  assert.equal(wrapperTag(html), null, '선언이 없으면 인쇄에 .wg-obj 래퍼를 만들지 않아야 함');
});

test('크기 없는 개체: 편집 렌더 래퍼가 종전과 동일(style 속성 없음)', () => {
  const html = render([table()], { editMode: true });
  assert.equal(wrapperTag(html), '<div class="wg-obj" data-oid="tb1" data-ot="table">');
});

test('align:left 는 선언을 만들지 않는다(기본값 — 출력이 미지정과 같아야 함)', () => {
  // left 에 margin-inline 을 굳이 방출하면 미지정 개체와 출력이 갈려 회귀 판정이 어려워진다.
  const bare = render([table()], { editMode: false });
  const left = render([table({ align: 'left' })], { editMode: false });
  assert.equal(left, bare, 'align:left 는 미지정과 바이트 동일해야 함');
});

// ── 2) R2-1 핵심 — 편집과 인쇄가 같은 선언을 갖는다 ───────────────────────────

test('R2-1: 크기를 준 개체는 편집·인쇄 래퍼 style 이 문자 그대로 같다', () => {
  const obj = table({ widthPct: 60, minHeightMm: 30, align: 'center' });
  const edit = wrapperStyle(render([obj], { editMode: true }));
  const print = wrapperStyle(render([obj], { editMode: false }));
  assert.ok(edit, '편집 렌더에 style 이 있어야 함');
  assert.equal(print, edit, '편집과 인쇄의 크기 선언이 갈리면 페이지 경계가 어긋난다');
});

test('R2-1: 인쇄 렌더에도 래퍼가 방출된다(선언이 있으면 editMode 무관)', () => {
  const html = render([table({ widthPct: 60 })], { editMode: false });
  const tag = wrapperTag(html);
  assert.ok(tag, '크기 선언이 있으면 인쇄에도 래퍼가 있어야 함(없으면 인쇄가 폭을 못 받는다)');
  assert.ok(!tag.includes('data-oid'), '인쇄 래퍼에는 편집용 data-oid 를 싣지 않는다');
  assert.match(tag, /style="[^"]*width:60%/);
});

// ── 3) 선언 형태 ────────────────────────────────────────────────────────────

test('단위: widthPct 는 %, minHeightMm 는 mm', () => {
  const style = wrapperStyle(render([table({ widthPct: 45, minHeightMm: 25 })], { editMode: false }));
  assert.match(style, /width:45%/);
  assert.match(style, /min-height:25mm/);
});

test('align: center/right 는 margin-inline 으로만 낸다(높이 무영향 = R2-1 무위험)', () => {
  const center = wrapperStyle(render([table({ widthPct: 50, align: 'center' })], { editMode: false }));
  const right = wrapperStyle(render([table({ widthPct: 50, align: 'right' })], { editMode: false }));
  assert.match(center, /margin-inline:auto;?/);
  assert.match(right, /margin-inline:auto 0/);
  for (const s of [center, right]) {
    assert.ok(!/height:|padding|top|bottom/.test(s.replace('min-height:', '')), `정렬이 수직 속성을 건드리면 안 됨: ${s}`);
  }
});

test('필드를 따로 줘도 각각 독립적으로 방출된다', () => {
  assert.match(wrapperStyle(render([table({ widthPct: 70 })], { editMode: false })), /^width:70%;$/);
  assert.match(wrapperStyle(render([table({ minHeightMm: 40 })], { editMode: false })), /^min-height:40mm;$/);
});

// ── 4) 방어 — 범위 밖 값은 선언을 생략하고 기본 동작으로 되돌린다 ──────────────

test('범위 밖·잘못된 값은 선언을 만들지 않는다(검증 안 거친 문서 방어)', () => {
  // 렌더는 마이그레이션 중간물처럼 validateObjectShape 를 안 거친 문서도 받는다. 인라인 style 로
  // 그대로 나가면 조판이 깨지므로, 통과 못 한 필드는 선언 자체를 생략해 기본값으로 되돌린다.
  const bad = [
    { widthPct: WIDTH_PCT_MAX + 1 }, { widthPct: WIDTH_PCT_MIN - 1 },
    { widthPct: '60' }, { widthPct: NaN }, { widthPct: Infinity },
    { minHeightMm: 0 }, { minHeightMm: -5 }, { minHeightMm: '30' },
    { align: 'middle' },
  ];
  for (const extra of bad) {
    const html = render([table(extra)], { editMode: false });
    assert.equal(wrapperTag(html), null, `범위 밖 값이 새어 나갔다: ${JSON.stringify(extra)}`);
  }
});

test('경계값은 방출된다 — widthPct 5·100', () => {
  for (const pct of [WIDTH_PCT_MIN, WIDTH_PCT_MAX]) {
    assert.match(wrapperStyle(render([table({ widthPct: pct })], { editMode: false })), new RegExp(`width:${pct}%`));
  }
});

// ── 5) 결정성 ───────────────────────────────────────────────────────────────

test('결정성: 크기를 준 문서도 2회 렌더가 바이트 동일', () => {
  const flow = [table({ widthPct: 60, minHeightMm: 30, align: 'center' })];
  assert.equal(render(flow, { editMode: false }), render(flow, { editMode: false }));
});
