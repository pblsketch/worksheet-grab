// ai(클라이언트) — 구독 AI 브리지(E5)의 에디터 측. 무API: 여기엔 LLM 호출이 없다 —
// 서버 파일 큐에 요청을 넣고 폴링으로 응답을 받을 뿐이며, 실제 재작성은 별도
// 프로세스의 구독 AI 세션(`worksheet-grab ai pending --watch`)이 수행한다.
import { cursorBlock, cleanBlockHtml } from '/editor/presets.js';

/**
 * 커서 블록으로 AI 요청을 발신하고 대상 요소에 data-ai-req 마커를 스탬프한다.
 * excluded: 타입 가드의 클라이언트 층(§7·§10 — 서버가 재검증).
 * @returns {Promise<{id:string, block:Element}|{error:string}>}
 */
export async function requestAiAction(doc, { action, instruction = '', context = {}, excluded = [] }) {
  const block = cursorBlock(doc);
  if (!block) return { error: 'AI 액션을 적용할 블록 안에 커서를 두세요.' };
  const bt = block.dataset.bt || 'content';
  if (excluded.includes(bt)) {
    return { error: `"${bt}" 블록은 AI 대상이 아닙니다 — 성취기준 원문·저작권 지문은 보존됩니다.` };
  }
  if (block.hasAttribute('data-ai-req')) {
    return { error: '이 블록에는 이미 대기 중인 AI 요청이 있습니다(블록당 1개).' };
  }
  const res = await fetch('/ai/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      instruction,
      context,
      block: { bp: block.dataset.bp ?? null, bi: block.dataset.bi ?? null, bt, html: cleanBlockHtml(block) },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error || `요청 실패 (HTTP ${res.status})` };
  }
  const { id } = await res.json();
  block.setAttribute('data-ai-req', id);
  return { id, block };
}

/**
 * 응답 폴링: 1초 간격 → 30초 후 3초 백오프 → 총 5분에 대기 중단(요청은 큐에 잔존 —
 * 재개 가능). handle.stop() 으로 언제든 중단.
 * @returns {{promise:Promise<{status:string, html?:string}>, stop:()=>void}}
 */
export function pollResponse(id) {
  let stopped = false;
  const promise = (async () => {
    const startedAt = Date.now();
    while (!stopped) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 5 * 60 * 1000) return { status: 'timeout' };
      const res = await fetch(`/ai/${encodeURIComponent(id)}`);
      if (res.status === 404) return { status: 'gone' };
      const body = await res.json();
      if (body.status === 'answered') return { status: 'answered', html: body.response.html };
      if (body.status === 'cancelled') return { status: 'cancelled' };
      await new Promise((r) => setTimeout(r, elapsed > 30 * 1000 ? 3000 : 1000));
    }
    return { status: 'stopped' };
  })();
  return { promise, stop: () => { stopped = true; } };
}

/**
 * AI 응답 정제(DOMParser DOM 순회 — 정규식 아님): 캔버스는 스크립트 실행 컨텍스트라
 * script 노드·on* 핸들러·javascript: URL 을 제거한다. 미리보기 sandbox·저장 게이트와
 * 함께 심층 방어.
 */
export function sanitizeAiHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const s of doc.querySelectorAll('script')) s.remove();
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

/**
 * 응답 적용(가역): 마커 요소를 찾아 정제본으로 교체하고 마커를 제거한다.
 * 반환된 snapshot 으로 undoAiApply 가 1단계 복원한다(저장 전까지 유효).
 */
export function applyAiResponse(doc, id, html) {
  const target = doc.querySelector(`[data-ai-req="${CSS.escape(id)}"]`);
  if (!target) return null;
  const snapshot = target.innerHTML;
  target.innerHTML = sanitizeAiHtml(html);
  target.removeAttribute('data-ai-req');
  return { target, snapshot };
}

export function undoAiApply(applied) {
  if (!applied?.target) return false;
  applied.target.innerHTML = applied.snapshot;
  return true;
}

/** 취소/실패 시 마커 회수(다음 요청 차단 해제). */
export function clearAiMarker(doc, id) {
  const target = doc.querySelector(`[data-ai-req="${CSS.escape(id)}"]`);
  target?.removeAttribute('data-ai-req');
}
