import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { resolveBrowserGraph } from '../editor/browserGraph.js';
import { RenderEditorShell } from '../usecases/RenderEditorShell.js';
import { OpenDocument } from '../usecases/OpenDocument.js';
import { SaveDocument } from '../usecases/SaveDocument.js';
import { ValidateObjectTree } from '../usecases/ValidateObjectTree.js';
import { migrateManifestToObjectTree } from '../usecases/MigrateManifestToObjectTree.js';
import { ExportDocument, UNSAFE_STUDENT_MESSAGE } from '../usecases/ExportDocument.js';
import { PresetLibrary } from '../usecases/PresetLibrary.js';
import { FsPresetRepository } from './FsPresetRepository.js';
import { FsAiBridgeRepository } from './FsAiBridgeRepository.js';
import { ChromeRenderer } from './ChromeRenderer.js';
import { resolvePaper, paperToPx } from '../usecases/paper.js';
import { sanitizeAssetName, assertAllowedImage, imageMimeFor, MAX_IMAGE_BYTES } from '../usecases/assets.js';
import { AI_SCHEMA_VERSION, newRequestId, parseAction, assertTargetable, excludedTypes } from '../usecases/aiBridge.js';
import { PAGINATION_STATES } from '../domain/schema/index.js';

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

// 파일명에 -N 접미사 삽입(확장자 앞). rename 예약 충돌 시 다음 후보 생성용.
function suffixName(name, n) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

// #5 내보내기 후 '열기' — OS 기본 앱(또는 탐색기)으로 파일/폴더를 연다. 대상 경로는 서버가
// workspace.layout 으로 고정 파생하므로(클라 임의 경로 불가) 로컬 편집 도구로서 안전하다.
// detached + unref 로 서버 프로세스 수명과 분리한다.
function openWithOs(target) {
  if (process.platform === 'win32') {
    // cmd start — 첫 "" 는 창 제목 자리(경로에 공백 있어도 안전). 셸 특수문자는 로컬 신뢰 경로라 무관.
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
}

// 이미지 업로드용 바이너리 본문 리더(cap=5MB). 상한 초과 시 스트림을 끊고 거부한다.
function readBinaryBody(req, cap = MAX_IMAGE_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { rejectPromise(new Error(`업로드가 너무 큽니다(상한 ${cap} bytes = 5MB).`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
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

// S4.0 지연 마이그레이션(A1, C-6/GAP-5): 구 HTML manifest 문서를 GET /shell.json 시 개체 트리로
// 승격해 서빙한다. 원본 manifest 는 절대 쓰지 않는다(읽기 전용 보존) — 새 스키마는 클라이언트가
// 되돌려 보낸 문서를 POST /save 가 SaveDocument.checkpoint 로 커밋할 때 비로소 디스크에 자리잡는다.
async function buildLegacyDocument(manifest, { blockRepository, curriculum }) {
  const migrated = await migrateManifestToObjectTree(manifest, { blockRepository });
  const standards = await resolveStandardsText(manifest, curriculum);
  return {
    ...migrated,
    docTitle: manifest.docTitle || '',
    subject: manifest.subject || '',
    dataSubject: manifest.dataSubject || manifest.subject || '',
    themeName: manifest.theme || '',
    lang: manifest.lang || 'ko',
    runHead: manifest.runHead || '',
    runFoot: manifest.runFoot || {},
    head: manifest.head || { katex: false },
    paper: manifest.paper ?? null,
    standards,
  };
}

// AssembleWorksheet#resolveStandards 와 동형(창작 금지 원칙 동일 적용) — 셸 서빙 시 이미 해석된
// 원문을 개체 트리 document.standards 에 실어야 RenderObjectTree 의 std-box 가 원문을 그릴 수 있다.
async function resolveStandardsText(manifest, curriculum) {
  const codes = manifest.standards || [];
  const fallback = manifest.standardsText || {};
  const out = [];
  for (const rawCode of codes) {
    const code = String(rawCode);
    let text = null;
    if (curriculum) {
      try {
        const r = await curriculum.resolve(code);
        if (r && r.text) text = r.text;
      } catch { /* MCP/CSV 실패 → 폴백 */ }
    }
    if (!text) text = fallback[code] || fallback[code.replace(/^\[|\]$/g, '')] || null;
    if (!text) throw new Error(`성취기준 ${code} 의 원문을 CSV/MCP/폴백 어디에서도 찾지 못했습니다(창작 금지).`);
    out.push({ code, text });
  }
  return out;
}

/**
 * @param {{root:string, docName:string, workspace, blockRepository, curriculum, testSeed?:boolean}} deps
 *   testSeed: 렌더 테스트 전용 — shell.json 에 testSeed 필드를 노출해 클라이언트의
 *   `?seed=` 결정적 편집 훅을 활성화한다. 기본 기동(edit-ui)에선 꺼져 있어
 *   시드 훅이 실데이터를 변경할 수 없다.
 * @returns {import('node:http').Server}
 */
export function createEditorServer({
  root, docName, workspace, blockRepository, curriculum, testSeed = false,
  renderer = null, chromePath = null,
}) {
  const absRoot = resolve(root);
  const editorDir = join(absRoot, 'src', 'editor');
  const whitelist = new Set(resolveBrowserGraph(absRoot).files);
  const shellRenderer = new RenderEditorShell({ blockRepository, curriculum });
  const opener = new OpenDocument({ workspace });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum });
  // E6 renderer 주입 seam(테스트 목) — 미주입 시 첫 렌더 요청에서 지연 생성한다.
  // 생성자에서 만들면 Chrome 미설치 환경에서 편집 자체가 못 뜨기 때문.
  let rendererInstance = renderer;
  const getRenderer = () => (rendererInstance ??= new ChromeRenderer({ chromePath }));
  // E6 in-flight 가드: Chrome 렌더(export·preview) 동시 1개 — 클라 버튼 비활성의
  // 서버측 백스톱(겹침 spawn flake 방지). 진행 중이면 409 busy.
  let renderBusy = false;
  const presetLibrary = new PresetLibrary({
    presetRepository: new FsPresetRepository({ baseDir: workspace.baseDir }),
    blockRepository,
  });
  const aiBridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

      // E3/S4.0 저장: 클라이언트가 개체 트리 문서를 직송 → ValidateObjectTree → SaveDocument.checkpoint
      // 단일 경유(누출 게이트·히스토리). DOM 역동기화(.wg-block 순회·resync)는 폐지됐다 — 클라이언트가
      // 편집 결과를 개체 트리 JSON 그대로 들고 온다.
      if (req.method === 'POST' && path === '/save') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        if (!body || typeof body.document !== 'object' || body.document === null) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'document(개체 트리)가 필요합니다.' }));
        }
        const { ok, findings } = new ValidateObjectTree().execute(body.document);
        if (!ok) {
          return send(res, 400, 'application/json; charset=utf-8',
            JSON.stringify({ error: '개체 트리 검증 실패', findings }));
        }
        const result = await saver.checkpoint({
          name: docName,
          document: body.document,
          checkpointName: typeof body.checkpointName === 'string' ? body.checkpointName : null,
        });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
          unsafe: result.unsafe,
          leakFindings: result.leakFindings,
          meta: result.meta,
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
      // E6 내보내기: 저장본(SaveDocument 게이트 통과 산출물)을 PDF 2벌로.
      // meta.unsafe 는 ExportDocument 가 fail-closed 승격(student 차단·teacher 보존).
      if (req.method === 'POST' && path === '/export') {
        if (renderBusy) {
          return send(res, 409, 'application/json; charset=utf-8',
            JSON.stringify({ error: 'busy', message: '렌더 진행 중입니다 — 잠시 후 다시 시도하세요.' }));
        }
        renderBusy = true;
        try {
          const exporter = new ExportDocument({ workspace, renderer: getRenderer(), fileExists: existsSync, removeFile: rm });
          const result = await exporter.execute({ name: docName });
          return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(result));
        } finally {
          renderBusy = false;
        }
      }
      // #5 내보내기 결과 열기: target(teacher-pdf|student-pdf|folder)만 받아 서버가 경로를 고정 파생한다.
      if (req.method === 'POST' && path === '/open') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        const layout = workspace.layout(docName);
        const targets = { 'teacher-pdf': layout.teacherPdfPath, 'student-pdf': layout.studentPdfPath, folder: layout.dir };
        const target = targets[body?.target];
        if (!target) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'target 은 teacher-pdf|student-pdf|folder 여야 합니다.' }));
        }
        if (!existsSync(target)) {
          return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: '대상이 아직 없습니다 — 먼저 내보내기하세요.' }));
        }
        try {
          openWithOs(target);
          return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
        } catch (e) {
          return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
      }
      // E6 용지 변경(§3.3): manifest 레벨 변이라 /save(DOM 역동기화)와 분리 —
      // 저장본의 paper 만 치환해 SaveDocument 단일 게이트로 재저장한다.
      // 클라이언트는 호출 전 save-first(dirty 시)로 편집 손실을 막는다.
      // S4.1(us15.md 후속 공백 ②): 저장본이 이미 개체 트리로 승격된 문서(pagination 필드 보유)면
      // 구 saver.execute()(HTML manifest 전용, AssembleWorksheet 경유)를 호출하면 스키마가
      // 어긋난다 — /shell.json 과 동일한 isObjectTree 판정으로 분기해 saver.checkpoint() 로 보낸다.
      if (req.method === 'POST' && path === '/paper') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        let resolved;
        try {
          resolved = resolvePaper(body?.paper ?? null);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        const { manifest } = await opener.execute({ name: docName });
        const current = resolvePaper(manifest.paper ?? null);
        // no-op 가드: 동일 용지 재선택으로 불필요한 리비전·스냅샷을 만들지 않는다.
        if (JSON.stringify(current) === JSON.stringify(resolved)) {
          return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ noop: true }));
        }
        const next = { ...manifest };
        if (body?.paper == null) delete next.paper;
        else next.paper = body.paper;
        const result = PAGINATION_STATES.includes(manifest?.pagination)
          ? await saver.checkpoint({ name: docName, document: next })
          : await saver.execute({ name: docName, manifest: next });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
          noop: false, unsafe: result.unsafe, meta: result.meta,
        }));
      }
      // E5/S4.0 AI 브리지: 요청은 파일 큐(<ws>/.ai-bridge/)에 기록되고 구독 AI 가 CLI 로
      // 응답한다(무API — 서버는 중개만). 개체 ID 에코(F4 개정, worksheet-designer 계약과 정합):
      // 클라이언트는 objects:[{id,type,…현재 개체 필드}] 로 개체를 전체 필드째 그대로 지목한다
      // (구 bp/bi/slot 위치 주소·html 요약 폐기 — 개체 트리의 현재 개체를 스키마 그대로 담아 보낸다).
      // 성취기준 개체(std-box, 원칙 3 — 창작 금지)는 개체 타입 가드로 거부 — 레거시 HTML 문서
      // 세션도 /shell.json 이 이미 개체 트리로 마이그레이션해 서빙하므로 클라이언트가 보내는
      // objects[].type 은 항상 ObjectCatalog 의 닫힌 카탈로그 타입이다. passage-slot 은 3층 정책
      // (2026-07-23 2차 델타)으로 가드에서 해제되어 AI 요청 대상이 될 수 있다(§7 std-box 만 잔류).
      if (path === '/ai/requests' && req.method === 'POST') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        const rawObjects = Array.isArray(body?.objects) ? body.objects : [];
        try {
          parseAction(body?.action);
          if (rawObjects.length === 0) throw new Error('objects 가 필요합니다.');
          for (const o of rawObjects) {
            if (typeof o?.id !== 'string' || !o.id) throw new Error('각 개체에 id 가 필요합니다.');
            // 집합 중 하나라도 제외 타입(성취기준·저작권 슬롯)이면 전체 400(부분 요청 금지, §7·§10).
            assertTargetable(o?.type);
          }
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        const request = {
          schemaVersion: AI_SCHEMA_VERSION, // = 3 (신규 요청 쓰기, 개체 ID 에코)
          id: newRequestId(),
          docName, // 서버 고정값 주입(클라이언트 위조 방지)
          action: body.action,
          objects: rawObjects.map((o) => ({ ...o })), // 개체 전체 필드 그대로 보존(html 요약 아님)
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
      // F1 이미지 업로드: 바이너리 본문 → assets.js 검증(경로탈출·확장자·5MB) → assetsDir 원자 쓰기.
      // 자산은 SaveDocument 게이트 미경유(문서가 아니라 참조 파일) — 문서 불변식은 삽입 후
      // manifest 저장 시 SaveDocument 가, 학생용 안전은 마킹→BuildVariants 물리 제거가 맡는다.
      if (req.method === 'POST' && path === '/assets') {
        let buf;
        try {
          buf = await readBinaryBody(req);
        } catch (e) {
          return send(res, 413, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        const rawName = new URL(req.url, 'http://127.0.0.1').searchParams.get('name') || 'image';
        const assetsDir = workspace.layout(docName).assetsDir;
        await mkdir(assetsDir, { recursive: true });
        let existing = [];
        try { existing = await readdir(assetsDir); } catch { /* 신규 디렉토리 */ }
        let name;
        try {
          name = sanitizeAssetName(rawName, existing);
          assertAllowedImage(name, buf.length, buf); // 매직바이트 대조(확장자 위장 차단)
        } catch (e) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }));
        }
        // tmp→rename 원자 쓰기(부분 파일 노출 방지). rename 은 dest 존재 시 Windows 에서 실패
        // (EEXIST/EPERM)하므로 이를 exclusive 예약으로 삼아 접미사 재시도한다 — readdir↔rename
        // 사이 TOCTOU·대소문자 무구분 FS 경합에서 기존 자산 덮어쓰기를 방어(bounded 20회).
        const tmp = join(assetsDir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await writeFile(tmp, buf);
        let finalName = name;
        let reserved = false;
        try {
          for (let attempt = 0; attempt < 20; attempt++) {
            const dest = join(assetsDir, finalName);
            // 방어적 트래버설 재검사(정규화 우회 봉쇄) — 쓰기 경로가 assetsDir 밖이면 거부.
            if (!resolve(dest).startsWith(resolve(assetsDir) + sep)) {
              await rm(tmp, { force: true });
              return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: '경로 이탈이 차단되었습니다.' }));
            }
            if (existsSync(dest)) { finalName = suffixName(name, attempt + 1); continue; } // POSIX 는 rename 이 덮어쓰므로 선점검
            try {
              await rename(tmp, dest);
              reserved = true;
              break;
            } catch (e) {
              if (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'ENOTEMPTY' || e.code === 'EACCES') {
                finalName = suffixName(name, attempt + 1);
                continue;
              }
              throw e;
            }
          }
        } finally {
          if (!reserved) await rm(tmp, { force: true });
        }
        if (!reserved) {
          return send(res, 409, 'application/json; charset=utf-8', JSON.stringify({ error: '동일 이름 자산이 많아 예약에 실패했습니다 — 다시 시도하세요.' }));
        }
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ path: `assets/${finalName}`, name: finalName }));
      }

      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'GET only');

      if (path === '/') {
        return send(res, 200, MIME['.html'], await readFile(join(editorDir, 'editor.html')));
      }
      if (path === '/shell.json') {
        // 매 요청 신선 로드: E3 편집·외부 저장 후 새로고침만으로 최신 문서 반영.
        const { manifest: raw, meta, warnings } = await opener.execute({ name: docName });
        // S4.0 지연 마이그레이션(A1): pagination 필드 유무로 개체 트리/구 manifest 를 구분한다.
        // 구 manifest 는 이 GET 경로에서 절대 쓰지 않는다 — 승격은 메모리 내에서만 일어나고,
        // 디스크 커밋은 클라이언트가 되돌려 보낸 문서를 POST /save 가 처리할 때 비로소 일어난다.
        const isObjectTree = PAGINATION_STATES.includes(raw?.pagination);
        const document = isObjectTree ? raw : await buildLegacyDocument(raw, { blockRepository, curriculum });
        const themes = await blockRepository.listThemes();
        const knownSubjectHexes = [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
        const shell = await shellRenderer.executeObjectTree({ document, meta, knownSubjectHexes, docName });
        // document 동봉: 개체 트리 왕복의 원본(클라이언트가 편집 후 그대로 POST /save 한다).
        // excludedAiTypes: AI 버튼 비활성용(타입 가드 3중의 클라이언트 층 — §7·§10).
        const excludedAiTypes = [...excludedTypes()];
        const payload = { ...shell, document, warnings, excludedAiTypes, migrated: !isObjectTree };
        return send(res, 200, 'application/json; charset=utf-8',
          JSON.stringify(testSeed ? { ...payload, testSeed: true } : payload));
      }
      // E6 정밀 미리보기(§3.4): 저장본을 백그라운드 Chrome 으로 PNG 렌더(첫 페이지).
      // scale:2 핀 고정(레티나) — IHDR 폭 == 2×paperToPx. student 는 unsafe 시 409.
      if (path === '/preview.png') {
        const mode = new URL(req.url, 'http://127.0.0.1').searchParams.get('mode') || 'teacher';
        if (mode !== 'teacher' && mode !== 'student') {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'mode 는 teacher|student' }));
        }
        if (renderBusy) {
          return send(res, 409, 'application/json; charset=utf-8',
            JSON.stringify({ error: 'busy', message: '렌더 진행 중입니다 — 잠시 후 다시 시도하세요.' }));
        }
        renderBusy = true;
        try {
          const { manifest, meta, paths } = await opener.execute({ name: docName });
          const unsafe = meta == null || meta.unsafe === true;
          if (mode === 'student' && unsafe) {
            return send(res, 409, 'application/json; charset=utf-8',
              JSON.stringify({ error: 'unsafe', message: UNSAFE_STUDENT_MESSAGE }));
          }
          const input = mode === 'student' ? paths.studentPath : paths.teacherPath;
          if (!existsSync(input)) {
            return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: '저장본이 없습니다 — 먼저 저장하세요.' }));
          }
          const { width, height } = paperToPx(resolvePaper(manifest.paper ?? null) ?? resolvePaper({ size: 'A4' }));
          const out = join(paths.metaDir, `preview-${mode}.png`);
          await getRenderer().renderToPng(input, out, { width, height, scale: 2 });
          return send(res, 200, 'image/png', await readFile(out));
        } finally {
          renderBusy = false;
        }
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
      // F1 자산 서빙: assetsDir 밖(트래버설)·비이미지 확장자·부재는 404. 이미지 MIME 로 전송.
      if (path.startsWith('/assets/')) {
        const assetsDir = workspace.layout(docName).assetsDir;
        const abs = resolve(assetsDir, path.slice('/assets/'.length));
        const mime = imageMimeFor(abs);
        if (!abs.startsWith(resolve(assetsDir) + sep) || !mime || !existsSync(abs)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'not found');
        }
        return send(res, 200, mime, await readFile(abs));
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
