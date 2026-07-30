import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateObjectShape } from '../../src/domain/schema/index.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { parseTableRows } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { ORGANIZER_GENERATORS } from '../../src/usecases/OrganizerGen.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 시각 조직자 삽입(#2) — objectFactory 의 ORGANIZER_INSERTS/createOrganizerObject 가
// (1) 스키마 유효한 flow `table` 개체를 만들고(새 개체 타입 없이),
// (2) 블록(blocks/core/<key>.html)의 라벨을 모두 담으며(드리프트 감시),
// (3) 원본 블록 디자인(등폭/의도폭 w · 필기 높이 h · 병합 중앙 개념)을 레이아웃 힌트로 재현하는지 검증한다.
// 로딩은 catalog-insert.test.js 동형(objectFactory 는 브라우저 절대경로 import → file URL 치환 data-URL).
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

const repo = new FsBlockRepository({ root: ROOT });
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cellTexts = (rows) => rows.flat().map((c) => norm(c?.text));

test('조직자 삽입: 전 항목이 스키마 유효한 flow table 개체(카탈로그↔팩토리↔스키마 삼각 고정)', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  assert.ok(ORGANIZER_INSERTS.length >= 10, `표형 조직자 ≥10종(실제 ${ORGANIZER_INSERTS.length})`);
  for (const desc of ORGANIZER_INSERTS) {
    const obj = createOrganizerObject(desc.key);
    assert.equal(obj.type, 'table', `${desc.key}: table 개체(새 타입 아님 — 스키마 무변경)`);
    assert.equal(obj.placement, 'flow', `${desc.key}: flow 전용`);
    assert.equal(obj.splittable, false, `${desc.key}: splittable=false(table 스키마 상수)`);
    assert.equal(obj.rect, undefined, `${desc.key}: flow 개체는 좌표 없음(원칙 3)`);
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${desc.key} 스키마 위반(w/h/align 은 셀 미검증 필드): ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('조직자 삽입: 서술자가 블록의 라벨을 모두 담는다(드리프트 감시 — 블록 라벨이 바뀌면 갱신하라)', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  const v = await repo.readVocabulary();
  for (const desc of ORGANIZER_INSERTS) {
    const html = await repo.loadBlockHtml(v.types[desc.key].file);
    const blockLabels = parseTableRows(html).flat().map((c) => norm(c.text)).filter(Boolean);
    const descTexts = new Set(cellTexts(createOrganizerObject(desc.key).rows));
    for (const label of blockLabels) {
      assert.ok(descTexts.has(label), `${desc.key}: 블록 라벨 "${label}" 이 삽입 서술자에 없음(라벨 드리프트)`);
    }
  }
});

test('조직자 삽입: 등폭/의도폭(w 합≈100)·필기높이(h) 레이아웃 힌트를 갖는다(원본 블록 디자인 재현)', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  for (const desc of ORGANIZER_INSERTS) {
    const rows = createOrganizerObject(desc.key).rows;
    const wsum = rows[0].reduce((s, c) => s + (typeof c.w === 'number' ? c.w : 0), 0);
    assert.ok(Math.abs(wsum - 100) < 0.1, `${desc.key}: 첫 행 열너비 w 합 ${wsum} ≠ 100(colgroup 등폭/의도폭)`);
    assert.ok(rows.flat().some((c) => typeof c.h === 'number' && c.h > 0), `${desc.key}: 필기 높이(h) 셀이 없음`);
  }
});

test('조직자 삽입: 프레이어 개념=병합 헤더(colspan2·중앙) · caption 없음 · 미지 키 throw · 정답 0', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  assert.throws(() => createOrganizerObject('no-such-organizer'), /알 수 없는 조직자/);
  const frayer = createOrganizerObject('frayer');
  assert.equal(frayer.caption, undefined, '개념은 caption 이 아니라 병합 셀로 표현');
  assert.equal(frayer.rows[0].length, 1, '프레이어 첫 행은 병합 셀 1개');
  assert.equal(frayer.rows[0][0].colspan, 2, '개념 셀 colspan=2(왼쪽 셀과 병합)');
  assert.equal(frayer.rows[0][0].header, true, '개념 셀은 헤더(th → 중앙정렬)');
  assert.match(frayer.rows[0][0].text, /개념/, '개념 라벨 포함');
  // 삽입 조직자는 전부 빈 구조 — answer:true 없음(정답 누출 원천 차단, #4 fail-closed 와 독립).
  for (const desc of ORGANIZER_INSERTS) {
    assert.notEqual(createOrganizerObject(desc.key).answer, true, `${desc.key}: 삽입 시 정답 플래그 없음`);
  }
});

// ── #2 P2: 그림형(SVG) 조직자 잠금 삽입(richtext) ──────────────────────────────

test('그림형 조직자 삽입: 6종이 스키마 유효한 flow richtext(인라인 SVG) 개체를 만든다(새 타입 없이)', async () => {
  const { GRAPHIC_ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  assert.ok(GRAPHIC_ORGANIZER_INSERTS.length >= 6, `그림형 조직자 ≥6종(실제 ${GRAPHIC_ORGANIZER_INSERTS.length})`);
  for (const desc of GRAPHIC_ORGANIZER_INSERTS) {
    const obj = createOrganizerObject(desc.key);
    assert.equal(obj.type, 'richtext', `${desc.key}: richtext 잠금 삽입(새 개체 타입 아님)`);
    assert.equal(obj.placement, 'flow', `${desc.key}: flow`);
    assert.equal(obj.rect, undefined, `${desc.key}: flow 는 좌표 없음`);
    assert.match(obj.html, /<svg/, `${desc.key}: 인라인 SVG 포함(색은 blocks.css)`);
    assert.doesNotMatch(obj.html, /#[0-9a-fA-F]{3,6}\b/, `${desc.key}: HTML 에 hex 색 리터럴 없음(색은 CSS — 범교과)`);
    assert.notEqual(obj.answer, true, `${desc.key}: 정답 플래그 없음`);
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${desc.key} 스키마 위반: ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('그림형 조직자 삽입: html 이 엔진 생성기(OrganizerGen) 기본 출력과 동일(단일 출처 — 드리프트 0)', async () => {
  const { GRAPHIC_ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  for (const desc of GRAPHIC_ORGANIZER_INSERTS) {
    const gen = ORGANIZER_GENERATORS[desc.key];
    assert.ok(typeof gen === 'function', `${desc.key}: OrganizerGen 생성기 존재`);
    assert.equal(createOrganizerObject(desc.key).html, gen({}),
      `${desc.key}: 삽입 SVG 가 compose 와 같은 엔진 기본 출력이어야(이중 출처 금지)`);
  }
});
