// documentRoutes — 문서 자체를 다루는 라우트: 저장(POST /save)·용지 변경(POST /paper)·
// 셸 서빙(GET /shell.json).
//
// Phase 5 에서 EditorHttpServer.js 의 해당 분기를 그대로 옮겨 왔다(동작 무변경). 신뢰 경계도
// 그대로다: docName 은 서버 고정값이라 클라이언트가 어떤 문서를 건드릴지 고를 수 없다.
import { sendJson, readJsonBody } from './httpKit.js';
import { ValidateObjectTree } from '../../usecases/ValidateObjectTree.js';
import { migrateManifestToObjectTree } from '../../usecases/MigrateManifestToObjectTree.js';
import { resolvePaper } from '../../usecases/paper.js';
import { excludedTypes } from '../../usecases/aiBridge.js';
import { loadKnownSubjectHexes } from '../../usecases/renderAssets.js';
import { PAGINATION_STATES } from '../../domain/schema/index.js';
import { normalizePageIdentity } from '../../domain/schema/PageIdentity.js';

/** 저장본이 이미 개체 트리로 승격됐는지(pagination 필드 보유) — /shell.json·/paper 공통 판정.
 *  둘이 어긋나면 개체 트리 저장본에 구 manifest 저장 경로가 걸려 스키마가 깨진다(S4.1 공백 ②). */
