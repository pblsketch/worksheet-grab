import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';

// US-19(S4.4, editor-v4) — AI UX 전면 재작성: preview-then-commit + 인라인 diff + 재생성 버전 +
// 도메인 프리셋. 무API 이므로 "구독 AI"는 이 테스트가 FsAiBridgeRepository 를 직접 폴링·응답하는
// 워처(watchAndRespond)로 모의한다 — 실제로는 별도 프로세스의 CLI(`ai respond --objects`)가 같은
// 파일을 쓸 뿐이라 이 워처는 그 대칭이다. 실 Chrome(--dump-dom, testSeed 게이트) + 직렬 단독 실행.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

// US-19 의 시드는 서버 파일 큐를 실시간으로 폴링하는 "이 테스트 프로세스" 와 동기화해야 한다 —
// `--virtual-time-budget --dump-dom` 는 실 대기(setTimeout)를 가상 시계로 순식간에 흘려보내
// 외부 프로세스(watchAndRespond)가 실제로 응답을 쓰기 전에 폴링 예산을 소진해버린다(실측: 30000ms
// 예산이 실 1초 안에 소진). 그래서 여기서는 CDP 로 Chrome 을 "가상 시간 없이" 그대로 띄우고, 이
// Node 프로세스가 실 시간으로 시드 완료를 폴링한 뒤 최종 DOM 을 문자열로 받아온다(dumpDom 과 동일한
// 반환 형태 — 하류의 ds() 정규식 파서는 그대로 재사용).
function dumpDom(url, { timeoutMs = 90000 } = {}) {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-ai-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--window-size=1200,1600',
  ];
  return (async () => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let ws;
    try {
      const port = await waitForDevToolsPort(userDataDir, 15000);
      const tab = await cdpHttpJson(port, '/json/new', 'PUT');
      ws = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.addEventListener('open', () => res());
        ws.addEventListener('error', (e) => rej(new Error(`CDP ws error: ${e.message}`)));
      });
      const cdp = makeCdpSender(ws);
      await cdp('Page.enable');
      await cdp('Runtime.enable');

      const loaded = new Promise((res) => {
        const onMsg = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.method === 'Page.loadEventFired') { ws.removeEventListener('message', onMsg); res(); }
        };
        ws.addEventListener('message', onMsg);
      });
      await cdp('Page.navigate', { url });
      await loaded;

      const startedAt = Date.now();
      for (;;) {
        const doneRes = await cdp('Runtime.evaluate', {
          expression: `document.body.dataset.seedDone !== undefined || document.body.dataset.seedError !== undefined`,
          returnByValue: true,
        });
        if (doneRes.result?.value) break;
        if (Date.now() - startedAt > timeoutMs) throw new Error(`시드 완료 대기 타임아웃(실 시간 ${timeoutMs}ms): ${url}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      const htmlRes = await cdp('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
      return htmlRes.result.value;
    } finally {
      try { ws?.close(); } catch { /* noop */ }
      await new Promise((res) => {
        if (!child.pid) { res(); return; }
        child.once('exit', res);
        try { child.kill('SIGKILL'); } catch { res(); }
        setTimeout(res, 3000); // 프로세스 종료 이벤트가 지연되는 경우의 안전판
      });
      // Windows 는 프로세스 종료 직후에도 잠시 파일 핸들을 쥐고 있을 수 있다(EPERM) — 넉넉한 재시도.
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  })();
}

function makeCdpSender(ws) {
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else res(msg.result);
    }
  });
  return (method, params = {}) => {
    const id = ++msgId;
    return new Promise((resolvePromise, rejectPromise) => {
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
}

async function cdpHttpJson(port, path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Host: '127.0.0.1' } });
  if (!res.ok) throw new Error(`CDP HTTP ${method} ${path} -> ${res.status}`);
  return res.json();
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const txt = readFileSync(portFile, 'utf8').split('\n');
      const port = parseInt(txt[0], 10);
      if (Number.isFinite(port)) return port;
    } catch { /* 아직 생성 전 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('DevToolsActivePort 파일이 시간 내 생성되지 않았습니다.');
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

/** seed-done 이 비어 있으면 seed-error(runSeed try/catch 이 남긴 진단)를 먼저 출력해 원인을 밝힌다. */
function assertSeedDone(dom, seed) {
  const done = ds(dom, 'seed-done');
  if (done !== seed) {
    const err = ds(dom, 'seed-error');
    if (err) console.error(`[시드 실패 진단] ${seed}: ${err}`);
  }
  assert.equal(done, seed);
}

/** ValidateObjectTree/RenderObjectTree 스키마를 만족하는 개체 트리 문서 — q1(question)·t1(title)·
 *  std1(std-box, AI_EXCLUDED_TYPES 잔류) 를 AI 대상/제외 대상으로 각각 쓴다. pas1(passage-slot) 은
 *  3층 정책(2026-07-23 2차 델타)으로 가드가 해제된 지문 전용 프리셋 노출을 확인하는 데 쓴다. */
function freshDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'AI UX 테스트 문서',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '오늘의 학습 목표' },
        { id: 'std1', type: 'std-box', placement: 'flow', codes: ['9과15-01'] },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압과 전류의 관계를 두 문장으로 설명하시오.' },
        { id: 'pas1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
      ],
      float: [],
    }],
  };
}

async function startEditServer() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-ai-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: freshDocument(), now: new Date('2026-07-23T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, base, bridge: new FsAiBridgeRepository({ baseDir: base }) };
}

/**
 * 모의 구독 AI: 아직 응답하지 않은 pending 요청이 새로 나타날 때마다 즉시 응답을 기록한다(라운드마다
 * 1건). prompt/text 필드의 마지막 단어를 지우고 "재작성N 버전" 두 단어를 붙여 — diff 가 항상
 * 추가(ins)·삭제(del) 양쪽을 다 갖도록 만든다(단순 append 만으로는 삭제 토큰이 생기지 않는다).
 */
function watchAndRespond(bridge, { rounds = 1, timeoutMs = 40000 } = {}) {
  function transform(text, round) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length > 1) words.pop();
    words.push(`재작성${round}`, '버전');
    return words.join(' ');
  }
  return (async () => {
    const seen = new Set();
    let round = 0;
    const startedAt = Date.now();
    while (round < rounds) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`watchAndRespond: ${timeoutMs}ms 내 ${rounds}개 요청 중 ${round}개만 수신`);
      }
      const pending = await bridge.listPending();
      const fresh = pending.find((r) => !seen.has(r.id));
      if (!fresh) { await new Promise((r) => setTimeout(r, 150)); continue; }
      seen.add(fresh.id);
      round += 1;
      const objects = (fresh.objects || []).map((o) => {
        const obj = { ...o };
        if (typeof obj.prompt === 'string') obj.prompt = transform(obj.prompt, round);
        if (typeof obj.text === 'string') obj.text = transform(obj.text, round);
        // 3층 정책(2026-07-23 2차 델타) 모의: passage-slot 요청은 지문 창작/재구성 결과로 bodyHtml·
        // source 를 채운 것처럼 응답한다(실제 AI 대신 결정적 모의 — 실존 저작물 재현 아님, 프리셋 계약과 동형).
        if (o.type === 'passage-slot') {
          obj.bodyHtml = `AI가 창작한 지문 본문(${round}회차) — 실존 저작물 원문이 아닌 순수 창작입니다.`;
          obj.source = 'AI 창작';
        }
        return { id: o.id, object: obj };
      });
      await bridge.putResponse({ schemaVersion: 3, id: fresh.id, objects });
    }
    return [...seen];
  })();
}

test('US-19 가드: std-box(불변 슬롯) 선택 시 진입점 비활성 + 서버 400(§7·§10 3중 방어)', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=ai-guard`, { virtualTimeBudget: 15000, timeoutMs: 30000 });
    assertSeedDone(dom, 'ai-guard');
    assert.equal(ds(dom, 'ai-guard-entry-disabled'), 'true', '앱 바 AI 버튼 비활성(클라이언트 가드 1층)');
    assert.equal(ds(dom, 'ai-guard-ctx-disabled'), 'true', '우클릭 메뉴 AI 항목 비활성(클라이언트 가드 2층)');
    assert.equal(ds(dom, 'ai-guard-panel-opened'), 'false', 'disabled 버튼은 클릭해도 패널이 열리지 않음');
    assert.equal(ds(dom, 'ai-guard-server-status'), '400', '서버 400(심층 방어 마지막 층, §7·§10)');
    assert.equal((await bridge.listPending()).length, 0, '요청 미생성 — 슬롯 원문 보존');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-19 진입점 통일 + v3 요청 발신 + AI 지시문 복사 + 미리보기 카드·인라인 diff + F4 개체ID 에코', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const watcher = watchAndRespond(bridge, { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-request-preview`), watcher]).then(([d]) => d);

    assertSeedDone(dom, 'ai-request-preview');
    assert.equal(ds(dom, 'ai-open-via-toolbar'), 'true', '컨텍스트 툴바 AI 버튼도 같은 패널을 연다');
    assert.equal(ds(dom, 'ai-open-via-context-menu'), 'true', '우클릭 메뉴도 같은 패널을 연다');
    assert.equal(ds(dom, 'ai-open-via-slash'), 'true', '슬래시 메뉴(/ai)도 같은 패널을 연다');
    assert.equal(ds(dom, 'ai-entry-enabled-on-select'), 'true', '비-슬롯 개체 선택 시 앱 바 AI 버튼 활성');
    assert.equal(ds(dom, 'ai-open-via-entry'), 'true', '앱 바 AI 버튼도 같은 패널을 연다(진입점 통일)');

    assert.equal(ds(dom, 'ai-copy-has-req-id'), 'true', '무API 흐름: 지시문에 요청 id 포함');
    assert.equal(ds(dom, 'ai-copy-has-objects-flag'), 'true', '지시문에 --objects 회신 형식 안내 포함');

    assert.equal(ds(dom, 'ai-preview-shown'), 'true', '응답 도착 후 preview-then-commit 카드 표시');
    assert.equal(ds(dom, 'ai-diff-has-add'), 'true', '인라인 diff — 추가(초록) 마크업 존재');
    assert.equal(ds(dom, 'ai-diff-has-del'), 'true', '인라인 diff — 삭제(취소선 빨강) 마크업 존재');
    assert.equal(ds(dom, 'ai-preview-before-has-orig'), 'true', '미리보기 카드 — 원본이 그대로 렌더됨(RenderObjectTree 재사용)');
    assert.equal(ds(dom, 'ai-panel-closed-after-cancel'), 'true', '취소 시 패널 닫힘(원본 불변— 이 테스트는 미적용)');

    const reqId = ds(dom, 'ai-request-id');
    assert.ok(reqId && reqId.startsWith('req-'), '요청 id 발급');
    const resp = await bridge.readResponse(reqId);
    assert.equal(resp.schemaVersion, 3);
    assert.equal(resp.objects[0].id, 'q1', 'F4 개체ID 에코 왕복 — 응답 objects[].id 가 요청 대상과 일치');
    assert.equal(resp.objects[0].object.type, 'question', '개체 타입 보존');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-19 재생성(버전 ◀▶ 왕복) + 적용(교체, history 1 op) + undo 1스텝 복원', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const watcher = watchAndRespond(bridge, { rounds: 2 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-version-apply-undo`), watcher]).then(([d]) => d);

    assertSeedDone(dom, 'ai-version-apply-undo');
    assert.equal(ds(dom, 'ai-version-label-after-regen'), '2 / 2', '재생성 후 2번째 버전으로 이동, 이전 버전 보존');
    assert.equal(ds(dom, 'ai-versions-differ'), 'true', '재생성 응답은 이전 버전과 다른 내용(라운드별 재작성)');
    assert.equal(ds(dom, 'ai-version-label-after-prev'), '1 / 2', '◀ 로 이전 버전 왕복');
    assert.equal(ds(dom, 'ai-version-prev-matches-v1'), 'true', '이전 버전 내용이 최초 응답과 일치(보존 확인)');
    assert.equal(ds(dom, 'ai-version-label-after-next'), '2 / 2', '▶ 로 다시 최신 버전 왕복');

    assert.equal(ds(dom, 'ai-apply-one-op'), 'true', '적용은 history 정확히 1 op');
    assert.equal(ds(dom, 'ai-prompt-changed-after-apply'), 'true', '교체 적용 — 개체 내용 갱신');
    assert.equal(ds(dom, 'ai-fresh-after-apply'), 'true', 'AI 산출 배지(data-ai-fresh) 적용 직후 표시');

    assert.equal(ds(dom, 'ai-undo-restored-original'), 'true', 'undo 1스텝으로 원본 완전 복원');
    assert.equal(ds(dom, 'ai-undo-one-step'), 'true', 'undo 는 정확히 1 op 만 되돌림');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-19 AI 산출 졸업(편집 즉시 배지 제거) + 아래 삽입(원본 보존)', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const watcher = watchAndRespond(bridge, { rounds: 2 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-graduate-insert`), watcher]).then(([d]) => d);

    assertSeedDone(dom, 'ai-graduate-insert');
    assert.equal(ds(dom, 'ai-fresh-before-edit'), 'true', '적용 직후 졸업 배지 표시');
    assert.equal(ds(dom, 'ai-fresh-after-edit'), 'false', '그 개체를 편집하는 순간 배지 제거(일반 콘텐츠화)');

    assert.equal(ds(dom, 'ai-insert-count-increased'), 'true', '아래 삽입 — 새 개체가 추가됨');
    assert.equal(ds(dom, 'ai-insert-original-unchanged'), 'true', '아래 삽입 — 원본 개체는 그대로 보존');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('3층 정책(2026-07-23 2차 델타): passage-slot AI 가드 해제 — 지문 전용 프리셋 노출 + 창작 지문 적용, std-box 는 여전히 차단', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const watcher = watchAndRespond(bridge, { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-passage-preset`), watcher]).then(([d]) => d);

    assertSeedDone(dom, 'ai-passage-preset');
    assert.equal(ds(dom, 'passage-ai-entry-enabled'), 'true', 'passage-slot 선택 시 AI 진입점이 활성이어야 함(가드 해제)');
    assert.equal(ds(dom, 'passage-ai-phase'), 'compose', '차단(blocked) 아닌 일반 작성(compose) 단계로 열려야 함');
    assert.equal(ds(dom, 'has-generate-btn'), 'true', '"창작 지문 생성" 프리셋 버튼 노출');
    assert.equal(ds(dom, 'has-restructure-btn'), 'true', '"지문 재구성" 프리셋 버튼 노출');

    assert.equal(ds(dom, 'copy-has-guard-note'), 'true', '지시문 복사 텍스트에 실존 저작물 원문 재현 금지 고지 포함');
    assert.equal(ds(dom, 'passage-preview-shown'), 'true', '응답 도착 후 미리보기 표시');
    assert.equal(ds(dom, 'preview-has-generated'), 'true', '미리보기에 AI가 창작한 지문 본문이 반영됨');

    assert.match(ds(dom, 'passage-body-after-apply') || '', /AI가 창작한 지문 본문/, '적용 후 개체 bodyHtml 에 AI 창작 지문이 반영되어야 함');
    assert.equal(ds(dom, 'passage-source-after-apply'), 'AI 창작', '적용 후 source 에 "AI 창작" 성격 표기가 반영되어야 함');

    // std-box 는 3층 정책과 무관하게 여전히 AI 가드 대상(원칙 3, 무회귀).
    assert.equal(ds(dom, 'std-ai-entry-still-disabled'), 'true', 'std-box 선택 시 AI 버튼은 여전히 비활성이어야 함');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
