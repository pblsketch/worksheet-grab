import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_TYPES, SIZEABLE_TYPES, ALIGN_VALUES } from '../../src/domain/schema/index.js';
import { assertEditPrintDeclarationParity, layoutDeclarations } from '../helpers/renderParity.js';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';

// 편집 렌더 == 인쇄 렌더 **레이아웃 선언 동치**(R2-1 구조 가드, 2026-07-28 신설).
//
// 이 파일이 메우는 구멍은 test/helpers/renderParity.js 머리말에 있다 — 요약하면 3자 파리티 대조는
// 두 측정 경로가 모두 editMode:true 라서 "편집에만 반영되는 선언"을 구조적으로 못 잡는다.
// 그 검사를 **카탈로그 전 타입 × 크기 필드 조합**으로 값싸게(Chrome 없이) 훑는 것이 여기다.
//
// 새 필드가 레이아웃에 영향을 준다면 이 스위트가 자동으로 그것도 지킨다 — FIXTURES 에 값을 넣기만
// 하면 된다. 새 타입을 추가하고 픽스처를 빠뜨리면 아래 "카탈로그 전 타입" 테스트가 먼저 빨개진다.

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };
const rect = { xMm: 10, yMm: 20, wMm: 40, hMm: 25 };

/** 타입별 "장식이 최대한 붙은" 픽스처 — 인라인 선언을 내는 필드를 일부러 전부 채운다. */
const FIXTURES = {
  'title': { type: 'title', placement: 'flow', text: '제목', level: 2, meta: { pill: '1단원 2차시', page: 'p.24~27', source: '교과서' } },
  'passage-slot': { type: 'passage-slot', placement: 'flow', slotLabel: '［지문］', title: '자료', source: '출처', bodyHtml: '<p>본문</p>', borderColor: '#334455', borderWidth: 2, bgColor: '#eeeeee' },
  'question': { type: 'question', placement: 'flow', qtype: 'matching', prompt: '짝지어라', left: [{ id: 'a', text: 'A' }], right: [{ id: 'b', text: 'B' }] },
  'table': { type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }, { text: 'b' }]], caption: '표 설명', headerRows: 1, borderColor: '#999999', borderWidth: 1 },
  'image-slot': { type: 'image-slot', placement: 'flow', alt: '그림 설명', caption: '캡션' },
  'answer-area': { type: 'answer-area', placement: 'flow', style: 'dots', lines: 3, label: '메모' },
  'divider': { type: 'divider', placement: 'flow' },
  'shape': { type: 'shape', placement: 'float', shapeKind: 'rect', rect, strokeColor: '#ff0000', fillColor: '#00ff00', strokeWidth: 2, dash: 'dashed', angle: 15, opacity: 0.5 },
  'richtext': { type: 'richtext', placement: 'flow', html: '<p>본문 텍스트</p>' },
  'std-box': { type: 'std-box', placement: 'flow', codes: ['[9과14-02]'], objectives: ['설명할 수 있다.'], heading: '오늘의 목표', showStandards: true },
  'spacer': { type: 'spacer', placement: 'flow', heightMm: 12, label: '여백' },
  'page-break': { type: 'page-break', placement: 'flow' },
  'callout': { type: 'callout', placement: 'flow', variant: 'tip', title: '핵심 정리', body: '<p>옴의 법칙 V=IR</p>' },
};

const withId = (type, extra = {}) => ({ id: `o-${type}`, ...FIXTURES[type], ...extra });

function docOf(objs) {
  const flow = objs.filter((o) => o.placement === 'flow');
  const float = objs.filter((o) => o.placement === 'float');
  return { pagination: 'paginated', pages: [{ flow, float }] };
}

const META = { docTitle: '동치 검사', standards: [{ code: '9과14-02', text: '성취기준 원문' }] };

test('카탈로그 전 타입에 픽스처가 있다(새 타입 추가 시 여기가 먼저 빨개진다)', () => {
  for (const type of OBJECT_TYPES) {
    assert.ok(FIXTURES[type], `${type} 픽스처 누락 — 동치 검사에서 빠지면 가드가 조용히 좁아진다`);
  }
});

test('타입별 단독 렌더: 편집·인쇄 레이아웃 선언 동치', () => {
  for (const type of OBJECT_TYPES) {
    assertEditPrintDeclarationParity(docOf([withId(type)]), ASSETS, META, type);
  }
});

test('전 타입 한 문서: 편집·인쇄 레이아웃 선언 동치', () => {
  assertEditPrintDeclarationParity(docOf(OBJECT_TYPES.map((t) => withId(t))), ASSETS, META, '전 타입');
});

test('크기 필드를 실어도 동치 — 타입 × (폭·최소높이·정렬)', () => {
  for (const type of SIZEABLE_TYPES) {
    for (const align of ALIGN_VALUES) {
      const obj = withId(type, { widthPct: 60, minHeightMm: 25, align });
      assertEditPrintDeclarationParity(docOf([obj]), ASSETS, META, `${type}/${align}`);
    }
  }
});

test('크기 선언이 실제로 방출된다(가드가 공허하지 않음을 확인)', () => {
  // 위 동치 검사는 "양쪽 다 아무 선언도 없음"으로도 통과한다 — 그러면 무의미하다.
  // 크기를 준 개체가 실제로 선언을 만든다는 것을 함께 못 박는다.
  const { edit, print } = assertEditPrintDeclarationParity(
    docOf([withId('table', { widthPct: 60, minHeightMm: 25, align: 'center' })]), ASSETS, META, '공허성 확인',
  );
  const joined = edit.join(' | ');
  assert.match(joined, /width:60%/, `폭 선언이 있어야 함: ${joined}`);
  assert.match(joined, /min-height:25mm/, `최소 높이 선언이 있어야 함: ${joined}`);
  assert.match(joined, /margin-inline:auto/, `정렬 선언이 있어야 함: ${joined}`);
  assert.ok(print.length > 0, '인쇄 렌더에도 선언이 있어야 함');
});

test('editMode 는 style 이 아니라 **속성만** 늘린다(data-oid/data-part)', () => {
  // 이 성질이 깨지면 위 동치 검사가 통과하면서도 레이아웃이 갈릴 수 있다 — 별도로 고정한다.
  const doc = docOf(OBJECT_TYPES.map((t) => withId(t)));
  const r = new RenderObjectTree();
  const editHtml = r.execute(doc, ASSETS, META, { editMode: true }).html;
  const printHtml = r.execute(doc, ASSETS, META, { editMode: false }).html;
  assert.ok(editHtml.includes('data-oid='), '편집 렌더에는 data-oid 가 있어야 함');
  assert.ok(!printHtml.includes('data-oid='), '인쇄 렌더에는 data-oid 가 없어야 함');
  // 선언 목록은 그럼에도 같아야 한다(속성은 레이아웃 박스를 바꾸지 않는다).
  assert.deepEqual(layoutDeclarations(printHtml), layoutDeclarations(editHtml));
});
