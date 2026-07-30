import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';

// S2.1 수용 기준(06_plan_final.md 152행): 개체트리→HTML 결정적·float absolute·flow 흐름·
// 표 break-inside:avoid·answer:true→.answer·각 타입 최소 렌더 스냅샷.

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };

// object-schema.test.js 의 MIN_FIXTURES 와 동형 최소 픽스처(카탈로그 12종 1:1 대응).
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
  'spacer': { id: 'sp1', type: 'spacer', placement: 'flow', heightMm: 20 },
  'page-break': { id: 'pb1', type: 'page-break', placement: 'flow' },
  'callout': { id: 'c1', type: 'callout', placement: 'flow', variant: 'tip', body: '<p>핵심 정리</p>' },
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

test('카탈로그 12종 각각 최소 렌더 스냅샷(예외 없이 렌더되고 핵심 텍스트/구조 포함)', () => {
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
  // 박스 제목은 교사가 본문에서 바로 고칠 수 있도록 인라인 편집 span 으로 감싼다(heading 필드).
  // 그래서 "▣ 학습 목표" 가 더 이상 연속 문자열이 아니다 — 기본 제목 텍스트로 단정한다.
  assert.match(html, /class="std-head"/);
  assert.match(html, /std-head-text[^>]*>학습 목표</, '기본 박스 제목은 "학습 목표"');
  assert.ok(html.includes('전류와 전압의 관계를 설명할 수 있다.'), '학습목표 문장이 방출되어야 함');
  assert.ok(html.includes('옴의 법칙으로 저항을 구할 수 있다.'), '학습목표 문장이 방출되어야 함');
  assert.ok(!html.includes('▣ 관련 성취기준'), 'objectives 있으면 현행 성취기준 박스 제목은 방출되지 않아야 함');
});

