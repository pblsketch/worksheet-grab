import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePagePaper, resolvePaper } from '../../src/usecases/paper.js';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';
import { normalizePageIdentity, computePageVersion } from '../../src/domain/schema/PageIdentity.js';
import { OBJECT_TYPES } from '../../src/domain/schema/ObjectCatalog.js';

// P3-b 데이터 모델: 페이지별 용지 override(page.paper) — 문서 용지 위 병합 해석.
// 개체 카탈로그·트리 노드 스키마는 무변경(페이지 메타일 뿐)임을 함께 단정한다.

test('resolvePagePaper: 둘 다 미지정이면 null(현행 A4 기본, 주입 0)', () => {
  assert.equal(resolvePagePaper(null, null), null);
  assert.equal(resolvePagePaper(undefined, undefined), null);
});

test('resolvePagePaper: 페이지 미지정이면 문서 용지를 그대로 상속', () => {
  const doc = { size: 'B4', orientation: 'portrait' };
  assert.deepEqual(resolvePagePaper(doc, null), resolvePaper(doc));
});

test('resolvePagePaper: 방향만 override 하면 문서 크기·여백은 유지되고 방향만 뒤집힌다', () => {
  // 문서 B4 세로 위에 page.paper={orientation:landscape} → B4 가로(크기 상속).
  const r = resolvePagePaper({ size: 'B4', orientation: 'portrait' }, { orientation: 'landscape' });
  assert.equal(r.size, 'B4');
  assert.equal(r.orientation, 'landscape');
});

test('resolvePagePaper: 문서 용지 없어도 페이지 override 로 해석(A4 기본 위 병합)', () => {
  // document.paper 미지정 + page.paper={orientation:landscape} → A4 가로.
  const r = resolvePagePaper(null, { orientation: 'landscape' });
  assert.equal(r.size, 'A4');
  assert.equal(r.orientation, 'landscape');
});

test('resolvePagePaper: 크기+방향 전체 override(복합 세트 — A3 가로)', () => {
  const r = resolvePagePaper({ size: 'A4', orientation: 'portrait' }, { size: 'A3', orientation: 'landscape' });
  assert.equal(r.size, 'A3');
  assert.equal(r.orientation, 'landscape');
});

test('resolvePagePaper: fail-closed — 지원 밖 용지/방향/타입은 던진다', () => {
  assert.throws(() => resolvePagePaper(null, { size: 'A5' }), /지원하지 않는 용지/);
  assert.throws(() => resolvePagePaper(null, { orientation: 'diagonal' }), /orientation/);
  assert.throws(() => resolvePagePaper(null, [1, 2]), /객체/);
});

function docWith(pageExtra) {
  return {
    pagination: 'scaffold',
    paper: { size: 'A4', orientation: 'portrait' },
    pages: [{ id: 'page-1', flow: [], float: [], ...pageExtra }],
  };
}

test('ValidateObjectTree: 유효한 page.paper 는 통과(ok)', () => {
  const res = new ValidateObjectTree().execute(docWith({ paper: { orientation: 'landscape' } }));
  assert.equal(res.ok, true, JSON.stringify(res.findings));
});

test('ValidateObjectTree: page.paper=null 은 허용(명시적 상속)', () => {
  const res = new ValidateObjectTree().execute(docWith({ paper: null }));
  assert.equal(res.ok, true, JSON.stringify(res.findings));
});

test('ValidateObjectTree: 잘못된 page.paper 는 fail-closed(invalid-page-paper)', () => {
  const bad = new ValidateObjectTree().execute(docWith({ paper: { size: 'A5' } }));
  assert.equal(bad.ok, false);
  assert.ok(bad.findings.some((f) => f.rule === 'invalid-page-paper'));

  const badType = new ValidateObjectTree().execute(docWith({ paper: 'A4' }));
  assert.equal(badType.ok, false);
  assert.ok(badType.findings.some((f) => f.rule === 'invalid-page-paper'));
});

test('ValidateObjectTree: page.paper 미지정 문서는 현행과 동치(무회귀)', () => {
  const res = new ValidateObjectTree().execute(docWith({}));
  assert.equal(res.ok, true);
  assert.ok(!res.findings.some((f) => f.rule === 'invalid-page-paper'));
});

