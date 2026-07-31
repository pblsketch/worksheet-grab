// 에디터(S4.3) 클라이언트 — 바닐라 ESM, 빌드 0. US-16/17(개체 우선 조작 코어·리플로우)을 그대로
// 소비하며 신 UI 셸(앱 바·컨텍스트 툴바·좌 3탭·우 인스펙터·캔버스 인라인)을 조립한다.
//
// 원칙: /shell.json 의 개체 트리(document)가 단일 진실 — core.js 가 메모리에 들고, selection.js 가
// 클릭=선택/더블클릭=편집을 담당하며, history.js 가 조작을 인메모리 undo/redo 한다. 저장은 명시
// Ctrl+S 와 유휴 자동 체크포인트(30초)뿐(S2.4). 구조 변경(삽입·삭제·순서·용지)은 objectFactory.js
// 의 순수 연산으로 다음 문서를 계산한 뒤 applyDocOp() 한 곳으로 몰아 reload→select→commit→
// review→reflow 순서를 항상 동일하게 유지한다.
import { createDocumentStore } from '/editor/core.js';
import { createSelectionController, innerHtmlWithoutChrome } from '/editor/selection.js';
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
import { injectEditorStyle } from '/editor/editorStyle.js';
import { createShortcuts, SHORTCUTS } from '/editor/shortcuts.js';
import { createBanner } from '/editor/banner.js';
import { createSaveController } from '/editor/saveController.js';
import { createExportController } from '/editor/exportController.js';
import { createReviewChip } from '/editor/reviewChip.js';

const shell = await (await fetch('/shell.json')).json();
const stage = document.getElementById('stage');

// S4.2(M4a) 리플로우 — teacher 문서의 <style> 원문을 최초 1회 뽑아 둔다(리플로우 측정용 숨은
// iframe·전체 재렌더 모두 이 CSS 를 그대로 재사용 — 서버에 별도 자산 엔드포인트를 추가하지 않는다).
const teacherStyleTag = extractStyleTag(shell.teacherHtml);

const docTitleEl = document.getElementById('doc-title');
docTitleEl.textContent = shell.docTitle || '(제목 없음)';

// ── 상태: 개체 트리(core) · 선택/편집(selection) · 되돌리기(history) ──
const core = createDocumentStore(shell.document);
let studentStale = false; // US-E1: 교사 편집 후 학생용 미리보기가 최신 편집을 반영하지 못하는 상태
let activePageId = core.getDocument().pages?.[0]?.id ?? null;

// ── Phase 5 분리 모듈: 배너 · 저장 · 검수 칩 · 내보내기/미리보기 ──
// 전부 create*(deps) 팩토리이며 core/history/selection 을 직접 보지 않는다 — 문서 접근은 콜백뿐.
const showBanner = createBanner({ root: document.getElementById('save-banner') });

const reviewChip = createReviewChip({
  chipEl: document.getElementById('btn-review'),
  getDocument: () => core.getDocument(),
  getTeacherDoc: () => frames.teacher?.contentDocument ?? null,
  onChipClick: () => { selection.clearAll(); updateAll(); },
});
const runReview = reviewChip.runReview;

const saveController = createSaveController({
  getDocument: () => core.getDocument(),
  setDocument: (next) => core.setDocument(next),
  showBanner,
  onSaved: runReview,
  onDirty: () => { studentStale = true; }, // 편집이 생겼으니 학생용 미리보기는 다음 전환 때 다시 렌더한다.
  revEl: document.getElementById('doc-rev'),
  bodyEl: document.body,
  saveButton: document.getElementById('btn-save'),
  initialRevision: shell.meta?.revision ?? null,
});
const { save, markDirty } = saveController;
const isDirty = saveController.isDirty;

createExportController({
  isDirty,
  save,
  showBanner,
  getMode: () => mode,
  previewButton: document.getElementById('btn-preview'),
  previewModal: document.getElementById('preview-modal'),
  previewImg: document.getElementById('preview-img'),
  previewStatus: document.getElementById('preview-status'),
  previewCloseButton: document.getElementById('preview-close'),
  exportButton: document.getElementById('btn-export'),
  exportResultHost: document.getElementById('export-result'),
});

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
  // history.restore 가 body.innerHTML 을 교체했다 = 재렌더 뒤(측정 가능).
  refreshDerived({ level: 'render' });
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
  // 툴바·인스펙터·레이어는 즉시(입력 반응성), 무거운 파생 뷰(썸네일 직렬화·검수)는 유휴에 몰아서.
  refreshDerived({ level: 'selection' });
  scheduleDerived();
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
      // 선택 복원(:203 refreshVisual) 뒤라야 측정 규칙이 .wg-selected 를 본다(결정 A-1).
      // 종전엔 썸네일·검수만 갱신하고 updateAll·레이어 목록을 빠뜨려, 리플로우가 개체를 페이지 간
      // 이동시키면 좌측 목록이 낡은 구성을 유지했다(C16).
      refreshDerived({ level: 'render', thumbIndex: activeIndexBefore });
      // 리플로우는 사용자 조작이 아니라 파생 재계산이라 자기 되돌리기 단계를 갖지 않는다 —
      // commit() 이면 undo 가 이 단계에 갇혀 삭제를 영영 되돌릴 수 없다(history.amend 주석 참조).
      history.amend();
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
  // ⚠ 여기서 measure 를 돌면 안 된다. body 교체로 .wg-selected 가 전부 사라졌고 선택 복원은
  //   **호출부가 이 함수 다음에** 한다 — 그 사이에 재면 floatLayout 의 "선택 상태면 억제"(결정 A-1)
  //   가 항상 false 로 떨어져 승격 직후에 바로 경고가 뜬다. 호출부 2곳(applyDocOp·runReflow)이
  //   선택 복원 뒤에 runReview({measure:true}) 를 부른다.
  runReview();
  return Promise.resolve();
}

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
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

