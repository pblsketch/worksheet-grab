import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_SCHEMA_VERSION, AI_SCHEMA_VERSIONS, canTransition, newRequestId, parseAction,
  excludedTypes, assertTargetable, validateRequest, validateResponse,
} from '../../src/usecases/aiBridge.js';

// E5 순수 정책: id·액션·타입 가드(§7·§10 유일 강제)·상태 전이·스키마.

test('newRequestId: 시각+난수 주입 결정성', () => {
  const id = newRequestId(new Date('2026-07-21T05:00:00.000Z'), () => 0.5);
  assert.match(id, /^req-20260721\d{6}-7fff$/);
});

test('parseAction: rewrite|fill-example 화이트리스트', () => {
  assert.equal(parseAction('rewrite'), 'rewrite');
  assert.equal(parseAction('fill-example'), 'fill-example');
  assert.throws(() => parseAction('delete-all'), /지원하지 않는 AI 액션/);
});

test('3층 정책(2026-07-23 2차 델타): 성취기준(std-box)만 AI 대상 구조적 거부 — passage-slot 은 해제', () => {
  const excluded = excludedTypes();
  assert.deepEqual([...excluded].sort(), ['std-box']);
  assert.throws(() => assertTargetable('std-box'), /AI 액션 대상이 아닙니다/);
  assert.equal(assertTargetable('passage-slot'), 'passage-slot', '명시 요청 시 AI 가 지문을 창작·재구성할 수 있어야 함(가드 해제)');
  assert.equal(assertTargetable('question'), 'question');
  assert.equal(assertTargetable('title'), 'title');
});

test('상태 전이: cancelled·applied 는 terminal, answered 이후에만 applied', () => {
  assert.equal(canTransition('pending', 'answered'), true);
  assert.equal(canTransition('pending', 'cancelled'), true);
  assert.equal(canTransition('answered', 'applied'), true);
  assert.equal(canTransition('answered', 'cancelled'), true, '미리보기 폐기 허용');
  assert.equal(canTransition('pending', 'applied'), false, '응답 전 적용 불가');
  assert.equal(canTransition('cancelled', 'answered'), false, 'terminal — respond 부활 금지');
  assert.equal(canTransition('applied', 'cancelled'), false);
});

test('Phase 4: AI_SCHEMA_VERSION=4(신규 쓰기용, ops 계획)·관용 집합 {1,2,3,4}', () => {
  assert.equal(AI_SCHEMA_VERSION, 4, '신규 응답은 v4(ops[]) 로 쓴다');
  assert.deepEqual([...AI_SCHEMA_VERSIONS].sort(), [1, 2, 3, 4], 'v1·v2·v3 in-flight 파일도 계속 관용');
});

test('F4 요청 스키마: v1(단일 block)·v2(blocks[]) 동시 수용 + 형태-버전 정합', () => {
  const v1 = {
    schemaVersion: 1, id: 'req-1', docName: '문서', action: 'rewrite',
    block: { bp: 0, bi: 1, bt: 'question', html: '<div class="q">문항</div>' }, status: 'pending',
  };
  const v2 = {
    schemaVersion: 2, id: 'req-2', docName: '문서', action: 'rewrite',
    blocks: [
      { bp: 0, bi: 1, bt: 'question', html: '<div class="q">문항A</div>' },
      { bp: 0, bi: 3, bt: 'subq', html: '<p class="subq">문항B</p>' },
    ], status: 'pending',
  };
  assert.equal(validateRequest(v1), true, 'v1 in-flight 파일 유효(신 코드에서도)');
  assert.equal(validateRequest(v2), true, 'v2 다중 블록 유효');
  // 공통 필수 필드
  assert.equal(validateRequest({ ...v2, action: 'hack' }), false);
  assert.equal(validateRequest({ ...v2, docName: '' }), false);
  assert.equal(validateRequest({ ...v1, block: null }), false, 'v1 block 필수');
  // 형태-버전 정합: blocks[] 없는 v2 거부, block 없는 v1 거부, 빈 blocks 거부
  assert.equal(validateRequest({ schemaVersion: 2, id: 'x', docName: '문서', action: 'rewrite', block: v1.block }), false, 'v2 인데 blocks[] 없음 → 거부');
  assert.equal(validateRequest({ ...v2, blocks: [] }), false, '빈 blocks 거부');
  assert.equal(validateRequest({ ...v2, blocks: [{ bt: 'q' }] }), false, 'blocks 원소 html 필수');
  // 미지원 스키마 버전 거부
  assert.equal(validateRequest({ ...v2, schemaVersion: 3 }), false);
});

