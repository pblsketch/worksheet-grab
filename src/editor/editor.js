// 에디터(E3) 클라이언트 — 바닐라 ESM, 빌드 0.
// 원칙: manifest 단일 소스 — 편집은 teacher 캔버스(블록 경계 래퍼)에서 하고, 저장 시
// DOM 순회 → resync → POST /save(SaveDocument 단일 경유)로 manifest 에 반영된다.
// 검수는 엔진과 같은 원본 ValidateWorksheet 를 브라우저에서 실행(§3.4 두 런타임).
// student 는 편집 불가 파생 미리보기 — BuildVariants 의 물리 제거 원시인
// stripElementsByClass 를 즉석 실행해 저장 없이 ⭐ 마크의 2벌 효과를 보여준다.
import { ValidateWorksheet } from '/src/usecases/ValidateWorksheet.js';
import { ANSWER_CLASSES } from '/src/usecases/BuildVariants.js';
import { stripElementsByClass } from '/src/usecases/html-scan.js';
import { resyncManifest } from '/editor/resync.js';
import { createToolbar, applyFontSizeDirect, imageMarkup, IMAGE_PLACEHOLDER } from '/editor/toolbar.js';
import { toggleAnswerMark, insertAnswerLines } from '/editor/marks.js';
import { extractPresetFromSelection, insertPreset, previewSrcdoc, cursorBlock } from '/editor/presets.js';
import { requestAiAction, pollResponse, applyAiResponse, undoAiApply, clearAiMarker, selectedBlocks, aiDiffView } from '/editor/ai.js';
import { createHistory } from '/editor/history.js';
import { createThumbs } from '/editor/thumbs.js';
import { SHAPE_KINDS, DASH_STYLES, shapeLabel, shapeMarkup, insertShape, shapeStyle, setShapeStyle, markShapeIslands } from '/editor/shapes.js';
import { TEXT_DEFAULTS, insertTextbox, markTextIslands, setTextboxEditing, textboxStyle, setTextboxStyle, isTextbox } from '/editor/textbox.js';
import { classifyTarget, parentTarget, targetLabel, isMovableKind, objectBox, setObjectBox, boxStyle, setBoxStyle, setTableStyle, tableOps, isHeaderRow, hasHeaderRow, hasHeaderCol, svgStyle, setSvgStyle } from '/editor/objects.js';
import { drawRulers, drawGrid, centerSnap, drawAlignGuides } from '/editor/rulers.js';
import { PAPER_PRESETS, matchPreset } from '/src/usecases/paper.js';

const MM_TO_PX = 96 / 25.4; // CSS 사양 고정(zoom/DPR 무관)

const shell = await (await fetch('/shell.json')).json();
const stage = document.getElementById('stage');
const overlay = document.getElementById('guide-overlay');
const statusEl = document.getElementById('review-status');
const listEl = document.getElementById('review-list');
const saveBanner = document.getElementById('save-banner');

let baseManifest = shell.manifest; // 저장 기준선(pages 외 필드 보존)
let currentRevision = shell.meta?.revision ?? null;

// 상단 크롬 실측 높이 → CSS 변수(--chrome-h): 고정 오프셋 패널(프리셋·AI diff·고급
// 용지)이 랩 줄수와 무관하게 항상 크롬 아래에 열린다.
const chromeEl = document.getElementById('chrome');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--chrome-h', `${chromeEl.offsetHeight}px`);
}).observe(chromeEl);

// 미저장 편집 보호: 새로고침·창 닫기 전 브라우저 네이티브 확인창(§E6 dirty-gate 연장).
window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

document.getElementById('doc-title').textContent = shell.docTitle || '(제목 없음)';
document.getElementById('doc-paper').textContent =
  `${shell.canvasMeta.paper.size} ${shell.canvasMeta.paper.orientation === 'landscape' ? '가로' : '세로'}`;
renderRev();
stage.style.maxWidth = `${shell.canvasMeta.dims.width + 40}px`;

function renderRev() {
  document.getElementById('doc-rev').textContent = currentRevision == null ? '' : `rev ${currentRevision}`;
}

// ── 캔버스: 변형별 iframe 지연 생성. teacher = 편집(contenteditable), student = 파생 미리보기 ──
const frames = { teacher: null, student: null };
let mode = 'teacher';
let studentStale = false; // 편집 발생 시 student 파생 캐시 무효화
let selectedImg = null; // F1: 리사이즈 핸들 대상(부모 오버레이 표시). 이미지 클릭 시 지정.
let selectedObject = null; // {kind, el, table?} — 캔버스에서 고른 개체(표·셀·SVG·상자·이미지·도형)
let showGuides = true; // 여백선
let showRulers = false; // 눈금자(mm)
let showGrid = false; // 격자(5mm)
let activeAlignGuides = []; // 드래그 중 중앙 정렬이 맞았을 때만 채워진다

function ensureFrame(m, srcdocOverride = null) {
  if (frames[m] && !srcdocOverride) return Promise.resolve(frames[m]);
  return new Promise((resolveFrame) => {
    let f = frames[m];
    if (!f) {
      f = document.createElement('iframe');
      f.dataset.mode = m;
      f.className = 'hidden';
      stage.insertBefore(f, overlay);
      frames[m] = f;
    }
    f.addEventListener('load', () => {
      if (m === 'teacher') initTeacherEditing(f);
      fitFrame(f);
      resolveFrame(f);
    }, { once: true });
    f.srcdoc = srcdocOverride ?? shell[`${m}Html`];
  });
}

function fitFrame(f) {
  const doc = f.contentDocument;
  if (doc && doc.documentElement) f.style.height = `${doc.documentElement.scrollHeight}px`;
}

// ── teacher 편집 활성화 ──
function initTeacherEditing(f) {
  const doc = f.contentDocument;
  // 래퍼 투명화는 iframe 문서 안에서만 유효(부모 CSS 는 iframe 에 닿지 않음).
  // 이 스타일은 head 주입이라 역동기화(블록 innerHTML)에 절대 섞이지 않는다.
  const style = doc.createElement('style');
  style.id = 'wg-editor-style'; // student 파생 시 이 블록을 식별·치환한다
  style.textContent = `
    .wg-block { display: contents; }
    /* 다단 예고: .wg-block 은 display:contents(boxless)라 자신엔 break-inside 무효 —
       실박스 자식에 걸어 열 경계 잘림을 화면에서도 근사한다(정밀 판정은 미리보기). */
    .sheet-body > .wg-block > * { break-inside: avoid; }
    @media screen {
      .answer { outline: 2px dashed rgba(37,99,235,.6); outline-offset: 1px; background: rgba(147,197,253,.18); }
      [data-wg-mark="session"] { background: rgba(52,211,153,.22); }
      /* 도형은 끌어서 옮기는 개체다 — 텍스트 선택이 먼저 잡히면 드래그가 어긋난다. */
      .wg-shape-layer { user-select: none; -webkit-user-select: none; }
      .wg-shape { cursor: move; }
      /* 텍스트 상자: 화면에서만 점선 테두리(인쇄·학생용엔 없음). 개체 모드는 끌어서 이동,
         편집 모드(캐럿 진입)는 파란 실선 + 텍스트 커서. 빈 상자는 자리표시 글자를 보인다. */
      .wg-text { outline: 1px dashed rgba(100,116,139,.6); outline-offset: 1px; cursor: move; }
      .wg-text:not([contenteditable="true"]) { user-select: none; -webkit-user-select: none; }
      .wg-text[contenteditable="true"] { outline: 2px solid rgba(37,99,235,.75); cursor: text; }
      .wg-text:empty::before { content: '텍스트를 입력하세요'; color: #9aa3af; }
    }`;
  doc.head.appendChild(style);
  doc.body.contentEditable = 'true';
  doc.addEventListener('input', onUserInput);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('selectionchange', onSelectionChange);
  // 브라우저 기본 되돌리기(문맥 메뉴·일부 단축키)를 가로채 우리 스택으로 돌린다.
  // 두 스택이 동시에 살아 있으면 되돌리는 순서가 어긋나므로 반드시 하나여야 한다.
  doc.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); history.undo(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); history.redo(); }
  });
  markShapeIslands(doc); // 도형을 비편집 섬으로 — 네이티브 DnD·캐럿 진입 차단
  markTextIslands(doc); // 텍스트 상자도 섬으로(안쪽은 편집 모드에서만 캐럿 진입)
  history.reset(); // 이 문서 상태를 되돌리기 기준점으로
  // F1 이미지: 붙여넣기(클립보드)·드롭(DnD) → 업로드 후 커서 삽입. 클릭 → 이미지 선택(리사이즈).
  doc.addEventListener('paste', onPaste);
  doc.addEventListener('dragover', (e) => e.preventDefault()); // drop 허용
  doc.addEventListener('drop', onDrop);
  doc.addEventListener('click', onCanvasClick);
  doc.addEventListener('dblclick', onCanvasDblclick);
  // 도형 이동은 본체를 직접 끈다(핸들은 크기 전용) — 캔버스 안에서 잡는 편이 자연스럽다.
  doc.addEventListener('pointerdown', (e) => {
    // 텍스트 상자 배치 모드가 켜져 있으면 이 클릭/드래그로 새 상자를 그린다(선택보다 우선).
    if (placingText) { startTextboxPlacement(e); return; }
    const shape = e.target?.closest?.('.wg-shape');
    if (shape) { startShapeDrag(e, shape); return; }
    // 개체 모드(비편집)인 텍스트 상자는 본체를 끌어 옮긴다. 편집 모드면 캐럿을 놓아야 하니
    // 드래그를 걸지 않는다 — 그때 이동은 ✥ 핸들이 담당한다.
    const text = e.target?.closest?.('.wg-text');
    if (text && text.getAttribute('contenteditable') !== 'true') startTextboxDrag(e, text);
  });
}

// 텍스트 상자 더블클릭 → 편집 모드 진입(캐럿). 다른 상자가 편집 중이었으면 먼저 닫는다.
function onCanvasDblclick(e) {
  const text = e.target?.closest?.('.wg-text');
  if (!text) return;
  e.preventDefault();
  enterTextEditing(text);
}

// ── 통합 실행취소(§3.1) ──
// 정답 표시·답란 삽입·프리셋 삽입·AI 적용 등은 DOM 직접 조작이라 브라우저 기본
// undo 스택 밖이었다. 되돌리기를 이 스택이 단독으로 소유한다(history.js 머리말 참조).
const history = createHistory({
  getDoc: () => frames.teacher?.contentDocument ?? null,
  onRestore: () => { onEdit(); reflectSelectionFormat(); },
});

/** 사용자의 직접 타이핑 — 되돌리기 단계로 묶고(유휴 코얼레싱) 편집 파이프라인을 돌린다. */
function onUserInput() {
  history.noteInput();
  onEdit();
}

let editTimer = null;
let dirty = false; // E6 dirty-gate: 마지막 저장 이후 편집 여부 — save-first 의 skip 기준
function onEdit() {
  studentStale = true;
  dirty = true;
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    fitFrame(frames.teacher);
    drawGuides();
    recompute(mode);
    refreshThumbs(); // 바뀐 쪽만 다시 그린다(thumbs 내부 diff)
  }, 250);
}

function onKeydown(e) {
  // Esc: 한 겹 바깥 개체로 올라간다. 선택은 "가장 안쪽 우선"이라 라벨 같은 자식이 먼저
  // 잡히는데, 이 사다리가 없으면 그걸 감싼 상자·표에 닿을 방법이 없다.
  if (e.key === 'Escape') {
    e.preventDefault();
    // Esc 우선순위: 배치 취소 → 편집 종료 → 한 겹 바깥 개체. 편집 중 Esc 가 곧장
    // 부모로 올라가 버리면 방금 친 글을 확정할 방법이 애매해진다.
    if (placingText) { setPlacingText(false); return; }
    if (editingText) { exitTextEditing(); return; }
    const win = frames.teacher?.contentWindow;
    selectObject(selectedObject && win ? parentTarget(selectedObject, win) : null);
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    save();
  } else if (key === 'z' && !e.shiftKey) {
    e.preventDefault(); // 기본 undo 를 막고 우리 스택으로 — 두 스택 병존 금지
    history.undo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    history.redo();
  }
}

// ── 직렬화(단일 진실 경로: teacher DOM innerHTML) ──
function serializeSheets() {
  const doc = frames.teacher?.contentDocument;
  if (!doc) return null;
  const CHROME = new Set(['run-head', 'run-foot', 'mode-badge']);
  // 래퍼 밖 leftover 재귀 수집: .sheet-body(다단 래퍼)는 투명 통과 — 그 자식에 동일
  // 규칙을 적용한다(내부 .wg-block 은 상위 querySelectorAll 이 이미 재귀 수집하므로 skip).
  // columns<=1(.sheet-body 부재)에선 sheet 직속만 순회 = 현행과 동일.
  const collectLeftover = (nodes) => {
    let html = '';
    for (const node of nodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains('wg-block')) continue;
        if ([...node.classList].some((c) => CHROME.has(c))) continue;
        if (node.classList.contains('sheet-body')) { html += collectLeftover(node.childNodes); continue; }
        html += node.outerHTML;
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        html += node.textContent;
      }
    }
    return html;
  };
  return [...doc.querySelectorAll('.sheet')].map((sheet) => {
    const blocks = [...sheet.querySelectorAll('.wg-block')].map((w) => {
      const clone = w.cloneNode(true);
      // 편집 세션 마커는 저장 산출물에 절대 남지 않는다(세션 정답 태깅·AI 대기 마커).
      for (const el of clone.querySelectorAll('[data-wg-mark]')) el.removeAttribute('data-wg-mark');
      for (const el of clone.querySelectorAll('[data-ai-req]')) el.removeAttribute('data-ai-req');
      // 도형·텍스트 상자의 비편집 섬 표식은 편집 세션 전용 — 저장본에 남기지 않는다.
      for (const el of clone.querySelectorAll('.wg-shape-layer, .wg-text-layer, .wg-text')) { el.removeAttribute('contenteditable'); el.removeAttribute('draggable'); }
      clone.removeAttribute('data-ai-req');
      return { type: w.dataset.bt || 'content', html: clone.innerHTML };
    });
    const leftoverHtml = collectLeftover(sheet.childNodes);
    return { blocks, leftoverHtml };
  });
}