// ── 좌/우 패널 접기(캔버스 공간 확보) — 뷰 상태라 localStorage 로만 보관한다(문서/ manifest 아님,
// 원칙 4 경계). 셸 그리드 변수만 바꾸므로 iframe 내부=인쇄 산출은 불변(R2-1). ──
const PANEL_STORAGE_KEYS = { left: 'wg-left-collapsed', right: 'wg-right-collapsed' };
const workspaceEl = document.getElementById('workspace');
function readPanelCollapsed(side) {
  try { return localStorage.getItem(PANEL_STORAGE_KEYS[side]) === '1'; } catch { return false; }
}
function applyPanelState() {
  for (const side of ['left', 'right']) {
    const collapsed = readPanelCollapsed(side);
    workspaceEl.classList.toggle(`${side}-collapsed`, collapsed);
    document.getElementById(`tb-toggle-${side}`)?.classList.toggle('active', collapsed);
  }
  fitFrame(frames.teacher);
}
function togglePanel(side) {
  if (side !== 'left' && side !== 'right') return;
  const collapsed = workspaceEl.classList.toggle(`${side}-collapsed`);
  try { localStorage.setItem(PANEL_STORAGE_KEYS[side], collapsed ? '1' : '0'); } catch { /* 저장 불가 환경 무시 */ }
  document.getElementById(`tb-toggle-${side}`)?.classList.toggle('active', collapsed);
  fitFrame(frames.teacher);
  // 좌 패널을 펼칠 때 썸네일을 다시 그린다 — display:none 동안엔 rect 가 0 이라 폴백 치수로 그려졌을 수 있다.
  if (side === 'left' && !collapsed) renderPageThumbs();
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
  shortcuts.attach(doc);
  doc.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); history.undo(); updateAll(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); history.redo(); updateAll(); }
  });
  if (resetHistory) history.reset();
  applyViewState();
  runReview({ measure: true }); // 프레임 load 직후 = 재렌더 뒤
  updateAll();
  renderPageThumbs();
}

// 개체 단축키(삭제·넛지·복사/붙여넣기·저장·undo/redo) — 부모 문서와 teacher iframe 양쪽에 건다
// (iframe 은 로드마다 새 document 라 initTeacherEditing 이 shortcuts.attach 로 다시 건다).
const shortcuts = createShortcuts({
  core,
  history,
  selection,
  operations: ObjOps,
  applyDocOp, // 문서 변경은 이 단일 관문으로만 나간다(넛지만 예외 — 원래부터 관문 미경유 계약).
  save,
  markDirty,
  updateAll,
  getSingleSelectedId: () => currentSingleSelectedId(),
  getTeacherDoc: () => frames.teacher?.contentDocument ?? null,
  hostDocument: document,
});
window.addEventListener('keydown', shortcuts.onKeydown);

// 모드 전환 세대 번호(2026-07-29) — 아래 경합 방어의 유일한 근거다.
let modeSeq = 0;

