import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';

// §6 E1 수용 실물 시연: 문서 생성 → 편집 → 다시 열기 → 버전 히스토리 왕복.
// CSV·Chrome 불필요(sci.json 은 standardsText 폴백, 렌더는 HTML 2벌까지).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

test('E1 수용: 생성→편집→다시 열기→히스토리 복원 왕복(비파괴·재렌더 일관)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-history-'));
  const doc = '광합성탐구';
  const paths = {
    manifest: join(base, doc, 'worksheet.manifest.json'),
    student: join(base, doc, 'worksheet-student.html'),
    meta: join(base, doc, '.worksheet-grab/meta.json'),
  };
  const readMeta = async () => JSON.parse(await readFile(paths.meta, 'utf8'));

  // 1) 생성 (rev1, snap 0001)
  const c1 = logger();
  assert.equal(await run(['doc', 'save', doc, '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base],
    { root: ROOT, log: c1.log, err: c1.err }), 0);
  const original = JSON.parse(await readFile(paths.manifest, 'utf8'));
  const studentV1 = await readFile(paths.student, 'utf8');
  assert.ok(studentV1.includes('실험 과정'), '3번 문항 존재(복원 확인용)');

  // 2) 편집 — 3번 문항 제거 (rev2, snap 0002)
  const c2 = logger();
  assert.equal(await run(['edit', '--doc', doc, '--workspaces-dir', base, '3번 문항 빼줘'],
    { root: ROOT, log: c2.log, err: c2.err }), 0);
  const studentV2 = await readFile(paths.student, 'utf8');
  assert.ok(!studentV2.includes('실험 과정에 따라 전압을 바꾸며'), '편집이 student HTML 재렌더에 반영');

  // 3) 다시 열기 — rev2·히스토리 2·경고 없음
  const c3 = logger();
  assert.equal(await run(['doc', 'open', doc, '--workspaces-dir', base], { root: ROOT, log: c3.log, err: c3.err }), 0);
  assert.ok(c3.lines.some((l) => /rev 2/.test(l)));
  assert.ok(c3.lines.some((l) => /스냅샷 2개/.test(l)));
  assert.ok(!c3.lines.some((l) => /⚠/.test(l)), '정합 문서는 경고 없음');

  // 4) 히스토리 왕복 — 스냅샷 0001 복원(rev3, 비파괴)
  const c4 = logger();
  assert.equal(await run(['doc', 'restore', doc, '0001', '--workspaces-dir', base], { root: ROOT, log: c4.log, err: c4.err }), 0);
  const restored = JSON.parse(await readFile(paths.manifest, 'utf8'));
  assert.deepEqual(restored, original, '복원 = 스냅샷 0001 내용');
  assert.equal((await readMeta()).revision, 3, '복원도 새 리비전(비파괴 — 되돌리기의 되돌리기 가능)');
  const c5 = logger();
  await run(['doc', 'history', doc, '--workspaces-dir', base], { root: ROOT, log: c5.log, err: c5.err });
  assert.equal(c5.lines.filter((l) => /^  \d{4}-/.test(l)).length, 3, '복원 자체도 스냅샷으로 남음');
  const studentV3 = await readFile(paths.student, 'utf8');
  assert.ok(studentV3.includes('실험 과정'), 'restore 가 SaveDocument 경유 재렌더 — manifest·HTML 파생 일관(P1)');
});
