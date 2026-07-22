import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkbook,
  memberStartPages,
  samePaper,
  resolveWorkbookPaper,
  checkUniformPaper,
  canTransitionStatus,
  upsertMember,
  assertNoRowCollisions,
  buildDocName,
  orderedMembers,
  WORKBOOK_STATUSES,
} from '../../src/usecases/workbook.js';

// workbook — 자료집 장부 순수 정책 단위 테스트(합의 계획 §2(b)·§4·C3).

// ── validateWorkbook: 스키마 ────────────────────────────────────────────

test('validateWorkbook: 최소 유효 스키마 정규화(paper 기본 a4)', () => {
  const wb = validateWorkbook({ title: '과학 자료집', members: [{ docName: '문서A' }] });
  assert.equal(wb.title, '과학 자료집');
  assert.equal(wb.paper, 'a4');
  assert.equal(wb.members.length, 1);
  assert.equal(wb.members[0].docName, '문서A');
  assert.equal(wb.members[0].status, 'pending'); // 기본
  assert.equal(wb.members[0].order, 0); // 기본 = 인덱스
});

test('validateWorkbook: 빈/비문자열 title 거부', () => {
  assert.throws(() => validateWorkbook({ title: '', members: [] }), /title/);
  assert.throws(() => validateWorkbook({ members: [] }), /title/);
  assert.throws(() => validateWorkbook(null), /객체/);
});

test('validateWorkbook: 잘못된 status·용지 거부, tocTitle/tocStandards 보존', () => {
  assert.throws(() => validateWorkbook({ title: 't', members: [{ docName: 'a', status: 'done' }] }), /status/);
  assert.throws(() => validateWorkbook({ title: 't', paper: { size: 'A9' }, members: [] }), /지원하지 않는 용지/);
  const wb = validateWorkbook({ title: 't', members: [{ docName: 'a', tocTitle: '광합성', tocStandards: ['[9과14-02]'] }] });
  assert.equal(wb.members[0].tocTitle, '광합성');
  assert.deepEqual(wb.members[0].tocStandards, ['[9과14-02]']);
});

test('validateWorkbook: docName 중복 거부', () => {
  assert.throws(() => validateWorkbook({ title: 't', members: [{ docName: 'a' }, { docName: 'a' }] }), /중복/);
});

test('WORKBOOK_STATUSES 는 pending/saved/failed', () => {
  assert.deepEqual(WORKBOOK_STATUSES, ['pending', 'saved', 'failed']);
});

// ── memberStartPages: 본문상대 시작쪽 ──────────────────────────────────

test('memberStartPages: 시작쪽 = 1 + Σ앞 멤버 섹션 수', () => {
  assert.deepEqual(memberStartPages([3, 2, 4]), [1, 4, 6]);
  assert.deepEqual(memberStartPages([1, 1, 1]), [1, 2, 3]);
  assert.deepEqual(memberStartPages([]), []);
});

test('memberStartPages: 음수·비정수 섹션 수 거부', () => {
  assert.throws(() => memberStartPages([1, -1]), /섹션 수/);
  assert.throws(() => memberStartPages([1.5]), /섹션 수/);
});

// ── samePaper (C3): 4필드 직접 동치, matchPreset 금지 ───────────────────

test('C3: null ≡ "a4" ≡ {size:"A4"} (기본 A4 정규화)', () => {
  assert.ok(samePaper(null, 'a4'));
  assert.ok(samePaper('a4', { size: 'A4' }));
  assert.ok(samePaper(null, { size: 'A4' }));
});

test('C3: 서로 다른 규격은 불일치', () => {
  assert.ok(!samePaper('a4', 'b4'));
  assert.ok(!samePaper({ size: 'A4', orientation: 'portrait' }, { size: 'A4', orientation: 'landscape' }));
  assert.ok(!samePaper({ size: 'A4', columns: 1 }, { size: 'A4', columns: 2 }));
});

test('C3(핵심): 서로 다른 두 custom 용지(같은 size, 다른 margins)는 불일치 — matchPreset fail-open 방지', () => {
  // matchPreset 은 둘 다 "custom" 으로 분류해 동일 취급(fail-open)한다. 4필드 직접 동치는 거부한다.
  const customA = { size: 'A4', margins: '20mm' };
  const customB = { size: 'A4', margins: '15mm' };
  assert.ok(!samePaper(customA, customB), '다른 margins 의 두 custom 은 불일치여야 한다');
  // 반사성 확인.
  assert.ok(samePaper(customA, { size: 'A4', margins: '20mm' }));
});