async function setMode(m) {
  // 버튼은 동기로 바꾸고 프레임은 await 뒤에 바꾼다. 그 사이가 비어 있었다: 학생 프레임 재렌더는
  // 저장+서버 조립이라 수 초 걸리는데, 교사가 그동안 '교사용'을 누르면 **늦게 끝난 첫 호출**이
  // 클로저의 낡은 `m` 으로 프레임 가시성과 body.dataset.mode 를 되돌려 **버튼은 교사인데 화면은
  // 학생**이 된다. 자기 세대가 최신일 때만 화면을 만진다(마지막 의도가 이긴다).
  const seq = ++modeSeq;
  mode = m;
  document.getElementById('btn-teacher').classList.toggle('active', m === 'teacher');
  document.getElementById('btn-student').classList.toggle('active', m === 'student');
  const f = await ensureFrame(m);
  if (seq !== modeSeq) return; // 그 사이 다른 전환이 시작됐다 — 이 호출의 화면 갱신은 무효
  // US-E1: 학생용 미리보기는 교사 편집을 반영해야 한다 — 편집이 있었으면(studentStale) 저장 후
  // 서버가 새로 조립한 studentHtml 로 프레임을 교체한다(초기 스냅샷 재사용 금지 = stale 방지).
  if (m === 'student' && studentStale) await refreshStudentFrame();
  if (seq !== modeSeq) return; // 재렌더가 가장 긴 구간이라 여기서 한 번 더 본다
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
  if (isDirty() && !(await save())) return;
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

// ── 레이어 패널(현재 페이지 개체 목록) — manifest 파생 뷰 빌더(조작은 콜백→applyDocOp) ──
const LAYER_TYPE_LABELS = Object.freeze({
  title: '제목', question: '문항', table: '표', 'image-slot': '이미지', 'answer-area': '답란',
  richtext: '자유 텍스트', shape: '도형', divider: '구분선', 'passage-slot': '지문 슬롯', 'std-box': '학습목표',
  callout: '강조상자',
});
function stripHtmlToText(html) {
  return new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '';
}
function layerLabelFor(obj) {
  const base = LAYER_TYPE_LABELS[obj.type] || obj.type;
  let text = '';
  if (obj.type === 'title') text = obj.text || '';
  else if (obj.type === 'question') text = obj.prompt || '';
  else if (obj.type === 'richtext') text = stripHtmlToText(obj.html);
  else if (obj.type === 'answer-area') text = obj.label || '';
  else if (obj.type === 'passage-slot') text = obj.title || obj.slotLabel || '';
  else if (obj.type === 'shape') text = { rect: '사각형', circle: '원', line: '선' }[obj.shapeKind] || '';
  else if (obj.type === 'std-box') text = obj.objectives?.[0] || (obj.codes || []).join(', ');
  else if (obj.type === 'callout') text = obj.title || stripHtmlToText(obj.titleHtml) || stripHtmlToText(obj.body);
  else if (obj.type === 'table') text = `${(obj.rows || []).length}행`;
  text = text.trim().replace(/\s+/g, ' ');
  return text ? `${base} · ${text.slice(0, 24)}` : base;
}
function buildLayerItems() {
  const doc = core.getDocument();
  const page = (doc.pages || []).find((p) => p.id === activePageId) || (doc.pages || [])[0];
  if (!page) return [];
  const items = [];
  // float 배열 뒤 = 앞면(위) → 목록 상단에 오도록 역순으로 방출한 뒤 flow(본문 순서)를 잇는다.
  for (const obj of [...(page.float || [])].reverse()) items.push({ id: obj.id, type: obj.type, label: layerLabelFor(obj), placement: 'float' });
  for (const obj of (page.flow || [])) items.push({ id: obj.id, type: obj.type, label: layerLabelFor(obj), placement: 'flow' });
  return items;
}
function refreshLayers() {
  leftPanel.renderLayers(buildLayerItems(), selection.state.selectedIds);
}

// ── 파생 뷰 갱신의 단일 관문(계획 3단계) ────────────────────────────────────────
// 문서에서 파생되는 화면은 다섯이다: 툴바/인스펙터·레이어 목록(updateAll) · 썸네일 · 검수 칩 ·
// 앱바 제목. 종전엔 갱신 조합이 경로마다 달라 구멍이 났다 — 타이핑 경로는 썸네일·검수를 아예 안
// 불렀고(⑦), 리플로우는 updateAll·레이어를 안 불렀다(C16).
//
// **읽기 전용 계약**: 여기서는 문서를 바꾸지 않는다(history 단계도 쌓지 않는다). 그래야 리플로우·
// 검수가 서로를 다시 부르는 고리가 생기지 않는다.
//
// level:
//   'selection' — 선택/툴바만. 키 입력마다 불러도 싼 것들.
//   'content'   — + 썸네일·검수·제목. 모델이 바뀌었을 때.
//   'render'    — 'content' + 검수 측정(measure). **재렌더 직후에만** 쓴다(측정 규칙은 DOM 이
//                 문서와 맞아떨어지는 순간에만 유효하다 — reviewChip 머리말).
const DERIVED_DEBOUNCE_MS = 400; // 리플로우 디바운스(300ms)보다 뒤 — 리플로우가 갱신했으면 여기선 캐시가 걸러낸다
let derivedTimer = null;

function refreshDerived({ level = 'content', thumbIndex = 0 } = {}) {
  if (level !== 'selection') {
    // 썸네일 → 검수 → 툴바 순서는 종전 applyDocOp 의 순서를 그대로 지킨다.
    renderPageThumbs(thumbIndex);
    runReview({ measure: level === 'render' });
  }
  updateAll();
  if (level !== 'selection') syncDocTitle();
}

/** 타이핑처럼 연달아 오는 변경은 유휴에 한 번만 파생 뷰를 갱신한다(썸네일 직렬화가 비싸다). */
function scheduleDerived() {
  clearTimeout(derivedTimer);
  derivedTimer = setTimeout(() => refreshDerived({ level: 'content' }), DERIVED_DEBOUNCE_MS);
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
    inspector.render({ mode: 'document', paper: core.getDocument().paper, findings: reviewChip.getFindings(), themeName: core.getDocument().themeName || '', themes: availableThemes });
  } else if (sel.mode === 'multi') {
    const allFloat = sel.ids.every((id) => core.findObject(id)?.obj.placement === 'float');
    inspector.render({ mode: 'multi', ids: sel.ids, allFloat });
  } else {
    // paper 를 함께 넘긴다 — flow 크기 UI 가 %를 mm 로 환산해 보조 표시하는 데 쓴다(용지·단 수 의존).
    inspector.render({ mode: 'object', obj: sel.obj, paper: core.getDocument().paper });
  }
  // #10: 표 선택 시 열 너비 손잡이·활성 셀 하이라이트를 선택 상태에 맞춰 갱신(reload 없이).
  tableEditor?.refresh();
  // 크기 손잡이(2026-07-28)는 **선택된 개체에만** 뜨므로 선택이 바뀔 때마다 오버레이를 다시 그려야
  // 한다. 종전 오버레이 내용물(⠿·+ 삽입)은 선택과 무관해서 여기서 부를 이유가 없었고, 그래서
  // refreshDecoration 은 문서 변경·리플로우·뷰 토글에만 걸려 있었다(실마우스 테스트로 드러난 공백 —
  // 합성 이벤트 테스트는 내부 함수를 직접 불러서 이 배선을 건너뛴다).
  canvasInline.refreshDecoration();
  refreshLayers(); // 레이어 목록도 선택/문서 상태에 맞춰 갱신(파생 뷰)
}

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
  selectIds = null,
  ai = false,
  activePageId: requestedActivePageId = null,
} = {}) {
  const current = core.getDocument();
  if (next === current) return false;
  // 대기 중인 타이핑을 먼저 자기 단계로 확정한다(2026-07-28). 이걸 빠뜨리면 아래 history.commit()
  // 이 "직전에 친 글자 + 이 명령"을 한 상태로 찍어, Ctrl+Z 한 번에 둘 다 사라진다.
  history.flushTyping();
  const activeIndexBefore = Math.max(0, (current.pages || []).findIndex((page) => page.id === activePageId));
  if (requestedActivePageId != null) history.refreshUiState();
  core.setDocument(next);
  markDirty();
  if (!ai && selectId) aiPanel.clearFresh(selectId);
  await reloadTeacherFrame(next);
  canvasInline.refreshDecoration();
  aiPanel.refreshFreshBadges(frames.teacher?.contentDocument ?? null);
  fitFrame(frames.teacher);
  // selectIds 는 결과가 여러 개인 조작(AI 계획 적용)이 만든 개체 전부로 선택을 옮긴다.
  // additive 는 토글이라 같은 id 가 두 번 오면 방금 켠 선택이 도로 꺼진다 — 중복을 먼저 제거한다
  // (AI 가 한 개체를 두 번 replace 하는 계획을 세우면 실제로 발생한다).
  const uniqueSelectIds = selectIds ? [...new Set(selectIds)] : null;
  if (uniqueSelectIds && uniqueSelectIds.length) uniqueSelectIds.forEach((id, i) => selection.select(id, { additive: i > 0 }));
  else if (selectId) selection.select(selectId);
  else selection.refreshVisual();
  activePageId = resolveActivePageId(next, requestedActivePageId ?? activePageId, activeIndexBefore);
  history.commit();
  // 선택 복원(위 selection.select/refreshVisual) **뒤**라야 측정 규칙이 .wg-selected 를 볼 수 있다.
  refreshDerived({ level: 'render', thumbIndex: activeIndexBefore });
  if (reflow) scheduleReflow();
  return true;
}

