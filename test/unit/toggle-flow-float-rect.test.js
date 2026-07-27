import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// nudge-float.test.js 와 동일 기법 — 브라우저 절대경로 import 만 file URL 로 치환해 **진짜 소스**의
// 순수 함수를 그대로 검증한다(복사본 테스트 금지).
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

const FALLBACK = { xMm: 20, yMm: 20, wMm: 60, hMm: 30 };

/** flow 개체 2개 + float 0개인 1쪽 문서. */
function makeDoc() {
  return {
    pagination: 'paginated',
    pages: [{
      id: 'p1',
      flow: [
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '문항' },
        { id: 't1', type: 'title', placement: 'flow', text: '제목' },
      ],
      float: [],
    }],
  };
}

test('toggleFlowFloat: 2인자 호출은 현행과 동일한 폴백 rect (하위호환)', async () => {
  const { toggleFlowFloat } = await loadObjectFactory();
  const next = toggleFlowFloat(makeDoc(), 'q1');
  const moved = next.pages[0].float[0];
  assert.equal(moved.id, 'q1');
  assert.equal(moved.placement, 'float');
  assert.deepEqual(moved.rect, FALLBACK);
});

test('toggleFlowFloat: 유효 rect 를 주면 그대로 반영하고 w/h 는 10mm 하한 클램프', async () => {
  const { toggleFlowFloat } = await loadObjectFactory();

  const exact = toggleFlowFloat(makeDoc(), 'q1', { xMm: 15, yMm: 42.5, wMm: 180, hMm: 23.4 });
  assert.deepEqual(exact.pages[0].float[0].rect, { xMm: 15, yMm: 42.5, wMm: 180, hMm: 23.4 });

  // 실측이 아주 얇은 개체(구분선 등)여도 잡을 수 있어야 한다 — x/y 는 클램프하지 않는다.
  const thin = toggleFlowFloat(makeDoc(), 'q1', { xMm: -3, yMm: 0, wMm: 2, hMm: 0.4 });
  assert.deepEqual(thin.pages[0].float[0].rect, { xMm: -3, yMm: 0, wMm: 10, hMm: 10 });
});

test('toggleFlowFloat: 무효 rect(NaN·부분·타입불일치·null)는 전부 폴백 — 스키마 위반 rect 진입 경로 없음', async () => {
  const { toggleFlowFloat } = await loadObjectFactory();
  const bad = [
    null,
    undefined,
    {},
    { xMm: 1 },                                       // 부분 rect
    { xMm: NaN, yMm: 0, wMm: 10, hMm: 10 },           // NaN
    { xMm: Infinity, yMm: 0, wMm: 10, hMm: 10 },      // 비유한
    { xMm: '15', yMm: 0, wMm: 10, hMm: 10 },          // 문자열
    { xMm: 0, yMm: 0, wMm: 10 },                      // hMm 누락
  ];
  for (const rect of bad) {
    const next = toggleFlowFloat(makeDoc(), 'q1', rect);
    assert.deepEqual(next.pages[0].float[0].rect, FALLBACK, `무효 입력이 폴백으로 안 떨어짐: ${JSON.stringify(rect)}`);
  }
});

test('toggleFlowFloat: 강등(float→flow)은 measuredRect 를 무시하고 rect 를 삭제한다 (원칙 3 계약)', async () => {
  const { toggleFlowFloat } = await loadObjectFactory();
  const doc = {
    pagination: 'paginated',
    pages: [{
      id: 'p1',
      flow: [{ id: 't1', type: 'title', placement: 'flow', text: '제목' }],
      float: [{ id: 'f1', type: 'richtext', placement: 'float', html: '<p>x</p>', rect: { xMm: 5, yMm: 5, wMm: 50, hMm: 20 } }],
    }],
  };
  // 호출부가 실수로 rect 를 넘겨도 순수 함수가 막아야 한다 — flow 개체는 rect 를 가질 수 없다.
  const next = toggleFlowFloat(doc, 'f1', { xMm: 99, yMm: 99, wMm: 99, hMm: 99 });
  const demoted = next.pages[0].flow.find((o) => o.id === 'f1');
  assert.ok(demoted, '강등된 개체가 flow 버킷에 있어야 한다');
  assert.equal(demoted.placement, 'flow');
  assert.equal('rect' in demoted, false, 'flow 개체에 rect 가 남으면 스키마 위반(원칙 3)');
  assert.equal(next.pages[0].float.length, 0);
});

test('toggleFlowFloat: 순수 — 원본 문서 불변 + 같은 페이지 유지', async () => {
  const { toggleFlowFloat } = await loadObjectFactory();
  const doc = makeDoc();
  const snapshot = JSON.parse(JSON.stringify(doc));
  const next = toggleFlowFloat(doc, 'q1', { xMm: 1, yMm: 2, wMm: 30, hMm: 40 });

  assert.deepEqual(doc, snapshot, '입력 문서가 변이됐다(순수성 위반)');
  assert.notEqual(next, doc);
  assert.equal(next.pages.length, 1, '페이지 수 불변');
  assert.equal(next.pages[0].flow.length, 1, 'flow 에서 하나 빠짐');
  assert.equal(next.pages[0].float.length, 1, 'float 로 하나 들어옴');
  assert.equal(next.pages[0].id, 'p1', '같은 페이지에 남는다');
});

test('toggleFlowFloat: flow 전용 타입은 3번째 인자를 줘도 무변경', async () => {
  const { toggleFlowFloat } = await loadObjectFactory();
  const rect = { xMm: 10, yMm: 10, wMm: 50, hMm: 50 };
  for (const obj of [
    { id: 'x', type: 'title', placement: 'flow', text: '제목' },
    { id: 'x', type: 'std-box', placement: 'flow' },
    { id: 'x', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 슬롯］' },
  ]) {
    const doc = { pagination: 'paginated', pages: [{ id: 'p1', flow: [obj], float: [] }] };
    const next = toggleFlowFloat(doc, 'x', rect);
    assert.equal(next.pages[0].float.length, 0, `${obj.type} 이 float 로 넘어갔다`);
    assert.equal(next.pages[0].flow[0].placement, 'flow');
    assert.equal('rect' in next.pages[0].flow[0], false, `${obj.type} 에 rect 가 실렸다`);
  }
});

test('createObject: 폴백 rect 가 toggleFlowFloat 와 같은 단일 출처를 쓴다', async () => {
  const { createObject } = await loadObjectFactory();
  // 승격과 삽입이 서로 다른 기본 위치를 쓰면 "왜 여긴 다르지"가 된다 — 같은 상수를 공유해야 한다.
  assert.deepEqual(createObject('richtext', { placement: 'float' }).rect, FALLBACK);
  assert.deepEqual(createObject('richtext', { placement: 'float', rect: { xMm: 1, yMm: 2, wMm: 3, hMm: 4 } }).rect,
    { xMm: 1, yMm: 2, wMm: 3, hMm: 4 }, 'createObject 의 명시 rect 경로는 종전대로 그대로 통과');
});
