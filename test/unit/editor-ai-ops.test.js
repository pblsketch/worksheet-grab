import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Phase 4 US-P4-2 — v4 ops 계획을 문서에 적용하는 순수 연산.
// v3 는 대상별 1:1 치환뿐이라 개수·종류가 바뀌는 결과를 만들 수 없었다.
//
// objectFactory.js 는 브라우저 절대경로('/src/…')를 import 하므로 node 가 직접 import 할 수 없다.
// nudge-float.test.js 와 동일하게 절대경로 import 만 file URL 로 치환해 진짜 소스를 로드한다.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let cached = null;
async function applyOps(...args) {
  if (!cached) {
    const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
    const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
    cached = await import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
  }
  return cached.applyAiOps(...args);
}

const doc = () => ({
  pagination: 'paginated',
  pages: [{
    id: 'page-1',
    flow: [
      { id: 'q1', type: 'question', prompt: '문항1' },
      { id: 'q2', type: 'question', prompt: '문항2' },
      { id: 'q3', type: 'question', prompt: '문항3' },
      { id: 'std', type: 'std-box', codes: ['9과12-01'] },
    ],
    float: [],
  }],
});
const flowOf = (d) => d.pages[0].flow.map((o) => o.id);
const EXCLUDED = ['std-box'];

test('문항 3개 → 활동 1개 합치기(replace 1 + delete 2)', async () => {
  const before = doc();
  const { document: after, resultIds } = await applyOps(before, [
    { op: 'replace', id: 'q1', object: { id: 'q1', type: 'question', prompt: '통합 단계형 활동' } },
    { op: 'delete', id: 'q2' },
    { op: 'delete', id: 'q3' },
  ]);
  assert.deepEqual(flowOf(after), ['q1', 'std'], '두 개체가 사라지고 하나로 합쳐진다');
  assert.equal(after.pages[0].flow[0].prompt, '통합 단계형 활동');
  assert.deepEqual(resultIds, ['q1'], '결과 개체는 합쳐진 하나');
  assert.deepEqual(flowOf(before), ['q1', 'q2', 'q3', 'std'], '원본 문서는 불변');
});

test('표 1개 → 표 + 설명문 나누기(replace + insert afterId)', async () => {
  const { document: after, resultIds } = await applyOps(doc(), [
    { op: 'replace', id: 'q2', object: { id: 'q2', type: 'table', rows: [] } },
    { op: 'insert', object: { id: 'ai-rt', type: 'richtext', html: '<p>설명</p>' }, afterId: 'q2' },
  ]);
  const ids = flowOf(after);
  assert.equal(ids.length, 5, '개체가 하나 늘었다');
  assert.equal(ids[1], 'q2');
  assert.equal(after.pages[0].flow[2].type, 'richtext', 'q2 바로 뒤에 설명문이 들어간다');
  assert.equal(resultIds.length, 2);
  assert.notEqual(resultIds[1], 'ai-rt', '신규 개체는 AI 가 준 id 가 아니라 새 id 를 받는다(충돌 방지)');
});

test('insert beforeId 는 기준 개체 앞에 끼운다', async () => {
  const { document: after } = await applyOps(doc(), [
    { op: 'insert', object: { id: 'x', type: 'richtext', html: '<p>안내</p>' }, beforeId: 'q1' },
  ]);
  assert.equal(after.pages[0].flow[0].type, 'richtext', '맨 앞에 삽입');
  assert.equal(after.pages[0].flow[1].id, 'q1');
});

test('insert 위치 미지정이면 말미에 붙는다', async () => {
  const { document: after } = await applyOps(doc(), [
    { op: 'insert', object: { id: 'x', type: 'richtext', html: '<p>끝</p>' } },
  ]);
  assert.equal(after.pages[0].flow.at(-1).type, 'richtext');
});