function isObjectTreeManifest(manifest) {
  return PAGINATION_STATES.includes(manifest?.pagination);
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

export function createDocumentRoutes({
  docName, blockRepository, curriculum, opener, saver, shellRenderer, testSeed = false,
}) {
  return [
    // E3/S4.0 저장: 클라이언트가 개체 트리 문서를 직송 → ValidateObjectTree → SaveDocument.checkpoint
    // 단일 경유(누출 게이트·히스토리). DOM 역동기화(.wg-block 순회·resync)는 폐지됐다 — 클라이언트가
    // 편집 결과를 개체 트리 JSON 그대로 들고 온다.
    {
      method: 'POST',
      path: '/save',
      async handler({ req, res }) {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        if (!body || typeof body.document !== 'object' || body.document === null) {
          return sendJson(res, 400, { error: 'document(개체 트리)가 필요합니다.' });
        }
        const document = body.document;
        const { ok, findings } = new ValidateObjectTree().execute(document);
        if (!ok) return sendJson(res, 400, { error: '개체 트리 검증 실패', findings });
        const result = await saver.checkpoint({
          name: docName,
          document,
          checkpointName: typeof body.checkpointName === 'string' ? body.checkpointName : null,
        });
        return sendJson(res, 200, {
          unsafe: result.unsafe,
          leakFindings: result.leakFindings,
          meta: result.meta,
          document: result.document,
        });
      },
    },
    // E6 용지 변경(§3.3): manifest 레벨 변이라 /save(DOM 역동기화)와 분리 —
    // 저장본의 paper 만 치환해 SaveDocument 단일 게이트로 재저장한다.
    // 클라이언트는 호출 전 save-first(dirty 시)로 편집 손실을 막는다.
    // S4.1(us15.md 후속 공백 ②): 저장본이 이미 개체 트리로 승격된 문서(pagination 필드 보유)면
    // 구 saver.execute()(HTML manifest 전용, AssembleWorksheet 경유)를 호출하면 스키마가
    // 어긋난다 — /shell.json 과 동일한 isObjectTreeManifest 판정으로 분기해 saver.checkpoint() 로 보낸다.
    {
      method: 'POST',
      path: '/paper',
      async handler({ req, res }) {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        let resolved;
        try {
          resolved = resolvePaper(body?.paper ?? null);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        const { manifest } = await opener.execute({ name: docName });
        const current = resolvePaper(manifest.paper ?? null);
        // no-op 가드: 동일 용지 재선택으로 불필요한 리비전·스냅샷을 만들지 않는다.
        if (JSON.stringify(current) === JSON.stringify(resolved)) return sendJson(res, 200, { noop: true });
        const next = { ...manifest };
        if (body?.paper == null) delete next.paper;
        else next.paper = body.paper;
        const result = isObjectTreeManifest(manifest)
          ? await saver.checkpoint({ name: docName, document: next })
          : await saver.execute({ name: docName, manifest: next });
        return sendJson(res, 200, { noop: false, unsafe: result.unsafe, meta: result.meta });
      },
    },
    // 테마(교과 색상) 변경 — /paper 와 동형(manifest 한 필드만 치환 후 SaveDocument 단일 게이트 재저장).
    // 색상만 바꾸므로 리플로우 전제(가용 높이)는 불변 → 클라이언트는 reload 만 한다. themeName 은
    // listThemes 화이트리스트로 검증한다(경로 이탈·미존재 테마 차단 — loadThemeCss 안전).
    {
      method: 'POST',
      path: '/theme',
      async handler({ req, res }) {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        const themeName = typeof body?.themeName === 'string' ? body.themeName.trim() : '';
        if (!themeName) return sendJson(res, 400, { error: 'themeName 이 필요합니다.' });
        const available = (await blockRepository.listThemes()).map((t) => t.name);
        if (!available.includes(themeName)) return sendJson(res, 400, { error: `알 수 없는 테마: ${themeName}` });
        const { manifest } = await opener.execute({ name: docName });
        const objectTree = isObjectTreeManifest(manifest);
        const currentTheme = objectTree ? (manifest.themeName || '') : (manifest.theme || '');
        // no-op 가드: 같은 테마 재선택으로 불필요한 리비전을 만들지 않는다(/paper 관례와 동형).
        if (currentTheme === themeName) return sendJson(res, 200, { noop: true });
        const next = { ...manifest };
        if (objectTree) next.themeName = themeName;
        else next.theme = themeName;
        const result = objectTree
          ? await saver.checkpoint({ name: docName, document: next })
          : await saver.execute({ name: docName, manifest: next });
        return sendJson(res, 200, { noop: false, unsafe: result.unsafe, meta: result.meta });
      },
    },
    {
      method: 'GET',
      path: '/shell.json',
      async handler({ res }) {
        // 매 요청 신선 로드: E3 편집·외부 저장 후 새로고침만으로 최신 문서 반영.
        const { manifest: raw, meta, warnings } = await opener.execute({ name: docName });
        // S4.0 지연 마이그레이션(A1): pagination 필드 유무로 개체 트리/구 manifest 를 구분한다.
        // 구 manifest 는 이 GET 경로에서 절대 쓰지 않는다 — 승격은 메모리 내에서만 일어나고,
        // 디스크 커밋은 클라이언트가 되돌려 보낸 문서를 POST /save 가 처리할 때 비로소 일어난다.
        const objectTree = isObjectTreeManifest(raw);
        const loadedDocument = objectTree ? raw : await buildLegacyDocument(raw, { blockRepository, curriculum });
        const document = normalizePageIdentity(loadedDocument);
        const knownSubjectHexes = await loadKnownSubjectHexes(blockRepository);
        const shell = await shellRenderer.executeObjectTree({ document, meta, knownSubjectHexes, docName });
        // 사용 가능한 교과 테마 목록(인스펙터 테마 드롭다운용) — themes/*.css 단일 원천.
        const availableThemes = (await blockRepository.listThemes()).map((t) => t.name);
        // document 동봉: 개체 트리 왕복의 원본(클라이언트가 편집 후 그대로 POST /save 한다).
        // excludedAiTypes: AI 버튼 비활성용(타입 가드 3중의 클라이언트 층 — §7·§10).
        const payload = {
          ...shell, document, warnings, excludedAiTypes: [...excludedTypes()], migrated: !objectTree, availableThemes,
        };
        return sendJson(res, 200, testSeed ? { ...payload, testSeed: true } : payload);
      },
    },
  ];
}