/**
 * 본문 배치 ⇄ 자유 배치 전환의 단일 진입점(툴바·인스펙터·우클릭 메뉴 3곳이 전부 여기를 거친다).
 * 승격일 때만 화면 실측 rect 를 주입해 개체가 **보이던 그 자리에** 고정되게 한다 — 강등은 rect 를
 * 버리므로 실측이 필요 없고, 순수 함수 쪽에서도 무시한다(원칙 3).
 *
 * 승격이 실제로 하는 일은 셋이다(교사에게 보이는 대로 적어 둔다):
 *   1) 그 개체는 제자리에 남는다.
 *   2) 개체가 flow 배열에서 빠지므로 **아래 내용이 그만큼 위로 올라온다** — 전환은 그 개체 하나가
 *      아니라 페이지 전체를 재조판한다.
 *   3) 그리고 승격 직후엔 selectId 로 선택 상태가 되는데, editorStyle.js 의
 *      `.wg-float.wg-selected { pointer-events: auto }` 가 **래퍼 전체**를 불투명하게 만든다.
 *      flow 에서 올라온 개체의 폭은 본문 전폭이라, 그 아래 flow 개체는 클릭·더블클릭·본체 드래그가
 *      잠시 막힌다. **Esc 한 번으로 선택을 풀면**(handleEscape) 규칙이 `.wg-float:not(.wg-selected)`
 *      쪽으로 내려가 내용 영역만 가로채는 상태가 된다. 겹침 자체는 floatLayout 의
 *      float-covers-flow 통보가 알린다.
 */
