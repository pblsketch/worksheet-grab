import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { resolveBrowserGraph } from '../editor/browserGraph.js';
import { RenderEditorShell } from '../usecases/RenderEditorShell.js';
import { OpenDocument } from '../usecases/OpenDocument.js';

// EditorHttpServer — 에디터 셸(E2)의 로컬 HTTP 어댑터. 127.0.0.1 전용.
// 셸 데이터는 /shell.json(application/json) 으로만 나간다 — 조립본 head 의 KaTeX
// `</script>` 때문에 인라인 `<script>` 주입은 반드시 파싱 붕괴한다(계획 v2.1 HIGH).
// /src 는 browserGraph 화이트리스트(검수 체인 전이 집합)만 서빙한다(최소권한).

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

/**
 * @param {{root:string, docName:string, workspace, blockRepository, curriculum}} deps
 * @returns {import('node:http').Server}
 */
export function createEditorServer({ root, docName, workspace, blockRepository, curriculum }) {
  const absRoot = resolve(root);
  const editorDir = join(absRoot, 'src', 'editor');
  const whitelist = new Set(resolveBrowserGraph(absRoot).files);
  const shellRenderer = new RenderEditorShell({ blockRepository, curriculum });
  const opener = new OpenDocument({ workspace });

  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'GET only');
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

      if (path === '/') {
        return send(res, 200, MIME['.html'], await readFile(join(editorDir, 'editor.html')));
      }
      if (path === '/shell.json') {
        // 매 요청 신선 로드: E3 편집·외부 저장 후 새로고침만으로 최신 문서 반영.
        const { manifest, meta, warnings } = await opener.execute({ name: docName });
        const themes = await blockRepository.listThemes();
        const knownSubjectHexes = [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
        const shell = await shellRenderer.execute({ manifest, meta, knownSubjectHexes });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ...shell, warnings }));
      }
      if (path.startsWith('/src/')) {
        const rel = path.slice(1);
        if (rel.includes('..') || !whitelist.has(rel)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'not in browser whitelist');
        }
        return send(res, 200, MIME['.js'], await readFile(join(absRoot, ...rel.split('/'))));
      }
      if (path.startsWith('/editor/')) {
        const abs = resolve(editorDir, ...path.slice('/editor/'.length).split('/'));
        const ext = abs.slice(abs.lastIndexOf('.'));
        if (!abs.startsWith(editorDir + sep) || !MIME[ext]) {
          return send(res, 404, 'text/plain; charset=utf-8', 'not found');
        }
        return send(res, 200, MIME[ext], await readFile(abs));
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    } catch (e) {
      send(res, 500, 'text/plain; charset=utf-8', `editor server error: ${e.message}`);
    }
  });
}

/** 127.0.0.1 바인딩 listen(포트 0 = OS 할당). 테스트가 인프로세스로 기동·close 한다. */
export function listenEditorServer(server, { port = 0 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', () => resolvePromise(server.address()));
  });
}
