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
// preview-then-commit: 응답이 도착해도 원본을 즉시 덮지 않는다 — 원본/AI 결과를 나란히 렌더(카드) +
// 단어 단위 인라인 diff(추가=초록·삭제=취소선 빨강, 자체 LCS)로 미리보기를 띄우고, 사용자가
// 교체/아래 삽입/재생성(버전 화살표로 왕복)/취소 중 하나를 고른다. 적용은 editor.js 의 applyDocOp
// 를 그대로 거쳐 history 1 op 로 확정된다(undo 1스텝 복원).
//
// 진입점(모두 같은 패널을 연다): 앱 바 AI 버튼(#ai-entry-slot) · 우클릭 메뉴 · 슬래시 메뉴(/ai) ·
// 컨텍스트 툴바 공통 버튼 — editor.js 가 각 모듈에 onAiOpen 콜백으로 이 패널의 openFor()를 배선한다.

import { RenderObjectTree } from '/src/usecases/RenderObjectTree.js';
import { QUESTION_TYPES } from '/src/domain/schema/index.js';
import { QTYPE_LABELS } from './objectFactory.js';

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
  // title.textHtml·question.promptHtml(인라인 서식 보존 HTML)도 정제 대상(richtext.html 과 동형).
  if (typeof clone.textHtml === 'string') clone.textHtml = sanitizeAiHtml(clone.textHtml);
  if (typeof clone.promptHtml === 'string') clone.promptHtml = sanitizeAiHtml(clone.promptHtml);
  if (clone.answerKey && typeof clone.answerKey.html === 'string') {
    clone.answerKey = { ...clone.answerKey, html: sanitizeAiHtml(clone.answerKey.html) };
  }
  return clone;
}

// ══════════════════════════ AI 패널 ══════════════════════════

/**
 * @param {{
 *   entryHost: HTMLElement,           // #ai-entry-slot — 앱 바 진입 버튼을 마운트
 *   getSelectionState: () => {selectedIds:Set<string>, editingId:string|null},
 *   findObject: (id:string) => {obj:object}|null,
 *   excludedTypes: Iterable<string>,  // shell.excludedAiTypes(std-box·passage-slot)
 *   getRenderMeta: () => object,      // reflow.js#buildRenderMeta(core.getDocument()) 재사용
 *   getDoc: () => Document|null,      // 현재 teacher iframe contentDocument(배지 DOM 조작용)
 *   onApply: ({mode:'replace'|'insert', updates:Array<{id:string,object:object}>}) => Promise<{ids:string[]}>,
 * }} deps
 */
