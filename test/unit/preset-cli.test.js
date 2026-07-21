import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';

// E4 CLI: preset list/delete/restore + doc list 의 .presets 무시.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

test('preset list: 빌트인 6종 노출(--json 포함)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-pcli-'));
  const { lines, log, err } = logger();
  assert.equal(await run(['preset', 'list', '--workspaces-dir', base], { root: ROOT, log, err }), 0);
  assert.ok(lines.some((l) => /builtin-subq — 발문/.test(l)));
  assert.ok(lines.some((l) => /builtin-rubric — 루브릭/.test(l)));

  const j = logger();
  await run(['preset', 'list', '--json', '--workspaces-dir', base], { root: ROOT, log: j.log, err: j.err });
  const parsed = JSON.parse(j.lines.join('\n'));
  assert.equal(parsed.presets.length, 6);
});

test('preset delete(빌트인 숨김)→restore 왕복', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-pcli-d-'));
  const q = logger();
  assert.equal(await run(['preset', 'delete', 'builtin-rubric', '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err }), 0);
  assert.ok(q.lines.some((l) => /숨김.*restore/.test(l)));
  const list = logger();
  await run(['preset', 'list', '--workspaces-dir', base], { root: ROOT, log: list.log, err: list.err });
  assert.ok(!list.lines.some((l) => /builtin-rubric/.test(l)));
  assert.equal(await run(['preset', 'restore', 'builtin-rubric', '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err }), 0);
  const list2 = logger();
  await run(['preset', 'list', '--workspaces-dir', base], { root: ROOT, log: list2.log, err: list2.err });
  assert.ok(list2.lines.some((l) => /builtin-rubric/.test(l)));
});

test('doc list 는 .presets 디렉토리를 문서로 표시하지 않는다', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-pcli-doc-'));
  await mkdir(join(base, '.presets'), { recursive: true });
  await writeFile(join(base, '.presets', 'presets.json'), '{"version":1,"userPresets":[],"hiddenBuiltins":[]}', 'utf8');
  await run(['doc', 'save', '진짜문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base],
    { root: ROOT, log: () => {}, err: () => {} });
  const { lines, log, err } = logger();
  await run(['doc', 'list', '--workspaces-dir', base], { root: ROOT, log, err });
  assert.ok(lines.some((l) => /진짜문서/.test(l)));
  assert.ok(!lines.some((l) => /\.presets/.test(l)), '.presets 오인 없음');
});
