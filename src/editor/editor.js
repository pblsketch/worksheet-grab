// 에디터(S4.3) 클라이언트 — 바닐라 ESM, 빌드 0. US-16/17(개체 우선 조작 코어·리플로우)을 그대로
// 소비하며 신 UI 셸(앱 바·컨텍스트 툴바·좌 3탭·우 인스펙터·캔버스 인라인)을 조립한다.
//
// 원칙: /shell.json 의 개체 트리(document)가 단일 진실 — core.js 가 메모리에 들고, selection.js 가
// 클릭=선택/더블클릭=편집을 담당하며, history.js 가 조작을 인메모리 undo/redo 한다. 저장은 명시
// Ctrl+S 와 유휴 자동 체크포인트(30초)뿐(S2.4). 구조 변경(삽입·삭제·순서·용지)은 objectFactory.js
// 의 순수 연산으로 다음 문서를 계산한 뒤 applyDocOp() 한 곳으로 몰아 reload→select→commit→
// review→reflow 순서를 항상 동일하게 유지한다.
import { createDocumentStore } from '/editor/core.js';
import { createSelectionController } from '/editor/selection.js';
import { createHistory } from '/editor/history.js';
import { reflowDocument, buildFullHtml, buildRenderMeta, extractStyleTag } from '/editor/reflow.js';
import { createLeftPanel } from '/editor/leftPanel.js';
import { createInspector } from '/editor/inspector.js';
import { createContextToolbar } from '/editor/contextToolbar.js';
import { createCanvasInline } from '/editor/canvasInline.js';
import { createTableEditor } from '/editor/tableEdit.js';
import { createPartEditor } from '/editor/partEdit.js';
import { createAiPanel } from '/editor/ai.js';
import { createPageActionHandler } from '/editor/pageOperations.js';
import { attachComposition, isComposing, onCompositionEnd, releaseComposition } from '/editor/composition.js';
import * as ObjOps from '/editor/objectFactory.js';
import { ValidateWorksheet } from '/src/usecases/ValidateWorksheet.js';

const shell = await (await fetch('/shell.json')).json();
const stage = document.getElementById('stage');

// S4.2(M4a) 리플로우 — teacher 문서의 <style> 원문을 최초 1회 뽑아 둔다(리플로우 측정용 숨은
// iframe·전체 재렌더 모두 이 CSS 를 그대로 재사용 — 서버에 별도 자산 엔드포인트를 추가하지 않는다).
const teacherStyleTag = extractStyleTag(shell.teacherHtml);

const docTitleEl = document.getElementById('doc-title');
docTitleEl.textContent = shell.docTitle || '(제목 없음)';

// ── 상태: 개체 트리(core) · 선택/편집(selection) · 되돌리기(history) ──
const core = createDocumentStore(shell.document);
let currentRevision = shell.meta?.revision ?? null;
let dirty = false; // 마지막 저장 이후 편집 여부(자동저장·beforeunload 가드 기준)
let studentStale = false; // US-E1: 교사 편집 후 학생용 미리보기가 최신 편집을 반영하지 못하는 상태
let autosaveTimer = null;
let activePageId = core.getDocument().pages?.[0]?.id ?? null;

function renderRev() {
  document.getElementById('doc-rev').textContent = currentRevision == null ? '' : `rev ${currentRevision}`;
}
renderRev();

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 조건이 참이 될 때까지 폴링(렌더 테스트 시드 전용 — US-19 AI 왕복은 서버 폴링을 거쳐 비동기로
 *  완결되므로 고정 sleep 대신 조건 폴링으로 대기한다). */
async function pollUntil(predicate, { timeoutMs = 30000, intervalMs = 150 } = {}) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('pollUntil: 시간 내 조건이 충족되지 않았습니다.');
    await wait(intervalMs);
  }
}

/** 유휴 30초 자동 체크포인트(S2.4 계약) — 편집마다 타이머를 재설정한다(디바운스). */
function resetAutosaveTimer() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { if (dirty) save(); }, 30000);
}
function markDirty() {
  dirty = true;
  studentStale = true; // US-E1: 편집이 생겼으니 학생용 미리보기는 다음 전환 때 다시 렌더해야 한다.
  resetAutosaveTimer();
}

function resolveActivePageId(documentState, preferredPageId = activePageId, fallbackIndex = 0) {
  const pages = documentState.pages || [];
  if (preferredPageId && pages.some((page) => page.id === preferredPageId)) return preferredPageId;
  return pages[Math.min(Math.max(fallbackIndex, 0), pages.length - 1)]?.id ?? null;
}

function renderPageThumbs(fallbackIndex = 0) {
  activePageId = resolveActivePageId(core.getDocument(), activePageId, fallbackIndex);
  leftPanel.renderThumbs(frames.teacher?.contentDocument ?? null, core.getDocument().pages || []);
  leftPanel.setActivePage(activePageId);
}

// history.reset()/undo()/redo() 가 문서·DOM 을 되돌린 뒤 화면·툴바를 정합시킨다.
function onHistoryRestore({ pageStructureChanged = false } = {}) {
  selection.refreshVisual();
  canvasInline.refreshDecoration();
  // undo/redo 는 AI 적용 이전/이후 어느 쪽으로도 넘나들 수 있어 어느 개체가 "AI 산출 직후"인지
  // 안전하게 재구성할 수 없다 — 복원마다 배지를 전부 지워 오도(誤導)를 막는다(US-19 졸업 배지).
  aiPanel.clearAllFresh();
  aiPanel.refreshFreshBadges(frames.teacher?.contentDocument ?? null);
  fitFrame(frames.teacher);
  markDirty();
  runReview();
  updateAll();
  renderPageThumbs();
  scrollToPage(activePageId);
  if (!pageStructureChanged) scheduleReflow();
}

const history = createHistory({
  core,
  getDoc: () => frames.teacher?.contentDocument ?? null,
  captureUiState: () => ({ activePageId }),
  restoreUiState: (state) => { activePageId = state?.activePageId ?? null; },
  onRestore: onHistoryRestore,
});

/** selection.js 가 편집·이동을 감지할 때마다 호출 — 텍스트는 유휴 코얼레싱, 이동은 즉시 커밋. */
function onSelectionDirty(kind) {
  // 편집 중인 개체가 직전에 AI 적용을 받았다면 이 순간 "일반 콘텐츠"로 졸업한다(US-19 배지 제거).
  if (selection.state.editingId) aiPanel.clearFresh(selection.state.editingId);
  if (kind === 'text') { history.noteInput(); scheduleReflow(); } else { history.commit(); }
  markDirty();
  updateAll();
}
function onSelectionChange() {
  updateAll();
}

const selection = createSelectionController({
  core,
  onDirty: onSelectionDirty,
  onSelectionChange,
  // #2(2차) 자유 개체를 다른 페이지로 이관(드롭 지점의 .sheet 로).
  onFloatPageChange: (id, pageIndex, rect) => {
    const next = ObjOps.moveFloatToPage(core.getDocument(), id, pageIndex, rect);
    applyDocOp(next, { selectId: id });
  },
});

// ── S4.2(M4a) flow 리플로우 — 편집 직후 디바운스(300ms) 후 페이지 귀속 재계산 ──
const REFLOW_DEBOUNCE_MS = 300;
let reflowTimer = null;
let reflowInFlight = null;
let reflowQueued = false;
let reflowDeferredByComposition = false;

function scheduleReflow() {
  clearTimeout(reflowTimer);
  reflowTimer = setTimeout(() => { runReflow(); }, REFLOW_DEBOUNCE_MS);
}

// 조합이 끝나면 미뤄둔 리플로우를 다시 예약한다. selection/tableEdit/partEdit 의 compositionend
// 동기화가 onDirty('text') 로 예약해 주는 경우가 대부분이지만, 편집 대상이 없는 경로(구조 변경이
// 조합 중에 겹친 경우)에서 리플로우가 영영 유실되지 않도록 여기서 한 번 더 보장한다.
onCompositionEnd(() => {
  if (!reflowDeferredByComposition) return;
  reflowDeferredByComposition = false;
  scheduleReflow();
});

