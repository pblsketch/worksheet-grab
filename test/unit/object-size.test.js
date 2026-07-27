import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  validateObjectShape, OBJECT_TYPES, TYPE_SPECS,
  SIZE_FIELDS, SIZEABLE_TYPES, ALIGN_VALUES, WIDTH_PCT_MIN, WIDTH_PCT_MAX,
} from '../../src/domain/schema/index.js';

// 개체 크기·정렬 필드(2026-07-28 신설 — docs/DECISION-object-resize.md).
//
// 핵심 계약: **크기는 좌표가 아니다.** flow 개체는 rect 를 가질 수 없지만(rect-forbidden-in-flow,
// 원칙 3) widthPct/minHeightMm/align 은 위치가 아니라 흐름 안에서의 상대 크기만 말하므로 허용된다.
// 반대로 float 은 rect 가 이미 크기를 가지므로 이 필드를 실을 수 없다(한 가지 일에 수단 둘 금지).

const rect = { xMm: 10, yMm: 10, wMm: 40, hMm: 20 };

/** 타입별 최소 유효 개체(object-schema.test.js 의 MIN_FIXTURES 와 동일 관례). */
const MIN = {
  'title': { id: 't1', type: 'title', placement: 'flow', text: '제목' },
  'passage-slot': { id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문］' },
  'question': { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '왜?' },
  'table': { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]] },
  'image-slot': { id: 'i1', type: 'image-slot', placement: 'flow' },
  'answer-area': { id: 'a1', type: 'answer-area', placement: 'flow', style: 'line' },
  'divider': { id: 'd1', type: 'divider', placement: 'flow' },
  'shape': { id: 's1', type: 'shape', placement: 'float', rect, shapeKind: 'rect' },
  'richtext': { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문</p>' },
  'std-box': { id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] },
  'spacer': { id: 'sp1', type: 'spacer', placement: 'flow', heightMm: 20 },
  'page-break': { id: 'pb1', type: 'page-break', placement: 'flow' },
};

const rulesOf = (obj) => validateObjectShape(obj).findings.map((f) => f.rule);

test('SIZE_FIELDS 는 widthPct/minHeightMm/align 3종', () => {
  assert.deepEqual([...SIZE_FIELDS], ['widthPct', 'minHeightMm', 'align']);
});

test('크기를 실을 수 있는 타입 9종 — shape·spacer·page-break 만 제외', () => {
  // shape: float 전용이라 flow 전용인 크기 필드가 애초에 성립하지 않는다.
  // spacer: 이미 heightMm 를 갖는다(중복 어휘). page-break: 높이 0 표식이라 박스가 없다.
  assert.deepEqual([...SIZEABLE_TYPES], [
    'title', 'passage-slot', 'question', 'table', 'image-slot', 'answer-area', 'divider', 'richtext', 'std-box',
  ]);
  for (const t of ['shape', 'spacer', 'page-break']) {
    assert.ok(!SIZEABLE_TYPES.includes(t), `${t} 는 크기 필드를 갖지 않아야 함`);
  }
});

