import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { resolveBrowserGraph } from '../editor/browserGraph.js';
import { RenderEditorShell } from '../usecases/RenderEditorShell.js';
import { OpenDocument } from '../usecases/OpenDocument.js';
import { SaveDocument } from '../usecases/SaveDocument.js';
import { PresetLibrary } from '../usecases/PresetLibrary.js';
import { FsPresetRepository } from './FsPresetRepository.js';
import { FsAiBridgeRepository } from './FsAiBridgeRepository.js';
import { AI_SCHEMA_VERSION, newRequestId, parseAction, assertTargetable, excludedTypes } from '../usecases/aiBridge.js';

const MAX_SAVE_BODY = 20 * 1024 * 1024; // 로컬 편집 도구의 안전 상한

function readJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_SAVE_BODY) { rejectPromise(new Error('본문이 너무 큽니다.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectPromise(new Error('JSON 파싱 실패')); }
    });
    req.on('error', rejectPromise);
  });
}

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
 * @param {{root:string, docName:string, workspace, blockRepository, curriculum, testSeed?:boolean}} deps
 *   testSeed: 렌더 테스트 전용 — shell.json 에 testSeed 필드를 노출해 클라이언트의
 *   `?seed=` 결정적 편집 훅을 활성화한다. 기본 기동(edit-ui)에선 꺼져 있어
 *   시드 훅이 실데이터를 변경할 수 없다.
 * @returns {import('node:http').Server}
 */
export function createEditorServer({ root, docName, workspace, blockRepository, curriculum, testSeed = false }) {
  const absRoot = resolve(root);
  const editorDir = join(absRoot, 'src', 'editor');
  const whitelist = new Set(resolveBrowserGraph(absRoot).files);
  const shellRenderer = new RenderEditorShell({ blockRepository, curriculum });
  const opener = new OpenDocument({ workspace });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum });
  const presetLibrary = new PresetLibrary({
    presetRepository: new FsPresetRepository({ baseDir: workspace.baseDir }),
    blockRepository,
  });
  const aiBridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

      // E3 저장: 클라이언트 역동기화 manifest → SaveDocument 단일 경유(누출 게이트·히스토리).
      if (req.method === 'POST' && path === '/save') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        if (!body || typeof body.manifest !== 'object' || body.manifest === null) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'manifest 가 필요합니다.' }));
        }
        const result = await saver.execute({ name: docName, manifest: body.manifest });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
          unsafe: result.unsafe,
          leakFindings: result.leakFindings,
          meta: result.meta,
          structureWarning: body.structureWarning === true,
        }));
      }
      // E4 프리셋(자산): SaveDocument 게이트 미경유 — 프리셋은 문서가 아니라 재사용 상용구다
      // (§3.2 "아무거나 저장"). 정답 포함 프리셋도 허용하며, 문서 불변식은 삽입되어
      // 문서로 저장될 때 SaveDocument 가, 미리보기 안전은 클라이언트 물리 제거본이 맡는다.
      if (path === '/presets') {
        if (req.method === 'GET') {
          return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await presetLibrary.list()));
        }
        if (req.method === 'POST') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (e) {
            return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
          }
          if (!body || typeof body.name !== 'string' || typeof body.html !== 'string') {
            return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'name·html 이 필요합니다.' }));
          }
          try {
            const preset = await presetLibrary.save({ name: body.name, type: body.type, html: body.html, desc: body.desc });
            return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(preset));
          } catch (e) {
            return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
          }
        }
      }
      if (path.startsWith('/presets/')) {
        const rest = path.slice('/presets/'.length);
        try {
          if (req.method === 'DELETE') {
            return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await presetLibrary.delete(rest)));
          }
          if (req.method === 'POST' && rest.startsWith('restore/')) {
            return send(res, 200, 'application/json; charset=utf-8',
              JSON.stringify(await presetLibrary.restore(rest.slice('restore/'.length))));
          }
        } catch (e) {
          return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
      }
      // E5 AI 브리지: 요청은 파일 큐(<ws>/.ai-bridge/)에 기록되고 구독 AI 가 CLI 로
      // 응답한다(무API — 서버는 중개만). 성취기준·저작권 슬롯 블록은 타입 가드로 거부.
      if (path === '/ai/requests' && req.method === 'POST') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        try {
          parseAction(body?.action);
          const vocabulary = await blockRepository.readVocabulary();
          assertTargetable(body?.block?.bt, vocabulary);
          if (typeof body?.block?.html !== 'string' || !body.block.html.trim()) {
            throw new Error('block.html 이 필요합니다.');
          }
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        const request = {
          schemaVersion: AI_SCHEMA_VERSION,
          id: newRequestId(),
          docName, // 서버 고정값 주입(클라이언트 위조 방지)
          action: body.action,
          block: { bp: body.block.bp ?? null, bi: body.block.bi ?? null, bt: body.block.bt || 'content', html: body.block.html },
          instruction: typeof body.instruction === 'string' ? body.instruction : '',
          context: body.context && typeof body.context === 'object' ? body.context : {},
          status: 'pending',
        };
        await aiBridge.putRequest(request);
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ id: request.id, status: 'pending' }));
      }
      if (path.startsWith('/ai/')) {
        const rest = path.slice('/ai/'.length);
        try {
          if (req.method === 'GET') {
            const status = await aiBridge.getStatus(rest);
            if (!status) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: '요청 없음' }));
            const payload = { status };
            if (status === 'answered') payload.response = await aiBridge.readResponse(rest);
            return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(payload));
          }
          if (req.method === 'POST' && rest.endsWith('/cancel')) {
            const id = rest.slice(0, -'/cancel'.length);
            await aiBridge.setStatus(id, 'cancelled');
            return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ status: 'cancelled' }));
          }
          if (req.method === 'POST' && rest.endsWith('/applied')) {
            const id = rest.slice(0, -'/applied'.length);
            await aiBridge.setStatus(id, 'applied');
            await aiBridge.prune({ ids: [id] }); // 적용 완료분은 즉시 정리(스테일 방지)
            return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ status: 'applied' }));
          }
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
      }
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'GET only');

      if (path === '/') {
        return send(res, 200, MIME['.html'], await readFile(join(editorDir, 'editor.html')));
      }
      if (path === '/shell.json') {
        // 매 요청 신선 로드: E3 편집·외부 저장 후 새로고침만으로 최신 문서 반영.
        const { manifest, meta, warnings } = await opener.execute({ name: docName });
        const themes = await blockRepository.listThemes();
        const knownSubjectHexes = [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
        const shell = await shellRenderer.execute({ manifest, meta, knownSubjectHexes, docName });
        // manifest 동봉: 클라이언트 역동기화(resync)가 pages 외 필드를 보존하는 원본.
        // excludedAiTypes: AI 버튼 비활성용(타입 가드 3중의 클라이언트 층 — §7·§10).
        const excludedAiTypes = [...excludedTypes(await blockRepository.readVocabulary())];
        const payload = { ...shell, manifest, warnings, excludedAiTypes };
        return send(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(testSeed ? { ...payload, testSeed: true } : payload));
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
