import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

// US-20(S4.5) 재작성 — 개체 편집 실물 검증(선택→편집→구조 조작). 개체 모델(S4.1~S4.3)로
// 아키텍처가 전면 재구축되면서 구 테스트의 다음 항목은 신 UI 에 대응 개념이 없다(기능 공백,
// us20.md 기록 — 테스트 삭제로 가리지 않고 아래에 명시):
//  - 표 셀/도형(svg)/테두리 상자 "안"으로 더 들어가는 중첩 선택(Esc 사다리로 안↔밖 이동).
//    신 모델의 선택은 최상위 data-oid 개체(닫힌 카탈로그 10종) 단위 뿐이다.
//  - 표 "데이터 최소 1행 보존" 정책(구버전 전용 비즈니스 규칙) — 새 모델은 "표 전체 최소 1행"
//    까지만 보장한다(아래 표 테스트가 실측 현재 동작을 그대로 단정).
//  - vartable(첫 열 머리) 자동 배경 — TYPE_SPECS.table.headerCol 필드는 있으나 RenderObjectTree
//    가 아직 이를 소비하지 않는다(스타일 미반영).
//  - 픽셀 단위 눈금 개수·드래그 중 중앙 스냅 안내선 — 신 UI 는 여백선/눈금자/격자 CSS 클래스
//    on/off 만 제공한다(정밀 눈금·스냅 계산 없음).
//  - "AI 초안 텍스트 → 자유 이동 상자 변환(promote-on-demand)" 전용 액션 — 대신 어떤 개체든
//    flow⇄float 을 오갈 수 있는 범용 토글(objectFactory.toggleFlowFloat)로 대체됐다.
// 자유 배치 텍스트는 전용 textbox 타입이 아니라 richtext(placement:'float')로 표현된다(D-A).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-obj-chrome-');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${chromeTmp.dir}`, '--virtual-time-budget=20000', '--window-size=1440,960', '--dump-dom', url,
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
    docTitle: '개체 편집 테스트',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '제목' },
        {
          id: 'tbl1', type: 'table', placement: 'flow', splittable: false,
          rows: [
            [{ text: 'a', header: true }, { text: 'b', header: true }],
            [{ text: '1' }, { text: '2' }],
          ],
        },
        { id: 'r3', type: 'richtext', placement: 'flow', html: '<p>flow⇄float 토글 대상</p>' },
      ],
      float: [
        { id: 'f1', type: 'answer-area', placement: 'float', style: 'box', label: '메모', rect: { xMm: 100, yMm: 150, wMm: 50, hMm: 25 } },
      ],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-obj-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('표 구조 편집: 헤더 중복 없음·열 추가 시 열 수 균일·행 삭제는 최소 1행에서 멈춘다',
  { skip: !HAS_CHROME, timeout: 60000 }, async () => {
    const { server, url, ws } = await startEditServer();
    try {
      const dom = await dumpDom(`${url}/?seed=table-ops`);
      assert.equal(ds(dom, 'seed-done'), 'table-ops');
      assert.equal(ds(dom, 'rows-initial'), '2');
      assert.equal(ds(dom, 'header-rows-initial'), '1');

      assert.equal(ds(dom, 'rows-after-add'), '3', '행 추가');
      assert.equal(ds(dom, 'header-rows-after-add'), '1', '새 행은 헤더가 아니다(헤더 중복 없음)');

      assert.equal(ds(dom, 'cols-after-add'), '3', '열 추가');
      assert.equal(ds(dom, 'cols-uniform'), 'true', '모든 행의 열 수가 균일');

      assert.equal(ds(dom, 'rows-after-first-del'), '2');
      assert.equal(ds(dom, 'rows-after-second-del'), '1', '헤더 행만 남을 때까지 삭제 가능(새 모델의 실제 동작)');
      assert.equal(ds(dom, 'rows-floor'), '1', '1행에서는 더 이상 줄지 않는다(최소 1행 하한)');

      assert.equal(ds(dom, 'table-save-ok'), 'true');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });

test('자유 배치 텍스트(richtext float): 삽입·편집·드래그·flow⇄float 토글·저장 왕복',
  { skip: !HAS_CHROME, timeout: 60000 }, async () => {
    const { server, url, ws } = await startEditServer();
    try {
      const dom = await dumpDom(`${url}/?seed=float-richtext`);
      assert.equal(ds(dom, 'seed-done'), 'float-richtext');
      assert.equal(ds(dom, 'new-obj-type'), 'richtext');
      assert.equal(ds(dom, 'new-obj-placement'), 'float', '자유 배치 텍스트 = richtext(placement:float)');
      assert.equal(ds(dom, 'insp-kind'), 'richtext', '인스펙터가 richtext 섹션으로 반응');
      assert.equal(ds(dom, 'edited-text'), 'true', '더블클릭 편집이 개체 html 필드에 반영');
      assert.equal(ds(dom, 'movable'), 'true', 'float 공통 드래그로 이동 가능');

      assert.equal(ds(dom, 'r3-placement-before'), 'flow');
      assert.equal(ds(dom, 'r3-placement-after'), 'float', '범용 flow⇄float 토글(구 "AI 텍스트→상자 변환"을 대체)');

      assert.equal(ds(dom, 'float-save-ok'), 'true');
      assert.equal(ds(dom, 'saved-exists'), 'true');

      const manifest = JSON.parse(await readFile(join(ws.dir, '문서', 'worksheet.manifest.json'), 'utf8'));
      const floatIds = manifest.pages[0].float.map((o) => o.id);
      assert.ok(floatIds.includes('r3'), 'r3 가 float 버킷으로 이동해 저장');
      const newRichtext = manifest.pages[0].float.find((o) => o.type === 'richtext' && o.id !== 'r3');
      assert.ok(newRichtext?.html.includes('자유 배치 텍스트'), '새로 삽입한 자유 배치 텍스트도 저장 왕복');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });

test('여백선·눈금자·격자 보기 토글 + 여백선을 꺼도 float 선택 손잡이는 남는다',
  { skip: !HAS_CHROME, timeout: 60000 }, async () => {
    const { server, url, ws } = await startEditServer();
    try {
      const dom = await dumpDom(`${url}/?seed=view-toggle`);
      assert.equal(ds(dom, 'seed-done'), 'view-toggle');
      assert.equal(ds(dom, 'margins-on-initial'), 'true');
      assert.equal(ds(dom, 'ruler-on-initial'), 'true');
      assert.equal(ds(dom, 'grid-on-initial'), 'false');

      assert.equal(ds(dom, 'grid-on-after'), 'true', '격자 체크 → wg-show-grid 클래스 적용');
      assert.equal(ds(dom, 'margins-on-after'), 'false', '여백선 체크 해제 → wg-show-margins 제거');
      assert.equal(ds(dom, 'ruler-still-on'), 'true', '건드리지 않은 눈금자는 그대로');

      assert.equal(ds(dom, 'float-handle-present'), 'true', '여백선을 꺼도 float 선택 손잡이(⠿)는 남는다(회귀 방어)');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });

test('시각 조직자 삽입(#2 P1a): "시각 조직자" 그리드 버튼 → 미리 채운 table 개체 삽입·렌더·저장 왕복',
  { skip: !HAS_CHROME, timeout: 60000 }, async () => {
    const { server, url, ws } = await startEditServer();
    try {
      const dom = await dumpDom(`${url}/?seed=organizer-insert`);
      assert.equal(ds(dom, 'seed-done'), 'organizer-insert');
      assert.ok(Number(ds(dom, 'organizer-btn-count')) >= 16, `시각 조직자 버튼 ≥16(표형10+그림형6) 렌더(실제 ${ds(dom, 'organizer-btn-count')})`);
      assert.equal(ds(dom, 'ins-type'), 'table', '삽입 개체는 table(새 타입 아님 — 스키마 무변경)');
      assert.equal(ds(dom, 'ins-placement'), 'flow', 'flow 전용 삽입(좌표 없음)');
      assert.equal(ds(dom, 'ins-concept-colspan'), '2', '개념=병합 셀(colspan2·중앙) — caption 아님');
      assert.equal(ds(dom, 'ins-rows'), '5', '개념 병합행 + 정의/특징·예/비예 = 5행');
      assert.equal(ds(dom, 'ins-has-answer'), 'false', '빈 조직자 — 정답 플래그 없음(누출 원천 차단)');
      assert.equal(ds(dom, 'ins-renders-table'), 'true', '삽입 즉시 표로 렌더');
      assert.equal(ds(dom, 'ins-has-headers'), 'true', '프레이어 헤더(정의·예가 아닌 것) 렌더');
      assert.equal(ds(dom, 'ins-has-colgroup'), 'true', '등폭/의도폭 열(colgroup) 방출');
      assert.equal(ds(dom, 'ins-has-cell-height'), 'true', '필기 높이(h→mm) 방출');
      // 그림형(P2) — 벤다이어그램 잠금 삽입(richtext 인라인 SVG)
      assert.equal(ds(dom, 'gins-type'), 'richtext', '그림형은 richtext 잠금 삽입(새 타입 아님)');
      assert.equal(ds(dom, 'gins-renders-svg'), 'true', '벤다이어그램 SVG 렌더');
      assert.equal(ds(dom, 'organizer-save-ok'), 'true', '표형+그림형 저장 왕복 안전(SVG 보존·정답 누출 0)');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });
