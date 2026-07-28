import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { paperToPx, resolvePaper } from '../../src/usecases/paper.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

// T3(§2e) 실물 검증(실 Chrome): GET /preview.png?page=N 의 단일-페이지 슬라이스 렌더 +
// 오버플로 감지(X-Preview-Overflow 헤더). 3쪽 문서(sci 픽스처, manifests/sci.json)로
// 페이지 고유성·IHDR==2×paperToPx 실측, unsafe student 409·범위 밖/비정수 4xx·오버플로
// 헤더 유무를 검증한다. page 미지정(기존 동작)은 export.render.test.js 의
// "E6 정밀 미리보기 실측"과 test/unit/editor-server.test.js 가 이미 무수정 게이트한다 —
// 이 파일은 그 회귀 여부를 재확인하지 않는다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

// sci 3쪽 각각의 고유 표지 문구(section[0]/[1]/[2] 식별용) — manifests/sci.json 참조.
const PAGE1_MARK = '탐구 문제와 가설을 세워 보자';
const PAGE2_MARK = '전압을 바꾸며 전류를 측정하고';
const PAGE3_MARK = '결과를 해석하며 저항·전류·전압의 관계를 정리해 보자';

async function makeDoc(docName, { paper = null, leaky = false } = {}) {
  const base = await autoTmpDir('wsg-previewpage-');
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

/** PNG IHDR 폭/높이(바이트 16..24, BE). 의존성 0(export.render.test.js 와 동일 헬퍼). */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

for (const [label, paper] of [
  ['A4 기본', null],
  ['A3 가로', { size: 'A3', orientation: 'landscape' }],
  ['B4 세로', { size: 'B4', orientation: 'portrait' }],
  ['A4 2단', { size: 'A4', orientation: 'portrait', columns: 2 }],
]) {
  test(`T3 page=2 단일-페이지 슬라이스: ${label} — 2쪽 고유 콘텐츠 + IHDR==2×paperToPx`,
    { skip: !HAS_CHROME, timeout: 120000 }, async () => {
      const docName = `page2문서-${label}`;
      const fx = await makeDoc(docName, { paper });
      const { server, url } = await startServer(fx, docName);
      try {
        const res = await fetch(`${url}/preview.png?mode=teacher&page=2`);
        assert.equal(res.status, 200);
        const { width, height } = pngSize(Buffer.from(await res.arrayBuffer()));
        const px = paperToPx(resolvePaper(paper) ?? resolvePaper({ size: 'A4' }));
        assert.equal(width, 2 * px.width, `${label} IHDR 폭 실측 ${width} == 2×${px.width}`);
        assert.equal(height, 2 * px.height, `${label} IHDR 높이 실측 ${height} == 2×${px.height}`);

        const metaDir = fx.workspace.layout(docName).metaDir;
        const tmpHtml = await readFile(join(metaDir, '.preview-page-teacher.html'), 'utf8');
        assert.ok(tmpHtml.includes(PAGE2_MARK), '임시 HTML 에 2쪽(section[1]) 콘텐츠 포함');
        assert.ok(!tmpHtml.includes(PAGE1_MARK), '1쪽(section[0]) 콘텐츠 미포함');
        assert.ok(!tmpHtml.includes(PAGE3_MARK), '3쪽(section[2]) 콘텐츠 미포함');
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
}

test('T3 unsafe 문서 student page=1 → 409(기존 가드 재사용)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const fx = await makeDoc('페이지누출문서', { leaky: true });
  assert.equal(fx.saved.unsafe, true, '픽스처 전제: 누출 저장');
  const { server, url } = await startServer(fx, '페이지누출문서');
  try {
    const res = await fetch(`${url}/preview.png?mode=student&page=1`);
    assert.equal(res.status, 409);
    assert.match((await res.json()).message, /학생용 PDF 를 차단/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('T3 범위 밖·비정수 page → 4xx(정수 파싱 실패는 renderBusy 진입 전 즉시 400)',
  { skip: !HAS_CHROME, timeout: 120000 }, async () => {
    const fx = await makeDoc('범위밖문서');
    const { server, url } = await startServer(fx, '범위밖문서');
    try {
      for (const bad of ['99', '0', 'abc', '-1', '1.5']) {
        const res = await fetch(`${url}/preview.png?mode=teacher&page=${bad}`);
        assert.ok(res.status >= 400 && res.status < 500, `page=${bad} → 4xx(실제 ${res.status})`);
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

test('T3 오버플로 감지: 1섹션 과다 콘텐츠 → X-Preview-Overflow 헤더', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const base = await autoTmpDir('wsg-previewpage-overflow-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  // 1페이지에 과다 콘텐츠를 채워 1물리쪽을 확실히 넘치게 만든다(오버플로 픽스처).
  // .sheet 는 min-height 라 콘텐츠가 넘치면 page-break-after 전에 물리 쪽이 늘어난다(paper.css:17-25).
  const overflowBlocks = Array.from({ length: 60 }, (_, i) => ({
    type: 'content',
    html: `<p>오버플로 확인용 더미 문단 ${i} — 인쇄 흐름을 강제로 한 쪽 넘게 채우기 위한 반복 텍스트입니다.</p>`,
  }));
  manifest.pages = [[...manifest.pages[0], ...overflowBlocks]];
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.execute({ name: '오버플로문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '오버플로문서', workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  const url = `http://127.0.0.1:${addr.port}`;
  try {
    const res = await fetch(`${url}/preview.png?mode=teacher&page=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-preview-overflow'), '1', '넘친 페이지는 X-Preview-Overflow 헤더 존재');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('T3 정상 페이지(넘치지 않음) → X-Preview-Overflow 헤더 부재', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const fx = await makeDoc('정상오버플로문서');
  const { server, url } = await startServer(fx, '정상오버플로문서');
  try {
    const res = await fetch(`${url}/preview.png?mode=teacher&page=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-preview-overflow'), null, '넘치지 않은 페이지는 헤더 부재');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