/** 현재 teacher 문서 전체 HTML(검수·student 파생 입력). 프레임 전엔 shell 문자열 폴백. */
function currentTeacherHtml() {
  const doc = frames.teacher?.contentDocument;
  if (!doc) return shell.teacherHtml;
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

/**
 * student 파생: BuildVariants 의 student 경로와 동일한 물리 제거 원시를 즉석 실행.
 * teacher 직렬화에 실린 편집 아티팩트(contenteditable·편집 하이라이트 스타일)는
 * 미리보기에서 제거한다 — 학생용은 항상 편집 불가·마크 하이라이트 없음.
 */
function deriveStudentHtml() {
  return stripElementsByClass(currentTeacherHtml(), ANSWER_CLASSES)
    .replaceAll('data-mode="teacher"', 'data-mode="student"')
    .replace(/ contenteditable="true"/g, '')
    .replace(/<style id="wg-editor-style">[\s\S]*?<\/style>/, '<style>.wg-block{display:contents}</style>');
}

// ── F1 이미지: 업로드(POST /assets) → 커서 삽입 · 리사이즈 핸들 ──
const DEFAULT_IMG_WIDTH_MM = 60;

async function uploadImage(file) {
  try {
    const res = await fetch(`/assets?name=${encodeURIComponent(file.name || 'image')}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { showBanner('warn', `이미지 업로드 실패: ${body.error ?? `HTTP ${res.status}`}`); return null; }
    return body.path; // "assets/<name>"
  } catch (e) {
    showBanner('error', `이미지 업로드 실패: ${e.message}`);
    return null;
  }
}

// 파일명 stem 을 alt 기본값으로(접근성·인쇄 캡션). 확장자·경로 성분 제거, 없으면 '이미지'.
function altFromName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim() || '이미지';
}

async function insertImageFile(file) {
  const doc = frames.teacher?.contentDocument;
  if (!doc) return;
  const path = await uploadImage(file);
  // 성공 → 실제 자산 img(alt=파일명 stem), 실패/취소 → 폴백 자리표시(§F1-3). 어느 쪽이든 편집으로 간주.
  // 업로드는 비동기라 bind 밖 경로 — 되돌리기 단계 확정을 여기서 직접 건다.
  history.run(() => tb.insertImage(
    path ? imageMarkup(path, DEFAULT_IMG_WIDTH_MM, altFromName(file.name)) : IMAGE_PLACEHOLDER));
  if (path) showBanner('ok', `이미지 삽입: ${path}`);
  onEdit();
}

// tb-image: 파일 픽커 → 업로드 삽입. 커서(iframe 선택)는 mousedown preventDefault 로 보존됨.
function pickImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (file) insertImageFile(file);
  });
  input.click();
}

function onPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (file) { e.preventDefault(); insertImageFile(file); return; }
    }
  }
}

function onDrop(e) {
  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;
  const file = [...files].find((f) => f.type.startsWith('image/'));
  if (file) { e.preventDefault(); insertImageFile(file); }
}

// 캔버스 클릭 → 개체 선택.
// 예전엔 이미지와 도형만 잡혔고, 그래서 AI 초안에 들어 있는 표·그래프·테두리 상자는
// 클릭해도 아무 일이 없었다(= 텍스트만 고칠 수 있었던 원인). 이제 objects.js 가
// 계산된 스타일로 "고를 수 있는 것"을 판별하고, 우측 인스펙터가 그 속성을 편집한다.
function onCanvasClick(e) {
  // 방금 배치 드래그를 끝냈다면 뒤따르는 click 한 번은 무시한다(편집 상태 보존).
  if (swallowNextCanvasClick) { swallowNextCanvasClick = false; return; }
  const win = frames.teacher?.contentWindow;
  // 편집 중인 상자 밖(다른 상자·빈 곳)을 클릭하면 편집을 닫는다 — 같은 상자 안 클릭은
  // 캐럿 위치 이동이라 유지한다. 빈 상자였다면 exitTextEditing 이 자동 삭제까지 한다.
  const targetText = e.target?.closest?.('.wg-text');
  if (editingText && targetText !== editingText) exitTextEditing();
  const picked = win ? classifyTarget(e.target, win) : null;
  selectObject(picked);
}

/** 선택 상태의 단일 출처. selectedImg/selectedShape 는 여기서 파생된다(핸들 그리기용). */
function selectObject(picked) {
  selectedObject = picked;
  selectedShape = picked?.kind === 'shape' ? picked.el : null;
  selectedImg = picked?.kind === 'image' ? picked.el : null;
  // 이미지는 선택 범위로도 잡아 ⭐정답 마킹이 span.answer 로 감쌀 수 있게 한다(요소 선택 마킹).
  if (selectedImg) {
    const doc = frames.teacher?.contentDocument;
    if (doc) {
      const range = doc.createRange();
      range.selectNode(selectedImg);
      const sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  drawGuides();
  renderInspector();
  document.body.dataset.objectKind = picked?.kind ?? 'none';
}

function selectImageEl(img) { selectObject({ kind: 'image', el: img }); }
function clearImageSelection() { if (selectedImg) selectObject(null); }

// 리사이즈: 부모 오버레이 핸들 드래그 → img.style.width 를 mm 로 갱신(iframe .sheet 내부
// 크롬 무주입 원칙 — 핸들은 오버레이, 갱신 대상은 img 자체 style=정당한 콘텐츠 편집).

// 렌더 시드 전용: 1×1 PNG 바이트(업로드 왕복 계측용). 프로덕션 경로엔 영향 없음.
function seedPngBytes() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── 여백선 + 넘침 배지: 부모 오버레이 레이어(iframe 무오염, §3.4 실시간 예고) ──
function drawGuides() {
  overlay.replaceChildren();
  const f = frames[mode];
  if (!f || !f.contentDocument) return;
  const m = shell.canvasMeta.margins;
  const pageH = paperHeightMm() * MM_TO_PX;
  let overflowCount = 0;
  const frameTop = f.offsetTop;
  const frameLeft = f.offsetLeft;
  const sheetEls = [...f.contentDocument.querySelectorAll('.sheet')];

  // 자·격자는 여백선보다 아래(z) 에 깔고, 각각 독립 토글이다.
  if (showGrid) drawGrid({ overlay, sheets: sheetEls, frameLeft, frameTop, spacingMm: 5 });
  if (showRulers) drawRulers({ overlay, sheets: sheetEls, frameLeft, frameTop });

  for (const sheet of sheetEls) {
    const r = sheet.getBoundingClientRect();
    if (showGuides) {
      const g = document.createElement('div');
      g.className = 'margin-guide';
      g.style.left = `${frameLeft + r.left + m.left * MM_TO_PX}px`;
      g.style.top = `${frameTop + r.top + m.top * MM_TO_PX}px`;
      g.style.width = `${r.width - (m.left + m.right) * MM_TO_PX}px`;
      g.style.height = `${r.height - (m.top + m.bottom) * MM_TO_PX}px`;
      overlay.appendChild(g);
    }

    const overflowPx = r.height - pageH;
    if (overflowPx > 1) {
      overflowCount++;
      const b = document.createElement('div');
      b.className = 'overflow-badge';
      b.textContent = `⚠ ${Math.round(overflowPx)}px 넘침 — 인쇄 시 다음 쪽으로 분할됩니다`;
      b.style.left = `${frameLeft + r.left + r.width - 8}px`;
      b.style.top = `${frameTop + r.top + pageH - 14}px`;
      overlay.appendChild(b);
    }
  }
  document.body.dataset.guides = String(overlay.querySelectorAll('.margin-guide').length);
  document.body.dataset.overflowBadges = String(overflowCount);

  // 다단 근사 안내: 화면 배치는 근사이므로 정밀 미리보기로 열 분할·페이지 경계 확인을 유도한다.
  // teacher iframe(.sheet 내부) 에는 절대 주입하지 않는다 — 부모 오버레이 크롬에만 노출
  // (leftover 포집→structureWarning 오염 방지). overlay 는 매 redraw 마다 재구성되므로
  // drawGuides 안에서 재부착해 지속성을 보장한다(overflow-badge 선례와 동일 레이어).
  const multiCol = (shell.canvasMeta.paper.columns ?? 1) > 1;
  if (multiCol) {
    const note = document.createElement('div');
    note.className = 'columns-note';
    note.textContent = '2단 화면 배치는 근사입니다 — 열 분할·페이지 경계는 정밀 미리보기로 확인하세요';
    overlay.appendChild(note);
  }
  document.body.dataset.columnsNote = String(multiCol);

  // F1 이미지 리사이즈 핸들: 선택 이미지의 우하단에 부모 오버레이 핸들(overlay 는 매 redraw
  // 재구성되므로 여기서 재부착해 지속). pointer-events:auto(오버레이는 기본 none) 로 드래그 수신.
  // 선택 개체 표시 + 조작 핸들. 표·그림·상자·이미지·도형이 모두 같은 규칙을 쓴다 —
  // 골랐으면 테두리가 보이고, ✥ 로 옮기고, 모서리로 크기를 바꾼다.
  // 핸들은 부모 오버레이에만 그린다(iframe 무주입) — 본문 텍스트 편집과 안 부딪힌다.
  // 오버레이는 매 redraw 재구성되므로 여기서 다시 붙여야 지속된다.
  const picked = selectedObject?.el?.isConnected ? selectedObject : null;
  if (picked && mode === 'teacher' && isMovableKind(picked.kind)) {
    const r = picked.el.getBoundingClientRect();
    const x = frameLeft + r.left;
    const y = frameTop + r.top;

    const outline = document.createElement('div');
    outline.className = picked.kind === 'shape' ? 'shape-outline' : 'object-outline';
    outline.dataset.kind = picked.kind;
    outline.style.left = `${x - 2}px`;
    outline.style.top = `${y - 2}px`;
    outline.style.width = `${r.width + 4}px`;
    outline.style.height = `${r.height + 4}px`;
    overlay.appendChild(outline);

    const move = document.createElement('div');
    move.className = 'object-move-handle';
    move.title = picked.kind === 'shape' ? '끌어서 이동' : '끌어서 이동(여백 조절 — 인쇄 흐름 유지)';
    move.textContent = '✥';
    move.style.left = `${x - 11}px`;
    move.style.top = `${y - 11}px`;
    move.addEventListener('pointerdown', startObjectMove);
    overlay.appendChild(move);

    for (const [dir, hx, hy] of [
      ['e', x + r.width, y + r.height / 2],
      ['s', x + r.width / 2, y + r.height],
      ['se', x + r.width, y + r.height],
    ]) {
      const h = document.createElement('div');
      h.className = 'shape-handle';
      h.dataset.dir = dir;
      h.style.left = `${hx - 5}px`;
      h.style.top = `${hy - 5}px`;
      h.addEventListener('pointerdown', startObjectResize);
      overlay.appendChild(h);
    }
    document.body.dataset.objectHandles = picked.kind;
  } else {
    document.body.dataset.objectHandles = 'none';
  }

  // 드래그 중 중앙이 맞았을 때만 뜨는 안내선(파워포인트의 스마트 가이드).
  if (activeAlignGuides.length && picked) {
    const sheet = picked.el.closest('.sheet');
    if (sheet) {
      drawAlignGuides({
        overlay, guides: activeAlignGuides, sheetRect: sheet.getBoundingClientRect(), frameLeft, frameTop,
      });
    }
  }
  document.body.dataset.alignGuides = activeAlignGuides.map((g) => g.axis).join(',');
  document.body.dataset.imgSelected = String(!!(selectedImg && selectedImg.isConnected));
}

// ── 좌측 페이지 썸네일(항목 1) ──
// 현재 보이는 변형(teacher/student)의 시트를 그대로 축소해 보여준다. 갱신은 편집
// 디바운스(onEdit)와 모드 전환에 얹어 별도 타이머를 늘리지 않는다.
const canvasWrap = document.getElementById('canvas-wrap');
const thumbs = createThumbs({
  listEl: document.getElementById('thumb-list'),
  onSelect: (i) => scrollToSheet(i),
});

/** 캔버스 스크롤 컨테이너 기준 i번째 시트의 상단 좌표. */
function sheetOffsetTop(i) {
  const f = frames[mode];
  const sheet = f?.contentDocument?.querySelectorAll('.sheet')[i];
  if (!sheet) return null;
  // 시트 rect 는 iframe 자체 뷰포트 기준(내부 스크롤 없음 = 콘텐츠 좌표)이라
  // iframe 의 offsetTop 을 더하면 #stage 기준 좌표가 된다(여백선 오버레이와 같은 규칙).
  return f.offsetTop + sheet.getBoundingClientRect().top;
}

function scrollToSheet(i, { smooth = true } = {}) {
  const top = sheetOffsetTop(i);
  if (top == null) return;
  // 움직임 최소화 설정을 존중한다. 시드(렌더 테스트)도 smooth:false 로 부르는데,
  // 가상 시간 헤드리스에서는 smooth 애니메이션이 진행되기 전에 계측이 끝나 버린다.
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  canvasWrap.scrollTo({ top: Math.max(0, top - 12), behavior: (smooth && !reduce) ? 'smooth' : 'auto' });
  thumbs.setActive(i);
}

function refreshThumbs() {
  const f = frames[mode];
  const count = thumbs.render(f?.contentDocument ?? null);
  document.getElementById('thumb-count').textContent = count ? `${count}쪽` : '';
  document.body.dataset.thumbCount = String(count);
  syncActiveThumb();
}

/** 뷰포트 상단에 가장 가까운(이미 지나친) 시트를 현재 페이지로 본다. */
function syncActiveThumb() {
  const f = frames[mode];
  const sheets = f?.contentDocument?.querySelectorAll('.sheet');
  if (!sheets?.length) return;
  const probe = canvasWrap.scrollTop + 40; // 상단에서 살짝 아래를 기준선으로
  let active = 0;
  for (let i = 0; i < sheets.length; i++) {
    const top = f.offsetTop + sheets[i].getBoundingClientRect().top;
    if (top <= probe) active = i;
  }
  thumbs.setActive(active);
  document.body.dataset.thumbActive = String(active);
}

canvasWrap.addEventListener('scroll', syncActiveThumb, { passive: true });

// ── 도형(US-E3): 삽입 팝오버 · 선택 · 드래그 · 리사이즈 ──
// 선택 표시와 핸들은 부모 오버레이에 그린다 — iframe(.sheet) 안에 편집 크롬을 주입하지
// 않는다는 원칙(이미지 리사이즈 핸들과 같은 레이어).
let selectedShape = null;
const shapePopover = document.getElementById('shape-popover');

function buildShapePopover() {
  shapePopover.replaceChildren(...SHAPE_KINDS.map(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'shape-pick';
    btn.type = 'button';
    btn.dataset.kind = id;
    btn.title = `${label} 삽입`;
    // 미리보기는 실제 삽입 마크업에서 svg 만 떼어 쓴다 — 아이콘과 결과가 어긋나지 않는다.
    const holder = document.createElement('div');
    holder.innerHTML = shapeMarkup(id);
    const svg = holder.querySelector('svg');
    svg.removeAttribute('style');
    const cap = document.createElement('span');
    cap.textContent = label;
    btn.append(svg, cap);
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); addShape(id); });
    return btn;
  }));
}

function addShape(kind) {
  const doc = frames.teacher?.contentDocument;
  if (!doc) return;
  const block = cursorBlock(doc) ?? doc.querySelector('.wg-block');
  if (!block) { showBanner('warn', '도형을 넣을 블록 안에 커서를 두고 다시 시도하세요.'); return; }
  const shape = history.run(() => insertShape(doc, kind, block));
  markShapeIslands(doc);
  shapePopover.classList.add('hidden');
  document.getElementById('tb-shape').setAttribute('aria-expanded', 'false');
  if (!shape) return;
  selectShape(shape);
  onEdit();
  showBanner('ok', `${shapeLabel(kind)} 삽입 — 끌어서 옮기고 모서리로 크기를 바꿉니다 (Ctrl+Z 로 취소)`);
}

function selectShape(shape) {
  selectObject(shape ? { kind: 'shape', el: shape } : null);
  document.body.dataset.shapeSelected = String(!!shape);
}

function clearShapeSelection() {
  if (selectedShape) selectShape(null);
}

document.getElementById('tb-shape').addEventListener('mousedown', (e) => {
  e.preventDefault(); // iframe 커서(삽입 위치) 보존
  const btn = e.currentTarget;
  const open = shapePopover.classList.toggle('hidden') === false;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    const r = btn.getBoundingClientRect();
    shapePopover.style.left = `${Math.round(r.left)}px`;
    shapePopover.style.top = `${Math.round(r.bottom + 4)}px`;
  }
});

/** 도형 본체 드래그 이동 — 앵커 기준 상대 좌표(mm)를 갱신한다.
 *  pointerdown 은 iframe 문서에서, pointermove 는 부모 window 에서 온다. client 좌표는
 *  프레임마다 원점이 달라 섞으면 잡는 순간 iframe 오프셋만큼 튄다(실측: left 8mm → 265mm).
 *  screen 좌표는 프레임과 무관한 단일 원점이라 그 함정을 피한다. */
function startShapeDrag(e, shape) {
  e.preventDefault();
  selectShape(shape);
  const startX = e.screenX;
  const startY = e.screenY;
  const base = shapeStyle(shape);
  const onMove = (ev) => {
    setShapeStyle(shape, {
      leftMm: base.leftMm + (ev.screenX - startX) / MM_TO_PX,
      topMm: base.topMm + (ev.screenY - startY) / MM_TO_PX,
    });
    drawGuides();
  };
  const onUp = (ev) => {
    try { shape.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
    for (const [t, h] of [['pointermove', onMove], ['pointerup', onUp], ['lostpointercapture', onUp]]) {
      shape.removeEventListener(t, h);
    }
    history.commit(); // 드래그 전체가 되돌리기 1단계(중간 프레임마다 기록하면 쓸모없다)
    onEdit();
    renderInspector();
  };
  // 포인터 캡처가 핵심이다. 캡처 없이 부모 window 에서 듣던 때는, 드래그 중 커서가
  // iframe 위에 있으면 pointermove 가 iframe 문서로 가고 부모는 아무것도 못 받아
  // 도형이 제자리에 있었다(실측 0mm). 합성 이벤트를 부모에 직접 쏘던 테스트는 이
  // 함정을 통과해 버려서, 실제 마우스로 끌어봐야만 드러났다.
  try { shape.setPointerCapture(e.pointerId); } catch { /* 캡처 불가 환경 */ }
  shape.addEventListener('pointermove', onMove);
  shape.addEventListener('pointerup', onUp);
  shape.addEventListener('lostpointercapture', onUp); // 창 밖에서 놓는 경우
}

// ── 텍스트 상자(자유 배치): 배치·본체 드래그·편집 모드 ──
// 슬라이드/Canva 모델: ＋텍스트 → 캔버스를 끌어 상자를 그린다 → 즉시 편집. 이후 단일
// 클릭=선택(끌어 이동·모서리 크기), 더블클릭=편집. 빈 상자는 손을 떼면 자동 삭제한다.
let placingText = false; // 툴바 ＋텍스트를 누른 뒤 캔버스 그리기 대기 상태
let editingText = null; // 지금 캐럿이 들어가 편집 중인 .wg-text (없으면 null)
// 배치 드래그 직후엔 click 이 한 번 따라오는데, 그 target 은 드래그 시작 시점의 요소(아직
// 상자가 없던 자리)와 끝점 상자의 "공통 조상"=블록이라 '상자 바깥 클릭'으로 오인돼 방금
// 그린 빈 상자를 지워 버린다(실측). 그 한 번의 click 만 삼킨다.
let swallowNextCanvasClick = false;

/** ＋텍스트 배치 모드 토글 — 커서를 십자로 바꿔 "이제 그리세요"를 알린다. */
function setPlacingText(on) {
  placingText = on;
  document.getElementById('tb-textbox').setAttribute('aria-pressed', String(on));
  for (const f of [frames.teacher]) {
    if (f?.contentDocument?.body) f.contentDocument.body.style.cursor = on ? 'crosshair' : '';
  }
  document.body.dataset.placingText = String(on);
}

/** 텍스트 상자 본체를 끌어 옮긴다(도형과 동일한 앵커 절대 오프셋 · 포인터 캡처). */
function startTextboxDrag(e, text) {
  e.preventDefault();
  selectObject({ kind: 'textbox', el: text });
  const startX = e.screenX;
  const startY = e.screenY;
  const base = textboxStyle(text);
  let moved = false;
  const onMove = (ev) => {
    if (Math.abs(ev.screenX - startX) + Math.abs(ev.screenY - startY) > 2) moved = true;
    setTextboxStyle(text, {
      leftMm: base.leftMm + (ev.screenX - startX) / MM_TO_PX,
      topMm: base.topMm + (ev.screenY - startY) / MM_TO_PX,
    });
    drawGuides();
  };
  const onUp = (ev) => {
    try { text.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
    for (const [t, h] of [['pointermove', onMove], ['pointerup', onUp], ['lostpointercapture', onUp]]) {
      text.removeEventListener(t, h);
    }
    if (moved) { history.commit(); onEdit(); }
    renderInspector();
  };
  try { text.setPointerCapture(e.pointerId); } catch { /* 캡처 불가 환경 */ }
  text.addEventListener('pointermove', onMove);
  text.addEventListener('pointerup', onUp);
  text.addEventListener('lostpointercapture', onUp);
}

/**
 * 배치 모드에서 캔버스를 끌어 새 텍스트 상자를 그린다. 끌지 않고 클릭만 하면 기본 크기.
 * 앵커는 시작점이 놓인 .wg-block(없으면 첫 블록), 좌표는 그 블록 기준 상대 mm.
 */
function startTextboxPlacement(e) {
  e.preventDefault();
  const doc = frames.teacher?.contentDocument;
  if (!doc) { setPlacingText(false); return; }
  const block = e.target?.closest?.('.wg-block') ?? doc.querySelector('.wg-block');
  if (!block) { showBanner('warn', '텍스트를 넣을 블록이 없습니다.'); setPlacingText(false); return; }
  history.commit(); // 대기 중 타이핑을 먼저 확정 — 상자 삽입이 별도 되돌리기 단계가 되게

  // 절대배치의 원점은 .wg-block 이 아니라 그 안에 append 되는 .wg-text-layer 다. 레이어는
  // 블록 "말미"(콘텐츠 아래)에 놓이므로 블록 좌상단 기준으로 재면 상자가 블록 높이만큼
  // 아래로 밀린다(실측 버그). 그래서 상자를 먼저 만들고 레이어의 실제 화면 좌표를 원점으로
  // 삼아 오프셋을 계산한다. 레이어는 height:0 절대자식만 담아 위치가 안정적이다.
  const originX = e.clientX;
  const originY = e.clientY;
  let box = null; // 끌기 시작하면 그때 만든다(클릭만이면 pointerup 에서 기본 크기)
  let originMm = null; // 레이어 기준 원점(mm) — 상자 생성 직후 확정

  const ensureBox = (opts) => {
    box = insertTextbox(doc, block, { leftMm: 0, topMm: 0, ...opts });
    markTextIslands(doc);
    const lr = box.closest('.wg-text-layer').getBoundingClientRect();
    originMm = { left: lr.left, top: lr.top };
  };

  const onMove = (ev) => {
    const wMm = Math.abs(ev.clientX - originX) / MM_TO_PX;
    const hMm = Math.abs(ev.clientY - originY) / MM_TO_PX;
    if (!box && wMm + hMm < 3) return; // 미세 떨림은 무시
    if (!box) ensureBox({ widthMm: Math.max(8, wMm), heightMm: Math.max(8, hMm) });
    setTextboxStyle(box, {
      leftMm: (Math.min(ev.clientX, originX) - originMm.left) / MM_TO_PX,
      topMm: (Math.min(ev.clientY, originY) - originMm.top) / MM_TO_PX,
      widthMm: Math.max(8, wMm), heightMm: Math.max(8, hMm),
    });
    drawGuides();
  };
  const onUp = () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
    setPlacingText(false);
    if (!box) {
      // 끌지 않았다 = 클릭 배치. 시작점에 기본 크기 상자를 놓는다(자동 높이).
      ensureBox({ widthMm: TEXT_DEFAULTS.widthMm });
      setTextboxStyle(box, {
        leftMm: (originX - originMm.left) / MM_TO_PX,
        topMm: (originY - originMm.top) / MM_TO_PX,
      });
    }
    swallowNextCanvasClick = true; // 뒤따르는 click 이 방금 그린 빈 상자를 지우지 못하게
    history.commit(); // 방금 그린 상자를 되돌리기 1단계로 확정(스냅샷은 라이브 DOM 기준)
    onEdit();
    enterTextEditing(box); // 슬라이드처럼 그리자마자 타이핑할 수 있게 편집 진입
    showBanner('ok', '텍스트 상자 — 입력 후 바깥을 클릭하면 확정, 비어 있으면 자동 삭제됩니다.');
  };
  doc.addEventListener('pointermove', onMove);
  doc.addEventListener('pointerup', onUp);
}

/** 편집 모드 진입 — 안쪽을 contenteditable 로 열고 캐럿을 넣는다. */
function enterTextEditing(text) {
  if (!isTextbox(text)) return;
  if (editingText && editingText !== text) exitTextEditing();
  editingText = text;
  selectObject({ kind: 'textbox', el: text });
  setTextboxEditing(text, true);
  text.focus();
  // 캐럿을 내용 끝에 둔다(빈 상자면 시작).
  const doc = text.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(text);
  range.collapse(false);
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.body.dataset.textEditing = '1';
  drawGuides();
}

/** 편집 모드 종료 — 개체 모드로 되돌리고, 빈 상자는 통째로 삭제한다(슬라이드 관례). */
function exitTextEditing() {
  const text = editingText;
  editingText = null;
  if (!text || !isTextbox(text)) { document.body.dataset.textEditing = '0'; return; }
  setTextboxEditing(text, false);
  if (!text.textContent.trim()) {
    const layer = text.closest('.wg-text-layer');
    const removed = layer ?? text;
    history.run(() => removed.remove());
    if (selectedObject?.el === text) selectObject(null);
    onEdit();
  }
  document.body.dataset.textEditing = '0';
  drawGuides();
}

/**
 * 커서/선택 지점에서 "상자로 변환할" 단위 요소를 찾는다.
 * 블록의 최상위 자식(문단·제목·목록항목 등)을 단위로 본다 — 블록 전체나 표/그림/이미지·
 * 이미 만든 텍스트 상자·도형은 대상이 아니다.
 */
function promotableUnit(anchor) {
  const block = anchor?.closest?.('.wg-block');
  if (!block) return null;
  let cur = anchor;
  while (cur && cur.parentElement && cur.parentElement !== block) cur = cur.parentElement;
  // cur 는 이제 블록의 직속 자식(문단 단위) 또는 블록 자신(텍스트가 블록에 직접 있을 때).
  if (!cur || cur === block) return null;
  if (cur.closest('table, svg, .wg-text, .wg-shape') || cur.tagName === 'IMG') return null;
  return cur.textContent.trim() ? cur : null;
}

/**
 * AI 초안 텍스트를 자유 이동 텍스트 상자로 변환(promote-on-demand).
 * 선택 영역이 있으면 그 텍스트를, 없으면 커서가 놓인 문단 단위를 상자로 옮긴다.
 * 원래 자리는 흐름에서 빠져 비워진다(사용자 선택 A).
 */
function promoteToTextbox() {
  const doc = frames.teacher?.contentDocument;
  const win = frames.teacher?.contentWindow;
  if (!doc || !win) return;
  const sel = doc.getSelection();
  const anchor = selectionAnchorEl(doc);
  const block = anchor?.closest?.('.wg-block') ?? cursorBlock(doc);
  if (!block) { showBanner('warn', '변환할 텍스트에 커서를 두거나 텍스트를 선택하세요.'); return; }

  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const useRange = range && !range.collapsed && block.contains(range.commonAncestorContainer);
  const unit = useRange ? null : promotableUnit(anchor);
  if (!useRange && !unit) { showBanner('warn', '변환할 문단을 찾지 못했습니다 — 텍스트를 직접 선택해 보세요.'); return; }

  // 원본의 화면 위치·크기·서식을 옮기기 전에 확보한다(제거하면 사라진다).
  const srcEl = useRange ? (range.commonAncestorContainer.parentElement ?? block) : unit;
  const rect = (useRange ? range : unit).getBoundingClientRect();
  const cs = win.getComputedStyle(srcEl.nodeType === Node.ELEMENT_NODE ? srcEl : block);
  const fontSize = Math.round((parseFloat(cs.fontSize) * 0.75) * 10) / 10; // px→pt
  const color = cs.color?.startsWith('rgb') ? rgbToHex(cs.color) : TEXT_DEFAULTS.color;
  const align = ['left', 'center', 'right'].includes(cs.textAlign) ? cs.textAlign : 'left';
  const holder = doc.createElement('div');
  if (useRange) holder.appendChild(range.cloneContents()); else holder.innerHTML = unit.innerHTML;
  const contentHtml = holder.innerHTML;
  const boxWidthMm = Math.max(12, rect.width / MM_TO_PX);

  history.commit(); // 변환 전 상태를 한 단계로

  // 순서가 중요하다: 원본을 "먼저" 제거한 뒤 상자를 만든다. 제거하면 그 아래 흐름이
  // 위로 당겨지고 블록 말미의 레이어 앵커도 함께 올라간다 — 상자를 만들고 나서 제거하면
  // 앵커가 그만큼 움직여 상자가 위로 딸려 올라간다(실측 dy -128px). 제거를 먼저 하면
  // 레이어가 안정된 뒤 원본이 있던 "화면 위치(rect)"에 정확히 얹을 수 있다.
  if (useRange) range.deleteContents(); else unit.remove();

  const box = insertTextbox(doc, block, { widthMm: boxWidthMm, fontSize, color, align });
  box.innerHTML = contentHtml;
  markTextIslands(doc);
  const lr = box.closest('.wg-text-layer').getBoundingClientRect();
  setTextboxStyle(box, {
    leftMm: (rect.left - lr.left) / MM_TO_PX,
    topMm: (rect.top - lr.top) / MM_TO_PX,
  });
  history.commit();
  onEdit();
  selectObject({ kind: 'textbox', el: box });
  showBanner('ok', '텍스트를 상자로 변환했습니다 — 끌어서 옮기고 더블클릭해 편집하세요. (Ctrl+Z 로 취소)');
}

/** 'rgb(r, g, b)' → '#rrggbb'. 인스펙터 color 입력이 hex 만 받으므로 변환한다. */
function rgbToHex(rgb) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(rgb);
  if (!m) return TEXT_DEFAULTS.color;
  return '#' + [1, 2, 3].map((i) => Math.round(Number(m[i])).toString(16).padStart(2, '0')).join('');
}

/** 오버레이 핸들 드래그 리사이즈. dir: e(가로) · s(세로) · se(둘 다) */
/**
 * 오버레이 핸들 드래그의 공통 뼈대.
 *
 * 캡처를 오버레이에 건다: 핸들은 drawGuides 가 매 프레임 새로 만들므로 핸들에 걸면
 * 첫 프레임에 파괴돼 캡처가 끊긴다(실측 — 크기 조절이 1.1mm 에서 멈췄다).
 * 좌표는 screen 계로 잰다: 드래그 중 커서가 iframe 위로 넘어가면 client 원점이 달라진다.
 * @param {(dx:number, dy:number) => void} onDrag 시작점 기준 이동량(px)
 */
function dragWithCapture(e, onDrag, onDone = null) {
  e.preventDefault();
  const capture = overlay;
  const startX = e.screenX;
  const startY = e.screenY;
  const onMove = (ev) => { onDrag(ev.screenX - startX, ev.screenY - startY); drawGuides(); };
  const onUp = (ev) => {
    try { capture.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
    for (const [t, h] of [['pointermove', onMove], ['pointerup', onUp], ['lostpointercapture', onUp]]) {
      capture.removeEventListener(t, h);
    }
    if (onDone) onDone(); // 안내선 정리 등 — 손을 뗀 뒤에는 남아 있으면 안 된다
    history.commit(); // 드래그 전체가 되돌리기 1단계
    onEdit();
    renderInspector();
    drawGuides();
  };
  try { capture.setPointerCapture(e.pointerId); } catch { /* 캡처 불가 환경 */ }
  capture.addEventListener('pointermove', onMove);
  capture.addEventListener('pointerup', onUp);
  capture.addEventListener('lostpointercapture', onUp);
}

/** 모서리 핸들 드래그로 크기 조절. dir: e(가로) · s(세로) · se(둘 다) */
function startObjectResize(e) {
  const picked = selectedObject;
  const win = frames.teacher?.contentWindow;
  if (!picked?.el || !win) return;
  const dir = e.currentTarget.dataset.dir;
  if (picked.kind === 'shape') {
    const base = shapeStyle(picked.el);
    dragWithCapture(e, (dx, dy) => setShapeStyle(picked.el, {
      ...(dir.includes('e') ? { widthMm: Math.max(3, base.widthMm + dx / MM_TO_PX) } : {}),
      ...(dir.includes('s') ? { heightMm: Math.max(3, base.heightMm + dy / MM_TO_PX) } : {}),
    }));
    return;
  }
  if (picked.kind === 'textbox') {
    // 폭은 명시, 높이는 기본 자동(내용에 따라 늘어남). s 핸들을 끌면 그 순간 실제 높이를
    // 기준으로 명시 높이가 붙는다 — 자동 높이 상태에선 base.heightMm 가 null 이라서다.
    const base = textboxStyle(picked.el);
    const baseH = base.heightMm ?? picked.el.getBoundingClientRect().height / MM_TO_PX;
    dragWithCapture(e, (dx, dy) => setTextboxStyle(picked.el, {
      ...(dir.includes('e') ? { widthMm: Math.max(8, base.widthMm + dx / MM_TO_PX) } : {}),
      ...(dir.includes('s') ? { heightMm: Math.max(8, baseH + dy / MM_TO_PX) } : {}),
    }));
    return;
  }
  const base = objectBox(picked.el, win);
  dragWithCapture(e, (dx, dy) => setObjectBox(picked.el, {
    ...(dir.includes('e') ? { widthMm: base.widthMm + dx / MM_TO_PX } : {}),
    ...(dir.includes('s') ? { heightMm: base.heightMm + dy / MM_TO_PX } : {}),
  }));
}

/**
 * ✥ 핸들 드래그로 이동.
 * 도형은 앵커 기준 절대 오프셋으로 자유롭게 움직이지만, 표·그림·상자는 글 흐름 안에
 * 있으므로 여백을 민다 — 흐름 밖으로 띄우면 뒤 내용이 밀려들어와 인쇄가 깨진다.
 */
function startObjectMove(e) {
  const picked = selectedObject;
  const win = frames.teacher?.contentWindow;
  if (!picked?.el || !win) return;
  const sheet = picked.el.closest('.sheet');

  /**
   * 이동량을 적용한 뒤 쪽 중앙과 맞는지 보고, 맞으면 정확히 중앙으로 붙인다.
   * 두 번 적용하는 이유: 스냅 판정은 "옮긴 뒤의 실제 위치"로 재야 한다 —
   * 옮기기 전 좌표로 계산하면 커서와 도형이 어긋난다.
   */
  const applyWithSnap = (put) => (dx, dy) => {
    put(dx, dy);
    activeAlignGuides = [];
    if (!sheet) return;
    const { snapDx, snapDy, guides } = centerSnap(picked.el.getBoundingClientRect(), sheet.getBoundingClientRect());
    if (guides.length) {
      put(dx + snapDx, dy + snapDy);
      activeAlignGuides = guides;
    }
  };

  if (picked.kind === 'textbox') {
    // 텍스트 상자도 도형처럼 앵커 기준 절대 오프셋으로 자유롭게 움직인다(흐름 안 밂 아님).
    const base = textboxStyle(picked.el);
    dragWithCapture(e, applyWithSnap((dx, dy) => setTextboxStyle(picked.el, {
      leftMm: base.leftMm + dx / MM_TO_PX,
      topMm: base.topMm + dy / MM_TO_PX,
    })), () => { activeAlignGuides = []; });
    return;
  }

  if (picked.kind === 'shape') {
    const base = shapeStyle(picked.el);
    dragWithCapture(e, applyWithSnap((dx, dy) => setShapeStyle(picked.el, {
      leftMm: base.leftMm + dx / MM_TO_PX,
      topMm: base.topMm + dy / MM_TO_PX,
    })), () => { activeAlignGuides = []; });
    return;
  }
  const base = objectBox(picked.el, win);
  dragWithCapture(e, applyWithSnap((dx, dy) => setObjectBox(picked.el, {
    marginLeftMm: base.marginLeftMm + dx / MM_TO_PX,
    marginTopMm: base.marginTopMm + dy / MM_TO_PX,
  })), () => { activeAlignGuides = []; });
}

// ── 우측 속성 패널(인스펙터) ──
// 구글 슬라이드의 "서식 옵션"과 같은 구조: 툴바를 계속 넓히는 대신, 지금 무엇을
// 골랐는지에 따라 이 패널의 내용이 통째로 바뀐다. 섹션 본문은 각 개체 스토리에서 채운다.
const inspectorEl = document.getElementById('inspector');
const inspectorTitleEl = document.getElementById('inspector-title');

function inspRow(label, value) {
  const row = document.createElement('div');
  row.className = 'insp-row';
  const l = document.createElement('label');
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'insp-val';
  v.textContent = value;
  row.append(l, v);
  return row;
}

function inspSection(title, ...nodes) {
  const box = document.createElement('div');
  box.className = 'insp-section';
  const h = document.createElement('div');
  h.className = 'insp-group-title';
  h.textContent = title;
  box.append(h, ...nodes);
  return box;
}

/**
 * 지금 편집 대상 — 클릭으로 고른 개체가 우선이고, 없으면 커서가 놓인 표,
 * 그것도 없으면 문서. 클릭 선택을 우선하는 이유: 표 안에 커서를 둔 채 그래프를
 * 클릭했으면 그래프를 고른 것이다.
 */
function currentTarget() {
  const doc = frames.teacher?.contentDocument;
  if (mode !== 'teacher' || !doc) return { kind: 'document' };
  if (selectedObject?.el?.isConnected) return selectedObject;
  const el = selectionAnchorEl(doc);
  const cell = el?.closest?.('td, th');
  if (cell) return { kind: 'cell', el: cell, table: cell.closest('table') };
  const table = el?.closest?.('table');
  if (table) return { kind: 'table', el: table };
  return { kind: 'document' };
}

/** 라벨 + 컨트롤 한 줄(인스펙터 편집 행). */
function inspControl(label, control) {
  const row = document.createElement('div');
  row.className = 'insp-row';
  const l = document.createElement('label');
  l.textContent = label;
  row.append(l, control);
  return row;
}

/** 도형 서식을 바꾸고 되돌리기 1단계로 확정한다. */
function patchShape(patch) {
  if (!selectedShape) return;
  history.run(() => setShapeStyle(selectedShape, patch));
  drawGuides();
  onEdit();
}

function shapeInspector(shape) {
  const st = shapeStyle(shape);
  const nodes = [];

  const fill = document.createElement('input');
  fill.type = 'color';
  fill.className = 'insp-color';
  fill.value = st.fill === 'none' ? '#ffffff' : st.fill;
  fill.addEventListener('input', () => patchShape({ fill: fill.value }));
  const noFill = document.createElement('button');
  noFill.className = 'insp-btn';
  noFill.textContent = '없음';
  noFill.title = '채우기 없음(투명) — 본문 위에 겹쳐 쓸 때';
  noFill.addEventListener('click', () => { patchShape({ fill: 'none' }); renderInspector(); });
  const fillWrap = document.createElement('span');
  fillWrap.style.display = 'flex';
  fillWrap.style.gap = '4px';
  fillWrap.append(fill, noFill);
  nodes.push(inspControl('채우기 색', fillWrap));

  const stroke = document.createElement('input');
  stroke.type = 'color';
  stroke.className = 'insp-color';
  stroke.value = st.stroke;
  stroke.addEventListener('input', () => patchShape({ stroke: stroke.value }));
  nodes.push(inspControl('선 색', stroke));

  const sw = document.createElement('input');
  sw.type = 'number';
  sw.className = 'insp-num';
  sw.min = '0.2'; sw.max = '20'; sw.step = '0.2';
  sw.value = st.strokeWidth;
  sw.addEventListener('change', () => patchShape({ strokeWidth: sw.value }));
  nodes.push(inspControl('선 두께', sw));

  const dash = document.createElement('select');
  dash.className = 'insp-num';
  for (const d of DASH_STYLES) dash.append(new Option(d.label, d.id));
  dash.value = DASH_STYLES.some((d) => d.id === st.dash) ? st.dash : '0';
  dash.addEventListener('change', () => patchShape({ dash: dash.value }));
  nodes.push(inspControl('선 종류', dash));

  // 크기와 위치를 숫자로도 다룬다 — 손으로 끌다 지면 밖으로 내보내면 되돌릴 방법이
  // 화면에 남지 않으므로, 좌표 입력이 유일한 복구 수단이자 정밀 배치 수단이다.
  for (const [label, key, min, max] of [
    ['가로(mm)', 'widthMm', 3, 400],
    ['세로(mm)', 'heightMm', 3, 400],
    ['가로 위치(mm)', 'leftMm', -400, 400],
    ['세로 위치(mm)', 'topMm', -400, 400],
  ]) {
    const n = document.createElement('input');
    n.type = 'number';
    n.className = 'insp-num';
    n.min = String(min); n.max = String(max); n.step = '1';
    n.value = String(Math.round(st[key] * 10) / 10);
    n.dataset.shapeDim = key;
    n.addEventListener('change', () => patchShape({ [key]: Number(n.value) }));
    nodes.push(inspControl(label, n));
  }

  const del = document.createElement('button');
  del.className = 'insp-btn';
  del.textContent = '도형 삭제';
  del.addEventListener('click', () => {
    const layer = shape.closest('.wg-shape-layer');
    history.run(() => (layer ?? shape).remove());
    selectShape(null);
    onEdit();
  });
  nodes.push(del);

  return inspSection(shapeLabel(shape.dataset.shape), ...nodes);
}

const TEXT_ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']];

/**
 * 텍스트 상자 인스펙터. 여기의 글자 크기·색·정렬은 상자 "전체"의 기본값(--wg-* 변수)이다.
 * 일부 글자만 다르게 하려면 편집 모드에서 그 부분을 선택해 툴바로 서식한다(execCommand
 * 인라인 span 이 이 기본값을 이긴다) — 슬라이드와 같은 이중 구조.
 */
function textboxInspector(text) {
  const st = textboxStyle(text);
  const patch = (p, opts) => applyEdit(() => setTextboxStyle(text, p), opts);
  const nodes = [];

  const edit = document.createElement('button');
  edit.className = 'insp-btn';
  edit.textContent = '텍스트 편집';
  edit.title = '더블클릭과 같음 — 캐럿을 넣어 글자를 입력·수정';
  edit.addEventListener('click', () => enterTextEditing(text));
  nodes.push(edit);

  nodes.push(inspNumber('글자 크기(pt)', st.fontSize, (v) => patch({ fontSize: v }),
    { min: 4, max: 200, step: 0.5, key: 'textFontSize' }));
  nodes.push(inspColor('글자 색', st.color, (v) => patch({ color: v })));
  nodes.push(inspSelect('정렬', TEXT_ALIGNS, st.align, (v) => patch({ align: v }), 'textAlign'));
  nodes.push(inspNumber('가로(mm)', st.widthMm, (v) => patch({ widthMm: v }), { min: 8, max: 400, key: 'textWidthMm' }));
  // 세로 위치·가로 위치는 손으로 지면 밖에 흘리면 화면에서 되찾기 어려워 숫자 입력을 둔다.
  nodes.push(inspNumber('가로 위치(mm)', st.leftMm, (v) => patch({ leftMm: v }), { min: -400, max: 400, key: 'textLeftMm' }));
  nodes.push(inspNumber('세로 위치(mm)', st.topMm, (v) => patch({ topMm: v }), { min: -400, max: 400, key: 'textTopMm' }));

  const del = document.createElement('button');
  del.className = 'insp-btn';
  del.textContent = '텍스트 상자 삭제';
  del.addEventListener('click', () => {
    const layer = text.closest('.wg-text-layer');
    if (editingText === text) editingText = null;
    history.run(() => (layer ?? text).remove());
    selectObject(null);
    onEdit();
  });
  nodes.push(del);

  return inspSection('텍스트 상자', ...nodes);
}

// ── 인스펙터 공용 컨트롤 ──
// 색상 입력은 조작 중 input 이 연속으로 오므로 재렌더하면 피커가 닫힌다 —
// rerender 는 행/열 추가처럼 구조가 바뀌는 조작에서만 켠다.
function applyEdit(fn, { rerender = false } = {}) {
  history.run(fn);
  drawGuides();
  onEdit();
  if (rerender) renderInspector();
}

function inspColor(label, value, onChange, { noneLabel = null, onNone = null } = {}) {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'insp-color';
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  input.addEventListener('input', () => onChange(input.value));
  if (!noneLabel) return inspControl(label, input);
  const wrap = document.createElement('span');
  wrap.style.display = 'flex';
  wrap.style.gap = '4px';
  const none = document.createElement('button');
  none.className = 'insp-btn';
  none.textContent = noneLabel;
  none.addEventListener('click', onNone);
  wrap.append(input, none);
  return inspControl(label, wrap);
}

function inspNumber(label, value, onChange, { min = 0, max = 999, step = 1, key = null } = {}) {
  const n = document.createElement('input');
  n.type = 'number';
  n.className = 'insp-num';
  n.min = String(min); n.max = String(max); n.step = String(step);
  n.value = String(value);
  if (key) n.dataset.inspKey = key;
  n.addEventListener('change', () => onChange(Number(n.value)));
  return inspControl(label, n);
}

const BORDER_STYLES = [['solid', '실선'], ['dashed', '파선'], ['dotted', '점선'], ['none', '없음']];

function inspSelect(label, options, value, onChange, key = null) {
  const sel = document.createElement('select');
  sel.className = 'insp-num';
  for (const [v, t] of options) sel.append(new Option(t, v));
  sel.value = options.some(([v]) => v === value) ? value : options[0][0];
  if (key) sel.dataset.inspKey = key;
  sel.addEventListener('change', () => onChange(sel.value));
  return inspControl(label, sel);
}

function inspButtonRow(...specs) {
  const row = document.createElement('div');
  row.className = 'insp-row';
  row.style.flexWrap = 'wrap';
  for (const [text, fn, title] of specs) {
    const b = document.createElement('button');
    b.className = 'insp-btn';
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    row.append(b);
  }
  return row;
}

/** 테두리·배경을 가진 요소(선·상자) 편집 — AI 초안의 밑줄·자료상자가 여기 해당. */
function boxInspector(el, win) {
  const st = boxStyle(el, win);
  const patch = (p, opts) => applyEdit(() => setBoxStyle(el, p, win), opts);
  const label = el.className ? `.${el.className.split(/\s+/)[0]}` : el.tagName.toLowerCase();
  return inspSection(label, ...[
    inspColor('선 색', st.borderColor, (v) => patch({ borderColor: v })),
    inspNumber('선 두께', st.borderWidth, (v) => patch({ borderWidth: v }), { min: 0, max: 20, step: 0.2, key: 'borderWidth' }),
    inspSelect('선 종류', BORDER_STYLES, st.borderStyle, (v) => patch({ borderStyle: v }), 'borderStyle'),
    inspColor('배경', st.background === 'none' ? '#ffffff' : st.background,
      (v) => patch({ background: v }),
      { noneLabel: '없음', onNone: () => patch({ background: 'none' }, { rerender: true }) }),
    inspNumber('모서리', st.radius, (v) => patch({ radius: v }), { min: 0, max: 40, key: 'radius' }),
    inspNumber('높이(mm)', st.heightMm, (v) => patch({ heightMm: v }), { min: 1, max: 300, key: 'heightMm' }),
  ].flat());
}

/** 표 편집 — 테두리 일괄, 머리행 배경, 행/열 구조. */
function tableInspector(table, refCell) {
  const win = frames.teacher.contentWindow;
  const probe = table.querySelector('td, th');
  const st = probe ? boxStyle(probe, win) : { borderColor: '#333333', borderWidth: 1, borderStyle: 'solid' };
  const rows = table.rows?.length ?? 0;
  const cols = rows ? (table.rows[0].cells?.length ?? 0) : 0;
  const patch = (p) => applyEdit(() => setTableStyle(table, p));
  /**
   * 구조 편집. 거부되면(마지막 데이터 행/열) 조용히 넘어가지 않고 이유를 알린다 —
   * 눌렀는데 아무 일도 안 일어나면 사용자는 그걸 버그로 읽는다.
   */
  const structure = (fn, refuseMsg) => {
    let ok = false;
    applyEdit(() => { ok = fn(table, refCell); });
    if (!ok) { showBanner('warn', refuseMsg); return; }
    // 기준 셀이 방금 삭제됐을 수 있다. 그대로 두면 선택이 죽은 노드를 가리켜
    // 인스펙터가 엉뚱한 표나 문서로 떨어진다(실측) — 같은 표의 살아 있는 셀로 옮긴다.
    const alive = refCell?.isConnected ? refCell : table.querySelector('td, th');
    selectObject(alive ? { kind: 'cell', el: alive, table } : { kind: 'table', el: table });
  };
  // 머리 배경은 머리가 실제로 있는 표에서만 보인다. .vartable 은 th 가 없고 첫 열이
  // 머리 역할이라 라벨을 달리 붙인다 — 없는 표에 조작을 내놓으면 눌러도 무반응이다.
  const headRow = hasHeaderRow(table);
  const headCol = hasHeaderCol(table);
  const headControl = headRow || headCol
    ? [inspColor(headRow ? '머리행 배경' : '머리열 배경', '#dceae4', (v) => patch({ headBackground: v }))]
    : [];
  return inspSection(`표 ${rows}행 × ${cols}열`, ...[
    inspColor('선 색', st.borderColor, (v) => patch({ borderColor: v })),
    inspNumber('선 두께', st.borderWidth, (v) => patch({ borderWidth: v }), { min: 0, max: 10, step: 0.2, key: 'tableBorderWidth' }),
    inspSelect('선 종류', BORDER_STYLES, st.borderStyle, (v) => patch({ borderStyle: v }), 'tableBorderStyle'),
    ...headControl,
    inspButtonRow(
      ['행 +', () => structure(tableOps.addRow, '행을 추가할 수 없습니다.'), '기준 행 아래에 추가'],
      ['행 −', () => structure(tableOps.removeRow, '데이터 행이 하나뿐이라 삭제할 수 없습니다.'), '기준 행 삭제'],
      ['열 +', () => structure(tableOps.addCol, '열을 추가할 수 없습니다.'), '기준 열 오른쪽에 추가'],
      ['열 −', () => structure(tableOps.removeCol, '열이 하나뿐이라 삭제할 수 없습니다.'), '기준 열 삭제']),
  ].flat());
}

/** SVG(그래프·도해) 편집 — 내부 도형에 인라인으로 걸어 원본 속성을 이긴다. */
function svgInspector(svg) {
  const win = frames.teacher.contentWindow;
  const st = svgStyle(svg, win);
  const patch = (p, opts) => applyEdit(() => setSvgStyle(svg, p), opts);
  return inspSection(`그림 (요소 ${st.shapeCount}개)`, ...[
    inspColor('선 색', st.stroke, (v) => patch({ stroke: v })),
    inspNumber('선 두께', st.strokeWidth, (v) => patch({ strokeWidth: v }), { min: 0.2, max: 20, step: 0.2, key: 'svgStrokeWidth' }),
    inspColor('채우기', st.fill === 'none' ? '#ffffff' : st.fill,
      (v) => patch({ fill: v }),
      { noneLabel: '없음', onNone: () => patch({ fill: 'none' }, { rerender: true }) }),
    inspNumber('가로(mm)', st.widthMm, (v) => patch({ widthMm: v }), { min: 5, max: 400, key: 'svgWidthMm' }),
    inspNumber('세로(mm)', st.heightMm, (v) => patch({ heightMm: v }), { min: 5, max: 400, key: 'svgHeightMm' }),
  ].flat());
}

function renderInspector() {
  const target = currentTarget();
  const win = frames.teacher?.contentWindow;
  inspectorEl.replaceChildren();
  if (target.kind === 'shape') {
    inspectorTitleEl.textContent = shapeLabel(target.el.dataset.shape);
    inspectorEl.append(shapeInspector(target.el));
  } else if (target.kind === 'textbox') {
    inspectorTitleEl.textContent = '텍스트 상자';
    inspectorEl.append(textboxInspector(target.el));
  } else if (target.kind === 'image') {
    inspectorTitleEl.textContent = '이미지';
    const img = target.el;
    const widthMm = Math.round((img.getBoundingClientRect().width / MM_TO_PX) * 10) / 10;
    inspectorEl.append(inspSection('이미지',
      inspRow('파일', (img.getAttribute('src') || '').split('/').pop() || '(인라인)'),
      inspRow('설명', img.getAttribute('alt') || '(없음)'),
      inspNumber('가로(mm)', widthMm, (v) => applyEdit(() => { img.style.width = `${v}mm`; }),
        { min: 5, max: 400, key: 'imgWidthMm' })));
  } else if (target.kind === 'svg') {
    inspectorTitleEl.textContent = targetLabel(target);
    inspectorEl.append(svgInspector(target.el));
  } else if (target.kind === 'table' || target.kind === 'cell') {
    inspectorTitleEl.textContent = targetLabel(target);
    const table = target.table ?? target.el;
    const refCell = target.kind === 'cell' ? target.el : null;
    inspectorEl.append(tableInspector(table, refCell));
    if (refCell && win) {
      const cellSt = boxStyle(refCell, win);
      inspectorEl.append(inspSection('선택한 셀',
        inspColor('셀 배경', cellSt.background === 'none' ? '#ffffff' : cellSt.background,
          (v) => applyEdit(() => { refCell.style.backgroundColor = v; }),
          { noneLabel: '없음', onNone: () => applyEdit(() => { refCell.style.backgroundColor = 'transparent'; }, { rerender: true }) })));
    }
  } else if (target.kind === 'box' && win) {
    inspectorTitleEl.textContent = targetLabel(target);
    inspectorEl.append(boxInspector(target.el, win));
  } else {
    inspectorTitleEl.textContent = '문서';
    const doc = frames[mode]?.contentDocument;
    const paper = shell.canvasMeta.paper;
    inspectorEl.append(inspSection('문서',
      inspRow('제목', shell.docTitle || '(제목 없음)'),
      inspRow('용지', `${paper.size} ${paper.orientation === 'landscape' ? '가로' : '세로'}${(paper.columns ?? 1) > 1 ? ` · ${paper.columns}단` : ''}`),
      inspRow('쪽 수', String(doc?.querySelectorAll('.sheet').length ?? 0)),
      inspRow('블록', String(doc?.querySelectorAll('.wg-block').length ?? 0)),
      inspRow('리비전', currentRevision == null ? '—' : `rev ${currentRevision}`)));
  }
  document.body.dataset.inspector = target.kind;
}

function paperHeightMm() {
  const p = shell.canvasMeta.paper;
  const sizes = { A4: [210, 297], A3: [297, 420], B4: [257, 364] };
  const [shortSide, longSide] = sizes[p.size] ?? [210, 297];
  return p.orientation === 'landscape' ? shortSide : longSide;
}

// ── 라이브 검수 바: recompute(mode) — 입력은 편집 DOM 직렬화(E2 훅의 E3 확장) ──
const validator = new ValidateWorksheet({
  knownSubjectHexes: shell.validationSeed.knownSubjectHexes,
  paper: shell.validationSeed.paper,
});

function recompute(m) {
  // 누출(answer-leak)은 항상 teacher(마크 생존측), 인쇄안전은 현재 표시 변형 기준.
  const teacherHtml = currentTeacherHtml();
  const displayedHtml = m === 'student' ? deriveStudentHtml() : teacherHtml;
  const leak = validator.execute(teacherHtml).findings.filter((f) => f.rule === 'answer-leak');
  const safety = validator.execute(displayedHtml).findings.filter((f) => f.rule !== 'answer-leak');
  const findings = [...leak, ...safety];

  const worst = findings.some((f) => f.severity === 'error') ? 'error'
    : findings.some((f) => f.severity === 'warning') ? 'warning' : 'ok';
  statusEl.className = `review-status ${worst}`;
  statusEl.textContent = worst === 'ok'
    ? `검수 통과 (${m === 'student' ? '학생용' : '교사용'} 기준)`
    : `검수: error ${findings.filter((f) => f.severity === 'error').length} · warning ${findings.filter((f) => f.severity === 'warning').length}`;

  listEl.replaceChildren(...findings.map((f) => {
    const li = document.createElement('li');
    li.className = f.severity;
    li.dataset.rule = f.rule;
    const b = document.createElement('b');
    b.textContent = `[${f.rule}] `;
    li.append(b, `${f.message} (근거: ${f.evidence})`);
    return li;
  }));
  document.body.dataset.warnMinFont = String(findings.some((f) => f.rule === 'min-font'));
}

// ── 저장: DOM 순회 → resync → POST /save. iframe 은 유지(커서·스크롤 보존) ──
async function save() {
  const sheets = serializeSheets();
  if (!sheets) return null;
  const { manifest, structureWarning } = resyncManifest(sheets, baseManifest);
  let res;
  try {
    res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, structureWarning }),
    });
  } catch (e) {
    showBanner('error', `저장 실패: ${e.message}`);
    return null;
  }
  if (!res.ok) {
    showBanner('error', `저장 실패 (HTTP ${res.status})`);
    return null;
  }
  const result = await res.json();
  baseManifest = manifest;
  currentRevision = result.meta?.revision ?? currentRevision;
  renderRev();
  studentStale = true;
  dirty = false; // 저장 성공 = 기준선 갱신(E6 dirty-gate 리셋)

  if (result.unsafe) {
    const rules = [...new Set(result.leakFindings.map((f) => f.rule))].join(', ');
    showBanner('error', `⚠ 저장됨(rev ${currentRevision}) — 정답 누출 감지(${rules}). 학생용 HTML 은 보류되었습니다. 마크를 복구한 뒤 다시 저장하세요.`);
  } else if (structureWarning) {
    showBanner('warn', `저장됨(rev ${currentRevision}) — 블록 경계가 병합되었습니다. 구조를 확인하세요.`);
  } else {
    showBanner('ok', `저장됨 (rev ${currentRevision})`);
  }
  recompute(mode);
  document.body.dataset.savedUnsafe = String(result.unsafe);
  return result;
}

let bannerTimer = null;
function showBanner(kind, text) {
  saveBanner.className = `save-banner ${kind}`;
  saveBanner.textContent = text;
  clearTimeout(bannerTimer);
  if (kind === 'ok') bannerTimer = setTimeout(() => saveBanner.classList.add('hidden'), 4000);
}

// ── 토글 배선 ──
async function setMode(m) {
  mode = m;
  document.getElementById('btn-teacher').classList.toggle('active', m === 'teacher');
  document.getElementById('btn-student').classList.toggle('active', m === 'student');
  let f;
  if (m === 'student' && (studentStale || !frames.student)) {
    f = await ensureFrame('student', deriveStudentHtml()); // 즉석 파생 — 저장 없이 마크 반영
    studentStale = false;
  } else {
    f = await ensureFrame(m);
  }
  for (const [name, frame] of Object.entries(frames)) {
    if (frame) frame.classList.toggle('hidden', name !== m);
  }
  fitFrame(f);
  drawGuides();
  recompute(m);

  const firstSheet = f.contentDocument?.querySelector('.sheet');
  if (firstSheet) {
    const r = firstSheet.getBoundingClientRect();
    document.body.dataset.sheetW = r.width.toFixed(1);
    document.body.dataset.sheetH = r.height.toFixed(1);
  }
  document.body.dataset.mode = m;
  // 변형이 통째로 다른 문서라 캐시를 버리고 전 쪽을 다시 그린다(학생용 썸네일 반영).
  thumbs.invalidate();
  refreshThumbs();
  renderInspector();
}

document.getElementById('btn-teacher').addEventListener('click', () => setMode('teacher'));
document.getElementById('btn-student').addEventListener('click', () => setMode('student'));
// 여백선·눈금자·격자는 각각 독립 토글이다. 예전엔 여백선이 오버레이를 통째로 숨겨서
// 끄면 선택 핸들까지 같이 사라졌다 — 이제 그리기 단계에서 항목별로 가른다.
for (const [id, get, set] of [
  ['btn-guides', () => showGuides, (v) => { showGuides = v; }],
  ['btn-rulers', () => showRulers, (v) => { showRulers = v; }],
  ['btn-grid', () => showGrid, (v) => { showGrid = v; }],
]) {
  const btn = document.getElementById(id);
  btn.classList.toggle('active', get());
  btn.setAttribute('aria-pressed', String(get()));
  btn.addEventListener('click', () => {
    set(!get());
    btn.classList.toggle('active', get());
    btn.setAttribute('aria-pressed', String(get()));
    document.body.dataset[id.replace('btn-', '')] = String(get());
    drawGuides();
  });
}
document.getElementById('btn-save').addEventListener('click', save);
window.addEventListener('resize', drawGuides);
window.addEventListener('keydown', onKeydown);

// ── 툴바 배선(어댑터 경유 — 포커스는 teacher iframe 이 유지) ──
const tb = createToolbar(() => frames.teacher?.contentDocument ?? null);
// 모든 툴바 명령은 history.run 을 통과한다 — 실행 전 대기 중인 타이핑을 먼저 확정해
// "타이핑 → 명령" 순서를 보존하고, 실행 후 한 단계로 확정한다.
const bind = (id, fn) => document.getElementById(id)
  .addEventListener('mousedown', (e) => { e.preventDefault(); history.run(fn); onEdit(); });
bind('tb-bold', () => tb.applyBold());
bind('tb-italic', () => tb.applyItalic());
bind('tb-underline', () => tb.applyUnderline());
// 정렬은 적용 직후 눌린 상태를 되비춘다(어느 정렬인지 버튼만 봐도 알 수 있게).
for (const dir of ['left', 'center', 'right']) {
  bind(`tb-align-${dir}`, () => { tb.applyAlign(dir); reflectSelectionFormat(); });
}
bind('tb-ul', () => tb.applyList('ul'));
bind('tb-ol', () => tb.applyList('ol'));
bind('tb-table', () => tb.insertTable());
// tb-image 는 파일 픽커(비동기) — bind 의 즉시 onEdit 를 피하려 별도 배선(삽입 후 onEdit 는
// insertImageFile 이 호출). mousedown preventDefault 로 iframe 커서(삽입 지점) 보존.
document.getElementById('tb-image').addEventListener('mousedown', (e) => { e.preventDefault(); pickImage(); });
// tb-textbox: 배치 모드 토글. 누르면 커서가 십자로 바뀌고, 다음 캔버스 드래그/클릭이 상자를
// 그린다(startTextboxPlacement). preventDefault 로 iframe 커서를 뺏지 않는다.
document.getElementById('tb-textbox').addEventListener('mousedown', (e) => { e.preventDefault(); setPlacingText(!placingText); });
// tb-to-textbox: 선택/커서 지점의 AI 텍스트를 상자로 변환. preventDefault 로 iframe 선택 보존
// (변환 대상을 selection 에서 읽으므로 선택이 살아 있어야 한다).
document.getElementById('tb-to-textbox').addEventListener('mousedown', (e) => { e.preventDefault(); promoteToTextbox(); });
// ↶↷ 는 execCommand 가 아니라 통합 스택을 민다(bind 를 쓰면 history.run 이 되감아
// 버리므로 별도 배선). mousedown+preventDefault 로 iframe 선택을 뺏지 않는다.
for (const [id, act] of [['tb-undo', () => history.undo()], ['tb-redo', () => history.redo()]]) {
  document.getElementById(id).addEventListener('mousedown', (e) => { e.preventDefault(); act(); });
}
document.getElementById('tb-color').addEventListener('input', (e) => { tb.applyColor(e.target.value); onEdit(); });
document.getElementById('tb-font').addEventListener('change', (e) => { tb.applyFontFamily(e.target.value); onEdit(); });
// ── 글자 크기: 자유 입력 + ± 스테퍼 ──
// 프리셋 목록은 datalist 로만 제안하고, 실제 값은 4~200pt 사이 아무 수나 받는다
// (10.5pt 처럼 한국 문서에서 흔한 소수점 크기를 고정 목록이 막고 있던 것의 해소).
const SIZE_MIN = 4;
const SIZE_MAX = 200;
const sizeInput = document.getElementById('tb-size');

/** 선택 시작점이 놓인 요소 — 툴바에 현재 서식을 되비추는 기준. */
function selectionAnchorEl(doc) {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return node?.nodeType === Node.ELEMENT_NODE ? node : null;
}

/**
 * 커서가 놓인 곳의 실제 서식을 툴바에 반영한다(구글 독스/슬라이드 모델).
 * ± 스테퍼가 "지금 크기 기준"으로 동작하려면 이 반영이 선행돼야 한다.
 */
const ALIGN_BTN = { left: 'tb-align-left', center: 'tb-align-center', right: 'tb-align-right' };
function reflectSelectionFormat() {
  const doc = frames.teacher?.contentDocument;
  const el = doc ? selectionAnchorEl(doc) : null;
  if (!el) return;
  const cs = doc.defaultView.getComputedStyle(el);
  // 입력 중에는 덮어쓰지 않는다(타이핑 중 값이 튀는 것 방지).
  if (document.activeElement !== sizeInput) {
    const pt = parseFloat(cs.fontSize) * 72 / 96; // px → pt (CSS 사양 고정)
    if (Number.isFinite(pt)) sizeInput.value = String(Math.round(pt * 10) / 10);
  }
  const align = cs.textAlign === 'start' ? 'left' : cs.textAlign;
  for (const [dir, id] of Object.entries(ALIGN_BTN)) {
    document.getElementById(id).classList.toggle('active', align === dir);
  }
}

/** 선택이 바뀔 때 도는 단일 진입점 — AI 가드와 서식 반영을 함께 갱신한다. */
function onSelectionChange() {
  updateAiButtons();
  reflectSelectionFormat();
  renderInspector();
}

function applySizePt(pt) {
  if (!Number.isFinite(pt)) return;
  const clamped = Math.min(SIZE_MAX, Math.max(SIZE_MIN, pt));
  if (!history.run(() => tb.applyFontSize(clamped))) {
    showBanner('warn', '크기를 적용할 텍스트를 먼저 드래그해 선택하세요.'); // 무반응 방지
    return;
  }
  sizeInput.value = String(Math.round(clamped * 10) / 10);
  onEdit();
}

sizeInput.addEventListener('change', () => applySizePt(parseFloat(sizeInput.value)));
sizeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); applySizePt(parseFloat(sizeInput.value)); }
});
// ± 는 mousedown+preventDefault 로 iframe 선택을 뺏지 않아야 연타가 된다.
for (const [id, delta] of [['tb-size-dec', -1], ['tb-size-inc', 1]]) {
  document.getElementById(id).addEventListener('mousedown', (e) => {
    e.preventDefault();
    applySizePt((parseFloat(sizeInput.value) || 10) + delta);
  });
}
bind('tb-answer', () => {
  const doc = frames.teacher?.contentDocument;
  if (!doc) return;
  toggleAnswerMark(doc, {
    confirmUnwrap: () => window.confirm('이 정답 마크를 해제하면 학생용에서도 정답이 노출됩니다. 계속할까요?'),
  });
});
bind('tb-anslines', () => {
  const doc = frames.teacher?.contentDocument;
  if (doc) insertAnswerLines(doc, 5);
});

// ── 좌측 패널 탭(페이지 · 프리셋) + 좌우 패널 접기 ──
const LEFT_TABS = [['tab-pages', 'pane-pages'], ['tab-presets', 'pane-presets']];

function showLeftTab(tabId) {
  document.body.classList.remove('left-collapsed'); // 접힌 채로 탭을 열면 아무 일도 안 일어난 것처럼 보인다
  for (const [t, p] of LEFT_TABS) {
    const on = t === tabId;
    const tabEl = document.getElementById(t);
    tabEl.classList.toggle('active', on);
    tabEl.setAttribute('aria-selected', String(on));
    document.getElementById(p).classList.toggle('hidden', !on);
  }
  document.body.dataset.leftTab = tabId === 'tab-presets' ? 'presets' : 'pages';
}

for (const [t] of LEFT_TABS) {
  document.getElementById(t).addEventListener('click', () => {
    showLeftTab(t);
    if (t === 'tab-presets') refreshPresetsOnce();
  });
}

function togglePanel(side) {
  const cls = `${side}-collapsed`;
  const collapsed = document.body.classList.toggle(cls);
  const btn = document.getElementById(`${side}-collapse`);
  // 화살표는 "누르면 일어날 일"을 가리킨다(접힘 ▶ = 펼치기).
  btn.textContent = collapsed ? (side === 'left' ? '▶' : '◀') : (side === 'left' ? '◀' : '▶');
  btn.title = collapsed ? `${side === 'left' ? '좌측' : '우측'} 패널 펼치기` : `${side === 'left' ? '좌측' : '우측'} 패널 접기`;
  document.body.dataset[`${side}Collapsed`] = String(collapsed);
  drawGuides(); // 캔버스 폭이 바뀌었으므로 오버레이 좌표 재계산
}
document.getElementById('left-collapse').addEventListener('click', () => togglePanel('left'));
document.getElementById('right-collapse').addEventListener('click', () => togglePanel('right'));

// ── E4 프리셋 라이브러리 ──
const presetListEl = document.getElementById('preset-list');
const presetHiddenEl = document.getElementById('preset-hidden');
const presetWarnEl = document.getElementById('preset-warnings');
// 미리보기에 실제 블록 CSS 를 쓰기 위해 조립본의 <style> 원문을 재사용한다.
const shellStyles = [...shell.teacherHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((m) => m[1]).join('\n');
let presetShowAnswer = false;
let presetCache = null;

async function refreshPresets() {
  presetCache = await (await fetch('/presets')).json();
  renderPresetPanel();
}

function renderPresetPanel() {
  if (!presetCache) return;
  presetWarnEl.textContent = [
    presetCache.warning,
    presetCache.skipped?.length ? `빌트인 스킵(exemplar 부재): ${presetCache.skipped.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  presetListEl.replaceChildren(...presetCache.presets.map(presetItem));
  presetHiddenEl.replaceChildren();
  if (presetCache.hidden?.length) {
    presetHiddenEl.append('숨긴 기본 제공:');
    for (const id of presetCache.hidden) {
      const btn = document.createElement('button');
      btn.textContent = `${id} 복원`;
      btn.addEventListener('click', async () => {
        await fetch(`/presets/restore/${encodeURIComponent(id)}`, { method: 'POST' });
        await refreshPresets();
      });
      presetHiddenEl.appendChild(btn);
    }
  }
}

/** 커서 블록을 기준으로 프리셋을 삽입한다(삽입 버튼·더블클릭 공용). */
function insertPresetAt(p) {
  const doc = frames.teacher?.contentDocument;
  if (!doc) return;
  if (history.run(() => insertPreset(doc, p))) {
    onEdit();
    showBanner('ok', `프리셋 삽입: ${p.name} (Ctrl+Z 로 취소 · 저장 시 문서에 반영)`);
  }
}

function presetItem(p) {
  const li = document.createElement('li');
  li.className = 'preset-item';
  li.dataset.presetId = p.id;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', 'false');
  li.title = '클릭: 선택 · 더블클릭: 커서 위치에 삽입';
  // 선택 상태 — "고르는 중"이 눈에 보여야 라이브러리가 목록이 아니라 도구로 읽힌다.
  li.addEventListener('click', () => {
    for (const other of presetListEl.querySelectorAll('.preset-item')) {
      other.classList.remove('selected');
      other.setAttribute('aria-selected', 'false');
    }
    li.classList.add('selected');
    li.setAttribute('aria-selected', 'true');
  });
  li.addEventListener('dblclick', () => insertPresetAt(p));

  const head = document.createElement('div');
  head.className = 'preset-item-head';
  const name = document.createElement('b');
  name.textContent = p.name;
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = `${p.type}${p.source === 'builtin' ? ' · 기본 제공' : ''}`;
  head.append(name, tag);

  // sandbox iframe: 프리셋 html 의 스크립트/핸들러 실행 차단(자기-XSS 방지).
  // 기본은 물리 제거본(§3.1) — "정답 보기" 토글 시에만 원본.
  const preview = document.createElement('iframe');
  preview.className = 'preset-preview';
  preview.setAttribute('sandbox', '');
  preview.srcdoc = previewSrcdoc(p, { showAnswer: presetShowAnswer, styles: shellStyles });

  const actions = document.createElement('div');
  actions.className = 'preset-actions';
  const insertBtn = document.createElement('button');
  insertBtn.className = 'insert';
  insertBtn.textContent = '삽입';
  insertBtn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // iframe 선택(커서 블록) 유지
    insertPresetAt(p);
  });
  const delBtn = document.createElement('button');
  delBtn.textContent = p.source === 'builtin' ? '숨기기' : '삭제';
  delBtn.addEventListener('click', async () => {
    await fetch(`/presets/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    await refreshPresets();
  });
  actions.append(insertBtn, delBtn);

  li.append(head, preview, actions);
  return li;
}

async function savePresetFlow() {
  const doc = frames.teacher?.contentDocument;
  const payload = doc ? extractPresetFromSelection(doc) : null;
  if (!payload) {
    showBanner('warn', '저장할 블록 안에 커서를 두고 다시 시도하세요.');
    return null;
  }
  const name = window.prompt('프리셋 이름을 입력하세요:');
  if (!name || !name.trim()) return null; // 취소/빈 이름 = 미저장(확정 결정)
  const res = await fetch('/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...payload }),
  });
  if (!res.ok) {
    showBanner('error', `프리셋 저장 실패 (HTTP ${res.status})`);
    return null;
  }
  const saved = await res.json();
  showBanner('ok', `프리셋 저장됨: ${saved.name} — 다른 문서에서도 재사용됩니다.`);
  await refreshPresets();
  return saved;
}

document.getElementById('tb-preset-save').addEventListener('mousedown', (e) => {
  e.preventDefault(); // iframe 선택 유지(커서 블록 추출에 필요)
  savePresetFlow();
});
/** 프리셋 탭을 처음 열 때만 목록을 받아온다. */
async function refreshPresetsOnce() {
  if (!presetCache) await refreshPresets();
}
document.getElementById('tb-preset-lib').addEventListener('click', async () => {
  showLeftTab('tab-presets');
  await refreshPresetsOnce();
});
document.getElementById('preset-show-answer').addEventListener('change', (e) => {
  presetShowAnswer = e.target.checked;
  renderPresetPanel();
});

// ── E5 AI 액션(구독 AI 브리지 — 무API) ──
const aiBar = document.getElementById('ai-bar');
const aiStatusEl = document.getElementById('ai-status');
const aiCancelBtn = document.getElementById('ai-cancel');
const aiResumeBtn = document.getElementById('ai-resume');
const aiUndoBtn = document.getElementById('ai-undo');
const aiCopyBtn = document.getElementById('ai-copy');
const aiDiff = document.getElementById('ai-diff');
let aiActive = null; // { id, poll } — 진행 중 요청(문서당 1개 흐름)
let aiPendingId = null; // 지시문 복사 대상 요청 id
let aiApplied = null; // { target, snapshot } — 되돌리기(저장 전까지)

function aiContext() {
  const m = shell.manifest ?? {};
  return {
    subject: m.subject || '',
    docTitle: shell.docTitle || '',
    theme: m.theme || '',
    // 성취기준 원문은 읽기 전용 품질 컨텍스트 — AI 는 블록 본문만 재작성한다(§7 창작 금지).
    standards: (m.standards ?? []).map((code) => ({ code, text: m.standardsText?.[code] ?? '' })),
  };
}

function aiShow(text, { cancel = false, resume = false, undo = false, copy = false } = {}) {
  aiBar.classList.remove('hidden');
  aiStatusEl.textContent = text;
  aiCancelBtn.classList.toggle('hidden', !cancel);
  aiResumeBtn.classList.toggle('hidden', !resume);
  aiUndoBtn.classList.toggle('hidden', !undo);
  aiCopyBtn.classList.toggle('hidden', !copy);
}

/**
 * AI 세션에 그대로 붙여넣을 지시문. 무API(§3.5) 설계에서 응답 주체는 사람이 아니라
 * 이 편집창을 띄운 구독 AI 세션이므로, 사용자가 "무엇을 시켜야 하는지"를 문장째 넘긴다.
 */
function aiInstruction(id) {
  return [
    `worksheet-grab 편집창(문서: ${shell.docName ?? shell.docTitle ?? ''})에서 AI 요청을 보냈어. 처리해줘:`,
    `1) worksheet-grab ai pending --json 으로 ${id} 요청의 블록 html 을 읽어.`,
    '2) 각 블록을 활동지 맥락에 맞게 재작성하고 [{"slot":<슬롯번호>,"html":"<재작성 HTML>"}] 배열 JSON 파일로 저장해.',
    `3) worksheet-grab ai respond ${id} --blocks <저장한 파일 경로> 로 응답해.`,
    '주의: 성취기준 원문과 저작권 지문은 고치지 말고, 블록의 구조·클래스는 유지해.',
  ].join('\n');
}

function aiHide() {
  aiBar.classList.add('hidden');
  aiPendingId = null;
}

function updateAiButtons() {
  const doc = frames.teacher?.contentDocument;
  // 선택 집합 기준: 집합 중 하나라도 제외 타입이면 버튼 비활성(범위 선택 시 부분 요청 차단 예고).
  const blocks = doc ? selectedBlocks(doc) : [];
  const excluded = blocks.some((b) => (shell.excludedAiTypes ?? []).includes(b.dataset.bt || 'content'));
  for (const id of ['tb-ai-rewrite', 'tb-ai-fill']) {
    const btn = document.getElementById(id);
    // baseTitle 은 덮어쓰기 전에 원본을 캡처해야 한다 — 첫 selectionchange 가
    // 제외 블록에서 나면 가드 문구가 기본 툴팁으로 오염되던 버그의 수정.
    if (!btn.dataset.baseTitle) btn.dataset.baseTitle = btn.title;
    btn.disabled = excluded;
    btn.title = excluded
      ? '성취기준 원문·저작권 지문 블록은 AI 대상이 아닙니다(보존).'
      : btn.dataset.baseTitle;
  }
}

async function startAiFlow(action) {
  const doc = frames.teacher?.contentDocument;
  if (!doc || aiActive) {
    if (aiActive) aiShow(`이미 진행 중인 AI 요청이 있습니다 (${aiActive.id}).`, { cancel: true });
    return;
  }
  const result = await requestAiAction(doc, {
    action, context: aiContext(), excluded: shell.excludedAiTypes ?? [],
  });
  if (result.error) {
    showBanner('warn', result.error);
    return;
  }
  await waitForAi(result.id);
}

async function waitForAi(id) {
  const poll = pollResponse(id);
  aiActive = { id, poll };
  aiPendingId = id;
  aiShow(
    `🤖 AI 응답 대기 중 (${id}) — 이 편집창을 띄운 AI 세션이 응답해야 반영됩니다(무API 설계). `
    + '아래 "AI 지시문 복사"를 눌러 AI 세션에 붙여넣으세요.',
    { cancel: true, copy: true });
  let outcome;
  try {
    outcome = await poll.promise;
  } catch (e) {
    // 폴링 자체가 죽으면(서버 중단 등) 대기 UI 가 영구 고착되던 문제의 방지선.
    if (aiActive?.id === id) aiActive = null;
    aiShow(`폴링 실패 (${e.message}) — 요청은 유지됩니다. 서버 확인 후 재개하세요.`, { resume: true });
    aiResumeBtn.onclick = () => waitForAi(id);
    return;
  }
  if (aiActive?.id !== id) return; // 취소 등으로 흐름 교체됨
  aiActive = null;
  const doc = frames.teacher?.contentDocument;
  if (outcome.status === 'answered') {
    showAiDiff(id, outcome.response);
  } else if (outcome.status === 'timeout') {
    aiShow(`대기 중단 (${id}) — 요청은 살아 있습니다. AI 세션에 지시문을 전달한 뒤 재개하세요.`,
      { resume: true, copy: true });
    aiResumeBtn.onclick = () => waitForAi(id);
  } else if (outcome.status === 'cancelled' || outcome.status === 'gone') {
    if (doc) clearAiMarker(doc, id);
    aiHide();
  }
}

function showAiDiff(id, response) {
  const doc = frames.teacher.contentDocument;
  // 결합 뷰: 슬롯별 현재본(before) vs 응답본(after)을 한 미리보기로(다중 블록). 슬롯 규칙은 apply 와 공유.
  const { before, after, count } = aiDiffView(doc, id, response);
  document.getElementById('ai-diff-before').srcdoc = previewSrcdoc({ html: before }, { showAnswer: true, styles: shellStyles });
  document.getElementById('ai-diff-after').srcdoc = previewSrcdoc({ html: after }, { showAnswer: true, styles: shellStyles });
  aiDiff.classList.remove('hidden');
  aiShow(`AI 응답 도착 (${id}) — ${count}블록 미리보기를 확인하고 적용/폐기하세요.`);
  document.getElementById('ai-apply').onclick = async () => {
    // 통합 스택에도 한 단계로 올린다 — 전용 "AI 적용 되돌리기" 버튼과 별개로
    // Ctrl+Z 로도 풀려야 사용자가 되돌리기 수단을 헷갈리지 않는다.
    const applied = history.run(() => applyAiResponse(doc, id, response)); // 슬롯 재부착 + DOMParser 정제
    aiDiff.classList.add('hidden');
    if (!applied) { aiShow('AI 응답이 비어 있습니다.'); return; } // null = 빈/비정상 응답
    if (applied.applied === 0) {
      // 전 슬롯 소실(대상 블록이 대기 중 모두 삭제됨) → 요청을 terminal(cancel)로 정리(스테일 방지).
      await fetch(`/ai/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {});
      clearAiMarker(doc, id);
      aiHide();
      showBanner('warn', `AI 대상 블록이 모두 삭제되어 적용할 수 없습니다(${applied.missing}개 슬롯). 요청을 정리했습니다.`);
      document.body.dataset.aiApplied = 'all-missing';
      return;
    }
    aiApplied = applied;
    await fetch(`/ai/${encodeURIComponent(id)}/applied`, { method: 'POST' });
    onEdit();
    const warn = applied.missing > 0 ? ` (경고: ${applied.missing}개 블록 소실 — 해당 슬롯 skip)` : '';
    aiShow(`AI 재작성이 ${applied.applied}블록에 적용되었습니다${warn}. 저장 전까지 되돌릴 수 있습니다.`, { undo: true });
    document.body.dataset.aiApplied = 'true';
  };
  document.getElementById('ai-discard').onclick = async () => {
    aiDiff.classList.add('hidden');
    await fetch(`/ai/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {});
    clearAiMarker(doc, id);
    aiHide();
  };
}

aiCopyBtn.addEventListener('click', async () => {
  if (!aiPendingId) return;
  const text = aiInstruction(aiPendingId);
  try {
    await navigator.clipboard.writeText(text);
    showBanner('ok', 'AI 지시문을 복사했습니다 — AI 세션(Claude/Codex 등)에 붙여넣으세요.');
  } catch {
    // 클립보드 권한이 없을 때도 길을 막지 않는다 — 직접 복사할 수 있게 보여준다.
    window.prompt('아래 지시문을 복사해 AI 세션에 붙여넣으세요:', text);
  }
});
aiCancelBtn.addEventListener('click', async () => {
  if (!aiActive) return;
  const { id, poll } = aiActive;
  aiActive = null;
  poll.stop();
  await fetch(`/ai/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {});
  const doc = frames.teacher?.contentDocument;
  if (doc) clearAiMarker(doc, id);
  aiHide();
});
aiUndoBtn.addEventListener('click', () => {
  if (history.run(() => undoAiApply(aiApplied))) {
    aiApplied = null;
    onEdit();
    aiHide();
    showBanner('ok', 'AI 적용을 되돌렸습니다.');
  }
});
document.getElementById('tb-ai-rewrite').addEventListener('mousedown', (e) => { e.preventDefault(); startAiFlow('rewrite'); });
document.getElementById('tb-ai-fill').addEventListener('mousedown', (e) => { e.preventDefault(); startAiFlow('fill-example'); });

