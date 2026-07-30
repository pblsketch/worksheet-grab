import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { ComposeWorksheet } from '../../src/usecases/ComposeWorksheet.js';
import { vennSvg, conceptMapSvg } from '../../src/usecases/OrganizerGen.js';

// 시각 조직자(graphic organizers) — Track A 표형(P1 배치1).
// 계약(vocabulary)·assemble 렌더·인쇄안전(keep)·범교과(하드코딩색 0)를 검증한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = () => new FsBlockRepository({ root: ROOT });
const mockCurriculum = { async resolve(code) { return { code, text: `원문(${code})`, subject: 'test' }; } };

// 추가한 조직자 — Track A 표형(배치1·2) + Track B 그림형(SVG).
const ORGANIZERS = [
  'kwl', 'frayer', 'w5h1', 'bme', 'exit321', 'mainidea',
  'notetaking', 'hamburger', 'perspectives', 'prediction', 'glowgrow', 'stoplight',
  'venn', 'conceptmap', 'fishbone', 'plotdiagram', 'hierarchy', 'flowchart', 'hexagon',
  'essayplan', 'character', 'bookreview', 'quotejournal',
];
// Track B — 그림형(SVG) 조직자(색은 CSS, HTML 엔 hex 0).
const DIAGRAM_ORGANIZERS = ['venn', 'conceptmap', 'fishbone', 'plotdiagram', 'hierarchy', 'flowchart', 'hexagon'];

test('시각 조직자: 전 종이 vocabulary 에 코어(*)·printSafe·studentFill·core/<type>.html 로 등록', async () => {
  const v = await repo().readVocabulary();
  for (const t of ORGANIZERS) {
    const def = v.types[t];
    assert.ok(def, `${t}: vocabulary 에 등록됨`);
    assert.equal(def.category, 'core', `${t}: 코어(범교과)`);
    assert.deepEqual(def.subjects, ['*'], `${t}: subjects=["*"]`);
    assert.equal(def.printSafe, true, `${t}: printSafe=true`);
    assert.equal(def.studentFill, true, `${t}: studentFill=true(빈 구조·정답 오염 방지)`);
    assert.equal(typeof def.keepTogether, 'boolean', `${t}: keepTogether 플래그(불리언 — 표형=true, 스택=false)`);
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

test('시각 조직자(그림형): 각 SVG 조직자가 <svg> 방출 + HTML hex 0(색은 CSS) + assemble keep', async () => {
  const r = repo();
  const v = await r.readVocabulary();
  for (const t of DIAGRAM_ORGANIZERS) {
    const def = v.types[t];
    const raw = await r.loadBlockHtml(def.file);
    assert.match(raw, /<svg/, `${t}: SVG 뼈대 포함`);
    // 색은 blocks.css 로 뺐다 — HTML 엔 hex 색 리터럴이 없어야 범교과 게이트(6자리 hex)를 통과.
    assert.equal(raw.match(/#[0-9a-fA-F]{3,6}\b/g), null, `${t}: HTML 에 hex 색 없음(색은 CSS)`);
    const manifest = { subject: 'x', theme: 'sci', docTitle: 't', standards: [], pages: [[{ type: t, file: def.file }]] };
    const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
    const { html } = await asm.execute(manifest);
    assert.match(html, /<svg/, `${t}: assemble 산출에 SVG`);
    assert.match(html, new RegExp(`class="[^"]*\\b${def.cssClass}\\b`), `${t}: cssClass .${def.cssClass}`);
    assert.match(html, /class="[^"]*\bkeep\b/, `${t}: keep(인쇄안전)`);
  }
});

test('시각 조직자 surfacing: compose --archetype concept-visual 가 그림형 조직자를 주제로 채운다', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { manifest, archetype } = await compose.execute({
    grade: '중2', subject: '과학', topic: '광합성', archetype: 'concept-visual', codes: ['[9과12-01]'],
  });
  assert.equal(archetype, 'concept-visual');
  const types = new Set(manifest.pages.flat().map((e) => e.type));
  for (const t of ['venn', 'conceptmap', 'fishbone']) {
    assert.ok(types.has(t), `스캐폴드에 그림형 조직자 ${t} 포함`);
  }
  const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { html } = await asm.execute(manifest);
  assert.match(html, /class="[^"]*\bvenn\b/, '벤다이어그램 렌더');
  assert.match(html, /<svg/, 'SVG 방출');
});

test('시각 조직자 surfacing: compose --archetype process-structure 가 흐름도·위계트리를 주제로 채운다', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { manifest, archetype } = await compose.execute({
    grade: '중2', subject: '과학', topic: '소화 과정', archetype: 'process-structure', codes: ['[9과12-01]'],
  });
  assert.equal(archetype, 'process-structure');
  const types = new Set(manifest.pages.flat().map((e) => e.type));
  for (const t of ['flowchart', 'hierarchy']) {
    assert.ok(types.has(t), `스캐폴드에 ${t} 포함`);
  }
  const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { html } = await asm.execute(manifest);
  assert.match(html, /class="[^"]*\bflowchart\b/, '흐름도 렌더');
  assert.match(html, /<svg/, 'SVG 방출');
});

