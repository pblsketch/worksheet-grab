import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateObjectShape } from '../../src/domain/schema/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 삽입 카탈로그(좌측 패널 ②) 의 각 항목이 스키마 유효 개체를 만드는지 — 카탈로그(objectFactory
// CATALOG_ITEMS)·팩토리(createObject/defaultFieldsFor)·스키마(TYPE_SPECS) 세 산출물이 갈라지면
// 교사는 "삽입했는데 저장이 안 된다"만 본다. M4 에서 새 타입(callout)이 이 삼각을 건드렸으므로 고정한다.
//
// 로딩은 resize-flow.test.js 와 동형(src/editor/* 브라우저 절대경로만 file URL 로 치환 — 진짜 소스).
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

test('CATALOG_ITEMS 전 항목이 스키마 유효 개체를 만든다(카탈로그↔팩토리↔스키마 삼각 고정)', async () => {
  const { CATALOG_ITEMS, createObject } = await loadObjectFactory();
  for (const item of CATALOG_ITEMS) {
    const placement = item.floatOnly ? 'float' : 'flow';
    const obj = createObject(item.type, { placement, qtype: item.qtype });
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${item.key} → ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('강조상자(callout) 삽입 기본값 — note variant + body(스키마 필수) · flow 전용', async () => {
  const { createObject } = await loadObjectFactory();
  const obj = createObject('callout');
  assert.equal(obj.type, 'callout');
  assert.equal(obj.placement, 'flow', 'callout 은 flow 전용(placement:float 요청도 flow 로 접힘)');
  assert.equal(obj.variant, 'note', '중립 참고 박스로 시작');
  assert.equal(typeof obj.body, 'string');
  assert.ok(obj.body.length > 0, 'body(스키마 필수)가 비면 안 됨');
  assert.equal(obj.rect, undefined, 'flow 개체는 좌표를 갖지 않는다(원칙 3)');
  assert.ok(validateObjectShape(obj).ok);
});

test('강조상자는 flow 전용 — float 요청도 flow 로 접힌다', async () => {
  const { createObject } = await loadObjectFactory();
  const obj = createObject('callout', { placement: 'float' });
  assert.equal(obj.placement, 'flow');
  assert.equal(obj.rect, undefined);
});
