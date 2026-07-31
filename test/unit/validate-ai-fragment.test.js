import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAiFragment, compileFragmentToInsertSection, isFragmentStale,
  AI_AUTHORABLE_TYPES, validateObjectShape,
} from '../../src/domain/schema/index.js';
import { validateResponse, AI_SCHEMA_VERSION } from '../../src/usecases/aiBridge.js';

// AI 프래그먼트 저작 — ValidateAiFragment 거부 매트릭스 + 컴파일 계약.
// 정책 근거: docs/ADR-bspike-ai-fragment.md.

const seq = () => { let n = 0; return () => `frag-${n++}`; };

// ── 허용 ──────────────────────────────────────────────────────────────────────
test('유효 scaffold(flow-only) 프래그먼트는 승인되고 원본을 그대로 반환', () => {
  const frag = [
    { type: 'title', text: '분수의 덧셈', level: 2 },
    { type: 'callout', variant: 'tip', body: '<p>분모가 같으면 <strong>분자만</strong> 더한다.</p>' },
    { type: 'question', qtype: 'multiple-choice', prompt: '1/4 + 2/4 = ?', choices: [{ id: 'a', text: '3/4' }, { id: 'b', text: '3/8' }] },
    { type: 'answer-area', style: 'line', lines: 2 },
  ];
  const r = validateAiFragment(frag);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.deepEqual(r.objects, frag); // 승인 = 원문 그대로(preview==apply 보장)
});

test('AI 저작 가능 타입 10종만 — std-box/shape/spacer/page-break 제외(organizer 포함)', () => {
  assert.deepEqual([...AI_AUTHORABLE_TYPES].sort(), [
    'answer-area', 'callout', 'divider', 'image-slot', 'organizer', 'passage-slot', 'question', 'richtext', 'table', 'title',
  ]);
});

test('organizer 저작 허용 — kind·params(개수)·labels(슬롯 글자)만, 좌표 없이 승인', () => {
  const frag = [
    { type: 'organizer', kind: 'venn', params: { circles: 3 }, labels: { a: '고체', b: '액체', c: '기체', common: '물질' } },
    { type: 'organizer', kind: 'fishbone', params: { branches: 4 }, labels: { result: '성적 하락', cause1: '수면 부족' } },
    { type: 'organizer', kind: 'conceptmap' }, // params·labels 없이도 유효(엔진 기본 개수·라벨)
  ];
  const r = validateAiFragment(frag);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.deepEqual(r.objects, frag); // 승인 = 원문 그대로(preview==apply)
});