test('시각 조직자 surfacing: compose --archetype literary-response 가 북리뷰·인물·인용·에세이를 주제로 채운다', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { manifest, archetype } = await compose.execute({
    grade: '중2', subject: '국어', topic: '소나기', archetype: 'literary-response', codes: ['[9국05-01]'],
  });
  assert.equal(archetype, 'literary-response');
  const types = new Set(manifest.pages.flat().map((e) => e.type));
  for (const t of ['bookreview', 'character', 'quotejournal', 'essayplan']) {
    assert.ok(types.has(t), `스캐폴드에 ${t} 포함`);
  }
  const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculumC });
  const { html, worksheet } = await asm.execute(manifest);
  assert.equal(worksheet.pageCount(), manifest.pages.length, '스캐폴드 쪽수대로 조립');
  assert.match(html, /class="[^"]*\bessayplan\b/, '에세이 설계 렌더');
  // 에세이 설계는 섹션 스택 — 각 섹션에 keep(섹션 사이 넘김 허용).
  assert.match(html, /class="ep-sec keep"/, '에세이 섹션별 keep');
});

// ── 파라메트릭 생성(개수 지정) ─────────────────────────────────────────────
const countCircles = (h) => (h.match(/<circle/g) || []).length;
const countNodes = (h) => (h.match(/class="cm-node"/g) || []).length;
const countLines = (h) => (h.match(/<line/g) || []).length;

test('파라메트릭: 벤다이어그램 2원/3원 생성 — 원 개수·keep·svg·hex 0', () => {
  const two = vennSvg({ circles: 2 });
  const three = vennSvg({ circles: 3 });
  assert.equal(countCircles(two), 2, '2원');
  assert.equal(countCircles(three), 3, '3원');
  for (const h of [two, three]) {
    assert.match(h, /class="venn keep"/, 'cssClass+keep');
    assert.match(h, /<svg/, 'svg');
    assert.equal(h.match(/#[0-9a-fA-F]{3,6}\b/g), null, 'HTML hex 0(색은 CSS)');
  }
  assert.equal(countCircles(vennSvg()), 2, '기본 2원');
});

test('파라메트릭: 개념 지도 N칸 생성 — 노드=N, 연결선=N (3~6), 범위 밖은 클램프', () => {
  for (const n of [3, 4, 5, 6]) {
    const h = conceptMapSvg({ nodes: n });
    assert.equal(countNodes(h), n, `${n}칸 노드`);
    assert.equal(countLines(h), n, `${n}개 연결선`);
    assert.match(h, /class="conceptmap keep"/, 'cssClass+keep');
    assert.equal(h.match(/#[0-9a-fA-F]{3,6}\b/g), null, 'HTML hex 0');
  }
  assert.equal(countNodes(conceptMapSvg({ nodes: 9 })), 6, '6 초과는 6으로 클램프');
  assert.equal(countNodes(conceptMapSvg({ nodes: 1 })), 3, '3 미만은 3으로 클램프');
  assert.equal(countNodes(conceptMapSvg()), 4, '기본 4칸');
});

test('파라메트릭: AssembleWorksheet 가 entry.params 로 변형을 생성(정적 블록 대체)', async () => {
  const manifest = {
    subject: 'x', theme: 'sci', docTitle: 't', standards: [],
    pages: [[
      { type: 'venn', params: { circles: 3 } },
      { type: 'conceptmap', params: { nodes: 5 } },
    ]],
  };
  const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
  const { html } = await asm.execute(manifest);
  assert.equal(countCircles(html), 3, 'params 로 3원 벤 생성');
  assert.equal(countNodes(html), 5, 'params 로 5칸 개념지도 생성');
  assert.match(html, /class="[^"]*\bkeep\b/, '인쇄안전 keep');
});