// ── E6 내보내기 통합: dirty-gate save-first · 포맷 프리셋 · 정밀 미리보기 · PDF export ──
// "저장이 곧 게이트" — 세 흐름 모두 저장본만 대상으로 한다. save-first 는 dirty 일 때만
// /save 왕복(A5)하고, 실패하면 진행을 중단한다(A6 — 게이트 우회 봉쇄).
async function saveFirst(what) {
  if (!dirty) return true;
  const result = await save();
  if (result == null) {
    showBanner('error', `저장 실패 — ${what}을(를) 중단했습니다.`);
    return false;
  }
  return true;
}

const paperSelect = document.getElementById('paper-preset');
const paperAdv = document.getElementById('paper-adv');

function initPaperSelect() {
  paperSelect.replaceChildren(
    ...PAPER_PRESETS.map((p) => new Option(p.label, p.id)),
    new Option('고급(자유 조합)…', 'custom'),
  );
  paperSelect.value = matchPreset(baseManifest.paper ?? null);
  document.body.dataset.paperPreset = paperSelect.value;
}

async function applyPaper(paper) {
  // 용지 변경 = manifest 레벨 영속 변이 → 저장(게이트) 후 서버가 SaveDocument 로 재저장.
  if (!(await saveFirst('용지 변경'))) { initPaperSelect(); return; }
  let res;
  try {
    res = await fetch('/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper }),
    });
  } catch (e) {
    showBanner('error', `용지 변경 실패: ${e.message}`);
    initPaperSelect();
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    showBanner('error', `용지 변경 실패: ${body.error ?? `HTTP ${res.status}`}`);
    initPaperSelect();
    return;
  }
  if (body.noop) { showBanner('ok', '용지가 이미 해당 설정입니다.'); return; }
  // 전체 재페이지네이션: 용지 변경은 치수·@page·리플로우가 모두 바뀌므로
  // E3 "저장 후 iframe 유지" 원칙의 명시적 예외 — 셸 재로드가 필수다.
  location.reload();
}

