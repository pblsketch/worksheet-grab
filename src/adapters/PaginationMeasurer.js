import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveChromePath } from './ChromeRenderer.js';

// ChromePaginationMeasurer — PaginateObjectTree(S2.5) 의 Chrome 측정 어댑터(D-A).
// Chrome DevTools Protocol(Page/Runtime 도메인)을 Node 내장 WebSocket/fetch 만으로 직접 구동한다
// (신규 npm 의존성 0 — 실제 브라우저 입력 검증에 사용한 CDP 클라이언트 패턴을 재사용).
// Chrome 실행 파일 경로는 resolveChromePath(ChromeRenderer.js, 읽기전용 import)를
// 재사용해 중복 정의하지 않는다 — ChromeRenderer 본체는 이 스토리에서 수정하지 않는다.
//
// 게이팅(R2-1): document.fonts.ready + (KaTeX auto-render 스크립트가 있으면) 그 완료 이후에만
// 개체 높이를 측정한다(로딩 미완 측정을 배제). 측정 임시 프로필은 wsg-* 접두사, 종료 시 항상
// 정리한다(MEMORY: render-temp-disk-exhaustion — 정리 누락 시 디스크 소진).
//
// 이 파일은 browserGraph 화이트리스트에 절대 등재하지 않는다(node:*/spawn 사용 — 순수성 위반이
// 아니라 애초에 브라우저로 서빙될 코드가 아님). PaginateObjectTree.js 는 이 모듈을 정적 import 하지
// 않고 duck-typed measurer 로 주입만 받는다(순수성 경계 보존).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 초소형 CDP 클라이언트(Node 내장 WebSocket 만 사용, 의존성 0) ──
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', (e) => rej(new Error('CDP ws error: ' + (e?.message || 'unknown'))));
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
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Host: '127.0.0.1' } });
  if (!res.ok) throw new Error(`CDP HTTP ${method} ${path} -> ${res.status}`);
  return res.json();
}

// US-20(S4.5) 알려진 플레이크 대응: Chrome 이 DevToolsActivePort 파일을 막 쓰기 시작한 순간에
// readFileSync 가 끼어들면 Windows 에서 EBUSY(파일이 아직 쓰기 잠금 중)로 던진다 — 파일 자체는
// existsSync 로 이미 보였으니 "아직 준비 안 됨"과 동일하게 취급해 다음 폴링에서 재시도한다
// (그 외 에러는 그대로 던진다 — 원인 은폐 방지).
async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(portFile)) {
      let txt = null;
      try {
        txt = readFileSync(portFile, 'utf8').split('\n');
      } catch (e) {
        if (e && (e.code === 'EBUSY' || e.code === 'EPERM')) { await sleep(100); continue; }
        throw e;
      }
      const port = parseInt(txt[0], 10);
      if (Number.isFinite(port)) return port;
    }
    await sleep(100);
  }
  throw new Error('DevToolsActivePort 파일이 시간 내 생성되지 않았습니다.');
}

// 페이지 컨텍스트에서 실행되는 게이트/측정 함수 — 클로저 없이 자기완결(문자열 직렬화 후 eval).
// R2-1: document.fonts.ready 를 반드시 먼저 기다리고, KaTeX auto-render 스크립트가 문서에 있으면
// (renderMathInElement 가 전역에 등록될 때까지, 즉 auto-render onload 실행 완료까지) 추가로 기다린다.
async function gateInPage() {
  await document.fonts.ready;
  const hadKatex = !!document.querySelector('script[src*="auto-render"]');
  if (hadKatex) {
    await new Promise((resolve) => {
      const check = () => {
        if (typeof window.renderMathInElement === 'function') { resolve(); return; }
        requestAnimationFrame(check);
      };
      check();
    });
  }
  return { fontsReady: true, katexReady: true, hadKatex, gatedAt: Date.now() };
}

