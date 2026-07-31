import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareAiFragment, fragmentBlockReason } from '../../src/usecases/applyAiFragment.js';
import { validateResponse, isFragmentResponse, AI_SCHEMA_VERSION } from '../../src/usecases/aiBridge.js';
import { validateObjectShape } from '../../src/domain/schema/index.js';

// B′ 라이브 배선(ADR-bspike-ai-fragment.md 채택) — 프래그먼트 저작 경로를 실제 적용까지 e2e 로 고정.
// objectFactory.js 는 브라우저 절대경로 import 라 node 가 직접 못 읽는다 → editor-ai-ops.test.js 선례대로
// '/src/…' import 만 file URL 로 치환해 진짜 applyAiOps 를 로드하고, prepareAiFragment 산출 op 를 적용한다.
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

const seq = () => { let n = 0; return () => `frag-${n++}`; };
const FRAG = () => ([
  { type: 'title', text: '분수의 곱셈', level: 2 },
  { type: 'callout', variant: 'tip', body: '<p>분자끼리, 분모끼리 곱한다.</p>' },
  { type: 'question', qtype: 'short-answer', prompt: '2/3 × 3/4 = ?' },
]);

test('prepareAiFragment: 승인 → 단일 insert-section op(엔진 id·placement:flow·순서 보존)', () => {
  const prep = prepareAiFragment(FRAG(), { anchor: { afterId: 'q1' }, requestPageVersions: { p1: 'v1' }, genId: seq() });
  assert.equal(prep.ok, true, prep.ok ? '' : prep.blockReason);
  assert.equal(prep.op.op, 'insert-section');
  assert.equal(prep.op.afterId, 'q1');
  assert.deepEqual(prep.op.objects.map((o) => o.type), ['title', 'callout', 'question']);
  assert.deepEqual(prep.op.objects.map((o) => o.id), ['frag-0', 'frag-1', 'frag-2']);
  assert.ok(prep.op.objects.every((o) => o.placement === 'flow'));
  assert.deepEqual(prep.requestPageVersions, { p1: 'v1' });
});

test('prepareAiFragment: 승인 개체는 구조 floor(validateObjectShape)를 통과한다', () => {
  const prep = prepareAiFragment(FRAG(), { anchor: { afterId: 'q1' }, genId: seq() });
  for (const o of prep.op.objects) assert.equal(validateObjectShape(o).ok, true, `${o.type} shape`);
});

test('prepareAiFragment → applyAiOps: 실제 문서에 anchor 뒤 순서대로 삽입(e2e)', async () => {
  const prep = prepareAiFragment(FRAG(), { anchor: { afterId: 'q1' }, genId: seq() });
  const doc = {
    pagination: 'paginated',
    pages: [{ id: 'p1', flow: [{ id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '기존' }], float: [] }],
  };
  const { document: after, resultIds } = await applyOps(doc, [prep.op]);
  assert.deepEqual(after.pages[0].flow.map((o) => o.type), ['question', 'title', 'callout', 'question']);
  assert.equal(resultIds.length, 3);
  assert.ok(after.pages[0].flow.every((o) => o.placement === 'flow'));
  assert.deepEqual(doc.pages[0].flow.map((o) => o.id), ['q1'], '원본 문서 불변');
});

test('prepareAiFragment: 좌표 공격은 validate 단계에서 반려', () => {
  const prep = prepareAiFragment([{ type: 'title', text: 'x', rect: { xMm: 1, yMm: 1, wMm: 1, hMm: 1 } }], { anchor: { afterId: 'q1' }, genId: seq() });
  assert.equal(prep.ok, false);
  assert.equal(prep.stage, 'validate');
  assert.ok(prep.findings.some((f) => f.rule === 'forbidden-coordinate'));
  assert.ok(prep.blockReason.length > 0);
});

test('prepareAiFragment: 답안(answer/answerKey)은 반려(B′ 답안 미생성)', () => {
  assert.equal(prepareAiFragment([{ type: 'question', qtype: 'essay', prompt: 'q', answer: true }], { anchor: { afterId: 'a' }, genId: seq() }).ok, false);
  assert.equal(prepareAiFragment([{ type: 'question', qtype: 'essay', prompt: 'q', answerKey: { text: '42' } }], { anchor: { afterId: 'a' }, genId: seq() }).stage, 'validate');
});

test('prepareAiFragment: anchor 누락/둘 이상 지정은 anchor 단계에서 반려', () => {
  assert.equal(prepareAiFragment(FRAG(), { anchor: {}, genId: seq() }).stage, 'anchor');
  assert.equal(prepareAiFragment(FRAG(), { anchor: { afterId: 'a', beforeId: 'b' }, genId: seq() }).stage, 'anchor');
  assert.equal(prepareAiFragment(FRAG(), { anchor: { afterId: 'a', pageId: 'p1' }, genId: seq() }).stage, 'anchor');
  assert.equal(prepareAiFragment(FRAG(), { anchor: { beforeId: 'b', pageId: 'p1' }, genId: seq() }).stage, 'anchor');
});