paperSelect.addEventListener('change', () => {
  if (paperSelect.value === 'custom') {
    const cur = shell.canvasMeta.paper;
    document.getElementById('adv-size').value = cur.size;
    document.getElementById('adv-orient').value = cur.orientation;
    document.getElementById('adv-columns').value = String(cur.columns ?? 1);
    paperAdv.classList.remove('hidden');
    return;
  }
  const preset = PAPER_PRESETS.find((p) => p.id === paperSelect.value);
  if (preset) applyPaper(preset.paper);
});
document.getElementById('adv-apply').addEventListener('click', () => {
  const paper = {
    size: document.getElementById('adv-size').value,
    orientation: document.getElementById('adv-orient').value,
  };
  const margins = document.getElementById('adv-margins').value.trim();
  if (margins) paper.margins = margins;
  // columns 1 은 키 미부여(현행 최소 paper 객체 보존) — resolvePaper 가 기본 1 로 정규화.
  const columns = Number(document.getElementById('adv-columns').value);
  if (columns > 1) paper.columns = columns;
  paperAdv.classList.add('hidden');
  applyPaper(paper);
});
document.getElementById('adv-close').addEventListener('click', () => {
  paperAdv.classList.add('hidden');
  initPaperSelect();
});
initPaperSelect();

const previewPanel = document.getElementById('preview-panel');
const previewImg = document.getElementById('preview-img');
const previewSpinner = document.getElementById('preview-spinner');