// 개체별 "점유 높이"는 자기 자신의 getBoundingClientRect().height 단순 합산이 아니라, 다음 개체가
// 시작하는 위치까지의 거리(top 델타)로 측정한다 — 인접 형제 블록의 상하 마진은 CSS 마진 상쇄
// (margin collapsing)로 실제보다 작은 시각적 간격을 만드는데(특히 `.wg-obj` 래퍼처럼 padding/
// border 가 없는 빈 부모는 자식 마진이 그대로 "상쇄를 통과"해 부모 자신의 bounding rect 에는
// 잡히지 않는다), 개별 높이만 합산하면 실제 문서 흐름이 전진하는 거리보다 작게 측정되어 페이지네
// 이션이 실제보다 훨씬 적은 페이지 수로 오판한다(실측: 마진 상쇄를 무시하면 약 2배 과소측정).
// top 델타는 이 상쇄를 있는 그대로 반영하는 유일하게 정확한 측정법이다(문서는 스크롤하지 않으므로
// scrollY=0 이 보장되어 getBoundingClientRect().top 이 곧 문서 절대좌표와 같다).
function measureInPage() {
  const els = [...document.querySelectorAll('[data-oid]')];
  const rects = els.map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-oid'), top: r.top, height: r.height };
  });
  const out = {};
  for (let i = 0; i < rects.length; i++) {
    const cur = rects[i];
    const next = rects[i + 1];
    out[cur.id] = next ? (next.top - cur.top) : cur.height;
  }
  return out;
}

export class ChromePaginationMeasurer {
  constructor({ chromePath = null } = {}) {
    this.chromePath = resolveChromePath(chromePath);
  }

  /**
   * @param {{html:string, timeoutMs?:number}} args
   * @returns {Promise<{heights:Record<string,number>, gating:{fontsReady:boolean, katexReady:boolean,
   *   hadKatex:boolean, gatedAt:number}}>}
   */
  async measure({ html, timeoutMs = 30000 }) {
    if (typeof html !== 'string') throw new TypeError('ChromePaginationMeasurer.measure 는 html(string) 이 필요합니다.');

    // 렌더마다 격리 프로필 — 종료 후 반드시 정리(무정리 시 %TEMP% 무한 누적, MEMORY).
    const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-paginate-'));
    const htmlPath = join(userDataDir, 'measure.html');
    writeFileSync(htmlPath, html, 'utf8');

    let child = null;
    let cdp = null;
    try {
      child = spawn(this.chromePath, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--window-size=1200,1600',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      const spawnErrorP = new Promise((_, reject) => child.on('error', reject));

      const port = await Promise.race([waitForDevToolsPort(userDataDir, timeoutMs), spawnErrorP]);
      const tab = await cdpHttpJson(port, '/json/new', 'PUT');
      cdp = new CDP(tab.webSocketDebuggerUrl);
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');

      const loadP = new Promise((res) => cdp.on('Page.loadEventFired', res));
      await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href });
      await Promise.race([
        loadP,
        sleep(timeoutMs).then(() => { throw new Error(`Page.loadEventFired 타임아웃(${timeoutMs}ms).\n${stderr.slice(-800)}`); }),
      ]);

      const gateExpr = `(${gateInPage.toString()})()`;
      const gateRes = await cdp.send('Runtime.evaluate', { expression: gateExpr, awaitPromise: true, returnByValue: true });
      if (gateRes.exceptionDetails) {
        throw new Error(`측정 게이팅 실패: ${gateRes.exceptionDetails.text || JSON.stringify(gateRes.exceptionDetails)}`);
      }
      const gating = gateRes.result.value;

      const measureExpr = `(${measureInPage.toString()})()`;
      const measureRes = await cdp.send('Runtime.evaluate', { expression: measureExpr, returnByValue: true });
      if (measureRes.exceptionDetails) {
        throw new Error(`개체 측정 실패: ${measureRes.exceptionDetails.text || JSON.stringify(measureRes.exceptionDetails)}`);
      }

      return { heights: measureRes.result.value, gating };
    } finally {
      if (cdp) cdp.close();
      // child.kill() 은 신호만 보낼 뿐 프로세스 종료를 기다리지 않는다 — 바로 rm() 하면 Windows 에서
      // Chrome 이 아직 놓지 않은 프로필 파일 잠금과 경합해 정리가 조용히 실패하고 wsg-paginate-*
      // 임시 프로필이 누적된다(MEMORY: render-temp-disk-exhaustion 실제 재현·수정). exit 이벤트를
      // 기다린 뒤(안전망 타임아웃 포함) rm 을 재시도(maxRetries)까지 적용해 확실히 정리한다.
      await killAndWaitExit(child);
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    }
  }
}

/** child.kill(SIGKILL) 후 실제 프로세스 종료(exit 이벤트)까지 대기(타임아웃 시 포기하고 진행). */
function killAndWaitExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolvePromise(); } };
    child.once('exit', finish);
    try { child.kill('SIGKILL'); } catch { finish(); }
    setTimeout(finish, timeoutMs);
  });
}