test('team-fix: v2 요청 blocks 원소 slot 명시 수용(있어도/없어도 관용)', () => {
  const withSlot = {
    schemaVersion: 2, id: 'r', docName: '문서', action: 'rewrite',
    blocks: [{ slot: 0, bt: 'question', html: '<p>A</p>' }, { slot: 1, bt: 'subq', html: '<p>B</p>' }],
    status: 'pending',
  };
  const noSlot = { ...withSlot, id: 'r2', blocks: [{ bt: 'question', html: '<p>A</p>' }] };
  assert.equal(validateRequest(withSlot), true, 'slot 명시 원소 수용');
  assert.equal(validateRequest(noSlot), true, 'slot 없는 원소도 관용(하위호환)');
});

test('F4 응답 스키마: v1(html)·v2(blocks[{slot,html}]) 동시 수용 + 형태-버전 정합', () => {
  assert.equal(validateResponse({ schemaVersion: 1, id: 'req-1', html: '<p>재작성</p>' }), true, 'v1 응답');
  assert.equal(validateResponse({ schemaVersion: 1, id: 'req-1', html: '  ' }), false, 'v1 빈 html 거부');
  const v2 = { schemaVersion: 2, id: 'req-2', blocks: [{ slot: 0, html: '<p>A</p>' }, { slot: 1, html: '<p>B</p>' }] };
  assert.equal(validateResponse(v2), true, 'v2 다중 슬롯 응답');
  assert.equal(validateResponse({ ...v2, blocks: [] }), false, '빈 blocks 거부');
  assert.equal(validateResponse({ ...v2, blocks: [{ slot: -1, html: '<p>x</p>' }] }), false, 'slot 은 정수≥0');
  assert.equal(validateResponse({ ...v2, blocks: [{ slot: 0, html: '  ' }] }), false, '슬롯 html 비어있으면 거부');
  assert.equal(validateResponse({ ...v2, blocks: [{ html: '<p>x</p>' }] }), false, 'slot 누락 거부');
  assert.equal(validateResponse({ schemaVersion: 2, id: 'x', html: '<p>단일</p>' }), false, 'v2 인데 blocks[] 없음 → 거부');
});

test('S4.0 요청 스키마 v3: objects[{id,type,…현재 개체 필드}](개체 ID 에코, worksheet-designer 계약) 필수', () => {
  const v3 = {
    schemaVersion: 3, id: 'req-3', docName: '문서', action: 'rewrite',
    objects: [
      { id: 'o1', type: 'title', placement: 'flow', text: '제목' },
      { id: 'o4', type: 'question', placement: 'flow', qtype: 'essay', prompt: '문항' },
    ],
    status: 'pending',
  };
  assert.equal(validateRequest(v3), true, 'v3 다중 개체(전체 필드 그대로) 유효');
  assert.equal(validateRequest({ ...v3, objects: [] }), false, '빈 objects 거부');
  assert.equal(validateRequest({ ...v3, objects: [{ id: 'o1' }] }), false, '원소에 type 필수');
  assert.equal(validateRequest({ ...v3, objects: [{ type: 'title', text: '제목' }] }), false, '원소에 id 필수');
});

test('S4.0 응답 스키마 v3: objects[{id,object}](개체 ID 에코) 필수', () => {
  const v3 = {
    schemaVersion: 3, id: 'req-3',
    objects: [{ id: 'o1', object: { id: 'o1', type: 'title', text: '수정된 제목' } }],
  };
  assert.equal(validateResponse(v3), true, 'v3 개체 에코 응답 유효');
  assert.equal(validateResponse({ ...v3, objects: [] }), false, '빈 objects 거부');
  assert.equal(validateResponse({ ...v3, objects: [{ object: { id: 'o1', type: 'title' } }] }), false, '원소에 id 필수');
  assert.equal(validateResponse({ ...v3, objects: [{ id: 'o1' }] }), false, '원소에 object 필수');
  assert.equal(validateResponse({ ...v3, objects: [{ id: 'o1', object: { id: 'o1' } }] }), false, 'object 에 type 필수(개체 스키마 최소 보장)');
});

// ── Phase 4: v4 ops[] — 개수·종류가 자유로운 결과 계획 ──
// v3 의 objects:[{id,object}] 는 대상 ID 에코라 1:1 치환만 표현할 수 있었다. v4 는 "3개를 1개로
// 합치기"·"1개를 2개로 나누기"·"삭제"를 하나의 계획으로 싣는다(PRD v2.1 §11.3).

const obj = (id, type = 'question') => ({ id, type, prompt: '문항' });
const v4res = (ops) => ({ schemaVersion: 4, id: 'req-4', ops });

