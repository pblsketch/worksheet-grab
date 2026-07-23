// mf-* meta undefined 프로브 — Chrome 없이 서버 계약만으로 재현.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { ROOT } from './harness.mjs';

const base = mkdtempSync(join(tmpdir(), 'wsg-uqa-meta-'));
const docDir = join(base, 'mfko');
// 완전 맨몸 문서: worksheet.manifest.json 하나만(외부 생성 문서의 최악 케이스).
mkdirSync(docDir, { recursive: true });
writeFileSync(join(docDir, 'worksheet.manifest.json'), readFileSync(join(ROOT, 'manifests', 'ko.json'), 'utf8'), 'utf8');

const workspace = new FsWorkspaceRepository({ baseDir: base });
const blockRepository = new FsBlockRepository({ root: ROOT });
const server = createEditorServer({ root: ROOT, docName: 'mfko', workspace, blockRepository, curriculum: null });
const addr = await listenEditorServer(server);
const url = `http://127.0.0.1:${addr.port}`;
try {
  const shell0 = await (await fetch(`${url}/shell.json`)).json();
  console.log('shell0.meta:', JSON.stringify(shell0.meta));
  console.log('shell0.migrated:', shell0.migrated);

  const doc = shell0.document;
  doc.docTitle = (doc.docTitle || '') + ' MIGPROBE';
  const saveRes = await fetch(`${url}/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: doc }),
  });
  const saveText = await saveRes.text();
  console.log('save status:', saveRes.status, 'body:', saveText.slice(0, 500));

  console.log('meta.json exists:', existsSync(join(docDir, '.worksheet-grab', 'meta.json')));
  if (existsSync(join(docDir, '.worksheet-grab', 'meta.json'))) {
    console.log('meta.json:', readFileSync(join(docDir, '.worksheet-grab', 'meta.json'), 'utf8').slice(0, 300));
  }
  const shell1 = await (await fetch(`${url}/shell.json`)).json();
  console.log('shell1.meta:', JSON.stringify(shell1.meta));
  console.log('shell1.migrated:', shell1.migrated);
} finally {
  await new Promise((r) => server.close(r));
  rmSync(base, { recursive: true, force: true, maxRetries: 3 });
}
