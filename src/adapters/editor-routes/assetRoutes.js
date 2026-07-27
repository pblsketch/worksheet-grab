// assetRoutes — F1 이미지 자산 라우트: 업로드(POST /assets)·서빙(GET /assets/*).
//
// 자산은 SaveDocument 게이트 미경유(문서가 아니라 참조 파일) — 문서 불변식은 삽입 후 manifest
// 저장 시 SaveDocument 가, 학생용 안전은 마킹→BuildVariants 물리 제거가 맡는다.
// 보안 성질은 이 모듈에 모여 있다: assets.js 의 이름 살균·매직바이트 대조·5MB 상한 + 쓰기/읽기
// 양쪽의 assetsDir 경로 이탈 재검사.
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { send, sendJson, readBinaryBody } from './httpKit.js';
import { sanitizeAssetName, assertAllowedImage, imageMimeFor, MAX_IMAGE_BYTES } from '../../usecases/assets.js';

// 파일명에 -N 접미사 삽입(확장자 앞). rename 예약 충돌 시 다음 후보 생성용.
function suffixName(name, n) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

export function createAssetRoutes({ docName, workspace }) {
  const assetsDirOf = () => workspace.layout(docName).assetsDir;

  return [
    {
      method: 'POST',
      path: '/assets',
      async handler({ req, res }) {
        let buf;
        try {
          buf = await readBinaryBody(req, MAX_IMAGE_BYTES);
        } catch (e) {
          return sendJson(res, 413, { error: e.message });
        }
        const rawName = new URL(req.url, 'http://127.0.0.1').searchParams.get('name') || 'image';
        const assetsDir = assetsDirOf();
        await mkdir(assetsDir, { recursive: true });
        let existing = [];
        try { existing = await readdir(assetsDir); } catch { /* 신규 디렉토리 */ }
        let name;
        try {
          name = sanitizeAssetName(rawName, existing);
          assertAllowedImage(name, buf.length, buf); // 매직바이트 대조(확장자 위장 차단)
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
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
              return sendJson(res, 400, { error: '경로 이탈이 차단되었습니다.' });
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
          return sendJson(res, 409, { error: '동일 이름 자산이 많아 예약에 실패했습니다 — 다시 시도하세요.' });
        }
        return sendJson(res, 200, { path: `assets/${finalName}`, name: finalName });
      },
    },
    // 자산 서빙: assetsDir 밖(트래버설)·비이미지 확장자·부재는 404. 이미지 MIME 로 전송.
    {
      method: 'GET',
      prefix: '/assets/',
      async handler({ res, rest }) {
        const assetsDir = assetsDirOf();
        const abs = resolve(assetsDir, rest);
        const mime = imageMimeFor(abs);
        if (!abs.startsWith(resolve(assetsDir) + sep) || !mime || !existsSync(abs)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'not found');
        }
        return send(res, 200, mime, await readFile(abs));
      },
    },
  ];
}
