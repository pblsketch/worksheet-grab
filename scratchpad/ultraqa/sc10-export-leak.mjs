// 시나리오 10 — export 종단 + PDF 레벨 정답 누출 grep(불변식 1·3).
// checkpoint(정답 마커 문서)→ExportDocument(실 Chrome print-to-pdf)→student/teacher HTML·PDF 검사
// + scaffold 직접 export 거부(fail-closed).
// 실행: node scratchpad/ultraqa/sc10-export-leak.mjs
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { ExportDocument } from '../../src/usecases/ExportDocument.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { assertLog, ROOT } from './harness.mjs';

const A = assertLog();
const MARK = {
  ascii: 'LEAKPDF7X9',           // PDF 텍스트 추출 안정용 ASCII 마커
  korean: '누출정답한글마커',       // 한글 마커(ToUnicode 추출 확인)
  answerKey: 'AKEY7Y2PDF',
  span: 'SPANLEAK7Z3',
};

function leakDoc() {
  return {
    pagination: 'paginated', docTitle: 'PDF 누출 공격', lang: 'ko', standards: [], paper: null,
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '내보내기 누출 검사' },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '질문 본문(공통 노출)', qnum: 1, answerKey: { text: MARK.answerKey } },
        { id: 'ra', type: 'richtext', placement: 'flow', html: `<p>${MARK.ascii} ${MARK.korean}</p>`, answer: true },
        { id: 'rb', type: 'richtext', placement: 'flow', html: `<p>학생 공통 본문</p><span class="answer">${MARK.span}</span>` },
      ],
      float: [],
    }],
  };
}

const base = mkdtempSync(join(tmpdir(), 'wsg-uqa-exp-'));
const workspace = new FsWorkspaceRepository({ baseDir: base });
const blockRepository = new FsBlockRepository({ root: ROOT });
const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });

try {
  // ── 1) paginated 문서 export — 2벌 산출 ──
  await saver.checkpoint({ name: '누출검사', document: leakDoc(), now: new Date('2026-07-23T02:00:00.000Z') });
  const exporter = new ExportDocument({ workspace, renderer: new ChromeRenderer({ chromePath: null }), fileExists: existsSync, removeFile: rm });
  const result = await exporter.execute({ name: '누출검사' });
  A.check(result.unsafe === false, `export unsafe=false (실측 ${result.unsafe})`);
  A.check((result.rendered || []).length === 2, `student/teacher 2벌 렌더 (실측 ${(result.rendered || []).length})`);

  const docDir = join(base, '누출검사');
  const studentHtml = readFileSync(join(docDir, 'worksheet-student.html'), 'utf8');
  const teacherHtml = readFileSync(join(docDir, 'worksheet-teacher.html'), 'utf8');
  for (const [k, m] of Object.entries(MARK)) {
    A.check(teacherHtml.includes(m), `teacher.html 에 ${k} 마커 존재(대조군)`);
    A.check(!studentHtml.includes(m), `student.html 에 ${k} 마커 부재`);
  }
  A.check(studentHtml.includes('학생 공통 본문') && studentHtml.includes('질문 본문'), 'student.html 비정답 콘텐츠 보존');

  // ── 2) PDF 레벨 grep — pypdf(한글 ToUnicode 추출 가능; pdftotext 는 이 Chrome PDF 의 한글을
  //       공백으로 떨궈 증거로 불충분함을 프로브로 실측) ──
  const pdfText = (p) => execFileSync('python3', ['-c', `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
sys.stdout.write(json.dumps(''.join(pg.extract_text() for pg in r.pages), ensure_ascii=True))
`, p], { encoding: 'utf8' });
  const pdfTextParsed = (p) => JSON.parse(pdfText(p));
  const sPdf = join(docDir, 'worksheet-student.pdf');
  const tPdf = join(docDir, 'worksheet-teacher.pdf');
  A.check(existsSync(sPdf) && existsSync(tPdf), 'PDF 2벌 파일 존재');
  const sText = pdfTextParsed(sPdf);
  const tText = pdfTextParsed(tPdf);
  A.check(tText.includes(MARK.ascii), 'teacher.pdf 텍스트에 ascii 마커 존재(추출 유효성 대조군)');
  A.check(tText.includes(MARK.korean), 'teacher.pdf 텍스트에 한글 마커 존재(ToUnicode 대조군)');
  for (const [k, m] of Object.entries(MARK)) {
    A.check(!sText.includes(m), `student.pdf 텍스트에 ${k} 마커 부재`);
  }
  A.check(sText.includes('학생 공통 본문'), 'student.pdf 비정답 콘텐츠 보존');

  // ── 3) scaffold 직접 export 거부(fail-closed, 불변식 3) ──
  const scaffold = { ...leakDoc(), pagination: 'scaffold' };
  await saver.checkpoint({ name: '스캐폴드', document: scaffold, now: new Date('2026-07-23T02:10:00.000Z') });
  let rejected = false, msg = '';
  try {
    await exporter.execute({ name: '스캐폴드' });
  } catch (e) { rejected = true; msg = e.message; }
  A.check(rejected, `scaffold 직접 export 거부 (${msg.slice(0, 80)})`);
  // 거부 시 산출물 미생성(fail-closed)
  A.check(!existsSync(join(base, '스캐폴드', 'worksheet-student.pdf')), 'scaffold 거부 시 student.pdf 미생성');
} finally {
  try { rmSync(base, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
}
process.exitCode = A.summary('sc10-export-leak') ? 0 : 1;