test('Phase 4 응답: v4 ops 3종(replace·insert·delete) 수용', () => {
  assert.equal(validateResponse(v4res([{ op: 'replace', id: 'q1', object: obj('q1') }])), true, 'replace');
  assert.equal(validateResponse(v4res([{ op: 'insert', object: obj('new1'), afterId: 'q1' }])), true, 'insert(afterId)');
  assert.equal(validateResponse(v4res([{ op: 'insert', object: obj('new1'), beforeId: 'q1' }])), true, 'insert(beforeId)');
  assert.equal(validateResponse(v4res([{ op: 'insert', object: obj('new1') }])), true, 'insert(위치 미지정 = 말미)');
  assert.equal(validateResponse(v4res([{ op: 'delete', id: 'q2' }])), true, 'delete');
});

test('Phase 4 응답: 개수를 바꾸는 계획이 하나의 응답으로 표현된다(1:1 강제 해제)', () => {
  // 문항 3개 → 단계형 활동 1개: 하나를 결과로 치환하고 나머지 둘을 지운다.
  const merge = v4res([
    { op: 'replace', id: 'q1', object: { id: 'q1', type: 'question', prompt: '통합 활동' } },
    { op: 'delete', id: 'q2' },
    { op: 'delete', id: 'q3' },
  ]);
  assert.equal(validateResponse(merge), true, '3→1 합치기');

  // 표 1개 → 표 + 설명문 2개: 치환 후 뒤에 새 개체를 끼운다.
  const split = v4res([
    { op: 'replace', id: 't1', object: { id: 't1', type: 'table', rows: [] } },
    { op: 'insert', object: { id: 'rt-new', type: 'richtext', html: '<p>설명</p>' }, afterId: 't1' },
  ]);
  assert.equal(validateResponse(split), true, '1→2 나누기');
});

test('Phase 4 응답: 형태 위반 거부', () => {
  assert.equal(validateResponse({ schemaVersion: 4, id: 'r', ops: [] }), false, '빈 ops 거부');
  assert.equal(validateResponse({ schemaVersion: 4, id: 'r' }), false, 'v4 인데 ops[] 없음 → 거부');
  assert.equal(validateResponse(v4res([{ op: 'move', id: 'q1' }])), false, '알 수 없는 op 거부');
  assert.equal(validateResponse(v4res([{ op: 'replace', object: obj('q1') }])), false, 'replace 는 id 필수');
  assert.equal(validateResponse(v4res([{ op: 'replace', id: 'q1' }])), false, 'replace 는 object 필수');
  assert.equal(validateResponse(v4res([{ op: 'delete' }])), false, 'delete 는 id 필수');
  assert.equal(validateResponse(v4res([{ op: 'insert', afterId: 'q1' }])), false, 'insert 는 object 필수');
  assert.equal(validateResponse(v4res([{ op: 'insert', object: { id: 'x' }, afterId: 'q1' }])), false, 'object 에 type 필수');
  assert.equal(
    validateResponse(v4res([{ op: 'insert', object: obj('n'), afterId: 'q1', beforeId: 'q2' }])),
    false,
    'insert 에 afterId·beforeId 동시 지정 거부(어느 기준인지 모호 → 엉뚱한 자리 삽입 방지)',
  );
});

test('Phase 4 응답: 형태-버전 정합이 양방향으로 강제된다', () => {
  const v3shape = [{ id: 'o1', object: { id: 'o1', type: 'title' } }];
  assert.equal(validateResponse({ schemaVersion: 4, id: 'r', objects: v3shape }), false, 'v4 인데 v3 형태 → 거부');
  assert.equal(
    validateResponse({ schemaVersion: 3, id: 'r', ops: [{ op: 'delete', id: 'q1' }] }),
    false,
    'v3 인데 v4 형태 → 거부',
  );
});

test('Phase 4 요청: pageId·pageVersion·scope 는 선택이되 있으면 형태를 강제한다', () => {
  const base = {
    schemaVersion: 4, id: 'req-4', docName: '문서', action: 'rewrite',
    objects: [{ id: 'o1', type: 'title' }], status: 'pending',
  };
  assert.equal(validateRequest(base), true, '선택 필드 없이도 유효(단계적 도입)');
  assert.equal(validateRequest({ ...base, pageId: 'page-1', pageVersion: 'sha256:abc', scope: 'objects' }), true);
  assert.equal(validateRequest({ ...base, scope: 'page' }), true, "scope:'page' 수용");
  assert.equal(validateRequest({ ...base, scope: 'everything' }), false, '알 수 없는 scope 거부');
  assert.equal(validateRequest({ ...base, pageId: '' }), false, '빈 pageId 거부');
  assert.equal(validateRequest({ ...base, pageVersion: 123 }), false, 'pageVersion 은 문자열');
  assert.equal(validateRequest({ ...base, objects: [] }), false, 'v4 도 objects[] 는 필수');
});
