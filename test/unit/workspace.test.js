import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import {
  normalizeDocName, workspaceLayout, snapshotName, nextSnapshotSerial,
  buildMeta, checkCommitIntegrity,
} from '../../src/usecases/workspace.js';

// E1 순수 정책 단위(FS·Chrome 무관).

test('normalizeDocName: 한글 보존·비허용문자 _ 치환·trim·빈이름 거부', () => {
  assert.equal(normalizeDocName('광합성탐구'), '광합성탐구');
  assert.equal(normalizeDocName('광합성 탐구 (2차)'), '광합성_탐구_2차');
  assert.equal(normalizeDocName('  이름  '), '이름');
  assert.equal(normalizeDocName('../evil'), 'evil', '경로 구분자·점은 제거됨');
  assert.throws(() => normalizeDocName(''), /문서명이 비어/);
  assert.throws(() => normalizeDocName('///'), /문서명이 비어/);
});

test('workspaceLayout: §5 경로 파생 — htmlPath(통합본) 없음', () => {
  const l = workspaceLayout('base', '문서');
  assert.equal(l.dir, `base${sep}문서`);
  assert.ok(l.manifestPath.endsWith('worksheet.manifest.json'));
  assert.ok(l.studentPath.endsWith('worksheet-student.html'));
  assert.ok(l.teacherPath.endsWith('worksheet-teacher.html'));
  assert.ok(l.metaPath.endsWith(`meta.json`) && l.metaPath.includes('.worksheet-grab'));
  assert.ok(l.assetsDir.endsWith('assets') && l.historyDir.endsWith('history'));
  assert.ok(!('htmlPath' in l), '통합본 슬롯은 E1 미포함(정답 누출 벡터 — E2 예약)');
});

test('snapshotName / nextSnapshotSerial: 4자리 일련번호 단조증가', () => {
  const d = new Date('2026-07-21T10:15:30.123Z');
  assert.equal(snapshotName(3, d), '0003-20260721T101530Z.manifest.json');
  assert.equal(nextSnapshotSerial([]), 1);
  assert.equal(nextSnapshotSerial(['0001-a.manifest.json', '0007-b.manifest.json']), 8);
  assert.equal(nextSnapshotSerial(['junk.txt']), 1, '규격 밖 파일명은 무시');
});

test('buildMeta: createdAt 보존·revision 증가·unsafe 반영', () => {
  const manifest = { docTitle: '제목', subject: 'science', standards: ['[9과14-02]'], paper: { size: 'B4' } };
  const t1 = new Date('2026-07-21T01:00:00.000Z');
  const m1 = buildMeta('문서', manifest, { now: t1 });
  assert.equal(m1.schemaVersion, 1);
  assert.equal(m1.revision, 1);
  assert.equal(m1.createdAt, t1.toISOString());
  assert.equal(m1.unsafe, false);
  assert.deepEqual(m1.paper, { size: 'B4' });

  const t2 = new Date('2026-07-21T02:00:00.000Z');
  const m2 = buildMeta('문서', manifest, { now: t2, prev: m1, unsafe: true });
  assert.equal(m2.revision, 2);
  assert.equal(m2.createdAt, t1.toISOString(), '최초 생성 시각 보존');
  assert.equal(m2.updatedAt, t2.toISOString());
  assert.equal(m2.unsafe, true);
});

test('checkCommitIntegrity: meta 부재·revision↔스냅샷 불일치·unsafe 경고', () => {
  const none = checkCommitIntegrity({ meta: null, snapshots: [] });
  assert.equal(none.ok, false);
  assert.match(none.warnings[0], /meta\.json 이 없습니다/);

  const mismatch = checkCommitIntegrity({ meta: { revision: 3, unsafe: false }, snapshots: ['0001-a', '0002-b'] });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.warnings[0], /revision\(3\).*스냅샷 개수\(2\)/);

  const unsafe = checkCommitIntegrity({ meta: { revision: 1, unsafe: true }, snapshots: ['0001-a'] });
  assert.ok(unsafe.warnings.some((w) => /unsafe/.test(w)));

  const ok = checkCommitIntegrity({ meta: { revision: 2, unsafe: false }, snapshots: ['0001-a', '0002-b'] });
  assert.deepEqual(ok, { ok: true, warnings: [] });
});
