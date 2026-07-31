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

// ── #2 P2 / P3: 그림형(SVG) 조직자 — venn 은 편집 가능 organizer, 나머지는 잠금 richtext ──

test('그림형 조직자 삽입: venn 은 편집 가능 organizer, 나머지는 잠금 richtext — 전부 스키마 유효(P3)', async () => {
  const { GRAPHIC_ORGANIZER_INSERTS, EDITABLE_ORGANIZER_KINDS, createOrganizerObject } = await loadObjectFactory();
  assert.ok(GRAPHIC_ORGANIZER_INSERTS.length >= 6, `그림형 조직자 ≥6종(실제 ${GRAPHIC_ORGANIZER_INSERTS.length})`);
  for (const desc of GRAPHIC_ORGANIZER_INSERTS) {
    const obj = createOrganizerObject(desc.key);
    assert.equal(obj.placement, 'flow', `${desc.key}: flow`);
    assert.equal(obj.rect, undefined, `${desc.key}: flow 는 좌표 없음(원칙 3)`);
    assert.notEqual(obj.answer, true, `${desc.key}: 정답 플래그 없음`);
    if (EDITABLE_ORGANIZER_KINDS.includes(desc.key)) {
      // P3 승격: 편집 가능 그림형(현재 venn) — organizer 개체(개수·라벨 편집). 렌더는 같은 엔진.
      assert.equal(obj.type, 'organizer', `${desc.key}: 편집 가능 organizer 개체(P3 승격)`);
      assert.equal(obj.kind, desc.key, `${desc.key}: kind 보존`);
      assert.equal(obj.html, undefined, `${desc.key}: organizer 는 굽힌 html 을 갖지 않는다(렌더가 엔진 호출)`);
    } else {
      assert.equal(obj.type, 'richtext', `${desc.key}: 아직 잠금 richtext 삽입`);
      assert.match(obj.html, /<svg/, `${desc.key}: 인라인 SVG 포함(색은 blocks.css)`);
      assert.doesNotMatch(obj.html, /#[0-9a-fA-F]{3,6}\b/, `${desc.key}: HTML 에 hex 색 리터럴 없음(색은 CSS — 범교과)`);
    }
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${desc.key} 스키마 위반: ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('그림형 조직자 삽입: 잠금 richtext 종류의 html 은 엔진 생성기 기본 출력과 동일(단일 출처 — 드리프트 0)', async () => {
  const { GRAPHIC_ORGANIZER_INSERTS, EDITABLE_ORGANIZER_KINDS, createOrganizerObject } = await loadObjectFactory();
  for (const desc of GRAPHIC_ORGANIZER_INSERTS) {
    if (EDITABLE_ORGANIZER_KINDS.includes(desc.key)) continue; // organizer 로 승격된 종류는 굽힌 html 이 없다(렌더가 엔진 호출)
    const gen = ORGANIZER_GENERATORS[desc.key];
    assert.ok(typeof gen === 'function', `${desc.key}: OrganizerGen 생성기 존재`);
    assert.equal(createOrganizerObject(desc.key).html, gen({}),
      `${desc.key}: 삽입 SVG 가 compose 와 같은 엔진 기본 출력이어야(이중 출처 금지)`);
  }
});

test('vennSvg: labels 가 슬롯 텍스트만 채운다 — 엔진 소유 좌표·도형은 불변(원칙 3)', async () => {
  const { vennSvg } = await import('../../src/usecases/OrganizerGen.js');
  const base = vennSvg({ circles: 2 });
  const labeled = vennSvg({ circles: 2 }, ['식물', '동물', '공통점']);
  assert.match(labeled, /식물/);
  assert.match(labeled, /동물/);
  assert.match(labeled, /viewBox="0 0 440 240"/, '뷰박스(엔진 소유 좌표계) 불변');
  assert.equal(base.match(/<circle/g).length, labeled.match(/<circle/g).length, '도형 개수 불변');
  assert.match(vennSvg({ circles: 2 }, ['식물']), />B<\/text>/, '누락 슬롯은 기본 라벨(B)로 폴백');
  assert.match(vennSvg({ circles: 2 }, ['<b>x</b>']), /&lt;b&gt;x&lt;\/b&gt;/, '라벨은 이스케이프되어 주입 불가');
  assert.equal(vennSvg({ circles: 2 }), base, '라벨 미지정 출력은 기존과 바이트 동일(하위호환)');
});

// ── #2 P2b: 특수 레이아웃 조직자 잠금 삽입(richtext, 블록 HTML 번들) ──────────────

test('특수 조직자 삽입: 7종이 스키마 유효한 flow richtext(블록 HTML) 개체를 만든다(새 타입 없이)', async () => {
  const { SPECIAL_ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  assert.ok(SPECIAL_ORGANIZER_INSERTS.length >= 7, `특수 조직자 ≥7종(실제 ${SPECIAL_ORGANIZER_INSERTS.length})`);
  for (const desc of SPECIAL_ORGANIZER_INSERTS) {
    const obj = createOrganizerObject(desc.key);
    assert.equal(obj.type, 'richtext', `${desc.key}: richtext 잠금 삽입(새 개체 타입 아님)`);
    assert.equal(obj.placement, 'flow', `${desc.key}: flow`);
    assert.equal(obj.rect, undefined, `${desc.key}: flow 는 좌표 없음`);
    assert.match(obj.html, new RegExp(`class="[^"]*\\b${desc.key}\\b`), `${desc.key}: 블록 cssClass 포함(blocks.css 스타일 적용)`);
    assert.notEqual(obj.answer, true, `${desc.key}: 정답 플래그 없음`);
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${desc.key} 스키마 위반: ${findings.map((f) => f.rule).join(',')}`);
  }
});

// 태그 사이 서식용 공백(개행·들여쓰기)은 렌더에 무의미 — 구조 비교에서 무시하고 텍스트 공백만 1칸으로.
const normHtml = (s) => String(s ?? '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

test('특수 조직자 삽입: 번들 html 이 블록 파일과 동일(구조 정규화 — 단일 출처, 드리프트 감시)', async () => {
  const { SPECIAL_ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  const v = await repo.readVocabulary();
  for (const desc of SPECIAL_ORGANIZER_INSERTS) {
    const file = v.types[desc.key]?.file;
    assert.ok(file, `${desc.key}: vocabulary 에 블록 파일 등록`);
    const blockHtml = await repo.loadBlockHtml(file);
    assert.equal(normHtml(createOrganizerObject(desc.key).html), normHtml(blockHtml),
      `${desc.key}: 번들 html 이 블록 파일과 어긋남 — 블록이 바뀌면 SPECIAL_ORGANIZER_INSERTS 도 갱신하라`);
  }
});
