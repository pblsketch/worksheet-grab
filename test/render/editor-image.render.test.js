import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { makeTmpDir, makeTmpDirSync } from '../helpers/tmp.js';

// US-20(S4.5) 재작성 — F1 이미지 UX(개체 모델). 구 테스트는 contenteditable 시대의
// "img 를 span.answer 로 감싸 부분 마킹"을 검증했으나, 신 스키마의 image-slot 타입은
// ANSWERABLE_TYPES 밖이라(부분요소 마킹 개념 자체가 없다 — 개체 전체 단위 answer:true 만 존재)
// 그 정확한 형태로는 재현할 수 없다(기능 공백, us20.md 기록). 같은 검증 의도("정답으로 표시된
// 이미지는 학생용에서 사라진다")는 이미지가 포함된 richtext 개체를 정답 마킹하는 개체 단위
// 동형으로 재구성했다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const ANS_MARK = 'RT_ANS_고유텍스트_시드샷';

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-img-chrome-');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${chromeTmp.dir}`,
    '--virtual-time-budget=20000', '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); chromeTmp.cleanup(); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      chromeTmp.cleanup();
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-800)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'F1 이미지 UX 테스트',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '이미지 테스트' },
        { id: 'img1', type: 'image-slot', placement: 'flow' },
        { id: 'rt-ans', type: 'richtext', placement: 'flow', html: `<p>${ANS_MARK} <img src="assets/기존.png" alt="정답 그림"></p>` },
      ],
      float: [],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-img-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('F1: 이미지 업로드→개체 반영→GET 200, + 정답 마킹된 이미지 포함 개체는 저장 시 학생용 물리 제거',
  { skip: !HAS_CHROME, timeout: 120000 }, async () => {
    const { server, url, ws } = await startEditServer();
    try {
      const dom = await dumpDom(`${url}/?seed=image-workflow`);
      assert.equal(ds(dom, 'seed-done'), 'image-workflow');
      assert.match(ds(dom, 'asset-path'), /^assets\/.+\.png$/, '업로드 경로 반환(assets/<name>.png)');
      assert.equal(ds(dom, 'asset-get'), '200', 'GET /assets/<path> 200(자산 서빙)');

      // US-P3-5 이미지 캡션 부분 편집 — 캡션 신설은 인스펙터, 수정은 캔버스 더블클릭.
      assert.equal(ds(dom, 'img-cap-absent'), 'true', '업로드 직후에는 캡션이 없다');
      assert.equal(ds(dom, 'img-no-caption-no-edit'), 'true', '캡션이 없으면 더블클릭해도 유령 편집 상태가 되지 않고 선택만 남는다');
      assert.equal(ds(dom, 'img-caption-field-exists'), 'true', '이미지 인스펙터에 캡션 입력란이 있다');
      assert.equal(ds(dom, 'img-caption-rendered'), 'true', '캡션을 달면 figcaption 으로 렌더된다');
      assert.equal(ds(dom, 'img-caption-edit-enter'), 'true', '캡션이 있으면 캔버스 더블클릭으로 캡션 편집에 진입한다');
      assert.equal(ds(dom, 'img-caption-edited'), 'true', '캔버스에서 고친 캡션이 개체 필드에 반영된다');

      assert.equal(ds(dom, 'ans-marked'), 'true', '이미지 포함 개체 정답 마킹');
      assert.equal(ds(dom, 'saved-ok'), 'true');

      const assetName = ds(dom, 'asset-path').slice('assets/'.length);
      assert.ok(existsSync(join(ws.dir, '문서', 'assets', assetName)), 'assetsDir 에 파일 원자 기록');

      const teacher = await readFile(join(ws.dir, '문서', 'worksheet-teacher.html'), 'utf8');
      const student = await readFile(join(ws.dir, '문서', 'worksheet-student.html'), 'utf8');
      assert.ok(teacher.includes(assetName), 'teacher 에 업로드 이미지(비마킹) 존재');
      assert.ok(student.includes(assetName), '비마킹 이미지는 student 파생에도 존재');
      assert.ok(teacher.includes(ANS_MARK), 'teacher 는 정답 마킹된 이미지 포함 개체를 보존');
      assert.ok(!student.includes(ANS_MARK), 'student 는 정답 마킹 개체를 통째로 물리 제거(누출 방지)');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });
