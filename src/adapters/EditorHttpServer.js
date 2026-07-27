import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { resolveBrowserGraph } from '../editor/browserGraph.js';
import { RenderEditorShell } from '../usecases/RenderEditorShell.js';
import { OpenDocument } from '../usecases/OpenDocument.js';
import { SaveDocument } from '../usecases/SaveDocument.js';
import { PresetLibrary } from '../usecases/PresetLibrary.js';
import { FsPresetRepository } from './FsPresetRepository.js';
import { FsAiBridgeRepository } from './FsAiBridgeRepository.js';
import { ChromeRenderer } from './ChromeRenderer.js';
import { send, dispatch, TEXT_TYPE } from './editor-routes/httpKit.js';
import { createDocumentRoutes } from './editor-routes/documentRoutes.js';
import { createPresetRoutes } from './editor-routes/presetRoutes.js';
import { createRenderRoutes } from './editor-routes/renderRoutes.js';
import { createAiRoutes } from './editor-routes/aiRoutes.js';
import { createAssetRoutes } from './editor-routes/assetRoutes.js';
import { createStaticRoutes } from './editor-routes/staticRoutes.js';

// EditorHttpServer — 에디터 셸(E2)의 로컬 HTTP 어댑터. 127.0.0.1 전용.
// 셸 데이터는 /shell.json(application/json) 으로만 나간다 — 조립본 head 의 KaTeX
// `</script>` 때문에 인라인 `<script>` 주입은 반드시 파싱 붕괴한다(계획 v2.1 HIGH).
//
// Phase 5(모듈 경계 정리): 이 파일은 이제 **조립 지점**이다. 라우트 구현은 editor-routes/ 의
// 주제별 모듈에 있고 여기서는 의존성을 만들어 주입하고 라우트 테이블을 잇는다.
// 매칭 계약은 httpKit.dispatch 가 소유한다 — 선언 순서대로 method+path/prefix 매칭, 아무도
// 처리하지 않으면 GET 이 아닐 때 405, GET 이면 404(구 선형 if 사슬과 동일한 순서).

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
  const opener = new OpenDocument({ workspace });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum });
  // E6 renderer 주입 seam(테스트 목) — 미주입 시 첫 렌더 요청에서 지연 생성한다.
  // 생성자에서 만들면 Chrome 미설치 환경에서 편집 자체가 못 뜨기 때문.
  let rendererInstance = renderer;
  const getRenderer = () => (rendererInstance ??= new ChromeRenderer({ chromePath }));

  const routes = [
    ...createDocumentRoutes({
      docName, blockRepository, curriculum, opener, saver, testSeed,
      shellRenderer: new RenderEditorShell({ blockRepository, curriculum }),
    }),
    ...createPresetRoutes({
      presetLibrary: new PresetLibrary({
        presetRepository: new FsPresetRepository({ baseDir: workspace.baseDir }),
        blockRepository,
      }),
    }),
    ...createRenderRoutes({ docName, workspace, opener, getRenderer }),
    ...createAiRoutes({ docName, aiBridge: new FsAiBridgeRepository({ baseDir: workspace.baseDir }) }),
    ...createAssetRoutes({ docName, workspace }),
    ...createStaticRoutes({ absRoot, editorDir, whitelist }),
  ];

  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (await dispatch(routes, { req, res, path })) return;
      if (req.method !== 'GET') return send(res, 405, TEXT_TYPE, 'GET only');
      return send(res, 404, TEXT_TYPE, 'not found');
    } catch (e) {
      send(res, 500, TEXT_TYPE, `editor server error: ${e.message}`);
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
