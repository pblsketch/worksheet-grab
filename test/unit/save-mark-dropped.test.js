import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E3 M2: 마크 소멸 감지 — ⭐ unwrap 누출의 최후 그물(긴 저작 정답 한정).
// 주 방어는 에디터의 세션 마크 태깅 + 기존 마크 confirm 이고, 이 감지는 confirm
// 실수에 대한 심층방어 최외곽이다(한계: MIN_ANSWER_LEN 미만 단답·대폭 수정 미탐).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다'; // ≥ SLICE_LEN

function manifestWith(blocks) {
  return {
    id: 'e3-mark', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
    docTitle: 'E3 마크 소멸 픽스처', head: { katex: false }, runHead: '', runFoot: { left: '', rightPrefix: '' },
    standards: [], standardsText: {},
    pages: [blocks],
  };
}

const MARKED = manifestWith([
  { type: 'question', html: '<div class="q">광합성이란 무엇인가?</div>' },
  { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
]);

async function fixture() {
  const base = await autoTmpDir('wsg-markdrop-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.execute({ name: '문서', manifest: MARKED, now: new Date('2026-07-21T01:00:00.000Z') });
  return { saver, workspace };
}

test('케이스 a: 마크 벗기고 통짜 평문 잔존 → answer-mark-dropped error·student 보류', async () => {
  const { saver } = await fixture();
  const dropped = manifestWith([
    { type: 'question', html: '<div class="q">광합성이란 무엇인가?</div>' },
    { type: 'content', html: `<p>${ANSWER}</p>` }, // 마크 제거 + 평문 잔존(unwrap 시나리오)
  ]);
  const r = await saver.execute({ name: '문서', manifest: dropped, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r.unsafe, true);
  assert.ok(r.leakFindings.some((f) => f.rule === 'answer-mark-dropped'), '마크 소멸 감지');
  assert.ok(!existsSync(r.paths.studentPath), 'student 보류(fail-closed 경로 편입)');
});

test('케이스 b: 부분수정 잔존(앞부분 유지) → 부분열 매칭으로 error', async () => {
  const { saver } = await fixture();
  const partial = manifestWith([
    { type: 'content', html: `<p>${ANSWER.slice(0, 25)} — 일부만 남기고 수정함</p>` },
  ]);
  const r = await saver.execute({ name: '문서', manifest: partial, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r.unsafe, true, 'SLICE_LEN 앞부분열 매칭이 부분수정 잔존을 포착');
  assert.ok(r.leakFindings.some((f) => f.rule === 'answer-mark-dropped'));
});

test('케이스 c: 정당한 마크째 삭제(텍스트도 제거) → error 미발생', async () => {
  const { saver } = await fixture();
  const deleted = manifestWith([
    { type: 'question', html: '<div class="q">광합성이란 무엇인가? (정답 블록 삭제됨)</div>' },
  ]);
  const r = await saver.execute({ name: '문서', manifest: deleted, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r.unsafe, false, '정당한 삭제는 오탐 없음');
  assert.ok(existsSync(r.paths.studentPath));
});

test('케이스 d: 태그·공백 섞인 평문 잔존 → 정규화 검색이 포착(raw substring 아님)', async () => {
  const { saver } = await fixture();
  const tagged = manifestWith([
    { type: 'content', html: `<p>참고: <b>광합성은</b>  빛에너지를  화학에너지로 전환하는 생명 활동 과정이다</p>` },
  ]);
  const r = await saver.execute({ name: '문서', manifest: tagged, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r.unsafe, true, 'textOutside 정규화 텍스트 기준 검색');
  assert.ok(r.leakFindings.some((f) => f.rule === 'answer-mark-dropped'));
});

test('한계 문서화: MIN_ANSWER_LEN 미만 단답은 (iii) 미탐 — 주 방어(세션 태깅·confirm) 소관', async () => {
  const base = await autoTmpDir('wsg-markdrop-s-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const saver = new SaveDocument({ workspace, blockRepository: new FsBlockRepository({ root: ROOT }), curriculum: null });
  await saver.execute({ name: '문서', manifest: manifestWith([{ type: 'content', html: '<div class="answer">산소</div>' }]), now: new Date('2026-07-21T01:00:00.000Z') });
  const r = await saver.execute({ name: '문서', manifest: manifestWith([{ type: 'content', html: '<p>산소</p>' }]), now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r.unsafe, false, '짧은 정답 unwrap 은 이 그물이 못 잡는다(설계된 한계)');
});

test('기존 E1 계약 유지: 동일 CLEAN 재저장은 여전히 unsafe=false', async () => {
  const { saver } = await fixture();
  const r = await saver.execute({ name: '문서', manifest: MARKED, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r.unsafe, false, '마크 유지 재저장은 물리 제거로 검색 실패 → 무영향');
  assert.equal(r.meta.revision, 2);
});