test('허용 타입은 flow 에서 크기 3종을 모두 실어도 PASS', () => {
  for (const type of SIZEABLE_TYPES) {
    const obj = { ...MIN[type], widthPct: 60, minHeightMm: 30, align: 'center' };
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${type}: ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('크기 필드가 없는 기존 개체는 전부 그대로 PASS(하위호환)', () => {
  for (const type of OBJECT_TYPES) {
    assert.ok(validateObjectShape(MIN[type]).ok, `${type} 최소 픽스처가 회귀`);
  }
});

test('float 에는 크기 필드를 실을 수 없다 — size-forbidden-in-float', () => {
  // rect 가 이미 크기를 정한다. rect-forbidden-in-flow 의 대칭 규칙.
  const obj = { id: 'q9', type: 'question', placement: 'float', rect, qtype: 'essay', prompt: 'x', widthPct: 60 };
  assert.ok(rulesOf(obj).includes('size-forbidden-in-float'));
});

test('flow 의 rect 금지는 그대로 유지된다(원칙 3 무변경)', () => {
  // 크기 필드를 새로 허용했다고 좌표까지 열린 것이 아니다 — 이 회귀가 이번 변경의 최대 위험이다.
  const obj = { ...MIN.table, rect };
  assert.ok(rulesOf(obj).includes('rect-forbidden-in-flow'));
});

test('값 범위 밖은 invalid-size-value 로 거부', () => {
  const bad = [
    { ...MIN.table, widthPct: WIDTH_PCT_MAX + 1 },
    { ...MIN.table, widthPct: WIDTH_PCT_MIN - 1 },
    { ...MIN.table, widthPct: '60' },
    { ...MIN.table, widthPct: NaN },
    { ...MIN.table, minHeightMm: 0 },
    { ...MIN.table, minHeightMm: -5 },
    { ...MIN.table, minHeightMm: Infinity },
    { ...MIN.table, align: 'middle' },
  ];
  for (const obj of bad) {
    assert.ok(rulesOf(obj).includes('invalid-size-value'), JSON.stringify(obj));
  }
});

test('경계값은 통과 — widthPct 5·100', () => {
  for (const widthPct of [WIDTH_PCT_MIN, WIDTH_PCT_MAX]) {
    assert.ok(validateObjectShape({ ...MIN.table, widthPct }).ok, `widthPct:${widthPct}`);
  }
  for (const align of ALIGN_VALUES) {
    assert.ok(validateObjectShape({ ...MIN.table, align }).ok, `align:${align}`);
  }
});

test('크기 필드를 허용하지 않는 타입에 실으면 카탈로그 밖 필드로 거부', () => {
  // spacer/page-break/shape 는 optional 목록에 없으므로 기존 unknown-field 검사가 잡는다
  // (size 전용 규칙을 중복으로 두지 않는다).
  assert.ok(rulesOf({ ...MIN.spacer, widthPct: 50 }).includes('unknown-field'));
  assert.ok(rulesOf({ ...MIN['page-break'], widthPct: 50 }).includes('unknown-field'));
  assert.ok(rulesOf({ ...MIN.shape, widthPct: 50 }).includes('unknown-field'));
});

test('JSON 스키마가 런타임 카탈로그와 1:1 — 크기 필드 보유 타입이 같다', async () => {
  // 두 산출물이 갈라지면 즉시 회귀(object-schema.test.js 와 동일 취지의 상시 단정).
  const raw = await readFile(resolve(import.meta.dirname, '../../schema/worksheet-object.schema.json'), 'utf8');
  const schema = JSON.parse(raw);
  const defOf = {
    'title': 'titleObject', 'passage-slot': 'passageSlotObject', 'question': 'questionObject',
    'table': 'tableObject', 'image-slot': 'imageSlotObject', 'answer-area': 'answerAreaObject',
    'divider': 'dividerObject', 'shape': 'shapeObject', 'richtext': 'richtextObject',
    'std-box': 'stdBoxObject', 'spacer': 'spacerObject', 'page-break': 'pageBreakObject',
  };
  for (const type of OBJECT_TYPES) {
    const props = schema.$defs[defOf[type]].properties;
    const inSchema = SIZE_FIELDS.every((f) => props[f] !== undefined);
    const inCatalog = SIZE_FIELDS.every((f) => TYPE_SPECS[type].optional.includes(f));
    assert.equal(inSchema, inCatalog, `${type}: JSON 스키마와 런타임 카탈로그가 갈라졌다`);
  }
  // commonProps 정의 자체의 범위도 런타임 상수와 같아야 한다.
  assert.equal(schema.$defs.commonProps.widthPct.minimum, WIDTH_PCT_MIN);
  assert.equal(schema.$defs.commonProps.widthPct.maximum, WIDTH_PCT_MAX);
  assert.deepEqual(schema.$defs.commonProps.align.enum, [...ALIGN_VALUES]);
});
