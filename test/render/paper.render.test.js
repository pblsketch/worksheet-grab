import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { RenderImage } from '../../src/usecases/RenderImage.js';
import { resolvePaper, paperToPx } from '../../src/usecases/paper.js';
import { countPdfPages, pdfPageSizePt, chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E0 수용 #3·#4: 선택 용지가 실물 Chrome 렌더의 PDF MediaBox / PNG IHDR 치수로
// 정확히 실현되는지 실측한다. 인쇄가 진실의 원천 — 정적 CSS 검사로 대체하지 않는다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const TOL = 3; // pt 허용오차

async function renderStudent(manifestName) {
  const repo = new FsBlockRepository({ root: ROOT });
  const manifest = await repo.readManifest(manifestName);
  return renderManifest(manifest, manifestName);
}

async function renderManifest(manifest, name) {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const { html } = await asm.execute(manifest);
  const { student } = new BuildVariants().execute(html);
  const dir = await autoTmpDir('wsg-paper-');
  const inPath = join(dir, `${name}-student.html`);
  const outPath = join(dir, `${name}-student.pdf`);
  await writeFile(inPath, student, 'utf8');
  await new RenderPdf({ renderer: new ChromeRenderer({}) })
    .execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
  return { size: await pdfPageSizePt(outPath), pages: await countPdfPages(outPath), inPath, dir };
}

function assertSize(size, w, h, label) {
  assert.ok(Math.abs(size.w - w) <= TOL && Math.abs(size.h - h) <= TOL,
    `${label}: MediaBox ${size.w.toFixed(1)}×${size.h.toFixed(1)}pt (기대 ${w}×${h}pt ±${TOL})`);
}

test('E0 수용 #3: A4 기본(sci, paper 미지정) = 595×842pt (회귀 방어)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { size } = await renderStudent('sci');
  assertSize(size, 595, 842, 'A4 기본');
});

test('E0 수용 #3: A3 가로 = 1191×841pt (W>H, landscape swap 실현)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { size } = await renderStudent('_e0-a3-landscape');
  assertSize(size, 1191, 841, 'A3 가로');
  assert.ok(size.w > size.h, '가로형(W>H)');
});

test('E0 수용 #3: B4(JIS) 세로 = 729×1032pt (ISO 709×1001 아님)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { size } = await renderStudent('_e0-b4-portrait');
  assertSize(size, 729, 1032, 'B4(JIS) 세로');
});

test('E0 하위호환: sci 에 paper:{size:A4} 부여 = 595×842pt + 페이지수 불변(등가 렌더)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const manifest = await repo.readManifest('sci');
  const plain = await renderManifest(manifest, 'sci-plain');
  const withA4 = structuredClone(manifest);
  withA4.paper = { size: 'A4' };
  const papered = await renderManifest(withA4, 'sci-a4paper');
  assertSize(papered.size, 595, 842, 'A4+paper');
  assert.equal(papered.pages, plain.pages, `페이지수 불변(${plain.pages}쪽) — A4 기본 단일화의 실측 증명`);
});

test('E0 수용 #4: A3 가로 PNG 치수 = paperToPx (IHDR 실측, scale=1)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { inPath, dir } = await renderStudent('_e0-a3-landscape');
  const px = paperToPx(resolvePaper({ size: 'A3', orientation: 'landscape' }));
  const pngPath = join(dir, 'a3.png');
  await new RenderImage({ renderer: new ChromeRenderer({}) })
    .execute({ inputPath: inPath, outputPath: pngPath, virtualTimeBudget: 15000, width: px.width, height: px.height, scale: 1 });
  const buf = await readFile(pngPath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assert.equal(w, px.width, `IHDR 폭 ${w} === paperToPx ${px.width}`);
  assert.equal(h, px.height, `IHDR 높이 ${h} === paperToPx ${px.height}`);
});
