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
    }`;
  doc.head.appendChild(style);
  doc.body.contentEditable = 'true';
  doc.addEventListener('input', onEdit);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('selectionchange', updateAiButtons);
  // F1 이미지: 붙여넣기(클립보드)·드롭(DnD) → 업로드 후 커서 삽입. 클릭 → 이미지 선택(리사이즈).
  doc.addEventListener('paste', onPaste);
  doc.addEventListener('dragover', (e) => e.preventDefault()); // drop 허용
  doc.addEventListener('drop', onDrop);
  doc.addEventListener('click', onCanvasClick);
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
  }, 250);
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
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
  tb.insertImage(path ? imageMarkup(path, DEFAULT_IMG_WIDTH_MM, altFromName(file.name)) : IMAGE_PLACEHOLDER);
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

// 이미지 클릭 → 선택. 이미지 자체를 선택 범위로 잡아 ⭐정답 마킹(marks.js)이 span.answer 로
// 감쌀 수 있게 한다(요소 선택 마킹). 비이미지 클릭은 선택 해제.
function onCanvasClick(e) {
  if (e.target && e.target.tagName === 'IMG') selectImageEl(e.target);
  else clearImageSelection();
}

function selectImageEl(img) {
  selectedImg = img;
  const doc = frames.teacher?.contentDocument;
  if (doc) {
    const range = doc.createRange();
    range.selectNode(img);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  drawGuides();
}

function clearImageSelection() {
  if (selectedImg) { selectedImg = null; drawGuides(); }
}

// 리사이즈: 부모 오버레이 핸들 드래그 → img.style.width 를 mm 로 갱신(iframe .sheet 내부
// 크롬 무주입 원칙 — 핸들은 오버레이, 갱신 대상은 img 자체 style=정당한 콘텐츠 편집).
function startImageResize(e) {
  e.preventDefault();
  const doc = frames.teacher?.contentDocument;
  if (!selectedImg || !doc) return;
  const startX = e.clientX;
  const startWidth = selectedImg.getBoundingClientRect().width;
  const onMove = (ev) => {
    const newPx = Math.max(20, startWidth + (ev.clientX - startX));
    selectedImg.style.width = `${Math.round(newPx / MM_TO_PX)}mm`;
    fitFrame(frames.teacher);
    drawGuides();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    onEdit();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

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
  for (const sheet of f.contentDocument.querySelectorAll('.sheet')) {
    const r = sheet.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'margin-guide';
    g.style.left = `${frameLeft + r.left + m.left * MM_TO_PX}px`;
    g.style.top = `${frameTop + r.top + m.top * MM_TO_PX}px`;
    g.style.width = `${r.width - (m.left + m.right) * MM_TO_PX}px`;
    g.style.height = `${r.height - (m.top + m.bottom) * MM_TO_PX}px`;
    overlay.appendChild(g);

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
  if (selectedImg && selectedImg.isConnected && mode === 'teacher') {
    const ir = selectedImg.getBoundingClientRect();
    const handle = document.createElement('div');
    handle.className = 'img-resize-handle';
    handle.style.left = `${frameLeft + ir.left + ir.width - 6}px`;
    handle.style.top = `${frameTop + ir.top + ir.height - 6}px`;
    handle.addEventListener('pointerdown', startImageResize);
    overlay.appendChild(handle);
    document.body.dataset.imgSelected = 'true';
  } else {
    document.body.dataset.imgSelected = 'false';
  }
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
}

document.getElementById('btn-teacher').addEventListener('click', () => setMode('teacher'));
document.getElementById('btn-student').addEventListener('click', () => setMode('student'));
document.getElementById('btn-guides').addEventListener('click', (e) => {
  const on = overlay.classList.toggle('hidden') === false;
  e.currentTarget.classList.toggle('active', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
});
document.getElementById('btn-save').addEventListener('click', save);
window.addEventListener('resize', drawGuides);
window.addEventListener('keydown', onKeydown);

// ── 툴바 배선(어댑터 경유 — 포커스는 teacher iframe 이 유지) ──
const tb = createToolbar(() => frames.teacher?.contentDocument ?? null);
const bind = (id, fn) => document.getElementById(id).addEventListener('mousedown', (e) => { e.preventDefault(); fn(); onEdit(); });
bind('tb-bold', () => tb.applyBold());
bind('tb-italic', () => tb.applyItalic());
bind('tb-underline', () => tb.applyUnderline());
bind('tb-align-left', () => tb.applyAlign('left'));
bind('tb-align-center', () => tb.applyAlign('center'));
bind('tb-align-right', () => tb.applyAlign('right'));
bind('tb-ul', () => tb.applyList('ul'));
bind('tb-ol', () => tb.applyList('ol'));
bind('tb-table', () => tb.insertTable());
// tb-image 는 파일 픽커(비동기) — bind 의 즉시 onEdit 를 피하려 별도 배선(삽입 후 onEdit 는
// insertImageFile 이 호출). mousedown preventDefault 로 iframe 커서(삽입 지점) 보존.
document.getElementById('tb-image').addEventListener('mousedown', (e) => { e.preventDefault(); pickImage(); });
bind('tb-undo', () => tb.applyUndo());
bind('tb-redo', () => tb.applyRedo());
document.getElementById('tb-color').addEventListener('input', (e) => { tb.applyColor(e.target.value); onEdit(); });
document.getElementById('tb-font').addEventListener('change', (e) => { tb.applyFontFamily(e.target.value); onEdit(); });
document.getElementById('tb-size').addEventListener('change', (e) => {
  if (e.target.value) {
    const sel = frames.teacher?.contentDocument?.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      showBanner('warn', '크기를 적용할 텍스트를 먼저 드래그해 선택하세요.'); // 무반응 방지
    } else {
      tb.applyFontSize(Number(e.target.value));
      onEdit();
    }
  }
  e.target.selectedIndex = 0;
});
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

// ── E4 프리셋 라이브러리 ──
const presetPanel = document.getElementById('preset-panel');
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

function presetItem(p) {
  const li = document.createElement('li');
  li.className = 'preset-item';
  li.dataset.presetId = p.id;

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
    const doc = frames.teacher?.contentDocument;
    if (!doc) return;
    if (insertPreset(doc, p)) {
      onEdit();
      showBanner('ok', `프리셋 삽입: ${p.name} (저장 시 문서에 반영)`);
    }
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
document.getElementById('tb-preset-lib').addEventListener('click', async () => {
  const showing = presetPanel.classList.toggle('hidden') === false;
  if (showing && !presetCache) await refreshPresets();
});
document.getElementById('preset-close').addEventListener('click', () => presetPanel.classList.add('hidden'));
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
const aiDiff = document.getElementById('ai-diff');
let aiActive = null; // { id, poll } — 진행 중 요청(문서당 1개 흐름)
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

function aiShow(text, { cancel = false, resume = false, undo = false } = {}) {
  aiBar.classList.remove('hidden');
  aiStatusEl.textContent = text;
  aiCancelBtn.classList.toggle('hidden', !cancel);
  aiResumeBtn.classList.toggle('hidden', !resume);
  aiUndoBtn.classList.toggle('hidden', !undo);
}

function aiHide() {
  aiBar.classList.add('hidden');
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
  aiShow(`AI 응답 대기 중 (${id}) — AI 세션에서 "worksheet-grab ai pending" 이 실행 중이어야 반영됩니다.`, { cancel: true });
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
    aiShow(`대기 중단 (${id}) — 요청은 유지됩니다. 응답이 도착하면 재개하세요.`, { resume: true });
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
    const applied = applyAiResponse(doc, id, response); // 슬롯 재부착 + DOMParser 정제
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
  if (undoAiApply(aiApplied)) {
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
const previewPrevBtn = document.getElementById('preview-prev');
const previewNextBtn = document.getElementById('preview-next');
const previewPageNum = document.getElementById('preview-page-num');
const previewOverflowBadge = document.getElementById('preview-overflow-badge');

let previewPage = 1; // T3(§2e): 현재 미리보기 페이지(1-based)

function updatePreviewNavState(total) {
  previewPrevBtn.disabled = previewPage <= 1;
  previewNextBtn.disabled = previewPage >= total;
}

// T3(§2e): 저장본 sections[N-1] 슬라이스 렌더 — 서버 쿼리 &page= 로 요청.
// 렌더 중 prev/next 비활성(단일-플라이트 409 폭주 방지). 응답 헤더 X-Preview-Overflow
// 시 "1쪽 초과" 배지를 켠다(PNG 는 오버플로 판단 근거가 아니라 서버 PDF 실측 결과다).
async function loadPreview(page) {
  const total = baseManifest.pages.length;
  previewPage = Math.min(Math.max(page, 1), total);
  previewPrevBtn.disabled = true;
  previewNextBtn.disabled = true;
  previewPageNum.textContent = `${previewPage} / ${total}`;
  previewOverflowBadge.classList.add('hidden');
  previewSpinner.classList.remove('hidden');
  previewImg.classList.add('hidden');
  let res;
  try {
    res = await fetch(`/preview.png?mode=${mode}&page=${previewPage}&t=${Date.now()}`);
  } catch (e) {
    previewSpinner.textContent = `미리보기 실패: ${e.message}`;
    updatePreviewNavState(total);
    return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    previewSpinner.textContent = `미리보기 실패: ${body.message ?? body.error ?? `HTTP ${res.status}`}`;
    updatePreviewNavState(total);
    return;
  }
  if (previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src); // 반복 미리보기 누수 방지
  previewImg.src = URL.createObjectURL(await res.blob());
  previewSpinner.classList.add('hidden');
  previewImg.classList.remove('hidden');
  if (res.headers.get('X-Preview-Overflow') === '1') previewOverflowBadge.classList.remove('hidden');
  document.body.dataset.previewShown = 'true';
  document.body.dataset.previewPage = String(previewPage);
  updatePreviewNavState(total);
}

document.getElementById('btn-preview').addEventListener('click', async () => {
  if (!(await saveFirst('정밀 미리보기'))) return;
  previewPanel.classList.remove('hidden');
  await loadPreview(1);
});
previewPrevBtn.addEventListener('click', () => loadPreview(previewPage - 1));
previewNextBtn.addEventListener('click', () => loadPreview(previewPage + 1));
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

// 초기 모드: 기본 교사용, #student 해시로 학생용 시작(딥링크·게이트 테스트용).
await setMode(location.hash === '#student' ? 'student' : 'teacher');

// ── 시드 훅(렌더 테스트 전용): 서버가 testSeed 로 기동됐을 때만 활성 ──
if (shell.testSeed === true) {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) await runSeed(seed);
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
  }
  document.body.dataset.seedDone = seed;
}