function toggleFlowFloatFor(id) {
  const found = core.findObject(id);
  const rect = found?.obj?.placement === 'flow' ? selection.measureRectMm(id) : null;
  const next = ObjOps.toggleFlowFloat(core.getDocument(), id, rect);
  applyDocOp(next, { reflow: true, selectId: id });
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

// 시각 조직자 삽입(#2) — 표형 조직자를 미리 채운 flow `table` 개체로 삽입한다(새 개체 타입 아님).
// doInsert 와 동형이나 organizer 서술자 기반이고 flow 전용(그림형은 후속 P2 잠금 richtext).
async function doInsertOrganizer(key, { afterId = null } = {}) {
  const obj = ObjOps.createOrganizerObject(key);
  const anchorId = afterId ?? currentSingleSelectedId();
  const next = ObjOps.insertFlow(core.getDocument(), obj, { afterId: anchorId });
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
  // 형광펜(hiliteColor)은 styleWithCSS 를 켜야 <span style="background-color"> 로 산출된다(끄면
  // 무시되거나 <font> 로 나와 살균·보존 규약과 어긋남). 다른 명령의 산출 마크업에 영향 주지 않도록
  // 이 명령 동안만 켰다 끈다(span 은 hasInlineMarkup 대상 → 보존, background 는 print-color-adjust 로 인쇄).
  if (cmd === 'hiliteColor') {
    doc.execCommand('styleWithCSS', false, true);
    doc.execCommand(cmd, false, value);
    doc.execCommand('styleWithCSS', false, false);
  } else {
    doc.execCommand(cmd, false, value);
  }
  selection.syncEditingField();
  onSelectionDirty('text');
}

/** 허용 스킴만 통과시키는 링크 URL 정규화 — javascript:/data:/vbscript: 은 차단, 스킴 없는 도메인은
 *  https:// 접두. richtext 읽기 경로는 살균을 안 거치므로(readField 직결) 입력 시점에 가드한다. */
function normalizeLinkUrl(raw) {
  const t = String(raw ?? '').trim();
  if (!t || /^\s*(javascript|data|vbscript):/i.test(t)) return null;
  if (/^https?:\/\//i.test(t) || /^(mailto:|#|\/)/i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(t)) return `https://${t}`; // 도메인만 입력 → https 접두
  return null;
}

/** 선택 텍스트에 링크를 건다(#서식). prompt 가 iframe 선택을 흐트러뜨리므로 캐럿을 캡처·복원한 뒤
 *  createLink 를 적용한다. 텍스트 선택이 없으면 execCommand 가 무동작(브라우저 기본). */
function applyLink() {
  const doc = frames.teacher?.contentDocument;
  const editingId = selection.state.editingId;
  const found = editingId ? core.findObject(editingId) : null;
  if (!doc || !found || !FORMATTABLE_TYPES.has(found.obj.type)) return;
  const caret = selection.captureCaret();
  const input = window.prompt('링크 주소를 입력하세요 (http/https)', 'https://');
  selection.restoreCaret(caret);
  if (input == null) return; // 취소
  const url = normalizeLinkUrl(input);
  if (!url) { showBanner('warn', 'http/https 주소만 링크로 넣을 수 있어요.'); return; }
  doc.execCommand('createLink', false, url);
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
    // 편집 크롬을 뺀 HTML 만 굳힌다(2026-07-28). 종전엔 `el.innerHTML` 를 날것으로 보내서, 자유
    // 개체를 프리셋으로 저장하면 ⠿ 손잡이와 리사이즈 사각형 8개가 그대로 담겼고(실측: 저장된 html
    // 이 `<div class="wg-float-handle">⠿</div>` 로 시작) 그 프리셋은 삽입 시 richtext.html 이 되므로
    // **학생 배포본에 인쇄**됐다. 제거 규칙은 selection.js 의 단일 관문이 소유한다.
    const res = await fetch('/presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${found.obj.type}-${Date.now().toString(36)}`, type: 'content',
        html: innerHtmlWithoutChrome(el),
      }),
    });
    // fetch 는 4xx/5xx 에 throw 하지 않는다 — 확인하지 않으면 서버가 거절해도 "저장했습니다"가 뜬다.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showBanner('error', `내 블록 저장 실패: ${body.error ?? `HTTP ${res.status}`}`);
      return;
    }
    if (leftPanel.getActiveTab() === 'myblocks') leftPanel.refreshPresets();
    showBanner('ok', '내 블록에 저장했습니다.');
  } catch (e) {
    showBanner('error', `내 블록 저장 실패: ${e.message}`);
  }
}

