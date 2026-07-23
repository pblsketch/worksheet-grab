import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';

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

test('ai pending: 대기 요청 출력(--json 전문 포함)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-mix-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-v3-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-obj-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-objwrap-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-objbad-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-b-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-v1r-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-r-'));
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-w-'));
  const bridge = new FsAiBridgeRepository({ baseDir: base });
  const { lines, log, err } = logger();
  const watching = run(['ai', 'pending', '--watch', '--once', '--workspaces-dir', base], { root: ROOT, log, err });
  await new Promise((r) => setTimeout(r, 300));
  await bridge.putRequest(req('req-late'));
  assert.equal(await watching, 0, '첫 새 요청 후 종료(--once)');
  assert.ok(lines.some((l) => /req-late/.test(l)), '감시가 새 요청 출력');
});

test('ai list/clear: 상태 조회·terminal 정리', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-aicli-l-'));
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
