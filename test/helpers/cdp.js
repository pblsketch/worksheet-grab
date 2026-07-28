import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { makeTmpDirSync } from './tmp.js';

// cdp.js — 실 Chrome 을 CDP 로 띄워 **진짜 마우스·키보드 입력**을 보내는 렌더 테스트용 드라이버.
//
// 왜 필요한가: 이 리포의 편집기 렌더 테스트는 대부분 `--dump-dom` + testSeed(합성 이벤트·내부 API
// 직접 호출)로 검증한다. 그건 계산 결과는 잘 잡지만 **배선은 건너뛴다** — 실제로 2026-07-27 에
// "삭제 후 Ctrl+Z 가 복원하지 않는" 버그가 오래 살아남았는데, testSeed 가 `history.undo()` 를 직접
// 부르고 단정도 DOM 이 아니라 모델을 읽었기 때문에 스위트가 전부 통과하고 있었다. 키보드에서
// 화면까지의 구간은 실입력으로만 드러난다.
//
// **함정(반드시 지킬 것): `Input.dispatchKeyEvent` 의 type 은 `keyDown` 이어야 한다.**
// `rawKeyDown` 으로 보내면 Ctrl+C/Ctrl+V 가 페이지에 **아예 도달하지 않는다**(Chrome 이 기본
// 클립보드 명령으로 먼저 삼킨다 — 캡처 단계 리스너에도 keydown 0건). 같은 방식의 Ctrl+S·Delete 는
// 정상 도달하므로, 무결한 코드를 회귀로 오진하기 딱 좋다.

/** CDP modifiers 비트마스크. */
const MOD = Object.freeze({ alt: 1, ctrl: 2, meta: 4, shift: 8 });

const NAMED_KEYS = {
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
};

/** 'z' → {key:'z', code:'KeyZ', keyCode:90}, 'Delete' → 표에서. */
function resolveKey(name) {
  if (NAMED_KEYS[name]) return NAMED_KEYS[name];
  if (/^[a-z]$/.test(name)) {
    return { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0) };
  }
  throw new Error(`cdp.press: 알 수 없는 키 '${name}' — NAMED_KEYS 에 추가하라.`);
}

