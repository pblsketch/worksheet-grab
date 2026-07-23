// ultraqa 탐색 QA 공용 하네스 — CDP Input 실마우스(합성 dispatchEvent 금지).
// 패턴 출처: scratchpad/ralph-reports/us16-evidence/verify-us16-mouse.mjs (스파이크 §4-5 계승).
// 사용: import { launchQa } from './harness.mjs' — 시나리오 파일이 launchQa() 로 세션을 얻는다.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.msgId = 0; this.pending = new Map(); this.handlers = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', (e) => rej(new Error('CDP ws error: ' + e.message)));
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else res(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) || []) h(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function cdpHttpJson(port, path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  if (!res.ok) throw new Error(`CDP HTTP ${method} ${path} -> ${res.status}`);
  return res.json();
}

async function waitForDevToolsPort(userDataDir, timeoutMs = 20000) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(portFile)) {
      try {
        const txt = readFileSync(portFile, 'utf8').split('\n');
        const port = parseInt(txt[0], 10);
        if (Number.isFinite(port)) return port;
      } catch (e) {
        if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e; // 쓰기 잠금 중이면 다음 폴링
      }
    }
    await sleep(100);
  }
  throw new Error('DevToolsActivePort 파일이 시간 내 생성되지 않았습니다.');
}

/**
 * QA 세션을 연다.
 * @param {object} opts
 *  - docName: 문서명 (기본 'qa문서')
 *  - document: 개체 트리 픽스처(지정 시 임시 워크스페이스에 checkpoint 로 시드)
 *  - copyFrom: 실존 worksheets/<이름> 디렉터리 경로(지정 시 임시 워크스페이스로 통째 복사 — 원본 무접촉)
 *  - windowSize: 기본 '1500,1600'
 *  - evidenceDir: 스크린샷/덤프 저장 위치
 */
