import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marqueeHitOids } from '../../src/editor/marqueeHits.js';

// M1(영역 드래그로 잡기) — 마퀴가 flow(.wg-obj) 개체까지 잡는지 순수 판정으로 고정한다.
// 종전엔 finishMarquee 가 .wg-float 만 훑어 활동지 본문(제목·문항·지문·표=flow)이 영역선택에서
// 통째로 누락됐다. 실마우스가 필요한 시작/캡처 경로는 render 스위트(editor-select) 소관이고,
// 여기서는 "무엇을 잡는가"의 회귀 표면을 Chrome 없이 결정론적으로 못박는다.

const R = (left, top, right, bottom) => ({ left, top, right, bottom });

test('flow(.wg-obj)·float 둘 다 교차분을 잡는다 — flow 포함이 M1 핵심', () => {
  const objects = [
    { oid: 'title', rect: R(10, 10, 200, 40) },   // flow — 박스와 겹침
    { oid: 'q1', rect: R(10, 50, 200, 90) },       // flow — 겹침
    { oid: 'far', rect: R(10, 500, 200, 540) },    // 박스 밖
    { oid: 'fl1', rect: R(150, 20, 260, 120) },    // float — 겹침
  ];
  const hits = marqueeHitOids(objects, R(0, 0, 220, 100));
  assert.deepEqual(hits, ['title', 'q1', 'fl1'], 'flow 2개 + float 1개가 잡히고 밖의 것은 제외');
});

test('경계 접촉(edge touch)은 겹침이 아니다 — 기존 float 판정과 문자 동일', () => {
  const objects = [{ oid: 'a', rect: R(100, 0, 200, 50) }];
  // 박스 오른변(right=100)이 a 의 왼변(left=100)과 정확히 맞닿음 → 선택 안 됨
  assert.deepEqual(marqueeHitOids(objects, R(0, 0, 100, 50)), [], '변이 맞닿기만 하면 미선택');
  // 1px 이라도 겹치면 선택
  assert.deepEqual(marqueeHitOids(objects, R(0, 0, 101, 50)), ['a'], '1px 겹침이면 선택');
});

test('중복 oid 제거·등장 순서 보존·불량 입력 안전', () => {
  const objects = [
    { oid: 'x', rect: R(0, 0, 10, 10) },
    { oid: 'x', rect: R(0, 0, 10, 10) },  // 같은 oid 중복(있을 수 없지만 방어)
    null,                                  // 불량 항목 skip
    { oid: 'y' },                          // rect 누락 skip
  ];
  assert.deepEqual(marqueeHitOids(objects, R(0, 0, 5, 5)), ['x'], '중복 제거 후 하나');
  assert.deepEqual(marqueeHitOids([], R(0, 0, 5, 5)), [], '빈 배열 안전');
  assert.deepEqual(marqueeHitOids(undefined, R(0, 0, 5, 5)), [], 'undefined 안전');
});
