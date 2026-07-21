import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_SCHEMA_VERSION, canTransition, newRequestId, parseAction,
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

test('스키마 검증: 요청·응답 필수 필드', () => {
  const req = {
    schemaVersion: AI_SCHEMA_VERSION, id: 'req-1', docName: '문서', action: 'rewrite',
    block: { bp: 0, bi: 1, bt: 'question', html: '<div class="q">문항</div>' }, status: 'pending',
  };
  assert.equal(validateRequest(req), true);
  assert.equal(validateRequest({ ...req, action: 'hack' }), false);
  assert.equal(validateRequest({ ...req, block: null }), false);
  assert.equal(validateRequest({ ...req, docName: '' }), false);

  assert.equal(validateResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'req-1', html: '<p>재작성</p>' }), true);
  assert.equal(validateResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'req-1', html: '  ' }), false);
});
