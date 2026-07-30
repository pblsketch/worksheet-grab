import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateObjectShape, WIDTH_PCT_MIN, WIDTH_PCT_MAX } from '../../src/domain/schema/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// resizeFlow — 개체 크기·정렬 갱신의 단일 관문(2026-07-28, docs/DECISION-object-resize.md).
// 손잡이 드래그와 인스펙터 입력이 이 함수 하나를 공유하므로, 여기서 클램프가 새면 두 경로 모두 샌다.
//
// 로딩 방식은 nudge-float.test.js 와 동형 — src/editor/* 는 브라우저 전용 절대경로('/src/…')를
// import 하므로 절대경로만 file URL 로 치환해 **진짜 소스**를 단위 검증한다(복사본 아님).
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

const doc = (obj) => ({ pagination: 'paginated', pages: [{ flow: [obj], float: [] }] });
const TABLE = { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]] };
const objOf = (d) => d.pages[0].flow[0];

test('기본: 세 필드를 실어 준다', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const next = resizeFlow(doc({ ...TABLE }), 'tb1', { widthPct: 60, minHeightMm: 30, align: 'center' });
  assert.deepEqual(objOf(next), { ...TABLE, widthPct: 60, minHeightMm: 30, align: 'center' });
});

test('입력 문서를 변형하지 않는다(순수)', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const before = doc({ ...TABLE });
  const snapshot = JSON.parse(JSON.stringify(before));
  resizeFlow(before, 'tb1', { widthPct: 60 });
  assert.deepEqual(before, snapshot, '원본 문서가 변형되면 undo 스냅샷이 오염된다');
});

test('클램프: widthPct 는 스키마 범위로 접힌다', async () => {
  const { resizeFlow } = await loadObjectFactory();
  assert.equal(objOf(resizeFlow(doc({ ...TABLE }), 'tb1', { widthPct: 999 })).widthPct, WIDTH_PCT_MAX);
  assert.equal(objOf(resizeFlow(doc({ ...TABLE }), 'tb1', { widthPct: -50 })).widthPct, WIDTH_PCT_MIN);
});