export function createAiPanel(deps) {
  const excludedSet = new Set(deps.excludedTypes || []);
  const freshIds = new Set();
  let state = null; // null = 닫힘

  const panelHost = document.createElement('div');
  panelHost.id = 'ai-panel-host';
  document.body.appendChild(panelHost);

  const entryBtn = el('button', {
    type: 'button', id: 'btn-ai', class: 'appbar-btn ai-entry-btn', title: 'AI 로 편집(개체 선택 필요)', text: 'AI',
  });
  entryBtn.disabled = true;
  entryBtn.addEventListener('click', () => {
    const ids = [...(deps.getSelectionState().selectedIds || [])];
    if (ids.length === 0) return;
    openFor(ids);
  });
  deps.entryHost.appendChild(entryBtn);

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
    entryBtn.disabled = list.length === 0 || hasExcluded;
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

  function buildCopyText() {
    if (!state) return '';
    const objectsSummary = state.targets.map((t) => `${t.obj.type}(${t.id})`).join(', ');
    const lines = [
      `[worksheet-grab AI 요청] id=${state.currentRequestId}`,
      `대상 개체: ${objectsSummary}`,
      `액션: rewrite`,
      `지시: ${state.instruction || '(프리셋 지시 없음)'}`,
    ];
    if (hasPassageTarget()) {
      lines.push('', '⚠ 저작권 제약: 실존 저작물의 원문을 그대로 재현하지 마세요 — 순수 창작 또는 재구성(수준 조정·요약)만 허용됩니다.');
    }
    lines.push(
      '',
      `회신 방법(구독 AI 세션): worksheet-grab ai respond ${state.currentRequestId} --objects <file.json>`,
      `file.json 형식: [{"id":"${state.targets[0]?.id || ''}","object":{…수정된 개체 전체(id·type 포함, 스키마 준수)}}, …]`,
      '요청 objects[] 각 원소의 id 를 응답에 그대로 에코해야 재부착됩니다(위치/순서 매칭 아님).',
    );
    return lines.join('\n');
  }

  async function sendRequest(instruction, context = {}) {
    if (!state || state.phase === 'blocked') return;
    state.instruction = instruction;
    state.context = context;
    state.phase = 'waiting';
    state.error = null;
    render();
    let res;
    try {
      res = await fetch('/ai/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rewrite', instruction, context,
          objects: state.targets.map((t) => ({ ...t.obj })),
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
        if (body.status === 'answered') {
          applyResponseAsVersion(id, body.response);
          return;
        }
      } catch { /* 일시 오류 — 창 안에서 재시도 */ }
      await wait(elapsed > 20000 ? 2000 : 600);
    }
  }

  function applyResponseAsVersion(requestId, response) {
    if (!state || state.currentRequestId !== requestId) return;
    const echoed = Array.isArray(response?.objects) ? response.objects : [];
    const byId = new Map(echoed.map((o) => [o.id, o.object]));
    const items = state.targets.map((t) => {
      const raw = byId.get(t.id);
      const valid = raw && typeof raw === 'object' && raw.id === t.id && raw.type === t.obj.type;
      return { id: t.id, before: t.obj, after: valid ? sanitizeObject(raw) : null };
    });
    state.versions.push({ requestId, items });
    state.versionIndex = state.versions.length - 1;
    state.phase = 'preview';
    state.error = items.every((it) => !it.after) ? 'AI 응답에 대상 개체 id 가 하나도 매칭되지 않았습니다(개체 ID 에코 확인 필요).' : null;
    render();
  }

  function regenerate() {
    if (!state || !state.instruction) return;
    sendRequest(state.instruction, state.context);
  }

  async function applyCurrent(mode) {
    if (!state || state.phase !== 'preview') return;
    const version = state.versions[state.versionIndex];
    const updates = version.items.filter((it) => it.after).map((it) => ({ id: it.id, object: it.after }));
    if (updates.length === 0) { state.error = '적용할 AI 결과가 없습니다.'; render(); return; }
    const allRequestIds = [...state.requestIds];
    const appliedRequestId = version.requestId;
    const result = await deps.onApply({ mode, updates });
    markFresh(result?.ids || updates.map((u) => u.id));
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
    return el('div', {
      class: 'ai-blocked', id: 'ai-blocked',
      text: `"${state.blockedType}" 개체는 AI 대상이 아닙니다 — 성취기준 원문은 보존됩니다(§7, 원칙 3).`,
    });
  }

  function composeView() {
    const wrap = el('div', { class: 'ai-compose' });
    wrap.appendChild(el('div', {
      class: 'ai-targets-summary', id: 'ai-targets-summary',
      text: `대상: ${state.targets.map((t) => t.obj.type).join(', ')} (${state.targets.length}개)`,
    }));
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

  function previewItemCard(item) {
    const card = el('div', { class: 'ai-preview-card', 'data-ai-preview-id': item.id });
    const row = el('div', { class: 'ai-preview-row' });
    const beforeCol = el('div', { class: 'ai-preview-col ai-preview-before' }, [
      el('h4', { text: `원본 · ${item.before.type}` }),
      el('div', { class: 'ai-preview-render', html: renderObjectFragment(item.before, deps.getRenderMeta()) }),
    ]);
    const afterCol = el('div', { class: 'ai-preview-col ai-preview-after' }, [
      el('h4', { text: 'AI 결과' }),
      el('div', {
        class: 'ai-preview-render',
        html: item.after ? renderObjectFragment(item.after, deps.getRenderMeta()) : '<em>(이 개체에 대한 응답 없음)</em>',
      }),
    ]);
    row.append(beforeCol, afterCol);
    card.appendChild(row);
    card.appendChild(el('div', {
      class: 'ai-diff', id: `ai-diff-${item.id}`,
      html: item.after ? diffToHtml(objectDisplayText(item.before), objectDisplayText(item.after)) : '',
    }));
    return card;
  }

  function versionNav() {
    const nav = el('div', { class: 'ai-version-nav' });
    const prevBtn = el('button', { type: 'button', id: 'ai-version-prev', text: '◀' });
    prevBtn.disabled = state.versionIndex <= 0;
    prevBtn.addEventListener('click', () => { state.versionIndex -= 1; render(); });
    const label = el('span', { id: 'ai-version-label', text: `${state.versionIndex + 1} / ${state.versions.length}` });
    const nextBtn = el('button', { type: 'button', id: 'ai-version-next', text: '▶' });
    nextBtn.disabled = state.versionIndex >= state.versions.length - 1;
    nextBtn.addEventListener('click', () => { state.versionIndex += 1; render(); });
    nav.append(prevBtn, label, nextBtn);
    return nav;
  }

  function actionsRow() {
    const row = el('div', { class: 'ai-actions' });
    const replaceBtn = el('button', { type: 'button', id: 'ai-apply-replace', text: '교체' });
    replaceBtn.addEventListener('click', () => applyCurrent('replace'));
    const insertBtn = el('button', { type: 'button', id: 'ai-apply-insert', text: '아래 삽입' });
    insertBtn.addEventListener('click', () => applyCurrent('insert'));
    const regenBtn = el('button', { type: 'button', id: 'ai-regenerate', text: '재생성' });
    regenBtn.addEventListener('click', () => regenerate());
    const cancelBtn = el('button', { type: 'button', id: 'ai-cancel-preview', text: '취소' });
    cancelBtn.addEventListener('click', () => closePanel({ cancel: true }));
    row.append(replaceBtn, insertBtn, regenBtn, cancelBtn);
    return row;
  }

  function previewView() {
    const wrap = el('div', { class: 'ai-preview' });
    if (state.error) wrap.appendChild(el('div', { class: 'ai-error', id: 'ai-error', text: state.error }));
    const version = state.versions[state.versionIndex];
    for (const item of version.items) wrap.appendChild(previewItemCard(item));
    if (state.versions.length > 1) wrap.appendChild(versionNav());
    wrap.appendChild(actionsRow());
    return wrap;
  }

  function render() {
    panelHost.replaceChildren();
    if (!state) return;
    const panel = el('div', { class: 'ai-panel', id: 'ai-panel', 'data-ai-phase': state.phase });
    panel.appendChild(headerRow());
    if (state.phase === 'blocked') panel.appendChild(blockedView());
    else if (state.phase === 'compose') panel.appendChild(composeView());
    else if (state.phase === 'waiting') panel.appendChild(waitingView());
    else if (state.phase === 'preview') panel.appendChild(previewView());
    panelHost.appendChild(panel);
  }

  function openFor(ids) {
    const uniqueIds = [...new Set(ids)];
    const targets = uniqueIds.map((id) => ({ id, obj: deps.findObject(id)?.obj })).filter((t) => !!t.obj);
    if (targets.length === 0) return;
    const excludedTarget = targets.find((t) => excludedSet.has(t.obj.type));
    state = {
      phase: excludedTarget ? 'blocked' : 'compose',
      targets,
      blockedType: excludedTarget?.obj?.type || null,
      instruction: '', context: {}, currentRequestId: null, requestIds: new Set(),
      versions: [], versionIndex: 0, error: null,
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
