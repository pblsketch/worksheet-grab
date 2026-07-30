import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E5 CLI: 구독 AI 측 표면(pending/watch/respond/list/clear). 무API — 파일 큐 왕복만.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

// v1(단일 block) — 디스크의 in-flight 요청 형태. 신 코드에서도 유효해야 한다.
function req(id) {
  return {
    schemaVersion: 1, id, docName: '문서', action: 'rewrite',
    block: { bp: 0, bi: 1, bt: 'question', html: '<div class="q">문항 원문</div>' }, status: 'pending',
  };
}

// v2(blocks[]) — 디스크의 in-flight 요청 형태(S4.0 이전 세션 잔존분). schemaVersion 은 형태와
// 짝이므로 리터럴 2 로 고정한다(AI_SCHEMA_VERSION 은 S4.0 에서 3=objects[] 로 승격됐다 — 신규
// 쓰기용 상수를 이 v2 고정 shape 픽스처에 쓰면 형태-버전 불일치로 validateRequest 가 거부한다).
function reqV2(id) {
  return {
    schemaVersion: 2, id, docName: '문서', action: 'rewrite',
    blocks: [
      { bp: 0, bi: 1, bt: 'question', html: '<div class="q">문항A</div>' },
      { bp: 0, bi: 3, bt: 'subq', html: '<p class="subq">문항B</p>' },
    ], status: 'pending',
  };
}

// v3(objects[], US-19/F4) — 개체 ID 에코 경로(현행 신규 쓰기 스키마). AI_SCHEMA_VERSION 상수 사용.
function reqV3(id) {
  return {
    schemaVersion: 3, id, docName: '문서', action: 'rewrite',
    objects: [
      { id: 'o1', type: 'question', qtype: 'short-answer', placement: 'flow', prompt: '문항 원문' },
      { id: 'o2', type: 'title', placement: 'flow', text: '제목 원문' },
    ], status: 'pending',
  };
}

// v4(Phase 4) — objects[] 에 더해 페이지 컨텍스트(scope·pageId·pageVersion)를 싣는다.
function reqV4(id, { scope = 'page' } = {}) {
  return {
    schemaVersion: 4, id, docName: '문서', action: 'rewrite',
    objects: [
      { id: 'o1', type: 'question', qtype: 'short-answer', placement: 'flow', prompt: '문항 원문' },
      { id: 'o2', type: 'title', placement: 'flow', text: '제목 원문' },
    ],
    scope, pageId: 'page-abc', pageVersion: 'pv1-0123456789abcdef', status: 'pending',
  };
}

