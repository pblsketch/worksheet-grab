// ai.js — editor-v4 S4.4(US-19) AI UX 전면 재작성. 무API(§3.5): 여기엔 LLM 호출이 없다 — 요청은
// 서버 파일 큐(POST /ai/requests, v3 objects)에 기록되고, 별도 프로세스의 구독 AI 세션이
// `worksheet-grab ai pending`/`ai respond --objects` 로 읽고 응답할 뿐이다.
//
// 개체 우선(F4) 계약: 요청 objects:[{id,type,…현재 개체 필드}] · 응답 objects:[{id,object}](개체 ID
// 에코). std-box(AI_EXCLUDED_TYPES, 원칙 3 — 성취기준 창작 금지)만 클라이언트 가드로 요청을 아예
// 만들지 않는다(서버 400 은 심층 방어의 2번째 층). passage-slot 은 3층 정책(2026-07-23 2차 델타)으로
// AI 가드에서 해제됐다 — 교사가 명시적으로 요청하면 이 AI 경로로 지문을 창작하거나(순수 창작) 교사가
// 이미 입력한 지문(bodyHtml)을 재구성·수준 조정·요약할 수 있다. 다만 실존 저작물의 원문을 그대로
// 재현하는 것은 여전히 금지된다(프롬프트 계약 수준 — composeView 의 지문 전용 프리셋과 buildCopyText
// 지시문에 이 제약을 명시한다). 교사의 직접 타이핑 편집(AI 미경유)은 여전히 selection.js/inspector.js
// 소관이다.
//
// Phase 4(v4): 응답은 1:1 에코가 아니라 **개수·종류가 자유로운 계획**(ops:[{op:'replace'|'insert'|
// 'delete'}])으로도 올 수 있다 — "문항 3개를 활동 1개로 합치기"·"표 1개를 표+설명문으로 나누기"를
// 그대로 표현한다. 미리보기는 그 계획을 수정/신규/삭제로 나눠 보여주고(삭제는 before 만·신규는
// after 만), 적용은 objectFactory.applyAiOps 로 만든 단일 next 문서를 applyDocOp 에 **한 번만**
// 넘긴다(undo 1스텝). 요청에는 pageId·pageVersion·scope 를 함께 실어 (a) 선택 없이 페이지 전체를
// 대상으로 부를 수 있고 (b) 응답 적용 직전에 페이지가 그 사이 바뀌었는지 검사한다(fail-closed —
// 충돌이면 자동 적용하지 않는다). v1~v3 응답은 그대로 계속 동작한다(하위호환).
//
// preview-then-commit: 응답이 도착해도 원본을 즉시 덮지 않는다 — 원본/AI 결과를 나란히 렌더(카드) +
// 단어 단위 인라인 diff(추가=초록·삭제=취소선 빨강, 자체 LCS)로 미리보기를 띄우고, 사용자가
// 교체/아래 삽입/재생성(버전 화살표로 왕복)/취소 중 하나를 고른다. 적용은 editor.js 의 applyDocOp
// 를 그대로 거쳐 history 1 op 로 확정된다(undo 1스텝 복원).
//
// 진입점(모두 같은 패널을 연다): 앱 바 AI 버튼(#ai-entry-slot) · 우클릭 메뉴 · 슬래시 메뉴(/ai) ·
// 컨텍스트 툴바 공통 버튼 — editor.js 가 각 모듈에 onAiOpen 콜백으로 이 패널의 openFor()를 배선한다.
//
// B1(프래그먼트 저작 진입, ADR-bspike-ai-fragment.md): 위 rewrite 진입과 별개로 "새 섹션 AI 저작"
// 진입이 있다 — 앱 바 ＋섹션 버튼(#btn-ai-author) · 우클릭/슬래시 "새 섹션 AI 저작". 이들은
// openFor(ids, {intent:'author-section'}) 로 열려, 기존 개체를 고치지 않고 제약 AI 가 저작한 섹션을
// 교사가 정한 앵커 위치(computeAuthorAnchor)에 삽입한다. 응답측 파이프라인(buildFragmentVersion→
// prepareAiFragment→buildOpsVersion)은 그대로 재사용한다(진입만 추가).

import { RenderObjectTree } from '/src/usecases/RenderObjectTree.js';
import { QUESTION_TYPES, computePageVersion, validateObjectShape } from '/src/domain/schema/index.js';
import { QTYPE_LABELS } from './objectFactory.js';
import { pageScopeTargets } from '/editor/pageScope.js';
import { enforceAiLayout } from '/editor/aiLayoutGuard.js';
import { prepareAiFragment } from '/src/usecases/applyAiFragment.js';
import { computeAuthorAnchor } from '/editor/authorAnchor.js';

const renderer = new RenderObjectTree();
const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 대기 총 상한(무API 특성상 사람이 응답 — 옛 ai.js 관례와 동일)