test('std-box: 근거 성취기준 박스는 showStandards:true 일 때만 방출된다(기본은 숨김)', () => {
  // 2026-07-28 기본값 전환 — 현장에서 활동지에 얹는 것은 학습목표뿐이고 성취기준 원문은 대개
  // 넣지 않는다는 실사용 피드백. codes 는 그대로 보존되므로 껐다 켜도 정보가 소실되지 않는다.
  const base = {
    id: 'sb1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'],
    objectives: ['전류와 전압의 관계를 설명할 수 있다.'],
  };
  const meta = { standards: [{ code: '[9과14-02]', text: '전기 회로에서 전류를 모형으로 설명한다.' }] };

  const off = new RenderObjectTree().execute(docWith([base]), ASSETS, meta).html;
  assert.ok(!off.includes('class="std-box std-ref"'), '기본(showStandards 미지정)에는 근거 성취기준 박스가 없어야 함');
  assert.ok(off.includes('전류와 전압의 관계를 설명할 수 있다.'), '학습목표는 그대로 방출');

  const document = docWith([{ ...base, showStandards: true }]);
  const { html } = new RenderObjectTree().execute(document, ASSETS, meta);
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
  const document = docWith([{ id: 'x1', type: 'sidebar', placement: 'flow' }]);
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

// ── 레이아웃 전용 2종(2026-07-28) ──────────────────────────────────────────────
// 둘 다 인쇄에는 "보이는 것"이 없다. 그래서 검증 대상은 **높이 선언**이다 — 편집 측정과 인쇄가
// 같은 인라인 값을 써야 R2-1(편집==인쇄)이 성립한다(편집 전용 CSS 로 높이를 주면 갈린다).

test('spacer: heightMm 를 인라인 height 로 방출하고 내용은 비운다', () => {
  const { html } = new RenderObjectTree().execute(
    docWith([{ id: 'sp1', type: 'spacer', placement: 'flow', heightMm: 32.5 }]), ASSETS);
  assert.match(html, /<div class="wg-spacer" style="height:32\.5mm"><\/div>/);
});

test('spacer: label 은 data 속성으로만 실린다(인쇄에 글자가 남지 않는다)', () => {
  const { html } = new RenderObjectTree().execute(
    docWith([{ id: 'sp1', type: 'spacer', placement: 'flow', heightMm: 10, label: '오려붙이기 <공간>' }]), ASSETS);
  assert.match(html, /data-spacer-label="오려붙이기 &lt;공간&gt;"/, 'label 은 이스케이프되어 data 속성으로');
  assert.ok(!/>오려붙이기/.test(html), 'label 이 본문 텍스트로 새어 나오면 안 된다');
});

test('spacer: heightMm 이 불량이면 기본 10mm 로 떨어진다(NaNmm 방출 금지)', () => {
  // 스키마가 number 를 요구하므로 여기 오는 불량값은 검증을 우회한 경우다. mm() 가 NaNmm 을
  // 조용히 방출하면 조판이 소리 없이 깨지므로 렌더러가 마지막 방어선이 된다.
  for (const bad of [undefined, null, 0, -5, NaN, Infinity, {}]) {
    const { html } = new RenderObjectTree().execute(
      docWith([{ id: 'sp1', type: 'spacer', placement: 'flow', heightMm: bad }]), ASSETS);
    assert.match(html, /style="height:10mm"/, `불량 heightMm(${String(bad)}) 폴백 실패`);
    assert.ok(!html.includes('NaNmm'), 'NaNmm 이 방출되면 조판이 조용히 깨진다');
  }
  // 숫자로 해석되는 문자열은 강제 변환해 받는다(mm() 등 기존 렌더 관례와 동형).
  const { html } = new RenderObjectTree().execute(
    docWith([{ id: 'sp1', type: 'spacer', placement: 'flow', heightMm: '20' }]), ASSETS);
  assert.match(html, /style="height:20mm"/);
});

test('page-break: 높이 0 표식만 남기고 인쇄용 개행 CSS 를 쓰지 않는다', () => {
  const { html } = new RenderObjectTree().execute(
    docWith([{ id: 'pb1', type: 'page-break', placement: 'flow' }]), ASSETS);
  assert.match(html, /<div class="wg-pagebreak" style="height:0"><\/div>/);
  // 페이지 경계의 단일 권한은 측정 패스다(D-A) — CSS 개행을 섞으면 pages[] 와 실제 인쇄가 어긋난다.
  assert.ok(!/wg-pagebreak[^>]*break-before/.test(html), 'break-before 를 직접 쓰면 안 된다');
});

// ── 2026-07-28 UX 배치: 본문 인라인 편집 좌표 · 이미지 자리 · 지문 서식 · 연결점 간격 ──

test('std-box: heading(박스 제목)을 지정하면 그 제목으로 렌더된다', () => {
  const { html } = new RenderObjectTree().execute(docWith([{
    id: 'sb1', type: 'std-box', placement: 'flow', objectives: ['설명할 수 있다.'], heading: '오늘의 목표',
  }]), ASSETS);
  assert.match(html, /std-head-text[^>]*>오늘의 목표</);
  assert.ok(!html.includes('>학습 목표<'), 'heading 이 있으면 기본 제목은 쓰이지 않는다');
});

test('std-box: heading 이 공백뿐이면 기본 제목으로 떨어진다', () => {
  const { html } = new RenderObjectTree().execute(docWith([{
    id: 'sb1', type: 'std-box', placement: 'flow', objectives: ['설명할 수 있다.'], heading: '   ',
  }]), ASSETS);
  assert.match(html, /std-head-text[^>]*>학습 목표</);
});

test('인라인 편집 좌표(data-part)는 editMode 에서만 실린다 — 인쇄 산출은 종전과 동일', () => {
  const flow = [
    { id: 'sb1', type: 'std-box', placement: 'flow', objectives: ['목표 하나', '목표 둘'] },
    { id: 't1', type: 'title', placement: 'flow', text: '제목', meta: { pill: '중1 · 2차시', page: 'p.24', source: '교과서' } },
    { id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문］', title: '지문 (가)', source: '출처 표기' },
    { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]], caption: '표 설명' },
  ];
  const print = new RenderObjectTree().execute(docWith(flow), ASSETS).html;
  assert.ok(!print.includes('data-part'), '인쇄 렌더에는 편집 좌표가 실리면 안 된다');

  const edit = new RenderObjectTree().execute(docWith(flow), ASSETS, {}, { editMode: true }).html;
  for (const expected of [
    'data-part="objectives" data-i="0"', 'data-part="objectives" data-i="1"', 'data-part="heading"',
    'data-part="meta.pill"', 'data-part="meta.page"', 'data-part="meta.source"',
    'data-part="title"', 'data-part="source"', 'data-part="caption"',
  ]) {
    assert.ok(edit.includes(expected), `editMode 에 ${expected} 좌표가 있어야 함`);
  }
  // R2-1(편집==인쇄): 편집 좌표는 **속성**으로만 는다 — 편집 전용 텍스트·요소가 새로 생기면
  // 편집 측정 높이와 인쇄 높이가 갈린다. 태그를 걷어낸 본문 텍스트가 양쪽에서 같아야 한다.
  const textOf = (h) => h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(textOf(edit), textOf(print), '편집 렌더에만 있는 글자가 있으면 R2-1 이 깨진다');
});

