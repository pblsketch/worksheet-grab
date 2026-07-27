import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// nudge-float.test.js 와 동일 규약 — 브라우저 전용 절대경로('/src/…') import 만 file URL 로 치환해
// 복사본이 아니라 진짜 소스의 순수 함수 reorderFloat 를 그대로 단위 검증한다.
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

const F = (id) => ({ id, type: 'shape', placement: 'float', rect: { xMm: 10, yMm: 10, wMm: 20, hMm: 20 }, shapeKind: 'rect' });
function makeDoc(floatIds) {
  return {
    pagination: 'paginated',
    pages: [{ flow: [{ id: 'flow1', type: 'title', placement: 'flow', text: 'x' }], float: floatIds.map(F) }],
  };
}
const order = (doc) => doc.pages[0].float.map((o) => o.id);

test('reorderFloat: 배열 위치(=페인트 순서) 앞뒤 이동', async () => {
  const { reorderFloat } = await loadObjectFactory();
  const base = makeDoc(['a', 'b', 'c']); // 배열 뒤 = 앞면(위)

  assert.deepEqual(order(reorderFloat(base, 'a', 'front')), ['b', 'c', 'a'], 'front=맨앞(배열 끝)');
  assert.deepEqual(order(reorderFloat(base, 'c', 'back')), ['c', 'a', 'b'], 'back=맨뒤(배열 앞)');
  assert.deepEqual(order(reorderFloat(base, 'a', 'forward')), ['b', 'a', 'c'], 'forward=한 칸 앞면');
  assert.deepEqual(order(reorderFloat(base, 'c', 'backward')), ['a', 'c', 'b'], 'backward=한 칸 뒷면');
  // 가운데 개체 한 칸 이동
  assert.deepEqual(order(reorderFloat(base, 'b', 'forward')), ['a', 'c', 'b'], '가운데 forward');
  assert.deepEqual(order(reorderFloat(base, 'b', 'backward')), ['b', 'a', 'c'], '가운데 backward');
});

test('reorderFloat: 불변성(원본 유지) + 새 문서 반환', async () => {
  const { reorderFloat } = await loadObjectFactory();
  const base = makeDoc(['a', 'b', 'c']);
  const next = reorderFloat(base, 'a', 'front');
  assert.deepEqual(order(base), ['a', 'b', 'c'], '원본 배열 불변(순수 함수)');
  assert.notEqual(next, base, '새 문서 반환');
  assert.notEqual(next.pages[0].float, base.pages[0].float, 'float 배열도 새 참조');
});

test('reorderFloat: 무동작 시 원본 참조 그대로(불필요 커밋 방지)', async () => {
  const { reorderFloat } = await loadObjectFactory();
  const base = makeDoc(['a', 'b', 'c']);

  // 이미 끝단
  assert.equal(reorderFloat(base, 'c', 'front'), base, '이미 맨앞이면 front 무동작');
  assert.equal(reorderFloat(base, 'a', 'back'), base, '이미 맨뒤면 back 무동작');
  assert.equal(reorderFloat(base, 'c', 'forward'), base, '맨앞에서 forward 무동작');
  assert.equal(reorderFloat(base, 'a', 'backward'), base, '맨뒤에서 backward 무동작');

  // 방어 케이스
  assert.equal(reorderFloat(base, 'flow1', 'front'), base, 'flow 개체 무동작');
  assert.equal(reorderFloat(base, 'nope', 'front'), base, '없는 id 무동작');
  assert.equal(reorderFloat(base, 'a', 'sideways'), base, '알 수 없는 mode 무동작');
  const solo = makeDoc(['solo']);
  assert.equal(reorderFloat(solo, 'solo', 'front'), solo, '단일 원소 무동작');
});