/** 리플로우 1회 실행: 측정→재배정→(바뀌었으면) 문서·DOM 갱신→즉시 커밋. 동시 실행은 직렬화한다. */
function runReflow() {
  // IME 조합 중에는 절대 DOM 을 갈아끼우지 않는다 — 조합 중 노드 교체는 확정 시 문자 중복을
  // 만든다(composition.js 주석의 CDP 실조합 재현: '학' → '학학'). 조합이 끝나면 위 onCompositionEnd
  // 훅이 다시 예약한다.
  if (isComposing()) { reflowDeferredByComposition = true; return; }
  if (reflowInFlight) { reflowQueued = true; return reflowInFlight; }
  const run = (async () => {
    try {
      const teacherDoc = frames.teacher?.contentDocument;
      if (!teacherDoc) return;
      const doc = core.getDocument();
      const activeIndexBefore = Math.max(0, (doc.pages || []).findIndex((page) => page.id === activePageId));
      const { document: nextDoc, changed } = await reflowDocument(doc, { styleTag: teacherStyleTag, tolerancePx: 2 });
      bumpDataset('reflowRuns');
      if (!changed) return;
      // 진입 시점 검사만으로는 부족하다 — 측정(await reflowDocument)이 도는 동안 교사가 조합을
      // 시작했을 수 있고, 그 상태로 아래 <body> 치환이 들어가면 조합 중 노드가 교체돼 문자가
      // 중복된다(US-P3-1 과 같은 실패 모드). DOM 을 건드리기 직전에 한 번 더 확인한다.
      if (isComposing()) { reflowDeferredByComposition = true; return; }
      core.setDocument(nextDoc);
      // srcdoc 교체는 편집 포커스를 파괴한다 — 재로드 전 캐럿을 캡처했다가 복원하지 않으면
      // 리플로우 직후의 타이핑이 body 로 흘러 조용히 사라진다.
      const caret = selection.captureCaret();
      await reloadTeacherFrame(nextDoc);
      selection.refreshVisual();
      canvasInline.refreshDecoration();
      aiPanel.refreshFreshBadges(frames.teacher?.contentDocument ?? null);
      fitFrame(frames.teacher);
      selection.restoreCaret(caret);
      activePageId = resolveActivePageId(nextDoc, activePageId, activeIndexBefore);
      renderPageThumbs(activeIndexBefore);
      history.commit();
      bumpDataset('reflowChanges');
    } catch (e) {
      console.error('리플로우 실패:', e);
    } finally {
      reflowInFlight = null;
      if (reflowQueued) { reflowQueued = false; scheduleReflow(); }
    }
  })();
  reflowInFlight = run;
  return run;
}

function bumpDataset(key) {
  document.body.dataset[key] = String((Number(document.body.dataset[key]) || 0) + 1);
}

/** 새 pages[] 를 반영해 teacher iframe 을 다시 그린다. 같은 iframe 에 srcdoc 을 덮으면 문서가
 *  헐렸다가 다시 그려져 흰 화면이 한 번 깜빡인다(삽입·삭제·붙여넣기·리플로우 등 모든 구조 변경에서).
 *  대신 <body> 내용만 교체한다 — 동기 DOM 치환이라 흰 깜빡임이 없다. head(스타일)·주입 편집 스타일·
 *  document 레벨 조작 리스너(selection/canvasInline/tableEdit/partEdit·keydown·beforeinput)는 같은
 *  document 라 그대로 유지되므로 재배선하지 않는다(재배선하면 리스너가 중복 누적된다). 호출부
 *  (applyDocOp/runReflow)가 이후 refreshVisual/refreshDecoration/updateAll 로 새 내용에 맞춰 장식·
 *  툴바를 갱신한다. body 의 뷰 상태 클래스(wg-show-*)·격자 알파는 attribute 라 innerHTML 치환에
 *  영향받지 않는다. KaTeX 문서만 수식을 수동 재렌더한다(innerHTML 로 삽입된 <script> 는 실행 안 됨). */
function reloadTeacherFrame(nextDoc) {
  const f = frames.teacher;
  if (!f || !f.contentDocument?.body) return Promise.resolve();
  const doc = f.contentDocument;
  const html = buildFullHtml(nextDoc, { renderMeta: buildRenderMeta(nextDoc), styleTag: teacherStyleTag });
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  doc.body.innerHTML = parsed.body.innerHTML;
  // 치환으로 조합 중이던 노드가 사라지면 compositionend 가 오지 않을 수 있다 — 여기서 풀지
  // 않으면 조합 플래그가 굳어 리플로우가 영구히 멈춘다.
  releaseComposition();
  const win = f.contentWindow;
  if (win && typeof win.renderMathInElement === 'function') {
    try {
      win.renderMathInElement(doc.body, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      });
    } catch { /* KaTeX 재렌더 실패 무시(수식 없는 문서·설정 차이) */ }
  }
  runReview();
  return Promise.resolve();
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── 캔버스: teacher(편집)/student(파생 미리보기) iframe 지연 생성 ──
const frames = { teacher: null, student: null };
let mode = 'teacher';
const viewState = { margins: true, ruler: true, grid: false, gridAlpha: 0.08 };

function ensureFrame(m) {
  if (frames[m]) return Promise.resolve(frames[m]);
  return new Promise((resolveFrame) => {
    const f = document.createElement('iframe');
    f.dataset.mode = m;
    f.className = 'hidden';
    stage.appendChild(f);
    frames[m] = f;
    f.addEventListener('load', () => {
      if (m === 'teacher') initTeacherEditing(f);
      else applyViewState();
      fitFrame(f);
      resolveFrame(f);
    }, { once: true });
    f.srcdoc = shell[`${m}Html`];
  });
}

function fitFrame(f) {
  if (!f) return;
  const doc = f.contentDocument;
  if (doc && doc.documentElement) f.style.height = `${doc.documentElement.scrollHeight}px`;
}

function applyViewState() {
  for (const f of Object.values(frames)) {
    const d = f?.contentDocument;
    if (!d?.body) continue;
    d.body.classList.toggle('wg-show-margins', viewState.margins);
    d.body.classList.toggle('wg-show-ruler', viewState.ruler);
    d.body.classList.toggle('wg-show-grid', viewState.grid);
    d.body.style.setProperty('--wg-grid-alpha', String(viewState.gridAlpha ?? 0.08));
  }
  // 눈금자(#2) DOM 은 teacher 문서에만 그린다(편집 보조) — 토글 즉시 반영되도록 재장식한다.
  canvasInline.refreshDecoration();
}

/** 개체 경계 시각화(선택/편집 외곽선) + float 미선택 pointer-events:none 정책 + flow 오버레이
 *  핸들/삽입버튼 스타일을 iframe head 에 주입한다. 부모 CSS(editor.css)는 iframe 내부에 닿지 않는다. */
