import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';

// S2.1 수용 기준(06_plan_final.md 152행): 개체트리→HTML 결정적·float absolute·flow 흐름·
// 표 break-inside:avoid·answer:true→.answer·각 타입 최소 렌더 스냅샷.

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };

// object-schema.test.js 의 MIN_FIXTURES 와 동형 최소 픽스처(카탈로그 10종 1:1 대응).
const MIN_FIXTURES = {
  'title': { id: 't1', type: 'title', placement: 'flow', text: '선풍기 토론 활동지' },
  'passage-slot': { id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
  'question': { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '선풍기가 필요한 이유는?' },
  'table': { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]] },
  'image-slot': { id: 'i1', type: 'image-slot', placement: 'flow' },
  'answer-area': { id: 'a1', type: 'answer-area', placement: 'flow', style: 'line' },
  'divider': { id: 'd1', type: 'divider', placement: 'flow' },
  'shape': { id: 's1', type: 'shape', placement: 'float', rect: { xMm: 10, yMm: 10, wMm: 20, hMm: 5 }, shapeKind: 'rect' },
  'richtext': { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문 텍스트</p>' },
  'std-box': { id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] },
};

function docWith(flow = [], float = []) {
  return { pagination: 'paginated', pages: [{ flow, float }] };
}

test('결정성: 같은 입력 → 같은 출력(2회 렌더 바이트 동일, Date.now/랜덤 금지)', () => {
  const document = docWith(Object.values(MIN_FIXTURES).filter((o) => o.placement === 'flow'));
  const r = new RenderObjectTree();
  const { html: html1 } = r.execute(document, ASSETS, { docTitle: '결정성 테스트' });
  const { html: html2 } = r.execute(document, ASSETS, { docTitle: '결정성 테스트' });
  assert.equal(html1, html2, '동일 입력은 바이트 동일 출력이어야 함');
});

test('flow: 문서 흐름 순서(배열 순서 그대로 방출)', () => {
  const document = docWith([
    { id: 'f1', type: 'title', placement: 'flow', text: '첫번째' },
    { id: 'f2', type: 'title', placement: 'flow', text: '두번째' },
    { id: 'f3', type: 'title', placement: 'flow', text: '세번째' },
  ]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  const i1 = html.indexOf('첫번째');
  const i2 = html.indexOf('두번째');
  const i3 = html.indexOf('세번째');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, `flow 순서가 배열 순서와 일치해야 함(idx: ${i1},${i2},${i3})`);
});

