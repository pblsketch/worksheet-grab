// PDF 한글 추출 프로브 — teacher.pdf 의 실제 추출 텍스트 확인.
import { mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { ExportDocument } from '../../src/usecases/ExportDocument.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { ROOT } from './harness.mjs';

const base = mkdtempSync(join(tmpdir(), 'wsg-uqa-pdftx-'));
const workspace = new FsWorkspaceRepository({ baseDir: base });
const saver = new SaveDocument({ workspace, blockRepository: new FsBlockRepository({ root: ROOT }), curriculum: null });
try {
  await saver.checkpoint({ name: '프로브', document: {
    pagination: 'paginated', docTitle: '프로브', lang: 'ko', standards: [], paper: null,
    pages: [{ flow: [
      { id: 't1', type: 'title', placement: 'flow', text: '한글제목 그리고 LEAKPDF7X9' },
      { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>누출정답한글마커 학생 공통 본문</p>' },
    ], float: [] }],
  }, now: new Date('2026-07-23T03:00:00.000Z') });
  const exporter = new ExportDocument({ workspace, renderer: new ChromeRenderer({ chromePath: null }), fileExists: existsSync, removeFile: rm });
  await exporter.execute({ name: '프로브' });
  const pdf = join(base, '프로브', 'worksheet-teacher.pdf');
  const out = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  console.log('--- pdftotext output (json-escaped) ---');
  console.log(JSON.stringify(out.slice(0, 800)));
  copyFileSync(pdf, join(ROOT, 'scratchpad', 'ultraqa', 'evidence', 'probe-teacher.pdf'));
} finally {
  try { rmSync(base, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
}
