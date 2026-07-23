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

const selection = createSelectionController({ core, onDirty: onSelectionDirty, onSelectionChange });

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
      await reloadTeacherFrame(nextDoc);
      selection.refreshVisual();
      canvasInline.refreshDecoration();
      aiPanel.refreshFreshBadges(frames.teacher?.contentDocument ?? null);
      fitFrame(frames.teacher);
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

/** 새 pages[] 를 반영한 전체 HTML 로 teacher iframe 을 다시 로드하고 조작 리스너를 재배선한다. */
function reloadTeacherFrame(nextDoc) {
  const f = frames.teacher;
  if (!f) return Promise.resolve();
  const html = buildFullHtml(nextDoc, { renderMeta: buildRenderMeta(nextDoc), styleTag: teacherStyleTag });
  return new Promise((resolveFrame) => {
    f.addEventListener('load', () => {
      initTeacherEditing(f, { resetHistory: false });
      resolveFrame();
    }, { once: true });
    f.srcdoc = html;
  });
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── 캔버스: teacher(편집)/student(파생 미리보기) iframe 지연 생성 ──
const frames = { teacher: null, student: null };
let mode = 'teacher';
const viewState = { margins: true, ruler: true, grid: false };

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
  }
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
    .wg-float.wg-selected, .wg-float.wg-editing { pointer-events: auto; cursor: grab; }
    .wg-float-handle {
      position: absolute; top: -9px; left: -9px; width: 18px; height: 18px; z-index: 5;
      display: flex; align-items: center; justify-content: center;
      background: #111827; color: #fff; border-radius: 4px; font-size: 11px;
      pointer-events: auto; cursor: grab; user-select: none;
    }
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
    body.wg-show-margins .sheet::after {
      content: ""; position: absolute; inset: var(--sheet-pad, 12mm 15mm 10mm 15mm);
      border: 1px dashed rgba(37,99,235,.55); pointer-events: none; z-index: 3;
    }
    body.wg-show-ruler .sheet::before {
      content: ""; position: absolute; left: -14px; top: -14px; right: -14px; bottom: -14px;
      border: 1px solid rgba(0,0,0,.15); pointer-events: none; z-index: 2;
      background-image:
        repeating-linear-gradient(90deg, rgba(0,0,0,.3) 0 1px, transparent 1px 10mm),
        repeating-linear-gradient(0deg, rgba(0,0,0,.3) 0 1px, transparent 1px 10mm);
    }
    body.wg-show-grid .sheet {
      background-image:
        repeating-linear-gradient(0deg, rgba(37,99,235,.08) 0 1px, transparent 1px 5mm),
        repeating-linear-gradient(90deg, rgba(37,99,235,.08) 0 1px, transparent 1px 5mm);
    }
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

function onKeydown(e) {
  if (e.key === 'Escape') return; // selection.js 가 자체 처리
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
  }
}
window.addEventListener('keydown', onKeydown);

async function setMode(m) {
  mode = m;
  document.getElementById('btn-teacher').classList.toggle('active', m === 'teacher');
  document.getElementById('btn-student').classList.toggle('active', m === 'student');
  const f = await ensureFrame(m);
  for (const [name, frame] of Object.entries(frames)) {
    if (frame) frame.classList.toggle('hidden', name !== m);
  }
  fitFrame(f);
  document.body.dataset.mode = m;
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
  });

  if (sel.mode === 'none') {
    inspector.render({ mode: 'document', paper: core.getDocument().paper, findings: reviewFindings });
  } else if (sel.mode === 'multi') {
    const allFloat = sel.ids.every((id) => core.findObject(id)?.obj.placement === 'float');
    inspector.render({ mode: 'multi', ids: sel.ids, allFloat });
  } else {
    inspector.render({ mode: 'object', obj: sel.obj });
  }
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

function applyFormat(cmd, value = null) {
  const doc = frames.teacher?.contentDocument;
  const editingId = selection.state.editingId;
  const found = editingId ? core.findObject(editingId) : null;
  if (!doc || !found || found.obj.type !== 'richtext') return;
  doc.execCommand(cmd, false, value);
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
  if (!result.noop) location.reload();
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

document.getElementById('btn-preview').addEventListener('click', () => {
  const modal = document.getElementById('preview-modal');
  const img = document.getElementById('preview-img');
  img.src = `/preview.png?mode=${mode}&_=${Date.now()}`;
  modal.classList.remove('hidden');
});
document.getElementById('preview-close').addEventListener('click', () => {
  document.getElementById('preview-modal').classList.add('hidden');
});

document.getElementById('btn-export').addEventListener('click', async () => {
  let res;
  try {
    res = await fetch('/export', { method: 'POST' });
  } catch (e) {
    showBanner('error', `내보내기 실패: ${e.message}`);
    return;
  }
  const result = await res.json().catch(() => ({}));
  if (!res.ok) { showBanner('error', `내보내기 실패: ${result.error ?? result.message ?? res.status}`); return; }
  const skippedMsg = result.skipped?.student ? ` (학생용 생략: ${result.reason || result.skipped.student})` : '';
  showBanner(result.unsafe ? 'warn' : 'ok', `PDF 내보내기 완료(${(result.rendered || []).length}벌)${skippedMsg}`);
});

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
  onAnswerToggle: (id) => { const next = ObjOps.toggleAnswer(core.getDocument(), id); applyDocOp(next, { selectId: id }); },
  onTableRow: (action) => handleTableRow(action),
  onImageReplace: (id) => triggerImageUpload(id),
  onShapeColor: (kind, hex) => {
    const id = currentSingleSelectedId();
    if (!id) return;
    const next = ObjOps.patchObject(core.getDocument(), id, kind === 'stroke' ? { strokeColor: hex } : { fillColor: hex });
    applyDocOp(next, { selectId: id });
  },
  onZoom: (pct) => { stage.style.transform = `scale(${pct / 100})`; },
  onViewToggle: (key, val) => { viewState[key] = val; applyViewState(); },
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
  onReorderStep: (id, direction) => { core.setDocument(ObjOps.moveFlow(core.getDocument(), id, direction)); markDirty(); },
  onReorderCommit: () => { history.commit(); leftPanel.renderThumbs(frames.teacher?.contentDocument ?? null); updateAll(); scheduleReflow(); },
});

// ── 초기 모드: teacher 는 항상 먼저 만들어 둔다(썸네일·검수는 teacher 문서가 진실). ──
await ensureFrame('teacher');
await setMode(location.hash === '#student' ? 'student' : 'teacher');
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
  }
  document.body.dataset.seedDone = seed;
}
