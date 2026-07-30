import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { ComposeWorksheet } from '../../src/usecases/ComposeWorksheet.js';

// 시각 조직자(graphic organizers) — Track A 표형(P1 배치1).
// 계약(vocabulary)·assemble 렌더·인쇄안전(keep)·범교과(하드코딩색 0)를 검증한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = () => new FsBlockRepository({ root: ROOT });
const mockCurriculum = { async resolve(code) { return { code, text: `원문(${code})`, subject: 'test' }; } };

// 추가한 표형 조직자(배치1 + 배치2).
const ORGANIZERS = [
  'kwl', 'frayer', 'w5h1', 'bme', 'exit321', 'mainidea',
  'notetaking', 'hamburger', 'perspectives', 'prediction', 'glowgrow', 'stoplight',
];

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

// 성취기준 포트 목(compose 는 resolve+search 를 쓴다).
const mockCurriculumC = {
  async resolve(code) { return { code, text: `원문(${code})`, subject: '과학', school: '중학교' }; },
  async search({ keyword }) { return [{ code: '[9과00-00]', text: `원문(${keyword})`, subject: '과학', school: '중학교' }]; },
};

test('시각 조직자 surfacing: compose --archetype vocabulary-concept 가 조직자 포함 스캐폴드를 주제로 채운다', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { manifest, archetype, brief } = await compose.execute({
    grade: '중2', subject: '과학', topic: '광합성', archetype: 'vocabulary-concept', codes: ['[9과12-01]'],
  });
  assert.equal(archetype, 'vocabulary-concept');
  assert.equal(manifest.docTitle, '광합성', '주제로 제목 채움');
  const types = new Set(manifest.pages.flat().map((e) => e.type));
  for (const t of ['frayer', 'w5h1', 'mainidea', 'exit321']) {
    assert.ok(types.has(t), `스캐폴드에 조직자 ${t} 포함`);
  }
  // 저작 브리프: 조직자는 "학생이 채움(저작 불필요)" 로 안내 — AI 가 빈 조직자를 채워 학생용을 오염시키지 않도록.
  const briefNotes = brief.pages.flat().filter((b) => b.type === 'frayer').map((b) => b.authoring);
  assert.ok(briefNotes.length >= 1 && /학생이 채운다/.test(briefNotes[0]), '조직자 저작 브리프=학생 채움');
});

test('시각 조직자 surfacing: compose 스캐폴드가 렌더 가능한 A4 로 조립되고 조직자+keep 방출', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { manifest } = await compose.execute({
    grade: '중2', subject: '과학', topic: '광합성', archetype: 'kwl-inquiry', codes: ['[9과12-01]'],
  });
  const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { html, worksheet } = await asm.execute(manifest);
  assert.equal(worksheet.pageCount(), manifest.pages.length, '스캐폴드 쪽수대로 조립');
  assert.match(html, /class="[^"]*\bkwl\b/, 'KWL 조직자 렌더');
  assert.match(html, /class="[^"]*\bkeep\b/, '인쇄안전 keep 방출');
  assert.match(html, /data-mode="MODE_TOKEN"/, '2벌 분기 전 토큰 유지');
});
