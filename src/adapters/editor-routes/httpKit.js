// httpKit — 편집기 HTTP 어댑터가 공유하는 최소 도구: 응답 전송·본문 리더·라우트 테이블 디스패처.
//
// Phase 5(모듈 경계 정리)에서 EditorHttpServer.js 의 단일 핸들러 안에 늘어서 있던 `if (path === …)`
// 15개를 주제별 라우트 모듈로 나누면서, 그 모듈들이 공통으로 쓰던 조각만 여기로 모았다.
//
// 라우트 매칭 계약(기존 선형 if 사슬의 동작을 그대로 보존한다):
//   1) 선언 순서대로 method 가 같고 path(정확) 또는 prefix(접두)가 맞는 첫 라우트를 호출한다.
//   2) 핸들러가 PASS 를 돌려주면 "이 라우트는 처리하지 않았다"는 뜻이라 매칭을 계속한다
//      (POST /presets/<restore 아님>·POST /ai/<cancel|applied 아님> 처럼 접두는 맞지만 세부
//      형태가 다른 요청이 원래 사슬에서 그냥 흘러내리던 동작의 재현이다).
//   3) 아무도 처리하지 않았고 GET 이 아니면 405, GET 이면 404 — 원본과 동일한 순서다.

export const PASS = Symbol('route-pass');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export const JSON_TYPE = 'application/json; charset=utf-8';
export const TEXT_TYPE = 'text/plain; charset=utf-8';

const MAX_SAVE_BODY = 20 * 1024 * 1024; // 로컬 편집 도구의 안전 상한

export function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

/** JSON 응답 단축 — 라우트 모듈이 매번 JSON.stringify + MIME 을 반복하지 않게 한다. */
export function sendJson(res, status, payload) {
  return send(res, status, JSON_TYPE, JSON.stringify(payload));
}

export function readJsonBody(req) {
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

/** 바이너리 본문 리더(이미지 업로드용). 상한 초과 시 스트림을 끊고 거부한다.
 *  cap 은 **필수**다 — 빠뜨리면 `size > undefined` 가 항상 false 라 상한이 통째로 사라진다
 *  (구 EditorHttpServer 는 `cap = MAX_IMAGE_BYTES` 기본값으로 이를 막고 있었다). 이 kit 은
 *  자산 도메인을 알지 못하므로 기본값 대신 호출부에 강제하고, 누락은 즉시 거부한다(fail-closed). */
export function readBinaryBody(req, cap) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!Number.isFinite(cap) || cap <= 0) {
      rejectPromise(new Error('readBinaryBody: 상한(cap)이 필요합니다.'));
      req.destroy();
      return;
    }
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

/**
 * 라우트 테이블을 순회해 첫 매칭 핸들러를 실행한다.
 * @param {Array<{method:string, path?:string, prefix?:string, handler:Function}>} routes
 * @param {{req, res, path:string}} ctx 핸들러에는 prefix 라우트일 때 rest(접두 제거분)가 더해져 전달된다.
 * @returns {Promise<boolean>} 처리됐으면 true(호출부는 405/404 폴백을 건너뛴다).
 */
export async function dispatch(routes, ctx) {
  for (const route of routes) {
    if (route.method !== ctx.req.method) continue;
    let rest = null;
    if (route.path !== undefined) {
      if (ctx.path !== route.path) continue;
    } else {
      if (!ctx.path.startsWith(route.prefix)) continue;
      rest = ctx.path.slice(route.prefix.length);
    }
    if (await route.handler({ ...ctx, rest }) !== PASS) return true;
  }
  return false;
}
