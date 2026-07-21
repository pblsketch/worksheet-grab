import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { resyncManifest } from '../../src/editor/resync.js';

// E3 M4: 역동기화 순수 코어 — 배열→pages 재구성(DOM 무접촉).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const MANIFEST = {
  id: 'x', subject: 'science', theme: 'sci', docTitle: '원본 제목', standards: [],
  pages: [
    [{ type: 'header', html: '<h1>제목</h1>' }, { type: 'question', html: '<div class="q">문항1</div>' }],
    [{ type: 'question', html: '<div class="q">문항2</div>' }],
  ],
};

/** 편집 없는 순회 시뮬레이션: manifest 블록을 그대로 배열화. */
function sheetsFrom(manifest) {
  return manifest.pages.map((page) => ({ blocks: page.map((b) => ({ type: b.type, html: b.html })) }));
}

test('무편집 왕복: pages 등가 + 나머지 필드 보존', () => {
  const { manifest: out, structureWarning } = resyncManifest(sheetsFrom(MANIFEST), MANIFEST);
  assert.deepEqual(out.pages, MANIFEST.pages);
  assert.equal(out.docTitle, '원본 제목');
  assert.equal(structureWarning, false);
});

test('수정·삭제·재정렬이 배열 순서 그대로 반영', () => {
  const sheets = [
    { blocks: [{ type: 'question', html: '<div class="q">문항1(수정)</div>' }] }, // header 삭제
    { blocks: [
      { type: 'content', html: '<p>새 블록</p>' },
      { type: 'question', html: '<div class="q">문항2</div>' },
    ] },
  ];
  const { manifest: out } = resyncManifest(sheets, MANIFEST);
  assert.deepEqual(out.pages, [
    [{ type: 'question', html: '<div class="q">문항1(수정)</div>' }],
    [{ type: 'content', html: '<p>새 블록</p>' }, { type: 'question', html: '<div class="q">문항2</div>' }],
  ]);
});

test('래퍼 소실 폴백: leftover 를 페이지 말미 content 로 흡수 + structureWarning', () => {
  const sheets = [
    { blocks: [{ type: 'header', html: '<h1>제목</h1>' }], leftoverHtml: '<p>래퍼 밖으로 밀려난 텍스트</p>' },
    { blocks: [{ type: 'question', html: '<div class="q">문항2</div>' }] },
  ];
  const { manifest: out, structureWarning } = resyncManifest(sheets, MANIFEST);
  assert.equal(structureWarning, true, '구조 손실 가시화(조용한 손실 금지)');
  assert.deepEqual(out.pages[0][1], { type: 'content', html: '<p>래퍼 밖으로 밀려난 텍스트</p>' });
});

test('재조립 왕복: resync 산출 manifest 를 assemble 이 그대로 소화(gen 동결 포함)', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const original = await repo.readManifest('sci');
  const { html: editHtml } = await asm.execute(original, { editMode: true });

  // 시트별 래퍼 타입 시퀀스가 manifest 페이지 구조와 1:1 인지 확인
  // (innerHTML 추출은 브라우저 DOM 실경로 소관 — 여기선 구조 대응만 검증).
  const sheetTypes = editHtml.split('<section class="sheet">').slice(1)
    .map((chunk) => [...chunk.matchAll(/data-bt="([^"]+)"/g)].map((m) => m[1]));
  assert.equal(sheetTypes.length, original.pages.length, '시트 수 = 페이지 수');
  sheetTypes.forEach((types, p) => {
    assert.deepEqual(types, original.pages[p].map((b) => b.type), `p${p + 1} 타입 시퀀스 보존`);
  });

  // resync 산출을 assemble 에 재투입(간단 동결 시뮬레이션: 원본 html 재사용)
  const resynced = resyncManifest(
    original.pages.map((page) => ({ blocks: page.map((b) => ({ type: b.type, html: b.html ?? '' })) })),
    original,
  ).manifest;
  // gen 블록({gen:'standard-label'})은 html:'' 로 동결 시뮬 — 실경로에선 렌더 결과 문자열.
  for (const page of resynced.pages) {
    for (const b of page) if (!b.html) b.html = '<div class="std-box">동결</div>';
  }
  const { html: rebuilt } = await asm.execute(resynced);
  assert.ok(rebuilt.includes('전압과 전류의 관계 탐구'), '재조립 성공');
});