async function changePaper(paper) {
  // 저장 실패 시 진행 금지 — 서버는 **저장본**의 용지를 바꾸고 셸을 재조립하므로, 최신 편집이
  // 서버에 없으면 그 편집이 통째로 사라진다(:397 학생 모드 전환과 같은 형태).
  if (isDirty() && !(await save())) return;
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

/** 교과 테마(색상) 변경 — /theme 로 themeName 만 치환 재저장 후 reload(새 테마 CSS 로 셸 재조립).
 *  색상만 바꾸므로 용지 변경과 달리 리플로우 플래그가 필요 없다. dirty 면 먼저 저장해 편집 손실 방지. */
async function changeTheme(themeName) {
  if (isDirty() && !(await save())) return; // 용지 변경과 같은 이유(저장본 기준 재조립)

  let res;
  try {
    res = await fetch('/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ themeName }) });
  } catch (e) {
    showBanner('error', `테마 변경 실패: ${e.message}`);
    return;
  }
  const result = await res.json().catch(() => ({}));
  if (!res.ok) { showBanner('error', `테마 변경 실패: ${result.error ?? res.status}`); return; }
  if (!result.noop) location.reload();
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
  refreshLayers(); // 페이지 이동 시 레이어 목록을 새 페이지 개체로 교체
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
  refreshLayers(); // 스크롤로 활성 페이지가 바뀌면 레이어 목록도 따라 교체
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
  const current = core.getDocument();
  // 값이 그대로면 아무것도 하지 않는다 — 제목을 눌렀다 그냥 빠져나오는 것만으로 빈 undo 단계가
  // 쌓이면 되돌리기가 한 번 헛돈다.
  if ((current.docTitle || '') === text) return;
  // 문서 변경의 단일 관문으로 보낸다(R5). 종전엔 core.setDocument 를 직접 불러 관문이 하는 일을
  // 전부 놓쳤다 — 그중 `flushTyping()` 누락은 **D10 과 같은 결함**이라, 제목을 확정하기 직전
  // 500ms 안에 친 글자가 Ctrl+Z 한 번에 함께 사라졌다.
  applyDocOp({ ...current, docTitle: text });
}

/** 앱바 제목을 모델에 맞춘다(파생 뷰). 편집 중에는 건드리지 않는다 — 교사가 치는 중인 글자를
 *  덮어쓰게 된다. undo/redo·AI 적용 등 제목을 바꾸는 모든 경로가 이 함수 하나로 반영된다. */
function syncDocTitle() {
  if (docTitleEl.getAttribute('contenteditable') === 'true') return;
  docTitleEl.textContent = core.getDocument().docTitle || '(제목 없음)';
}
docTitleEl.addEventListener('blur', commitTitle);
docTitleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); docTitleEl.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); docTitleEl.textContent = core.getDocument().docTitle || '(제목 없음)'; docTitleEl.blur(); }
});

// ══════════════════════════ UI 모듈 조립 ══════════════════════════

// US-19(S4.4): std-box(성취기준, 원칙 3 — 창작 금지) 는 서버가 /shell.json 으로 개체 타입 가드
// 집합을 함께 내려준다 — 클라이언트 층(진입점 비활성화·패널 차단)도 같은 집합을 근거로 삼는다(§7
// 3중 방어). passage-slot 은 3층 정책(2026-07-23 2차 델타)으로 이 가드 집합에서 빠졌다 — 교사가
// 명시적으로 요청하면 AI 로 지문을 창작·재구성할 수 있다(ai.js 의 지문 전용 프리셋 참조).
const excludedAiTypes = new Set(shell.excludedAiTypes || []);
const availableThemes = shell.availableThemes || []; // 인스펙터 테마 드롭다운 옵션(themes/*.css)

// M2(여러 페이지 grab): leftPanel 썸네일에서 Ctrl/Cmd-다중선택된 페이지 id 들. 앱바 AI 진입이 소비한다.
let multiSelectedPageIds = [];

