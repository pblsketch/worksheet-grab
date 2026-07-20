import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

// Phase 2 — 블록 타입 어휘(vocabulary.json) + 계약 검증.
// 위치기반 81조각 → 타입기반 어휘로 리팩터링. 코어는 ≥2교과·var(--*)만, 팩은 해당 교과 전용.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BLOCKS = resolve(ROOT, 'blocks');
const repo = () => new FsBlockRepository({ root: ROOT });
const mockCurriculum = { async resolve(code) { return { code, text: `원문(${code})`, subject: 'test' }; } };

test('vocabulary 로더: readVocabulary 가 레지스트리를 읽는다(≥20 타입)', async () => {
  const v = await repo().readVocabulary();
  assert.ok(v && v.types, 'vocabulary.types 존재');
  assert.ok(v.counts.total >= 20, `≥20 타입 어휘여야 함(실제 ${v.counts?.total})`);
  assert.equal(v.counts.total, Object.keys(v.types).length, 'counts.total 이 실제 타입 수와 일치');
});

test('vocabulary 계약: 비-gen 타입의 exemplar 파일이 실제 존재하고 type 과 파일명·cssClass 가 일치', async () => {
  const r = repo();
  const v = await r.readVocabulary();
  for (const [type, def] of Object.entries(v.types)) {
    if (def.gen) { assert.equal(def.file, null, `${type}: gen 은 파일 없음`); continue; }
    assert.ok(def.file, `${type}: file 경로 필요`);
    assert.ok(def.file.endsWith(`/${type}.html`), `${type}: 파일명이 타입과 일치(${def.file})`);
    const html = await r.loadBlockHtml(def.file);
    assert.ok(html.trim().length > 0, `${type}: exemplar 가 비어있지 않음`);
    if (def.cssClass) {
      assert.match(html, new RegExp(`class="[^"]*\\b${def.cssClass}\\b`), `${type}: cssClass .${def.cssClass} 가 exemplar 에 등장`);
    }
  }
});

test('vocabulary 분류: 코어는 subjects=["*"]·core/ 아래, 팩은 단일 교과·pack-*/ 아래', async () => {
  const v = await repo().readVocabulary();
  let core = 0, pack = 0;
  for (const [type, def] of Object.entries(v.types)) {
    if (def.category === 'core') {
      core++;
      assert.deepEqual(def.subjects, ['*'], `${type}: 코어는 모든 교과(*)`);
      if (def.file) assert.match(def.file, /^core\//, `${type}: 코어 exemplar 는 core/ 아래`);
    } else {
      pack++;
      assert.equal(def.category, 'pack', `${type}: category 는 core|pack`);
      assert.ok(def.subjects.length === 1 && def.subjects[0] !== '*', `${type}: 팩은 단일 교과 전용`);
      assert.match(def.file, /^pack-/, `${type}: 팩 exemplar 는 pack-*/ 아래`);
    }
  }
  assert.equal(core, v.counts.core, 'core 카운트 일치');
  assert.equal(pack, v.counts.pack, 'pack 카운트 일치');
});

test('범교과 게이트: 코어 exemplar 는 하드코딩 교과색 0 (var(--*)만 참조)', async () => {
  const themes = await repo().listThemes();
  const knownHexes = new Set(themes.flatMap((t) => [...t.paletteHexes()].map((h) => h.toLowerCase())));
  assert.ok(knownHexes.size > 0, '교과 팔레트 hex 를 테마에서 로드');
  const dir = join(BLOCKS, 'core');
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.html')) continue;
    const html = (await readFile(join(dir, f), 'utf8')).toLowerCase();
    for (const hex of html.match(/#[0-9a-f]{6}\b/g) || []) {
      assert.ok(!knownHexes.has(hex), `core/${f}: 교과 팔레트색 ${hex} 하드코딩 금지(themes/*.css 의 var(--*) 사용)`);
    }
  }
});

test('범교과 재사용: 코어 exemplar(header)가 ≥2 교과 테마에서 렌더된다', async () => {
  const v = await repo().readVocabulary();
  const header = v.types['header'];
  assert.ok(header && header.file, 'header exemplar 존재');
  const rendered = [];
  for (const theme of ['sci', 'ko']) {
    const manifest = { subject: 'x', theme, docTitle: 't', standards: [], pages: [[{ type: 'header', file: header.file }]] };
    const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
    const { html, worksheet } = await asm.execute(manifest);
    assert.equal(worksheet.pageCount(), 1, `${theme}: 1쪽`);
    assert.match(html, /class="title-wrap"/, `${theme}: header 블록 렌더`);
    assert.match(html, /--c\s*:/, `${theme}: 교과 테마 토큰(--c) 주입`);
    rendered.push(theme);
  }
  assert.ok(rendered.length >= 2, '≥2 교과에서 렌더');
});
