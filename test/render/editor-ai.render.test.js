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

/** Phase 4(v4) 전용 문서 — 합치기(3→1)를 실측할 문항 3개와, "대상 페이지 삭제" 를 실측할 2쪽. */
function opsDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'AI 계획(v4) 테스트 문서',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [
      {
        id: 'page-ops-1',
        flow: [
          { id: 't1', type: 'title', placement: 'flow', text: '오늘의 학습 목표' },
          { id: 'std1', type: 'std-box', placement: 'flow', codes: ['9과15-01'] },
          { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압이 무엇인지 설명하시오.' },
          { id: 'q2', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전류가 무엇인지 설명하시오.' },
          { id: 'q3', type: 'question', placement: 'flow', qtype: 'essay', prompt: '저항이 무엇인지 설명하시오.' },
        ],
        float: [],
      },
      {
        id: 'page-ops-2',
        flow: [
          { id: 'q4', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '옴의 법칙을 쓰시오.' },
        ],
        float: [],
      },
    ],
  };
}

async function startEditServer({ document: initialDocument = freshDocument() } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-ai-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: initialDocument, now: new Date('2026-07-23T01:00:00.000Z') });
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

/**
 * Phase 4 모의 구독 AI: 요청 하나에 v4 계획(ops)을 회신한다. planFor(request) 가 ops 배열을 만든다 —
 * 실제로는 별도 프로세스의 `worksheet-grab ai respond --ops <file.json>` 이 같은 파일을 쓴다.
 */
function watchAndRespondOps(bridge, planFor, { rounds = 1, timeoutMs = 40000 } = {}) {
  return (async () => {
    const seen = [];
    const startedAt = Date.now();
    while (seen.length < rounds) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`watchAndRespondOps: ${timeoutMs}ms 내 ${rounds}개 요청 중 ${seen.length}개만 수신`);
      }
      const pending = await bridge.listPending();
      const fresh = pending.find((r) => !seen.includes(r.id));
      if (!fresh) { await new Promise((r) => setTimeout(r, 150)); continue; }
      seen.push(fresh.id);
      await bridge.putResponse({ schemaVersion: 4, id: fresh.id, ops: planFor(fresh, seen.length) });
    }
    return seen;
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

// ══════════════════════ Phase 4: 페이지 범위 AI (US-P4-2 ~ US-P4-5) ══════════════════════

