// staticRoutes — 정적 서빙: 셸 HTML(GET /)·검수 체인 모듈(GET /src/*)·편집기 모듈(GET /editor/*).
//
// 최소권한 두 겹이 여기 모여 있다(분리하면서 우회 경로가 생기지 않도록 한 모듈에 붙여 둔다):
//   /src/*    — browserGraph 화이트리스트(검수 체인의 전이 import 집합)에 있는 파일만. 밖은 404.
//   /editor/* — src/editor 디렉토리 안이면서 MIME 표에 있는 확장자만. 경로 이탈은 404.
// 두 경로 모두 `..` 를 포함하거나 정규화 후 기준 디렉토리를 벗어나면 파일을 읽지 않는다.
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { send, MIME } from './httpKit.js';

const NOT_FOUND = 'text/plain; charset=utf-8';

export function createStaticRoutes({ absRoot, editorDir, whitelist }) {
  return [
    {
      method: 'GET',
      path: '/',
      async handler({ res }) {
        return send(res, 200, MIME['.html'], await readFile(join(editorDir, 'editor.html')));
      },
    },
    {
      method: 'GET',
      prefix: '/src/',
      async handler({ res, path }) {
        const rel = path.slice(1);
        if (rel.includes('..') || !whitelist.has(rel)) {
          return send(res, 404, NOT_FOUND, 'not in browser whitelist');
        }
        return send(res, 200, MIME['.js'], await readFile(join(absRoot, ...rel.split('/'))));
      },
    },
    {
      method: 'GET',
      prefix: '/editor/',
      async handler({ res, rest }) {
        const abs = resolve(editorDir, ...rest.split('/'));
        const ext = abs.slice(abs.lastIndexOf('.'));
        if (!abs.startsWith(editorDir + sep) || !MIME[ext]) {
          return send(res, 404, NOT_FOUND, 'not found');
        }
        return send(res, 200, MIME[ext], await readFile(abs));
      },
    },
  ];
}
