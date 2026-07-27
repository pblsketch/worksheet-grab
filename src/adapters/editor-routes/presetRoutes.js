// presetRoutes — 내 블록(프리셋) 라우트: 목록·저장·삭제·복원.
//
// E4 프리셋(자산): SaveDocument 게이트 미경유 — 프리셋은 문서가 아니라 재사용 상용구다
// (§3.2 "아무거나 저장"). 정답 포함 프리셋도 허용하며, 문서 불변식은 삽입되어 문서로 저장될 때
// SaveDocument 가, 미리보기 안전은 클라이언트 물리 제거본이 맡는다.
import { PASS, sendJson, readJsonBody } from './httpKit.js';

export function createPresetRoutes({ presetLibrary }) {
  return [
    {
      method: 'GET',
      path: '/presets',
      async handler({ res }) {
        return sendJson(res, 200, await presetLibrary.list());
      },
    },
    {
      method: 'POST',
      path: '/presets',
      async handler({ req, res }) {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        if (!body || typeof body.name !== 'string' || typeof body.html !== 'string') {
          return sendJson(res, 400, { error: 'name·html 이 필요합니다.' });
        }
        try {
          const preset = await presetLibrary.save({ name: body.name, type: body.type, html: body.html, desc: body.desc });
          return sendJson(res, 200, preset);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
      },
    },
    {
      method: 'DELETE',
      prefix: '/presets/',
      async handler({ res, rest }) {
        try {
          return sendJson(res, 200, await presetLibrary.delete(rest));
        } catch (e) {
          return sendJson(res, 404, { error: e.message });
        }
      },
    },
    {
      method: 'POST',
      prefix: '/presets/',
      async handler({ res, rest }) {
        // restore/ 가 아닌 POST /presets/* 는 이 라우트가 처리하지 않는다 — 원본 사슬에서 그대로
        // 흘러내려 405 가 되던 동작을 PASS 로 재현한다.
        if (!rest.startsWith('restore/')) return PASS;
        try {
          return sendJson(res, 200, await presetLibrary.restore(rest.slice('restore/'.length)));
        } catch (e) {
          return sendJson(res, 404, { error: e.message });
        }
      },
    },
  ];
}
