import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sweepStaleWsgTmp } from './tmp.js';

// US-20 §산출 2: 이 파일은 사실상 모든 렌더 테스트가 import 하므로(chromeAvailable 게이트),
// 여기서 모듈 로드 시 1회 60분+ 잔존 wsg-* 임시 디렉터리를 청소한다(공용 훅 — 개별 파일마다
// 정리 로직을 반복하지 않는다). 접두사 한정이라 다른 프로세스의 무관한 임시파일은 건드리지 않는다.
sweepStaleWsgTmp();

// PDF 페이지 수 카운터(의존성 없음). Chrome print-to-pdf 산출물의 페이지 객체를 센다.
// 우선 페이지 트리 /Count N 을 신뢰하고, 없으면 "/Type /Page" (단, /Pages 제외) 를 센다.
export async function countPdfPages(pdfPath) {
  if (!existsSync(pdfPath)) throw new Error(`PDF 가 없습니다: ${pdfPath}`);
  const buf = await readFile(pdfPath);
  const s = buf.toString('latin1');

  // /Type /Pages ... /Count N (루트 페이지 트리)
  const countMatches = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10));
  if (countMatches.length > 0) {
    return Math.max(...countMatches);
  }

  // 폴백: /Type /Page (뒤에 s 가 오지 않는 것만)
  const pageMatches = s.match(/\/Type\s*\/Page(?![s])/g) || [];
  return pageMatches.length;
}

// PDF 첫 페이지 치수(pt). Chrome print-to-pdf 산출물의 /MediaBox [x0 y0 x1 y1] 를 파싱한다.
// countPdfPages 와 동일 스타일(바이트→latin1→정규식, 의존성 0).
export async function pdfPageSizePt(pdfPath) {
  if (!existsSync(pdfPath)) throw new Error(`PDF 가 없습니다: ${pdfPath}`);
  const buf = await readFile(pdfPath);
  const s = buf.toString('latin1');
  const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  if (!m) throw new Error(`/MediaBox 를 찾지 못했습니다: ${pdfPath}`);
  return { w: parseFloat(m[3]) - parseFloat(m[1]), h: parseFloat(m[4]) - parseFloat(m[2]) };
}

/** Chrome 사용 가능 여부(렌더 테스트 게이트). */
export function chromeAvailable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.WORKSHEET_GRAB_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  return candidates.some((c) => existsSync(c));
}
