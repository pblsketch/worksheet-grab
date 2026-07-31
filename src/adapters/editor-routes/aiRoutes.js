// aiRoutes — E5/S4.0 AI 브리지 라우트: 요청 생성(POST /ai/requests)·상태 조회(GET /ai/<id>)·
// 취소/적용 기록(POST /ai/<id>/cancel|applied).
//
// 무API — 요청은 파일 큐(<ws>/.ai-bridge/)에 기록되고 구독 AI 가 CLI 로 응답한다(서버는 중개만).
// 개체 ID 에코(F4 개정, worksheet-designer 계약과 정합): 클라이언트는 objects:[{id,type,…현재 개체
// 필드}] 로 개체를 전체 필드째 그대로 지목한다(구 bp/bi/slot 위치 주소·html 요약 폐기).
// 성취기준 개체(std-box, 원칙 3 — 창작 금지)는 개체 타입 가드로 거부한다 — 레거시 HTML 문서
// 세션도 /shell.json 이 이미 개체 트리로 마이그레이션해 서빙하므로 클라이언트가 보내는
// objects[].type 은 항상 ObjectCatalog 의 닫힌 카탈로그 타입이다. passage-slot 은 3층 정책
// (2026-07-23 2차 델타)으로 가드에서 해제되어 AI 요청 대상이 될 수 있다(§7 std-box 만 잔류).
import { PASS, sendJson, readJsonBody } from './httpKit.js';
import { AI_SCHEMA_VERSION, newRequestId, parseAction, assertTargetable } from '../../usecases/aiBridge.js';

/** pageVersions{pageId: version} 형태 검사 — 깨진 맵은 요청을 죽이지 않고 그냥 싣지 않는다. */
function normalizePageVersions(raw) {
  const usable = raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.entries(raw).length > 0
    && Object.entries(raw).every(([id, v]) => !!id && typeof v === 'string' && !!v);
  return usable ? { ...raw } : null;
}

export function createAiRoutes({ docName, aiBridge }) {
  return [
    {
      method: 'POST',
      path: '/ai/requests',
      async handler({ req, res }) {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        const rawObjects = Array.isArray(body?.objects) ? body.objects : [];
        // B1 프래그먼트 저작 요청(context.intent:'author-section')은 대상 개체가 없을 수 있다(빈 페이지에
        // 첫 섹션 저작). 그 외(rewrite)는 무엇을 고칠지 알아야 하므로 비어있지 않은 objects 를 강제한다.
        const isAuthorSection = body?.context && typeof body.context === 'object' && body.context.intent === 'author-section';
        try {
          parseAction(body?.action);
          if (rawObjects.length === 0 && !isAuthorSection) throw new Error('objects 가 필요합니다.');
          for (const o of rawObjects) {
            if (typeof o?.id !== 'string' || !o.id) throw new Error('각 개체에 id 가 필요합니다.');
            // 집합 중 하나라도 제외 타입(성취기준)이면 전체 400(부분 요청 금지, §7·§10).
            assertTargetable(o?.type);
          }
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        // Phase 4(v4): 클라이언트가 실은 pageId·pageVersion·scope 를 그대로 통과시킨다 —
        // pageVersion 은 "이 응답이 어떤 페이지 상태를 근거로 만들어졌는지"의 낙관적 동시성
        // 토큰이라, 서버가 재계산하면(문서 상태를 다시 읽으면) 그 시점 값이 되어 의미를 잃는다.
        // 신뢰 경계는 그대로다: docName 은 여전히 서버 고정값이고, 이 필드들은 적용 시점에
        // 클라이언트가 자기 문서로 다시 검증한다.
        const pageVersions = normalizePageVersions(body?.pageVersions);
        const request = {
          schemaVersion: AI_SCHEMA_VERSION, // = 4 (신규 요청 쓰기: 개체 ID 에코 + 페이지 컨텍스트)
          id: newRequestId(),
          docName, // 서버 고정값 주입(클라이언트 위조 방지)
          action: body.action,
          objects: rawObjects.map((o) => ({ ...o })), // 개체 전체 필드 그대로 보존(html 요약 아님)
          instruction: typeof body.instruction === 'string' ? body.instruction : '',
          context: body.context && typeof body.context === 'object' ? body.context : {},
          scope: body?.scope === 'page' ? 'page' : 'objects',
          ...(typeof body?.pageId === 'string' && body.pageId ? { pageId: body.pageId } : {}),
          ...(typeof body?.pageVersion === 'string' && body.pageVersion ? { pageVersion: body.pageVersion } : {}),
          // pageVersions{pageId: version} — 요청이 걸친 모든 페이지의 지문(대표 한 장만으로는 여러 쪽
          // 선택에서 덮어쓰기를 놓친다). 값 형태만 훑어 거르고 나머지는 validateRequest 가 강제한다.
          ...(pageVersions ? { pageVersions } : {}),
          status: 'pending',
        };
        await aiBridge.putRequest(request);
        return sendJson(res, 200, { id: request.id, status: 'pending' });
      },
    },
    {
      method: 'GET',
      prefix: '/ai/',
      async handler({ res, rest }) {
        try {
          const status = await aiBridge.getStatus(rest);
          if (!status) return sendJson(res, 404, { error: '요청 없음' });
          const payload = { status };
          // unsupported(열화 반려)도 response 를 실어 보낸다 — reason 을 폴링이 즉시 표시한다.
          if (status === 'answered' || status === 'unsupported') payload.response = await aiBridge.readResponse(rest);
          return sendJson(res, 200, payload);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
      },
    },
    {
      method: 'POST',
      prefix: '/ai/',
      async handler({ res, rest }) {
        // cancel/applied 접미사가 아닌 POST /ai/* 는 이 라우트가 처리하지 않는다 — 원본 사슬에서
        // 그대로 흘러내려 405 가 되던 동작을 PASS 로 재현한다.
        const suffix = ['/cancel', '/applied'].find((s) => rest.endsWith(s));
        if (!suffix) return PASS;
        const id = rest.slice(0, -suffix.length);
        try {
          if (suffix === '/cancel') {
            await aiBridge.setStatus(id, 'cancelled');
            return sendJson(res, 200, { status: 'cancelled' });
          }
          await aiBridge.setStatus(id, 'applied');
          await aiBridge.prune({ ids: [id] }); // 적용 완료분은 즉시 정리(스테일 방지)
          return sendJson(res, 200, { status: 'applied' });
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
      },
    },
  ];
}
