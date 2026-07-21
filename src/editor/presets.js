// presets(클라이언트) — "내 블록으로 저장"·라이브러리 삽입·안전 미리보기(§3.2·E4).
// 검수 체인과 같은 원시(stripElementsByClass)를 재사용해 미리보기 기본값을
// 물리 제거본으로 렌더한다(§3.1 사각지대 봉합). 미리보기는 sandbox iframe —
// 프리셋 html 의 스크립트/핸들러는 실행되지 않는다(자기-XSS 방지).
import { ANSWER_CLASSES } from '/src/usecases/BuildVariants.js';
import { stripElementsByClass } from '/src/usecases/html-scan.js';

/**
 * 커서가 위치한 .wg-block 을 프리셋 페이로드로 추출한다.
 * 최소 정제 원칙(§3.2 "아무거나" 자유 보존): 편집 아티팩트 3종만 제거 —
 * data-wg-mark(세션 태깅)·contenteditable·빈 style="".
 */
/** 커서가 위치한 .wg-block(공유 헬퍼 — 프리셋·AI 액션이 함께 사용). */
export function cursorBlock(doc) {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return node?.closest?.('.wg-block') ?? null;
}

/**
 * 블록 편집 아티팩트 최소 정제(공유): data-wg-mark(세션 마크 태깅)·data-ai-req(AI
 * 대기 마커)·contenteditable·빈 style="" 만 제거 — §3.2 "아무거나" 자유 보존.
 */
export function cleanBlockHtml(block) {
  const clone = block.cloneNode(true);
  for (const el of clone.querySelectorAll('[data-wg-mark]')) el.removeAttribute('data-wg-mark');
  for (const el of clone.querySelectorAll('[data-ai-req]')) el.removeAttribute('data-ai-req');
  for (const el of clone.querySelectorAll('[contenteditable]')) el.removeAttribute('contenteditable');
  for (const el of clone.querySelectorAll('[style=""]')) el.removeAttribute('style');
  return clone.innerHTML;
}

export function extractPresetFromSelection(doc) {
  const block = cursorBlock(doc);
  if (!block) return null;
  return { type: block.dataset.bt || 'content', html: cleanBlockHtml(block) };
}

/** 커서 블록 뒤에 프리셋을 새 wg-block 으로 삽입(없으면 첫 시트 말미) — 역동기화 경로가 그대로 픽업. */
export function insertPreset(doc, preset) {
  const sel = doc.getSelection();
  let anchor = null;
  if (sel && sel.rangeCount > 0) {
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    anchor = node?.closest?.('.wg-block') ?? null;
  }
  const wrapper = doc.createElement('div');
  wrapper.className = 'wg-block';
  wrapper.dataset.bt = preset.type || 'content';
  wrapper.innerHTML = preset.html;
  if (anchor) {
    anchor.after(wrapper);
  } else {
    const sheet = doc.querySelector('.sheet');
    if (!sheet) return null;
    const foot = sheet.querySelector('.run-foot');
    if (foot) sheet.insertBefore(wrapper, foot);
    else sheet.appendChild(wrapper);
  }
  return wrapper;
}

/**
 * 프리셋 미리보기 srcdoc. 기본(showAnswer=false)은 물리 제거본(§3.1) —
 * "정답 보기" 토글 시에만 원본. styles 는 조립본의 <style> 원문(실제 블록 CSS).
 */
export function previewSrcdoc(preset, { showAnswer = false, styles = '' } = {}) {
  const html = showAnswer ? preset.html : stripElementsByClass(preset.html, ANSWER_CLASSES);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style>
<style>html,body{margin:0;padding:6px;background:#fff;overflow:hidden}</style></head>
<body data-mode="teacher">${html}</body></html>`;
}