test('클램프 결과는 항상 스키마를 통과한다(저장 거부 방지)', async () => {
  const { resizeFlow } = await loadObjectFactory();
  // 드래그는 범위 밖 값을 자연스럽게 만든다(손잡이를 지면 밖으로 끌면 100% 초과). 그 값이 문서에
  // 실리면 ValidateObjectTree 가 저장을 거부해 교사는 "저장이 안 된다"만 보게 된다.
  for (const widthPct of [-999, 0, 4.9, 100.1, 1e6]) {
    const next = resizeFlow(doc({ ...TABLE }), 'tb1', { widthPct });
    const { ok, findings } = validateObjectShape(objOf(next));
    assert.ok(ok, `widthPct:${widthPct} → ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('반올림: 드래그가 만드는 긴 소수를 문서에 싣지 않는다', async () => {
  const { resizeFlow } = await loadObjectFactory();
  assert.equal(objOf(resizeFlow(doc({ ...TABLE }), 'tb1', { widthPct: 61.23456 })).widthPct, 61.2);
  assert.equal(objOf(resizeFlow(doc({ ...TABLE }), 'tb1', { minHeightMm: 30.98765 })).minHeightMm, 31);
});

test('null 은 필드를 삭제한다(인스펙터 "원래대로")', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const sized = doc({ ...TABLE, widthPct: 60, minHeightMm: 30, align: 'center' });
  const next = resizeFlow(sized, 'tb1', { widthPct: null, minHeightMm: null, align: null });
  assert.deepEqual(objOf(next), TABLE, '전부 지우면 원래 개체와 같아야 함');
});

test("align:'left' 는 기본값이라 필드로 남기지 않는다", async () => {
  const { resizeFlow } = await loadObjectFactory();
  // 렌더(flowBoxStyle)도 left 에는 선언을 만들지 않는다 — 문서에 남기면 "지정했는데 출력이 같다"는
  // 혼동만 생기므로 표현을 하나로 유지한다.
  assert.equal(objOf(resizeFlow(doc({ ...TABLE }), 'tb1', { align: 'left' })).align, undefined);
  const centered = doc({ ...TABLE, align: 'center' });
  assert.equal(objOf(resizeFlow(centered, 'tb1', { align: 'left' })).align, undefined);
});

test('잘못된 값은 기존 값을 지우지 않는다', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const sized = doc({ ...TABLE, widthPct: 60, minHeightMm: 30, align: 'center' });
  const next = resizeFlow(sized, 'tb1', { widthPct: NaN, minHeightMm: 'abc', align: 'middle' });
  assert.equal(objOf(next).widthPct, 60, '입력이 잘못됐다고 멀쩡한 값을 날리면 안 된다');
  assert.equal(objOf(next).minHeightMm, 30);
  assert.equal(objOf(next).align, 'center');
});

test('minHeightMm 0·음수는 무시된다(삭제하려면 null)', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const sized = doc({ ...TABLE, minHeightMm: 30 });
  assert.equal(objOf(resizeFlow(sized, 'tb1', { minHeightMm: 0 })).minHeightMm, 30);
  assert.equal(objOf(resizeFlow(sized, 'tb1', { minHeightMm: -5 })).minHeightMm, 30);
});

test('변경이 없으면 입력 문서를 그대로 돌려준다(히스토리 빈 단계 방지)', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const sized = doc({ ...TABLE, widthPct: 60 });
  assert.equal(resizeFlow(sized, 'tb1', { widthPct: 60 }), sized, '같은 값 재적용은 동일 참조여야 함');
  assert.equal(resizeFlow(sized, 'tb1', {}), sized, '빈 patch 도 동일 참조');
  assert.equal(resizeFlow(sized, 'nope', { widthPct: 50 }), sized, '없는 id 도 동일 참조');
});

test('float 개체에는 적용하지 않는다(크기는 rect 소관)', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const d = {
    pagination: 'paginated',
    pages: [{ flow: [], float: [{ ...TABLE, placement: 'float', rect: { xMm: 1, yMm: 1, wMm: 1, hMm: 1 } }] }],
  };
  assert.equal(resizeFlow(d, 'tb1', { widthPct: 60 }), d, 'float 에 크기를 실으면 스키마가 거부한다');
});

test('크기를 받지 않는 타입은 건드리지 않는다(shape·spacer·page-break)', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const cases = [
    { id: 'sp1', type: 'spacer', placement: 'flow', heightMm: 20 },
    { id: 'pb1', type: 'page-break', placement: 'flow' },
  ];
  for (const obj of cases) {
    const d = doc(obj);
    assert.equal(resizeFlow(d, obj.id, { widthPct: 60 }), d, `${obj.type} 은 크기 필드를 갖지 않는다`);
  }
});

test('허용 타입 전체에서 동작한다', async () => {
  const { resizeFlow } = await loadObjectFactory();
  const { SIZEABLE_TYPES } = await import('../../src/domain/schema/index.js');
  const MIN = {
    'title': { type: 'title', text: 'x' },
    'passage-slot': { type: 'passage-slot', slotLabel: 'x' },
    'question': { type: 'question', qtype: 'essay', prompt: 'x' },
    'table': { type: 'table', splittable: false, rows: [[{ text: 'a' }]] },
    'image-slot': { type: 'image-slot' },
    'answer-area': { type: 'answer-area', style: 'line' },
    'divider': { type: 'divider' },
    'richtext': { type: 'richtext', html: '<p>x</p>' },
    'std-box': { type: 'std-box', codes: ['[9과14-02]'] },
    'callout': { type: 'callout', variant: 'tip', body: '<p>x</p>' },
  };
  for (const type of SIZEABLE_TYPES) {
    const obj = { id: 'o1', placement: 'flow', ...MIN[type] };
    const next = resizeFlow(doc(obj), 'o1', { widthPct: 60, align: 'center' });
    assert.equal(objOf(next).widthPct, 60, `${type} 에 폭이 실려야 함`);
    assert.ok(validateObjectShape(objOf(next)).ok, `${type} 결과가 스키마를 통과해야 함`);
  }
});