test('float: 페이지 컨테이너 내 position:absolute(rect mm 단위)', () => {
  const document = docWith([], [
    { id: 'sh1', type: 'shape', placement: 'float', rect: { xMm: 12.5, yMm: 30, wMm: 40, hMm: 8 }, shapeKind: 'rect' },
  ]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.match(html, /position:absolute;\s*left:12\.5mm;\s*top:30mm;\s*width:40mm;\s*height:8mm;/, 'float 개체는 rect(mm) 기반 절대좌표여야 함');
});

test('표: break-inside:avoid(분할 금지)', () => {
  const document = docWith([
    { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a', header: true }, { text: 'b' }]] },
  ]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.match(html, /<table[^>]*style="[^"]*break-inside:avoid;[^"]*"/, '표는 break-inside:avoid 를 방출해야 함');
});

test('answer:true 개체 → .answer 클래스 방출(타입 무관, BuildVariants 자연 승계)', () => {
  for (const type of ['title', 'question', 'table', 'richtext']) {
    const base = MIN_FIXTURES[type];
    const obj = { ...base, id: `${base.id}-ans`, answer: true };
    const document = docWith([obj]);
    const { html } = new RenderObjectTree().execute(document, ASSETS);
    assert.match(html, /class="answer"/, `${type} answer:true → .answer 클래스 누락`);
  }
});

test('answer 미지정 개체는 .answer 래퍼가 없다(오탐 방지)', () => {
  const document = docWith([MIN_FIXTURES.title]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.ok(!html.includes('class="answer"'), 'answer 미지정 개체에 .answer 래퍼가 생기면 안 됨');
});

test('카탈로그 10종 각각 최소 렌더 스냅샷(예외 없이 렌더되고 핵심 텍스트/구조 포함)', () => {
  for (const [type, fixture] of Object.entries(MIN_FIXTURES)) {
    const document = fixture.placement === 'float' ? docWith([], [fixture]) : docWith([fixture]);
    const { html } = new RenderObjectTree().execute(document, ASSETS, { docTitle: `${type} 스냅샷` });
    assert.ok(html.includes('<!DOCTYPE html>'), `${type}: 완전한 문서여야 함`);
    assert.ok(html.includes('<section class="sheet">'), `${type}: .sheet 페이지 컨테이너 포함`);
  }
});

test('title: text 이스케이프 + 제목 마크업', () => {
  const document = docWith([{ id: 't1', type: 'title', placement: 'flow', text: '<script>제목</script>' }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.ok(!html.includes('<script>제목</script>'), 'title.text 는 이스케이프되어야 함(XSS 방지)');
  assert.match(html, /class="title-box"/);
});

test('richtext: 보존 HTML 그대로 방출(무손실 탈출구)', () => {
  const document = docWith([{ id: 'r1', type: 'richtext', placement: 'flow', html: '<div class="custom"><b>원문</b></div>' }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.ok(html.includes('<div class="custom"><b>원문</b></div>'), 'richtext.html 은 그대로 방출되어야 함');
});

test('std-box: meta.standards 로 주입된 원문만 표기(원칙 3 — CSV/MCP 조회 없이 순수)', () => {
  const document = docWith([{ id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS, {
    standards: [{ code: '[9과14-02]', text: '전기 회로에서 전류를 모형으로 설명한다.' }],
  });
  assert.match(html, /\[9과14-02\]/);
  assert.ok(html.includes('전기 회로에서 전류를 모형으로 설명한다.'), '주입된 원문이 방출되어야 함');
});

test('std-box: meta.standards 미주입이면 코드만 표기(원문 창작 없음)', () => {
  const document = docWith([{ id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.match(html, /\[9과14-02\]/);
});

// ── 학습목표 표기 전환(2026-07-23): objectives 유무 3분기 ──

test('std-box: objectives 없으면(하위호환) 현행 "관련 성취기준" 박스만 렌더 — 무회귀', () => {
  const document = docWith([{ id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS, {
    standards: [{ code: '[9과14-02]', text: '전기 회로에서 전류를 모형으로 설명한다.' }],
  });
  assert.match(html, /▣ 관련 성취기준/);
  assert.ok(!html.includes('▣ 학습 목표'), 'objectives 없으면 학습 목표 박스가 없어야 함');
  assert.ok(!html.includes('class="std-ref"'), 'objectives 없으면 근거 성취기준(교사전용) 박스가 없어야 함');
});

test('std-box: objectives 있으면 학생/교사 공통 "학습 목표" 박스를 렌더', () => {
  const document = docWith([{
    id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'],
    objectives: ['전류와 전압의 관계를 설명할 수 있다.', '옴의 법칙으로 저항을 구할 수 있다.'],
  }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS, {
    standards: [{ code: '[9과14-02]', text: '전기 회로에서 전류를 모형으로 설명한다.' }],
  });
  assert.match(html, /▣ 학습 목표/);
  assert.ok(html.includes('전류와 전압의 관계를 설명할 수 있다.'), '학습목표 문장이 방출되어야 함');
  assert.ok(html.includes('옴의 법칙으로 저항을 구할 수 있다.'), '학습목표 문장이 방출되어야 함');
  assert.ok(!html.includes('▣ 관련 성취기준'), 'objectives 있으면 현행 성취기준 박스 제목은 방출되지 않아야 함');
});

test('std-box: objectives 있으면 "근거 성취기준"(코드+원문)이 교사전용(.std-ref) 클래스로 함께 방출', () => {
  const document = docWith([{
    id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'],
    objectives: ['전류와 전압의 관계를 설명할 수 있다.'],
  }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS, {
    standards: [{ code: '[9과14-02]', text: '전기 회로에서 전류를 모형으로 설명한다.' }],
  });
  assert.match(html, /class="std-box std-ref"/, '근거 성취기준 박스는 .std-ref 클래스(교사전용 data-mode CSS)를 가져야 함');
  assert.match(html, /▣ 근거 성취기준/);
  assert.match(html, /\[9과14-02\]/, '근거 성취기준 박스에 코드가 표기되어야 함');
  assert.ok(html.includes('전기 회로에서 전류를 모형으로 설명한다.'), '근거 성취기준 박스에 성취기준 원문이 표기되어야 함');
});

test('editMode: 개체 경계 래퍼가 data-oid 기반', () => {
  const document = docWith([{ id: 'obj-42', type: 'divider', placement: 'flow' }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS, {}, { editMode: true });
  assert.match(html, /data-oid="obj-42"/, 'editMode 개체 경계 래퍼는 data-oid 기반이어야 함');
});

test('editMode 기본값(false)은 data-oid 래퍼를 방출하지 않는다', () => {
  const document = docWith([{ id: 'obj-1', type: 'divider', placement: 'flow' }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.ok(!html.includes('data-oid'), '기본(비 editMode)은 data-oid 래퍼 없이 산출 불변이어야 함');
});

test('닫힌 카탈로그 밖 타입은 명시적으로 던진다(스스로 창작하지 않음)', () => {
  const document = docWith([{ id: 'x1', type: 'callout', placement: 'flow' }]);
  assert.throws(() => new RenderObjectTree().execute(document, ASSETS), /카탈로그/);
});

test('입력 검증: document/assets 누락 시 명시적으로 던진다', () => {
  assert.throws(() => new RenderObjectTree().execute(null, ASSETS), /document/);
  assert.throws(() => new RenderObjectTree().execute(docWith([]), null), /assets/);
});

// ── 저작권 지문 2층 정책(2026-07-23): bodyHtml 유무로 본문/플레이스홀더 분기 + 출처 표기 ──

test('passage-slot: bodyHtml 없으면 현행 슬롯 플레이스홀더(.slot)를 렌더', () => {
  const document = docWith([{ id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.match(html, /class="slot"/);
  assert.ok(!html.includes('class="passage-body"'), '본문이 없으면 .passage-body 는 방출되면 안 됨');
});

test('passage-slot: bodyHtml 있으면 본문(.passage-body)을 렌더하고 플레이스홀더(.slot)는 방출하지 않는다', () => {
  const document = docWith([{
    id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］',
    bodyHtml: '교사가 직접 입력한 지문 본문입니다.',
  }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.match(html, /class="passage-body"/);
  assert.ok(html.includes('교사가 직접 입력한 지문 본문입니다.'), '본문 텍스트가 방출되어야 함');
  assert.ok(!html.includes('class="slot"'), '본문이 있으면 .slot 플레이스홀더는 방출되면 안 됨');
});

test('passage-slot: source 가 있으면 출처 표기 줄을 덧붙인다(본문/플레이스홀더 어느 쪽이든)', () => {
  const withBody = docWith([{
    id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］',
    bodyHtml: '본문', source: '국립국어원(2024)',
  }]);
  const { html: htmlWithBody } = new RenderObjectTree().execute(withBody, ASSETS);
  assert.match(htmlWithBody, /class="src"/);
  assert.ok(htmlWithBody.includes('국립국어원(2024)'));

  const withoutSource = docWith([{ id: 'p2', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］', bodyHtml: '본문' }]);
  const { html: htmlNoSource } = new RenderObjectTree().execute(withoutSource, ASSETS);
  assert.ok(!htmlNoSource.includes('class="src"'), 'source 미지정이면 출처 줄이 없어야 함');
});

test('페이지 경계 honor — document.pages[] 개수를 그대로 따른다(스스로 재계산하지 않음, D-A)', () => {
  const document = {
    pagination: 'paginated',
    pages: [
      { flow: [{ id: 'p1t', type: 'title', placement: 'flow', text: '1쪽' }], float: [] },
      { flow: [{ id: 'p2t', type: 'title', placement: 'flow', text: '2쪽' }], float: [] },
      { flow: [], float: [] },
    ],
  };
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  const sheetCount = (html.match(/<section class="sheet">/g) || []).length;
  assert.equal(sheetCount, 3, 'pages[] 개수(3) 를 그대로 존중해야 함');
});
