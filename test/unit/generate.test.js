import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GenerateWorksheet, parseGrade, parseGradeSubject, resolveSubject } from '../../src/usecases/GenerateWorksheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 커리큘럼 목: search 로 성취기준 반환(원문 조회 시뮬레이션), resolve 는 null → standardsText 폴백 검증.
function mockCurriculum(standards) {
  return {
    async search() { return standards; },
    async resolve() { return null; },
  };
}

test('parseGradeSubject: "중2과학" → {grade:중2, subject:과학}', () => {
  assert.deepEqual(parseGradeSubject('중2과학'), { grade: '중2', subject: '과학' });
  assert.deepEqual(parseGradeSubject('고1통합과학'), { grade: '고1', subject: '통합과학' });
});

test('parseGrade: 학교급 추론', () => {
  assert.equal(parseGrade('중2').school, '중학교');
  assert.equal(parseGrade('고1').school, '고등학교');
  assert.equal(parseGrade('초5').school, '초등학교');
});

test('resolveSubject: 미지원 교과는 오류', () => {
  assert.throws(() => resolveSubject('음악'), /지원하지 않는 교과/);
  assert.equal(resolveSubject('과학').template, 'science');
  assert.equal(resolveSubject('국어').template, 'korean');
});

test('G3: generate 과학 → 3쪽, 헤더에 성취기준 원문 주입, data-subject/제목/MODE_TOKEN', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [
    { code: '[9과12-01]', text: '광합성 과정을 이해하고 관계를 탐구한다.', subject: '과학' },
    { code: '[9과12-02]', text: '호흡과 광합성의 관계를 이해한다.', subject: '과학' },
  ];
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum(standards) });
  const { html, worksheet } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });

  assert.equal(worksheet.pageCount(), 3);
  assert.match(html, /광합성 과정을 이해하고 관계를 탐구한다/, '헤더에 성취기준 원문');
  assert.match(html, /\[9과12-01\]/);
  assert.match(html, /data-subject="science"/);
  assert.match(html, /<h1>광합성<\/h1>/);
  assert.match(html, /data-mode="MODE_TOKEN"/);
  assert.match(html, /katex/, '과학은 KaTeX 로더');
});

test('범교과: generate 국어 → green 테마(data-subject=ko), 과학 특수 CSS 아님', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [{ code: '[9국06-01]', text: '대중매체와 개인 방송의 특성을 비교한다.', subject: '국어' }];
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum(standards) });
  const { html, worksheet } = await gen.execute({ grade: '중3', subject: '국어', topic: '매체' });

  assert.equal(worksheet.pageCount(), 2);
  assert.match(html, /<body[^>]*data-subject="ko"/);
  assert.match(html, /--c:\s*#7cb342/, '국어 green 테마 토큰');
  assert.match(html, /class="[^"]*\bpc\b/, '국어 pro-con 컴포넌트');
});

test('성취기준 미발견 시 창작하지 않고 오류', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum([]) });
  await assert.rejects(
    () => gen.execute({ grade: '중2', subject: '과학', topic: '존재하지않는주제xyz' }),
    /찾지 못했습니다/,
  );
});