test('normalizePageIdentity: page.paper 를 스트립하지 않고 보존한다', () => {
  const doc = { pages: [{ id: 'page-1', paper: { orientation: 'landscape' }, flow: [], float: [] }] };
  const out = normalizePageIdentity(doc);
  assert.deepEqual(out.pages[0].paper, { orientation: 'landscape' });
});

test('computePageVersion: page.paper 변경이 페이지 지문에 반영(낙관적 동시성)', () => {
  const a = computePageVersion({ id: 'page-1', flow: [], float: [] });
  const b = computePageVersion({ id: 'page-1', paper: { orientation: 'landscape' }, flow: [], float: [] });
  assert.notEqual(a, b);
});

// ── AC-P3-4: flow 전용 초판 — 방향/크기 다른 페이지 + float 개체 차단 ──

const floatObj = { id: 'f1', type: 'shape', placement: 'float', rect: { xMm: 10, yMm: 10, wMm: 20, hMm: 5 }, shapeKind: 'rect' };

test('AC-P3-4: 방향 다른 페이지에 float 개체가 있으면 차단(page-orientation-float-unsupported)', () => {
  const doc = {
    pagination: 'scaffold', paper: { size: 'A4', orientation: 'portrait' },
    pages: [{ id: 'page-1', paper: { orientation: 'landscape' }, flow: [], float: [floatObj] }],
  };
  const res = new ValidateObjectTree().execute(doc);
  assert.equal(res.ok, false);
  assert.ok(res.findings.some((f) => f.rule === 'page-orientation-float-unsupported'));
});

test('AC-P3-4: 방향 다른 페이지도 flow 전용이면 통과(float 없음)', () => {
  const doc = {
    pagination: 'scaffold', paper: { size: 'A4', orientation: 'portrait' },
    pages: [{ id: 'page-1', paper: { orientation: 'landscape' }, flow: [], float: [] }],
  };
  const res = new ValidateObjectTree().execute(doc);
  assert.equal(res.ok, true, JSON.stringify(res.findings));
});

test('AC-P3-4: 문서와 같은 용지 override + float 은 허용(방향 혼합 아님 — 거짓양성 방지)', () => {
  const doc = {
    pagination: 'scaffold', paper: { size: 'A4', orientation: 'portrait' },
    pages: [{ id: 'page-1', paper: { size: 'A4', orientation: 'portrait' }, flow: [], float: [floatObj] }],
  };
  const res = new ValidateObjectTree().execute(doc);
  assert.ok(!res.findings.some((f) => f.rule === 'page-orientation-float-unsupported'));
});

test('AC-P3-4: override 없는 페이지의 float 은 종전대로 허용(무회귀)', () => {
  const doc = {
    pagination: 'scaffold', paper: { size: 'A4', orientation: 'portrait' },
    pages: [{ id: 'page-1', flow: [], float: [floatObj] }],
  };
  const res = new ValidateObjectTree().execute(doc);
  assert.ok(!res.findings.some((f) => f.rule === 'page-orientation-float-unsupported'));
});

// ── AC-P3-5: 닫힌 개체 카탈로그 무변경 + AI 좌표 미생성 ──

test('AC-P3-5: 닫힌 개체 카탈로그가 14종 그대로(P3 가 새 개체 타입을 추가하지 않음)', () => {
  assert.equal(OBJECT_TYPES.length, 14, `카탈로그는 14종이어야 함(현재 ${OBJECT_TYPES.length}): ${OBJECT_TYPES.join(',')}`);
});

test('AC-P3-5: page.paper 는 페이지 메타일 뿐 — rect/좌표 필드를 갖지 않는다(AI 좌표 미생성)', () => {
  const r = resolvePagePaper({ size: 'A4' }, { orientation: 'landscape' });
  assert.deepEqual(Object.keys(r).sort(), ['columns', 'margins', 'orientation', 'size']);
  assert.ok(!('rect' in r) && !('xMm' in r) && !('yMm' in r));
});