test('prepareAiFragment: pageId 앵커(빈 페이지 저작) → insert-section op.pageId(개체 앵커 없음)', () => {
  const prep = prepareAiFragment(FRAG(), { anchor: { pageId: 'p-empty' }, requestPageVersions: { 'p-empty': 'v1' }, genId: seq() });
  assert.equal(prep.ok, true, prep.ok ? '' : prep.blockReason);
  assert.equal(prep.op.op, 'insert-section');
  assert.equal(prep.op.pageId, 'p-empty');
  assert.equal(prep.op.afterId, undefined);
  assert.equal(prep.op.beforeId, undefined);
  assert.deepEqual(prep.op.objects.map((o) => o.type), ['title', 'callout', 'question']);
});

test('prepareAiFragment → applyAiOps: pageId 앵커로 빈 페이지 flow 말미에 순서대로 append(e2e)', async () => {
  const prep = prepareAiFragment(FRAG(), { anchor: { pageId: 'p2' }, genId: seq() });
  const doc = {
    pagination: 'paginated',
    pages: [
      { id: 'p1', flow: [{ id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '기존' }], float: [] },
      { id: 'p2', flow: [], float: [] }, // 빈 페이지(지목할 flow 개체 없음)
    ],
  };
  const { document: after, resultIds } = await applyOps(doc, [prep.op]);
  assert.deepEqual(after.pages[0].flow.map((o) => o.id), ['q1'], '1쪽은 불변');
  assert.deepEqual(after.pages[1].flow.map((o) => o.type), ['title', 'callout', 'question'], '2쪽(빈 페이지)에 순서대로 append');
  assert.equal(resultIds.length, 3);
  assert.ok(after.pages[1].flow.every((o) => o.placement === 'flow'));
});

test('prepareAiFragment → applyAiOps: pageId 앵커인데 그 페이지가 없으면 적용이 던진다', async () => {
  const prep = prepareAiFragment(FRAG(), { anchor: { pageId: '없는페이지' }, genId: seq() });
  const doc = { pagination: 'paginated', pages: [{ id: 'p1', flow: [], float: [] }] };
  await assert.rejects(() => applyOps(doc, [prep.op]), /대상 페이지를 찾을 수 없습니다/);
});

test('prepareAiFragment: HTML 공격은 validate 단계에서 반려', () => {
  const prep = prepareAiFragment([{ type: 'richtext', html: '<p>x</p><script>steal()</script>' }], { anchor: { afterId: 'a' }, genId: seq() });
  assert.equal(prep.ok, false);
  assert.equal(prep.stage, 'validate');
  assert.ok(prep.findings.some((f) => f.rule === 'html-disallowed-tag'));
});

test('fragmentBlockReason: 사유 문자열을 만든다(조용한 실패 금지)', () => {
  const reason = fragmentBlockReason([{ rule: 'forbidden-id', message: 'x', path: '[0].id' }]);
  assert.ok(typeof reason === 'string' && reason.includes('x'));
});

// ── aiBridge fragment 봉투(전송 계층) ──
test('aiBridge.validateResponse: 프래그먼트 봉투를 수용', () => {
  const env = { schemaVersion: AI_SCHEMA_VERSION, id: 'req-1', fragment: FRAG(), afterId: 'q1' };
  assert.equal(isFragmentResponse(env), true);
  assert.equal(validateResponse(env), true);
  assert.equal(validateResponse({ ...env, beforeId: 'x' }), false, 'afterId·beforeId 동시 금지');
  assert.equal(validateResponse({ ...env, afterId: undefined }), true, 'anchor 없이도 봉투는 유효(엔진이 폴백)');
});

test('aiBridge.validateResponse: 빈/비객체 프래그먼트는 거부', () => {
  assert.equal(validateResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'r', fragment: [] }), false);
  assert.equal(validateResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'r', fragment: [{ noType: 1 }] }), false);
  assert.equal(validateResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'r', fragment: ['x'] }), false);
});

// 404 백지 회귀 방어: ai.js 가 /src/ 라우트로 import 하는 B′ 모듈들이 browserGraph 화이트리스트 안에
// 있어야 한다. 밖이면 브라우저 fetch 404 → ESM 그래프 사망 → AI 패널 백지(float-layout.test.js 선례).
test('browserGraph: B′ 모듈이 /src 서빙 화이트리스트 안에 있다(404 백지 방어)', async () => {
  const { resolveBrowserGraph } = await import(`file://${resolve(ROOT, 'src/editor/browserGraph.js').replace(/\\/g, '/')}`);
  const { files, violations } = resolveBrowserGraph(ROOT);
  for (const f of ['src/usecases/applyAiFragment.js', 'src/domain/schema/validateAiFragment.js', 'src/domain/schema/htmlAllowlist.js']) {
    assert.ok(files.includes(f), `${f} 가 browserGraph 화이트리스트에 있어야 함(ai.js /src import)`);
  }
  assert.deepEqual(violations, [], `B′ 모듈 브라우저 순수성 위반: ${JSON.stringify(violations)}`);
});
