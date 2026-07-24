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

// history.reset()/undo()/redo() 가 문서·DOM 을 되돌린 뒤 화면·툴바를 정합시킨다.
function onHistoryRestore() {
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
  leftPanel.renderThumbs(frames.teacher?.contentDocument ?? null);
  scheduleReflow(); // S4.2: undo/redo 로 복원된 내용도 페이지 귀속을 다시 계산한다.
}

const history = createHistory({
  core,
  getDoc: () => frames.teacher?.contentDocument ?? null,
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

function scheduleReflow() {
  clearTimeout(reflowTimer);
  reflowTimer = setTimeout(() => { runReflow(); }, REFLOW_DEBOUNCE_MS);
}

/** 리플로우 1회 실행: 측정→재배정→(바뀌었으면) 문서·DOM 갱신→즉시 커밋. 동시 실행은 직렬화한다. */
function runReflow() {
  if (reflowInFlight) { reflowQueued = true; return reflowInFlight; }
  const run = (async () => {
    try {
      const teacherDoc = frames.teacher?.contentDocument;
      if (!teacherDoc) return;
      const doc = core.getDocument();
      const { document: nextDoc, changed } = await reflowDocument(doc, { styleTag: teacherStyleTag, tolerancePx: 2 });
      bumpDataset('reflowRuns');
      if (!changed) return;
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
      history.commit();
      leftPanel.renderThumbs(frames.teacher?.contentDocument ?? null);
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
  leftPanel.renderThumbs(doc);
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
async function applyDocOp(next, { reflow = false, selectId = null, ai = false } = {}) {
  core.setDocument(next);
  markDirty();
  if (!ai && selectId) aiPanel.clearFresh(selectId);
  await reloadTeacherFrame(next);
  canvasInline.refreshDecoration();
  aiPanel.refreshFreshBadges(frames.teacher?.contentDocument ?? null);
  fitFrame(frames.teacher);
  if (selectId) selection.select(selectId);
  else selection.refreshVisual();
  history.commit();
  runReview();
  updateAll();
  leftPanel.renderThumbs(frames.teacher?.contentDocument ?? null);
  if (reflow) scheduleReflow();
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

// 페이지 add/duplicate/delete 는 의도적으로 리플로우를 예약하지 않는다 — reflow.js 의 페이지네이션은
// flow 콘텐츠 높이로만 pages[] 개수를 다시 계산하므로(D-A, 페이지는 파생값), 빈 페이지를 추가한 직후
// 리플로우가 돌면 그 빈 페이지가 즉시 사라진다(콘텐츠가 0 이라 assignFlowToPages 가 배정할 이유가
// 없다). 교사가 명시적으로 페이지 수를 조작하는 이 세 동작만은 pages[] 를 그대로 존중한다 — 이후
// 텍스트 편집 등 실제 콘텐츠 변경이 있을 때만 리플로우가 자연스럽게 재계산한다.
async function handlePageAction(action, index) {
  const doc = core.getDocument();
  let next;
  if (action === 'add-before') next = ObjOps.addPage(doc, { afterIndex: index == null ? null : index - 1 });
  else if (action === 'add-after') next = ObjOps.addPage(doc, { afterIndex: index });
  else if (action === 'duplicate') next = ObjOps.duplicatePage(doc, index);
  else if (action === 'delete') next = ObjOps.removePage(doc, index);
  else return;
  await applyDocOp(next, { reflow: false });
}

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

function scrollToPage(index) {
  const doc = frames.teacher?.contentDocument;
  const sheet = doc?.querySelectorAll('.sheet')[index];
  if (!sheet || !frames.teacher) return;
  const canvasWrap = document.getElementById('canvas-wrap');
  const top = frames.teacher.offsetTop + sheet.offsetTop;
  canvasWrap.scrollTo({ top: Math.max(0, top - 16), behavior: 'auto' });
  leftPanel.setActiveThumb(index);
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
  onThumbSelect: (index) => scrollToPage(index),
  onPageAction: (action, index) => handlePageAction(action, index),
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
requestAnimationFrame(() => leftPanel.renderThumbs(frames.teacher?.contentDocument ?? null));
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
      await runSeed(seed);
    } catch (e) {
      // 시드 실패를 무음으로 삼키지 않는다 — dump-dom 스냅샷에 원인이 남아야 실패한 렌더 테스트를
      // 진단할 수 있다(seedDone 이 비어 있는 것만으로는 "어디서 왜" 를 알 수 없다).
      document.body.dataset.seedError = String(e && e.message || e);
      console.error('시드 실패:', e);
    }
  }
}

/**
 * 결정적 시드 스크립트 — 렌더 테스트가 ?seed= 로 구동한다. core-ops/reflow-grow/reflow-once 는
 * US-16/17 회귀 방어(무변경 이식). shell-ui/thumbs-tree 는 이번 S4.3 신 UI 셸 전용.
 */
async function runSeed(seed) {
  let doc = frames.teacher.contentDocument;
  if (seed === 'core-ops') {
    const titleEl = doc.querySelector('[data-ot="title"]');
    const questionEl = doc.querySelector('[data-ot="question"]');
    const stdEl = doc.querySelector('[data-ot="std-box"]');

    titleEl.click();
    document.body.dataset.sel1Type = core.findObject(titleEl.dataset.oid)?.obj.type ?? '';
    document.body.dataset.sel1Has = String(selection.state.selectedIds.has(titleEl.dataset.oid));

    questionEl.click();
    document.body.dataset.selSwitched = String(
      selection.state.selectedIds.has(questionEl.dataset.oid) && !selection.state.selectedIds.has(titleEl.dataset.oid),
    );

    titleEl.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    document.body.dataset.multiCount = String(selection.state.selectedIds.size);

    doc.querySelector('.sheet').click();
    document.body.dataset.clearedCount = String(selection.state.selectedIds.size);

    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const titleTarget = titleEl.querySelector('.title-box h1, .title-box h2');
    document.body.dataset.editingId = selection.state.editingId ?? '';
    document.body.dataset.titleCe = titleTarget.getAttribute('contenteditable') ?? '';
    document.body.dataset.othersCe = String(doc.querySelectorAll('[contenteditable="true"]').length);

    const origTitleText = titleTarget.textContent;
    titleTarget.textContent = '수정된 제목';
    titleTarget.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.dataset.titleTextSynced = core.findObject(titleEl.dataset.oid).obj.text;
    history.commit();

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.escEditingAfter = selection.state.editingId ?? '(none)';
    document.body.dataset.escSelectedAfter = [...selection.state.selectedIds].join(',');
    document.body.dataset.titleCeAfterEsc = titleTarget.getAttribute('contenteditable') ?? '(none)';

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.esc2SelectedCount = String(selection.state.selectedIds.size);

    stdEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    document.body.dataset.stdEditingId = selection.state.editingId ?? '(none)';
    document.body.dataset.stdSelected = String(selection.state.selectedIds.has(stdEl.dataset.oid));
    // 학습목표 표기 전환(2026-07-23): 인스펙터 objectives 필드 존재 + codes 읽기전용 확인(회귀 방어).
    document.body.dataset.stdInspObjectivesField = String(!!document.getElementById('insp-std-objectives'));
    document.body.dataset.stdInspCodesReadonly = String(document.getElementById('insp-std-codes')?.hasAttribute('readonly') ?? false);
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    questionEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const qTarget = questionEl.querySelector('.q');
    const qnumText = qTarget.querySelector('.qnum')?.textContent ?? '';
    const origPrompt = core.findObject(questionEl.dataset.oid).obj.prompt;
    const walker = doc.createTreeWalker(qTarget, NodeFilter.SHOW_TEXT);
    let lastText = null;
    while (walker.nextNode()) lastText = walker.currentNode;
    lastText.textContent = `${lastText.textContent}(수정)`;
    qTarget.dispatchEvent(new Event('input', { bubbles: true }));
    history.commit();
    const qObjAfter = core.findObject(questionEl.dataset.oid).obj;
    document.body.dataset.qPromptSynced = qObjAfter.prompt;
    document.body.dataset.qnumStripped = String(qnumText.length > 0 && !qObjAfter.prompt.includes(qnumText));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    history.undo();
    history.undo();
    document.body.dataset.afterUndoTitle = core.findObject(titleEl.dataset.oid).obj.text;
    document.body.dataset.afterUndoOrigMatch = String(core.findObject(titleEl.dataset.oid).obj.text === origTitleText);
    document.body.dataset.afterUndoQuestion = core.findObject(questionEl.dataset.oid).obj.prompt;
    document.body.dataset.afterUndoQuestionOrigMatch = String(core.findObject(questionEl.dataset.oid).obj.prompt === origPrompt);
    history.redo();
    history.redo();
    document.body.dataset.afterRedoTitle = core.findObject(titleEl.dataset.oid).obj.text;
    document.body.dataset.afterRedoQuestion = core.findObject(questionEl.dataset.oid).obj.prompt;

    const floatEl2 = doc.querySelector('.wg-float[data-ot="answer-area"]');

    document.body.dataset.floatPeUnselected = doc.defaultView.getComputedStyle(floatEl2).pointerEvents;
    selection.select(floatEl2.dataset.oid);
    document.body.dataset.floatPeSelected = doc.defaultView.getComputedStyle(floatEl2).pointerEvents;

    const rectBefore = { ...core.findObject(floatEl2.dataset.oid).obj.rect };
    const pe = (type, sx, sy) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, screenX: sx, screenY: sy, clientX: sx, clientY: sy,
    });
    floatEl2.dispatchEvent(pe('pointerdown', 300, 300));
    floatEl2.dispatchEvent(pe('pointermove', 340, 330));
    floatEl2.dispatchEvent(pe('pointerup', 340, 330));
    const rectAfter = core.findObject(floatEl2.dataset.oid).obj.rect;
    document.body.dataset.floatMovedX = String(Math.round(rectAfter.xMm - rectBefore.xMm));
    document.body.dataset.floatMovedY = String(Math.round(rectAfter.yMm - rectBefore.yMm));
    doc.querySelector('.sheet').click();
    document.body.dataset.afterSwallowSelected = String(selection.state.selectedIds.has(floatEl2.dataset.oid));
    doc.querySelector('.sheet').click();
    document.body.dataset.afterSecondClickCount = String(selection.state.selectedIds.size);

    document.body.dataset.revBeforeSave = String(currentRevision ?? '');
    const saved = await save();
    document.body.dataset.revAfterSave = String(currentRevision ?? '');
    document.body.dataset.saveOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'reflow-grow') {
    const pageIndexOf = (id) => {
      const d = core.getDocument();
      for (let i = 0; i < d.pages.length; i++) {
        const p = d.pages[i];
        if ((p.flow || []).some((o) => o.id === id)) return i;
        if ((p.float || []).some((o) => o.id === id)) return i;
      }
      return -1;
    };

    document.body.dataset.rgPageCountBefore = String(core.getDocument().pages.length);
    document.body.dataset.rgGrowPageBefore = String(pageIndexOf('rt-grow'));
    document.body.dataset.rgAfterPageBefore = String(pageIndexOf('rt-after'));
    document.body.dataset.rgTablePageBefore = String(pageIndexOf('tbl1'));
    document.body.dataset.rgFloatPageBefore = String(pageIndexOf('f1'));
    const floatRectBefore = { ...core.findObject('f1').obj.rect };
    const tableRowsBefore = core.findObject('tbl1').obj.rows.length;

    let growEl = doc.querySelector('[data-oid="rt-grow"]');
    growEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const longHtml = Array.from({ length: 60 }, (_, i) =>
      `<p>리플로우 실측용 긴 문단 ${i} — 개체 높이를 키워 페이지 넘침을 유발합니다.</p>`).join('');
    growEl.innerHTML = longHtml;
    growEl.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await runReflow();
    doc = frames.teacher.contentDocument;

    document.body.dataset.rgPageCountAfterGrow = String(core.getDocument().pages.length);
    document.body.dataset.rgGrowPageAfterGrow = String(pageIndexOf('rt-grow'));
    document.body.dataset.rgAfterPageAfterGrow = String(pageIndexOf('rt-after'));
    document.body.dataset.rgTablePageAfterGrow = String(pageIndexOf('tbl1'));
    document.body.dataset.rgFloatPageAfterGrow = String(pageIndexOf('f1'));
    const floatRectAfterGrow = core.findObject('f1').obj.rect;
    document.body.dataset.rgFloatRectUnchangedAfterGrow = String(
      floatRectAfterGrow.xMm === floatRectBefore.xMm && floatRectAfterGrow.yMm === floatRectBefore.yMm,
    );
    document.body.dataset.rgTableRowsAfterGrow = String(core.findObject('tbl1').obj.rows.length);

    growEl = doc.querySelector('[data-oid="rt-grow"]');
    growEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    growEl.innerHTML = '<p>다시 짧아진 문단</p>';
    growEl.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await runReflow();
    doc = frames.teacher.contentDocument;

    document.body.dataset.rgPageCountAfterShrink = String(core.getDocument().pages.length);
    document.body.dataset.rgAfterPageAfterShrink = String(pageIndexOf('rt-after'));
    document.body.dataset.rgTablePageAfterShrink = String(pageIndexOf('tbl1'));
    const floatRectAfterShrink = core.findObject('f1').obj.rect;
    document.body.dataset.rgFloatRectUnchangedAfterShrink = String(
      floatRectAfterShrink.xMm === floatRectBefore.xMm && floatRectAfterShrink.yMm === floatRectBefore.yMm,
    );
    document.body.dataset.rgTableRowsAfterShrink = String(core.findObject('tbl1').obj.rows.length);
    document.body.dataset.rgTableRowsOriginal = String(tableRowsBefore);

    document.body.dataset.rgRevBeforeSave = String(currentRevision ?? '');
    const savedRg = await save();
    document.body.dataset.rgRevAfterSave = String(currentRevision ?? '');
    document.body.dataset.rgSaveOk = String(savedRg != null && savedRg.unsafe === false);
  } else if (seed === 'reflow-once') {
    await runReflow();
    document.body.dataset.roRevBeforeSave = String(currentRevision ?? '');
    const savedOnce = await save();
    document.body.dataset.roRevAfterSave = String(currentRevision ?? '');
    document.body.dataset.roSaveOk = String(savedOnce != null && savedOnce.unsafe === false);
  } else if (seed === 'shell-ui') {
    // ── 앱 바 요소 존재 ──
    document.body.dataset.hasTitle = String(!!document.getElementById('doc-title'));
    document.body.dataset.hasReview = String(!!document.getElementById('btn-review'));
    document.body.dataset.hasPreview = String(!!document.getElementById('btn-preview'));
    document.body.dataset.hasExport = String(!!document.getElementById('btn-export'));
    document.body.dataset.hasSave = String(!!document.getElementById('btn-save'));

    // 제목 인라인 편집
    const origTitle = core.getDocument().docTitle;
    docTitleEl.click();
    docTitleEl.textContent = '수정된 문서 제목';
    docTitleEl.dispatchEvent(new Event('input', { bubbles: true }));
    docTitleEl.blur();
    document.body.dataset.titleSynced = core.getDocument().docTitle;
    document.body.dataset.titleChanged = String(core.getDocument().docTitle !== origTitle);

    // 검수 칩
    document.body.dataset.reviewStatus = document.getElementById('btn-review').dataset.reviewStatus;

    // 툴바: 선택 없음 = empty
    document.body.dataset.tbEmpty = document.getElementById('context-toolbar').dataset.tbMode;

    // 좌측 3탭 존재 + 전환
    const leftPanelEl = document.getElementById('left-panel');
    document.body.dataset.tabsCount = String(leftPanelEl.querySelectorAll('[data-tab]').length);
    document.querySelector('[data-tab="insert"]').click();
    document.body.dataset.leftTabAfterClick = leftPanelEl.dataset.leftTab;
    document.body.dataset.insertPanelVisible = String(!leftPanelEl.querySelector('[data-panel="insert"]').classList.contains('hidden'));

    // 삽입 카탈로그 클릭 → 구조 삽입 → 자동 선택 → 인스펙터/툴바 object 모드
    const beforeCount = core.allObjects().length;
    document.querySelector('#insert-grid [data-insert-key="divider"]').click();
    await wait(150);
    // 삽입이 예약한 리플로우 디바운스(300ms)가 이후 선택 조작 도중 비동기로 발동해 iframe 을
    // 재로드하는 경합을 피한다 — 이 구간 검증은 삽입/선택 자체이지 리플로우 결과가 아니다.
    clearTimeout(reflowTimer);
    document.body.dataset.afterInsertCount = String(core.allObjects().length);
    document.body.dataset.countIncreased = String(core.allObjects().length > beforeCount);
    document.body.dataset.inspAfterInsert = document.getElementById('right-panel').dataset.inspMode;
    document.body.dataset.tbAfterInsert = document.getElementById('context-toolbar').dataset.tbMode;

    document.querySelector('[data-tab="pages"]').click();
    doc = frames.teacher.contentDocument;
    const titleObjEl = doc.querySelector('[data-ot="title"]');
    const tableObjEl = doc.querySelector('[data-ot="table"]');
    const richEl = doc.querySelector('[data-ot="richtext"]');

    titleObjEl.click();
    document.body.dataset.tbOnTitleSelect = document.getElementById('context-toolbar').dataset.tbMode;
    document.body.dataset.inspOnTitleSelect = document.getElementById('right-panel').dataset.inspMode;

    tableObjEl.click();
    document.body.dataset.tbOnTableSelect = document.getElementById('context-toolbar').dataset.tbMode;
    document.body.dataset.hasAddRowBtn = String(!!document.getElementById('tb-add-row'));

    titleObjEl.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    document.body.dataset.tbOnMulti = document.getElementById('context-toolbar').dataset.tbMode;
    document.body.dataset.inspOnMulti = document.getElementById('right-panel').dataset.inspMode;

    doc.querySelector('.sheet').click();
    document.body.dataset.inspOnClear = document.getElementById('right-panel').dataset.inspMode;
    document.body.dataset.reviewListPresent = String(!!document.getElementById('insp-review-list'));

    // 슬래시 메뉴(닫힌 카탈로그만) — richtext 편집 중 `/`
    richEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    richEl.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    document.body.dataset.slashOpenCaptured = document.body.dataset.slashOpen ?? 'false';
    const slashMenuEl = document.getElementById('canvas-slash-menu');
    // US-19: 슬래시 메뉴에 AI 진입점(data-slash-item="ai") 이 추가됐다 — "닫힌 카탈로그만 노출"
    // 단정은 카탈로그 항목(10종+qtype 7종=16)만 세고, AI 유틸리티 항목은 별도로 존재만 확인한다.
    document.body.dataset.slashItemCount = slashMenuEl
      ? String(slashMenuEl.querySelectorAll('button[data-slash-item]:not([data-slash-item="ai"])').length) : '0';
    document.body.dataset.slashHasAiItem = String(!!slashMenuEl?.querySelector('button[data-slash-item="ai"]'));
    const beforeSlashInsert = core.allObjects().length;
    slashMenuEl?.querySelector('button[data-slash-item="divider"]')?.click();
    await wait(150);
    clearTimeout(reflowTimer);
    document.body.dataset.afterSlashInsertCount = String(core.allObjects().length);
    document.body.dataset.slashInsertIncreased = String(core.allObjects().length > beforeSlashInsert);
    doc = frames.teacher.contentDocument;
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } else if (seed === 'thumbs-tree') {
    document.body.dataset.thumbCountInitial = String(document.querySelectorAll('#thumb-list .thumb').length);
    document.body.dataset.pageCountInitial = String(core.getDocument().pages.length);

    await handlePageAction('add-after', null);
    document.body.dataset.pageCountAfterAdd = String(core.getDocument().pages.length);
    document.body.dataset.thumbCountAfterAdd = String(document.querySelectorAll('#thumb-list .thumb').length);

    await handlePageAction('duplicate', 0);
    document.body.dataset.pageCountAfterDup = String(core.getDocument().pages.length);
    document.body.dataset.thumbCountAfterDup = String(document.querySelectorAll('#thumb-list .thumb').length);

    const beforeDeleteCount = core.getDocument().pages.length;
    await handlePageAction('delete', beforeDeleteCount - 1);
    document.body.dataset.pageCountAfterDelete = String(core.getDocument().pages.length);
    document.body.dataset.thumbCountAfterDelete = String(document.querySelectorAll('#thumb-list .thumb').length);

    // 편집 반영 확인 — 실제 리플로우(runReflow)는 쓰지 않는다: 위 add/duplicate/delete 로 만든
    // 빈 페이지가 콘텐츠 기반 재계산에 휩쓸려 사라지는 걸 피하기 위함(핸들러 주석 참조). 편집은
    // 라이브 iframe DOM 을 직접 바꾸므로 리플로우 없이도 즉시 화면에 반영된다 — history.commit()
    // 으로 개체 트리만 확정하고 썸네일을 수동으로 다시 그린다.
    doc = frames.teacher.contentDocument;
    const titleObjEl = doc.querySelector('[data-ot="title"]');
    titleObjEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const target = titleObjEl.querySelector('.title-box h1, .title-box h2');
    target.textContent = '썸네일 동기화 확인용 제목';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    leftPanel.renderThumbs(doc);

    const pageIdx = ObjOps.pageIndexOf(core.getDocument(), titleObjEl.dataset.oid);
    const thumbFrame = document.querySelectorAll('#thumb-list .thumb')[pageIdx]?.querySelector('iframe');
    document.body.dataset.thumbSyncOk = String(!!thumbFrame && thumbFrame.srcdoc.includes('썸네일 동기화 확인용 제목'));
    document.body.dataset.thumbSyncPageIdx = String(pageIdx);

    scrollToPage(0);
    await wait(50);
    document.body.dataset.scrollToFirstOk = String(document.getElementById('canvas-wrap').scrollTop >= 0);
  } else if (seed === 'ai-guard') {
    // US-19: 성취기준/저작권 슬롯 개체 선택 시 진입점 3중 방어 확인(§7·§10) — 앱 바 버튼 비활성 ·
    // 우클릭 메뉴 항목 비활성 · 서버 400(심층 방어의 마지막 층, 클라이언트 우회 대비).
    const stdEl = doc.querySelector('[data-oid="std1"]');
    stdEl.click();
    document.body.dataset.aiGuardEntryDisabled = String(document.getElementById('btn-ai').disabled);

    stdEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    const ctxAiBtn = document.getElementById('canvas-ctx-menu')?.querySelector('#ctx-ai');
    document.body.dataset.aiGuardCtxDisabled = String(!!ctxAiBtn?.disabled);
    document.querySelectorAll('.ctx-menu').forEach((n) => n.remove());

    // disabled 버튼은 표준 DOM 동작상 .click() 으로도 click 이벤트가 발생하지 않는다 — 그대로 패널
    // 미개방을 단정해 클라이언트 가드가 실효적임을 확인한다.
    document.getElementById('btn-ai').click();
    document.body.dataset.aiGuardPanelOpened = String(!!document.getElementById('ai-panel'));

    const res = await fetch('/ai/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'std1', type: 'std-box', placement: 'flow', codes: [] }] }),
    });
    document.body.dataset.aiGuardServerStatus = String(res.status);
  } else if (seed === 'ai-request-preview') {
    // US-19: 진입점 통일(앱바 버튼·우클릭·슬래시·컨텍스트 툴바가 전부 같은 패널을 연다) + v3 요청
    // 발신 + 무API "AI 지시문 복사" + 응답 도착 후 미리보기 카드·인라인 diff.
    let qEl = doc.querySelector('[data-oid="q1"]');
    const origPrompt = core.findObject('q1').obj.prompt;

    qEl.click();
    document.getElementById('tb-ai').click();
    document.body.dataset.aiOpenViaToolbar = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');
    document.getElementById('ai-panel-close').click();
    await wait(30);

    qEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    document.getElementById('canvas-ctx-menu')?.querySelector('#ctx-ai')?.click();
    document.body.dataset.aiOpenViaContextMenu = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');
    document.getElementById('ai-panel-close').click();
    await wait(30);

    qEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    document.getElementById('canvas-slash-menu')?.querySelector('button[data-slash-item="ai"]')?.click();
    document.body.dataset.aiOpenViaSlash = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.getElementById('ai-panel-close').click();
    await wait(30);

    qEl = doc.querySelector('[data-oid="q1"]');
    qEl.click();
    document.body.dataset.aiEntryEnabledOnSelect = String(!document.getElementById('btn-ai').disabled);
    document.getElementById('btn-ai').click();
    document.body.dataset.aiOpenViaEntry = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');

    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    const copyText = document.getElementById('ai-copy-text').value;
    document.body.dataset.aiCopyHasReqId = String(/req-\S+/.test(copyText));
    document.body.dataset.aiCopyHasObjectsFlag = String(copyText.includes('--objects'));
    document.body.dataset.aiRequestId = document.querySelector('.ai-waiting')?.dataset.aiRequestId || '';

    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.aiPreviewShown = 'true';
    const diffEl = document.getElementById('ai-diff-q1');
    document.body.dataset.aiDiffHasAdd = String(!!diffEl?.querySelector('.ai-diff-add'));
    document.body.dataset.aiDiffHasDel = String(!!diffEl?.querySelector('.ai-diff-del'));
    document.body.dataset.aiPreviewBeforeHasOrig = String(
      !!document.querySelector('.ai-preview-before .ai-preview-render')?.textContent.includes(origPrompt),
    );
    document.getElementById('ai-cancel-preview').click();
    await wait(30);
    document.body.dataset.aiPanelClosedAfterCancel = String(!document.getElementById('ai-panel'));
  } else if (seed === 'ai-version-apply-undo') {
    // US-19: 재생성(버전 ◀▶ 화살표 왕복) + 적용(교체, history 1 op) + undo 1스텝 복원.
    const qEl = doc.querySelector('[data-oid="q1"]');
    const origPrompt = core.findObject('q1').obj.prompt;
    qEl.click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    const v1Text = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';

    document.getElementById('ai-regenerate').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting');
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview'
      && document.getElementById('ai-version-label')?.textContent === '2 / 2', { timeoutMs: 30000 });
    const v2Text = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';
    document.body.dataset.aiVersionLabelAfterRegen = document.getElementById('ai-version-label').textContent;
    document.body.dataset.aiVersionsDiffer = String(v1Text.length > 0 && v2Text.length > 0 && v1Text !== v2Text);

    document.getElementById('ai-version-prev').click();
    document.body.dataset.aiVersionLabelAfterPrev = document.getElementById('ai-version-label').textContent;
    const v1TextAgain = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';
    document.body.dataset.aiVersionPrevMatchesV1 = String(v1TextAgain === v1Text);

    document.getElementById('ai-version-next').click();
    document.body.dataset.aiVersionLabelAfterNext = document.getElementById('ai-version-label').textContent;

    const idxBeforeApply = history.depth().index;
    document.getElementById('ai-apply-replace').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    doc = frames.teacher.contentDocument;
    document.body.dataset.aiApplyOneOp = String(history.depth().index === idxBeforeApply + 1);
    const promptAfterApply = core.findObject('q1').obj.prompt;
    document.body.dataset.aiPromptChangedAfterApply = String(promptAfterApply !== origPrompt);
    document.body.dataset.aiFreshAfterApply = String(doc.querySelector('[data-oid="q1"]')?.getAttribute('data-ai-fresh') === 'true');

    history.undo();
    updateAll();
    await wait(80);
    document.body.dataset.aiUndoRestoredOriginal = String(core.findObject('q1').obj.prompt === origPrompt);
    document.body.dataset.aiUndoOneStep = String(history.depth().index === idxBeforeApply);
  } else if (seed === 'ai-graduate-insert') {
    // US-19: AI 산출 졸업 배지(적용 직후 표시 → 편집 즉시 제거) + "아래 삽입" 액션(원본 보존 확인).
    let qEl = doc.querySelector('[data-oid="q1"]');
    qEl.click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.getElementById('ai-apply-replace').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    doc = frames.teacher.contentDocument;
    qEl = doc.querySelector('[data-oid="q1"]');
    document.body.dataset.aiFreshBeforeEdit = String(qEl.getAttribute('data-ai-fresh') === 'true');

    qEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editTarget = qEl.querySelector('.q');
    editTarget.textContent = `${editTarget.textContent}(사용자 수정)`;
    editTarget.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    qEl = doc.querySelector('[data-oid="q1"]');
    document.body.dataset.aiFreshAfterEdit = String(qEl.getAttribute('data-ai-fresh') === 'true');

    const titleTextBefore = core.findObject('t1').obj.text;
    const beforeCount = core.allObjects().length;
    doc.querySelector('[data-oid="t1"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.getElementById('ai-apply-insert').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    doc = frames.teacher.contentDocument;
    document.body.dataset.aiInsertCountIncreased = String(core.allObjects().length === beforeCount + 1);
    document.body.dataset.aiInsertOriginalUnchanged = String(core.findObject('t1').obj.text === titleTextBefore);
  } else if (seed === 'ai-passage-preset') {
    // 3층 정책(2026-07-23 2차 델타): passage-slot 은 AI 가드에서 해제됐다 — 진입점 활성 + 지문 전용
    // 프리셋("창작 지문 생성"·"지문 재구성") 노출 + 요청 지시문에 저작권 제약 고지 + 미리보기까지 확인한다.
    const pasEl = doc.querySelector('[data-oid="pas1"]');
    pasEl.click();
    document.body.dataset.passageAiEntryEnabled = String(!document.getElementById('btn-ai').disabled);
    document.getElementById('btn-ai').click();
    document.body.dataset.passageAiPhase = document.getElementById('ai-panel')?.dataset.aiPhase || '(none)';
    document.body.dataset.hasGenerateBtn = String(!!document.getElementById('ai-preset-passage-generate'));
    document.body.dataset.hasRestructureBtn = String(!!document.getElementById('ai-preset-passage-restructure'));

    const topicInput = document.getElementById('ai-passage-topic-input');
    if (topicInput) topicInput.value = '인공지능과 글쓰기';
    document.getElementById('ai-preset-passage-generate').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    const copyText = document.getElementById('ai-copy-text').value;
    document.body.dataset.copyHasGuardNote = String(copyText.includes('실존 저작물'));

    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.passagePreviewShown = 'true';
    const afterRender = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';
    document.body.dataset.previewHasGenerated = String(afterRender.includes('AI가 창작한 지문 본문'));

    document.getElementById('ai-apply-replace').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    document.body.dataset.passageBodyAfterApply = core.findObject('pas1').obj.bodyHtml || '';
    document.body.dataset.passageSourceAfterApply = core.findObject('pas1').obj.source || '';

    // std-box 는 여전히 AI 가드 대상(원칙 3, 무회귀) — 같은 시드 안에서 교차 확인(적용이 iframe 을
    // 재로드했을 수 있으므로 doc 를 다시 잡는다 — ai-graduate-insert 시드와 동형 패턴).
    doc = frames.teacher.contentDocument;
    const stdEl2 = doc.querySelector('[data-oid="std1"]');
    stdEl2.click();
    document.body.dataset.stdAiEntryStillDisabled = String(document.getElementById('btn-ai').disabled);
  } else if (seed === 'image-workflow') {
    // US-20(S4.5) — F1 이미지 업로드 재작성: 업로드→개체 src 반영→GET 200 + 이미지가 실린
    // richtext 개체를 정답 마킹→저장 시 학생용 물리 제거(개체 단위 정답 규칙, image-slot 자체는
    // ANSWERABLE_TYPES 밖이라 부분요소 마킹 대신 이 경로로 동형 검증 — us20.md 기능 공백 참조).
    const imgEl = doc.querySelector('[data-oid="img1"]');
    imgEl.click();
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bin = atob(PNG_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], '시드샷.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const uploadInput = document.getElementById('insp-image-upload');
    uploadInput.files = dt.files;
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 60 && !core.findObject('img1').obj.src; i++) await wait(150);
    const assetPath = core.findObject('img1').obj.src || '';
    document.body.dataset.assetPath = assetPath;
    const assetRes = await fetch(`/${assetPath}`);
    document.body.dataset.assetGet = String(assetRes.status);

    doc = frames.teacher.contentDocument;
    const ansEl = doc.querySelector('[data-oid="rt-ans"]');
    ansEl.click();
    document.getElementById('tb-answer-toggle').click();
    document.body.dataset.ansMarked = String(core.findObject('rt-ans').obj.answer === true);

    const saved = await save();
    document.body.dataset.savedOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'undo-answer-toggle') {
    // US-20 — G002 재작성 ①: 정답 마킹이 되돌리기/다시하기 대상에 들어온다(개체 단위 answer:true).
    const r1 = doc.querySelector('[data-oid="r1"]');
    r1.click();
    document.body.dataset.undoMarksBase = core.findObject('r1').obj.answer === true ? '1' : '0';
    document.getElementById('tb-answer-toggle').click();
    await wait(120); // applyDocOp 는 비동기(iframe 재로드 후 커밋) — history.commit() 완료 대기
    document.body.dataset.undoMarksAfter = core.findObject('r1').obj.answer === true ? '1' : '0';
    history.undo();
    document.body.dataset.undoMarksUndone = core.findObject('r1').obj.answer === true ? '1' : '0';
    history.redo();
    document.body.dataset.undoMarksRedone = core.findObject('r1').obj.answer === true ? '1' : '0';
  } else if (seed === 'undo-lines') {
    // US-20 — G002 재작성 ②: 답란 줄 수 변경(구 "답란 5줄 삽입"의 개체 모델 동형)이 되돌리기 대상.
    const aaEl = doc.querySelector('[data-oid="aa1"]');
    aaEl.click();
    document.body.dataset.undoLinesBase = String(core.findObject('aa1').obj.lines);
    const linesInput = document.getElementById('insp-aa-lines');
    linesInput.value = '8';
    linesInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    document.body.dataset.undoLinesAfter = String(core.findObject('aa1').obj.lines);
    history.undo();
    document.body.dataset.undoLinesUndone = String(core.findObject('aa1').obj.lines);
  } else if (seed === 'undo-interleave') {
    // US-20 — G002 재작성 ③: 타이핑과 명령이 교차해도 친 역순으로 풀린다. 타이핑은 유휴
    // 500ms(TYPING_IDLE_MS) 후 자동 커밋되므로, 그 뒤에 명령(정답 토글)을 실행해야 두 단계로
    // 분리된다(즉시 이어치면 한 커밋으로 합쳐진다 — history.js 주석 참조, 의도된 동작).
    let r2 = doc.querySelector('[data-oid="r2"]');
    r2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    r2.innerHTML = '<p>원문(수정)</p>';
    r2.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650); // 유휴 커밋 대기(타이핑 = 1단계)
    doc = frames.teacher.contentDocument;
    r2 = doc.querySelector('[data-oid="r2"]');
    r2.click();
    document.getElementById('tb-answer-toggle').click(); // 명령 = 2단계(별도 커밋)
    await wait(120); // applyDocOp 는 비동기(iframe 재로드 후 커밋) — history.commit() 완료 대기
    document.body.dataset.ilTypedAndMarked = String(
      core.findObject('r2').obj.html.includes('수정') && core.findObject('r2').obj.answer === true,
    );
    history.undo(); // 1차: 명령(정답 마킹)만 취소
    document.body.dataset.ilAfterFirstTyped = String(core.findObject('r2').obj.html.includes('수정'));
    document.body.dataset.ilAfterFirstAnswer = String(core.findObject('r2').obj.answer === true);
    history.undo(); // 2차: 타이핑까지 취소
    document.body.dataset.ilAfterSecondTyped = String(core.findObject('r2').obj.html.includes('수정'));
  } else if (seed === 'answer-mark-save') {
    // US-20 — E3(§6②) 재작성: 정답 마킹→저장 시 학생용 물리 제거(파일 왕복은 테스트가 직접 확인).
    const r1 = doc.querySelector('[data-oid="r1"]');
    r1.click();
    document.getElementById('tb-answer-toggle').click();
    document.body.dataset.markedAnswer = String(core.findObject('r1').obj.answer === true);
    const saved = await save();
    document.body.dataset.savedUnsafe = String(saved?.unsafe);
  } else if (seed === 'lines-save') {
    // US-20 — E3(§6③) 재작성: 답란 줄 수 변경→저장→manifest 반영(개체 모델 동형).
    const aaEl = doc.querySelector('[data-oid="aa1"]');
    aaEl.click();
    const linesInput = document.getElementById('insp-aa-lines');
    linesInput.value = '8';
    linesInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    document.body.dataset.linesAfter = String(core.findObject('aa1').obj.lines);
    const saved = await save();
    document.body.dataset.savedOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'min-font-check') {
    // US-20 — E3(§6④) 재작성: 저장 시 라이브 검수(runReview)가 최소 글자 크기 경고를 반영한다.
    // 신 UI 는 타이핑마다 재검수를 배선하지 않는다(us20.md 기능 공백) — 저장 시점에 반영된다.
    await save();
    document.body.dataset.reviewStatusVal = document.getElementById('btn-review').dataset.reviewStatus;
    document.body.dataset.reviewCountVal = document.getElementById('btn-review').dataset.reviewCount;
  } else if (seed === 'passage-edit-save') {
    // 저작권 지문 2층 정책(2026-07-23): AI 는 여전히 채우지 못하지만(aiBridge 타입 가드 무변경),
    // 교사는 편집기에서 passage-slot 본문을 더블클릭해 직접 입력할 수 있다 — slotLabel 플레이스홀더
    // (.slot)에서 시작해 더블클릭 편집→입력→저장까지 왕복한다(selection.js EDIT_FIELD 등재 검증).
    let pasEl = doc.querySelector('[data-oid="pas1"]');
    document.body.dataset.passageHasSlotBefore = String(!!pasEl.querySelector('.slot'));
    pasEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    document.body.dataset.passageEditingId = selection.state.editingId ?? '(none)';
    const passageTarget = pasEl.querySelector('.slot');
    document.body.dataset.passageClearedOnEnter = String(passageTarget.textContent === '');
    passageTarget.textContent = '이것은 교사가 직접 입력한 지문 본문입니다.';
    passageTarget.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.dataset.passageBodySynced = core.findObject('pas1').obj.bodyHtml;
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();

    // 렌더는 bodyHtml 유무로 .passage-body/.slot 을 분기한다(RenderObjectTree) — 편집 직후의 살아있는
    // DOM 은 아직 옛 .slot 골격 그대로다(contenteditable 은 DOM 을 직접 바꿀 뿐 재렌더는 아니다).
    // runReflow() 는 페이지 귀속이 실제로 바뀔 때만 프레임을 다시 그리므로(변경 없으면 no-op), 여기서는
    // reloadTeacherFrame 을 직접 불러 RenderObjectTree 의 분기 결과를 강제로 실측한다.
    await reloadTeacherFrame(core.getDocument());
    doc = frames.teacher.contentDocument;
    pasEl = doc.querySelector('[data-oid="pas1"]');
    document.body.dataset.passageHasBodyAfterReflow = String(!!pasEl.querySelector('.passage-body'));
    document.body.dataset.passageHasSlotAfterReflow = String(!!pasEl.querySelector('.slot'));

    document.body.dataset.passageRevBeforeSave = String(currentRevision ?? '');
    const savedPassage = await save();
    document.body.dataset.passageRevAfterSave = String(currentRevision ?? '');
    document.body.dataset.passageSaveOk = String(savedPassage != null && savedPassage.unsafe === false);
  } else if (seed === 'export-ui') {
    // US-20 — E6 재작성: 앱 바 버튼·문서설정 용지 프리셋 선택기·[A5] 비-dirty save-first 무왕복.
    document.body.dataset.e6Buttons = String(!!document.getElementById('btn-preview') && !!document.getElementById('btn-export'));
    const presetSel = document.getElementById('insp-paper-preset');
    document.body.dataset.paperOptions = String(presetSel.options.length);
    document.body.dataset.paperPresetValue = presetSel.value;
    let saveCalls = 0;
    const origFetch = window.fetch;
    window.fetch = (...args) => { if (String(args[0]).includes('/save')) saveCalls++; return origFetch(...args); };
    presetSel.dispatchEvent(new Event('change', { bubbles: true })); // 같은 값 재선택 = no-op
    await wait(250);
    window.fetch = origFetch;
    document.body.dataset.saveFirstNoop = String(saveCalls === 0);
  } else if (seed === 'preset-workflow') {
    // US-20 — E4 재작성: 우클릭 "내 블록으로 저장" → /presets 등재(정제 포함) → 내 블록 탭
    // 삽입 → 저장 시 manifest 반영.
    const r1 = doc.querySelector('[data-oid="r1"]');
    r1.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
    await wait(30);
    const menuBtns = [...document.querySelectorAll('#popups-host .ctx-menu button')];
    const saveBtn = menuBtns.find((b) => b.textContent.includes('내 블록으로 저장'));
    saveBtn.click();
    let list = { presets: [] };
    for (let i = 0; i < 40 && (list.presets || []).length < 1; i++) {
      await wait(150);
      list = await (await fetch('/presets')).json();
    }
    document.body.dataset.presetSaved = String((list.presets || []).length >= 1);
    const savedPreset = (list.presets || [])[0];
    document.body.dataset.presetClean = String(
      !!savedPreset && !savedPreset.html.includes('contenteditable') && !savedPreset.html.includes('data-oid'),
    );

    document.querySelector('[data-tab="myblocks"]').click();
    await pollUntil(() => Number(document.getElementById('left-panel').dataset.presetCount || '0') >= 1, { timeoutMs: 8000 }).catch(() => {});
    const beforeInsertCount = core.allObjects().length;
    document.querySelector('#preset-list .preset-btn')?.click();
    await pollUntil(() => core.allObjects().length > beforeInsertCount, { timeoutMs: 8000 }).catch(() => {});
    document.body.dataset.presetInserted = String(core.allObjects().length > beforeInsertCount);

    const saved = await save();
    document.body.dataset.presetSaveDocOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'shapes-workflow') {
    // US-20 — US-E3 재작성: 도형(float) 서식 변경이 렌더에 반영·되돌리기 단계 분리·드래그 1:1·저장 왕복.
    let shEl = doc.querySelector('[data-oid="sh1"]');
    shEl.click();
    document.body.dataset.shapeKind = core.findObject('sh1').obj.shapeKind;
    document.body.dataset.shapeWidthPx = String(Math.round(shEl.getBoundingClientRect().width));

    const strokeInput = document.getElementById('tb-shape-stroke');
    strokeInput.value = '#1a7f37';
    strokeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    doc = frames.teacher.contentDocument;
    shEl = doc.querySelector('[data-oid="sh1"]');
    document.body.dataset.shapeStrokeAfter = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).stroke;

    const fillInput = document.getElementById('tb-shape-fill');
    fillInput.value = '#fde68a';
    fillInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    doc = frames.teacher.contentDocument;
    shEl = doc.querySelector('[data-oid="sh1"]');
    document.body.dataset.shapeFillAfter = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).fill;

    history.undo(); // 채우기 변경만 취소(선 색 변경은 유지 — 단계 분리)
    doc = frames.teacher.contentDocument;
    shEl = doc.querySelector('[data-oid="sh1"]');
    document.body.dataset.shapeUndoFill = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).fill;
    document.body.dataset.shapeUndoStrokeKept = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).stroke;

    const rectBefore = { ...core.findObject('sh1').obj.rect };
    const pe = (type, sx, sy) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 9, screenX: sx, screenY: sy, clientX: sx, clientY: sy,
    });
    shEl.click();
    shEl.dispatchEvent(pe('pointerdown', 400, 400));
    shEl.dispatchEvent(pe('pointermove', 438, 424));
    shEl.dispatchEvent(pe('pointerup', 438, 424));
    const rectAfter = core.findObject('sh1').obj.rect;
    const MM_TO_PX = 96 / 25.4;
    document.body.dataset.shapeDragExpectMm = String(Math.round((38 / MM_TO_PX) * 10) / 10);
    document.body.dataset.shapeDragDeltaMm = String(Math.round((rectAfter.xMm - rectBefore.xMm) * 10) / 10);

    const saved = await save();
    document.body.dataset.shapeSaved = String(saved != null && saved.unsafe === false);
  } else if (seed === 'table-ops') {
    // US-20 — 표 구조 편집 재작성: 헤더 중복 없음(add-row 는 header:true 를 붙이지 않음)·
    // 열 추가 시 모든 행 열 수 균일·행 삭제는 최소 1행에서 멈춘다(구버전 "데이터 1행 보존" 정책은
    // 새 모델에 없음 — us20.md 기능 공백).
    document.getElementById('tb-add-row'); // (표 이미 선택된 상태로 fixture 진입)
    const tblEl = doc.querySelector('[data-oid="tbl1"]');
    tblEl.click();
    document.body.dataset.rowsInitial = String(core.findObject('tbl1').obj.rows.length);
    document.body.dataset.headerRowsInitial = String(core.findObject('tbl1').obj.rows.filter((r) => r.every((c) => c.header)).length);

    document.getElementById('tb-add-row').click();
    await wait(80);
    document.body.dataset.rowsAfterAdd = String(core.findObject('tbl1').obj.rows.length);
    document.body.dataset.headerRowsAfterAdd = String(core.findObject('tbl1').obj.rows.filter((r) => r.every((c) => c.header)).length);

    document.getElementById('tb-add-col').click();
    await wait(80);
    const rowsAfterCol = core.findObject('tbl1').obj.rows;
    document.body.dataset.colsAfterAdd = String(rowsAfterCol[0].length);
    document.body.dataset.colsUniform = String(rowsAfterCol.every((r) => r.length === rowsAfterCol[0].length));

    document.getElementById('tb-del-row').click();
    await wait(80);
    document.body.dataset.rowsAfterFirstDel = String(core.findObject('tbl1').obj.rows.length);
    document.getElementById('tb-del-row').click();
    await wait(80);
    document.body.dataset.rowsAfterSecondDel = String(core.findObject('tbl1').obj.rows.length);
    document.getElementById('tb-del-row').click(); // rows.length===1 이면 이제 무시되어야 함
    await wait(80);
    document.body.dataset.rowsFloor = String(core.findObject('tbl1').obj.rows.length);

    const saved = await save();
    document.body.dataset.tableSaveOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'float-richtext') {
    // US-20 — 자유 배치 텍스트 재작성: 신 UI 는 전용 textbox 타입이 아니라 richtext(placement:float)
    // 로 자유배치 텍스트를 표현한다(us20.md 기능 공백: 빈 상자 자동삭제·AI 텍스트 전용 변환은 없음 —
    // 대신 범용 flow⇄float 토글로 어떤 개체든 전환 가능하다).
    document.querySelector('[data-tab="insert"]').click();
    document.getElementById('insert-float-toggle').checked = true;
    document.querySelector('#insert-grid [data-insert-key="richtext"]').click();
    await wait(150);
    clearTimeout(reflowTimer);
    doc = frames.teacher.contentDocument;
    const newId = [...selection.state.selectedIds][0];
    document.body.dataset.newObjType = core.findObject(newId).obj.type;
    document.body.dataset.newObjPlacement = core.findObject(newId).obj.placement;
    document.body.dataset.inspKind = document.getElementById('right-panel').querySelector('[data-insp-type]')?.dataset.inspType || '';

    let el = doc.querySelector(`[data-oid="${newId}"]`);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    el.innerHTML = '<p>자유 배치 텍스트</p>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650);
    document.body.dataset.editedText = String(core.findObject(newId).obj.html.includes('자유 배치 텍스트'));

    doc = frames.teacher.contentDocument;
    el = doc.querySelector(`[data-oid="${newId}"]`);
    el.click();
    const rectBefore = { ...core.findObject(newId).obj.rect };
    const pe = (type, sx, sy) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 11, screenX: sx, screenY: sy, clientX: sx, clientY: sy,
    });
    el.dispatchEvent(pe('pointerdown', 300, 300));
    el.dispatchEvent(pe('pointermove', 320, 315));
    el.dispatchEvent(pe('pointerup', 320, 315));
    const rectAfter = core.findObject(newId).obj.rect;
    document.body.dataset.movable = String(rectAfter.xMm !== rectBefore.xMm || rectAfter.yMm !== rectBefore.yMm);

    doc = frames.teacher.contentDocument;
    doc.querySelector('.sheet').click(); // 드래그 직후 click 1회 삼키기 소진(스파이크 §4-5 패턴)
    const r3 = doc.querySelector('[data-oid="r3"]');
    r3.click();
    document.body.dataset.r3PlacementBefore = core.findObject('r3').obj.placement;
    document.getElementById('tb-flowfloat').click();
    await wait(80);
    document.body.dataset.r3PlacementAfter = core.findObject('r3').obj.placement;

    const saved = await save();
    document.body.dataset.floatSaveOk = String(saved != null && saved.unsafe === false);
    document.body.dataset.savedExists = String(!!core.findObject(newId));
  } else if (seed === 'view-toggle') {
    // US-20 — 눈금자/격자/여백선 재작성: 신 UI 는 CSS 클래스 토글(전역 보기 메뉴)만 제공한다
    // (us20.md 기능 공백: 픽셀 단위 눈금 개수·드래그 중 중앙 스냅 안내선은 없음).
    const classesOf = () => [...frames.teacher.contentDocument.body.classList].join(',');
    document.body.dataset.marginsOnInitial = String(classesOf().includes('wg-show-margins'));
    document.body.dataset.rulerOnInitial = String(classesOf().includes('wg-show-ruler'));
    document.body.dataset.gridOnInitial = String(classesOf().includes('wg-show-grid'));

    document.getElementById('tb-view-menu').click();
    document.querySelector('#tb-view-dropdown input[data-view-key="grid"]').click();
    document.querySelector('#tb-view-dropdown input[data-view-key="margins"]').click();
    await wait(30);
    document.body.dataset.gridOnAfter = String(classesOf().includes('wg-show-grid'));
    document.body.dataset.marginsOnAfter = String(classesOf().includes('wg-show-margins'));
    document.body.dataset.rulerStillOn = String(classesOf().includes('wg-show-ruler'));

    const floatEl = doc.querySelector('.wg-float[data-oid]');
    floatEl.click();
    document.body.dataset.floatHandlePresent = String(!!doc.querySelector('.wg-float.wg-selected .wg-float-handle'));
  } else if (seed === 'migration-edit') {
    // US-20 — 마이그레이션 UX 종단: 지연 마이그레이션으로 승격된 개체(mig-0-0)를 실제로 편집한다.
    document.body.dataset.migratedFlag = String(shell.migrated);
    const titleEl = doc.querySelector('[data-oid="mig-0-0"]');
    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const target = titleEl.querySelector('.title-box h1, .title-box h2');
    target.textContent = '편집된 제목(마이그레이션 후)';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650);
    const saved = await save();
    document.body.dataset.savedOk = String(saved != null && saved.unsafe === false);
    document.body.dataset.savedPagination = core.getDocument().pagination;
  } else if (seed === 'student-fresh') {
    // US-E1: 교사 편집(제목) → '학생용' 전환 시 학생 프레임이 최신 편집을 반영하고, 편집 크롬 없이
    // (비 editMode = data-oid 래퍼 부재) answer 개체가 물리 제거된 학생 변형으로 렌더되는지 확인.
    const titleEl = doc.querySelector('[data-oid="t1"]');
    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const target = titleEl.querySelector('.title-box h1, .title-box h2');
    target.textContent = '학생 미리보기 최신화 확인 제목';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650); // 타이핑 유휴 커밋(TYPING_IDLE_MS)

    document.body.dataset.studentStaleBeforeSwitch = String(studentStale);
    await setMode('student');
    await pollUntil(() => {
      const sf = frames.student?.contentDocument;
      return !!sf && sf.body && sf.body.textContent.includes('학생 미리보기 최신화 확인 제목');
    }, { timeoutMs: 20000 }).catch(() => {});
    const sdoc = frames.student?.contentDocument;
    document.body.dataset.studentHasEdit = String(!!sdoc && sdoc.body.textContent.includes('학생 미리보기 최신화 확인 제목'));
    // 학생용은 편집 모드가 아니다 — data-oid 편집 래퍼가 없어야 한다.
    document.body.dataset.studentNoEditWrappers = String(!!sdoc && sdoc.querySelectorAll('[data-oid]').length === 0);
    // answer:true 개체(rt-ans)의 정답 텍스트는 학생용에 물리적으로 없어야 한다(BuildVariants student).
    document.body.dataset.studentAnswerHidden = String(!!sdoc && !sdoc.body.textContent.includes('정답전용텍스트'));
    document.body.dataset.studentStaleAfterSwitch = String(studentStale);
  } else if (seed === 'nudge') {
    // US-E2: 자유 개체 선택 후 방향키 넛지(1mm)·Shift 큰 이동(10mm)·다른 축 불변·undo 원복.
    const f1 = doc.querySelector('[data-oid="f1"]');
    f1.click(); // float 선택(합성 클릭은 pointer-events 와 무관하게 대상에 발화)
    document.body.dataset.nudgeSelected = String(selection.state.selectedIds.has('f1'));
    const rect0 = { ...core.findObject('f1').obj.rect };

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const rectR = { ...core.findObject('f1').obj.rect };
    document.body.dataset.nudgeRightDx = String(Math.round((rectR.xMm - rect0.xMm) * 10) / 10);
    document.body.dataset.nudgeRightYUnchanged = String(rectR.yMm === rect0.yMm);

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, shiftKey: true }));
    const rectD = { ...core.findObject('f1').obj.rect };
    document.body.dataset.nudgeShiftDownDy = String(Math.round((rectD.yMm - rectR.yMm) * 10) / 10);

    history.undo();
    history.undo();
    const rectU = core.findObject('f1').obj.rect;
    document.body.dataset.nudgeUndone = String(rectU.xMm === rect0.xMm && rectU.yMm === rect0.yMm);

    // flow 개체는 방향키에 반응하지 않는다(넛지는 float 전용).
    doc.querySelector('.sheet').click();
    const q1 = doc.querySelector('[data-oid="q1"]');
    q1.click();
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.body.dataset.nudgeFlowNoRect = String(core.findObject('q1').obj.rect === undefined);
  } else if (seed === 'copy-paste') {
    // US-E3: 개체 복사(Ctrl+C) → 다른 개체 선택 → 붙여넣기(Ctrl+V): 개체 수 +1, 새 id≠원본,
    // 필드 복제, 원본 보존, 새 개체 자동 선택, undo 로 원복. 붙여넣기 앵커는 현재 선택(t1) 뒤.
    const q1 = doc.querySelector('[data-oid="q1"]');
    q1.click();
    const beforeCount = core.allObjects().length;
    const q1Prompt = core.findObject('q1').obj.prompt;

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    document.body.dataset.cpClipboardCount = String(objectClipboard.length);

    const t1 = doc.querySelector('[data-oid="t1"]');
    t1.click();
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    // applyDocOp 은 비동기(core.setDocument → await reloadTeacherFrame → selection.select 순) — 개체
    // 수 증가만이 아니라 선택 확정까지 기다린다(카운트만 보면 selection.select 이전에 읽는 경합).
    await pollUntil(() => {
      const sel = [...selection.state.selectedIds];
      return core.allObjects().length === beforeCount + 1
        && sel.length === 1 && sel[0] !== 't1' && core.findObject(sel[0])?.obj?.type === 'question';
    }, { timeoutMs: 15000 }).catch(() => {});
    document.body.dataset.cpCountIncreased = String(core.allObjects().length === beforeCount + 1);

    const newId = [...selection.state.selectedIds][0];
    const newObj = newId ? core.findObject(newId)?.obj : null;
    document.body.dataset.cpNewSelected = String(!!newId && newId !== 'q1');
    document.body.dataset.cpNewIsQuestion = String(newObj?.type === 'question');
    document.body.dataset.cpNewPromptMatches = String(newObj?.prompt === q1Prompt);
    document.body.dataset.cpOriginalPreserved = String(!!core.findObject('q1') && core.findObject('q1').obj.prompt === q1Prompt);
    // 붙여넣은 개체는 앵커(t1, index 0) 바로 뒤에 온다.
    const flow0 = core.getDocument().pages[0].flow.map((o) => o.id);
    document.body.dataset.cpPastedAfterAnchor = String(flow0[0] === 't1' && flow0[1] === newId);

    history.undo();
    await wait(60);
    document.body.dataset.cpUndone = String(core.allObjects().length === beforeCount);
  } else if (seed === 'affordance') {
    // US-E4: 교사 친화 표현(배치 전환 버튼에 원시 용어 없음) + 색상 라벨 + 편집 발견성 힌트.
    const q1 = doc.querySelector('[data-oid="q1"]');
    q1.click();
    const flowfloatTitle = document.getElementById('tb-flowfloat')?.title || '';
    document.body.dataset.affFlowfloatNoRawTerm = String(!flowfloatTitle.includes('기본 개체') && !flowfloatTitle.includes('자유 개체'));
    // 편집 가능 개체(question) 선택 → 편집 힌트 존재.
    document.body.dataset.affEditHintOnEditable = String(!!document.getElementById('tb-edit-hint'));
    // 글자색 컨트롤에 식별용 title(라벨) 존재.
    const colorInput = document.getElementById('tb-color');
    document.body.dataset.affColorHasTitle = String(!!colorInput && colorInput.title.length > 0);
    // 인스펙터 헤더 배치 라벨에 원시 용어 없음(question=본문 배치).
    const inspHeader = document.querySelector('#right-panel h3')?.textContent || '';
    document.body.dataset.affInspNoRawTerm = String(!inspHeader.includes('기본 개체') && !inspHeader.includes('자유 개체'));
    document.body.dataset.affInspHasFriendly = String(inspHeader.includes('본문 배치'));

    // std-box(비편집) 선택 → 편집 힌트 없음.
    doc.querySelector('.sheet').click();
    const s1 = doc.querySelector('[data-oid="s1"]');
    s1.click();
    document.body.dataset.affNoHintOnStdBox = String(!document.getElementById('tb-edit-hint'));
  } else if (seed === 'zoom') {
    // 이월 항목: 확대(>100%) 시 좌우·상하 잘림 수정 — 스케일된 콘텐츠 전체가 스크롤로 접근되는지 실측.
    const canvasWrap = document.getElementById('canvas-wrap');
    const zoomIn = document.getElementById('tb-zoom-in');
    for (let i = 0; i < 5; i++) zoomIn.click(); // 100 → 150%
    await wait(60);
    document.body.dataset.zoomLabel = document.getElementById('tb-zoom-label').textContent;
    const rect = stage.getBoundingClientRect();
    // 스크롤 영역이 스케일된 콘텐츠 전체를 담아야(좌우/상하 접근 가능) 잘리지 않는다.
    document.body.dataset.zoomScrollWidthOk = String(canvasWrap.scrollWidth + 2 >= Math.round(rect.width));
    document.body.dataset.zoomScrollHeightOk = String(canvasWrap.scrollHeight + 2 >= Math.round(rect.height));
    document.body.dataset.zoomOriginAt150Left = String(/left/.test(stage.style.transformOrigin)); // 브라우저는 'top left'를 'left top'으로 직렬화
    document.body.dataset.zoomMarginReserved = String(parseFloat(stage.style.marginRight) > 0 && parseFloat(stage.style.marginBottom) > 0);
    // 100% 복귀 시 여백 해제 + 가운데 정렬 origin 복귀.
    const zoomOut = document.getElementById('tb-zoom-out');
    for (let i = 0; i < 5; i++) zoomOut.click(); // 150 → 100%
    await wait(60);
    document.body.dataset.zoomLabelBack = document.getElementById('tb-zoom-label').textContent;
    document.body.dataset.zoomOriginBackCenter = String(/center/.test(stage.style.transformOrigin));
    document.body.dataset.zoomMarginCleared = String(!stage.style.marginRight && !stage.style.marginBottom);
  } else if (seed === 'format-text') {
    // 이월 항목: 문항/제목 인라인 서식(굵게) — 편집 중 선택 텍스트에 bold 적용 → promptHtml 저장,
    // 평문 prompt 유지, 렌더에 서식 반영, 저장 왕복, 하위호환(평문 편집은 htmlField 미생성).
    const win = doc.defaultView;
    const qEl = doc.querySelector('[data-oid="q1"]');
    qEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const qTarget = qEl.querySelector('.q');
    document.body.dataset.ftBoldEnabled = String(!document.getElementById('tb-bold')?.disabled);

    // .q 안 프롬프트 텍스트 노드(qnum 배지 제외) 일부를 선택한 뒤 굵게.
    const walker = doc.createTreeWalker(qTarget, NodeFilter.SHOW_TEXT);
    let textNode = null;
    while (walker.nextNode()) { if (!walker.currentNode.parentElement.closest('.qnum')) { textNode = walker.currentNode; break; } }
    const range = doc.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(2, textNode.textContent.length));
    const sel = win.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.getElementById('tb-bold').click();
    await wait(30);
    const q1 = core.findObject('q1').obj;
    document.body.dataset.ftPromptHtmlHasMarkup = String(typeof q1.promptHtml === 'string' && /<(b|strong|i|em|u|span|font)\b/i.test(q1.promptHtml));
    document.body.dataset.ftPlainPromptPreserved = String(typeof q1.prompt === 'string' && !/</.test(q1.prompt));

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    // 재렌더로 promptHtml 이 렌더 DOM 에 서식 요소로 반영되는지 확인(qnum 은 별도 span 이라 제외).
    await reloadTeacherFrame(core.getDocument());
    doc = frames.teacher.contentDocument;
    const qAfter = doc.querySelector('[data-oid="q1"] .q');
    document.body.dataset.ftRenderedMarkup = String(!!qAfter && !!qAfter.querySelector('b, strong, i, em, u, [style*="bold"], [style*="font-weight"]'));

    // 하위호환: 평문만 편집한 제목엔 textHtml 이 생기지 않는다.
    const t1El = doc.querySelector('[data-oid="t1"]');
    t1El.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const tTarget = t1El.querySelector('.title-box h1, .title-box h2');
    tTarget.textContent = '평문만 제목';
    tTarget.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.ftPlainTitleNoHtml = String(core.findObject('t1').obj.textHtml === undefined);

    const saved = await save();
    document.body.dataset.ftSaveOk = String(saved != null && saved.unsafe === false);
    // 저장 왕복 후 서버 저장본에도 promptHtml 이 실렸는지 교차 확인.
    const shell2 = await (await fetch(`/shell.json?_=${Date.now()}`)).json();
    const savedQ = shell2.document.pages.flatMap((p) => p.flow).find((o) => o.id === 'q1');
    document.body.dataset.ftSavedPromptHtmlPersisted = String(typeof savedQ?.promptHtml === 'string' && /<(b|strong|i|em|u|span|font)\b/i.test(savedQ.promptHtml));
  }
  document.body.dataset.seedDone = seed;
}