test('순서 의존: 앞 op 가 지운 개체를 뒤 op 가 건드리면 드러난다(조용한 부분 반영 금지)', async () => {
  await assert.rejects(
    () => applyOps(doc(), [
      { op: 'delete', id: 'q2' },
      { op: 'replace', id: 'q2', object: { id: 'q2', type: 'question', prompt: 'X' } },
    ]),
    /찾을 수 없습니다: q2/,
  );
});

test('없는 개체를 replace·delete 하면 던진다', async () => {
  await assert.rejects(() => applyOps(doc(), [{ op: 'replace', id: 'nope', object: { id: 'nope', type: 'question' } }]), /수정 대상/);
  await assert.rejects(() => applyOps(doc(), [{ op: 'delete', id: 'nope' }]), /삭제 대상/);
});

test('없는 위치에 insert 하면 던진다(유령 위치 삽입 방지)', async () => {
  await assert.rejects(
    () => applyOps(doc(), [{ op: 'insert', object: { id: 'x', type: 'richtext' }, afterId: 'ghost' }]),
    /삽입 기준 개체를 찾을 수 없습니다: ghost/,
  );
});

// Phase 4 US-P4-4 가 자유 배치(float) 개체를 AI 대상 집합에 편입시키면서 노출된 경로:
// insertFlow 는 앵커가 float 이면 조용히 **마지막 페이지 끝**에 붙인다(loc.bucket !== 'flow' 폴백).
// AI 가 지목한 자리와 다른 곳에 꽂히는 오배치라, 유령 앵커와 같은 원칙으로 던져야 한다.
test('자유 배치(float) 개체를 기준으로 insert 하면 던진다(조용한 오배치 방지)', async () => {
  const withFloat = () => ({
    pagination: 'paginated',
    pages: [
      { id: 'page-1', flow: [{ id: 'q1', type: 'question', prompt: '문항1' }], float: [{ id: 'fl1', type: 'richtext', placement: 'float', html: '<p>자유</p>' }] },
      { id: 'page-2', flow: [{ id: 'q9', type: 'question', prompt: '문항9' }], float: [] },
    ],
  });
  for (const anchorKey of ['afterId', 'beforeId']) {
    await assert.rejects(
      () => applyOps(withFloat(), [{ op: 'insert', object: { id: 'x', type: 'richtext', html: '<p>새</p>' }, [anchorKey]: 'fl1' }]),
      /본문 흐름 개체가 아닙니다: fl1/,
      `${anchorKey} 앵커가 float 이면 거부해야 한다`,
    );
  }
  // 회귀 방어: 거부 이전 동작은 "2쪽 맨 끝에 조용히 추가" 였다 — 문서가 전혀 바뀌지 않아야 한다.
  const before = withFloat();
  await applyOps(before, [{ op: 'insert', object: { id: 'x', type: 'richtext' }, afterId: 'fl1' }]).catch(() => {});
  assert.deepEqual(before.pages[1].flow.map((o) => o.id), ['q9'], '거부 시 원본 문서 무변경');
});

test('std-box 는 AI 가 수정·삭제할 수 없다(원칙 3, 성취기준 원문 보존)', async () => {
  await assert.rejects(
    () => applyOps(doc(), [{ op: 'replace', id: 'std', object: { id: 'std', type: 'std-box', codes: ['위조'] } }], { excludedTypes: EXCLUDED }),
    /성취기준 원문은 보존/,
  );
  await assert.rejects(
    () => applyOps(doc(), [{ op: 'delete', id: 'std' }], { excludedTypes: EXCLUDED }),
    /성취기준 원문은 보존/,
  );
});

test('알 수 없는 op 와 빈 계획은 던진다', async () => {
  await assert.rejects(() => applyOps(doc(), [{ op: 'move', id: 'q1' }]), /알 수 없는 AI op/);
  await assert.rejects(() => applyOps(doc(), []), /비어 있습니다/);
  await assert.rejects(() => applyOps(doc(), null), /비어 있습니다/);
});