function injectEditorStyle(doc) {
  const style = doc.createElement('style');
  style.id = 'wg-editor-style';
  style.textContent = `
    .sheet { position: relative; }
    [data-oid] { cursor: pointer; }
    [data-oid].wg-selected { outline: 2px solid #2563eb; outline-offset: 1px; }
    [data-oid].wg-editing { outline: 2px solid #dc2626 !important; background: rgba(255,235,59,.08); }
    [contenteditable="true"] { outline: 2px solid #dc2626 !important; cursor: text; }
    .wg-float:not(.wg-selected) { pointer-events: none; }
    /* 미선택 자유 개체의 "내용"은 클릭 가능(개체 몸통 클릭=선택, 이어서 드래그=이동 — 슬라이드/캔바
       관례). 래퍼 자신은 pointer-events:none 을 유지해 내용이 없는 빈 영역은 아래 flow 로 클릭이
       통과한다(스파이크 §4-5 z-order 완화 취지 보존 — 내용 위 클릭만 개체를 잡는다). 드래그 역학은
       ⠿ 핸들 경로와 동일(pointerdown → startFloatDrag: 선택 후 이동, 실마우스 검증된 pointer capture). */
    .wg-float:not(.wg-selected) > * { pointer-events: auto; }
    .wg-float.wg-selected, .wg-float.wg-editing { pointer-events: auto; cursor: grab; }
    .wg-float-handle {
      position: absolute; top: -9px; left: -9px; width: 18px; height: 18px; z-index: 5;
      display: flex; align-items: center; justify-content: center;
      background: #111827; color: #fff; border-radius: 4px; font-size: 11px;
      pointer-events: auto; cursor: grab; user-select: none;
    }
    /* 자유 개체 8방향 리사이즈 손잡이(#8) — 단일 선택·비편집 상태에서만 selection.js 가 붙인다. */
    .wg-resize-handle {
      position: absolute; width: 11px; height: 11px; z-index: 7; background: #2563eb;
      border: 1.5px solid #fff; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.2);
      pointer-events: auto; user-select: none;
    }
    .wg-rh-nw { top: -6px; left: -6px; cursor: nwse-resize; }
    .wg-rh-n  { top: -6px; left: calc(50% - 5.5px); cursor: ns-resize; }
    .wg-rh-ne { top: -6px; right: -6px; cursor: nesw-resize; }
    .wg-rh-e  { top: calc(50% - 5.5px); right: -6px; cursor: ew-resize; }
    .wg-rh-se { bottom: -6px; right: -6px; cursor: nwse-resize; }
    .wg-rh-s  { bottom: -6px; left: calc(50% - 5.5px); cursor: ns-resize; }
    .wg-rh-sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .wg-rh-w  { top: calc(50% - 5.5px); left: -6px; cursor: ew-resize; }
    /* 문항 선지·항목 인라인 편집(#3 2차) */
    .q-part[data-part] { cursor: text; }
    .q-part.wg-part-editing { outline: 2px solid #dc2626; background: rgba(255,235,59,.12); border-radius: 3px; }
    /* 표 셀 편집·병합·열 너비(#10) */
    td[data-r], th[data-r] { cursor: text; }
    .wg-cell-active { outline: 2px solid #2563eb !important; outline-offset: -2px; background: rgba(37,99,235,.07); }
    .wg-cell-editing { outline: 2px solid #dc2626 !important; background: rgba(255,235,59,.10); }
    .wg-col-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
    .wg-col-handle { position: absolute; top: 0; bottom: 0; width: 7px; pointer-events: auto; cursor: col-resize; }
    .wg-col-handle::after { content: ""; position: absolute; left: 3px; top: 0; bottom: 0; width: 1px; background: #2563eb; opacity: .3; }
    .wg-col-handle:hover::after { opacity: 1; width: 2px; }
    .wg-flow-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
    .wg-flow-handle {
      position: absolute; left: -22px; width: 18px; height: 18px; display: flex; align-items: center;
      justify-content: center; background: #374151; color: #fff; border-radius: 4px; font-size: 11px;
      opacity: .35; pointer-events: auto; cursor: grab; user-select: none;
    }
    .wg-flow-handle:hover { opacity: 1; }
    .wg-flow-insert {
      position: absolute; left: -22px; width: 18px; height: 18px; border: 0; border-radius: 4px;
      background: #2563eb; color: #fff; font-size: 13px; line-height: 1; opacity: .35;
      pointer-events: auto; cursor: pointer;
    }
    .wg-flow-insert:hover { opacity: 1; }
    /* 기본 개체 연속 드래그 재정렬 중 시각 피드백(#1·#2 2차) */
    .wg-flow-dragging { opacity: .55; outline: 2px dashed #2563eb; outline-offset: 1px; }
    body.wg-show-margins .sheet::after {
      content: ""; position: absolute; inset: var(--sheet-pad, 12mm 15mm 10mm 15mm);
      border: 1px dashed rgba(37,99,235,.55); pointer-events: none; z-index: 3;
    }
    /* 격자(#1) — 투명도는 --wg-grid-alpha(툴바 보기 메뉴 슬라이더가 body 에 세팅) 로 조절한다. */
    body.wg-show-grid .sheet {
      background-image:
        repeating-linear-gradient(0deg, rgba(37,99,235,var(--wg-grid-alpha,.08)) 0 1px, transparent 1px 5mm),
        repeating-linear-gradient(90deg, rgba(37,99,235,var(--wg-grid-alpha,.08)) 0 1px, transparent 1px 5mm);
    }
    /* 눈금자(#2) — canvasInline.decorateRulers 가 .sheet 마다 상단·좌측 자를 붙이고, 여기 CSS 가
       body.wg-show-ruler 일 때만 표시한다. 눈금·숫자는 mm 단위로 배치해 줌 변형과 함께 스케일된다. */
    .wg-ruler-top, .wg-ruler-left { display: none; }
    body.wg-show-ruler .wg-ruler-top, body.wg-show-ruler .wg-ruler-left {
      display: block; position: absolute; z-index: 4; pointer-events: none;
      background: rgba(248,250,252,.92); color: #64748b; font-size: 7px; line-height: 1;
    }
    body.wg-show-ruler .wg-ruler-top {
      top: 0; left: 0; right: 0; height: 5.2mm; border-bottom: 1px solid #cbd5e1;
      background-image: repeating-linear-gradient(90deg, #94a3b8 0 1px, transparent 1px 5mm);
    }
    body.wg-show-ruler .wg-ruler-left {
      top: 0; left: 0; bottom: 0; width: 5.2mm; border-right: 1px solid #cbd5e1;
      background-image: repeating-linear-gradient(0deg, #94a3b8 0 1px, transparent 1px 5mm);
    }
    .wg-ruler-num { position: absolute; color: #475569; }
    .wg-ruler-top .wg-ruler-num { top: 0.7mm; transform: translateX(1px); }
    .wg-ruler-left .wg-ruler-num { left: 0.6mm; transform: translateY(-3px); }
    /* US-19 AI 산출 졸업 배지 — data-ai-fresh는 일시적: 사용자가 그 개체를 편집하는 순간 제거된다. */
    [data-ai-fresh="true"] { position: relative; }
    [data-ai-fresh="true"]::after {
      content: "AI"; position: absolute; top: -8px; right: -8px; z-index: 6;
      background: #7c3aed; color: #fff; font-size: 9px; font-weight: 800; line-height: 1;
      padding: 3px 4px; border-radius: 4px; pointer-events: none;
    }
  `;
  doc.head.appendChild(style);
}

/** teacher iframe 로드마다 조작 리스너를 새로 배선한다. */
function initTeacherEditing(f, { resetHistory = true } = {}) {
  const doc = f.contentDocument;
  injectEditorStyle(doc);
  attachComposition(doc); // IME 조합 게이트를 가장 먼저 건다(리플로우·되읽기 억제의 근거).
  selection.attach(doc);
  canvasInline.attach(doc, f);
  tableEditor.attach(doc);
  partEditor.attach(doc);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); history.undo(); updateAll(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); history.redo(); updateAll(); }
  });
  if (resetHistory) history.reset();
  applyViewState();
  runReview();
  updateAll();
  renderPageThumbs();
}

/** 선택된 개체(단일/다중)를 문서에서 제거한다(#7 Delete/Backspace). 리플로우 예약(빈 자리 재계산). */
function deleteSelectedObjects() {
  const ids = [...selection.state.selectedIds];
  if (ids.length === 0) return;
  let next = core.getDocument();
  for (const id of ids) next = ObjOps.removeObject(next, id);
  selection.clearAll();
  applyDocOp(next, { reflow: true });
}

