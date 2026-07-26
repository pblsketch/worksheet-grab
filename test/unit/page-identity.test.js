import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizePageIdentity } from '../../src/domain/schema/PageIdentity.js';
import { rebuildPaginatedPages } from '../../src/usecases/PaginateObjectTree.js';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = { paperCss: '', blocksCss: '', themeCss: '' };

function sequenceGenerator(...ids) {
  let index = 0;
  return () => ids[index++];
}

async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

test('페이지 정체성 정규화: 기존 ID·role 보존, 누락·중복 ID 교체, 입력 불변', () => {
  const source = {
    pagination: 'paginated',
    pages: [
      { id: 'page-keep', role: 'cover', flow: [], float: [] },
      { flow: [], float: [] },
      { id: 'page-keep', role: 'activity', flow: [], float: [] },
    ],
  };
  const before = structuredClone(source);
  const normalized = normalizePageIdentity(source, {
    idGenerator: sequenceGenerator('page-new-1', 'page-new-2'),
  });

  assert.deepEqual(normalized.pages.map((page) => page.id), ['page-keep', 'page-new-1', 'page-new-2']);
  assert.deepEqual(normalized.pages.map((page) => page.role), ['cover', undefined, 'activity']);
  assert.deepEqual(source, before, '입력 문서를 변형하지 않아야 함');
  assert.equal(normalizePageIdentity(normalized), normalized, '이미 정상인 문서는 동일 참조');
});

test('페이지 정체성 정규화: 생성 ID가 뒤쪽 기존 ID와 충돌해도 기존 ID를 바꾸지 않음', () => {
  const source = {
    pagination: 'paginated',
    pages: [
      { flow: [], float: [] },
      { id: 'page-existing', flow: [], float: [] },
    ],
  };
  const normalized = normalizePageIdentity(source, {
    idGenerator: sequenceGenerator('page-existing', 'page-repair'),
  });
  assert.deepEqual(normalized.pages.map((page) => page.id), ['page-repair', 'page-existing']);
});

test('리플로우 페이지 재구성: 기존 페이지 ID·role은 인덱스별 보존하고 새 페이지만 새 ID', () => {
  const srcPages = [
    {
      id: 'page-cover',
      role: 'cover',
      flow: [{ id: 'a', type: 'title', placement: 'flow', text: 'A' }],
      float: [],
    },
    {
      id: 'page-activity',
      role: 'activity',
      flow: [{ id: 'b', type: 'title', placement: 'flow', text: 'B' }],
      float: [],
    },
  ];
  const pages = rebuildPaginatedPages(
    srcPages,
    { a: 0, b: 2 },
    3,
    { idGenerator: sequenceGenerator('page-overflow') },
  );

  assert.deepEqual(pages.map((page) => page.id), ['page-cover', 'page-activity', 'page-overflow']);
  assert.deepEqual(pages.map((page) => page.role), ['cover', 'activity', undefined]);
  assert.deepEqual(pages[0].flow.map((object) => object.id), ['a']);
  assert.deepEqual(pages[2].flow.map((object) => object.id), ['b']);
});

