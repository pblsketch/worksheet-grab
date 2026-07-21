import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';

// E2 CLI edit-ui 배선(인프로세스). onServer 시임으로 리스닝 서버를 즉시 close 한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

test('edit-ui: 문서 로드 → 서버 기동 → URL 로그 → close', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-editui-'));
  const q = logger();
  await run(['doc', 'save', '문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base],
    { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  let started = null;
  const code = await run(['edit-ui', '문서', '--workspaces-dir', base], {
    root: ROOT, log, err,
    onServer: (server, addr) => { started = { server, addr }; },
  });
  try {
    assert.equal(code, 0);
    assert.ok(started, 'onServer 시임으로 서버 수신');
    assert.equal(started.addr.address, '127.0.0.1');
    assert.ok(lines.some((l) => new RegExp(`http://127\\.0\\.0\\.1:${started.addr.port}/`).test(l)), 'URL 로그');
    assert.ok(lines.some((l) => /브라우저 에디터/.test(l)));
    const res = await fetch(`http://127.0.0.1:${started.addr.port}/`);
    assert.equal(res.status, 200, 'CLI 가 띄운 서버가 실제 응답');
  } finally {
    if (started) await new Promise((r) => started.server.close(r));
  }
});

test('edit-ui: 문서명 누락·없는 문서는 명확한 오류', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-editui-e-'));
  const { log, err } = logger();
  await assert.rejects(() => run(['edit-ui'], { root: ROOT, log, err }), /<문서명> 이 필요합니다/);
  await assert.rejects(
    () => run(['edit-ui', '없는문서', '--workspaces-dir', base], { root: ROOT, log, err }),
    /문서가 없습니다/,
  );
});

test('USAGE 에 edit-ui 노출', async () => {
  const { lines, log, err } = logger();
  await run(['help'], { root: ROOT, log, err });
  assert.ok(lines.some((l) => /edit-ui <문서명>/.test(l)));
});