export async function launchQa(opts = {}) {
  const docName = opts.docName || 'qa문서';
  const evidenceDir = opts.evidenceDir || join(HERE, 'evidence');
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });

  const workspaceBase = mkdtempSync(join(tmpdir(), 'wsg-uqa-ws-'));
  const workspace = new FsWorkspaceRepository({ baseDir: workspaceBase });
  const blockRepository = new FsBlockRepository({ root: ROOT });

  if (opts.copyFrom) {
    cpSync(opts.copyFrom, join(workspaceBase, docName), { recursive: true });
  } else if (opts.document) {
    const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
    await saver.checkpoint({ name: docName, document: opts.document, now: new Date('2026-07-23T01:00:00.000Z') });
  } else {
    throw new Error('launchQa: document 또는 copyFrom 이 필요합니다.');
  }

  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  const url = `http://127.0.0.1:${addr.port}`;

  const chromePath = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-uqa-cdp-'));
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', `--window-size=${opts.windowSize || '1500,1600'}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeStderr = '';
  child.stderr.on('data', (d) => { chromeStderr += d.toString(); });

  const dtPort = await waitForDevToolsPort(userDataDir);
  const tab = await cdpHttpJson(dtPort, '/json/new', 'PUT');
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const consoleErrors = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    consoleErrors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
  });

  async function evalExpr(expression) {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error('Eval 실패: ' + JSON.stringify(res.exceptionDetails).slice(0, 500));
    return res.result.value;
  }

  async function rectOf(selector) {
    const r = await evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      if (!f) return null;
      const el = f.contentDocument.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const fr = f.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return { x: fr.left + er.left, y: fr.top + er.top, width: er.width, height: er.height };
    })()`);
    if (!r) throw new Error(`셀렉터를 찾지 못함(iframe 내부): ${selector}`);
    return r;
  }
  /** 최상위 문서(앱 셸)의 요소 좌표. */
  async function rectOfTop(selector) {
    const r = await evalExpr(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const er = el.getBoundingClientRect();
      return { x: er.left, y: er.top, width: er.width, height: er.height };
    })()`);
    if (!r) throw new Error(`셀렉터를 찾지 못함(최상위): ${selector}`);
    return r;
  }
  const centerOf = async (sel) => { const r = await rectOf(sel); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: r }; };
  const centerOfTop = async (sel) => { const r = await rectOfTop(sel); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: r }; };

  async function objState(oid) {
    return evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      const el = f.contentDocument.querySelector('[data-oid="${oid}"]');
      if (!el) return null;
      return {
        selected: el.classList.contains('wg-selected'),
        editing: el.classList.contains('wg-editing'),
        ceCount: f.contentDocument.querySelectorAll('[contenteditable="true"]').length,
        style: el.getAttribute('style') || '',
        text: el.textContent.trim().slice(0, 60),
      };
    })()`);
  }

  const mouse = {
    move: (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
    down: (x, y, clickCount = 1, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount, modifiers }),
    up: (x, y, clickCount = 1, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, modifiers }),
    rightClick: async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
      await sleep(30);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
      await sleep(60);
    },
  };
  async function click(x, y, { modifiers = 0 } = {}) {
    await mouse.move(x, y); await sleep(20);
    await mouse.down(x, y, 1, modifiers); await sleep(30);
    await mouse.up(x, y, 1, modifiers); await sleep(50);
  }
  async function dblclick(x, y) {
    await mouse.move(x, y); await sleep(20);
    await mouse.down(x, y, 1); await sleep(20); await mouse.up(x, y, 1);
    await sleep(60);
    await mouse.down(x, y, 2); await sleep(20); await mouse.up(x, y, 2);
    await sleep(80);
  }
  async function dragTo(x1, y1, x2, y2, steps = 12) {
    await mouse.move(x1, y1); await sleep(20);
    await mouse.down(x1, y1); await sleep(30);
    for (let i = 1; i <= steps; i++) {
      await mouse.move(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      await sleep(15);
    }
    await sleep(20);
    await mouse.up(x2, y2);
    await sleep(80);
  }

  const KEY = {
    Escape: { key: 'Escape', code: 'Escape', vk: 27 },
    Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
    Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
    Delete: { key: 'Delete', code: 'Delete', vk: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
    a: { key: 'a', code: 'KeyA', vk: 65 }, c: { key: 'c', code: 'KeyC', vk: 67 }, v: { key: 'v', code: 'KeyV', vk: 86 },
    s: { key: 's', code: 'KeyS', vk: 83 }, z: { key: 'z', code: 'KeyZ', vk: 90 }, y: { key: 'y', code: 'KeyY', vk: 89 },
  };
  /** modifiers: 1=Alt 2=Ctrl 4=Meta 8=Shift */
  async function pressKey(name, { modifiers = 0 } = {}) {
    const k = KEY[name] || { key: name, code: name, vk: 0 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers });
    await sleep(40);
  }
  async function typeText(text, { perCharMs = 4 } = {}) {
    for (const ch of text) {
      if (ch === '\n') { await pressKey('Enter'); continue; }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch });
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await sleep(perCharMs);
    }
  }
  /** 한글 등 IME 텍스트는 Input.insertText 로 주입(실 IME 경로 근사). */
  const insertText = (text) => cdp.send('Input.insertText', { text });

  async function screenshot(name) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(evidenceDir, name), Buffer.from(data, 'base64'));
    return name;
  }

  async function navigate(extra = '') {
    const loadP = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `${url}/${extra}` });
    await loadP;
    for (let i = 0; i < 100; i++) {
      if (await evalExpr(`document.body.dataset.ready === 'true'`)) break;
      await sleep(100);
    }
    const ready = await evalExpr(`document.body.dataset.ready === 'true'`);
    if (!ready) throw new Error('에디터 data-ready 대기 시간 초과');
  }

  const shellJson = async () => (await fetch(`${url}/shell.json`)).json();

  return {
    url, server, workspace, workspaceBase, docName, cdp, child, userDataDir, consoleErrors, evidenceDir,
    evalExpr, rectOf, rectOfTop, centerOf, centerOfTop, objState,
    mouse, click, dblclick, dragTo, pressKey, typeText, insertText, screenshot, navigate, shellJson,
    chromeStderrText: () => chromeStderr,
    async close() {
      try { cdp.close(); } catch { /* noop */ }
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      await sleep(300);
      try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
      try { await new Promise((r) => server.close(r)); } catch { /* noop */ }
      try { rmSync(workspaceBase, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
    },
  };
}

/** 표준 픽스처 — 카탈로그 폭넓게(제목·질문·richtext·표·답란 float). */
export function standardFixture() {
  return {
    pagination: 'paginated',
    docTitle: 'ultraqa 탐색 문서',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '탐색 QA 활동지' },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '질문 하나', qnum: 1 },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>리치텍스트 본문</p>' },
        { id: 'tb1', type: 'table', placement: 'flow', headers: ['구분', '내용'], rows: [['가', '1'], ['나', '2']] },
        { id: 'q2', type: 'question', placement: 'flow', qtype: 'short', prompt: '질문 둘', qnum: 2 },
      ],
      float: [
        { id: 'f1', type: 'answer-area', placement: 'float', style: 'box', label: '메모', rect: { xMm: 120, yMm: 240, wMm: 50, hMm: 25 } },
      ],
    }],
  };
}

export function assertLog() {
  const failures = [];
  const okLog = [];
  return {
    check(cond, msg) {
      if (cond) { okLog.push(msg); console.log(`  [ok] ${msg}`); }
      else { failures.push(msg); console.log(`  [FAIL] ${msg}`); }
    },
    failures, okLog,
    summary(name) {
      console.log(`\n=== ${name}: ${failures.length === 0 ? 'PASS' : 'FAIL'} (ok ${okLog.length} / fail ${failures.length}) ===`);
      for (const f of failures) console.log('  ✗ ' + f);
      return failures.length === 0;
    },
  };
}
