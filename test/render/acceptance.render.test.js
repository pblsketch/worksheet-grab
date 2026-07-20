import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

// 실물 Chrome 렌더로 페이지 수 검증(수용기준 2·5). Chrome 없으면 스킵.
async function renderStudentPages(manifestName) {
  const repo = new FsBlockRepository({ root: ROOT });
  const curriculum = new GepaiCurriculum({});
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
  const manifest = await repo.readManifest(manifestName);
  const { html } = await asm.execute(manifest);

  const { student } = new BuildVariants().execute(html);
  const dir = await mkdtemp(join(tmpdir(), 'wsg-test-'));
  const inPath = join(dir, `${manifestName}-student.html`);
  const outPath = join(dir, `${manifestName}-student.pdf`);
  await writeFile(inPath, student, 'utf8');

  const renderer = new ChromeRenderer({});
  await new RenderPdf({ renderer }).execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
  return { pages: await countPdfPages(outPath), student };
}

test('수용기준 2·5: 재조립 국어 학생용 = 5쪽', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { pages } = await renderStudentPages('ko');
  assert.equal(pages, 5, `국어 학생용 PDF 는 5쪽이어야 함(실측 ${pages})`);
});

test('수용기준 2·5: 재조립 과학 학생용 = 3쪽', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { pages } = await renderStudentPages('sci');
  assert.equal(pages, 3, `과학 학생용 PDF 는 3쪽이어야 함(실측 ${pages})`);
});

test('학생용 렌더 입력에 정답 텍스트가 없다(누출 2차 방어 grep)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { student } = await renderStudentPages('sci');
  // 과학 교사용 정답 문구가 학생용에서 제거되어야 함
  assert.ok(!student.includes('전압이 커질수록 전류의 세기도'), '학생용에 가설 정답 잔존 금지');
  assert.ok(!student.includes('V / I 의 값이 3.0'), '학생용에 해석 정답 잔존 금지');
});