test('중첩 id(choices/left/right/items/blanks)는 정상 — 최상위 id 만 거부', () => {
  const r = validateAiFragment([
    { type: 'question', qtype: 'matching', prompt: '짝지어라', left: [{ id: 'L1', text: '가' }], right: [{ id: 'R1', text: 'A' }] },
    { type: 'question', qtype: 'fill-blank', prompt: '{{b1}} 이다', blanks: [{ id: 'b1' }] },
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
});

// ── 거부 매트릭스 ──────────────────────────────────────────────────────────────
const REJECT_CASES = [
  ['최상위 좌표(rect)', [{ type: 'title', text: 'x', rect: { xMm: 1, yMm: 1, wMm: 1, hMm: 1 } }], 'forbidden-coordinate'],
  ['개별 좌표(xMm)', [{ type: 'title', text: 'x', xMm: 10 }], 'forbidden-coordinate'],
  ['최상위 id', [{ type: 'title', id: 't1', text: 'x' }], 'forbidden-id'],
  ['placement 저작', [{ type: 'title', placement: 'float', text: 'x' }], 'forbidden-placement'],
  ['SIZE(widthPct)', [{ type: 'title', text: 'x', widthPct: 50 }], 'forbidden-size'],
  ['SIZE(minHeightMm)', [{ type: 'title', text: 'x', minHeightMm: 30 }], 'forbidden-size'],
  ['SIZE(align)', [{ type: 'title', text: 'x', align: 'center' }], 'forbidden-size'],
  ['opacity', [{ type: 'title', text: 'x', opacity: 0.5 }], 'forbidden-transform'],
  ['angle', [{ type: 'title', text: 'x', angle: 45 }], 'forbidden-transform'],
  ['page 저작(pageId)', [{ type: 'title', text: 'x', pageId: 'p1' }], 'forbidden-page-authoring'],
  ['page 저작(pagination)', [{ type: 'title', text: 'x', pagination: 'scaffold' }], 'forbidden-page-authoring'],
  ['answer:true', [{ type: 'question', qtype: 'essay', prompt: 'q', answer: true }], 'forbidden-answer'],
  ['answerKey', [{ type: 'question', qtype: 'essay', prompt: 'q', answerKey: { text: '42' } }], 'forbidden-answer'],
  ['표현필드(bgColor)', [{ type: 'callout', variant: 'tip', body: '<p>x</p>', bgColor: '#fff' }], 'forbidden-presentation'],
  ['표현필드(sourceType)', [{ type: 'richtext', html: '<p>x</p>', sourceType: 'directive' }], 'forbidden-presentation'],
  ['금지 타입(std-box)', [{ type: 'std-box', codes: ['x'] }], 'forbidden-type'],
  ['금지 타입(shape)', [{ type: 'shape', shapeKind: 'rect' }], 'forbidden-type'],
  ['금지 타입(spacer)', [{ type: 'spacer', heightMm: 10 }], 'forbidden-type'],
  ['금지 타입(page-break)', [{ type: 'page-break' }], 'forbidden-type'],
  ['미상 타입', [{ type: 'sidebar', text: 'x' }], 'unknown-type'],
  ['image-slot.src', [{ type: 'image-slot', src: 'https://evil/answer.png' }], 'forbidden-image-src'],
  ['HTML: script', [{ type: 'richtext', html: '<script>a()</script>' }], 'html-disallowed-tag'],
  ['HTML: iframe', [{ type: 'callout', variant: 'note', body: '<iframe src=x></iframe>' }], 'html-disallowed-tag'],
  ['HTML: style 속성', [{ type: 'richtext', html: '<p style="x">y</p>' }], 'html-disallowed-attr'],
  ['HTML: javascript URL', [{ type: 'richtext', html: '<a href="javascript:a()">x</a>' }], 'html-disallowed-url'],
  ['callout.titleHtml(허용 5위치 밖)', [{ type: 'callout', variant: 'tip', body: '<p>x</p>', titleHtml: '<b>t</b>' }], 'forbidden-html-position'],
  ['잘못된 variant', [{ type: 'callout', variant: 'evil', body: '<p>x</p>' }], 'invalid-value'],
  ['잘못된 qtype', [{ type: 'question', qtype: 'bogus', prompt: 'q' }], 'invalid-value'],
  ['table.splittable=true', [{ type: 'table', splittable: true, rows: [[{ text: 'a' }]] }], 'invalid-value'],
  ['중첩 추가필드(choices.evil)', [{ type: 'question', qtype: 'ordering', prompt: 'q', items: [{ id: 'a', text: 'x', evil: 1 }] }], 'nested-additional'],
  ['셀 추가필드', [{ type: 'table', splittable: false, rows: [[{ text: 'a', evil: 1 }]] }], 'nested-additional'],
  ['미상 필드', [{ type: 'title', text: 'x', bogus: 1 }], 'unknown-field'],
  ['필수 누락(callout.body)', [{ type: 'callout', variant: 'tip' }], 'missing-field'],
  ['passage bodyHtml 무권한', [{ type: 'passage-slot', slotLabel: 'x', bodyHtml: '<p>본문</p>' }], 'passage-content-denied'],
  ['평문 불일치(textHtml≠text)', [{ type: 'title', text: 'A', textHtml: '<strong>B</strong>' }], 'plaintext-mismatch'],
  // organizer(P3) — 좌표는 이미 forbidden-coordinate 로 막히고, kind/params/labels 는 안전 스칼라 맵으로 검증.
  ['organizer 좌표(rect)', [{ type: 'organizer', kind: 'venn', rect: { xMm: 1, yMm: 1, wMm: 1, hMm: 1 } }], 'forbidden-coordinate'],
  ['organizer 잘못된 kind', [{ type: 'organizer', kind: 'spiral' }], 'invalid-value'],
  ['organizer 필수 누락(kind)', [{ type: 'organizer', params: { circles: 2 } }], 'missing-field'],
  ['organizer.params 비정수', [{ type: 'organizer', kind: 'venn', params: { circles: 'x' } }], 'nested-shape'],
  ['organizer.labels 비문자열', [{ type: 'organizer', kind: 'venn', labels: { left: 3 } }], 'nested-shape'],
  ['organizer.html(허용 밖 필드)', [{ type: 'organizer', kind: 'venn', html: '<p>x</p>' }], 'unknown-field'],
  ['organizer answer(중립·금지)', [{ type: 'organizer', kind: 'venn', answer: true }], 'forbidden-answer'],
];

for (const [name, frag, expectedRule] of REJECT_CASES) {
  test(`거부: ${name} → ${expectedRule}`, () => {
    const r = validateAiFragment(frag);
    assert.equal(r.ok, false, `${name} 는 반려되어야 함`);
    assert.ok(r.findings.some((f) => f.rule === expectedRule),
      `${name}: 기대 규칙 '${expectedRule}' 미발견 — 실제: ${r.findings.map((f) => f.rule).join(',')}`);
  });
}

test('빈/비배열 프래그먼트 거부', () => {
  assert.equal(validateAiFragment([]).findings[0].rule, 'empty-fragment');
  assert.equal(validateAiFragment(null).findings[0].rule, 'invalid-fragment');
  assert.equal(validateAiFragment({ foo: 1 }).findings[0].rule, 'invalid-fragment');
});

test('passage bodyHtml 은 allowPassageContent 권한이 있으면 허용', () => {
  const frag = [{ type: 'passage-slot', slotLabel: '［지문］', bodyHtml: '<p>허용된 본문</p>', source: '교과서 p.24' }];
  assert.equal(validateAiFragment(frag).ok, false); // 무권한
  assert.equal(validateAiFragment(frag, { allowPassageContent: true }).ok, true); // 권한
});

test('여러 위반을 한 번에 모아 보고(조기 반환 안 함)', () => {
  const r = validateAiFragment([{ type: 'title', text: 'x', rect: {}, widthPct: 50, bogus: 1 }]);
  assert.equal(r.ok, false);
  assert.ok(r.findings.length >= 3);
});

// ── 컴파일 ────────────────────────────────────────────────────────────────────
test('컴파일: 엔진 id·placement:flow 주입, 순서 보존, 단일 insert-section op', () => {
  const frag = [
    { type: 'title', text: 'T' },
    { type: 'callout', variant: 'note', body: '<p>N</p>' },
    { type: 'richtext', html: '<p>R</p>' },
  ];
  const r = validateAiFragment(frag);
  const { op } = compileFragmentToInsertSection(r.objects, { anchor: { afterId: 'sec-1' }, genId: seq() });
  assert.equal(op.op, 'insert-section');
  assert.equal(op.afterId, 'sec-1');
  assert.deepEqual(op.objects.map((o) => o.type), ['title', 'callout', 'richtext']); // 순서 보존
  assert.deepEqual(op.objects.map((o) => o.id), ['frag-0', 'frag-1', 'frag-2']); // 엔진 발급
  assert.ok(op.objects.every((o) => o.placement === 'flow')); // flow 주입
});

test('컴파일: anchor(afterId|beforeId|pageId 정확히 하나) 필수', () => {
  const r = validateAiFragment([{ type: 'title', text: 'T' }]);
  assert.throws(() => compileFragmentToInsertSection(r.objects, { anchor: {} }), /anchor/);
  assert.throws(() => compileFragmentToInsertSection(r.objects, { anchor: { afterId: 'a', beforeId: 'b' } }), /anchor/);
  assert.throws(() => compileFragmentToInsertSection(r.objects, { anchor: { afterId: 'a', pageId: 'p1' } }), /anchor/);
  assert.doesNotThrow(() => compileFragmentToInsertSection(r.objects, { anchor: { beforeId: 'b' } }));
  // pageId 앵커(빈 페이지 저작): 개체 앵커 없이 op.pageId 만 실린다.
  const { op } = compileFragmentToInsertSection(r.objects, { anchor: { pageId: 'p1' }, genId: seq() });
  assert.equal(op.pageId, 'p1');
  assert.equal(op.afterId, undefined);
  assert.equal(op.beforeId, undefined);
});

test('컴파일 산출 op 는 aiBridge.validateResponse(v4) 를 통과한다', () => {
  const r = validateAiFragment([{ type: 'title', text: 'T' }, { type: 'answer-area', style: 'box' }]);
  const { op } = compileFragmentToInsertSection(r.objects, { anchor: { afterId: 'a' }, genId: seq() });
  const response = { id: 'req-1', schemaVersion: AI_SCHEMA_VERSION, ops: [op] };
  assert.equal(validateResponse(response), true);
});

test('컴파일 산출 개체는 전부 validateObjectShape 를 통과한다(구조 정합)', () => {
  const frag = [
    { type: 'title', text: 'T', level: 1 },
    { type: 'question', qtype: 'short-answer', prompt: 'q' },
    { type: 'table', splittable: false, rows: [[{ text: 'a', header: true }]] },
    { type: 'callout', variant: 'summary', body: '<p>핵심</p>' },
    { type: 'organizer', kind: 'venn', params: { circles: 2 }, labels: { left: '식물', right: '동물', common: '공통점' } },
  ];
  const r = validateAiFragment(frag);
  const { op } = compileFragmentToInsertSection(r.objects, { anchor: { afterId: 'a' }, genId: seq() });
  for (const o of op.objects) {
    const s = validateObjectShape(o);
    assert.equal(s.ok, true, `${o.type} shape fail: ${JSON.stringify(s.findings)}`);
  }
});

// ── stale ─────────────────────────────────────────────────────────────────────
test('stale: 요청 시점 pageVersions 를 봉투에 묶고 적용 직전 비교', () => {
  const r = validateAiFragment([{ type: 'title', text: 'T' }]);
  const compiled = compileFragmentToInsertSection(r.objects, { anchor: { afterId: 'a' }, pageVersions: { p1: 'v1', p2: 'v2' }, genId: seq() });
  assert.deepEqual(compiled.requestPageVersions, { p1: 'v1', p2: 'v2' });
  assert.equal(isFragmentStale(compiled.requestPageVersions, { p1: 'v1', p2: 'v2' }), false);
  assert.equal(isFragmentStale(compiled.requestPageVersions, { p1: 'v1', p2: 'v9' }), true); // 한 쪽 변경
  assert.equal(isFragmentStale(compiled.requestPageVersions, { p1: 'v1' }), true); // 페이지 소실
  assert.equal(isFragmentStale(null, { p1: 'v1' }), false); // 검사 불가 → 정책은 호출부
});