/** 텍스트 편집 중이거나 폼 필드/제목에 포커스가 있으면 개체 단축키(삭제·넛지·복사/붙여넣기)를
 *  가로채지 않는다 — 정상 글자 입력/삭제/복사가 우선(#7·US-E2·US-E3 공통 가드). */
function isTypingContext() {
  if (selection.state.editingId) return true;
  const ae = document.activeElement;
  return !!(ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)));
}

/** 단일 선택된 float 개체를 dxMm/dyMm 넛지한다(US-E2). 전체 재로드 없이 라이브 DOM 의 해당
 *  float 좌표만 갱신하고(드래그 커밋과 동형 — flow 경계 불변이라 리플로우 불필요) history 1 op 로
 *  확정한다. nudgeFloat 순수 연산으로 다음 문서를 계산해 core 에 반영한다. */
function nudgeSelectedFloat(dxMm, dyMm) {
  const id = currentSingleSelectedId();
  const found = id ? core.findObject(id) : null;
  if (!found || found.obj.placement !== 'float' || !found.obj.rect) return false;
  const next = ObjOps.nudgeFloat(core.getDocument(), id, dxMm, dyMm);
  core.setDocument(next);
  const nObj = core.findObject(id)?.obj;
  const doc = frames.teacher?.contentDocument;
  const escId = window.CSS && CSS.escape ? CSS.escape(id) : id;
  const el = doc?.querySelector(`[data-oid="${escId}"]`);
  if (el && nObj?.rect) { el.style.left = `${nObj.rect.xMm}mm`; el.style.top = `${nObj.rect.yMm}mm`; }
  history.commit();
  markDirty();
  updateAll();
  return true;
}

const NUDGE_DELTAS = Object.freeze({
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
});

// US-E3: 개체 복사·붙여넣기용 인메모리 클립보드. 시스템 클립보드가 아니라 앱 내부 버퍼 —
// 개체 트리 구조를 통째로 담아 같은 문서 안 다른 위치/페이지로 재삽입한다(원본은 지워져도 무관).
let objectClipboard = [];

/** 선택된 개체(단일/다중)를 클립보드에 깊은 복사한다(Ctrl+C). 편집/폼 컨텍스트나 빈 선택이면 무동작. */
function copySelectedObjects() {
  const ids = [...selection.state.selectedIds];
  if (ids.length === 0) return false;
  const clones = [];
  for (const id of ids) {
    const found = core.findObject(id);
    if (found) clones.push(structuredClone(found.obj));
  }
  if (clones.length === 0) return false;
  objectClipboard = clones;
  return true;
}

/** 클립보드 개체를 새 id 로 붙여넣는다(Ctrl+V). flow 는 현재 선택 개체 뒤(없으면 마지막 페이지 끝),
 *  float 은 +8mm 오프셋으로 현재 선택 개체의 페이지에 삽입한다 — 앵커가 현재 선택이므로 다른
 *  페이지의 개체를 고른 뒤 붙여넣으면 그 페이지로 들어간다(페이지 간 붙여넣기). applyDocOp 단일
 *  관문·리플로우 예약을 거치고 첫 새 개체를 선택한다. */
async function pasteObjects() {
  if (objectClipboard.length === 0) return false;
  const anchorId = currentSingleSelectedId();
  let next = core.getDocument();
  let runningAnchor = anchorId;
  const newIds = [];
  for (const src of objectClipboard) {
    const obj = { ...structuredClone(src), id: ObjOps.generateId(src.type) };
    if (obj.placement === 'float') {
      if (obj.rect) obj.rect = { ...obj.rect, xMm: (obj.rect.xMm || 0) + 8, yMm: (obj.rect.yMm || 0) + 8 };
      next = ObjOps.insertFloat(next, obj, { nearId: anchorId });
    } else {
      next = ObjOps.insertFlow(next, obj, { afterId: runningAnchor });
      runningAnchor = obj.id; // 다음 개체는 방금 붙여넣은 개체 뒤(붙여넣기 순서 보존)
    }
    newIds.push(obj.id);
  }
  selection.clearAll();
  await applyDocOp(next, { reflow: true, selectId: newIds[0] ?? null });
  return true;
}

function onKeydown(e) {
  if (e.key === 'Escape') return; // selection.js 가 자체 처리
  // Delete/Backspace = 선택 개체 삭제(#7). 단, 텍스트 편집 중이거나 폼 필드/제목 편집에 포커스가
  // 있으면 개입하지 않는다(정상 글자 삭제가 우선). 개체 선택만 된 상태에서만 개체를 지운다.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isTypingContext()) return;
    if (selection.state.selectedIds.size === 0) return;
    e.preventDefault();
    deleteSelectedObjects();
    return;
  }
  // 방향키 = 단일 선택된 자유 개체 미세 이동(1mm, Shift=10mm) — US-E2. 텍스트/폼 편집 중엔 무개입.
  if (NUDGE_DELTAS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (isTypingContext()) return;
    const [dx, dy] = NUDGE_DELTAS[e.key];
    const step = e.shiftKey ? 10 : 1;
    if (nudgeSelectedFloat(dx * step, dy * step)) e.preventDefault();
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    save();
  } else if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    history.undo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    history.redo();
  } else if (key === 'c') {
    // 개체 복사(US-E3) — 텍스트 편집/폼 컨텍스트면 브라우저 기본 복사가 우선.
    if (isTypingContext()) return;
    if (copySelectedObjects()) e.preventDefault();
  } else if (key === 'v') {
    // 개체 붙여넣기(US-E3) — 텍스트 편집/폼 컨텍스트면 브라우저 기본 붙여넣기가 우선.
    if (isTypingContext()) return;
    if (objectClipboard.length) { e.preventDefault(); pasteObjects(); }
  }
}
window.addEventListener('keydown', onKeydown);

async function setMode(m) {
  mode = m;
  document.getElementById('btn-teacher').classList.toggle('active', m === 'teacher');
  document.getElementById('btn-student').classList.toggle('active', m === 'student');
  const f = await ensureFrame(m);
  // US-E1: 학생용 미리보기는 교사 편집을 반영해야 한다 — 편집이 있었으면(studentStale) 저장 후
  // 서버가 새로 조립한 studentHtml 로 프레임을 교체한다(초기 스냅샷 재사용 금지 = stale 방지).
  if (m === 'student' && studentStale) await refreshStudentFrame();
  for (const [name, frame] of Object.entries(frames)) {
    if (frame) frame.classList.toggle('hidden', name !== m);
  }
  fitFrame(frames[m] || f);
  document.body.dataset.mode = m;
}

/** 학생용 미리보기를 현재 저장 문서 기준으로 다시 렌더한다(US-E1 — stale 제거). dirty 면 먼저
 *  저장해 서버 student 변형(BuildVariants.executeObjectTree, 정답 물리 제거)이 최신 편집을 담게 한
 *  뒤, /shell.json 이 새로 조립한 studentHtml 로 프레임 srcdoc 를 교체한다. 네트워크 실패 시 기존
 *  프레임을 유지한다(그레이스풀 — 오래된 미리보기라도 보여주되 stale 플래그는 해제하지 않는다). */
async function refreshStudentFrame() {
  if (!frames.student) return;
  // 저장 실패(네트워크/500)면 서버엔 최신 편집이 없다 — 마지막 저장본으로 교체해 "최신"으로
  // 오표기하지 않도록 조기 반환한다(저장 실패 배너는 save() 가 이미 띄웠고 studentStale 는 유지된다).
  if (dirty && !(await save())) return;
  let html = null;
  try {
    const fresh = await (await fetch(`/shell.json?_=${Date.now()}`)).json();
    html = fresh?.studentHtml ?? null;
  } catch { /* 네트워크 실패 — 기존 프레임 유지 */ }
  if (!html) return;
  await new Promise((resolve) => {
    frames.student.addEventListener('load', () => { applyViewState(); fitFrame(frames.student); resolve(); }, { once: true });
    frames.student.srcdoc = html;
  });
  studentStale = false;
}