document.getElementById('btn-preview').addEventListener('click', async () => {
  if (!(await saveFirst('정밀 미리보기'))) return;
  previewPanel.classList.remove('hidden');
  previewSpinner.classList.remove('hidden');
  previewImg.classList.add('hidden');
  let res;
  try {
    res = await fetch(`/preview.png?mode=${mode}&t=${Date.now()}`);
  } catch (e) {
    previewSpinner.textContent = `미리보기 실패: ${e.message}`;
    return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    previewSpinner.textContent = `미리보기 실패: ${body.message ?? body.error ?? `HTTP ${res.status}`}`;
    return;
  }
  if (previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src); // 반복 미리보기 누수 방지
  previewImg.src = URL.createObjectURL(await res.blob());
  previewSpinner.classList.add('hidden');
  previewImg.classList.remove('hidden');
  document.body.dataset.previewShown = 'true';
});
document.getElementById('preview-close').addEventListener('click', () => previewPanel.classList.add('hidden'));

const exportBtn = document.getElementById('btn-export');
exportBtn.addEventListener('click', async () => {
  if (!(await saveFirst('PDF 내보내기'))) return;
  exportBtn.disabled = true;
  showBanner('warn', 'PDF 렌더 중… (백그라운드 Chrome · 수 초~30초)');
  let res;
  try {
    res = await fetch('/export', { method: 'POST' });
  } catch (e) {
    showBanner('error', `내보내기 실패: ${e.message}`);
    exportBtn.disabled = false;
    return;
  }
  const body = await res.json().catch(() => ({}));
  exportBtn.disabled = false;
  if (!res.ok) {
    showBanner('error', `내보내기 실패: ${body.message ?? body.error ?? `HTTP ${res.status}`}`);
    return;
  }
  const paths = body.rendered.map((r) => r.path).join(' · ');
  if (body.skipped?.student) {
    showBanner('warn', `⚠ 교사용 PDF 만 생성: ${paths} — ${body.reason}`);
  } else {
    showBanner('ok', `PDF 2벌 생성: ${paths}`);
  }
  document.body.dataset.exportDone = String(body.rendered.length);
  document.body.dataset.exportStudentSkipped = String(body.skipped?.student ?? '');
});

