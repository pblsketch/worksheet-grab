import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateObjectShape, checkExportGate, OBJECT_TYPES } from '../../src/domain/schema/index.js';

// S1.1 수용 기준(06_plan_final.md 132행): 각 타입 최소 픽스처 통과 / 미지정 타입 거부 /
// 좌표(rect) 있는 AI 생성 개체 거부(placement:'flow'에 rect 금지) / scaffold export 거부·paginated 허용 계약.

const MIN_FIXTURES = {
  'title': { id: 't1', type: 'title', placement: 'flow', text: '선풍기 토론 활동지' },
  'passage-slot': { id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
  'question': { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '선풍기가 필요한 이유는?' },
  'table': { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]] },
  'image-slot': { id: 'i1', type: 'image-slot', placement: 'flow' },
  'answer-area': { id: 'a1', type: 'answer-area', placement: 'flow', style: 'line' },
  'divider': { id: 'd1', type: 'divider', placement: 'flow' },
  'shape': { id: 's1', type: 'shape', placement: 'float', rect: { xMm: 10, yMm: 10, wMm: 20, hMm: 5 }, shapeKind: 'rect' },
  'richtext': { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문</p>' },
  'std-box': { id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] },
};

test('닫힌 카탈로그는 10종이며 각 타입 최소 픽스처가 PASS', () => {
  assert.equal(OBJECT_TYPES.length, 10);
  for (const type of OBJECT_TYPES) {
    const fixture = MIN_FIXTURES[type];
    assert.ok(fixture, `${type} 최소 픽스처가 준비되어야 함`);
    const { ok, findings } = validateObjectShape(fixture);
    assert.equal(ok, true, `${type} PASS 실패: ${JSON.stringify(findings)}`);
  }
});

test('미지정 타입(카탈로그 밖)은 거부(unknown-type)', () => {
  const { ok, findings } = validateObjectShape({ id: 'x1', type: 'callout', placement: 'flow', text: '강조' });
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'unknown-type'));
});

test('AI 생성 개체 좌표 거부: placement:flow 인데 rect 가 있으면 FAIL', () => {
  const aiObject = {
    id: 'q9', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: 'AI가 만든 질문',
    rect: { xMm: 10, yMm: 10, wMm: 50, hMm: 20 },
  };
  const { ok, findings } = validateObjectShape(aiObject);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'rect-forbidden-in-flow'));
});

test('placement:float 개체는 rect 가 없으면 FAIL(rect-required-in-float)', () => {
  const { ok, findings } = validateObjectShape({ id: 'sh1', type: 'shape', placement: 'float', shapeKind: 'rect' });
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'rect-required-in-float'));
});

test('타입이 허용하지 않는 placement 는 거부(예: title 에 float)', () => {
  const { ok, findings } = validateObjectShape({ id: 't2', type: 'title', placement: 'float', text: '제목', rect: { xMm: 0, yMm: 0, wMm: 10, hMm: 10 } });
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'placement-not-allowed'));
});

test('answer 위치 규칙: 허용 안 된 타입(answer-area)에 answer:true 를 실으면 거부', () => {
  const { ok, findings } = validateObjectShape({ id: 'a2', type: 'answer-area', placement: 'flow', style: 'line', answer: true });
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'unknown-field'));
});

test('pagination:scaffold 문서는 export 거부, paginated 는 허용(D-A/R2-4 계약)', () => {
  const scaffold = checkExportGate({ pagination: 'scaffold', pages: [] });
  assert.equal(scaffold.exportable, false);
  assert.equal(scaffold.reason, 'scaffold-not-exportable');

  const paginated = checkExportGate({ pagination: 'paginated', pages: [] });
  assert.equal(paginated.exportable, true);
  assert.equal(paginated.reason, null);
});

test('pagination 값이 scaffold|paginated 밖이면 예외', () => {
  assert.throws(() => checkExportGate({ pagination: 'draft' }), /pagination/);
});

// ── 저작권 지문 3층 정책(2026-07-23, 2차 델타): 교사 직접 입력 + 명시 요청 시 AI 창작·재구성 허용 ──

test('passage-slot: 교사 입력/AI 창작 본문(bodyHtml)·출처(source)·제목(title)은 카탈로그 필드라 PASS', () => {
  const { ok, findings } = validateObjectShape({
    id: 'p2', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］',
    title: '지문 제목', bodyHtml: '교사가 직접 입력한 지문 본문입니다.', source: '국립국어원(2024)',
  });
  assert.equal(ok, true, JSON.stringify(findings));
});

test('passage-slot: 카탈로그 밖 필드는 unknown-field 로 거부(slot-invariant 아님 — AI_EXCLUDED_TYPES 에서 빠졌으므로)', () => {
  const { ok, findings } = validateObjectShape({
    id: 'p3', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］', html: '<p>탈출</p>',
  });
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'unknown-field'), 'passage-slot 은 더 이상 AI_EXCLUDED_TYPES 가 아니라 다른 타입과 동일한 unknown-field 취급을 받아야 함');
  assert.ok(!findings.some((f) => f.rule === 'slot-invariant'), 'slot-invariant 는 이제 std-box 전용');
});

test('std-box: 2차 델타 이후에도 완전 불변 — codes 밖 필드는 여전히 slot-invariant', () => {
  const { ok, findings } = validateObjectShape({ id: 's2', type: 'std-box', placement: 'flow', codes: [], text: '창작 시도' });
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'slot-invariant'));
});