test('Phase 4 ai pending: v4 요청(페이지 전체 scope) 무크래시 렌더 + 페이지 컨텍스트 표기', async () => {
  const base = await autoTmpDir('wsg-aicli-v4pending-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV4('req-v4'));
  const { lines, log, err } = logger();
  assert.equal(await run(['ai', 'pending', '--workspaces-dir', base], { root: ROOT, log, err }), 0);
  assert.ok(lines.some((l) => /req-v4 — 문서 · rewrite · 2개체/.test(l)), 'v4 요청 렌더');
  assert.ok(lines.some((l) => /범위: 페이지 전체\(page-abc\)/.test(l)), '구독 AI 가 페이지 전체 요청임을 알 수 있다');

  const j = logger();
  assert.equal(await run(['ai', 'pending', '--json', '--workspaces-dir', base], { root: ROOT, log: j.log, err: j.err }), 0);
  const parsed = JSON.parse(j.lines.join('\n'));
  assert.equal(parsed.pageVersion, 'pv1-0123456789abcdef', '--json 전문에 pageVersion 이 그대로 실린다');
  assert.equal(parsed.scope, 'page');
});

test('Phase 4 ai list: v4 요청도 무크래시(양형 방어)', async () => {
  const base = await autoTmpDir('wsg-aicli-v4list-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV4('req-v4-list', { scope: 'objects' }));
  const { lines, log, err } = logger();
  assert.equal(await run(['ai', 'list', '--workspaces-dir', base], { root: ROOT, log, err }), 0);
  assert.ok(lines.some((l) => /\[pending\] req-v4-list — 문서 · rewrite · 2개체/.test(l)));
});

test('Phase 4 ai respond --ops: v4 계획 기록(replace+insert+delete) + 요약 무크래시', async () => {
  const base = await autoTmpDir('wsg-aicli-ops-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV4('req-ops'));

  const opsFile = join(base, 'ops.json');
  await writeFile(opsFile, JSON.stringify([
    { op: 'replace', id: 'o1', object: { id: 'o1', type: 'question', qtype: 'essay', placement: 'flow', prompt: '통합 문항' } },
    { op: 'insert', object: { id: 'new1', type: 'richtext', placement: 'flow', html: '<p>안내</p>' }, afterId: 'o1' },
    { op: 'delete', id: 'o2' },
  ]), 'utf8');

  const r = logger();
  assert.equal(await run(['ai', 'respond', 'req-ops', '--ops', opsFile, '--workspaces-dir', base], { root: ROOT, log: r.log, err: r.err }), 0);
  // v1~v3 만 알던 요약 문장이 v4 에서 크래시하지 않고 계획 종류를 보여준다.
  assert.ok(r.lines.some((l) => /응답 기록: req-ops \(3계획\(replace·insert·delete\)\)/.test(l)), r.lines.join('\n'));
  assert.equal(await bridge.getStatus('req-ops'), 'answered');
  const resp = await bridge.readResponse('req-ops');
  assert.equal(resp.schemaVersion, 4, '--ops → v4(AI_SCHEMA_VERSION 상수 사용)');
  assert.deepEqual(resp.ops.map((o) => o.op), ['replace', 'insert', 'delete']);
});

test('M5 ai respond --unsupported: 반려 봉투 기록 → getStatus unsupported + 요약 표시', async () => {
  const base = await autoTmpDir('wsg-aicli-uns-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV4('req-uns'));

  const reason = '문항 3개를 하나로 합치는 지시는 표현할 수 없습니다.';
  const r = logger();
  assert.equal(await run(['ai', 'respond', 'req-uns', '--unsupported', reason, '--workspaces-dir', base], { root: ROOT, log: r.log, err: r.err }), 0);
  assert.ok(r.lines.some((l) => /응답 기록: req-uns \(반려\(/.test(l)), r.lines.join('\n'));
  assert.equal(await bridge.getStatus('req-uns'), 'unsupported', '반려 봉투 → 상태 파생 unsupported(answered 아님)');
  const resp = await bridge.readResponse('req-uns');
  assert.equal(resp.unsupported, true);
  assert.equal(resp.reason, reason, 'reason 이 그대로 기록된다');
});

test('Phase 4 ai respond --ops: {ops:[…]} 래핑 허용 · 형태 불일치는 거부', async () => {
  const base = await autoTmpDir('wsg-aicli-opsbad-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV4('req-ops-wrap'));
  await bridge.putRequest(reqV4('req-ops-bad'));

  const wrapFile = join(base, 'wrap.json');
  await writeFile(wrapFile, JSON.stringify({ ops: [{ op: 'delete', id: 'o2' }] }), 'utf8');
  assert.equal(await run(['ai', 'respond', 'req-ops-wrap', '--ops', wrapFile, '--workspaces-dir', base], { root: ROOT, log: () => {}, err: () => {} }), 0);
  assert.equal(await bridge.getStatus('req-ops-wrap'), 'answered');

  // insert 에 afterId·beforeId 를 동시에 주면 어느 기준인지 모호하다 — 형태 단계에서 거부.
  const badFile = join(base, 'bad.json');
  await writeFile(badFile, JSON.stringify([
    { op: 'insert', object: { id: 'x', type: 'richtext' }, afterId: 'o1', beforeId: 'o2' },
  ]), 'utf8');
  await assert.rejects(
    () => run(['ai', 'respond', 'req-ops-bad', '--ops', badFile, '--workspaces-dir', base], { root: ROOT, log: () => {}, err: () => {} }),
    /v4 스키마/,
  );
  assert.equal(await bridge.getStatus('req-ops-bad'), 'pending', '거부된 응답은 기록되지 않음');
});

test('ai pending: 대기 요청 출력(--json 전문 포함)', async () => {
  const base = await autoTmpDir('wsg-aicli-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(req('req-1'));
  const { lines, log, err } = logger();
  assert.equal(await run(['ai', 'pending', '--workspaces-dir', base], { root: ROOT, log, err }), 0);
  assert.ok(lines.some((l) => /req-1 — 문서 · rewrite · 1블록 \[question/.test(l)), 'v1 단일 블록 렌더(양형 무크래시)');

  const j = logger();
  await run(['ai', 'pending', '--json', '--workspaces-dir', base], { root: ROOT, log: j.log, err: j.err });
  const parsed = JSON.parse(j.lines.join('\n'));
  assert.equal(parsed.block.html, '<div class="q">문항 원문</div>', '페이로드 전문');
});

test('F4 ai pending/list: v1·v2 양형 무크래시 렌더(TypeError 없음)', async () => {
  const base = await autoTmpDir('wsg-aicli-mix-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(req('req-v1'));    // 단일 block
  await bridge.putRequest(reqV2('req-v2'));  // blocks[2]

  const p = logger();
  assert.equal(await run(['ai', 'pending', '--workspaces-dir', base], { root: ROOT, log: p.log, err: p.err }), 0);
  assert.ok(p.lines.some((l) => /req-v1 — 문서 · rewrite · 1블록 \[question/.test(l)), 'v1 블록 수·타입 요약');
  assert.ok(p.lines.some((l) => /req-v2 — 문서 · rewrite · 2블록 \[question\(.*subq/.test(l)), 'v2 다중 블록 요약');

  const l = logger();
  assert.equal(await run(['ai', 'list', '--all', '--workspaces-dir', base], { root: ROOT, log: l.log, err: l.err }), 0);
  assert.ok(l.lines.some((s) => /\[pending\] req-v1 — .* · 1블록/.test(s)));
  assert.ok(l.lines.some((s) => /\[pending\] req-v2 — .* · 2블록/.test(s)));
});

test('US-19 ai pending/list: v3(objects[]) 요청도 무크래시 렌더', async () => {
  const base = await autoTmpDir('wsg-aicli-v3-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(req('req-v1')); // v1 도 섞어 양형 무크래시 재확인
  await bridge.putRequest(reqV3('req-v3'));

  const p = logger();
  assert.equal(await run(['ai', 'pending', '--workspaces-dir', base], { root: ROOT, log: p.log, err: p.err }), 0);
  assert.ok(p.lines.some((l) => /req-v3 — 문서 · rewrite · 2개체 \[question\(o1\), title\(o2\)\]/.test(l)), 'v3 개체 요약(타입·id)');

  const l = logger();
  assert.equal(await run(['ai', 'list', '--all', '--workspaces-dir', base], { root: ROOT, log: l.log, err: l.err }), 0);
  assert.ok(l.lines.some((s) => /\[pending\] req-v3 — .* · 2개체 \[question, title\]/.test(s)));
});

test('US-19 ai respond --objects: v3 응답 기록(개체 ID 에코 왕복, aiBridge.validateResponse 재사용)', async () => {
  const base = await autoTmpDir('wsg-aicli-obj-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV3('req-obj'));

  const objectsFile = join(base, 'objects.json');
  await writeFile(objectsFile, JSON.stringify([
    { id: 'o1', object: { id: 'o1', type: 'question', qtype: 'short-answer', placement: 'flow', prompt: '재작성된 문항' } },
    { id: 'o2', object: { id: 'o2', type: 'title', placement: 'flow', text: '재작성된 제목' } },
  ]), 'utf8');

  const r = logger();
  assert.equal(await run(['ai', 'respond', 'req-obj', '--objects', objectsFile, '--workspaces-dir', base], { root: ROOT, log: r.log, err: r.err }), 0);
  assert.ok(r.lines.some((l) => /응답 기록: req-obj \(2개체\)/.test(l)));
  assert.equal(await bridge.getStatus('req-obj'), 'answered');
  const resp = await bridge.readResponse('req-obj');
  assert.equal(resp.schemaVersion, 3, '--objects → v3(AI_SCHEMA_VERSION 상수 사용)');
  assert.deepEqual(resp.objects.map((o) => o.id), ['o1', 'o2'], '요청 objects[].id 그대로 에코');
  assert.equal(resp.objects[0].object.prompt, '재작성된 문항');
});

test('US-19 ai respond --objects: {objects:[…]} 래핑 형태도 허용', async () => {
  const base = await autoTmpDir('wsg-aicli-objwrap-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV3('req-wrap'));
  const objectsFile = join(base, 'objects.json');
  await writeFile(objectsFile, JSON.stringify({
    objects: [{ id: 'o1', object: { id: 'o1', type: 'question', qtype: 'short-answer', placement: 'flow', prompt: '재작성' } }],
  }), 'utf8');
  assert.equal(await run(['ai', 'respond', 'req-wrap', '--objects', objectsFile, '--workspaces-dir', base], { root: ROOT, log: () => {}, err: () => {} }), 0);
  assert.equal(await bridge.getStatus('req-wrap'), 'answered');
});

test('US-19 ai respond --objects: 스키마 불일치(id 누락) → 거부(비영 종료)', async () => {
  const base = await autoTmpDir('wsg-aicli-objbad-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV3('req-bad'));
  const objectsFile = join(base, 'objects.json');
  await writeFile(objectsFile, JSON.stringify([{ object: { id: 'o1', type: 'question' } }]), 'utf8'); // id 누락
  await assert.rejects(
    () => run(['ai', 'respond', 'req-bad', '--objects', objectsFile, '--workspaces-dir', base], { root: ROOT, log: () => {}, err: () => {} }),
    /v3 스키마/,
  );
  assert.equal(await bridge.getStatus('req-bad'), 'pending', '거부된 응답은 기록되지 않음');
});

test('F4 ai respond --blocks: v2 응답 리터럴 태깅(schemaVersion:2, 슬롯 보존)', async () => {
  const base = await autoTmpDir('wsg-aicli-b-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(reqV2('req-b'));

  const blocksFile = join(base, 'blocks.json');
  await writeFile(blocksFile, JSON.stringify([
    { slot: 0, html: '<div class="q">재작성 A</div>' },
    { slot: 1, html: '<p class="subq">재작성 B</p>' },
  ]), 'utf8');

  const b = logger();
  assert.equal(await run(['ai', 'respond', 'req-b', '--blocks', blocksFile, '--workspaces-dir', base], { root: ROOT, log: b.log, err: b.err }), 0);
  assert.equal(await bridge.getStatus('req-b'), 'answered');
  const resp = await bridge.readResponse('req-b');
  assert.equal(resp.schemaVersion, 2, '--blocks → v2 리터럴 태깅');
  assert.equal(resp.blocks.length, 2);
  assert.deepEqual(resp.blocks.map((x) => x.slot), [0, 1], '슬롯 보존');
});

test('F4 ai respond --from: v1 응답 리터럴 태깅(schemaVersion:1, 상수 승격에 오태깅 안 됨)', async () => {
  const base = await autoTmpDir('wsg-aicli-v1r-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(req('req-v1r')); // v1 요청
  const f = join(base, 'ans.html');
  await writeFile(f, '<div class="q">v1 재작성</div>', 'utf8');
  const r = logger();
  assert.equal(await run(['ai', 'respond', 'req-v1r', '--from', f, '--workspaces-dir', base], { root: ROOT, log: r.log, err: r.err }), 0);
  const resp = await bridge.readResponse('req-v1r');
  assert.equal(resp.schemaVersion, 1, '--from → v1 리터럴(신규 쓰기용 상수 승격에 오태깅되지 않음)');
  assert.equal(typeof resp.html, 'string');
});

test('ai respond: 응답 기록 → answered · cancelled 요청은 거부(비영 종료)', async () => {
  const base = await autoTmpDir('wsg-aicli-r-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(req('req-ok'));
  await bridge.putRequest(req('req-cxl'));
  await bridge.setStatus('req-cxl', 'cancelled');

  const fromFile = join(base, 'answer.html');
  await writeFile(fromFile, '<div class="q">재작성된 문항</div>', 'utf8');
  const a = logger();
  assert.equal(await run(['ai', 'respond', 'req-ok', '--from', fromFile, '--workspaces-dir', base], { root: ROOT, log: a.log, err: a.err }), 0);
  assert.equal(await bridge.getStatus('req-ok'), 'answered');

  const b = logger();
  assert.equal(await run(['ai', 'respond', 'req-cxl', '--html', '<p>x</p>', '--workspaces-dir', base], { root: ROOT, log: b.log, err: b.err }), 1, 'cancelled terminal — 거부');
  assert.ok(b.lines.some((l) => /취소된 요청/.test(l)));
  assert.equal(await bridge.getStatus('req-cxl'), 'cancelled', '응답 파일 미생성');
});

test('ai pending --watch --once: 새 요청 도착을 감시로 포착', async () => {
  const base = await autoTmpDir('wsg-aicli-w-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  const { lines, log, err } = logger();
  const watching = run(['ai', 'pending', '--watch', '--once', '--workspaces-dir', base], { root: ROOT, log, err });
  await new Promise((r) => setTimeout(r, 300));
  await bridge.putRequest(req('req-late'));
  assert.equal(await watching, 0, '첫 새 요청 후 종료(--once)');
  assert.ok(lines.some((l) => /req-late/.test(l)), '감시가 새 요청 출력');
});

test('ai list/clear: 상태 조회·terminal 정리', async () => {
  const base = await autoTmpDir('wsg-aicli-l-');
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  await bridge.putRequest(req('req-p'));
  await bridge.putRequest(req('req-x'));
  await bridge.setStatus('req-x', 'cancelled');

  const l1 = logger();
  await run(['ai', 'list', '--all', '--workspaces-dir', base], { root: ROOT, log: l1.log, err: l1.err });
  assert.ok(l1.lines.some((l) => /\[pending\] req-p/.test(l)) && l1.lines.some((l) => /\[cancelled\] req-x/.test(l)));

  const c = logger();
  await run(['ai', 'clear', '--workspaces-dir', base], { root: ROOT, log: c.log, err: c.err });
  assert.ok(c.lines.some((l) => /정리: 1건/.test(l)), 'terminal 만 정리');
  assert.equal(await bridge.getStatus('req-p'), 'pending', 'pending 은 보존');
});