for (const w of shell.warnings ?? []) {
  const li = document.createElement('li');
  li.className = 'warning';
  li.textContent = `⚠ ${w}`;
  listEl.appendChild(li);
}

buildShapePopover();

// 초기 모드: 기본 교사용, #student 해시로 학생용 시작(딥링크·게이트 테스트용).
await setMode(location.hash === '#student' ? 'student' : 'teacher');
renderInspector();

// ── 시드 훅(렌더 테스트 전용): 서버가 testSeed 로 기동됐을 때만 활성 ──
if (shell.testSeed === true) {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) await runSeed(seed);
}

/** 시드 공용: 블록 내 첫 긴 텍스트 노드를 선택하고 그 노드를 돌려준다. */
function selectFirstLongText(doc, block, minLen = 10) {
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let target = null;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.trim().length >= minLen) { target = walker.currentNode; break; }
  }
  if (!target) return null;
  const range = doc.createRange();
  range.selectNodeContents(target);
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return target;
}

async function runSeed(seed) {
  const doc = frames.teacher.contentDocument;
  const firstQuestion = [...doc.querySelectorAll('.wg-block')]
    .find((w) => (w.textContent ?? '').trim().length > 20) ?? doc.querySelector('.wg-block');

  if (seed === 'answer-mark') {
    // 블록 내 첫 긴 텍스트 노드를 세션 정답 마크로 감싼 뒤 저장 → student 물리 제거 검증.
    const walker = doc.createTreeWalker(firstQuestion, NodeFilter.SHOW_TEXT);
    let target = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim().length >= 10) { target = walker.currentNode; break; }
    }
    const range = doc.createRange();
    range.selectNodeContents(target);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const markedText = target.textContent.trim();
    toggleAnswerMark(doc);
    const result = await save();
    document.body.dataset.studentHasAnswer = String(deriveStudentHtml().includes(markedText));
    document.body.dataset.savedUnsafe = String(result?.unsafe ?? 'null');
  } else if (seed === 'ans-line') {
    insertAnswerLines(doc, 5);
    await save();
    document.body.dataset.ansLines = String(doc.querySelectorAll('.wg-block .ans-line').length);
  } else if (seed === 'shrink-font') {
    // 6pt(최소 8pt 미만) 적용 → 즉시 경고(§6 ④). 저장 불필요 — 라이브 예고 검증.
    const walker = doc.createTreeWalker(firstQuestion, NodeFilter.SHOW_TEXT);
    walker.nextNode();
    const range = doc.createRange();
    range.selectNodeContents(walker.currentNode);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    applyFontSizeDirect(doc, 6);
    recompute(mode);
  } else if (seed === 'overflow') {
    insertAnswerLines(doc, 60); // 페이지 바닥 초과 유발 → 빨강 배지(§6 ⑤)
    fitFrame(frames.teacher);
    drawGuides();
  } else if (seed === 'save-preset') {
    // E4 ①: 커서 블록을 프리셋으로 저장(프롬프트 없이 결정적 이름) → 목록 등장·정제 계측
    const range = doc.createRange();
    range.selectNodeContents(firstQuestion);
    range.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const payload = extractPresetFromSelection(doc);
    const res = await fetch('/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '시드 프리셋', ...payload }),
    });
    const saved = await res.json();
    const list = await (await fetch('/presets')).json();
    document.body.dataset.presetSaved = String(list.presets.some((p) => p.id === saved.id));
    document.body.dataset.presetClean = String(!/data-wg-mark|contenteditable=/.test(payload.html));
  } else if (seed === 'ai-request') {
    // E5 ①: 커서 블록으로 AI 요청 발신 → 마커·서버 pending 계측
    const range = doc.createRange();
    range.selectNodeContents(firstQuestion);
    range.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const result = await requestAiAction(doc, { action: 'rewrite', context: aiContext(), excluded: shell.excludedAiTypes ?? [] });
    document.body.dataset.aiRequestId = result.id ?? '';
    // 단일 선택도 슬롯 마커(<id>#0)로 스탬프된다(v2 통일).
    document.body.dataset.aiMarkerSet = String(!!(result.id && doc.querySelector(`[data-ai-req="${CSS.escape(`${result.id}#0`)}"]`)));
    document.body.dataset.aiServerStatus = result.id
      ? (await (await fetch(`/ai/${encodeURIComponent(result.id)}`)).json()).status
      : 'error';
  } else if (seed === 'ai-guard') {
    // E5 ②: 제외 타입(standard-label) 블록에서 요청 시도 → 클라이언트 가드 차단 계측
    const guarded = [...doc.querySelectorAll('.wg-block')].find((w) => w.dataset.bt === 'standard-label');
    const range = doc.createRange();
    range.selectNodeContents(guarded);
    range.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    updateAiButtons();
    const result = await requestAiAction(doc, { action: 'rewrite', context: aiContext(), excluded: shell.excludedAiTypes ?? [] });
    document.body.dataset.aiGuardBlocked = String(!!result.error);
    document.body.dataset.aiGuardButtonDisabled = String(document.getElementById('tb-ai-rewrite').disabled);
  } else if (seed === 'ai-apply') {
    // E5 ③: 사전 준비된 요청/응답(id 는 ?req=)을 폴링→정제→적용→저장까지 왕복 계측
    const id = new URLSearchParams(location.search).get('req');
    firstQuestion.setAttribute('data-ai-req', id); // 테스트가 서버로 만든 요청의 대상 스탬프
    const outcome = await pollResponse(id).promise;
    if (outcome.status === 'answered') {
      const applied = applyAiResponse(doc, id, outcome.html);
      await fetch(`/ai/${encodeURIComponent(id)}/applied`, { method: 'POST' });
      const serialized = firstQuestion.innerHTML;
      document.body.dataset.aiXssClean = String(!/(<script|onerror=|javascript:)/i.test(serialized));
      document.body.dataset.aiMarkerClean = String(!doc.querySelector('[data-ai-req]'));
      const saveResult = await save();
      document.body.dataset.aiApplied = String(!!applied && saveResult != null);
    } else {
      document.body.dataset.aiApplied = `poll:${outcome.status}`;
    }
  } else if (seed === 'ai-multi-request') {
    // F4 ①: 인접 비제외 블록 2개 선택 → v2 요청 발신(blocks[] 스탬프·서버 blocks 계측).
    const all = [...doc.querySelectorAll('.wg-block')];
    const isExcluded = (w) => (shell.excludedAiTypes ?? []).includes(w.dataset.bt || 'content');
    let pair = null;
    for (let i = 0; i + 1 < all.length; i++) {
      if (!isExcluded(all[i]) && !isExcluded(all[i + 1])) { pair = [all[i], all[i + 1]]; break; }
    }
    const range = doc.createRange();
    range.setStartBefore(pair[0]);
    range.setEndAfter(pair[1]);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const result = await requestAiAction(doc, { action: 'rewrite', context: aiContext(), excluded: shell.excludedAiTypes ?? [] });
    document.body.dataset.aiRequestId = result.id ?? '';
    document.body.dataset.aiSelCount = String(result.blocks?.length ?? 0);
    document.body.dataset.aiMarker0 = String(!!(result.id && doc.querySelector(`[data-ai-req="${CSS.escape(`${result.id}#0`)}"]`)));
    document.body.dataset.aiMarker1 = String(!!(result.id && doc.querySelector(`[data-ai-req="${CSS.escape(`${result.id}#1`)}"]`)));
    document.body.dataset.aiServerStatus = result.id
      ? (await (await fetch(`/ai/${encodeURIComponent(result.id)}`)).json()).status
      : 'error';
  } else if (seed === 'ai-multi-apply') {
    // F4 ②: 사전 준비된 v2 요청/응답(id=?req)을 슬롯 마커로 스탬프 → 순서 뒤집기 →
    // 폴링→슬롯 재부착(위치 매칭 아님)→적용→저장. 순서가 바뀌어도 슬롯별 정확 재부착 계측.
    const id = new URLSearchParams(location.search).get('req');
    const isExcluded = (w) => (shell.excludedAiTypes ?? []).includes(w.dataset.bt || 'content');
    const targets = [...doc.querySelectorAll('.wg-block')].filter((w) => !isExcluded(w)).slice(0, 2);
    targets[0].setAttribute('data-ai-req', `${id}#0`);
    targets[1].setAttribute('data-ai-req', `${id}#1`);
    // 순서 변경: 슬롯1 블록을 슬롯0 블록 앞으로 이동(위치 매칭이면 여기서 어긋난다 — 슬롯 재부착은 불변).
    targets[0].parentNode.insertBefore(targets[1], targets[0]);
    const outcome = await pollResponse(id).promise;
    const applied = applyAiResponse(doc, id, outcome.response);
    await fetch(`/ai/${encodeURIComponent(id)}/applied`, { method: 'POST' });
    document.body.dataset.aiMultiApplied = String(applied?.applied ?? 0);
    document.body.dataset.aiMultiMarkerClean = String(!doc.querySelector('[data-ai-req]'));
    document.body.dataset.aiSlot0Correct = String(targets[0].innerHTML.includes('SLOT0-AI') && !targets[0].innerHTML.includes('SLOT1-AI'));
    document.body.dataset.aiSlot1Correct = String(targets[1].innerHTML.includes('SLOT1-AI') && !targets[1].innerHTML.includes('SLOT0-AI'));
    document.body.dataset.aiXssClean = String(!/(<script|onerror=|javascript:)/i.test(targets[0].innerHTML + targets[1].innerHTML));
    const saveResult = await save();
    document.body.dataset.aiMultiSaved = String(saveResult != null && saveResult.unsafe === false);
  } else if (seed === 'ai-multi-guard') {
    // F4 ③: 선택 집합에 제외 타입(standard-label) 포함 → 전체 거부(부분 요청 금지).
    const all = [...doc.querySelectorAll('.wg-block')];
    const guarded = all.find((w) => w.dataset.bt === 'standard-label');
    const gi = all.indexOf(guarded);
    const other = all[gi + 1] || all[gi - 1];
    const [first, last] = all.indexOf(guarded) < all.indexOf(other) ? [guarded, other] : [other, guarded];
    const range = doc.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    updateAiButtons();
    const result = await requestAiAction(doc, { action: 'rewrite', context: aiContext(), excluded: shell.excludedAiTypes ?? [] });
    document.body.dataset.aiMultiGuardBlocked = String(!!result.error);
    document.body.dataset.aiMultiGuardButtonDisabled = String(document.getElementById('tb-ai-rewrite').disabled);
  } else if (seed === 'ai-all-missing') {
    // team-fix ⑥: 슬롯 마커 스탬프 → 대상 블록 전부 삭제(대상 소실) → 적용은 applied:0/missing:n 반환,
    // 흐름은 요청을 terminal(cancel)로 정리(pending/응답 스테일 방지) 계측.
    const id = new URLSearchParams(location.search).get('req');
    const isExcluded = (w) => (shell.excludedAiTypes ?? []).includes(w.dataset.bt || 'content');
    const targets = [...doc.querySelectorAll('.wg-block')].filter((w) => !isExcluded(w)).slice(0, 2);
    targets.forEach((w, k) => w.setAttribute('data-ai-req', `${id}#${k}`));
    targets.forEach((w) => w.remove()); // 대상 전부 삭제
    const outcome = await pollResponse(id).promise;
    const applied = applyAiResponse(doc, id, outcome.response);
    document.body.dataset.aiAllMissingApplied = String(applied?.applied ?? 'null');
    document.body.dataset.aiAllMissingMissing = String(applied?.missing ?? 'null');
    if (applied && applied.applied === 0) {
      await fetch(`/ai/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {});
      clearAiMarker(doc, id);
    }
    document.body.dataset.aiAllMissingStatus = (await (await fetch(`/ai/${encodeURIComponent(id)}`)).json()).status;
  } else if (seed === 'export-ui') {
    // E6: UI 배선 계측(버튼·프리셋 선택기·A5 dirty-gate) — 중첩 Chrome 렌더 무발화.
    // 실제 PDF/PNG 실측은 export.render.test.js(서버·CLI 직접 호출)가 담당한다.
    document.body.dataset.e6Buttons =
      String(!!(document.getElementById('btn-export') && document.getElementById('btn-preview')));
    document.body.dataset.paperOptions = String(paperSelect.options.length);
    document.body.dataset.paperPresetValue = paperSelect.value;
    const revBefore = currentRevision;
    const ok = await saveFirst('계측'); // 비-dirty → /save 무왕복(A5)·리비전 불변
    document.body.dataset.saveFirstNoop = String(ok === true && currentRevision === revBefore);
  } else if (seed === 'insert-preset') {
    // E4 ②: 라이브러리 첫 항목 삽입 → 저장 → manifest 반영 계측(블록 수 +1)
    const list = await (await fetch('/presets')).json();
    const first = list.presets[0];
    const blocksBefore = baseManifest.pages.flat().length;
    insertPreset(doc, first);
    const result = await save();
    document.body.dataset.presetInserted =
      String(result != null && baseManifest.pages.flat().length === blocksBefore + 1);
    document.body.dataset.insertedType = first.type;
  } else if (seed === 'columns-roundtrip') {
    // F2 왕복 게이트: 다단(columns>1) 문서에서 편집 없이 serializeSheets→resync 왕복이
    // 구조를 보존하는지 실 Chrome 계측. .sheet-body(다단 래퍼)를 leftover 로 오포집하면
    // structureWarning=true·블록수 급증으로 즉시 드러난다(F2.4 투명 통과 검증).
    const sheets = serializeSheets();
    const { manifest, structureWarning } = resyncManifest(sheets, baseManifest);
    document.body.dataset.rtStructureWarning = String(structureWarning);
    document.body.dataset.rtPages = String(manifest.pages.length);
    document.body.dataset.rtBlocks = String(manifest.pages.flat().length);
    document.body.dataset.rtBaseBlocks = String(baseManifest.pages.flat().length);
    document.body.dataset.rtSheetBodyCount = String(doc.querySelectorAll('.sheet-body').length);
  } else if (seed === 'image-insert') {
    // F1: PNG 업로드→커서 블록에 40mm img 삽입(마킹 없음)→저장. GET 200·manifest 반영·student 존재 계측.
    const up = await (await fetch(`/assets?name=${encodeURIComponent('시드샷.png')}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: seedPngBytes(),
    })).json();
    document.body.dataset.assetPath = up.path || '';
    document.body.dataset.assetGet = String((await fetch(`/${up.path}`)).status);
    const img = doc.createElement('img');
    img.src = up.path;
    img.style.width = '40mm';
    firstQuestion.appendChild(img);
    const result = await save();
    document.body.dataset.savedUnsafe = String(result?.unsafe ?? 'null');
    const mstr = JSON.stringify(baseManifest.pages);
    document.body.dataset.manifestHasImg = String(mstr.includes(up.path));
    document.body.dataset.manifestHasWidth = String(mstr.includes('40mm'));
    document.body.dataset.studentHasImg = String(deriveStudentHtml().includes(up.path));
  } else if (seed === 'image-answer') {
    // F1: 업로드 img 를 ⭐정답 마킹(요소 선택)→저장. student 물리 부재·teacher manifest 잔존 계측.
    const up = await (await fetch(`/assets?name=${encodeURIComponent('정답샷.png')}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: seedPngBytes(),
    })).json();
    const img = doc.createElement('img');
    img.src = up.path;
    img.style.width = '50mm';
    firstQuestion.appendChild(img);
    selectImageEl(img);
    toggleAnswerMark(doc);
    document.body.dataset.imgWrappedAnswer = String(!!img.closest('.answer'));
    const result = await save();
    document.body.dataset.savedUnsafe = String(result?.unsafe ?? 'null');
    document.body.dataset.studentHasAnsImg = String(deriveStudentHtml().includes(up.path));
    document.body.dataset.teacherHasAnsImg = String(JSON.stringify(baseManifest.pages).includes(up.path));
  } else if (seed === 'thumbs') {
    // US-E1: 썸네일 개수·번호·클릭 이동·스크롤 동기화·편집 반영을 한 시드에서 계측.
    const list = document.getElementById('thumb-list');
    const thumbEls = () => [...list.querySelectorAll('.thumb')];
    const srcOf = (i) => list.querySelectorAll('.thumb iframe')[i]?.srcdoc ?? '';
    document.body.dataset.thumbLabels = thumbEls().map((t) => t.querySelector('.thumb-no').textContent).join(',');
    document.body.dataset.thumbSheets = String(doc.querySelectorAll('.sheet').length);

    // 클릭 이동: 마지막 쪽으로 점프하면 스크롤이 내려가고 그 쪽이 활성이 된다.
    const last = thumbEls().length - 1;
    document.body.dataset.thumbScrollable = String(canvasWrap.scrollHeight > canvasWrap.clientHeight);
    scrollToSheet(last, { smooth: false }); // 가상 시간에서 smooth 는 계측 전에 끝나지 않는다
    await new Promise((r) => setTimeout(r, 300));
    syncActiveThumb();
    document.body.dataset.thumbJumpScroll = String(Math.round(canvasWrap.scrollTop));
    document.body.dataset.thumbJumpActive = String(document.body.dataset.thumbActive);

    canvasWrap.scrollTo({ top: 0 });
    await new Promise((r) => setTimeout(r, 300));
    syncActiveThumb();
    document.body.dataset.thumbTopActive = String(document.body.dataset.thumbActive);

    // 편집 반영: 1쪽에 표식을 넣으면 1쪽 썸네일만 바뀐다.
    const MARK = 'ZZTHUMB';
    const before0 = srcOf(0);
    const beforeLast = srcOf(last);
    const target = selectFirstLongText(doc, firstQuestion);
    const caret = doc.createRange();
    caret.setStart(target, target.textContent.length);
    caret.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(caret);
    doc.execCommand('insertText', false, MARK);
    await new Promise((r) => setTimeout(r, 900)); // onEdit 디바운스(250ms) + 렌더
    document.body.dataset.thumbEditSynced = String(srcOf(0) !== before0 && srcOf(0).includes(MARK));
    document.body.dataset.thumbOtherPageUntouched = String(srcOf(last) === beforeLast);
  } else if (seed === 'shapes') {
    // US-E3: 삽입(앵커) · 서식 변경 · 드래그 1:1 · 되돌리기 · 저장 왕복.
    const range = doc.createRange();
    range.selectNodeContents(firstQuestion);
    range.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    addShape('circle');
    await new Promise((r) => setTimeout(r, 200));
    const shape = doc.querySelector('.wg-shape');
    document.body.dataset.shapeKind = shape?.dataset.shape ?? '';
    // 앵커: 도형이 커서가 있던 블록 안의 .wg-shape-layer 에 들어간다
    document.body.dataset.shapeAnchored =
      String(!!shape?.closest('.wg-shape-layer')?.parentElement?.classList.contains('wg-block'));
    document.body.dataset.shapeInCursorBlock = String(shape?.closest('.wg-block') === firstQuestion);

    // 서식 변경 즉시 반영(계산값으로 확인 — 인라인 문자열이 아니라 실제 렌더 결과).
    // 실제 UI 처럼 컨트롤 단위로 따로 건다 — 그래야 되돌리기도 조작 단위로 풀린다.
    patchShape({ stroke: '#d1495b' });
    patchShape({ dash: '6 4' });
    patchShape({ strokeWidth: 3 });
    patchShape({ widthMm: 40 });
    await new Promise((r) => setTimeout(r, 200));
    const child = shape.firstElementChild;
    const cs = doc.defaultView.getComputedStyle(child);
    document.body.dataset.shapeStroke = cs.stroke;
    document.body.dataset.shapeDash = cs.strokeDasharray;
    document.body.dataset.shapeWidthPx = String(Math.round(shape.getBoundingClientRect().width));

    // 되돌리기: 폭 변경만 취소되고 선 색은 남는다(명령 단위 1단계)
    history.undo();
    await new Promise((r) => setTimeout(r, 200));
    document.body.dataset.shapeUndoWidth = doc.querySelector('.wg-shape')?.style.width ?? '';
    document.body.dataset.shapeUndoStroke =
      doc.defaultView.getComputedStyle(doc.querySelector('.wg-shape').firstElementChild).stroke;

    // 드래그 1:1 — pointerdown 은 iframe, pointermove 는 부모라 좌표계를 섞으면 튄다
    // 이벤트를 도형(=포인터 캡처 대상)으로 보낸다. 예전 시드는 부모 window 로 쐈는데,
    // 그건 실제 마우스와 다르다 — 진짜 드래그에서 pointermove 는 커서가 올라가 있는
    // iframe 으로 가지 부모로 가지 않는다. 그래서 window 로 쏘던 시드는 "부모에서만
    // 듣던" 버그를 통과시켰고, 실사용에서는 도형이 0mm 움직였다(사용자 신고).
    const s2 = doc.querySelector('.wg-shape');
    const beforeLeft = parseFloat(s2.style.left);
    const ev = (type, sx, sy) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, screenX: sx, screenY: sy, clientX: sx, clientY: sy });
    s2.dispatchEvent(ev('pointerdown', 500, 400));
    s2.dispatchEvent(ev('pointermove', 540, 400));
    s2.dispatchEvent(ev('pointerup', 540, 400));
    await new Promise((r) => setTimeout(r, 200));
    document.body.dataset.shapeDragDeltaMm =
      String(Math.round((parseFloat(doc.querySelector('.wg-shape').style.left) - beforeLeft) * 10) / 10);
    document.body.dataset.shapeDragExpectMm = String(Math.round((40 / MM_TO_PX) * 10) / 10);

    // 저장 왕복 — manifest 와 student 파생 양쪽에 남는가
    const saved = await save();
    document.body.dataset.shapeSaved = String(saved != null);
    document.body.dataset.shapeInManifest =
      String(JSON.stringify(baseManifest.pages).includes('wg-shape'));
    document.body.dataset.shapeInStudent = String(deriveStudentHtml().includes('wg-shape'));
  } else if (seed === 'inspector') {
    // US-E2: 3단 배치 치수 + 선택에 반응하는 우측 패널 + 좌측 탭 + 접기.
    const wrap = document.getElementById('canvas-wrap');
    const sheet = doc.querySelector('.sheet');
    document.body.dataset.inspCols = getComputedStyle(document.getElementById('workspace')).gridTemplateColumns;
    document.body.dataset.inspCanvasW = String(Math.round(wrap.clientWidth));
    document.body.dataset.inspSheetW = String(Math.round(sheet.getBoundingClientRect().width));
    document.body.dataset.inspNoHscroll = String(wrap.scrollWidth <= wrap.clientWidth + 1);
    document.body.dataset.inspDefault = document.body.dataset.inspector;

    // 표 안에 커서 → 표 섹션
    const td = doc.querySelector('table td');
    if (td) {
      const r = doc.createRange();
      r.selectNodeContents(td);
      r.collapse(true);
      const sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      await new Promise((res) => setTimeout(res, 200));
      document.body.dataset.inspTable = document.body.dataset.inspector;
    }
    // 표 밖 → 문서 섹션 복귀
    const outside = [...doc.querySelectorAll('.wg-block p')].find((x) => !x.closest('table'));
    if (outside) {
      const r = doc.createRange();
      r.selectNodeContents(outside);
      r.collapse(true);
      const sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      await new Promise((res) => setTimeout(res, 200));
      document.body.dataset.inspBack = document.body.dataset.inspector;
    }
    // 이미지 선택 → 이미지 섹션
    const img = doc.createElement('img');
    img.src = 'assets/seed.png';
    img.style.width = '40mm';
    doc.querySelector('.wg-block').appendChild(img);
    selectImageEl(img);
    await new Promise((res) => setTimeout(res, 200));
    document.body.dataset.inspImage = document.body.dataset.inspector;
    img.remove();
    clearImageSelection();

    // 좌측 탭 전환(프리셋이 캔버스를 덮지 않는다)
    showLeftTab('tab-presets');
    await refreshPresetsOnce();
    await new Promise((res) => setTimeout(res, 300));
    document.body.dataset.inspLeftTab = document.body.dataset.leftTab;
    document.body.dataset.inspPresetItems = String(document.querySelectorAll('#preset-list .preset-item').length);
    document.body.dataset.inspCanvasWithPresets = String(Math.round(wrap.clientWidth));

    // 접기 → 캔버스가 넓어진다
    const beforeW = wrap.clientWidth;
    togglePanel('left');
    togglePanel('right');
    await new Promise((res) => setTimeout(res, 200));
    document.body.dataset.inspCollapsedW = String(Math.round(wrap.clientWidth));
    document.body.dataset.inspCollapsedGrew = String(wrap.clientWidth > beforeW);
    togglePanel('left');
    togglePanel('right');
    await new Promise((res) => setTimeout(res, 200));
    document.body.dataset.inspRestoredW = String(Math.round(wrap.clientWidth));
  } else if (seed === 'objects') {
    // 개체 선택 — AI 초안의 표·그림·상자를 클릭으로 잡고 인스펙터가 그에 반응하는가.
    // 이게 안 되던 것이 "텍스트만 고칠 수 있다"의 원인이었다.
    const win = frames.teacher.contentWindow;
    const pick = (el) => { selectObject(el ? classifyTarget(el, win) : null); return document.body.dataset.objectKind; };
    document.body.dataset.objTable = pick(doc.querySelector('table td'));
    document.body.dataset.objTableLabels =
      [...document.querySelectorAll('#inspector .insp-row label')].map((l) => l.textContent).join(',');
    document.body.dataset.objSvg = pick(doc.querySelector('svg:not(.wg-shape)'));
    document.body.dataset.objBox = pick(doc.querySelector('.qbox .lab') ?? doc.querySelector('.qbox'));
    // Esc 사다리: 안쪽(.lab) → 바깥(.qbox). 없으면 바깥 상자에 닿을 방법이 없다.
    const inner = document.getElementById('inspector-title').textContent;
    selectObject(parentTarget(selectedObject, win));
    document.body.dataset.objEscLadder = `${inner}→${document.getElementById('inspector-title').textContent}`;

  } else if (seed === 'textbox') {
    // 자유 배치 텍스트 상자 — 모델·선택·편집·자동삭제·저장 왕복. 드래그 배치 제스처
    // 자체는 실제 마우스가 필요해 여기선 빼고(수동 Playwright 로 검증), 삽입 이후의
    // 계약을 단정한다. insertTextbox 로 넣은 상자가 이후 조작·직렬화에서 어떻게 사는가.
    const win = frames.teacher.contentWindow;
    const block = doc.querySelector('.wg-block');

    // 1) 삽입 → 클릭 분류가 textbox 로 잡히는가
    const box = insertTextbox(doc, block, { text: '실험 관찰', leftMm: 20, topMm: -10, widthMm: 45, fontSize: 12, color: '#333333' });
    markTextIslands(doc);
    selectObject(classifyTarget(box, win));
    document.body.dataset.tbKind = document.body.dataset.objectKind;
    document.body.dataset.tbInspector = document.getElementById('inspector-title').textContent;
    document.body.dataset.tbMovable = String(isMovableKind('textbox'));

    // 2) 스타일 round-trip (mm·pt·색·정렬)
    setTextboxStyle(box, { leftMm: 33.3, topMm: 12.7, widthMm: 60, fontSize: 14, color: '#c0392b', align: 'center' });
    const st = textboxStyle(box);
    document.body.dataset.tbStyle = `${st.leftMm}|${st.topMm}|${st.widthMm}|${st.fontSize}|${st.color}|${st.align}`;

    // 3) 편집 모드 진입/종료 — 안쪽 contenteditable 토글
    enterTextEditing(box);
    document.body.dataset.tbEditOn = box.getAttribute('contenteditable');
    document.body.dataset.tbEditing = document.body.dataset.textEditing;
    // 내용이 있으니 종료해도 상자는 남는다
    exitTextEditing();
    document.body.dataset.tbEditOff = box.getAttribute('contenteditable');
    document.body.dataset.tbKeptNonEmpty = String(box.isConnected);

    // 4) 빈 상자는 편집 종료 시 자동 삭제
    const empty = insertTextbox(doc, block, { text: '', leftMm: 10, topMm: -20, widthMm: 40 });
    markTextIslands(doc);
    enterTextEditing(empty);
    exitTextEditing();
    document.body.dataset.tbEmptyRemoved = String(!empty.isConnected);

    // 5) 저장 직렬화 — 상자는 실리고 편집 세션 표식은 빠진다
    const serialized = JSON.stringify(serializeSheets());
    document.body.dataset.tbSerializedHasBox = String(serialized.includes('wg-text'));
    document.body.dataset.tbSerializedClean = String(!/contenteditable|draggable|data-wg-mark/.test(serialized));
    document.body.dataset.tbSerializedText = String(serialized.includes('실험 관찰'));
    // 학생 파생에도 상자가 살아 인쇄된다(교사가 얹은 메모는 학생지에도 보여야 한다)
    document.body.dataset.tbInStudent = String(deriveStudentHtml().includes('wg-text'));

    // 6) AI 초안 텍스트 → 상자 변환(promote-on-demand). 문단을 만들어 커서를 놓고 변환.
    const para = doc.createElement('p');
    para.textContent = 'AI 초안 문단 텍스트입니다';
    block.appendChild(para);
    const before = doc.querySelectorAll('.wg-text').length;
    const range = doc.createRange();
    range.setStart(para.firstChild, 3);
    range.collapse(true); // 커서만(선택 없음) → 문단 단위 변환 경로
    const sel = win.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    promoteToTextbox();
    const boxesNow = [...doc.querySelectorAll('.wg-text')];
    document.body.dataset.tbPromotedNewBox = String(boxesNow.length === before + 1);
    document.body.dataset.tbPromotedText = String(boxesNow.some((b) => b.textContent.includes('AI 초안 문단 텍스트')));
    document.body.dataset.tbPromotedOrigGone = String(!para.isConnected);
    document.body.dataset.tbPromotedKind = document.body.dataset.objectKind; // 변환 후 상자가 선택됨

  } else if (seed === 'object-edit') {
    // 개체 서식이 실제 렌더에 반영되고 되돌려지는가(인라인 style 경로).
    const win = frames.teacher.contentWindow;
    const cs = (el) => win.getComputedStyle(el);

    const table = doc.querySelector('table');
    selectObject(classifyTarget(table.querySelector('td'), win));
    applyEdit(() => setTableStyle(table, { borderColor: '#c0392b', borderWidth: 3 }));
    document.body.dataset.objTableBorder = `${cs(table.querySelector('td')).borderTopColor}|${cs(table.querySelector('td')).borderTopWidth}`;

    const svg = doc.querySelector('svg:not(.wg-shape)');
    if (svg) {
      selectObject(classifyTarget(svg, win));
      applyEdit(() => setSvgStyle(svg, { stroke: '#1a7f37', strokeWidth: 3 }));
      const inner = svg.querySelector('path, line, rect, circle, ellipse, polygon, polyline');
      document.body.dataset.objSvgStroke = inner ? cs(inner).stroke : '';
    }

    // 밑줄(.ans-line)은 한 변만 그려진 요소 — 사면에 두르면 밑줄이 상자가 된다.
    const line = doc.querySelector('.ans-line');
    if (line) {
      selectObject(classifyTarget(line, win));
      applyEdit(() => setBoxStyle(line, { borderColor: '#2563eb' }, win));
      document.body.dataset.objLineBottom = cs(line).borderBottomColor;
      document.body.dataset.objLineTopStyle = cs(line).borderTopStyle;
      history.undo();
      await new Promise((r) => setTimeout(r, 150));
      document.body.dataset.objLineUndone = String(cs(doc.querySelector('.ans-line')).borderBottomColor !== 'rgb(37, 99, 235)');
    }

  } else if (seed === 'table-ops') {
    // 표 구조 편집 — 신고된 결함 5종의 회귀 방어.
    const win = frames.teacher.contentWindow;
    const data = doc.querySelector('table.data');
    const vart = doc.querySelector('table.vartable');
    const shapeOf = (t) => [...t.rows].map((r) => [...r.cells].map((c) => c.tagName).join('')).join('/');
    const widthSum = (t) => Math.round([...t.rows[0].cells]
      .reduce((a, c) => a + (parseFloat(/width:\s*([\d.]+)%/.exec(c.getAttribute('style') || '')?.[1]) || 0), 0) * 10) / 10;

    // A: 머리행을 고르고 행 추가 → 머리는 하나여야 하고 새 행은 전부 td
    const headCell = data.rows[0].cells[0];
    selectObject(classifyTarget(headCell, win));
    applyEdit(() => tableOps.addRow(data, headCell));
    document.body.dataset.tblHeaderRows = String([...data.rows].filter(isHeaderRow).length);
    document.body.dataset.tblShape = shapeOf(data);

    // B: 열 추가 → 폭 합이 100% 로 재배분
    applyEdit(() => tableOps.addCol(data, data.rows[0].cells[0]));
    document.body.dataset.tblWidthSum = String(widthSum(data));

    // D: vartable 은 th 가 없고 첫 열이 머리 — 머리열 배경이 첫 열에만 걸려야 한다
    if (vart) {
      applyEdit(() => setTableStyle(vart, { headBackground: '#ffe8b3' }));
      document.body.dataset.tblVarCol1 = win.getComputedStyle(vart.rows[0].cells[0]).backgroundColor;
      document.body.dataset.tblVarCol2 = win.getComputedStyle(vart.rows[0].cells[1]).backgroundColor;
      document.body.dataset.tblVarHeaderRow = String(hasHeaderRow(vart));
      document.body.dataset.tblVarHeaderCol = String(hasHeaderCol(vart));
    }

    // E: 데이터 행이 하나만 남으면 삭제 거부
    let refused = false;
    for (let i = 0; i < 12; i++) {
      const ok = tableOps.removeRow(data, null);
      if (!ok) { refused = true; break; }
    }
    document.body.dataset.tblDeleteRefused = String(refused);
    document.body.dataset.tblRowsLeft = String(data.rows.length);

  } else if (seed === 'rulers') {
    // 눈금자·격자·중앙 스냅 + "여백선을 꺼도 선택 핸들은 남는가"(회귀).
    const win = frames.teacher.contentWindow;
    document.getElementById('btn-rulers').click();
    document.getElementById('btn-grid').click();
    await new Promise((r) => setTimeout(r, 200));
    document.body.dataset.rulRulers = String(overlay.querySelectorAll('.ruler').length);
    document.body.dataset.rulTicks = String(overlay.querySelectorAll('.ruler-tick').length);
    document.body.dataset.rulGrid = String(overlay.querySelectorAll('.canvas-grid').length);
    document.body.dataset.rulSheets = String(doc.querySelectorAll('.sheet').length);

    const svg = doc.querySelector('svg:not(.wg-shape)');
    selectObject(classifyTarget(svg, win));
    document.body.dataset.rulHandlesOn = String(overlay.querySelectorAll('.shape-handle').length);
    document.getElementById('btn-guides').click(); // 여백선 OFF
    await new Promise((r) => setTimeout(r, 200));
    document.body.dataset.rulMarginGuides = String(overlay.querySelectorAll('.margin-guide').length);
    document.body.dataset.rulHandlesAfterOff = String(overlay.querySelectorAll('.shape-handle').length);
    document.getElementById('btn-guides').click();

    // 중앙 스냅: 중심에서 3px 못 미치게 끌면 정확히 중앙으로 붙는다.
    const sheet = svg.closest('.sheet');
    const need = (sheet.getBoundingClientRect().left + sheet.getBoundingClientRect().width / 2)
      - (svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2);
    const handle = overlay.querySelector('.object-move-handle');
    const ev = (type, sx) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, screenX: sx, screenY: 0, clientX: sx, clientY: 0 });
    handle.dispatchEvent(ev('pointerdown', 0));
    overlay.dispatchEvent(ev('pointermove', need - 3));
    document.body.dataset.rulSnapGuides = document.body.dataset.alignGuides ?? '';
    overlay.dispatchEvent(ev('pointerup', need - 3));
    await new Promise((r) => setTimeout(r, 200));
    const off = (svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2)
      - (sheet.getBoundingClientRect().left + sheet.getBoundingClientRect().width / 2);
    document.body.dataset.rulSnapOffPx = String(Math.round(Math.abs(off) * 10) / 10);
    document.body.dataset.rulGuidesCleared = String(overlay.querySelectorAll('.align-guide').length === 0);

  } else if (seed === 'thumbs-student') {
    // US-E1: 학생용 전환 시 썸네일도 학생용 문서로 바뀐다.
    await setMode('student');
    await new Promise((r) => setTimeout(r, 600));
    const src = document.querySelectorAll('#thumb-list .thumb iframe')[0]?.srcdoc ?? '';
    document.body.dataset.thumbStudentMode = String(src.includes('data-mode="student"'));
    document.body.dataset.thumbStudentCount = String(document.querySelectorAll('#thumb-list .thumb').length);
  } else if (seed === 'undo-answer-mark') {
    // G002: ⭐정답 표시가 통합 되돌리기 스택에 들어오는지(회귀 지점).
    const marks = () => doc.querySelectorAll('.answer').length;
    selectFirstLongText(doc, firstQuestion);
    document.body.dataset.undoMarksBase = String(marks());
    history.run(() => toggleAnswerMark(doc));
    document.body.dataset.undoMarksAfter = String(marks());
    history.undo();
    document.body.dataset.undoMarksUndone = String(marks());
    history.redo();
    document.body.dataset.undoMarksRedone = String(marks());
  } else if (seed === 'undo-ans-line') {
    // G002: ✏️답란 삽입 되돌리기.
    const lines = () => doc.querySelectorAll('.wg-block .ans-line').length;
    document.body.dataset.undoLinesBase = String(lines());
    history.run(() => insertAnswerLines(doc, 5));
    document.body.dataset.undoLinesAfter = String(lines());
    history.undo();
    document.body.dataset.undoLinesUndone = String(lines());
  } else if (seed === 'undo-interleave') {
    // G002 핵심: 타이핑과 명령이 섞여도 친 역순으로 풀려야 한다(두 스택 병존 시 깨지던 지점).
    const TYPED = 'WGTYPEDMARK';
    const target = selectFirstLongText(doc, firstQuestion);
    const caret = doc.createRange();
    caret.setStart(target, target.textContent.length);
    caret.collapse(true);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(caret);
    doc.execCommand('insertText', false, TYPED); // input 이벤트 → 타이핑 코얼레싱
    selectFirstLongText(doc, firstQuestion);
    const before = doc.querySelectorAll('.answer').length;
    history.run(() => toggleAnswerMark(doc));
    const marked = doc.querySelectorAll('.answer').length > before;
    history.undo(); // 1차: 명령만 취소 — 타이핑은 남아야 한다
    document.body.dataset.undoIlAfterFirst =
      marked && doc.querySelectorAll('.answer').length === before && doc.body.textContent.includes(TYPED)
        ? 'typed-kept' : 'typed-lost';
    history.undo(); // 2차: 타이핑까지 취소
    document.body.dataset.undoIlAfterSecond =
      doc.body.textContent.includes(TYPED) ? 'typed-still-there' : 'typed-gone';
  }
  document.body.dataset.seedDone = seed;
}
