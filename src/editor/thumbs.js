// thumbs — 좌측 페이지 썸네일(§3.1 항목 1)이 쓰는 문서 스타일 수집기.
//
// 썸네일은 sandbox iframe(srcdoc = 문서의 <style> 원문 + 해당 .sheet)을 CSS transform 으로
// 축소해 그린다(leftPanel.js). 프리셋 미리보기와 같은 방식이라 별도 렌더 엔진이 필요 없고
// (의존성 0), 실제 블록 CSS 로 그려지므로 캔버스와 어긋나지 않는다.

/** 문서 <style> 원문 전부(에디터 주입분 포함) — 캔버스와 같은 그림이 나오도록. */
export function collectStyles(doc) {
  return [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
}
