// ai(클라이언트) — 구독 AI 브리지(E5)의 에디터 측. 무API: 여기엔 LLM 호출이 없다 —
// 서버 파일 큐에 요청을 넣고 폴링으로 응답을 받을 뿐이며, 실제 재작성은 별도
// 프로세스의 구독 AI 세션(`worksheet-grab ai pending --watch`)이 수행한다.
import { cursorBlock, cleanBlockHtml } from '/editor/presets.js';

/**
 * 현재 Selection 과 교차하는 .wg-block 집합을 문서 순서로 수집한다(F4 범위 선택).
 * selection 이 없거나 collapsed 면 cursorBlock 폴백(집합 크기 1) — 단일 선택 하위호환.
 * @returns {Element[]}
 */
export function selectedBlocks(doc) {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    const b = cursorBlock(doc);
    return b ? [b] : [];
  }
  const all = [...doc.querySelectorAll('.wg-block')];
  const out = [];
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    for (const block of all) {
      if (!out.includes(block) && range.intersectsNode(block)) out.push(block);
    }
  }
  // 여러 Range 병합 시 문서 순서로 정렬.
  out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return out;
}

/**
 * 선택 집합으로 AI 요청을 발신하고 각 블록에 슬롯 마커 data-ai-req="<id>#<k>" 를 스탬프한다.
 * excluded: 타입 가드의 클라이언트 층(§7·§10 — 서버가 재검증). 집합 중 하나라도 제외 타입이면
 * 전체 거부한다(부분 요청 금지). 요청 페이로드는 v2(blocks[]).
 * @returns {Promise<{id:string, blocks:Element[]}|{error:string}>}
 */
export async function requestAiAction(doc, { action, instruction = '', context = {}, excluded = [] }) {
  const blocks = selectedBlocks(doc);
  if (blocks.length === 0) return { error: 'AI 액션을 적용할 블록을 선택하거나 커서를 두세요.' };
  const badBlock = blocks.find((b) => excluded.includes(b.dataset.bt || 'content'));
  if (badBlock) {
    return { error: `"${badBlock.dataset.bt}" 블록이 선택에 포함됨 — 성취기준 원문·저작권 지문은 AI 대상이 아닙니다(선택 전체 취소).` };
  }
  if (blocks.some((b) => b.hasAttribute('data-ai-req'))) {
    return { error: '선택에 이미 대기 중인 AI 요청 블록이 있습니다(블록당 1개).' };
  }
  const res = await fetch('/ai/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      instruction,
      context,
      blocks: blocks.map((b, k) => ({
        slot: k, // 배열 인덱스 = 마커 <id>#k = 응답 매칭 슬롯(명시 저장으로 응답이 그대로 에코)
        bp: b.dataset.bp ?? null, bi: b.dataset.bi ?? null, bt: b.dataset.bt || 'content', html: cleanBlockHtml(b),
      })),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error || `요청 실패 (HTTP ${res.status})` };
  }
  const { id } = await res.json();
  // 슬롯 마커: 위치가 바뀌어도 재부착이 정확하도록 bp/bi 가 아니라 <id>#<슬롯>으로 묶는다.
  blocks.forEach((b, k) => b.setAttribute('data-ai-req', `${id}#${k}`));
  return { id, blocks };
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
      try {
        const res = await fetch(`/ai/${encodeURIComponent(id)}`);
        if (res.status === 404) return { status: 'gone' };
        const body = await res.json();
        // response 는 v1({html}) 또는 v2({blocks[]}) — 둘 다 그대로 전달하고 apply 가 정규화한다.
        // html 은 v1 하위호환 편의 필드(있으면).
        if (body.status === 'answered') return { status: 'answered', response: body.response, html: body.response?.html };
        if (body.status === 'cancelled') return { status: 'cancelled' };
      } catch {
        // 일시적 네트워크/서버 오류는 타임아웃 창 안에서 재시도 — 폴링 promise 가
        // reject 로 죽으면 에디터 대기 UI 가 고착되므로 여기서 삼킨다.
      }
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
 * 응답을 슬롯 목록 [{slot, html}] 로 정규화한다.
 * v2 {blocks:[{slot,html}]} · v1 {html}(→슬롯0) · 레거시 문자열(→슬롯0) 모두 수용.
 */
export function normalizeResponseSlots(response) {
  if (typeof response === 'string') return [{ slot: 0, html: response }];
  if (response && Array.isArray(response.blocks)) {
    return response.blocks.map((b) => ({ slot: b.slot, html: b.html }));
  }
  if (response && typeof response.html === 'string') return [{ slot: 0, html: response.html }];
  return [];
}

/** 슬롯 마커 대상 조회: <id>#<slot>. 슬롯0은 레거시 평문 <id> 마커도 폴백 허용(v1 하위호환). */
function findSlotTarget(doc, id, slot) {
  return doc.querySelector(`[data-ai-req="${CSS.escape(`${id}#${slot}`)}"]`)
    || (slot === 0 ? doc.querySelector(`[data-ai-req="${CSS.escape(id)}"]`) : null);
}

/** diff 미리보기용 결합 뷰(슬롯별 before=현재 innerHTML, after=응답 html). apply 와 같은 슬롯 규칙 재사용. */
export function aiDiffView(doc, id, response) {
  const slots = normalizeResponseSlots(response);
  const sep = '\n<hr class="ai-diff-sep">\n';
  const before = slots.map((s) => { const t = findSlotTarget(doc, id, s.slot); return t ? t.innerHTML : ''; }).join(sep);
  const after = slots.map((s) => s.html).join(sep);
  return { before, after, count: slots.length };
}

/**
 * 응답 적용(가역): 슬롯별 마커 요소를 찾아 정제본으로 교체하고 마커를 제거한다.
 * **위치(bp/bi) 매칭 금지** — 반드시 슬롯 마커(<id>#<k>)로만 재부착한다(대기 중 순서/삽입이
 * 바뀌어도 정확). 대상 소실 슬롯은 skip(경고 카운트). 전 슬롯 소실이면 null.
 * 반환 snapshots[] 로 undoAiApply 가 전체 복원한다(저장 전까지 유효).
 */
export function applyAiResponse(doc, id, response) {
  const slots = normalizeResponseSlots(response);
  if (slots.length === 0) return null; // 빈/비정상 응답(슬롯 없음)
  const snapshots = [];
  let missing = 0;
  for (const { slot, html } of slots) {
    const target = typeof html === 'string' ? findSlotTarget(doc, id, slot) : null;
    if (!target) { missing++; continue; }
    snapshots.push({ target, snapshot: target.innerHTML });
    target.innerHTML = sanitizeAiHtml(html);
    target.removeAttribute('data-ai-req');
  }
  // 전 슬롯 소실이어도 null 대신 사실을 반환한다(applied:0). 호출부가 요청을 terminal 로 정리해
  // pending/응답 스테일을 막는다(대상 블록이 대기 중 모두 삭제된 경우).
  return { snapshots, missing, applied: snapshots.length };
}

export function undoAiApply(applied) {
  if (!applied?.snapshots?.length) return false;
  for (const { target, snapshot } of applied.snapshots) target.innerHTML = snapshot;
  return true;
}

/** 취소/실패 시 마커 회수(다음 요청 차단 해제). 슬롯 마커(<id>#<k>)·레거시 평문 <id> 모두. */
export function clearAiMarker(doc, id) {
  for (const el of doc.querySelectorAll('[data-ai-req]')) {
    const v = el.getAttribute('data-ai-req');
    if (v === id || v.startsWith(`${id}#`)) el.removeAttribute('data-ai-req');
  }
}