const MERGE_PLAN = () => ([
  { op: 'replace', id: 'q1', object: { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압·전류·저항의 관계를 한 활동으로 통합해 설명하시오.' } },
  { op: 'delete', id: 'q2' },
  { op: 'delete', id: 'q3' },
  { op: 'insert', object: { id: 'ai-new', type: 'richtext', placement: 'flow', html: '<p>활동 안내(AI 신규)</p>' }, afterId: 'q1' },
]);

test('US-P4-2·P4-3 v4 계획: 문항 3개→1개 합치기 + 신규 1개 — 미리보기 개수 변화 · 적용 1 op · undo 1스텝', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    const watcher = watchAndRespondOps(bridge, MERGE_PLAN, { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-ops-merge`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-ops-merge');

    assert.equal(ds(dom, 'ops-selected-count'), '3', '문항 3개 다중 선택');
    // 미리보기: 수정/삭제/삭제/신규 — ops 순서를 그대로 보여준다.
    assert.equal(ds(dom, 'ops-card-kinds'), 'replace,delete,delete,insert', '계획 항목이 종류별로 구분 표시됨');
    assert.equal(ds(dom, 'ops-count-before'), '3', '대상 3개');
    assert.equal(ds(dom, 'ops-count-after'), '2', '결과 2개(합쳐진 1개 + 신규 1개)');
    assert.equal(ds(dom, 'ops-count-delete'), '2');
    assert.equal(ds(dom, 'ops-count-insert'), '1');
    assert.match(ds(dom, 'ops-count-text') || '', /대상 3개 → 결과 2개/, '개수 변화가 문장으로도 보인다');
    // 삭제는 before 만, 신규는 after 만.
    assert.match(ds(dom, 'ops-delete-before-text') || '', /전류가 무엇인지/, '삭제 항목은 사라질 원본을 보여준다');
    assert.match(ds(dom, 'ops-delete-after-text') || '', /삭제/, '삭제 항목의 AI 결과 칸은 삭제됨 표기');
    assert.match(ds(dom, 'ops-insert-before-text') || '', /새로 추가되는 개체/, '신규 항목은 원본이 없다');
    assert.match(ds(dom, 'ops-insert-after-text') || '', /활동 안내/, '신규 항목은 새 개체를 보여준다');

    assert.equal(ds(dom, 'ops-history-one-op'), 'true', '적용은 applyDocOp 한 번 = history 정확히 1 op');
    assert.equal(ds(dom, 'ops-count-before-apply'), '6');
    assert.equal(ds(dom, 'ops-count-after-apply'), '5', '3개가 1개로 합쳐지고 1개가 추가되어 6→5');
    assert.equal(ds(dom, 'ops-merged-away'), 'true', 'q2·q3 는 문서에서 사라진다');
    assert.match(ds(dom, 'ops-q1-prompt') || '', /통합해 설명/, '남은 개체는 AI 가 합친 내용');
    assert.equal(ds(dom, 'ops-inserted-rendered'), 'true', '신규 개체가 캔버스에 실제로 렌더됨');
    assert.equal(ds(dom, 'ops-std-intact'), 'true', 'std-box 는 그대로(원칙 3)');
    assert.equal(ds(dom, 'ops-selection-moved'), 'true', '적용 후 선택이 AI 결과 개체로 이동');
    assert.equal(ds(dom, 'ops-selection-count'), '2', '결과 개체(합친 1 + 신규 1) 전부 선택');

    assert.equal(ds(dom, 'ops-undo-one-step'), 'true', 'Ctrl+Z 한 번으로 되돌아온다');
    assert.equal(ds(dom, 'ops-undo-restored'), 'true', '세 개체가 모두 원래대로 복원');
    assert.equal(ds(dom, 'ops-undo-count'), '6');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-P4-3 무음 실패 금지: 계획이 무효면 적용 버튼 비활성 + 사유 표시', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    // 존재하지 않는 개체를 지목하는 계획 — 적용하면 엔진이 던진다(= 부분 반영 금지).
    const watcher = watchAndRespondOps(bridge, () => ([
      { op: 'replace', id: '없는-개체', object: { id: '없는-개체', type: 'question', qtype: 'essay', prompt: '유령' } },
    ]), { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-ops-invalid`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-ops-invalid');

    assert.equal(ds(dom, 'inv-apply-disabled'), 'true', '적용 버튼 비활성');
    assert.match(ds(dom, 'inv-error') || '', /대상 개체를 찾을 수 없습니다/, '사유가 패널에 표시된다');
    assert.equal(ds(dom, 'inv-panel-still-open'), 'true', '패널은 닫히지 않는다');
    assert.equal(ds(dom, 'inv-unchanged'), 'true', '문서는 그대로');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-P4-3 버전 왕복: 적용 가능 여부와 사유가 항상 그 버전에서 파생된다', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    // 1차는 무효 계획(없는 대상), 2차 재생성은 정상 계획 — ◀▶ 로 왕복하며 상태가 따라오는지 본다.
    const watcher = watchAndRespondOps(bridge, (_req, round) => (round === 1
      ? [{ op: 'replace', id: '없는-개체', object: { id: '없는-개체', type: 'question', qtype: 'essay', prompt: '유령' } }]
      : [{ op: 'replace', id: 'q1', object: { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '정상 재작성' } }]),
    { rounds: 2 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-ops-version-sync`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-ops-version-sync');

    assert.equal(ds(dom, 'vs-v1-disabled'), 'true', 'v1(무효) — 적용 비활성');
    assert.match(ds(dom, 'vs-v1-error') || '', /찾을 수 없습니다/, 'v1 — 사유 표시');
    assert.equal(ds(dom, 'vs-v2-disabled'), 'false', 'v2(정상) — 적용 활성');
    assert.equal(ds(dom, 'vs-v2-error'), '', 'v2 — 사유 없음');

    // ◀ 로 무효 버전 복귀: 비활성인데 사유만 사라지면 교사는 이유를 알 수 없다.
    assert.equal(ds(dom, 'vs-back-label'), '1 / 2');
    assert.equal(ds(dom, 'vs-back-disabled'), 'true', '◀ 복귀 — 다시 비활성');
    assert.match(ds(dom, 'vs-back-error') || '', /찾을 수 없습니다/, '◀ 복귀 — 사유도 함께 되살아난다');
    // ▶ 로 정상 버전 복귀: 남의 무효 문구가 남아 있으면 안 된다.
    assert.equal(ds(dom, 'vs-fwd-disabled'), 'false', '▶ 복귀 — 다시 활성');
    assert.equal(ds(dom, 'vs-fwd-error'), '', '▶ 복귀 — 이전 버전의 사유가 남지 않는다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-P4-4 페이지 전체 scope: 선택 0개 진입 · std-box 제외 · 토글 왕복 · 요청에 pageId/pageVersion', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    // 이 시드는 응답을 기다리지 않는다 — 요청 본문 자체가 검증 대상이라 큐에 남긴 채 확인한다.
    const dom = await dumpDom(`${url}/?seed=ai-page-scope`);
    assertSeedDone(dom, 'ai-page-scope');

    assert.equal(ds(dom, 'ps-selection-count'), '0', '선택 해제 상태');
    assert.equal(ds(dom, 'ps-entry-enabled'), 'true', '선택이 없어도 AI 진입점은 활성');
    assert.equal(ds(dom, 'ps-phase'), 'compose', '차단 아닌 작성 단계로 열린다');
    assert.equal(ds(dom, 'ps-scope'), 'page', 'scope=page');
    assert.equal(ds(dom, 'ps-page-id'), ds(dom, 'ps-first-page-id'), '활성 페이지를 페이지 ID 로 식별(index 아님)');
    assert.equal(ds(dom, 'ps-page-flow-count'), '5', '그 페이지의 개체는 5개(std-box 포함)');
    assert.equal(ds(dom, 'ps-target-count'), '4', 'std-box 를 뺀 4개만 대상(원칙 3)');
    assert.match(ds(dom, 'ps-summary-text') || '', /현재 페이지 전체/, '대상 범위가 패널에 표기된다');
    assert.equal(ds(dom, 'ps-scope-toggle-disabled'), 'true', '선택이 없으면 개체 범위로 되돌릴 수 없다');

    assert.equal(ds(dom, 'ps-scope-with-selection'), 'objects', '선택이 있으면 기본은 개체 범위');
    assert.equal(ds(dom, 'ps-target-count-with-selection'), '1');
    assert.equal(ds(dom, 'ps-scope-after-toggle'), 'page', '토글로 페이지 전체 선택');
    assert.equal(ds(dom, 'ps-target-count-after-toggle'), '4');
    assert.equal(ds(dom, 'ps-scope-after-untoggle'), 'objects', '토글 해제로 선택 개체 범위 복귀');
    assert.equal(ds(dom, 'ps-target-count-after-untoggle'), '1');
    assert.equal(ds(dom, 'ps-copy-has-page-scope'), 'true', '지시문에도 페이지 전체 범위가 고지된다');

    const reqId = ds(dom, 'ps-request-id');
    assert.ok(reqId && reqId.startsWith('req-'), '요청 id 발급');
    const pending = await bridge.listPending();
    const req = pending.find((r) => r.id === reqId);
    assert.ok(req, '요청이 큐에 기록됨');
    assert.equal(req.schemaVersion, 4, 'v4 요청');
    assert.equal(req.scope, 'page');
    assert.equal(req.pageId, ds(dom, 'ps-first-page-id'), '요청에 페이지 ID 가 실린다');
    assert.match(String(req.pageVersion || ''), /^pv1-[0-9a-f]{16}$/, '요청에 그 시점 pageVersion 이 실린다');
    assert.equal(req.objects.length, 4, '요청 개체도 std-box 제외 4개');
    assert.equal(req.objects.some((o) => o.type === 'std-box'), false, 'std-box 는 요청에 실리지 않는다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-P4-5 덮어쓰기 방지: 적용 전 페이지가 바뀌면 자동 적용하지 않고 선택지를 준다', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    const watcher = watchAndRespondOps(bridge, () => ([
      { op: 'replace', id: 'q1', object: { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: 'AI 가 다시 쓴 문항' } },
    ]), { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-conflict`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-conflict');

    assert.equal(ds(dom, 'cf-detected'), 'true', '충돌이 감지된다');
    assert.equal(ds(dom, 'cf-kind'), 'changed');
    assert.equal(ds(dom, 'cf-not-applied'), 'true', 'fail-closed — 기본 동작은 적용하지 않음');
    assert.equal(ds(dom, 'cf-panel-still-open'), 'true', '패널이 열린 채 선택을 기다린다');
    assert.equal(ds(dom, 'cf-has-force'), 'true', '"그래도 적용" 선택지');
    assert.equal(ds(dom, 'cf-has-discard'), 'true', '"폐기" 선택지');
    assert.equal(ds(dom, 'cf-forced-applied'), 'true', '교사가 강행하면 적용된다');
    assert.equal(ds(dom, 'cf-teacher-edit-kept'), 'true', '강행 적용은 대상 개체만 바꾼다 — 그 사이 편집은 보존');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('후속: 여러 쪽에 걸친 요청은 걸친 모든 페이지를 비교한다(대표 한 장만 재던 구멍)', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    const watcher = watchAndRespondOps(bridge, () => ([
      { op: 'replace', id: 'q1', object: { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: 'AI 가 다시 쓴 1쪽 문항' } },
    ]), { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-multipage-conflict`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-multipage-conflict');

    assert.equal(ds(dom, 'mp-selected-count'), '2', '1쪽·2쪽 개체를 함께 선택');
    // 요청 큐에 걸친 페이지 지문이 전부 실렸는지 — 이게 없으면 아래 충돌 감지가 성립하지 않는다.
    const req = (await bridge.listAll()).find((r) => r.id === ds(dom, 'mp-request-id'));
    assert.ok(req, '요청 기록됨');
    assert.equal(Object.keys(req.pageVersions || {}).length, 2, '요청에 두 페이지의 지문이 모두 실린다');
    assert.ok(req.pageVersions[req.pageId], '대표 페이지 지문도 맵에 포함');

    assert.equal(ds(dom, 'mp-second-page-edited'), 'true', '대기 중 2쪽을 실제로 편집');
    assert.equal(ds(dom, 'mp-conflict-detected'), 'true', '대표 페이지가 아닌 쪽의 편집도 충돌로 잡힌다');
    assert.equal(ds(dom, 'mp-conflict-kind'), 'changed');
    assert.equal(ds(dom, 'mp-not-applied'), 'true', 'fail-closed — 2쪽 편집이 조용히 덮이지 않는다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('후속: 요청 범위 밖 페이지의 개체를 건드리는 ops 는 거부한다', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    // 2쪽 개체만 요청했는데 AI 가 1쪽 개체를 지우려 든다 — 그 페이지는 보호 범위 밖이다.
    const watcher = watchAndRespondOps(bridge, () => ([{ op: 'delete', id: 'q1' }]), { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-ops-out-of-scope`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-ops-out-of-scope');

    assert.equal(ds(dom, 'oos-target-count'), '1', '2쪽 개체 1개만 대상');
    assert.equal(ds(dom, 'oos-apply-disabled'), 'true', '적용 버튼 비활성');
    assert.match(ds(dom, 'oos-error') || '', /요청 범위 밖 개체/, '사유가 표시된다');
    assert.equal(ds(dom, 'oos-q1-untouched'), 'true', '범위 밖 개체는 그대로');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-P4-5 대상 페이지 삭제: 적용 거부 + 사유 표시(강행 경로 없음)', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, bridge } = await startEditServer({ document: opsDocument() });
  try {
    const watcher = watchAndRespondOps(bridge, () => ([
      { op: 'replace', id: 'q4', object: { id: 'q4', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: 'AI 가 다시 쓴 옴의 법칙 문항' } },
    ]), { rounds: 1 });
    const dom = await Promise.all([dumpDom(`${url}/?seed=ai-page-missing`), watcher]).then(([d]) => d);
    assertSeedDone(dom, 'ai-page-missing');

    assert.equal(ds(dom, 'pmi-detected'), 'true', '거부 사유가 표시된다');
    assert.equal(ds(dom, 'pmi-kind'), 'missing');
    assert.equal(ds(dom, 'pmi-no-force'), 'true', '페이지가 없으면 강행 선택지도 없다');
    assert.equal(ds(dom, 'pmi-panel-still-open'), 'true');
    assert.equal(ds(dom, 'pmi-count-unchanged'), 'true', '문서는 그대로');
    assert.match(ds(dom, 'pmi-message') || '', /페이지가 삭제/, '사유 문구');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
