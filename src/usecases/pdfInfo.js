// pdfInfo — PDF 물리 쪽수 카운터(순수·의존성 0, Chrome 무지). test/helpers/pdf.js:6
// countPdfPages 와 동일 로직의 런타임 유틸이다. 그 파일은 기존 테스트 불변 원칙으로
// 무수정 대상이라 여기 신규로 이관한다. 페이지 미리보기 오버플로 감지(§2e)뿐 아니라
// 후속 WorkbookExport(§2a) 도 이 유틸을 재사용한다.
//
// 우선순위: 페이지 트리 /Count N(최댓값) 을 신뢰하고, 없으면 "/Type /Page"
// (뒤에 s 가 오지 않는 것만, /Pages 오검출 방지) 를 센다.

import { readFile } from 'node:fs/promises';

/**
 * @param {Buffer|string} bufferOrPath PDF 바이트(Buffer) 또는 파일 경로(string)
 * @returns {Promise<number>} 물리 쪽수
 */
export async function countPdfPages(bufferOrPath) {
  const buf = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : await readFile(bufferOrPath);
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
