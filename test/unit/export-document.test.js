import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import {
  ExportDocument,
  UNSAFE_STUDENT_MESSAGE,
  MISSING_STUDENT_MESSAGE,
} from '../../src/usecases/ExportDocument.js';
import { PAPER_PRESETS, matchPreset, resolvePaper } from '../../src/usecases/paper.js';
import { workspaceLayout } from '../../src/usecases/workspace.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E6 ExportDocument — meta.unsafe fail-closed 승격(student 차단·teacher 보존) 5케이스
// + 워크스페이스 PDF 슬롯·프리셋 역판정. Renderer 는 목(Chrome 0).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

function baseManifest(blocks) {
  return {
    id: 'e6-fixture', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
    docTitle: 'E6 픽스처', head: { katex: false }, runHead: 'E6', runFoot: { left: 'E6', rightPrefix: '' },
    standards: [], standardsText: {},
    pages: [blocks],
  };
}
const CLEAN = baseManifest([
  { type: 'question', html: '<div class="q">광합성이란 무엇인가?</div>' },
  { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
]);
const LEAKY = baseManifest([
  { type: 'question', html: '<div class="q">광합성이란 무엇인가?</div>' },
  { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
  { type: 'content', html: `<p>참고: ${ANSWER}</p>` },
]);

function mockRenderer() {
  const calls = [];
  return {
    calls,
    async renderToPdf(inputPath, outputPath) {
      calls.push({ inputPath, outputPath });
    },
  };
}

async function fixture() {
  const base = await autoTmpDir('wsg-export-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  const renderer = mockRenderer();
  const exporter = new ExportDocument({ workspace, renderer, fileExists: existsSync, removeFile: rm });
  return { workspace, saver, exporter, renderer, base };
}

test('E6 export 정상: teacher 먼저 2벌 렌더·PDF 슬롯 경로·unsafe=false', async () => {
  const { saver, exporter, renderer } = await fixture();
  await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T01:00:00.000Z') });
  const r = await exporter.execute({ name: '문서' });

  assert.equal(r.unsafe, false);
  assert.equal(r.reason, null);
  assert.deepEqual(r.skipped, {});
  assert.deepEqual(r.rendered.map((x) => x.variant), ['teacher', 'student'], 'teacher 먼저');
  assert.equal(renderer.calls.length, 2);
  assert.ok(renderer.calls[0].outputPath.endsWith('worksheet-teacher.pdf'));
  assert.ok(renderer.calls[1].outputPath.endsWith('worksheet-student.pdf'));
});

test('E6 export unsafe: student 차단(fail-closed)·teacher 만 렌더·스테일 student.pdf 물리 제거', async () => {
  const { saver, exporter, renderer } = await fixture();
  // 안전 저장 → 정상 export(student.pdf 생성) → 누출 저장 → 재export.
  const first = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T01:00:00.000Z') });
  await exporter.execute({ name: '문서' });
  const studentPdf = first.paths.studentPdfPath;
  await writeFile(studentPdf, '%PDF-stale'); // 목 renderer 는 파일을 안 만들므로 스테일 재현
  assert.ok(existsSync(studentPdf), '전제: 이전 export 의 student.pdf 존재');

  const saved = await saver.execute({ name: '문서', manifest: LEAKY, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(saved.unsafe, true, '픽스처 전제: 누출 저장');

  const r = await exporter.execute({ name: '문서' });
  assert.equal(r.unsafe, true);
  assert.equal(r.skipped.student, 'unsafe');
  assert.equal(r.reason, UNSAFE_STUDENT_MESSAGE);
  assert.deepEqual(r.rendered.map((x) => x.variant), ['teacher'], 'teacher 는 항상 산출');
  assert.equal(renderer.calls.length, 3, '정상 2 + unsafe teacher 1');
  assert.ok(!existsSync(studentPdf), '스테일 student.pdf 물리 제거(SaveDocument 보류 정책과 대칭)');
});

test('E6 export 문서 부재: 명확한 에러', async () => {
  const { exporter } = await fixture();
  await assert.rejects(() => exporter.execute({ name: '없는문서' }), /문서가 없습니다/);
});

test('E6 export missing 강등: meta 안전 + student.html 부재 → graceful skip·teacher 보존', async () => {
  const { saver, exporter, renderer } = await fixture();
  const saved = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T01:00:00.000Z') });
  await rm(saved.paths.studentPath); // 부분쓰기 불일치 시뮬레이션

  const r = await exporter.execute({ name: '문서' });
  assert.equal(r.unsafe, false);
  assert.equal(r.skipped.student, 'missing');
  assert.equal(r.reason, MISSING_STUDENT_MESSAGE);
  assert.deepEqual(r.rendered.map((x) => x.variant), ['teacher'], 'throw 없이 teacher PDF 보존');
  assert.equal(renderer.calls.length, 1);
});

test('E6 export meta 부재: fail-closed 로 student 차단', async () => {
  const { saver, exporter, renderer } = await fixture();
  const saved = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T01:00:00.000Z') });
  await rm(saved.paths.metaPath); // 커밋 마커 소실 = 미완성/외부 문서

  const r = await exporter.execute({ name: '문서' });
  assert.equal(r.unsafe, true);
  assert.equal(r.skipped.student, 'unsafe');
  assert.deepEqual(r.rendered.map((x) => x.variant), ['teacher']);
  assert.equal(renderer.calls.length, 1);
});

// US-14(S3.5): ExportDocument ↔ checkExportGate 배선. 개체 트리 문서(SaveDocument.checkpoint 저장분)는
// manifest.pagination 필드를 갖는다 — scaffold 는 export 자체를 거부(예외), paginated 는 정상 진행.
// 레거시 HTML manifest(CLEAN/LEAKY, pagination 필드 없음)는 위 테스트들이 이미 무회귀를 증명한다.
function objDoc(pagination, flow) {
  return {
    docTitle: 'US-14 게이트 픽스처', subject: 'science', dataSubject: 'science',
    themeName: '', lang: 'ko', runHead: 'US-14', runFoot: { left: 'US-14', rightPrefix: '' },
    standards: [], paper: null,
    pagination,
    pages: [{ flow, float: [] }],
  };
}
const OBJ_FLOW = [{ id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '광합성이란 무엇인가?' }];

test('US-14: 개체 트리 scaffold 문서는 export 자체를 거부(checkExportGate, 렌더 시도 없음)', async () => {
  const { saver, exporter, renderer } = await fixture();
  await saver.checkpoint({ name: '문서', document: objDoc('scaffold', OBJ_FLOW), now: new Date('2026-07-23T01:00:00.000Z') });

  await assert.rejects(
    () => exporter.execute({ name: '문서' }),
    /scaffold-not-exportable|Chrome 측정 페이지네이션 패스/,
  );
  assert.equal(renderer.calls.length, 0, 'scaffold 거부는 어떤 렌더도 시도하지 않아야 함(fail-closed)');
});

test('US-14: 개체 트리 paginated 문서는 export 정상 진행(2벌 렌더)', async () => {
  const { saver, exporter, renderer } = await fixture();
  await saver.checkpoint({ name: '문서', document: objDoc('paginated', OBJ_FLOW), now: new Date('2026-07-23T01:00:00.000Z') });

  const r = await exporter.execute({ name: '문서' });
  assert.equal(r.unsafe, false);
  assert.deepEqual(r.rendered.map((x) => x.variant), ['teacher', 'student']);
  assert.equal(renderer.calls.length, 2);
});

test('E6 워크스페이스 PDF 슬롯: layout 신규 키(기존 키 무변경)', () => {
  const l = workspaceLayout('/base', '문서');
  assert.ok(l.studentPdfPath.endsWith(join('문서', 'worksheet-student.pdf')));
  assert.ok(l.teacherPdfPath.endsWith(join('문서', 'worksheet-teacher.pdf')));
  assert.ok(l.studentPath.endsWith('worksheet-student.html'), '기존 키 유지');
});

test('E6 용지 프리셋: 5종 매핑·역판정 왕복 항등·custom 판정', () => {
  assert.equal(PAPER_PRESETS.length, 5);
  for (const p of PAPER_PRESETS) {
    assert.equal(matchPreset(p.paper), p.id, `${p.id} 왕복 항등`);
    resolvePaper(p.paper); // 전부 resolvePaper 검증 통과
  }
  assert.equal(matchPreset(null), 'a4-portrait', 'null = 현행 A4 기본');
  assert.equal(matchPreset({ size: 'A3', orientation: 'landscape' }), 'a3-fold');
  assert.equal(matchPreset({ size: 'B4', orientation: 'portrait', columns: 2 }), 'b4-2col', '2단 프리셋 역판정(columns 비교)');
  assert.equal(matchPreset({ size: 'A4', orientation: 'portrait', margins: '20mm' }), 'custom', '여백 변경 = custom');
  assert.equal(matchPreset({ size: 'B4', orientation: 'landscape' }), 'custom');
});
