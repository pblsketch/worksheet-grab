import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