test('resolveWorkbookPaper: 항상 4필드 정규형 반환', () => {
  const r = resolveWorkbookPaper('a4');
  assert.deepEqual(Object.keys(r).sort(), ['columns', 'margins', 'orientation', 'size']);
  assert.equal(r.size, 'A4');
});

// ── checkUniformPaper: 불일치 멤버 지목 ─────────────────────────────────

test('checkUniformPaper: 불일치 멤버 지목(fail-closed)', () => {
  const wb = validateWorkbook({ title: 't', paper: 'a4', members: [] });
  const res = checkUniformPaper(wb, [
    { docName: 'ok1', paper: null },
    { docName: 'ok2', paper: { size: 'A4' } },
    { docName: 'bad', paper: { size: 'B4' } },
  ]);
  assert.equal(res.ok, false);
  assert.equal(res.mismatches.length, 1);
  assert.equal(res.mismatches[0].docName, 'bad');
});

test('checkUniformPaper: 전부 동일하면 ok', () => {
  const wb = validateWorkbook({ title: 't', paper: 'a4', members: [] });
  const res = checkUniformPaper(wb, [{ docName: 'a', paper: null }, { docName: 'b', paper: 'a4' }]);
  assert.ok(res.ok);
  assert.deepEqual(res.mismatches, []);
});

// ── status 전이 ─────────────────────────────────────────────────────────

test('canTransitionStatus: pending→saved/failed, failed 재시도, saved terminal', () => {
  assert.ok(canTransitionStatus('pending', 'saved'));
  assert.ok(canTransitionStatus('pending', 'failed'));
  assert.ok(!canTransitionStatus('pending', 'pending'));
  assert.ok(canTransitionStatus('failed', 'saved'));
  assert.ok(canTransitionStatus('failed', 'pending'));
  assert.ok(!canTransitionStatus('saved', 'failed'));
  assert.ok(!canTransitionStatus('saved', 'pending'));
});

// ── upsert 멱등 + 행-충돌 ───────────────────────────────────────────────

test('upsertMember: 신규는 추가, 기존은 status 보존·스킵(멱등)', () => {
  let members = [];
  ({ members } = upsertMember(members, { docName: 'a', order: 0 }));
  assert.equal(members.length, 1);
  // 'a' 를 saved 로 전이.
  members = members.map((m) => (m.docName === 'a' ? { ...m, status: 'saved' } : m));
  // 재-plan: 같은 docName 을 pending 으로 다시 넣어도 기존(saved) 보존.
  const res = upsertMember(members, { docName: 'a', order: 0, status: 'pending' });
  assert.equal(res.added, false);
  assert.equal(res.members.length, 1);
  assert.equal(res.members[0].status, 'saved', '기존 status 보존(멱등)');
  // 신규 'b' 는 추가.
  const res2 = upsertMember(res.members, { docName: 'b', order: 1 });
  assert.equal(res2.added, true);
  assert.equal(res2.members.length, 2);
});

test('assertNoRowCollisions: 서로 다른 행이 같은 docName 이면 error', () => {
  assert.throws(
    () => assertNoRowCollisions([{ docName: 'x-01-a', __row: 1 }, { docName: 'x-01-a', __row: 2 }]),
    /행-충돌/,
  );
  assert.doesNotThrow(() => assertNoRowCollisions([{ docName: 'a' }, { docName: 'b' }]));
});

// ── buildDocName ────────────────────────────────────────────────────────

test('buildDocName: <slug>-NN-<topicSlug>, 한글 보존, NN 2자리', () => {
  assert.equal(buildDocName('과학 자료집', 1, '광합성'), '과학_자료집-01-광합성');
  assert.equal(buildDocName('bio', 12, 'cells'), 'bio-12-cells');
});

test('buildDocName: 빈 topic(정규화 후 빈문자)은 fail-closed', () => {
  assert.throws(() => buildDocName('x', 1, ''), /비어/);
  assert.throws(() => buildDocName('x', 1, '!!!'), /비어/);
});

// ── orderedMembers ──────────────────────────────────────────────────────

test('orderedMembers: order 오름차순, 동률이면 docName', () => {
  const wb = validateWorkbook({
    title: 't',
    members: [
      { docName: 'c', order: 2 },
      { docName: 'a', order: 1 },
      { docName: 'b', order: 1 },
    ],
  });
  assert.deepEqual(orderedMembers(wb).map((m) => m.docName), ['a', 'b', 'c']);
});