// ── DOM 빌더(inspector.js 의 el() 관례와 동형) ──
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function cssEscape(id) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
  return String(id).replace(/["\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ══════════════════════════ 순수 유틸: 단어 단위 diff(외부 라이브러리 금지, 자체 LCS) ══════════════════════════

/** 공백 경계로 토큰화(구분자도 토큰으로 보존 — 재조립 시 원문 공백을 잃지 않는다). */
export function tokenize(text) {
  return String(text || '').split(/(\s+)/).filter((t) => t.length > 0);
}

function mergeRuns(tokens) {
  const merged = [];
  for (const t of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === t.type) last.text += t.text;
    else merged.push({ ...t });
  }
  return merged;
}

/**
 * 고전 LCS 기반 단어 단위 diff(O(n·m), 활동지 개체 텍스트 규모에서 충분히 빠르다). 토큰 수가
 * 지나치게 크면(붙여넣기 사고 등) DP 비용 폭증을 피해 전체 교체로 폴백한다.
 * @returns {Array<{type:'equal'|'add'|'del', text:string}>}
 */
export function wordDiff(beforeText, afterText) {
  const a = tokenize(beforeText);
  const b = tokenize(afterText);
  const n = a.length;
  const m = b.length;
  if (n * m > 400000) {
    const out = [];
    if (a.length) out.push({ type: 'del', text: a.join('') });
    if (b.length) out.push({ type: 'add', text: b.join('') });
    return out;
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'equal', text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i += 1; }
    else { out.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i += 1; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j += 1; }
  return mergeRuns(out);
}

/** diff 결과를 인라인 HTML 로: 추가=<ins>(초록, CSS), 삭제=<del>(취소선 빨강, CSS). */
export function diffToHtml(beforeText, afterText) {
  const tokens = wordDiff(beforeText, afterText);
  return tokens.map((t) => {
    const safe = escapeHtml(t.text);
    if (t.type === 'add') return `<ins class="ai-diff-add">${safe}</ins>`;
    if (t.type === 'del') return `<del class="ai-diff-del">${safe}</del>`;
    return safe;
  }).join('');
}

// ══════════════════════════ 개체 → 비교용 텍스트/미리보기 HTML ══════════════════════════

function stripToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

/** diff 비교용 텍스트 추출 — 타입별 의미 있는 필드만 선형화한다(카탈로그 10종). */
export function objectDisplayText(obj) {
  if (!obj) return '';
  switch (obj.type) {
    case 'title': return obj.text || '';
    case 'question': {
      const parts = [obj.prompt || ''];
      if (Array.isArray(obj.choices) && obj.choices.length) parts.push(obj.choices.join(' / '));
      if (Array.isArray(obj.items) && obj.items.length) parts.push(obj.items.join(' / '));
      if (Array.isArray(obj.left) || Array.isArray(obj.right)) parts.push([...(obj.left || []), ...(obj.right || [])].join(' / '));
      if (Array.isArray(obj.blanks) && obj.blanks.length) parts.push(obj.blanks.join(' / '));
      return parts.filter(Boolean).join('\n');
    }
    case 'table': return (obj.rows || []).map((row) => (row || []).map((c) => c?.text ?? '').join(' | ')).join('\n');
    case 'richtext': return stripToText(obj.html);
    case 'answer-area': return obj.label || '';
    case 'image-slot': return [obj.caption, obj.alt].filter(Boolean).join(' — ');
    case 'passage-slot': return [obj.title, stripToText(obj.bodyHtml), obj.source].filter(Boolean).join('\n');
    // callout(M4): 머리(title 평문 > titleHtml 정제) + 본문(body 정제). 없으면 AI diff 가 빈칸이 된다.
    case 'callout': return [obj.title || stripToText(obj.titleHtml), stripToText(obj.body)].filter(Boolean).join('\n');
    default: return '';
  }
}

/** RenderObjectTree 단일 개체 렌더 재사용 — obj 하나만 담은 최소 문서를 만들어 그 렌더 결과의
 *  .sheet 내부만 뽑아낸다(전체 문서 조립 로직을 새로 짜지 않고 그대로 재사용). */
export function renderObjectFragment(obj, renderMeta = {}) {
  if (!obj) return '';
  try {
    const doc = { pagination: 'scaffold', pages: [{ id: 'page-ai-preview', flow: [obj], float: [] }] };
    const { html } = renderer.execute(doc, { paperCss: '', blocksCss: '', themeCss: '' }, renderMeta, { editMode: false });
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const sheet = parsed.querySelector('.sheet');
    return sheet ? sheet.innerHTML : escapeHtml(objectDisplayText(obj));
  } catch (e) {
    return `<div class="ai-preview-error">미리보기 실패: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

/** AI 응답 HTML 필드 정제(DOMParser DOM 순회 — 정규식 아님): script 제거·on* 핸들러 제거·
 *  javascript: URL 제거. 옛 ai.js 의 XSS 방어를 그대로 승계(캔버스는 스크립트 실행 컨텍스트). */
export function sanitizeAiHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  for (const s of doc.querySelectorAll('script')) s.remove();
  for (const node of doc.body.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

/** 응답 개체의 html 계열 필드만 정제한 사본(원본은 불변). bodyHtml(passage-slot, 3층 정책 2026-07-23
 *  2차 델타로 AI 가 채울 수 있게 됨)도 richtext.html·answerKey.html 과 동일하게 정제 대상이다. */
export function sanitizeObject(obj) {
  const clone = structuredClone(obj);
  if (typeof clone.html === 'string') clone.html = sanitizeAiHtml(clone.html);
  if (typeof clone.bodyHtml === 'string') clone.bodyHtml = sanitizeAiHtml(clone.bodyHtml);
  // callout(M4)의 body·titleHtml 도 살균 대상 — 렌더러가 이스케이프 없이 방출하므로(RenderObjectTree
  // renderCallout: "입력에서 살균, 렌더는 raw") AI 가 여기 <script>/on* 을 실으면 캔버스에서 실행된다.
  if (typeof clone.body === 'string') clone.body = sanitizeAiHtml(clone.body);
  if (typeof clone.titleHtml === 'string') clone.titleHtml = sanitizeAiHtml(clone.titleHtml);
  // title.textHtml·question.promptHtml(인라인 서식 보존 HTML)도 정제 대상(richtext.html 과 동형).
  if (typeof clone.textHtml === 'string') clone.textHtml = sanitizeAiHtml(clone.textHtml);
  if (typeof clone.promptHtml === 'string') clone.promptHtml = sanitizeAiHtml(clone.promptHtml);
  if (clone.answerKey && typeof clone.answerKey.html === 'string') {
    clone.answerKey = { ...clone.answerKey, html: sanitizeAiHtml(clone.answerKey.html) };
  }
  return clone;
}

/**
 * AI 산출 개체 → 적용 안전 사본. **모든 AI 적용 경로의 단일 관문**(replace/insert/insert-section/echo).
 * 두 방어를 겹친다: (1) sanitizeObject 로 HTML 필드 XSS 정제, (2) enforceAiLayout 로 레이아웃 필드
 * 불변식 강제(AI 가 실은 크기·정렬·불투명도·회전은 버리고, 치환이면 교사 값 보존 — aiLayoutGuard.js).
 * before 는 치환 대상 개체(신규 생성은 null).
 */
export function sanitizeAiObject(obj, before = null) {
  return enforceAiLayout(sanitizeObject(obj), before);
}

/**
 * 신규 저작 개체(insert/insert-section)의 **구조 게이트**(B4). --ops 경로는 applyAiOps 가 개체 스키마를
 * 검증하지 않으므로(ADR §10.1 잔여분), malformed v4 개체가 미리보기·적용까지 새어 들어갈 수 있었다.
 * 프래그먼트 경로의 구조 floor(prepareAiFragment→validateObjectShape)와 같은 방어를 --ops 신규 개체에도 건다.
 *
 * 게이트는 **buildOpsVersion 에만** 둔다 — applyAiOps 에 걸면 placement 없는 최소 개체를 넘기는 기존 유닛
 * (editor-ai-ops.test.js)이 대거 깨진다(HANDOFF-bprime-followups §B4 함정). replace(기존 개체 수정)는
 * 대상이 아니다 — 신규 저작분만 막는다. 삽입 개체는 flow 로 적용되므로 placement 를 flow 로 보아 검증한다
 * (AI 는 placement 를 저작하지 않으며, 프래그먼트 컴파일러가 flow 를 주입하는 것과 동형).
 * @returns {string|null} 문제 사유(있으면). 조용한 실패 금지 — 호출부가 problems 로 올려 적용을 막고 사유를 보인다.
 */
function newObjectShapeProblem(after) {
  const s = validateObjectShape({ ...after, placement: after?.placement || 'flow' });
  if (s.ok) return null;
  const first = s.findings?.[0]?.message || '구조가 올바르지 않습니다.';
  return `AI 가 만든 새 개체("${after?.type ?? '?'}")의 구조가 올바르지 않아 적용할 수 없습니다: ${first}`;
}

// ══════════════════════════ AI 패널 ══════════════════════════

/**
 * @param {{
 *   entryHost: HTMLElement,           // #ai-entry-slot — 앱 바 진입 버튼을 마운트
 *   getSelectionState: () => {selectedIds:Set<string>, editingId:string|null},
 *   getSelectedPageIds?: () => string[],  // M2 다중 페이지 grab — 앱바 진입 시 대상 페이지들

 *   findObject: (id:string) => {obj:object}|null,
 *   excludedTypes: Iterable<string>,  // shell.excludedAiTypes(std-box·passage-slot)
 *   getRenderMeta: () => object,      // reflow.js#buildRenderMeta(core.getDocument()) 재사용
 *   getDoc: () => Document|null,      // 현재 teacher iframe contentDocument(배지 DOM 조작용)
 *   getActivePageId: () => string|null,        // 현재 활성 페이지 ID(index 금지 — Phase 2 규약)
 *   getObjectDocument?: () => {pages?:object[]}|null,  // B1 저작 앵커: 빈 페이지 폴백(문서 마지막 flow 개체) 계산
 *   getPage: (pageId:string) => {id:string,flow?:object[],float?:object[]}|null,
 *   getPageIdOf: (objectId:string) => string|null,
 *   onApply: (
 *     {mode:'replace'|'insert', updates:Array<{id:string,object:object}>}
 *     | {mode:'ops', ops:Array<object>}
 *   ) => Promise<{ids?:string[], error?:string}>,
 * }} deps
 */
export function createAiPanel(deps) {
  const excludedSet = new Set(deps.excludedTypes || []);
  const freshIds = new Set();
  let state = null; // null = 닫힘

  const panelHost = document.createElement('div');
  panelHost.id = 'ai-panel-host';
  document.body.appendChild(panelHost);

  // US-P4-4: 선택이 없어도 활성 페이지 전체(scope:'page')를 대상으로 열 수 있다 — 진입점은
  // 제외 타입(std-box)이 **선택돼 있을 때만** 비활성이다(선택 0개는 더 이상 비활성 사유가 아니다).
  const entryBtn = el('button', {
    type: 'button', id: 'btn-ai', class: 'appbar-btn ai-entry-btn', title: 'AI 로 편집(선택 없으면 현재 페이지 전체)', text: 'AI',
  });
  entryBtn.addEventListener('click', () => {
    // M2: 개체 선택이 없고 썸네일에서 여러 페이지를 다중선택했으면 그 페이지들 전체를 대상으로 연다.
    const ids = [...(deps.getSelectionState().selectedIds || [])];
    const pageIds = ids.length === 0 ? (deps.getSelectedPageIds?.() || []) : [];
    openFor(ids, pageIds.length >= 2 ? { scope: 'page', pageIds } : {});
  });
  deps.entryHost.appendChild(entryBtn);

  // B1: "새 섹션 AI 저작" 진입(프래그먼트 저작). rewrite 와 달리 기존 개체를 고치지 않고 제약 AI 가
  // 저작한 새 섹션을 앵커 위치(선택 개체 뒤 or 페이지 말미)에 삽입한다 — std-box 선택에서도 활성이다
  // (그 개체를 고치는 게 아니라 그 뒤에 저작할 뿐이므로). 선택이 정확히 1개면 그 뒤, 아니면 페이지 말미.
  const authorBtn = el('button', {
    type: 'button', id: 'btn-ai-author', class: 'appbar-btn ai-entry-btn ai-author-btn',
    title: '새 섹션을 AI 로 저작(선택 개체 뒤 또는 현재 페이지 말미)', text: '＋섹션',
  });
  authorBtn.addEventListener('click', () => {
    const ids = [...(deps.getSelectionState().selectedIds || [])];
    openFor(ids.length === 1 ? ids : [], { intent: 'author-section' });
  });
  deps.entryHost.appendChild(authorBtn);

  // ── 대상 졸업 배지(data-ai-fresh) ──
  function markFresh(ids) {
    for (const id of ids || []) freshIds.add(id);
    refreshFreshBadges();
  }
  function clearFresh(id) {
    if (!id || !freshIds.has(id)) return;
    freshIds.delete(id);
    const doc = deps.getDoc?.();
    const target = doc?.querySelector(`[data-oid="${cssEscape(id)}"]`);
    if (target) target.removeAttribute('data-ai-fresh');
  }
  function clearAllFresh() { freshIds.clear(); }
  function refreshFreshBadges(doc) {
    const d = doc || deps.getDoc?.();
    if (!d) return;
    for (const node of d.querySelectorAll('[data-oid]')) {
      if (freshIds.has(node.dataset.oid)) node.setAttribute('data-ai-fresh', 'true');
      else node.removeAttribute('data-ai-fresh');
    }
  }

  function refreshEntryState(ids) {
    const list = ids || [...(deps.getSelectionState().selectedIds || [])];
    const hasExcluded = list.some((id) => excludedSet.has(deps.findObject(id)?.obj?.type));
    entryBtn.disabled = hasExcluded;
    entryBtn.dataset.aiGuardBlocked = String(hasExcluded);
  }

  // ── 서버 통신 ──
  async function markRequestApplied(id) {
    if (!id) return;
    try { await fetch(`/ai/${encodeURIComponent(id)}/applied`, { method: 'POST' }); } catch { /* 베스트에포트 */ }
  }
  async function cancelRequest(id) {
    if (!id) return;
    try { await fetch(`/ai/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); } catch { /* 베스트에포트 */ }
  }

  /** 대상에 passage-slot 이 하나라도 있으면(3층 정책, 2026-07-23 2차 델타) 실존 저작물 원문
   *  재현 금지 제약을 지시문 복사 텍스트에 명시한다 — 프롬프트 계약 수준의 강제선. */
  function hasPassageTarget() {
    return !!state && state.targets.some((t) => t.obj.type === 'passage-slot');
  }

  /** 앵커를 사람이 읽을 설명으로(compose 요약·copyText 공용). */
  function describeAnchor(anchor) {
    if (!anchor) return '(위치 미정)';
    if (anchor.afterId) {
      const obj = deps.findObject(anchor.afterId)?.obj;
      return obj ? `'${QTYPE_LABELS[obj.qtype] || obj.type}' 개체 뒤` : '선택 개체 뒤';
    }
    return '현재 페이지 말미(빈 페이지)';
  }

  /** B1 새 섹션 저작 요청의 구독 AI 지시문 — rewrite(--ops/--objects)와 달리 --fragment 로 회신하도록
   *  안내한다. 삽입 위치는 교사가 정했으므로(state.authorAnchor) 응답의 앵커는 무시된다. */
  function buildAuthorCopyText() {
    const ctxSummary = state.targets.length
      ? state.targets.map((t) => `${t.obj.type}(${t.id})`).join(', ')
      : '(없음 — 빈 페이지)';
    return [
      `[worksheet-grab AI 요청 — 새 섹션 저작] id=${state.currentRequestId}`,
      `삽입 위치: ${state.anchorLabel || describeAnchor(state.authorAnchor)} (배치는 교사가 정했습니다 — 이 위치에 삽입됩니다)`,
      `문맥 개체: ${ctxSummary}`,
      `지시: ${state.instruction || '(지시 없음)'}`,
      '',
      `회신 방법(구독 AI 세션): worksheet-grab ai respond ${state.currentRequestId} --fragment <file.json>`,
      'file.json 형식(B′ 프래그먼트): [{"type":"<카탈로그 타입>", …개체 필드}, …]',
      '  · id·좌표(rect/xMm/yMm/wMm/hMm)·크기(widthPct/minHeightMm/align)·페이지 필드는 넣지 마세요 — 엔진이 발급/배치합니다(결정 게이트가 거부).',
      '  · 답안(answer)·정답(answerKey)을 넣지 마세요 — B′ 는 답안을 저작하지 않습니다(누출 100% 구조 차단).',
      '  · 본문 흐름(flow) 개체만. HTML 은 허용 태그만(strong/em/p/ul/li/blockquote/h3/h4/table…, htmlAllowlist).',
    ].join('\n');
  }

  function buildCopyText() {
    if (!state) return '';
    if (state.intent === 'author-section') return buildAuthorCopyText();
    const objectsSummary = state.targets.map((t) => `${t.obj.type}(${t.id})`).join(', ');
    const lines = [
      `[worksheet-grab AI 요청] id=${state.currentRequestId}`,
      `대상 범위: ${state.scope === 'page' ? `현재 페이지 전체(${state.pageId || '?'})` : '선택 개체'}`,
      `대상 개체: ${objectsSummary}`,
      `액션: rewrite`,
      `지시: ${state.instruction || '(프리셋 지시 없음)'}`,
    ];
    if (hasPassageTarget()) {
      lines.push('', '⚠ 저작권 제약: 실존 저작물의 원문을 그대로 재현하지 마세요 — 순수 창작 또는 재구성(수준 조정·요약)만 허용됩니다.');
    }
    lines.push(
      '',
      // v4(권장): 개수·종류가 자유로운 계획. v3(--objects)도 계속 받는다(하위호환).
      `회신 방법(구독 AI 세션): worksheet-grab ai respond ${state.currentRequestId} --ops <file.json>`,
      'file.json 형식(v4 계획): [{"op":"replace","id":"<대상 id>","object":{…개체 전체}},'
      + ' {"op":"insert","object":{…개체 전체},"afterId":"<기준 id>"}, {"op":"delete","id":"<대상 id>"}]',
      '개수를 바꿔도 됩니다 — 여러 개를 하나로 합치려면 replace 1건 + delete 나머지, 하나를 여럿으로'
      + ' 나누려면 replace 1건 + insert 여러 건으로 계획하세요. insert 의 개체 id 는 새로 발급됩니다.',
      '',
      `1:1 치환만 필요하면 기존 형식도 됩니다: worksheet-grab ai respond ${state.currentRequestId} --objects <file.json>`,
      `file.json 형식(v3): [{"id":"${state.targets[0]?.id || ''}","object":{…수정된 개체 전체(id·type 포함, 스키마 준수)}}, …]`,
      '요청 objects[] 각 원소의 id 를 응답에 그대로 에코해야 재부착됩니다(위치/순서 매칭 아님).',
    );
    return lines.join('\n');
  }

  /** 요청 시점의 페이지 지문 — 응답 적용 직전에 다시 계산해 비교한다(US-P4-5 덮어쓰기 방지). */
  function currentPageVersion(pageId) {
    const page = pageId ? deps.getPage?.(pageId) : null;
    return page ? computePageVersion(page) : null;
  }

  /**
   * 요청이 근거로 삼은 **모든** 페이지의 지문 {pageId: version}.
   *
   * 대표 페이지 한 장만 재면 여러 쪽에 걸친 선택에서 구멍이 난다 — 1쪽 q1 과 2쪽 q5 를 함께 고른
   * 요청에서 대기 중 2쪽을 편집해도 1쪽 지문만 같으면 "충돌 없음"으로 통과해 교사의 편집이 조용히
   * 덮인다. 여기서 모은 페이지 집합이 곧 **이 요청의 보호 범위**이고, buildOpsVersion 의 범위 밖 op
   * 판정도 같은 집합을 기준으로 삼는다(보호하지 않는 페이지는 건드리지도 못하게 한다).
   */
  function collectPageVersions() {
    const pageIds = new Set();
    if (state.pageId) pageIds.add(state.pageId);
    for (const target of state.targets) {
      const pageId = deps.getPageIdOf?.(target.id);
      if (pageId) pageIds.add(pageId);
    }
    const versions = {};
    for (const pageId of pageIds) {
      const page = deps.getPage?.(pageId);
      if (page) versions[pageId] = computePageVersion(page);
    }
    return versions;
  }

  async function sendRequest(instruction, context = {}) {
    if (!state || state.phase === 'blocked') return;
    state.instruction = instruction;
    state.context = context;
    state.phase = 'waiting';
    state.error = null;
    // 이 요청이 근거로 삼은 페이지 상태를 못박는다 — 응답이 오는 사이 교사가 편집하면 적용 직전
    // 비교에서 걸린다(요청별로 보관해야 재생성 왕복에서도 각 버전의 기반이 정확하다).
    state.pendingPageVersions = collectPageVersions();
    state.pendingPageVersion = state.pendingPageVersions[state.pageId] ?? currentPageVersion(state.pageId);
    render();
    let res;
    try {
      res = await fetch('/ai/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rewrite', instruction, context,
          objects: state.targets.map((t) => ({ ...t.obj })),
          scope: state.scope,
          ...(state.pageId ? { pageId: state.pageId } : {}),
          // pageId/pageVersion 은 대표 페이지(=활성 페이지) — CLI 표시와 하위호환용으로 계속 싣고,
          // 실제 충돌 검사는 여러 쪽을 다 담은 pageVersions 가 맡는다.
          ...(state.pendingPageVersion ? { pageVersion: state.pendingPageVersion } : {}),
          ...(Object.keys(state.pendingPageVersions || {}).length ? { pageVersions: state.pendingPageVersions } : {}),
        }),
      });
    } catch (e) {
      if (!state) return;
      state.phase = 'compose';
      state.error = `요청 실패: ${e.message}`;
      render();
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!state) return;
      state.phase = 'compose';
      state.error = body.error || `요청 실패(HTTP ${res.status})`;
      render();
      return;
    }
    state.currentRequestId = body.id;
    state.requestIds.add(body.id);
    render();
    pollForResponse(body.id);
  }

  async function pollForResponse(id) {
    const startedAt = Date.now();
    for (;;) {
      if (!state || state.currentRequestId !== id || state.phase !== 'waiting') return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > WAIT_TIMEOUT_MS) {
        state.phase = 'compose';
        state.error = '응답 대기 시간 초과 — 요청은 큐에 남아 있습니다(다시 열어 확인하세요).';
        render();
        return;
      }
      try {
        const res = await fetch(`/ai/${encodeURIComponent(id)}`);
        if (res.status === 404) {
          if (state && state.currentRequestId === id) { state.phase = 'compose'; state.error = '요청을 찾을 수 없습니다(만료/정리됨).'; render(); }
          return;
        }
        const body = await res.json();
        if (body.status === 'cancelled') {
          if (state && state.currentRequestId === id) { state.phase = 'compose'; state.error = '요청이 취소되었습니다.'; render(); }
          return;
        }
        // 열화 반려(M5): AI 가 "이 요청은 못 한다"를 명시 반려 — 5분 조용한 타임아웃 대신 즉시 사유를 보여준다.
        if (body.status === 'unsupported') {
          if (state && state.currentRequestId === id) {
            state.phase = 'compose';
            state.error = `AI가 이 요청은 처리할 수 없다고 답했습니다: ${body.response?.reason || '표현할 수 없는 지시입니다. 더 작은 단위로 나눠 다시 시도해 보세요.'}`;
            render();
          }
          return;
        }
        if (body.status === 'answered') {
          applyResponseAsVersion(id, body.response);
          return;
        }
      } catch { /* 일시 오류 — 창 안에서 재시도 */ }
      await wait(elapsed > 20000 ? 2000 : 600);
    }
  }

  /**
   * v4 계획(ops) → 미리보기 항목 + 적용용 정제 ops. 여기서 **현재 문서를 근거로** 각 항목의
   * 유효성을 미리 판정한다(없는 대상·제외 타입·유령 앵커). 적용 엔진(applyAiOps)은 위반 시 던지므로,
   * 하나라도 무효면 적용 버튼을 비활성화하고 사유를 보여준다 — 눌러서 실패하는 것보다 낫고,
   * "조용한 부분 반영 금지" 규약과도 같은 방향이다(부분 적용을 허용하지 않는다).
   */
  function buildOpsVersion(requestId, rawOps, meta) {
    const items = [];
    const ops = [];
    const problems = [];
    // 이 요청이 근거로 삼은 페이지 집합 = 보호 범위. 그 밖의 개체를 건드리는 op 는 (a) 개수 표기가
    // 실제와 어긋나고 (b) pageVersion 보호 밖이라 덮어쓰기 검사도 못 받는다 — 아예 거부한다.
    const allowedPageIds = new Set(Object.keys(meta?.pageVersions ?? {}));
    const outOfScope = (id) => {
      if (allowedPageIds.size === 0 || id == null) return false; // 페이지 정보가 없으면 판정하지 않는다
      const pageId = deps.getPageIdOf?.(id);
      return !!pageId && !allowedPageIds.has(pageId);
    };
    for (const raw of rawOps) {
      if (!raw || typeof raw !== 'object') { problems.push('형식이 잘못된 계획 항목이 있습니다.'); continue; }
      if (raw.op === 'replace' || raw.op === 'delete') {
        const found = deps.findObject(raw.id)?.obj;
        if (!found) { problems.push(`대상 개체를 찾을 수 없습니다: ${raw.id}`); continue; }
        if (excludedSet.has(found.type)) {
          problems.push(`"${found.type}" 개체는 AI 대상이 아닙니다 — 성취기준 원문은 보존됩니다(원칙 3).`);
          continue;
        }
        if (outOfScope(raw.id)) {
          problems.push(`요청 범위 밖 개체입니다: ${raw.id} — 이 요청이 근거로 삼지 않은 페이지는 바꿀 수 없습니다.`);
          continue;
        }
        if (raw.op === 'delete') {
          items.push({ key: `del-${raw.id}`, kind: 'delete', id: raw.id, before: found, after: null });
          ops.push({ op: 'delete', id: raw.id });
          continue;
        }
        if (!raw.object || typeof raw.object !== 'object') { problems.push(`수정 내용이 비어 있습니다: ${raw.id}`); continue; }
        const after = sanitizeAiObject(raw.object, found);
        items.push({ key: `rep-${raw.id}`, kind: 'replace', id: raw.id, before: found, after });
        ops.push({ op: 'replace', id: raw.id, object: after });
      } else if (raw.op === 'insert') {
        if (!raw.object || typeof raw.object !== 'object') { problems.push('신규 개체 내용이 비어 있습니다.'); continue; }
        const anchorId = raw.afterId ?? raw.beforeId ?? null;
        const anchor = anchorId != null ? deps.findObject(anchorId)?.obj : null;
        if (anchorId != null && !anchor) {
          problems.push(`삽입 기준 개체를 찾을 수 없습니다: ${anchorId}`);
          continue;
        }
        // 자유 배치 개체를 기준으로 삼으면 본문 흐름 어디에 넣을지가 정의되지 않는다 —
        // applyAiOps 가 던지는 조건과 같은 판정을 미리 해 사유를 보여준다(눌러서 실패하지 않도록).
        if (anchor && anchor.placement === 'float') {
          problems.push(`삽입 기준 개체가 본문 흐름 개체가 아닙니다: ${anchorId}`);
          continue;
        }
        if (outOfScope(anchorId)) {
          problems.push(`삽입 기준 개체가 요청 범위 밖입니다: ${anchorId}`);
          continue;
        }
        const after = sanitizeAiObject(raw.object, null);
        const insShape = newObjectShapeProblem(after);
        if (insShape) { problems.push(insShape); continue; }
        items.push({ key: `ins-${items.length}`, kind: 'insert', id: null, before: null, after });
        ops.push({
          op: 'insert',
          object: after,
          ...(raw.afterId ? { afterId: raw.afterId } : {}),
          ...(raw.beforeId ? { beforeId: raw.beforeId } : {}),
        });
      } else if (raw.op === 'insert-section') {
        // M3a: 여러 개체를 한 번에 생성. 미리보기는 각 개체를 신규 카드로 펼쳐 보여주고, 적용은
        // 원자 op 하나(순서 보존·단일 undo)로 간다. 앵커 검증은 insert 와 동일 규약.
        const list = Array.isArray(raw.objects) ? raw.objects : [];
        if (list.length === 0) { problems.push('생성할 섹션 개체가 없습니다.'); continue; }
        const anchorId = raw.afterId ?? raw.beforeId ?? null;
        const anchor = anchorId != null ? deps.findObject(anchorId)?.obj : null;
        if (anchorId != null && !anchor) { problems.push(`섹션 삽입 기준 개체를 찾을 수 없습니다: ${anchorId}`); continue; }
        if (anchor && anchor.placement === 'float') { problems.push(`섹션 삽입 기준 개체가 본문 흐름 개체가 아닙니다: ${anchorId}`); continue; }
        if (outOfScope(anchorId)) { problems.push(`섹션 삽입 기준 개체가 요청 범위 밖입니다: ${anchorId}`); continue; }
        // pageId 앵커(빈 페이지 저작, B1): 개체 앵커가 없을 때 대상 페이지가 요청 범위 안이어야 한다
        // (그래야 pageVersion 보호를 받는다). 존재 확인은 적용 직전 충돌 검사(detectConflict)가 맡는다.
        if (anchorId == null && raw.pageId && allowedPageIds.size > 0 && !allowedPageIds.has(raw.pageId)) {
          problems.push(`섹션 저작 대상 페이지가 요청 범위 밖입니다: ${raw.pageId}`); continue;
        }
        const badType = list.find((o) => o && excludedSet.has(o.type));
        if (badType) { problems.push(`"${badType.type}" 개체는 AI 가 생성할 수 없습니다 — 성취기준 원문은 보존됩니다(원칙 3).`); continue; }
        const cleaned = list.map((o) => sanitizeAiObject(o, null));
        const secShape = cleaned.map(newObjectShapeProblem).find(Boolean);
        if (secShape) { problems.push(secShape); continue; }
        for (const after of cleaned) items.push({ key: `sec-${items.length}`, kind: 'insert', id: null, before: null, after });
        ops.push({
          op: 'insert-section',
          objects: cleaned,
          ...(raw.afterId ? { afterId: raw.afterId } : {}),
          ...(raw.beforeId ? { beforeId: raw.beforeId } : {}),
          ...(!raw.afterId && !raw.beforeId && raw.pageId ? { pageId: raw.pageId } : {}),
        });
      } else {
        problems.push(`알 수 없는 계획 항목: ${String(raw?.op)}`);
      }
    }
    const applicable = ops.length > 0 && problems.length === 0;
    let blockReason = null;
    if (ops.length === 0) blockReason = `AI 결과 계획을 적용할 수 없습니다 — ${problems[0] ?? '유효한 항목이 없습니다.'}`;
    else if (problems.length) blockReason = `계획 일부가 무효라 적용할 수 없습니다: ${problems.join(' / ')}`;
    return { requestId, kind: 'ops', items, ops, applicable, blockReason, ...meta };
  }

  /** v1~v3 응답(대상 ID 에코 = 1:1 치환) → 미리보기 항목. 하위호환 경로(무변경 계약). */
  function buildEchoVersion(requestId, response, meta) {
    const echoed = Array.isArray(response?.objects) ? response.objects : [];
    const byId = new Map(echoed.map((o) => [o.id, o.object]));
    const items = state.targets.map((t) => {
      const raw = byId.get(t.id);
      const valid = raw && typeof raw === 'object' && raw.id === t.id && raw.type === t.obj.type;
      return { key: t.id, kind: 'replace', id: t.id, before: t.obj, after: valid ? sanitizeAiObject(raw, t.obj) : null };
    });
    const applicable = items.some((it) => it.after);
    return {
      requestId,
      kind: 'echo',
      items,
      ops: null,
      applicable,
      blockReason: applicable ? null : 'AI 응답에 대상 개체 id 가 하나도 매칭되지 않았습니다(개체 ID 에코 확인 필요).',
      ...meta,
    };
  }

  /**
   * 보여줄 버전을 바꾼다 — 화면 상태(사유·충돌 배너)는 **그 버전에서 파생**시킨다.
   * versionIndex 만 옮기고 state.error/state.conflict 를 그대로 두면 버전 왕복에서 셋이 어긋난다:
   * 무효 버전으로 돌아왔는데 사유가 사라지거나(적용 버튼만 비활성), 정상 버전에 남의 "무효" 문구가
   * 남거나, 더 나쁘게는 다른 버전에서 뜬 충돌 배너의 "그래도 적용"이 지금 버전을 **자기 충돌 검사
   * 없이** 강행한다(fail-closed 우회). 파생값으로 접어 그 셋을 한 번에 없앤다.
   */
  function showVersion(index) {
    if (!state) return;
    const next = Math.max(0, Math.min(index, state.versions.length - 1));
    state.versionIndex = next;
    state.error = state.versions[next]?.blockReason ?? null;
    state.conflict = null;
    state.conflictMode = null;
    render();
  }

  /**
   * B′ 프래그먼트 응답(제약 AI 가 id 없이 저작한 scaffold 개체 배열) → 미리보기 버전.
   * prepareAiFragment 로 결정 검증·구조 floor 를 거쳐 **단일 insert-section op** 로 컴파일한 뒤,
   * 그 op 를 buildOpsVersion 에 그대로 흘려보낸다 — 미리보기·앵커·범위·충돌·단일 undo 파이프라인을
   * 통째로 재사용한다(ADR-bspike-ai-fragment.md 권고: 검증 계층 채택 + insert-section 전송 계층 유지).
   * 앵커는 응답이 지정한 afterId/beforeId, 없으면 마지막 대상 개체 뒤(선택 기준 섹션 생성).
   */
  function buildFragmentVersion(requestId, response, meta) {
    const lastTarget = state.targets.length ? state.targets[state.targets.length - 1].id : null;
    // B1 저작 진입이면 삽입 위치는 교사가 정한다(state.authorAnchor: {afterId}|{pageId}) — AI 응답의
    // afterId/beforeId 보다 우선한다(배치는 교사 결정, AI 는 내용만 저작). 구독 AI 가 스스로 --fragment
    // 로 답한 경우(진입 없음)만 응답 앵커 → 마지막 대상 순으로 폴백한다(하위호환·무변경).
    const anchor = state.authorAnchor
      ? state.authorAnchor
      : (typeof response.afterId === 'string' && response.afterId) ? { afterId: response.afterId }
        : (typeof response.beforeId === 'string' && response.beforeId) ? { beforeId: response.beforeId }
          : (lastTarget ? { afterId: lastTarget } : {});
    // 권한(allowPassageContent)은 **교사의 요청측 grant**(state.context — 이 요청을 보낼 때 교사가 토글로
    // 명시)가 권위다. AI 응답의 context 는 신뢰하지 않는다 — 신뢰하면 제약 AI 가 응답에
    // allowPassageContent:true 를 실어 지문 저작 권한을 스스로 부여(self-grant)할 수 있다(B3 보안 경계).
    const prep = prepareAiFragment(response.fragment, {
      ctx: { allowPassageContent: state.context?.allowPassageContent === true },
      anchor,
      requestPageVersions: meta.pageVersions ?? null,
    });
    if (!prep.ok) {
      return { requestId, kind: 'ops', items: [], ops: [], applicable: false, blockReason: prep.blockReason, ...meta };
    }
    return buildOpsVersion(requestId, [prep.op], meta);
  }

  function applyResponseAsVersion(requestId, response) {
    if (!state || state.currentRequestId !== requestId) return;
    const meta = {
      pageId: state.pageId,
      pageVersion: state.pendingPageVersion ?? null,
      pageVersions: state.pendingPageVersions ?? null,
      targetCount: state.targets.length,
    };
    const version = Array.isArray(response?.fragment)
      ? buildFragmentVersion(requestId, response, meta)
      : Array.isArray(response?.ops)
        ? buildOpsVersion(requestId, response.ops, meta)
        : buildEchoVersion(requestId, response, meta);
    state.versions.push(version);
    state.phase = 'preview';
    showVersion(state.versions.length - 1);
  }

  /**
   * 적용 직전 충돌 검사(US-P4-5) — 요청 시점 지문과 지금 지문을 **요청이 걸친 모든 페이지**에서
   * 비교한다. fail-closed: 하나라도 다르면 자동 적용하지 않고 교사에게 선택지(그래도 적용 / 폐기)를
   * 준다. 페이지가 사라졌으면 강행 경로 없이 거부한다(어디에 적용할지가 정의되지 않는다).
   *
   * pageVersions 가 없는 버전(옛 in-flight 응답)은 대표 페이지 한 장으로 폴백한다 — 검사를 건너뛰는
   * 것보다 한 장이라도 보는 편이 낫다.
   */
  function detectConflict(version) {
    const versions = version?.pageVersions && Object.keys(version.pageVersions).length
      ? version.pageVersions
      : (version?.pageId && version?.pageVersion ? { [version.pageId]: version.pageVersion } : null);
    if (!versions) return null;

    const missing = [];
    const changed = [];
    for (const [pageId, expected] of Object.entries(versions)) {
      const page = deps.getPage?.(pageId);
      if (!page) { missing.push(pageId); continue; }
      if (computePageVersion(page) !== expected) changed.push(pageId);
    }
    if (missing.length) {
      return {
        kind: 'missing',
        message: `대상 페이지가 삭제되었습니다(${missing.length}쪽) — 이 AI 결과는 적용할 수 없습니다.`,
      };
    }
    if (changed.length) {
      const where = Object.keys(versions).length > 1 ? `${changed.length}개 페이지가 ` : '이 페이지가 ';
      return {
        kind: 'changed',
        message: `요청을 보낸 뒤 ${where}편집되었습니다 — 지금 적용하면 그 편집을 덮어씁니다. 확인 후 선택하세요.`,
      };
    }
    return null;
  }

  function regenerate() {
    if (!state || !state.instruction) return;
    sendRequest(state.instruction, state.context);
  }

  async function applyCurrent(mode, { force = false } = {}) {
    if (!state || state.phase !== 'preview') return;
    const version = state.versions[state.versionIndex];
    if (!version) return;
    if (!version.applicable) { state.error = version.blockReason || '적용할 AI 결과가 없습니다.'; render(); return; }

    // 페이지 소멸(missing)은 강행 대상이 아니다 — 적용 위치 자체가 정의되지 않는다.
    const conflict = detectConflict(version);
    if (conflict && (conflict.kind === 'missing' || !force)) {
      state.conflict = conflict;
      state.conflictMode = mode; // "그래도 적용" 이 원래 눌린 버튼의 의미를 유지하도록
      render();
      return;
    }

    const updates = version.kind === 'ops'
      ? null
      : version.items.filter((it) => it.after).map((it) => ({ id: it.id, object: it.after }));
    const allRequestIds = [...state.requestIds];
    const appliedRequestId = version.requestId;
    const result = version.kind === 'ops'
      ? await deps.onApply({ mode: 'ops', ops: version.ops })
      : await deps.onApply({ mode, updates });
    if (result?.error) {
      // 적용 엔진이 거부했다(없는 대상·제외 타입·유령 앵커) — 패널을 닫지 않고 사유를 보여준다.
      if (!state) return;
      state.conflict = null;
      state.error = `적용 실패: ${result.error}`;
      render();
      return;
    }
    markFresh(result?.ids || (updates || []).map((u) => u.id));
    await markRequestApplied(appliedRequestId);
    await Promise.all(allRequestIds.filter((id) => id !== appliedRequestId).map((id) => cancelRequest(id)));
    state = null;
    render();
  }

  async function closePanel({ cancel = false } = {}) {
    if (!state) return;
    if (cancel) {
      const ids = [...state.requestIds];
      await Promise.all(ids.map((id) => cancelRequest(id)));
    }
    state = null;
    render();
  }

  // ── 뷰 조각 ──
  function headerRow() {
    const row = el('div', { class: 'ai-panel-head' });
    row.appendChild(el('span', { text: 'AI 편집' }));
    const closeBtn = el('button', { type: 'button', id: 'ai-panel-close', 'aria-label': '닫기', text: '×' });
    closeBtn.addEventListener('click', () => closePanel({ cancel: state?.phase !== 'blocked' }));
    row.appendChild(closeBtn);
    return row;
  }

  function blockedView() {
    return el('div', { class: 'ai-blocked', id: 'ai-blocked', text: state.blockedMessage });
  }

  /** B1 — 새 섹션 저작 작성 뷰(rewrite compose 와 분리): 대상 개체를 고르는 게 아니라 만들 섹션을
   *  지시한다. 삽입 위치는 이미 정해졌다(state.authorAnchor) — 여기선 무엇을 만들지만 입력한다. */
  function authorComposeView() {
    const wrap = el('div', { class: 'ai-compose ai-author-compose' });
    wrap.appendChild(el('div', {
      class: 'ai-targets-summary',
      id: 'ai-targets-summary',
      'data-ai-intent': 'author-section',
      'data-ai-anchor-mode': state.authorAnchor?.pageId ? 'page' : 'after',
      'data-ai-page-id': state.pageId || '',
      'data-ai-target-count': String(state.targets.length),
      text: `새 섹션 AI 저작 — 삽입 위치: ${state.anchorLabel || describeAnchor(state.authorAnchor)}`,
    }));
    if (state.error) wrap.appendChild(el('div', { class: 'ai-error', id: 'ai-error', text: state.error }));

    // B3 — 지문(저작권 본문) 저작 허용 토글. 교사의 명시 opt-in(기본 OFF)이다. 켜면 요청 컨텍스트에
    // allowPassageContent:true 가 실려 나가(구독 AI 가 passage bodyHtml 을 채워도 되는지 판단), 적용
    // 시엔 editor 가 **이 값(교사 결정=state.context)** 을 권위로 삼아 검증한다 — AI 응답이 스스로
    // 권한을 만들지 못한다(self-grant 차단, buildFragmentVersion 참조). 저작권 경계는 교사 책임·로컬 처리.
    const passageRow = el('label', { class: 'ai-passage-perm', id: 'ai-passage-perm' });
    const passageToggle = el('input', { type: 'checkbox', id: 'ai-allow-passage' });
    passageRow.append(passageToggle, el('span', { text: ' 지문(저작권 본문)까지 AI가 채우도록 허용 — 교사 책임·로컬 처리' }));
    wrap.appendChild(passageRow);
    // 프리셋·자유입력이 공유하는 요청 컨텍스트. 토글이 켜졌을 때만 권한 키를 싣는다(미첨부=미허용).
    const authorContext = (preset) => (passageToggle.checked
      ? { intent: 'author-section', preset, allowPassageContent: true }
      : { intent: 'author-section', preset });

    const presetRow = el('div', { class: 'ai-presets' });
    const practiceBtn = el('button', { type: 'button', id: 'ai-author-practice', text: '연습문제 섹션' });
    practiceBtn.addEventListener('click', () => sendRequest(
      '이 활동지 맥락에 맞는 연습문제 섹션을 새로 저작해 주세요(문항 2~3개). 필요하면 짧은 안내 문장을 함께 넣되, 정답은 넣지 마세요.',
      authorContext('practice'),
    ));
    const summaryBtn = el('button', { type: 'button', id: 'ai-author-summary', text: '요약 정리 섹션' });
    summaryBtn.addEventListener('click', () => sendRequest(
      '이 활동지 맥락을 정리하는 섹션을 새로 저작해 주세요(제목 + 핵심 정리 본문).',
      authorContext('summary'),
    ));
    presetRow.append(practiceBtn, summaryBtn);
    wrap.appendChild(presetRow);

    const freeWrap = el('div', { class: 'ai-freeform' });
    const ta = el('textarea', { id: 'ai-author-prompt', placeholder: '어떤 섹션을 만들지 설명하세요 — 예: 광합성 개념 정리 활동 3문항' });
    const sendBtn = el('button', { type: 'button', id: 'ai-author-send', text: '섹션 저작 요청' });
    sendBtn.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return;
      sendRequest(text, authorContext('free'));
    });
    freeWrap.append(ta, sendBtn);
    wrap.appendChild(freeWrap);
    return wrap;
  }

  function composeView() {
    if (state.intent === 'author-section') return authorComposeView();
    const wrap = el('div', { class: 'ai-compose' });
    wrap.appendChild(el('div', {
      class: 'ai-targets-summary',
      id: 'ai-targets-summary',
      'data-ai-scope': state.scope,
      'data-ai-target-count': String(state.targets.length),
      'data-ai-page-id': state.pageId || '',
      text: state.scope === 'page'
        ? `대상: ${state.pageIds && state.pageIds.length > 1 ? `선택한 ${state.pageIds.length}개 페이지 전체` : '현재 페이지 전체'} — ${state.targets.map((t) => t.obj.type).join(', ')} (${state.targets.length}개)`
        : `대상: ${state.targets.map((t) => t.obj.type).join(', ')} (${state.targets.length}개)`,
    }));

    // US-P4-4: 선택이 있어도 "현재 페이지 전체"를 명시적으로 고를 수 있다(그리고 되돌릴 수 있다).
    const scopeRow = el('div', { class: 'ai-scope', id: 'ai-scope-row' });
    const scopeToggle = el('input', { type: 'checkbox', id: 'ai-scope-page' });
    scopeToggle.checked = state.scope === 'page';
    scopeToggle.disabled = state.selectionIds.length === 0; // 선택이 없으면 페이지 전체 외의 선택지가 없다
    scopeToggle.addEventListener('change', () => switchScope(scopeToggle.checked ? 'page' : 'objects'));
    const scopeLabel = el('label', { for: 'ai-scope-page', id: 'ai-scope-page-label', text: '현재 페이지 전체를 대상으로' });
    scopeRow.append(scopeToggle, scopeLabel);
    wrap.appendChild(scopeRow);

    if (state.error) wrap.appendChild(el('div', { class: 'ai-error', id: 'ai-error', text: state.error }));

    const presetRow = el('div', { class: 'ai-presets' });
    const easierBtn = el('button', { type: 'button', id: 'ai-preset-easier', text: '난이도 낮추기' });
    easierBtn.addEventListener('click', () => sendRequest('선택한 개체의 난이도를 한 단계 낮춰 다시 작성해 주세요.', { preset: 'easier' }));
    const harderBtn = el('button', { type: 'button', id: 'ai-preset-harder', text: '난이도 높이기' });
    harderBtn.addEventListener('click', () => sendRequest('선택한 개체의 난이도를 한 단계 높여 다시 작성해 주세요.', { preset: 'harder' }));
    presetRow.append(easierBtn, harderBtn);

    const allQuestions = state.targets.every((t) => t.obj.type === 'question');
    if (allQuestions) {
      const qtypeSel = el('select', { id: 'ai-preset-qtype-select' });
      for (const qt of QUESTION_TYPES) qtypeSel.appendChild(el('option', { value: qt, text: QTYPE_LABELS[qt] || qt }));
      const qtypeBtn = el('button', { type: 'button', id: 'ai-preset-qtype', text: '문항 유형 변환' });
      qtypeBtn.addEventListener('click', () => {
        const label = QTYPE_LABELS[qtypeSel.value] || qtypeSel.value;
        sendRequest(`문항 유형을 "${label}"(으)로 변환해 주세요. 그에 맞는 필드(보기/빈칸/연결 등)로 다시 구성하세요.`, { preset: 'qtype', qtype: qtypeSel.value });
      });
      presetRow.append(qtypeSel, qtypeBtn);
    }

    const gradeInput = el('input', { type: 'text', id: 'ai-preset-grade-input', placeholder: '예: 초등 3학년' });
    const gradeBtn = el('button', { type: 'button', id: 'ai-preset-grade', text: '학년 수준 조정' });
    gradeBtn.addEventListener('click', () => {
      const grade = gradeInput.value.trim();
      if (!grade) return;
      sendRequest(`학년 수준을 "${grade}"에 맞게 조정해 주세요.`, { preset: 'grade', grade });
    });
    presetRow.append(gradeInput, gradeBtn);

    // 지문(passage-slot) 전용 프리셋(3층 정책, 2026-07-23 2차 델타) — 교사가 명시적으로 요청할 때만
    // AI가 지문을 다룬다: (a) 순수 창작, (b) 교사가 이미 넣은 글의 재구성/수준 조정/요약. 실존
    // 저작물 원문을 그대로 재현하는 것은 금지(프롬프트 계약 — 지시문에 명시, buildCopyText 동일 고지).
    if (state.targets.length === 1 && state.targets[0].obj.type === 'passage-slot') {
      const topicInput = el('input', { type: 'text', id: 'ai-passage-topic-input', placeholder: '예: 인공지능과 글쓰기' });
      const generateBtn = el('button', { type: 'button', id: 'ai-preset-passage-generate', text: '창작 지문 생성' });
      generateBtn.addEventListener('click', () => {
        const topic = topicInput.value.trim();
        sendRequest(
          `${topic ? `"${topic}" 주제로 ` : ''}읽기 지문을 새로 창작해 bodyHtml 에 채워 주세요(순수 창작). ` +
          '실존 저작물의 원문을 그대로 재현하지 마세요. source 필드에는 "AI 창작"이라고 표기하세요.',
          { preset: 'passage-generate', topic },
        );
      });
      const restructureBtn = el('button', { type: 'button', id: 'ai-preset-passage-restructure', text: '지문 재구성' });
      restructureBtn.addEventListener('click', () => {
        sendRequest(
          '현재 bodyHtml 의 지문을 수준 조정·요약·재구성해 주세요. 실존 저작물의 원문을 그대로 재현하지 ' +
          '말고 재구성한 결과만 담으세요. source 필드에는 "원문 재구성"처럼 재구성했음을 표기하세요.',
          { preset: 'passage-restructure' },
        );
      });
      presetRow.append(topicInput, generateBtn, restructureBtn);
    }
    wrap.appendChild(presetRow);

    const freeWrap = el('div', { class: 'ai-freeform' });
    const ta = el('textarea', { id: 'ai-free-prompt', placeholder: '자유롭게 지시를 입력하세요…' });
    const sendBtn = el('button', { type: 'button', id: 'ai-send-free', text: '요청 보내기' });
    sendBtn.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return;
      sendRequest(text, { preset: 'free' });
    });
    freeWrap.append(ta, sendBtn);
    wrap.appendChild(freeWrap);

    return wrap;
  }

  function waitingView() {
    const wrap = el('div', { class: 'ai-waiting', 'data-ai-request-id': state.currentRequestId || '' });
    wrap.appendChild(el('div', { id: 'ai-waiting-label', text: `AI 응답 대기 중… (요청 ${state.currentRequestId})` }));
    const ta = el('textarea', { id: 'ai-copy-text', readonly: 'readonly' });
    ta.value = buildCopyText();
    const copyBtn = el('button', { type: 'button', id: 'ai-copy-instruction', text: 'AI 지시문 복사' });
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); } catch { /* headless/권한 부재 — textarea 값으로 폴백 확인 가능 */ }
      document.body.dataset.aiCopiedAt = String(Date.now());
    });
    const cancelBtn = el('button', { type: 'button', id: 'ai-cancel-waiting', text: '취소' });
    cancelBtn.addEventListener('click', () => closePanel({ cancel: true }));
    wrap.append(copyBtn, ta, cancelBtn);
    return wrap;
  }

  const KIND_LABELS = { replace: '수정', insert: '신규', delete: '삭제' };

  /** 삭제 항목은 before 만, 신규 항목은 after 만 보여준다 — 교사가 적용 전에 무엇이 없어지고
   *  무엇이 생기는지 카드 단위로 알 수 있어야 한다(US-P4-3). */
  function previewItemCard(item) {
    const card = el('div', {
      class: `ai-preview-card ai-preview-${item.kind}`,
      'data-ai-preview-id': item.id || item.key,
      'data-ai-preview-kind': item.kind,
    });
    card.appendChild(el('div', { class: 'ai-preview-kind', text: KIND_LABELS[item.kind] || item.kind }));
    const row = el('div', { class: 'ai-preview-row' });
    const beforeCol = el('div', { class: 'ai-preview-col ai-preview-before' }, [
      el('h4', { text: item.before ? `원본 · ${item.before.type}` : '원본 없음' }),
      el('div', {
        class: 'ai-preview-render',
        html: item.before ? renderObjectFragment(item.before, deps.getRenderMeta()) : '<em>(새로 추가되는 개체)</em>',
      }),
    ]);
    const afterHtml = item.after
      ? renderObjectFragment(item.after, deps.getRenderMeta())
      : (item.kind === 'delete' ? '<em>(이 개체는 삭제됩니다)</em>' : '<em>(이 개체에 대한 응답 없음)</em>');
    const afterCol = el('div', { class: 'ai-preview-col ai-preview-after' }, [
      el('h4', { text: item.kind === 'delete' ? '삭제됨' : 'AI 결과' }),
      el('div', { class: 'ai-preview-render', html: afterHtml }),
    ]);
    row.append(beforeCol, afterCol);
    card.appendChild(row);
    card.appendChild(el('div', {
      class: 'ai-diff', id: `ai-diff-${item.id || item.key}`,
      html: item.before && item.after ? diffToHtml(objectDisplayText(item.before), objectDisplayText(item.after)) : '',
    }));
    return card;
  }

  /** "대상 3개 → 결과 1개" 를 명시한다 — 개수 변화가 적용 전에 눈에 보여야 한다(US-P4-3). */
  function countChangeRow(version) {
    const counts = { replace: 0, insert: 0, delete: 0 };
    for (const item of version.items) {
      if (item.kind === 'delete') counts.delete += 1;
      else if (item.kind === 'insert') counts.insert += 1;
      else if (item.after) counts.replace += 1;
    }
    const before = version.targetCount ?? version.items.length;
    const after = version.kind === 'ops'
      ? before - counts.delete + counts.insert
      : counts.replace;
    return el('div', {
      class: 'ai-count-change',
      id: 'ai-count-change',
      'data-ai-count-before': String(before),
      'data-ai-count-after': String(after),
      'data-ai-count-replace': String(counts.replace),
      'data-ai-count-insert': String(counts.insert),
      'data-ai-count-delete': String(counts.delete),
      text: `대상 ${before}개 → 결과 ${after}개 (수정 ${counts.replace} · 신규 ${counts.insert} · 삭제 ${counts.delete})`,
    });
  }

  function conflictView() {
    const box = el('div', { class: 'ai-conflict', id: 'ai-conflict', 'data-ai-conflict': state.conflict.kind });
    box.appendChild(el('div', { class: 'ai-conflict-message', text: state.conflict.message }));
    const row = el('div', { class: 'ai-conflict-actions' });
    if (state.conflict.kind === 'changed') {
      const forceBtn = el('button', { type: 'button', id: 'ai-conflict-force', text: '그래도 적용' });
      forceBtn.addEventListener('click', () => applyCurrent(state.conflictMode, { force: true }));
      row.appendChild(forceBtn);
    }
    const discardBtn = el('button', { type: 'button', id: 'ai-conflict-discard', text: '폐기' });
    discardBtn.addEventListener('click', () => closePanel({ cancel: true }));
    row.appendChild(discardBtn);
    box.appendChild(row);
    return box;
  }

  function versionNav() {
    const nav = el('div', { class: 'ai-version-nav' });
    const prevBtn = el('button', { type: 'button', id: 'ai-version-prev', text: '◀' });
    prevBtn.disabled = state.versionIndex <= 0;
    prevBtn.addEventListener('click', () => showVersion(state.versionIndex - 1));
    const label = el('span', { id: 'ai-version-label', text: `${state.versionIndex + 1} / ${state.versions.length}` });
    const nextBtn = el('button', { type: 'button', id: 'ai-version-next', text: '▶' });
    nextBtn.disabled = state.versionIndex >= state.versions.length - 1;
    nextBtn.addEventListener('click', () => showVersion(state.versionIndex + 1));
    nav.append(prevBtn, label, nextBtn);
    return nav;
  }

  function actionsRow(version) {
    const row = el('div', { class: 'ai-actions' });
    if (version.kind === 'ops') {
      // v4 계획은 배치(교체/삽입/삭제)를 AI 가 이미 정했다 — 교사가 고를 모드가 없다.
      const applyBtn = el('button', { type: 'button', id: 'ai-apply-ops', text: '적용' });
      applyBtn.disabled = !version.applicable;
      applyBtn.addEventListener('click', () => applyCurrent('ops'));
      row.appendChild(applyBtn);
    } else {
      const replaceBtn = el('button', { type: 'button', id: 'ai-apply-replace', text: '교체' });
      replaceBtn.disabled = !version.applicable;
      replaceBtn.addEventListener('click', () => applyCurrent('replace'));
      const insertBtn = el('button', { type: 'button', id: 'ai-apply-insert', text: '아래 삽입' });
      insertBtn.disabled = !version.applicable;
      insertBtn.addEventListener('click', () => applyCurrent('insert'));
      row.append(replaceBtn, insertBtn);
    }
    const regenBtn = el('button', { type: 'button', id: 'ai-regenerate', text: '재생성' });
    regenBtn.addEventListener('click', () => regenerate());
    const cancelBtn = el('button', { type: 'button', id: 'ai-cancel-preview', text: '취소' });
    cancelBtn.addEventListener('click', () => closePanel({ cancel: true }));
    row.append(regenBtn, cancelBtn);
    return row;
  }

  function previewView() {
    const wrap = el('div', { class: 'ai-preview' });
    if (state.error) wrap.appendChild(el('div', { class: 'ai-error', id: 'ai-error', text: state.error }));
    const version = state.versions[state.versionIndex];
    wrap.appendChild(countChangeRow(version));
    if (state.conflict) wrap.appendChild(conflictView());
    for (const item of version.items) wrap.appendChild(previewItemCard(item));
    if (state.versions.length > 1) wrap.appendChild(versionNav());
    wrap.appendChild(actionsRow(version));
    return wrap;
  }

  function render() {
    panelHost.replaceChildren();
    if (!state) return;
    const panel = el('div', {
      class: 'ai-panel',
      id: 'ai-panel',
      'data-ai-phase': state.phase,
      'data-ai-scope': state.scope,
      'data-ai-intent': state.intent || 'rewrite',
      'data-ai-page-id': state.pageId || '',
    });
    panel.appendChild(headerRow());
    if (state.phase === 'blocked') panel.appendChild(blockedView());
    else if (state.phase === 'compose') panel.appendChild(composeView());
    else if (state.phase === 'waiting') panel.appendChild(waitingView());
    else if (state.phase === 'preview') panel.appendChild(previewView());
    panelHost.appendChild(panel);
  }

  function resolveObjectTargets(ids) {
    return [...new Set(ids)].map((id) => ({ id, obj: deps.findObject(id)?.obj })).filter((t) => !!t.obj);
  }

  /** scope:'page' 의 대상 — 그 페이지의 flow+float 전부. std-box 는 여기서 **제외**한다: 페이지
   *  전체라는 이유로 성취기준 원문이 AI 대상이 되면 안 된다(원칙 3). 선택 경로처럼 차단하지 않고
   *  조용히 빼는 이유는, 페이지 전체 요청은 교사가 특정 개체를 지목한 게 아니기 때문이다. */
  function collectPagesTargets(pageIds) {
    const pages = [...new Set(pageIds || [])]
      .map((pid) => (pid ? deps.getPage?.(pid) : null))
      .filter(Boolean);
    return pageScopeTargets(pages, excludedSet);
  }
  function collectPageTargets(pageId) {
    return collectPagesTargets(pageId ? [pageId] : []);
  }

  function switchScope(next) {
    if (!state || state.scope === next) return;
    if (next === 'page') {
      const pageIds = (state.pageIds && state.pageIds.length)
        ? state.pageIds
        : [state.pageId ?? deps.getActivePageId?.() ?? null].filter(Boolean);
      const targets = collectPagesTargets(pageIds);
      if (targets.length === 0) { state.error = '이 페이지에는 AI 로 편집할 개체가 없습니다.'; render(); return; }
      state.scope = 'page';
      state.pageId = pageIds[0] ?? null;
      state.pageIds = pageIds;
      state.targets = targets;
    } else {
      const targets = resolveObjectTargets(state.selectionIds);
      if (targets.length === 0) { state.error = '선택된 개체가 없습니다.'; render(); return; }
      state.scope = 'objects';
      state.targets = targets;
      state.pageId = deps.getPageIdOf?.(targets[0].id) ?? state.pageId ?? null;
    }
    state.error = null;
    render();
  }

  function makeBaseState(selectionIds) {
    return {
      selectionIds,
      instruction: '', context: {}, currentRequestId: null, requestIds: new Set(),
      versions: [], versionIndex: 0, error: null,
      pendingPageVersion: null, pendingPageVersions: null, conflict: null, conflictMode: null,
      blockedMessage: null,
      // B1 저작 인텐트 필드(rewrite 경로에선 null 로 남는다).
      intent: null, authorAnchor: null, anchorLabel: null,
    };
  }

  /**
   * B1 — 새 섹션 AI 저작 진입(프래그먼트 저작). rewrite 와 달리 기존 개체를 고르는 게 아니라,
   * 교사 클릭이 정한 앵커(computeAuthorAnchor: 선택 flow 개체 뒤 · 페이지 말미 · 빈 페이지 pageId)에
   * 제약 AI 가 저작한 섹션을 삽입한다. 앵커 페이지는 개체 진입이면 그 개체의 페이지, 아니면 활성 페이지.
   * 문맥 개체(요청 objects)는 std-box 를 뺀다(서버 가드 §7) — 없으면(빈 페이지) 비어도 유효(요청 완화).
   */
  /** 문서에서 activePageId 페이지까지의 마지막 flow 개체 id — 빈 페이지 저작 앵커 폴백(authorAnchor.js
   *  참조: 빈 페이지는 reflow 가 지우므로 pageId 대신 안정 개체 뒤에 붙인다). 완전 빈 문서면 null. */
  function lastFlowIdUpTo(anchorPageId) {
    const objDoc = deps.getObjectDocument?.();
    const pages = objDoc?.pages || [];
    let last = null;
    for (const page of pages) {
      const flow = page?.flow || [];
      if (flow.length) last = flow[flow.length - 1]?.id ?? last;
      if (page?.id === anchorPageId) break; // 활성(빈) 페이지까지만 — 그 뒤 콘텐츠 앞으로 새치기하지 않는다
    }
    return last;
  }

  function openForAuthorSection(ids) {
    const selectionIds = [...new Set(ids || [])].filter((id) => !!deps.findObject(id)?.obj);
    const firstId = selectionIds[0] ?? null;
    const anchorPageId = (firstId ? deps.getPageIdOf?.(firstId) : null) ?? deps.getActivePageId?.() ?? null;
    const anchorPage = anchorPageId ? deps.getPage?.(anchorPageId) : null;
    const selectedObj = firstId ? deps.findObject(firstId)?.obj : null;
    const authorAnchor = computeAuthorAnchor(anchorPage, selectedObj, lastFlowIdUpTo(anchorPageId));
    const base = makeBaseState(selectionIds);

    if (!authorAnchor) {
      state = {
        ...base, intent: 'author-section', scope: 'objects', pageId: anchorPageId, targets: [],
        phase: 'blocked', blockedMessage: '새 섹션을 저작할 페이지를 찾을 수 없습니다.',
      };
      render();
      return;
    }

    const targets = (selectionIds.length ? resolveObjectTargets(selectionIds) : collectPageTargets(anchorPageId))
      .filter((t) => !excludedSet.has(t.obj.type));
    state = {
      ...base, intent: 'author-section', scope: 'objects', pageId: anchorPageId,
      targets, authorAnchor, anchorLabel: describeAnchor(authorAnchor), phase: 'compose',
    };
    render();
  }

  function openFor(ids, { scope = null, pageIds = null, intent = null } = {}) {
    if (intent === 'author-section') { openForAuthorSection(ids); return; }
    const selectionIds = [...new Set(ids || [])].filter((id) => !!deps.findObject(id)?.obj);
    const base = makeBaseState(selectionIds);

    // 선택이 없거나 교사가 명시적으로 페이지 전체를 고르면 페이지 전체가 대상이다(US-P4-4).
    // pageIds(다중 페이지 grab, M2)가 오면 그 여러 페이지 전체를, 아니면 활성 페이지 한 장을 대상으로.
    if (scope === 'page' || selectionIds.length === 0) {
      const scopePageIds = (Array.isArray(pageIds) && pageIds.length)
        ? [...new Set(pageIds)]
        : [deps.getActivePageId?.() ?? null].filter(Boolean);
      const targets = collectPagesTargets(scopePageIds);
      state = {
        ...base,
        scope: 'page',
        pageId: scopePageIds[0] ?? null,
        pageIds: scopePageIds,
        targets,
        phase: targets.length ? 'compose' : 'blocked',
        blockedMessage: targets.length ? null : '이 페이지에는 AI 로 편집할 개체가 없습니다(성취기준 개체는 제외됩니다).',
      };
      render();
      return;
    }

    const targets = resolveObjectTargets(selectionIds);
    if (targets.length === 0) return;
    const excludedTarget = targets.find((t) => excludedSet.has(t.obj.type));
    state = {
      ...base,
      scope: 'objects',
      pageId: deps.getPageIdOf?.(targets[0].id) ?? deps.getActivePageId?.() ?? null,
      targets,
      phase: excludedTarget ? 'blocked' : 'compose',
      blockedMessage: excludedTarget
        ? `"${excludedTarget.obj.type}" 개체는 AI 대상이 아닙니다 — 성취기준 원문은 보존됩니다(§7, 원칙 3).`
        : null,
    };
    render();
  }

  return {
    openFor,
    close: () => closePanel({ cancel: true }),
    isOpen: () => !!state,
    refreshEntryState,
    markFresh, clearFresh, clearAllFresh, refreshFreshBadges,
  };
}
