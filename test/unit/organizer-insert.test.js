import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateObjectShape } from '../../src/domain/schema/index.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { parseTableRows } from '../../src/usecases/MigrateManifestToObjectTree.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 시각 조직자 삽입(#2) — objectFactory 의 ORGANIZER_INSERTS/createOrganizerObject 가
// (1) 스키마 유효한 flow `table` 개체를 만들고(새 개체 타입 없이 — 카탈로그↔팩토리↔스키마 삼각 고정),
// (2) 각 rows 가 blocks/core/<key>.html 의 <table> 을 parseTableRows 로 파생한 값과 동일한지
//     (단일 출처 — 블록↔서술자 드리프트 차단)를 검증한다.
// 로딩은 catalog-insert.test.js 동형(objectFactory 는 브라우저 절대경로 import → file URL 치환 data-URL).
async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

const repo = new FsBlockRepository({ root: ROOT });

test('조직자 삽입: 전 항목이 스키마 유효한 flow table 개체를 만든다(카탈로그↔팩토리↔스키마 삼각 고정)', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  assert.ok(ORGANIZER_INSERTS.length >= 10, `표형 조직자 삽입 ≥10종(실제 ${ORGANIZER_INSERTS.length})`);
  for (const desc of ORGANIZER_INSERTS) {
    const obj = createOrganizerObject(desc.key);
    assert.equal(obj.type, 'table', `${desc.key}: table 개체(새 타입 아님 — 스키마 무변경)`);
    assert.equal(obj.placement, 'flow', `${desc.key}: flow 전용`);
    assert.equal(obj.splittable, false, `${desc.key}: splittable=false(table 스키마 상수)`);
    assert.equal(obj.rect, undefined, `${desc.key}: flow 개체는 좌표 없음(원칙 3)`);
    assert.ok(Array.isArray(obj.rows) && obj.rows.length >= 1, `${desc.key}: rows 존재`);
    const { ok, findings } = validateObjectShape(obj);
    assert.ok(ok, `${desc.key} 스키마 위반: ${findings.map((f) => f.rule).join(',')}`);
  }
});

test('조직자 삽입: 각 서술자 rows 가 블록 <table> 파싱값과 동일(단일 출처 — 드리프트 차단)', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  const v = await repo.readVocabulary();
  for (const desc of ORGANIZER_INSERTS) {
    const file = v.types[desc.key]?.file;
    assert.ok(file, `${desc.key}: vocabulary 에 블록 파일 등록`);
    const html = await repo.loadBlockHtml(file);
    const blockRows = parseTableRows(html);
    assert.ok(blockRows, `${desc.key}: 블록에 <table> 존재(표형만 삽입 대상)`);
    assert.deepEqual(createOrganizerObject(desc.key).rows, blockRows,
      `${desc.key}: 삽입 rows 가 블록 <table> 과 어긋남 — 블록이 바뀌면 ORGANIZER_INSERTS 도 갱신하라`);
  }
});

test('조직자 삽입: 알 수 없는 키는 던지고, frayer 는 개념 caption 을 갖는다(빈 조직자 — 정답 없음)', async () => {
  const { ORGANIZER_INSERTS, createOrganizerObject } = await loadObjectFactory();
  assert.throws(() => createOrganizerObject('no-such-organizer'), /알 수 없는 조직자/);
  const frayer = createOrganizerObject('frayer');
  assert.equal(frayer.caption, '개념:', 'frayer 는 개념 caption 포함');
  assert.ok(validateObjectShape(frayer).ok, 'caption 있어도 스키마 유효');
  // 삽입 조직자는 전부 빈 구조 — answer:true 없음(정답 누출 원천 차단, #4 fail-closed 와 독립).
  for (const desc of ORGANIZER_INSERTS) {
    assert.notEqual(createOrganizerObject(desc.key).answer, true, `${desc.key}: 삽입 시 정답 플래그 없음`);
  }
});