document.getElementById('btn-teacher').addEventListener('click', () => setMode('teacher'));
document.getElementById('btn-student').addEventListener('click', () => setMode('student'));

// ══════════════════════════ 선택 상태 → 툴바/인스펙터 반영 ══════════════════════════

function computeSelectionState() {
  const ids = [...selection.state.selectedIds];
  if (ids.length === 0) return { mode: 'none' };
  if (ids.length > 1) return { mode: 'multi', ids };
  const found = core.findObject(ids[0]);
  return found ? { mode: 'single', obj: found.obj } : { mode: 'none' };
}

function currentSingleSelectedId() {
  const ids = [...selection.state.selectedIds];
  return ids.length === 1 ? ids[0] : null;
}

function updateAll() {
  const sel = computeSelectionState();
  aiPanel.refreshEntryState([...selection.state.selectedIds]);
  let tbMode;
  if (sel.mode === 'none') tbMode = 'empty';
  else if (sel.mode === 'multi') tbMode = 'multi';
  else {
    const t = sel.obj.type;
    tbMode = t === 'table' ? 'table' : t === 'image-slot' ? 'image' : t === 'shape' ? 'shape'
      : (selection.state.editingId === sel.obj.id ? 'text' : 'object');
  }
  const editingType = selection.state.editingId ? core.findObject(selection.state.editingId)?.obj?.type ?? null : null;
  contextToolbar.render({
    mode: tbMode,
    obj: sel.mode === 'single' ? sel.obj : null,
    ids: sel.mode === 'multi' ? sel.ids : [],
    editingType,
    // US-E4: 더블클릭 편집 가능한 타입(EDIT_FIELD 등재)을 단일 선택했으면 편집 발견성 힌트를 노출.
    editable: sel.mode === 'single' && selection.isEditableType(sel.obj.type),
  });

  if (sel.mode === 'none') {
    inspector.render({ mode: 'document', paper: core.getDocument().paper, findings: reviewFindings });
  } else if (sel.mode === 'multi') {
    const allFloat = sel.ids.every((id) => core.findObject(id)?.obj.placement === 'float');
    inspector.render({ mode: 'multi', ids: sel.ids, allFloat });
  } else {
    inspector.render({ mode: 'object', obj: sel.obj });
  }
  // #10: 표 선택 시 열 너비 손잡이·활성 셀 하이라이트를 선택 상태에 맞춰 갱신(reload 없이).
  tableEditor?.refresh();
}

// ══════════════════════════ 검수 상태 칩(ValidateWorksheet) ══════════════════════════

let reviewFindings = [];
function runReview() {
  try {
    const doc = core.getDocument();
    const html = frames.teacher?.contentDocument?.documentElement?.outerHTML || '';
    const result = new ValidateWorksheet({}).execute(doc, html || undefined);
    reviewFindings = result.findings;
  } catch (e) {
    reviewFindings = [{ rule: 'review-error', severity: 'error', message: String(e?.message || e) }];
  }
  const chip = document.getElementById('btn-review');
  const hasError = reviewFindings.some((f) => f.severity === 'error');
  const hasWarn = reviewFindings.some((f) => f.severity === 'warning');
  const status = hasError ? 'error' : hasWarn ? 'warn' : 'ok';
  chip.dataset.reviewStatus = status;
  chip.dataset.reviewCount = String(reviewFindings.length);
  chip.textContent = status === 'ok' ? '검수 통과' : status === 'warn' ? `검수 경고 ${reviewFindings.length}` : `검수 오류 ${reviewFindings.length}`;
}
document.getElementById('btn-review').addEventListener('click', () => {
  selection.clearAll();
  updateAll();
});

// ══════════════════════════ 문서 조작 단일 관문(applyDocOp) ══════════════════════════

/** 구조 변경(삽입·삭제·순서·속성)의 유일한 관문 — 항상 같은 순서로 반영한다:
 *  core 갱신 → dirty → iframe 재로드 → 선택 복원 → history 커밋 → 검수 재계산 → 툴바/인스펙터
 *  갱신 → 썸네일 갱신 → (필요 시) 리플로우 예약.
 *  ai:true 는 AI 결과 적용 호출(aiPanel 의 onApply)임을 표시 — 이 경우 호출부가 적용 직후 스스로
 *  markFresh() 하므로 여기서 selectId 의 졸업 배지를 지우지 않는다(그 외 모든 사용자 조작 경로는
 *  이 관문 하나만 거치므로, 그 개체가 AI 산출물이었다면 여기서 자동으로 "일반 콘텐츠"로 졸업한다). */
async function applyDocOp(next, {
  reflow = false,
  selectId = null,
  ai = false,
  activePageId: requestedActivePageId = null,
} = {}) {
  const current = core.getDocument();
  if (next === current) return false;
  const activeIndexBefore = Math.max(0, (current.pages || []).findIndex((page) => page.id === activePageId));
  if (requestedActivePageId != null) history.refreshUiState();
  core.setDocument(next);
  markDirty();
  if (!ai && selectId) aiPanel.clearFresh(selectId);
  await reloadTeacherFrame(next);
  canvasInline.refreshDecoration();
  aiPanel.refreshFreshBadges(frames.teacher?.contentDocument ?? null);
  fitFrame(frames.teacher);
  if (selectId) selection.select(selectId);
  else selection.refreshVisual();
  activePageId = resolveActivePageId(next, requestedActivePageId ?? activePageId, activeIndexBefore);
  renderPageThumbs(activeIndexBefore);
  history.commit();
  runReview();
  updateAll();
  if (reflow) scheduleReflow();
  return true;
}

async function doInsert(item, { float = false, afterId = null } = {}) {
  const placement = item.floatOnly ? 'float' : (float ? 'float' : 'flow');
  const obj = ObjOps.createObject(item.type, { placement, qtype: item.qtype });
  const anchorId = afterId ?? currentSingleSelectedId();
  const next = placement === 'float'
    ? ObjOps.insertFloat(core.getDocument(), obj, { nearId: anchorId })
    : ObjOps.insertFlow(core.getDocument(), obj, { afterId: anchorId });
  await applyDocOp(next, { reflow: true, selectId: obj.id });
  return obj.id;
}

// 페이지 add/duplicate/delete/reorder 는 의도적으로 리플로우를 예약하지 않는다 — reflow.js 의 페이지네이션은
// flow 콘텐츠 높이로만 pages[] 개수를 다시 계산하므로(D-A, 페이지는 파생값), 빈 페이지를 추가한 직후
// 리플로우가 돌면 그 빈 페이지가 즉시 사라진다(콘텐츠가 0 이라 assignFlowToPages 가 배정할 이유가
// 없다). 교사가 명시적으로 페이지를 조작하는 동작은 pages[] 를 그대로 존중한다 — 이후
// 텍스트 편집 등 실제 콘텐츠 변경이 있을 때만 리플로우가 자연스럽게 재계산한다.
const handlePageAction = createPageActionHandler({
  getDocument: () => core.getDocument(),
  getActivePageId: () => activePageId,
  applyDocument: applyDocOp,
  operations: ObjOps,
});

// 인라인 서식(B/I/U·색·정렬·글꼴)이 실제로 보존되는 편집 타입 — richtext(html) + title/question
// (textHtml/promptHtml 서식 보존 필드, selection.js syncEditingField 가 살균 HTML 로 되읽음).
const FORMATTABLE_TYPES = new Set(['richtext', 'title', 'question']);

function applyFormat(cmd, value = null) {
  const doc = frames.teacher?.contentDocument;
  const editingId = selection.state.editingId;
  const found = editingId ? core.findObject(editingId) : null;
  if (!doc || !found || !FORMATTABLE_TYPES.has(found.obj.type)) return;
  doc.execCommand(cmd, false, value);
  selection.syncEditingField();
  onSelectionDirty('text');
}

