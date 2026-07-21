import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum, DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { RunPipeline } from '../../src/usecases/RunPipeline.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { run } from '../../src/cli/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);

// M3 수용: 교사의 한 문장(학년교과+주제) → 검수 게이트 통과 후 활동지 산출.
test('M3 수용: pipeline 한 문장 → 검수 PASS → student/teacher A4 PDF (MCP off/CSV)', { skip: !READY, timeout: 120000 }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const curriculum = new GepaiCurriculum({}); // MCP off, CSV 경로
  const r = await new RunPipeline({ blockRepository: repo, curriculum })
    .execute({ grade: '중2', subject: '과학', topic: '광합성' });

  assert.equal(r.gate, true, '검수 게이트 PASS 여야 렌더 진행(fail-closed)');
  assert.ok(r.standards.some((s) => s.code === '[9과12-01]'), '성취기준 조회');

  const dir = await mkdtemp(join(tmpdir(), 'wsg-pipe-'));
  const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
  for (const [mode, doc] of [['student', r.student], ['teacher', r.teacher]]) {
    const inPath = join(dir, `p-${mode}.html`);
    const outPath = join(dir, `p-${mode}.pdf`);
    await writeFile(inPath, doc, 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    assert.equal(await countPdfPages(outPath), 3, `${mode} A4 PDF 3쪽`);
  }
});

// 회귀(QA): CLI 기본 렌더 경로 — base 가 if(!useDoc) 블록 스코프에 갇혀
// ReferenceError 로 전멸하던 버그. usecase 직접 호출이 아닌 run() 종단으로 계측한다.
test('M3 회귀: CLI pipeline 기본 렌더 경로가 student/teacher PDF 를 산출(exit 0)', { skip: !READY, timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-pipe-cli-'));
  const lines = [];
  const code = await run(['pipeline', '중2과학', '광합성', '--out', dir], {
    root: ROOT, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)),
  });
  assert.equal(code, 0, `exit 0 이어야 한다:\n${lines.join('\n')}`);
  for (const mode of ['student', 'teacher']) {
    const pdf = join(dir, `science-광합성-${mode}.pdf`);
    assert.ok(existsSync(pdf), `${mode} PDF 산출: ${pdf}`);
    assert.equal(await countPdfPages(pdf), 3, `${mode} A4 PDF 3쪽`);
  }
});
