import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Renderer } from '../usecases/ports.js';

// ChromeRenderer — Renderer 포트의 Chrome 헤드리스 구현.
// HANDOFF 6장 플래그: --headless=new --disable-gpu --no-sandbox
//   --print-to-pdf-no-header --virtual-time-budget=15000
// virtual-time-budget 이 짧으면 Pretendard 웹폰트·KaTeX·SVG 가 깨진다.

const WINDOWS_CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

export function resolveChromePath(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    process.env.WORKSHEET_GRAB_CHROME,
    ...WINDOWS_CHROME_CANDIDATES,
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    'Chrome 실행 파일을 찾을 수 없습니다. CHROME_PATH 환경변수로 지정하세요. ' +
    `(HANDOFF 6장 기본 경로: ${WINDOWS_CHROME_CANDIDATES[0]})`,
  );
}

export class ChromeRenderer extends Renderer {
  constructor({ chromePath = null } = {}) {
    super();
    this.chromePath = resolveChromePath(chromePath);
  }

  /**
   * @param {string} inputPath 입력 HTML 경로
   * @param {string} outputPath 출력 PDF 경로
   * @param {{virtualTimeBudget?:number, timeoutMs?:number}} options
   */
  async renderToPdf(inputPath, outputPath, options = {}) {
    const virtualTimeBudget = options.virtualTimeBudget ?? 15000;
    const absIn = resolve(inputPath);
    const absOut = resolve(outputPath);
    if (!existsSync(absIn)) throw new Error(`입력 HTML 이 없습니다: ${absIn}`);
    const args = [
      ...this.#commonArgs(),
      '--print-to-pdf-no-header',
      `--virtual-time-budget=${virtualTimeBudget}`,
      `--print-to-pdf=${absOut}`,
      pathToFileURL(absIn).href,
    ];
    await this.#spawnChrome(args, absIn, absOut, options.timeoutMs ?? 60000, 'PDF');
    return { outputPath: absOut };
  }

  /**
   * HTML → PNG(첫 A4 뷰포트 미리보기·카드). Chrome --screenshot 사용.
   * @param {string} inputPath 입력 HTML 경로
   * @param {string} outputPath 출력 PNG 경로
   * @param {{virtualTimeBudget?:number, timeoutMs?:number, width?:number, height?:number, scale?:number}} options
   */
  async renderToPng(inputPath, outputPath, options = {}) {
    const virtualTimeBudget = options.virtualTimeBudget ?? 15000;
    const width = options.width ?? 794;    // A4 폭 @96dpi
    const height = options.height ?? 1123;  // A4 높이 @96dpi
    const scale = options.scale ?? 2;       // 선명도(레티나)
    const absIn = resolve(inputPath);
    const absOut = resolve(outputPath);
    if (!existsSync(absIn)) throw new Error(`입력 HTML 이 없습니다: ${absIn}`);
    const args = [
      ...this.#commonArgs(),
      '--hide-scrollbars',
      `--force-device-scale-factor=${scale}`,
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${virtualTimeBudget}`,
      `--screenshot=${absOut}`,
      pathToFileURL(absIn).href,
    ];
    await this.#spawnChrome(args, absIn, absOut, options.timeoutMs ?? 60000, 'PNG');
    return { outputPath: absOut };
  }

  #commonArgs() {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-chrome-'));
    return [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
    ];
  }

  #spawnChrome(args, absIn, absOut, timeoutMs, kind) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(this.chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectPromise(new Error(`Chrome 렌더 타임아웃(${timeoutMs}ms): ${absIn}`));
      }, timeoutMs);
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => { clearTimeout(timer); rejectPromise(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (!existsSync(absOut)) {
          rejectPromise(new Error(`${kind} 가 생성되지 않았습니다(code=${code}).\n${stderr.slice(-800)}`));
          return;
        }
        resolvePromise();
      });
    });
  }
}