test('페이지 추가·복제·이동: 기존 ID 유지, 신규 ID 고유, 이동 후 ID와 role 보존', async () => {
  const { addPage, duplicatePage, movePage, reorderPages, setPageRole } = await loadObjectFactory();
  const source = {
    pagination: 'paginated',
    pages: [{
      id: 'page-source',
      role: 'activity',
      flow: [{ id: 'title-1', type: 'title', placement: 'flow', text: '제목' }],
      float: [],
    }],
  };

  const added = addPage(source, { afterIndex: 0 });
  assert.equal(added.pages[0].id, 'page-source');
  assert.match(added.pages[1].id, /^page-/);
  assert.notEqual(added.pages[1].id, 'page-source');

  const duplicated = duplicatePage(source, 0);
  assert.equal(duplicated.pages[0].id, 'page-source');
  assert.notEqual(duplicated.pages[1].id, 'page-source');
  assert.equal(duplicated.pages[1].role, 'activity');
  assert.equal(duplicated.pages[1].flow[0].text, '제목');
  assert.notEqual(duplicated.pages[1].flow[0].id, 'title-1');

  const moved = movePage(duplicated, 1, 0);
  assert.deepEqual(moved.pages.map((page) => page.id), [duplicated.pages[1].id, 'page-source']);
  assert.deepEqual(moved.pages.map((page) => page.role), ['activity', 'activity']);
  assert.equal(movePage(moved, 0, -1), moved, '범위 밖 이동은 원본 참조를 유지');

  const reordered = reorderPages(moved, ['page-source', moved.pages[0].id]);
  assert.deepEqual(reordered.pages.map((page) => page.id), ['page-source', moved.pages[0].id]);
  assert.equal(reorderPages(reordered, ['page-source', moved.pages[0].id]), reordered, '동일 순서는 no-op');
  assert.equal(reorderPages(reordered, ['page-source']), reordered, 'ID 집합이 다르면 no-op');

  const roleChanged = setPageRole(reordered, 'page-source', 'reading');
  assert.equal(roleChanged.pages[0].role, 'reading');
  const roleCleared = setPageRole(roleChanged, 'page-source', null);
  assert.equal(roleCleared.pages[0].role, undefined);
  assert.equal(setPageRole(roleCleared, 'page-source', null), roleCleared, '동일 role은 no-op');
});

test('빈 문서에 첫 flow/float 개체를 삽입하면 페이지 ID가 함께 생성됨', async () => {
  const { insertFlow, insertFloat } = await loadObjectFactory();
  const empty = { pagination: 'paginated', pages: [] };
  const flow = insertFlow(empty, { id: 'title-1', type: 'title', placement: 'flow', text: '제목' });
  assert.match(flow.pages[0].id, /^page-/);
  assert.equal(flow.pages[0].flow[0].id, 'title-1');

  const floated = insertFloat(empty, {
    id: 'shape-1',
    type: 'shape',
    placement: 'float',
    shapeKind: 'rect',
    rect: { xMm: 10, yMm: 10, wMm: 20, hMm: 20 },
  });
  assert.match(floated.pages[0].id, /^page-/);
  assert.equal(floated.pages[0].float[0].id, 'shape-1');
});

test('페이지 셸 렌더: page ID를 data-page-id로 이스케이프해 노출', () => {
  const document = {
    pagination: 'paginated',
    pages: [{
      id: 'page-"safe"',
      flow: [{ id: 'title-1', type: 'title', placement: 'flow', text: '제목' }],
      float: [],
    }],
  };
  const { html } = new RenderObjectTree().execute(document, ASSETS);
  assert.match(html, /<section class="sheet" data-page-id="page-&quot;safe&quot;">/);
  const variants = new BuildVariants().executeObjectTree(document, ASSETS);
  assert.match(variants.teacher, /data-page-id="page-&quot;safe&quot;"/);
  assert.match(variants.student, /data-page-id="page-&quot;safe&quot;"/);
  assert.doesNotMatch(variants.teacher, /data-oid="page-/);
});

test('페이지 ID 검증: 유효 ID는 통과하고 중복·공백 ID와 공백 role은 거부', () => {
  const valid = {
    pagination: 'paginated',
    pages: [
      { id: 'page-a', role: 'cover', flow: [], float: [] },
      { id: 'page-b', flow: [], float: [] },
    ],
  };
  assert.equal(new ValidateObjectTree().execute(valid).ok, true);

  const missing = structuredClone(valid);
  delete missing.pages[1].id;
  assert.ok(new ValidateObjectTree().execute(missing).findings
    .some((finding) => finding.rule === 'invalid-page-id'));

  const invalid = structuredClone(valid);
  invalid.pages[1] = { id: 'page-a', role: ' ', flow: [], float: [] };
  const duplicate = new ValidateObjectTree().execute(invalid);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.findings.some((finding) => finding.rule === 'duplicate-page-id'));
  assert.ok(duplicate.findings.some((finding) => finding.rule === 'invalid-page-role'));

  invalid.pages[1].id = ' ';
  const blank = new ValidateObjectTree().execute(invalid);
  assert.ok(blank.findings.some((finding) => finding.rule === 'invalid-page-id'));
});