/** 폰트 종류·크기 적용(#3) — richtext 편집 중 선택 범위에만. 크기는 execCommand 가 1~7 만 받으므로
 *  size=7 로 감싼 뒤 그 래퍼만 CSS font-size(pt)로 치환하는 표준 우회를 쓴다(편집 개체 내부로 스코프 한정). */
function applyFont(kind, value) {
  const doc = frames.teacher?.contentDocument;
  const editingId = selection.state.editingId;
  const found = editingId ? core.findObject(editingId) : null;
  if (!doc || !found || !FORMATTABLE_TYPES.has(found.obj.type)) return;
  if (kind === 'family') {
    doc.execCommand('fontName', false, value);
  } else if (kind === 'size') {
    doc.execCommand('fontSize', false, '7');
    const escId = window.CSS && CSS.escape ? CSS.escape(editingId) : editingId;
    const scope = doc.querySelector(`[data-oid="${escId}"]`) || doc;
    for (const f of scope.querySelectorAll('font[size="7"]')) {
      f.removeAttribute('size');
      f.style.fontSize = value;
    }
  }
  selection.syncEditingField();
  onSelectionDirty('text');
}

async function handleTableRow(action) {
  const id = currentSingleSelectedId();
  const found = id ? core.findObject(id) : null;
  if (!found || found.obj.type !== 'table') return;
  const rows = found.obj.rows;
  let nextRows = rows;
  if (action === 'add-row') nextRows = [...rows, Array.from({ length: (rows[0] || []).length || 1 }, () => ({ text: '' }))];
  else if (action === 'del-row') nextRows = rows.length > 1 ? rows.slice(0, -1) : rows;
  else if (action === 'add-col') nextRows = rows.map((r) => [...r, { text: '' }]);
  else if (action === 'del-col') nextRows = (rows[0] || []).length > 1 ? rows.map((r) => r.slice(0, -1)) : rows;
  else if (action === 'toggle-header') {
    const wantHeader = !(rows[0]?.[0]?.header);
    nextRows = rows.map((r, i) => (i === 0 ? r.map((c) => ({ ...c, header: wantHeader })) : r));
  }
  const next = ObjOps.patchObject(core.getDocument(), id, { rows: nextRows });
  await applyDocOp(next, { reflow: true, selectId: id });
}

function triggerImageUpload(id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.addEventListener('change', () => { if (input.files[0]) uploadImage(id, input.files[0]); });
  input.click();
}

async function uploadImage(id, file) {
  let res;
  try {
    res = await fetch(`/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  } catch (e) {
    showBanner('error', `업로드 실패: ${e.message}`);
    return;
  }
  if (!res.ok) { showBanner('error', '이미지 업로드 실패'); return; }
  const result = await res.json();
  const next = ObjOps.patchObject(core.getDocument(), id, { src: result.path, alt: result.name });
  await applyDocOp(next, { reflow: true, selectId: id });
}

async function saveObjectAsPreset(id) {
  const doc = frames.teacher?.contentDocument;
  const found = core.findObject(id);
  const escId = window.CSS && CSS.escape ? CSS.escape(id) : id;
  const el = doc?.querySelector(`[data-oid="${escId}"]`);
  if (!el || !found) return;
  try {
    await fetch('/presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${found.obj.type}-${Date.now().toString(36)}`, type: 'content', html: el.innerHTML }),
    });
    if (leftPanel.getActiveTab() === 'myblocks') leftPanel.refreshPresets();
    showBanner('ok', '내 블록에 저장했습니다.');
  } catch (e) {
    showBanner('error', `내 블록 저장 실패: ${e.message}`);
  }
}

async function changePaper(paper) {
  if (dirty) await save();
  let res;
  try {
    res = await fetch('/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paper }) });
  } catch (e) {
    showBanner('error', `용지 변경 실패: ${e.message}`);
    return;
  }
  const result = await res.json().catch(() => ({}));
  if (!res.ok) { showBanner('error', `용지 변경 실패: ${result.error ?? res.status}`); return; }
  if (!result.noop) {
    // 용지 변경은 flow 경계의 전제(가용 높이)를 바꾼다 — 저장본 pages[] 는 이전 용지 기준이라
    // 재로드 직후 1회 리플로우로 경계를 재계산한다(플래그는 이 경로 한정 — 수동 빈 페이지 보존
    // 설계(handlePageAction 주석)는 건드리지 않는다).
    try { sessionStorage.setItem('wgReflowAfterPaperChange', '1'); } catch { /* 저장 불가 환경 무시 */ }
    location.reload();
  }
}

function scrollToPage(pageId) {
  const doc = frames.teacher?.contentDocument;
  const sheet = [...(doc?.querySelectorAll('.sheet') || [])].find((candidate) => candidate.dataset.pageId === pageId);
  if (!sheet || !frames.teacher) return;
  const canvasWrap = document.getElementById('canvas-wrap');
  const top = frames.teacher.offsetTop + sheet.offsetTop;
  canvasWrap.scrollTo({ top: Math.max(0, top - 16), behavior: 'auto' });
  activePageId = pageId;
  leftPanel.setActivePage(pageId);
}

function syncActivePageFromCanvas() {
  const frame = frames.teacher;
  const doc = frame?.contentDocument;
  const sheets = [...(doc?.querySelectorAll('.sheet') || [])];
  if (!frame || sheets.length === 0) return;
  const canvasWrap = document.getElementById('canvas-wrap');
  const localTop = canvasWrap.scrollTop - frame.offsetTop + 16;
  let visibleSheet = sheets[0];
  for (const sheet of sheets) {
    if (sheet.offsetTop > localTop) break;
    visibleSheet = sheet;
  }
  const pageId = visibleSheet.dataset.pageId;
  if (!pageId || pageId === activePageId) return;
  activePageId = pageId;
  leftPanel.setActivePage(pageId);
  history.refreshUiState();
}

// ══════════════════════════ 문서 제목 인라인 편집 ══════════════════════════

docTitleEl.addEventListener('click', () => {
  if (docTitleEl.getAttribute('contenteditable') === 'true') return;
  docTitleEl.setAttribute('contenteditable', 'true');
  docTitleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(docTitleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
function commitTitle() {
  if (docTitleEl.getAttribute('contenteditable') !== 'true') return;
  docTitleEl.removeAttribute('contenteditable');
  const text = docTitleEl.textContent.trim();
  docTitleEl.textContent = text || '(제목 없음)';
  const next = { ...core.getDocument(), docTitle: text };
  core.setDocument(next);
  history.commit();
  markDirty();
  runReview();
}
docTitleEl.addEventListener('blur', commitTitle);
docTitleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); docTitleEl.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); docTitleEl.textContent = core.getDocument().docTitle || '(제목 없음)'; docTitleEl.blur(); }
});

// ══════════════════════════ 미리보기 · PDF 내보내기 ══════════════════════════