test('image-slot: 빈 자리는 아이콘+라벨 플레이스홀더 박스로 렌더(맨 글자 아님)', () => {
  const { html } = new RenderObjectTree().execute(docWith([{ id: 'i1', type: 'image-slot', placement: 'flow' }]), ASSETS);
  assert.match(html, /class="image-slot placeholder"/);
  assert.match(html, /<svg class="is-icon"/, '자리임을 알리는 아이콘이 있어야 함');
  assert.match(html, /class="is-label">이미지 삽입 자리</);
  // 편집기 안내 문구는 넣지 않는다 — blocks.css 는 학생 배포본도 쓰는 공유 자산이다.
  assert.ok(!/업로드/.test(html), '편집기 안내 문구가 인쇄본에 찍히면 안 된다');
});

test('image-slot: alt 만 있으면 무엇이 들어갈 자리인지 함께 보인다(이스케이프)', () => {
  const { html } = new RenderObjectTree().execute(
    docWith([{ id: 'i1', type: 'image-slot', placement: 'flow', alt: '실험 <장치> 사진' }]), ASSETS);
  assert.match(html, /class="is-alt">실험 &lt;장치&gt; 사진</);
});

test('image-slot: src 가 있으면 figure/img 경로는 종전과 동일', () => {
  const { html } = new RenderObjectTree().execute(
    docWith([{ id: 'i1', type: 'image-slot', placement: 'flow', src: 'a.png', caption: '캡션' }]), ASSETS);
  assert.match(html, /<figure class="image-slot"><img src="a\.png" alt=""><figcaption>캡션<\/figcaption><\/figure>/);
  // 캡션 편집은 selection.js EDIT_FIELD(figcaption)가 소유한다 — data-part 를 겹쳐 싣지 않는다.
  const edit = new RenderObjectTree().execute(
    docWith([{ id: 'i1', type: 'image-slot', placement: 'flow', src: 'a.png', caption: '캡션' }]), ASSETS, {}, { editMode: true }).html;
  assert.ok(!/figcaption class="wg-part"/.test(edit));
});

test('passage-slot: 색·테두리 필드는 CSS 변수로만 방출되고, 미지정이면 style 자체가 없다', () => {
  const plain = new RenderObjectTree().execute(
    docWith([{ id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문］' }]), ASSETS).html;
  assert.match(plain, /<div class="passage">/, '미지정 개체는 종전과 동일한 마크업');

  const styled = new RenderObjectTree().execute(docWith([{
    id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문］',
    borderColor: '#2563eb', borderWidth: 2.5, bgColor: '#eef4fc',
  }]), ASSETS).html;
  assert.match(styled, /--wg-ps-border:#2563eb/);
  assert.match(styled, /--wg-ps-bw:2\.5px/);
  assert.match(styled, /--wg-ps-bg:#eef4fc/);
});

test('passage-slot: 색 값이 CSS 토큰이 아니면 선언을 생략한다(인라인 style 주입 차단)', () => {
  const { html } = new RenderObjectTree().execute(docWith([{
    id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문］',
    borderColor: 'red; position:fixed; inset:0', bgColor: 'url(javascript:alert(1))', borderWidth: -3,
  }]), ASSETS);
  assert.ok(!html.includes('position:fixed'), '색 자리로 다른 CSS 선언이 들어가면 안 된다');
  assert.ok(!html.includes('javascript:'), 'URL 값이 색 자리에 들어가면 안 된다');
  assert.ok(!html.includes('--wg-ps-bw'), '음수 두께는 선언하지 않는다');
});

test('연결형: 좌우 연결점이 각각 항목 쪽 끝으로 벌어지도록 별개 요소로 방출된다(#4)', () => {
  const { html } = new RenderObjectTree().execute(docWith([{
    id: 'q1', type: 'question', placement: 'flow', qtype: 'matching',
    prompt: '연결하시오.', left: ['가', '나'], right: ['1', '2'],
  }]), ASSETS);
  assert.match(html, /<td class="q-match-mid"><span class="q-match-dots" aria-hidden="true"><span class="q-match-dot"><\/span><span class="q-match-dot"><\/span><\/span><\/td>/);
  // 종전의 "두 점이 가운데 칸 한복판에 붙어 있던" 마크업이 남아 있으면 회귀다.
  assert.ok(!html.includes('·&nbsp;&nbsp;&nbsp;·'), '가운데 붙은 점 텍스트가 남아 있으면 안 된다');
});

test('std-box: showStandards 를 켜도 codes 가 없으면 빈 근거 성취기준 박스를 내지 않는다', () => {
  const { html } = new RenderObjectTree().execute(docWith([{
    id: 'sb1', type: 'std-box', placement: 'flow', codes: [], objectives: ['설명할 수 있다.'], showStandards: true,
  }]), ASSETS);
  assert.ok(!html.includes('std-ref'), '참조할 코드가 없으면 제목만 있는 빈 테두리가 인쇄된다');
});
