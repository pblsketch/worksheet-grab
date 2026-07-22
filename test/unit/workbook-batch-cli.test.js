import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { buildDocName, assertNoRowCollisions } from '../../src/usecases/workbook.js';

// T7b — workbook batch-plan/status/mark CLI(합의 계획 §2(c)·§4 Phase 3). 무API: 배치는
// 콘텐츠를 저작하지 않고 멱등 장부만 등록한다(status:pending) — 실제 저작·상태 전이는
// 하네스가 workbook mark 로 기록한다. Chrome 불필요(순수 FS) — 전 테스트 실행 가능.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

async function tmpBase(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

const LIST_ROWS = [
  { subject: '과학', grade: '중2', topic: '광합성', standardCode: '[9과14-02]', title: '광합성 탐구' },
  { subject: '국어', grade: '중1', topic: '설명문 구조' },
  { subject: '사회', grade: '중3', topic: '민주주의' },
];

async function fixture() {
  const wbBase = await tmpBase('wsg-wbbatch-');
  const listPath = join(wbBase, 'list.json');
  await writeFile(listPath, JSON.stringify(LIST_ROWS, null, 2), 'utf8');
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  return { wbBase, listPath };
}

async function readWb(wbBase, name = '집') {
  return JSON.parse(await readFile(join(wbBase, name, 'workbook.json'), 'utf8'));
}

// 기대 docName(파일 내 1-based 순번을 NN 으로 사용 — 재실행 결정성의 근거).
function expectedDocNames() {
  return LIST_ROWS.map((r, i) => buildDocName('집', i + 1, r.topic));
}

// ── batch-plan: 등록 + 멱등 재실행 ─────────────────────────────────────

test('batch-plan: 3건 신규 등록(status:pending, docName=buildDocName) + 요약 로그', async () => {
  const { wbBase, listPath } = await fixture();
  const { lines, log, err } = logger();
  const code = await run(['workbook', 'batch-plan', '집', '--from', listPath, '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  const wb = await readWb(wbBase);
  assert.equal(wb.members.length, 3);
  const names = expectedDocNames();
  assert.deepEqual(wb.members.map((m) => m.docName), names);
  assert.ok(wb.members.every((m) => m.status === 'pending'));
  assert.equal(wb.members[0].tocTitle, '광합성 탐구');
  assert.deepEqual(wb.members[0].tocStandards, ['[9과14-02]']);
  assert.ok(lines.some((l) => /신규 3개.*스킵.*0개/.test(l)));
});

test('batch-plan 멱등 재실행: 동일 목록 재등록은 멤버 수 불변 + 기존 status 보존(스킵)', async () => {
  const { wbBase, listPath } = await fixture();
  const q = logger();
  await run(['workbook', 'batch-plan', '집', '--from', listPath, '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  const names = expectedDocNames();
  await run(['workbook', 'mark', '집', names[0], 'saved', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  const code = await run(['workbook', 'batch-plan', '집', '--from', listPath, '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  const wb = await readWb(wbBase);
  assert.equal(wb.members.length, 3, '재-plan 중복 없음 — 멤버 수 불변');
  assert.equal(wb.members.find((m) => m.docName === names[0]).status, 'saved', '기존 status(saved) 보존');
  assert.ok(lines.some((l) => /신규 0개.*스킵.*3개/.test(l)));
});

test('batch-plan: --csv 로 CSV 형식 강제(VALUE_FLAGS 값-필수 --csv <path> 와 무충돌 회귀)', async () => {
  const wbBase = await tmpBase('wsg-wbbatch-csv-');
  const csv = [
    '교과,학년,주제,성취기준 코드',
    '과학,중2,광합성,[9과14-02]',
    '국어,중1,설명문 구조,',
  ].join('\n');
  const csvPath = join(wbBase, 'list.csv');
  await writeFile(csvPath, csv, 'utf8');
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });

  const { log, err } = logger();
  const code = await run(['workbook', 'batch-plan', '집', '--from', csvPath, '--csv', '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0, '--csv 불리언이 값-필수 VALUE_FLAGS 검사에 걸리지 않아야 한다');
  const wb = await readWb(wbBase);
  assert.equal(wb.members.length, 2);
});

test('batch-plan: 빈 --from 목록·인자 검증', async () => {
  const { wbBase } = await fixture();
  await assert.rejects(() => run(['workbook', 'batch-plan'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명>/);
  await assert.rejects(
    () => run(['workbook', 'batch-plan', '집', '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} }),
    /--from/,
  );
  await assert.rejects(
    () => run(['workbook', 'batch-plan', '없는집', '--from', join(wbBase, 'list.json'), '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} }),
    /자료집이 없습니다/,
  );
});

// ── mark: 상태 전이 ─────────────────────────────────────────────────────

test('mark: pending→saved/failed 반영 + 미등록 문서·잘못된 상태값 거부', async () => {
  const { wbBase, listPath } = await fixture();
  const q = logger();
  await run(['workbook', 'batch-plan', '집', '--from', listPath, '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  const names = expectedDocNames();

  const { log, err } = logger();
  assert.equal(await run(['workbook', 'mark', '집', names[0], 'saved', '--workbooks-dir', wbBase], { root: ROOT, log, err }), 0);
  assert.equal(await run(['workbook', 'mark', '집', names[1], 'failed', '--workbooks-dir', wbBase], { root: ROOT, log, err }), 0);
  let wb = await readWb(wbBase);
  assert.equal(wb.members.find((m) => m.docName === names[0]).status, 'saved');
  assert.equal(wb.members.find((m) => m.docName === names[1]).status, 'failed');
  assert.equal(wb.members.find((m) => m.docName === names[2]).status, 'pending', '건드리지 않은 3번째는 pending 유지');

  await assert.rejects(
    () => run(['workbook', 'mark', '집', '없는문서', 'saved', '--workbooks-dir', wbBase], { root: ROOT, log, err }),
    /등록되지 않은 문서입니다/,
  );
  await assert.rejects(
    () => run(['workbook', 'mark', '집', names[2], 'pending', '--workbooks-dir', wbBase], { root: ROOT, log, err }),
    /saved\|failed/,
  );
});

test('mark: 잘못된 전이 거부(saved 는 terminal — saved→failed 불가)', async () => {
  const { wbBase, listPath } = await fixture();
  const q = logger();
  await run(['workbook', 'batch-plan', '집', '--from', listPath, '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  const names = expectedDocNames();
  await run(['workbook', 'mark', '집', names[0], 'saved', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });

  await assert.rejects(
    () => run(['workbook', 'mark', '집', names[0], 'failed', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err }),
    /전이는 허용되지 않습니다/,
  );
  const wb = await readWb(wbBase);
  assert.equal(wb.members.find((m) => m.docName === names[0]).status, 'saved', '거부된 전이는 반영되지 않는다');
});

test('mark: <자료집명> <문서명> <saved|failed> 인자 검증', async () => {
  const { wbBase } = await fixture();
  await assert.rejects(() => run(['workbook', 'mark'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명> <문서명>/);
  await assert.rejects(() => run(['workbook', 'mark', '집'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명> <문서명>/);
  await assert.rejects(
    () => run(['workbook', 'mark', '집', '문서A'], { root: ROOT, log: () => {}, err: () => {} }),
    /<자료집명> <문서명>/,
  );
});

// ── status: 집계 + 재개 대상 ────────────────────────────────────────────

test('status: pending/saved/failed 집계 + 재개 대상(status≠saved) 목록', async () => {
  const { wbBase, listPath } = await fixture();
  const q = logger();
  await run(['workbook', 'batch-plan', '집', '--from', listPath, '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  const names = expectedDocNames();
  await run(['workbook', 'mark', '집', names[0], 'saved', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'mark', '집', names[1], 'saved', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'mark', '집', names[2], 'failed', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  const code = await run(['workbook', 'status', '집', '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => /전체 3개\(pending 0 · saved 2 · failed 1\)/.test(l)));
  assert.ok(lines.some((l) => /재개 대상\(status≠saved\) 1개/.test(l)));
  assert.ok(lines.some((l) => l.includes(names[2]) && /failed/.test(l)));
  assert.ok(!lines.some((l) => l.trim().startsWith(names[0])), 'saved 멤버는 재개 대상 목록에 없음');
});

test('status: <자료집명> 누락·존재하지 않는 자료집 오류', async () => {
  const wbBase = await tmpBase('wsg-wbbatch-statusargs-');
  await assert.rejects(() => run(['workbook', 'status'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명>/);
  await assert.rejects(
    () => run(['workbook', 'status', '없는집', '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} }),
    /자료집이 없습니다/,
  );
});

// ── 행-충돌 가드(assertNoRowCollisions) — 방어선 자체 재확인 ─────────────
//
// NN(=buildDocName 의 두 번째 인자)은 batchList 가 부여하는 행의 파일 내 1-based
// 순번이라 parseBatchList 출력에서는 구조적으로 유일하고, batchList 자체도 동일
// topic+standardCode 조합을 이미 거부하므로 CLI 경로(batch-plan)로는 이 가드가
// 실제로 발화할 입력을 만들 수 없다(설계상 충돌 불가 — 확인함). 그럼에도 batch-plan
// 은 등록 직전 이 함수를 호출한다(방어 심층화, 향후 NN 산출 방식 변경 시 회귀 방지).
// 그 계약을 여기서 직접 재확인한다.
test('행-충돌 가드: batch-plan 이 의존하는 assertNoRowCollisions 자체 계약 재확인', () => {
  assert.throws(
    () => assertNoRowCollisions([{ docName: '집-01-광합성', __row: 1 }, { docName: '집-01-광합성', __row: 2 }]),
    /행-충돌/,
  );
  assert.doesNotThrow(() => assertNoRowCollisions([{ docName: '집-01-광합성' }, { docName: '집-02-소화' }]));
});