// 미리보기(#6) — 전엔 저장 전이면 서버가 404(저장본 없음)를 내 img 가 깨진 채로 떴다. dirty 면
// 먼저 저장하고, PNG 를 fetch 해 에러(409 busy·404·unsafe 409·500)를 모달에 글로 보여준다.
document.getElementById('btn-preview').addEventListener('click', () => openPreview());
async function openPreview() {
  const modal = document.getElementById('preview-modal');
  const img = document.getElementById('preview-img');
  const status = document.getElementById('preview-status');
  modal.classList.remove('hidden');
  img.classList.add('hidden');
  status.classList.remove('hidden');
  status.textContent = '미리보기 생성 중… (저장 후 Chrome 렌더 — 수 초 걸릴 수 있어요)';
  try {
    if (dirty) await save();
    const res = await fetch(`/preview.png?mode=${mode}&_=${Date.now()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      status.textContent = `미리보기 실패: ${body.message || body.error || `HTTP ${res.status}`}`;
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    img.onload = () => { if (img.dataset.url) URL.revokeObjectURL(img.dataset.url); img.dataset.url = url; };
    img.src = url;
    img.classList.remove('hidden');
    status.classList.add('hidden');
  } catch (e) {
    status.textContent = `미리보기 실패: ${e.message}`;
  }
}
document.getElementById('preview-close').addEventListener('click', () => {
  document.getElementById('preview-modal').classList.add('hidden');
});

// 내보내기(#5) — 진행표시(버튼 비활성+배너) → dirty 면 save-first → /export → 결과 토스트에
// 파일/폴더 '열기' 버튼(서버가 OS 기본 앱으로 연다). Chrome 렌더는 수십 초 걸릴 수 있다.
document.getElementById('btn-export').addEventListener('click', () => doExport());
async function doExport() {
  const btn = document.getElementById('btn-export');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '내보내는 중…';
  showBanner('warn', 'PDF 내보내는 중… (Chrome 렌더 — 수십 초 걸릴 수 있어요)');
  try {
    if (dirty) await save();
    const res = await fetch('/export', { method: 'POST' });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) { showBanner('error', `내보내기 실패: ${result.error ?? result.message ?? res.status}`); return; }
    const skippedMsg = result.skipped?.student ? ` (학생용 생략: ${result.reason || result.skipped.student})` : '';
    showBanner(result.unsafe ? 'warn' : 'ok', `PDF 내보내기 완료 (${(result.rendered || []).length}벌)${skippedMsg}`);
    showExportResult(result, skippedMsg);
  } catch (e) {
    showBanner('error', `내보내기 실패: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function openExportTarget(target) {
  return async () => {
    try {
      const r = await fetch('/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); showBanner('error', `열기 실패: ${e.error || `HTTP ${r.status}`}`); }
    } catch (e) { showBanner('error', `열기 실패: ${e.message}`); }
  };
}

function showExportResult(result, skippedMsg) {
  const host = document.getElementById('export-result');
  host.replaceChildren();
  const title = document.createElement('div');
  title.className = 'export-result-title';
  title.textContent = `✔ PDF 내보내기 완료 (${(result.rendered || []).length}벌)${skippedMsg}`;
  host.appendChild(title);
  const actions = document.createElement('div');
  actions.className = 'export-result-actions';
  const rendered = result.rendered || [];
  const mkBtn = (label, target) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', openExportTarget(target));
    return b;
  };
  if (rendered.some((r) => r.variant === 'teacher')) actions.appendChild(mkBtn('교사용 PDF 열기', 'teacher-pdf'));
  if (rendered.some((r) => r.variant === 'student')) actions.appendChild(mkBtn('학생용 PDF 열기', 'student-pdf'));
  actions.appendChild(mkBtn('폴더 열기', 'folder'));
  const close = document.createElement('button');
  close.className = 'export-result-close';
  close.textContent = '닫기';
  close.addEventListener('click', () => host.classList.add('hidden'));
  actions.appendChild(close);
  host.appendChild(actions);
  host.classList.remove('hidden');
}

// ══════════════════════════ 저장 ══════════════════════════

async function save() {
  let res;
  try {
    res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: core.getDocument() }),
    });
  } catch (e) {
    showBanner('error', `저장 실패: ${e.message}`);
    return null;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    showBanner('error', `저장 실패: ${body.error ?? `HTTP ${res.status}`}`);
    return null;
  }
  const result = await res.json();
  if (result.document) core.setDocument(result.document);
  currentRevision = result.meta?.revision ?? currentRevision;
  renderRev();
  dirty = false;
  clearTimeout(autosaveTimer);
  if (result.unsafe) {
    const rules = [...new Set((result.leakFindings ?? []).map((f) => f.rule))].join(', ');
    showBanner('error', `⚠ 저장됨(rev ${currentRevision}) — 정답 누출 감지(${rules}). 학생용 HTML 은 보류되었습니다.`);
  } else {
    showBanner('ok', `저장됨 (rev ${currentRevision})`);
  }
  document.body.dataset.savedRevision = String(currentRevision);
  runReview();
  return result;
}

