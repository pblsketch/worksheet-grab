import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { run } from '../../src/cli/index.js';
import { chromeAvailable, countPdfPages, pdfPageSizePt } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E6 실물 검증(실 Chrome): 서버 POST /export·CLI doc export 의 PDF MediaBox 실측 —
// A4 595×842 / A3 가로 1191×841 / B4 729×1032pt(E0 실측 수치와 동일 기준) +
// unsafe fail-closed(student.pdf 부재·teacher 존재) + /preview.png IHDR==2×paperToPx.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

async function makeDoc(docName, { paper = null, leaky = false } = {}) {
  const base = await autoTmpDir('wsg-exportrender-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  if (paper) manifest.paper = paper;
  if (leaky) {
    manifest.pages[0].push({ type: 'content', html: `<div class="answer">${ANSWER}</div>` });
    manifest.pages[0].push({ type: 'content', html: `<p>참고: ${ANSWER}</p>` });
  }
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  const saved = await saver.execute({ name: docName, manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  return { base, workspace, blockRepository, saved };
}

function startServer({ workspace, blockRepository }, docName) {
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null });
  return listenEditorServer(server).then((addr) => ({ server, url: `http://127.0.0.1:${addr.port}` }));
}

/** PNG IHDR 폭/높이(바이트 16..24, BE). 의존성 0. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('E6 서버 export 실측: A4 2벌 MediaBox 595×842pt → unsafe 후 student 차단·CLI 비영 종료', { skip: !HAS_CHROME, timeout: 300000 }, async () => {
  const fx = await makeDoc('내보내기문서');
  const { server, url } = await startServer(fx, '내보내기문서');
  try {
    const ok = await (await fetch(`${url}/export`, { method: 'POST' })).json();
    assert.deepEqual(ok.rendered.map((x) => x.variant), ['teacher', 'student']);
    const { studentPdfPath, teacherPdfPath } = fx.saved.paths;
    assert.ok(existsSync(teacherPdfPath) && existsSync(studentPdfPath), 'PDF 슬롯 2벌 생성');
    for (const p of [teacherPdfPath, studentPdfPath]) {
      const { w, h } = await pdfPageSizePt(p);
      assert.ok(Math.abs(w - 595.3) <= 1 && Math.abs(h - 841.9) <= 1, `A4 MediaBox 실측 ${w}×${h}pt`);
      assert.ok((await countPdfPages(p)) >= 1, '페이지 존재');
    }

    // 누출 저장 → export: student.pdf 물리 부재 + teacher 존재 (fail-closed 실증)
    // US-20(S4.5): EditorHttpServer 의 /save 는 이제 개체 트리(document)만 받는다(구 {manifest:…}
    // 계약은 400 — 아래에서 확인). GET /shell.json 이 레거시 manifest 를 지연 마이그레이션해
    // 개체 트리로 승격 서빙하므로, 그 개체 트리를 받아 누출 개체 2종(정답 마킹 개체 + 같은 텍스트를
    // 담은 평문 개체)을 얹어 POST /save 한다 — 구 테스트와 동일한 "정답 텍스트가 마크 밖으로
    // 새는" 픽스처 의도를 개체 트리로 재현한다.
    const shellNow = await (await fetch(`${url}/shell.json`)).json();
    const mutatedDoc = structuredClone(shellNow.document);
    mutatedDoc.pages[0].flow.push(
      { id: 'leak-answer', type: 'richtext', placement: 'flow', html: `<div>${ANSWER}</div>`, answer: true },
      { id: 'leak-plain', type: 'richtext', placement: 'flow', html: `<p>참고: ${ANSWER}</p>` },
    );
    const savedLeaky = await (await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: mutatedDoc }),
    })).json();
    assert.equal(savedLeaky.unsafe, true, '픽스처 전제: 누출 저장');

    // 구 {manifest:…} 계약은 신 서버에서 400(개체 트리 document 만 허용) — 계약 이관 회귀 방어.
    const legacyBody = await (await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: mutatedDoc }),
    }));
    assert.equal(legacyBody.status, 400, '구 manifest 계약은 더 이상 허용되지 않는다(S4.0 계약 이관)');

    const blocked = await (await fetch(`${url}/export`, { method: 'POST' })).json();
    assert.equal(blocked.skipped.student, 'unsafe');
    assert.match(blocked.reason, /학생용 PDF 를 차단/);
    assert.ok(!existsSync(studentPdfPath), '스테일 student.pdf 물리 제거');
    assert.ok(existsSync(teacherPdfPath), 'teacher.pdf 는 보존·갱신');

    // CLI 동일 코어: unsafe 문서 → 비영 종료(1)·학생용 건너뜀 로그
    const lines = [];
    const code = await run(['doc', 'export', '내보내기문서', '--workspaces-dir', fx.base],
      { root: ROOT, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) });
    assert.equal(code, 1, 'unsafe → 비영 종료');
    assert.ok(lines.some((l) => l.includes('학생용 건너뜀(unsafe)')), '차단 사유 로그');
    assert.ok(!existsSync(studentPdfPath), 'CLI 경로에서도 student.pdf 부재 유지');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E6 용지 실측: POST /paper→A3 가로 1191×841pt · CLI export B4 729×1032pt', { skip: !HAS_CHROME, timeout: 300000 }, async () => {
  // A3: 서버에서 용지 변경(§3.3) 후 export → MediaBox 재실측
  const a3 = await makeDoc('용지변경문서');
  const { server, url } = await startServer(a3, '용지변경문서');
  try {
    const changed = await (await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: { size: 'A3', orientation: 'landscape' } }),
    })).json();
    assert.equal(changed.noop, false);
    await (await fetch(`${url}/export`, { method: 'POST' })).json();
    const { w, h } = await pdfPageSizePt(a3.saved.paths.teacherPdfPath);
    assert.ok(Math.abs(w - 1190.6) <= 1.5 && Math.abs(h - 841.9) <= 1.5, `A3 가로 MediaBox 실측 ${w}×${h}pt`);
  } finally {
    await new Promise((r) => server.close(r));
  }

  // B4(JIS): CLI doc export 동일 코어 실측
  const b4 = await makeDoc('시험지문서', { paper: { size: 'B4', orientation: 'portrait' } });
  const code = await run(['doc', 'export', '시험지문서', '--workspaces-dir', b4.base],
    { root: ROOT, log: () => {}, err: () => {} });
  assert.equal(code, 0);
  for (const p of [b4.saved.paths.teacherPdfPath, b4.saved.paths.studentPdfPath]) {
    const { w, h } = await pdfPageSizePt(p);
    assert.ok(Math.abs(w - 728.5) <= 1.5 && Math.abs(h - 1031.8) <= 1.5, `B4 MediaBox 실측 ${w}×${h}pt`);
  }
});

test('E6 정밀 미리보기 실측: IHDR == 2×paperToPx(scale:2 핀) · unsafe student 409', { skip: !HAS_CHROME, timeout: 300000 }, async () => {
  const fx = await makeDoc('미리보기문서');
  const { server, url } = await startServer(fx, '미리보기문서');
  try {
    const res = await fetch(`${url}/preview.png?mode=teacher&t=1`);
    assert.equal(res.status, 200);
    const { width, height } = pngSize(Buffer.from(await res.arrayBuffer()));
    assert.equal(width, 2 * 794, `A4 IHDR 폭 실측 ${width} == 2×794`);
    assert.equal(height, 2 * 1123, `A4 IHDR 높이 실측 ${height} == 2×1123`);
  } finally {
    await new Promise((r) => server.close(r));
  }

  const leaky = await makeDoc('미리보기누출문서', { leaky: true });
  assert.equal(leaky.saved.unsafe, true, '픽스처 전제');
  const srv2 = await startServer(leaky, '미리보기누출문서');
  try {
    const blocked = await fetch(`${srv2.url}/preview.png?mode=student`);
    assert.equal(blocked.status, 409, 'unsafe student 미리보기 차단');
    assert.match((await blocked.json()).message, /학생용 PDF 를 차단/);
  } finally {
    await new Promise((r) => srv2.server.close(r));
  }
});
