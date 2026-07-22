import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_SCHEMA_VERSION, AI_SCHEMA_VERSIONS, canTransition, newRequestId, parseAction,
  excludedTypes, assertTargetable, validateRequest, validateResponse,
} from '../../src/usecases/aiBridge.js';

// E5 순수 정책: id·액션·타입 가드(§7·§10 유일 강제)·상태 전이·스키마.

const VOCAB = { types: { passage: { copyrightSlot: true }, 'standard-label': { gen: true }, question: {}, content: {} } };

test('newRequestId: 시각+난수 주입 결정성', () => {
  const id = newRequestId(new Date('2026-07-21T05:00:00.000Z'), () => 0.5);
  assert.match(id, /^req-20260721\d{6}-7fff$/);
});

test('parseAction: rewrite|fill-example 화이트리스트', () => {
  assert.equal(parseAction('rewrite'), 'rewrite');
  assert.equal(parseAction('fill-example'), 'fill-example');
  assert.throws(() => parseAction('delete-all'), /지원하지 않는 AI 액션/);
});

test('타입 가드: 저작권 슬롯·성취기준 gen 블록은 구조적 거부(§7·§10)', () => {
  const excluded = excludedTypes(VOCAB);
  assert.ok(excluded.has('passage') && excluded.has('standard-label'));
  assert.throws(() => assertTargetable('passage', VOCAB), /AI 액션 대상이 아닙니다/);
  assert.throws(() => assertTargetable('standard-label', VOCAB), /AI 액션 대상이 아닙니다/);
  assert.equal(assertTargetable('question', VOCAB), 'question');
  assert.equal(assertTargetable(undefined, VOCAB), 'content', '타입 없으면 content 로 허용');
  // vocabulary 부재(폴백)에도 standard-label 은 최소 보장 거부
  assert.throws(() => assertTargetable('standard-label', null), /대상이 아닙니다/);
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

test('F4: AI_SCHEMA_VERSION=2(신규 쓰기용)·관용 집합 {1,2}', () => {
  assert.equal(AI_SCHEMA_VERSION, 2, '신규 요청/응답은 v2 로 쓴다');
  assert.deepEqual([...AI_SCHEMA_VERSIONS].sort(), [1, 2], 'v1·v2 관용');
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
