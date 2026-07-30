import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

// 시각 조직자(graphic organizers) — Track A 표형(P1 배치1).
// 계약(vocabulary)·assemble 렌더·인쇄안전(keep)·범교과(하드코딩색 0)를 검증한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = () => new FsBlockRepository({ root: ROOT });
const mockCurriculum = { async resolve(code) { return { code, text: `원문(${code})`, subject: 'test' }; } };

// 이번 배치에서 추가한 표형 조직자.
const ORGANIZERS = ['kwl', 'frayer', 'w5h1', 'bme', 'exit321', 'mainidea'];

test('시각 조직자: 6종이 vocabulary 에 코어(*)·keepTogether·core/<type>.html 로 등록', async () => {
  const v = await repo().readVocabulary();
  for (const t of ORGANIZERS) {
    const def = v.types[t];
    assert.ok(def, `${t}: vocabulary 에 등록됨`);
    assert.equal(def.category, 'core', `${t}: 코어(범교과)`);
    assert.deepEqual(def.subjects, ['*'], `${t}: subjects=["*"]`);
    assert.equal(def.keepTogether, true, `${t}: keepTogether=true(인쇄안전 의도)`);
    assert.equal(def.printSafe, true, `${t}: printSafe=true`);
    assert.equal(def.file, `core/${t}.html`, `${t}: 파일 경로 일치`);
  }
});

test('시각 조직자: 각 조직자가 assemble 로 1쪽 렌더 + cssClass + keep(인쇄안전) 방출', async () => {
  const v = await repo().readVocabulary();
  for (const t of ORGANIZERS) {
    const def = v.types[t];
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: 't', standards: [],
      pages: [[{ type: t, file: def.file }]],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
    const { html, worksheet } = await asm.execute(manifest);
    assert.equal(worksheet.pageCount(), 1, `${t}: 1쪽`);
    assert.match(html, new RegExp(`class="[^"]*\\b${def.cssClass}\\b`), `${t}: cssClass .${def.cssClass} 방출`);
    assert.match(html, /class="[^"]*\bkeep\b/, `${t}: keep(page-break-inside:avoid) 방출 — 페이지 경계 잘림 방지`);
  }
});

test('시각 조직자: 코어 exemplar HTML 에 하드코딩 hex 색 없음(테마 토큰만 — 범교과)', async () => {
  const r = repo();
  const v = await r.readVocabulary();
  for (const t of ORGANIZERS) {
    const html = await r.loadBlockHtml(v.types[t].file);
    assert.equal(html.match(/#[0-9a-fA-F]{3,6}\b/g), null, `${t}: HTML 에 hex 색 리터럴 없음`);
  }
});

test('시각 조직자: 두 교과 테마(sci·ko)에서 동일 구조로 렌더(범교과 재사용)', async () => {
  const v = await repo().readVocabulary();
  for (const t of ORGANIZERS) {
    const def = v.types[t];
    for (const theme of ['sci', 'ko']) {
      const manifest = { subject: 'x', theme, docTitle: 't', standards: [], pages: [[{ type: t, file: def.file }]] };
      const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
      const { html } = await asm.execute(manifest);
      assert.match(html, new RegExp(`class="[^"]*\\b${def.cssClass}\\b`), `${t}@${theme}: 렌더`);
      assert.match(html, /--c\s*:/, `${t}@${theme}: 교과 테마 토큰 주입`);
    }
  }
});
