import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// src/editor/objectFactory.js 는 브라우저 전용 절대경로('/src/…')를 import 하므로(편집기 서버가 그
// 경로를 매핑해 서빙) node 가 직접 import 할 수 없다. 실제 소스의 절대경로 import 만 file URL 로
// 치환해 로드하면 — 복사본이 아니라 — 진짜 소스의 순수 함수 nudgeFloat 를 그대로 단위 검증할 수 있다.
// (schema/index.js 는 상대 import 라 file URL 기준으로 자연히 해석된다.)
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

function makeDoc(float) {
  return {
    pagination: 'paginated',
    pages: [{ flow: [{ id: 'flow1', type: 'title', placement: 'flow', text: 'x' }], float }],
  };
}

test('nudgeFloat: float 상대 이동 + 불변성 + round + 타 개체/없는 id 무변경', async () => {
  const { nudgeFloat } = await loadObjectFactory();
  const base = makeDoc([{ id: 'f1', type: 'answer-area', placement: 'float', rect: { xMm: 20, yMm: 30, wMm: 50, hMm: 25 } }]);

  // 기본 이동: x+1, y-2
  const moved = nudgeFloat(base, 'f1', 1, -2);
  const r = moved.pages[0].float[0].rect;
  assert.equal(r.xMm, 21, 'x+1');
  assert.equal(r.yMm, 28, 'y-2');
  assert.equal(r.wMm, 50, 'w 불변');
  assert.equal(r.hMm, 25, 'h 불변');

  // 불변성: 원본 문서는 변하지 않는다(순수 함수).
  assert.equal(base.pages[0].float[0].rect.xMm, 20, '원본 rect 불변');
  assert.notEqual(moved, base, '새 문서 반환');

  // round: 소수 1자리(20.05 → 20.1)
  const rounded = nudgeFloat(base, 'f1', 0.05, 0).pages[0].float[0].rect;
  assert.equal(rounded.xMm, 20.1, '소수 1자리 반올림');

  // flow 개체는 rect 가 없어 무변경(동일 참조 반환)
  assert.equal(nudgeFloat(base, 'flow1', 5, 5), base, 'flow 개체 무변경');

  // 없는 id 무변경
  assert.equal(nudgeFloat(base, 'nope', 5, 5), base, '없는 id 무변경');

  // rect 없는 float(방어) 무변경
  const noRect = makeDoc([{ id: 'f2', type: 'answer-area', placement: 'float' }]);
  assert.equal(nudgeFloat(noRect, 'f2', 5, 5), noRect, 'rect 없는 float 무변경');
});
