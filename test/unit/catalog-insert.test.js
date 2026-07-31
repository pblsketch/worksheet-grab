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

// ── P3 스파이크: 편집 가능 그림형 조직자(organizer) 삽입·편집·검증 고정 ──────────────
// 그림형 조직자는 잠금 richtext(내부 편집 불가)에서 편집 가능한 organizer 개체로 승격됐다(현재 venn).
// 삽입 팩토리·개수/라벨 편집·정답 fail-closed·kind 닫힘을 스키마와 함께 못 박아 드리프트를 막는다.

test('그림 조직자(venn)는 편집 가능한 organizer 개체로 삽입된다(P3 — 잠금 richtext 아님)', async () => {
  const { createOrganizerObject } = await loadObjectFactory();
  const obj = createOrganizerObject('venn');
  assert.equal(obj.type, 'organizer');
  assert.equal(obj.placement, 'flow');
  assert.equal(obj.kind, 'venn');
  assert.equal(obj.params.circles, 2, '기본 2원으로 삽입');
  assert.equal(obj.rect, undefined, 'flow 개체는 좌표를 갖지 않는다(엔진이 SVG 소유 — 원칙 3)');
  assert.ok(validateObjectShape(obj).ok);
});

test('createObject("organizer") 도 스키마 유효(기본 venn 2원)', async () => {
  const { createObject } = await loadObjectFactory();
  const obj = createObject('organizer');
  assert.equal(obj.type, 'organizer');
  assert.equal(obj.kind, 'venn');
  assert.ok(validateObjectShape(obj).ok);
});

test('organizer 개수·라벨 편집 결과가 스키마를 통과한다(개수 3 + 라벨 슬롯)', async () => {
  const { createOrganizerObject } = await loadObjectFactory();
  const base = createOrganizerObject('venn');
  const edited = { ...base, params: { circles: 3 }, labels: { a: '봄', b: '가을', c: '겨울', common: '공통' } };
  assert.ok(validateObjectShape(edited).ok, '개수·라벨을 바꿔도 유효한 개체여야 한다');
});

test('organizer 는 정답(answer)을 실을 수 없다(중립·fail-closed — callout 과 동형)', async () => {
  const { createOrganizerObject } = await loadObjectFactory();
  const obj = { ...createOrganizerObject('venn'), answer: true };
  const { ok, findings } = validateObjectShape(obj);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'unknown-field'), 'answer 위치 규칙 — organizer 는 answer 미허용');
});

test('organizer.kind 가 목록(ORGANIZER_KINDS) 밖이면 invalid-organizer-kind 로 거부', () => {
  const obj = { id: 'x', type: 'organizer', placement: 'flow', kind: 'spiral' };
  const { ok, findings } = validateObjectShape(obj);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'invalid-organizer-kind'));
});

test('그림형 조직자 6종 전부 편집 가능 organizer 로 삽입(venn·conceptmap·fishbone·flowchart·hierarchy·hexagon)', async () => {
  const { createOrganizerObject, EDITABLE_ORGANIZER_KINDS } = await loadObjectFactory();
  for (const kind of ['venn', 'conceptmap', 'fishbone', 'flowchart', 'hierarchy', 'hexagon']) {
    assert.ok(EDITABLE_ORGANIZER_KINDS.includes(kind), `${kind}: 편집 가능 kind`);
    const obj = createOrganizerObject(kind);
    assert.equal(obj.type, 'organizer', `${kind}: organizer 개체`);
    assert.equal(obj.kind, kind, `${kind}: kind 보존`);
    assert.ok(validateObjectShape(obj).ok, `${kind}: 스키마 유효`);
  }
});