test('여러 op 를 거쳐도 관계없는 개체와 페이지 ID 는 보존된다', async () => {
  const { document: after } = await applyOps(doc(), [
    { op: 'delete', id: 'q3' },
    { op: 'insert', object: { id: 'n', type: 'richtext', html: '<p>새</p>' }, afterId: 'q1' },
  ], { excludedTypes: EXCLUDED });
  assert.equal(after.pages[0].id, 'page-1', '페이지 ID 보존');
  assert.ok(flowOf(after).includes('std'), '무관한 개체 보존');
  assert.equal(after.pagination, 'paginated', '문서 메타 보존');
});

// ── M3a: insert-section(여러 개체 한 번에 삽입, 순서 보존) ──────────────────────
test('insert-section: afterId 뒤에 리스트 순서대로 한 번에 삽입 + 새 id', async () => {
  const { document: after, resultIds } = await applyOps(doc(), [
    { op: 'insert-section', afterId: 'q1', objects: [
      { id: 'a', type: 'question', prompt: 'A' },
      { id: 'b', type: 'richtext', html: '<p>B</p>' },
      { id: 'c', type: 'question', prompt: 'C' },
    ] },
  ]);
  assert.equal(after.pages[0].flow[0].id, 'q1');
  assert.equal(after.pages[0].flow[1].prompt, 'A');
  assert.equal(after.pages[0].flow[2].type, 'richtext');
  assert.equal(after.pages[0].flow[3].prompt, 'C', 'q1 뒤에 A,B,C 순서 보존');
  assert.equal(after.pages[0].flow[4].id, 'q2', '기존 q2 는 섹션 뒤로 밀린다');
  assert.equal(resultIds.length, 3);
  assert.ok(!flowOf(after).includes('a'), '신규 개체는 AI 가 준 id 가 아니라 새 id 를 받는다');
});

test('insert-section: beforeId 앞에 리스트 순서대로 삽입', async () => {
  const { document: after } = await applyOps(doc(), [
    { op: 'insert-section', beforeId: 'q2', objects: [
      { id: 'x', type: 'richtext', html: '<p>X</p>' },
      { id: 'y', type: 'richtext', html: '<p>Y</p>' },
    ] },
  ]);
  assert.equal(after.pages[0].flow[0].id, 'q1');
  assert.equal(after.pages[0].flow[1].type, 'richtext');
  assert.equal(after.pages[0].flow[2].type, 'richtext');
  assert.equal(after.pages[0].flow[3].id, 'q2', 'q2 앞에 X,Y 가 순서대로');
});

test('insert-section: 위치 미지정이면 말미에 순서대로 붙는다', async () => {
  const { document: after } = await applyOps(doc(), [
    { op: 'insert-section', objects: [
      { id: 'm', type: 'richtext', html: '<p>M</p>' },
      { id: 'n', type: 'divider' },
    ] },
  ]);
  const tail = after.pages[0].flow.slice(-2);
  assert.equal(tail[0].type, 'richtext');
  assert.equal(tail[1].type, 'divider');
});

test('insert-section: float 기준·빈 목록·성취기준 생성은 던진다(조용한 오배치·원칙 3 방지)', async () => {
  const withFloat = () => ({
    pagination: 'paginated',
    pages: [{ id: 'page-1', flow: [{ id: 'q1', type: 'question' }], float: [{ id: 'fl1', type: 'richtext', placement: 'float' }] }],
  });
  await assert.rejects(
    () => applyOps(withFloat(), [{ op: 'insert-section', afterId: 'fl1', objects: [{ id: 'a', type: 'richtext' }] }]),
    /본문 흐름 개체가 아닙니다: fl1/,
  );
  await assert.rejects(
    () => applyOps(doc(), [{ op: 'insert-section', afterId: 'q1', objects: [] }]),
    /개체가 없습니다/,
  );
  await assert.rejects(
    () => applyOps(doc(), [{ op: 'insert-section', afterId: 'q1', objects: [{ id: 's', type: 'std-box', codes: [] }] }], { excludedTypes: EXCLUDED }),
    /성취기준 원문은 보존/,
  );
});