let bannerTimer = null;
function showBanner(kind, text) {
  const el = document.getElementById('save-banner');
  el.className = `save-banner ${kind}`;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(bannerTimer);
  if (kind === 'ok') bannerTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

document.getElementById('btn-save').addEventListener('click', save);

// ══════════════════════════ UI 모듈 조립 ══════════════════════════

// US-19(S4.4): std-box(성취기준, 원칙 3 — 창작 금지) 는 서버가 /shell.json 으로 개체 타입 가드
// 집합을 함께 내려준다 — 클라이언트 층(진입점 비활성화·패널 차단)도 같은 집합을 근거로 삼는다(§7
// 3중 방어). passage-slot 은 3층 정책(2026-07-23 2차 델타)으로 이 가드 집합에서 빠졌다 — 교사가
// 명시적으로 요청하면 AI 로 지문을 창작·재구성할 수 있다(ai.js 의 지문 전용 프리셋 참조).
const excludedAiTypes = new Set(shell.excludedAiTypes || []);

const aiPanel = createAiPanel({
  entryHost: document.getElementById('ai-entry-slot'),
  getSelectionState: () => selection.state,
  findObject: (id) => core.findObject(id),
  excludedTypes: excludedAiTypes,
  getRenderMeta: () => buildRenderMeta(core.getDocument()),
  getDoc: () => frames.teacher?.contentDocument ?? null,
  onApply: async ({ mode, updates }) => {
    let next = core.getDocument();
    const ids = [];
    if (mode === 'insert') {
      for (const u of updates) {
        const obj = { ...u.object, id: ObjOps.generateId(u.object.type) };
        next = ObjOps.insertFlow(next, obj, { afterId: u.id });
        ids.push(obj.id);
      }
    } else {
      for (const u of updates) { next = ObjOps.replaceObject(next, u.id, u.object); ids.push(u.id); }
    }
    await applyDocOp(next, { reflow: true, selectId: ids[0] ?? null, ai: true });
    return { ids };
  },
});

const contextToolbar = createContextToolbar({
  root: document.getElementById('context-toolbar'),
  history,
  excludedAiTypes,
  onAiOpen: (id) => aiPanel.openFor([id]),
  onQuickInsert: (item) => doInsert(item, { float: !!item.floatOnly }),
  onDuplicate: (id) => { const { document: next, newId } = ObjOps.duplicateObject(core.getDocument(), id); if (newId) applyDocOp(next, { reflow: true, selectId: newId }); },
  onDelete: (id) => { const next = ObjOps.removeObject(core.getDocument(), id); selection.clearAll(); applyDocOp(next, { reflow: true }); },
  onFlowFloat: (id) => { const next = ObjOps.toggleFlowFloat(core.getDocument(), id); applyDocOp(next, { reflow: true, selectId: id }); },
  onFormat: (cmd, value) => applyFormat(cmd, value),
  onFont: (kind, value) => applyFont(kind, value),
  onAnswerToggle: (id) => { const next = ObjOps.toggleAnswer(core.getDocument(), id); applyDocOp(next, { selectId: id }); },
  onTableRow: (action) => handleTableRow(action),
  onTableMerge: (dir) => tableEditor.merge(dir),
  onImageReplace: (id) => triggerImageUpload(id),
  onShapeColor: (kind, hex) => {
    const id = currentSingleSelectedId();
    if (!id) return;
    const next = ObjOps.patchObject(core.getDocument(), id, kind === 'stroke' ? { strokeColor: hex } : { fillColor: hex });
    applyDocOp(next, { selectId: id });
  },
  onZoom: (pct) => {
    // 확대(>100%) 시 transform 은 레이아웃 박스를 키우지 않아 스케일된 넘침이 스크롤로 접근되지
    // 않는다(좌우·상하 잘림). origin 을 top-left 로 돌리고 스케일 초과분만큼 여백을 예약해 스크롤
    // 영역을 넓힌다. 100% 이하는 넘침이 없어 top-center 로 되돌려 가운데 정렬을 유지한다(#stage
    // margin:0 auto 로 복귀). transform:scale 은 유지하므로 드래그·표 열너비의 스케일 보정
    // (getBoundingClientRect/offsetWidth 비율)은 영향받지 않는다.
    const f = pct / 100;
    stage.style.transform = `scale(${f})`;
    if (f > 1) {
      stage.style.transformOrigin = 'top left';
      stage.style.marginLeft = '0';
      stage.style.marginRight = `${stage.offsetWidth * (f - 1)}px`;
      stage.style.marginBottom = `${stage.offsetHeight * (f - 1)}px`;
    } else {
      stage.style.transformOrigin = 'top center';
      stage.style.marginLeft = '';
      stage.style.marginRight = '';
      stage.style.marginBottom = '';
    }
  },
  onViewToggle: (key, val) => { viewState[key] = val; applyViewState(); },
  onGridOpacity: (alpha) => { viewState.gridAlpha = alpha; applyViewState(); },
});

const inspector = createInspector({
  root: document.getElementById('right-panel'),
  onPaperChange: (paper) => changePaper(paper),
  onPatchObject: (id, patch) => {
    const found = core.findObject(id);
    if (patch.qtype && found && found.obj.type === 'question' && found.obj.qtype !== patch.qtype) {
      patch = { ...patch, ...ObjOps.questionDefaults(patch.qtype) };
    }
    const next = ObjOps.patchObject(core.getDocument(), id, patch);
    applyDocOp(next, { reflow: true, selectId: id });
  },
  onToggleFlowFloat: (id) => { const next = ObjOps.toggleFlowFloat(core.getDocument(), id); applyDocOp(next, { reflow: true, selectId: id }); },
  onToggleAnswer: (id) => { const next = ObjOps.toggleAnswer(core.getDocument(), id); applyDocOp(next, { selectId: id }); },
  onAlign: (ids, mode2) => { const next = ObjOps.alignFloats(core.getDocument(), ids, mode2); applyDocOp(next); },
  onImageUpload: (id, file) => uploadImage(id, file),
});

const leftPanel = createLeftPanel({
  root: document.getElementById('left-panel'),
  onThumbSelect: (pageId) => scrollToPage(pageId),
  onPageAction: (action, pageId) => handlePageAction(action, pageId),
  onPageRoleChange: (pageId, role) => handlePageAction('set-role', pageId, { role }),
  onPageReorder: (pageIds, movedPageId) => handlePageAction('reorder', movedPageId, { pageIds }),
  onInsertItem: (item, opts) => doInsert(item, opts),
  fetchPresets: () => fetch('/presets').then((r) => r.json()),
  onPresetInsert: (preset) => {
    const obj = ObjOps.createObject('richtext', { placement: 'flow' });
    obj.html = preset.html;
    const next = ObjOps.insertFlow(core.getDocument(), obj, { afterId: currentSingleSelectedId() });
    applyDocOp(next, { reflow: true, selectId: obj.id });
  },
  onPresetDelete: (id) => fetch(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => r.json()),
});
document.getElementById('canvas-wrap').addEventListener('scroll', syncActivePageFromCanvas, { passive: true });

const canvasInline = createCanvasInline({
  popupsHost: document.getElementById('popups-host'),
  getSelectionState: () => selection.state,
  findObject: (id) => core.findObject(id),
  excludedAiTypes,
  onAiOpen: (id) => aiPanel.openFor([id]),
  onFormat: (cmd, value) => applyFormat(cmd, value),
  onAnswerToggle: (id) => { const next = ObjOps.toggleAnswer(core.getDocument(), id); applyDocOp(next, { selectId: id }); },
  onInsertAfter: (item, afterId) => doInsert(item, { float: !!item.floatOnly, afterId }),
  onDuplicate: (id) => { const { document: next, newId } = ObjOps.duplicateObject(core.getDocument(), id); if (newId) applyDocOp(next, { reflow: true, selectId: newId }); },
  onDelete: (id) => { const next = ObjOps.removeObject(core.getDocument(), id); selection.clearAll(); applyDocOp(next, { reflow: true }); },
  onFlowFloat: (id) => { const next = ObjOps.toggleFlowFloat(core.getDocument(), id); applyDocOp(next, { reflow: true, selectId: id }); },
  onSaveAsPreset: (id) => saveObjectAsPreset(id),
  onFlowReorder: (idsByPage, draggedId) => {
    const next = ObjOps.applyFlowOrder(core.getDocument(), idsByPage);
    applyDocOp(next, { reflow: true, selectId: draggedId ?? null });
  },
});

// #10 표 셀 편집(인라인)·병합/분할·열 너비 조정 — 셀 텍스트는 reload 없이 즉시 변이(리플로우만 예약),
// 구조 변경(rows 교체)만 applyDocOp 로 문서 교체·재로드한다.
const tableEditor = createTableEditor({
  findObject: (id) => core.findObject(id),
  getSelectionState: () => selection.state,
  onCellText: () => onSelectionDirty('text'),
  onTablePatch: (id, patch) => { const next = ObjOps.patchObject(core.getDocument(), id, patch); applyDocOp(next, { reflow: true, selectId: id }); },
});

// #3(2차) 선지·항목 인라인 편집 — 셀 편집과 동형(직접 변이+리플로우 예약, reload 없음).
const partEditor = createPartEditor({
  findObject: (id) => core.findObject(id),
  onPartText: () => onSelectionDirty('text'),
});

// ── 초기 모드: teacher 는 항상 먼저 만들어 둔다(썸네일·검수는 teacher 문서가 진실). ──
await ensureFrame('teacher');
await setMode(location.hash === '#student' ? 'student' : 'teacher');
// #4: 프레임이 보이게 된 뒤(레이아웃 확정) 썸네일을 다시 그린다 — 최초 렌더는 hidden 이라 0 치수였다.
requestAnimationFrame(() => renderPageThumbs());
try {
  if (sessionStorage.getItem('wgReflowAfterPaperChange') === '1') {
    sessionStorage.removeItem('wgReflowAfterPaperChange');
    scheduleReflow(); // 용지 변경 재로드 — 새 가용 높이로 flow 경계 재계산(changePaper 주석 참조)
  }
} catch { /* 저장 불가 환경 무시 */ }
document.body.dataset.ready = 'true'; // 검증 스크립트가 폴링해 초기 렌더 완료를 확인

// ── 시드 훅(렌더 테스트 전용): 서버가 testSeed 로 기동됐을 때만 활성 ──
if (shell.testSeed === true) {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) {
    try {
      const { runEditorTestSeed } = await import('/editor/testSeed.js');
      await runEditorTestSeed(seed, {
        shell,
        stage,
        docTitleEl,
        core,
        history,
        selection,
        frames,
        leftPanel,
        objOps: ObjOps,
        wait,
        pollUntil,
        runReflow,
        reloadTeacherFrame,
        setMode,
        updateAll,
        handlePageAction,
        scrollToPage,
        save,
        getCurrentRevision: () => currentRevision,
        getStudentStale: () => studentStale,
        cancelScheduledReflow: () => clearTimeout(reflowTimer),
        getClipboardCount: () => objectClipboard.length,
      });
    } catch (e) {
      // 시드 실패를 무음으로 삼키지 않는다 — dump-dom 스냅샷에 원인이 남아야 실패한 렌더 테스트를
      // 진단할 수 있다(seedDone 이 비어 있는 것만으로는 "어디서 왜" 를 알 수 없다).
      document.body.dataset.seedError = String(e && e.message || e);
      console.error('시드 실패:', e);
    }
  }
}