const aiPanel = createAiPanel({
  entryHost: document.getElementById('ai-entry-slot'),
  getSelectionState: () => selection.state,
  findObject: (id) => core.findObject(id),
  excludedTypes: excludedAiTypes,
  getRenderMeta: () => buildRenderMeta(core.getDocument()),
  getDoc: () => frames.teacher?.contentDocument ?? null,
  getActivePageId: () => activePageId,
  getSelectedPageIds: () => multiSelectedPageIds,
  getObjectDocument: () => core.getDocument(), // B1 저작 앵커: 빈 페이지 폴백(문서 마지막 flow 개체) 계산용
  getPage: (pageId) => (core.getDocument().pages || []).find((page) => page.id === pageId) ?? null,
  getPageIdOf: (objectId) => {
    const index = ObjOps.pageIndexOf(core.getDocument(), objectId);
    return index >= 0 ? (core.getDocument().pages?.[index]?.id ?? null) : null;
  },
  onApply: async ({ mode, updates, ops }) => {
    // v4(Phase 4): AI 가 준 계획을 순수 연산 한 번으로 next 문서까지 만든 뒤 applyDocOp 을 **한 번만**
    // 통과시킨다 — 대상별로 반복 호출하면 undo 가 여러 스텝으로 쪼개진다. 위반(없는 대상·std-box·
    // 유령 앵커)은 applyAiOps 가 던지므로 문서를 건드리기 전에 사유를 패널로 돌려준다.
    if (mode === 'ops') {
      let planned;
      try {
        planned = ObjOps.applyAiOps(core.getDocument(), ops, { excludedTypes: excludedAiTypes });
      } catch (e) {
        return { error: e?.message || String(e) };
      }
      await applyDocOp(planned.document, {
        reflow: true, selectIds: planned.resultIds, selectId: planned.resultIds[0] ?? null, ai: true,
      });
      return { ids: planned.resultIds };
    }
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
    await applyDocOp(next, { reflow: true, selectIds: ids, selectId: ids[0] ?? null, ai: true });
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
  onFlowFloat: (id) => toggleFlowFloatFor(id),
  onFormat: (cmd, value) => applyFormat(cmd, value),
  onLink: () => applyLink(),
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
  // z-순서(맨앞/앞으로/뒤로/맨뒤) — float[] 배열 위치만 바꾼다(flow 경계 불변 → 리플로우 불필요).
  // reorderFloat 는 무동작(끝단·flow·단일)이면 원본 참조를 반환하므로 applyDocOp 이 조기 반환한다
  // (dirty·커밋 없음). Phase 5 분리 때 이 배선이 유실돼 맨앞/맨뒤 버튼이 no-op 였던 것을 복구한다.
  onZOrder: (id, mode) => {
    const next = ObjOps.reorderFloat(core.getDocument(), id, mode);
    applyDocOp(next, { selectId: id });
  },
  onTogglePanel: (side) => togglePanel(side),
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
  onToggleFlowFloat: (id) => toggleFlowFloatFor(id),
  onToggleAnswer: (id) => { const next = ObjOps.toggleAnswer(core.getDocument(), id); applyDocOp(next, { selectId: id }); },
  onAlign: (ids, mode2) => { const next = ObjOps.alignFloats(core.getDocument(), ids, mode2); applyDocOp(next); },
  // 크기·정렬(2026-07-28) — 손잡이 드래그(canvasInline)와 **같은 순수 관문**을 쓴다. 두 입력이
  // 갈라지지 않도록 클램프는 resizeFlow 안에만 있다.
  onResize: (id, patch) => {
    const next = ObjOps.resizeFlow(core.getDocument(), id, patch);
    if (next === core.getDocument()) return;
    applyDocOp(next, { reflow: true, selectId: id });
  },
  onImageUpload: (id, file) => uploadImage(id, file),
  onThemeChange: (name) => changeTheme(name),
});

const leftPanel = createLeftPanel({
  root: document.getElementById('left-panel'),
  onThumbSelect: (pageId) => scrollToPage(pageId),
  onPagesSelect: (pageIds) => { multiSelectedPageIds = pageIds; },
  onPageAction: (action, pageId) => handlePageAction(action, pageId),
  onPageRoleChange: (pageId, role) => handlePageAction('set-role', pageId, { role }),
  onPageReorder: (pageIds, movedPageId) => handlePageAction('reorder', movedPageId, { pageIds }),
  onInsertItem: (item, opts) => doInsert(item, opts),
  onInsertOrganizer: (key) => doInsertOrganizer(key),
  fetchPresets: () => fetch('/presets').then((r) => r.json()),
  onPresetInsert: (preset) => {
    const obj = ObjOps.createObject('richtext', { placement: 'flow' });
    obj.html = preset.html;
    const next = ObjOps.insertFlow(core.getDocument(), obj, { afterId: currentSingleSelectedId() });
    applyDocOp(next, { reflow: true, selectId: obj.id });
  },
  onPresetDelete: (id) => fetch(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => r.json()),
  // 레이어 패널: 목록 클릭 = 개체 선택(캔버스 동기화), float ▲▼ = z-순서 한 단계(reorderFloat).
  onLayerSelect: (id) => selection.select(id),
  onLayerReorder: (id, mode) => { const next = ObjOps.reorderFloat(core.getDocument(), id, mode); applyDocOp(next, { selectId: id }); },
});
document.getElementById('canvas-wrap').addEventListener('scroll', syncActivePageFromCanvas, { passive: true });

const canvasInline = createCanvasInline({
  popupsHost: document.getElementById('popups-host'),
  getSelectionState: () => selection.state,
  findObject: (id) => core.findObject(id),
  excludedAiTypes,
  onAiOpen: (id) => aiPanel.openFor([id]),
  // B1: 우클릭/슬래시 "새 섹션 AI 저작" — 이 개체 뒤에 새 섹션을 저작한다(프래그먼트 진입).
  onAuthorSection: (id) => aiPanel.openFor(id ? [id] : [], { intent: 'author-section' }),
  onFormat: (cmd, value) => applyFormat(cmd, value),
  onAnswerToggle: (id) => { const next = ObjOps.toggleAnswer(core.getDocument(), id); applyDocOp(next, { selectId: id }); },
  onInsertAfter: (item, afterId) => doInsert(item, { float: !!item.floatOnly, afterId }),
  onDuplicate: (id) => { const { document: next, newId } = ObjOps.duplicateObject(core.getDocument(), id); if (newId) applyDocOp(next, { reflow: true, selectId: newId }); },
  onDelete: (id) => { const next = ObjOps.removeObject(core.getDocument(), id); selection.clearAll(); applyDocOp(next, { reflow: true }); },
  onFlowFloat: (id) => toggleFlowFloatFor(id),
  onSaveAsPreset: (id) => saveObjectAsPreset(id),
  onFlowReorder: (idsByPage, draggedId) => {
    const next = ObjOps.applyFlowOrder(core.getDocument(), idsByPage);
    applyDocOp(next, { reflow: true, selectId: draggedId ?? null });
  },
  onDragEnd: () => selection.armSwallowClick(),
  // 크기 손잡이 드롭(2026-07-28) — 클램프·반올림은 resizeFlow(순수)가 소유한다. reflow:true 인
  // 이유: 폭·최소높이가 바뀌면 개체 높이가 바뀌고 그러면 페이지 경계가 바뀐다(D-A).
  onResize: (id, patch) => {
    const next = ObjOps.resizeFlow(core.getDocument(), id, patch);
    if (next === core.getDocument()) return; // 변경 없음 — 히스토리에 빈 단계를 쌓지 않는다
    applyDocOp(next, { reflow: true, selectId: id });
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

// ── 단축키 안내 시트(발견성) — shortcuts.js 의 SHORTCUTS 단일 목록을 모달로 노출한다 ──
const helpButton = document.getElementById('btn-help');
if (helpButton) {
  let helpModal = null;
  const closeHelp = () => helpModal?.classList.add('hidden');
  const openHelp = () => {
    if (!helpModal) {
      helpModal = document.createElement('div');
      helpModal.className = 'shortcuts-modal hidden';
      const inner = document.createElement('div');
      inner.className = 'shortcuts-inner';
      const heading = document.createElement('h3');
      heading.textContent = '키보드 단축키';
      inner.appendChild(heading);
      const list = document.createElement('dl');
      list.className = 'shortcuts-list';
      for (const { keys, desc } of SHORTCUTS) {
        const dt = document.createElement('dt');
        // keys 는 코드 소유 상수(사용자 입력 아님) — 각 키를 <kbd>로 감싼다.
        dt.replaceChildren(...keys.split(' / ').flatMap((key, i) => {
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          return i === 0 ? [kbd] : [document.createTextNode(' / '), kbd];
        }));
        const dd = document.createElement('dd');
        dd.textContent = desc;
        list.appendChild(dt);
        list.appendChild(dd);
      }
      inner.appendChild(list);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'shortcuts-close';
      closeBtn.textContent = '닫기';
      closeBtn.addEventListener('click', closeHelp);
      inner.appendChild(closeBtn);
      helpModal.appendChild(inner);
      helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(); });
      document.getElementById('popups-host').appendChild(helpModal);
    }
    helpModal.classList.remove('hidden');
  };
  helpButton.addEventListener('click', openHelp);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal && !helpModal.classList.contains('hidden')) closeHelp();
  });
}

// ── 초기 모드: teacher 는 항상 먼저 만들어 둔다(썸네일·검수는 teacher 문서가 진실). ──
await ensureFrame('teacher');
await setMode(location.hash === '#student' ? 'student' : 'teacher');
// #4: 프레임이 보이게 된 뒤(레이아웃 확정) 썸네일을 다시 그린다 — 최초 렌더는 hidden 이라 0 치수였다.
requestAnimationFrame(() => renderPageThumbs());
applyPanelState(); // 저장된 좌/우 패널 접힘 상태를 복원(localStorage, 문서 아님)
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
        getCurrentRevision: saveController.getRevision,
        getStudentStale: () => studentStale,
        cancelScheduledReflow: () => clearTimeout(reflowTimer),
        getClipboardCount: shortcuts.getClipboardCount,
      });
    } catch (e) {
      // 시드 실패를 무음으로 삼키지 않는다 — dump-dom 스냅샷에 원인이 남아야 실패한 렌더 테스트를
      // 진단할 수 있다(seedDone 이 비어 있는 것만으로는 "어디서 왜" 를 알 수 없다).
      document.body.dataset.seedError = String(e && e.message || e);
      console.error('시드 실패:', e);
    }
  }
}