function makeSender(ws) {
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else resolve(msg.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const port = parseInt(readFileSync(portFile, 'utf8').split('\n')[0], 10);
      if (Number.isFinite(port)) return port;
    } catch { /* 아직 생성 전 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('DevToolsActivePort 파일이 시간 내 생성되지 않았습니다.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 실 Chrome 을 띄워 url 로 이동한 뒤 실입력 세션을 돌려준다. 호출부는 finally 에서 close() 한다.
 * @returns {Promise<{evaluate, waitFor, click, press, insertText, consoleErrors, close}>}
 */
export async function openCdpSession(url, {
  prefix = 'wsg-cdp-chrome-', windowSize = '1400,1800', navTimeoutMs = 30000, settleMs = 160,
} = {}) {
  const chromeTmp = makeTmpDirSync(prefix);
  const child = spawn(resolveChromePath(null), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${chromeTmp.dir}`, '--remote-debugging-port=0', `--window-size=${windowSize}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let ws = null;
  const close = async () => {
    try { ws?.close(); } catch { /* noop */ }
    await new Promise((res) => {
      if (!child.pid) { res(); return; }
      child.once('exit', res);
      try { child.kill('SIGKILL'); } catch { res(); }
      setTimeout(res, 3000); // 종료 이벤트가 지연되는 경우의 안전판
    });
    chromeTmp.cleanup();
  };

  try {
    const port = await waitForDevToolsPort(chromeTmp.dir, 20000);
    const res = await fetch(`http://127.0.0.1:${port}/json/new`, { method: 'PUT', headers: { Host: '127.0.0.1' } });
    const tab = await res.json();
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(new Error(`CDP ws 연결 실패: ${e.message}`)));
    });
    const cdp = makeSender(ws);
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Console.enable');

    const consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params?.exceptionDetails?.text || 'uncaught exception');
      }
      if (msg.method === 'Console.messageAdded' && msg.params?.message?.level === 'error') {
        consoleErrors.push(msg.params.message.text);
      }
    });

    const loaded = new Promise((resolve) => {
      const onMsg = (ev) => {
        if (JSON.parse(ev.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', onMsg); resolve(); }
      };
      ws.addEventListener('message', onMsg);
    });
    await cdp('Page.navigate', { url });
    await Promise.race([
      loaded,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`페이지 로드 타임아웃: ${url}`)), navTimeoutMs)),
    ]);

    async function evaluate(expression) {
      const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`evaluate 예외: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}`);
      return r.result?.value;
    }

    /** 조건이 truthy 가 될 때까지 폴링해 그 값을 돌려준다(고정 sleep 대신 — 리플로우 디바운스 때문). */
    async function waitFor(expression, { timeoutMs = 15000, intervalMs = 100, message = '' } = {}) {
      const start = Date.now();
      let last;
      for (;;) {
        last = await evaluate(expression).catch(() => undefined);
        if (last) return last;
        if (Date.now() - start > timeoutMs) {
          throw new Error(`waitFor 타임아웃(${timeoutMs}ms)${message ? ` — ${message}` : ''}: ${expression}`);
        }
        await sleep(intervalMs);
      }
    }

    async function click(x, y, { clickCount = 1 } = {}) {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount, buttons: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, buttons: 0 });
      await sleep(settleMs);
    }

    /** 실 우클릭 — contextmenu 는 좌클릭과 다른 경로라 click() 으로 대신할 수 없고,
     *  dispatchEvent('contextmenu') 는 hit-test 를 건너뛴다(이 파일 머리말의 이유와 동일). */
    async function rightClick(x, y) {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1, buttons: 2 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1, buttons: 0 });
      await sleep(settleMs);
    }

    /**
     * 실 마우스 드래그(누르기 → 여러 번 이동 → 놓기). 합성 이벤트로는 잡히지 않는 결함 —
     * hit-test, `pointer-events`, 포인터 캡처, iframe 경계 — 이 전부 이 경로에서만 드러난다.
     *
     * **중간 이동을 여러 스텝으로 쪼개는 것이 중요하다.** 한 번에 목적지로 점프하면 임계 기반
     * 승격(5px)이나 스텝마다의 실시간 반영이 검증되지 않고, 실제 사용자의 움직임과도 다르다.
     * `buttons:1` 을 이동 중에도 유지해야 드래그로 인식된다(빠뜨리면 hover 로 처리된다).
     */
    /** 누르지 않고 포인터만 옮긴다. hover 로만 드러나는 UI(조작 칩 등)는 이것 없이는 검증할 수
     *  없다 — click 은 이미 눌러 버린 뒤라 "가리키기만 했을 때" 상태를 못 본다. */
    async function hover(x, y, { settle = settleMs } = {}) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await sleep(settle);
    }

    async function drag(fromX, fromY, toX, toY, { steps = 12, settle = settleMs } = {}) {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1, buttons: 1 });
      for (let i = 1; i <= steps; i++) {
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: 'left', buttons: 1,
          x: fromX + ((toX - fromX) * i) / steps,
          y: fromY + ((toY - fromY) * i) / steps,
        });
        await sleep(8);
      }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1, buttons: 0 });
      await sleep(settle);
    }

    /** 실 키 입력. type:'keyDown' 고정 — 파일 상단 함정 주석 참조(rawKeyDown 은 Ctrl+C/V 를 삼킨다). */
    async function press(name, { ctrl = false, shift = false, alt = false, meta = false } = {}) {
      const { key, code, keyCode } = resolveKey(name);
      const modifiers = (ctrl ? MOD.ctrl : 0) | (shift ? MOD.shift : 0) | (alt ? MOD.alt : 0) | (meta ? MOD.meta : 0);
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyDown' });
      await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
      await sleep(settleMs);
    }

    /** 실 타이핑(IME 확정 입력과 같은 경로) — execCommand 나 value 대입이 아니다. */
    async function insertText(text) {
      await cdp('Input.insertText', { text });
      await sleep(settleMs);
    }

    return { evaluate, waitFor, click, rightClick, hover, drag, press, insertText, consoleErrors, close };
  } catch (e) {
    await close();
    throw e;
  }
}
