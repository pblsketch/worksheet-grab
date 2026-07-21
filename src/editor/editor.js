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
import { createToolbar, applyFontSizeDirect } from '/editor/toolbar.js';
import { toggleAnswerMark, insertAnswerLines } from '/editor/marks.js';
import { extractPresetFromSelection, insertPreset, previewSrcdoc, cursorBlock } from '/editor/presets.js';
import { requestAiAction, pollResponse, applyAiResponse, undoAiApply, clearAiMarker } from '/editor/ai.js';

const MM_TO_PX = 96 / 25.4; // CSS 사양 고정(zoom/DPR 무관)

const shell = await (await fetch('/shell.json')).json();
const stage = document.getElementById('stage');
const overlay = document.getElementById('guide-overlay');
const statusEl = document.getElementById('review-status');
const listEl = document.getElementById('review-list');
const saveBanner = document.getElementById('save-banner');

let baseManifest = shell.manifest; // 저장 기준선(pages 외 필드 보존)
let currentRevision = shell.meta?.revision ?? null;

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
    @media screen {
      .answer { outline: 2px dashed rgba(37,99,235,.6); outline-offset: 1px; background: rgba(147,197,253,.18); }
      [data-wg-mark="session"] { background: rgba(52,211,153,.22); }
    }`;
  doc.head.appendChild(style);
  doc.body.contentEditable = 'true';
  doc.addEventListener('input', onEdit);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('selectionchange', updateAiButtons);
}

let editTimer = null;
function onEdit() {
  studentStale = true;
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
  return [...doc.querySelectorAll('.sheet')].map((sheet) => {
    const blocks = [...sheet.querySelectorAll('.wg-block')].map((w) => {
      const clone = w.cloneNode(true);
      // 편집 세션 마커는 저장 산출물에 절대 남지 않는다(세션 정답 태깅·AI 대기 마커).
      for (const el of clone.querySelectorAll('[data-wg-mark]')) el.removeAttribute('data-wg-mark');
      for (const el of clone.querySelectorAll('[data-ai-req]')) el.removeAttribute('data-ai-req');
      clone.removeAttribute('data-ai-req');
      return { type: w.dataset.bt || 'content', html: clone.innerHTML };
    });
    let leftoverHtml = '';
    for (const node of sheet.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains('wg-block')) continue;
        if ([...node.classList].some((c) => CHROME.has(c))) continue;
        leftoverHtml += node.outerHTML;
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        leftoverHtml += node.textContent;
      }
    }
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
bind('tb-image', () => tb.insertImage());
bind('tb-undo', () => tb.applyUndo());
bind('tb-redo', () => tb.applyRedo());
document.getElementById('tb-color').addEventListener('input', (e) => { tb.applyColor(e.target.value); onEdit(); });
document.getElementById('tb-font').addEventListener('change', (e) => { tb.applyFontFamily(e.target.value); onEdit(); });
document.getElementById('tb-size').addEventListener('change', (e) => {
  if (e.target.value) { tb.applyFontSize(Number(e.target.value)); onEdit(); }
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
  const block = doc ? cursorBlock(doc) : null;
  const excluded = block ? (shell.excludedAiTypes ?? []).includes(block.dataset.bt || 'content') : false;
  for (const id of ['tb-ai-rewrite', 'tb-ai-fill']) {
    const btn = document.getElementById(id);
    btn.disabled = excluded;
    btn.title = excluded
      ? '성취기준 원문·저작권 지문 블록은 AI 대상이 아닙니다(보존).'
      : btn.dataset.baseTitle ?? btn.title;
    if (!btn.dataset.baseTitle) btn.dataset.baseTitle = btn.title;
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
  const outcome = await poll.promise;
  if (aiActive?.id !== id) return; // 취소 등으로 흐름 교체됨
  aiActive = null;
  const doc = frames.teacher?.contentDocument;
  if (outcome.status === 'answered') {
    showAiDiff(id, outcome.html);
  } else if (outcome.status === 'timeout') {
    aiShow(`대기 중단 (${id}) — 요청은 유지됩니다. 응답이 도착하면 재개하세요.`, { resume: true });
    aiResumeBtn.onclick = () => waitForAi(id);
  } else if (outcome.status === 'cancelled' || outcome.status === 'gone') {
    if (doc) clearAiMarker(doc, id);
    aiHide();
  }
}

function showAiDiff(id, html) {
  const doc = frames.teacher.contentDocument;
  const target = doc.querySelector(`[data-ai-req="${CSS.escape(id)}"]`);
  const beforeHtml = target ? target.innerHTML : '';
  document.getElementById('ai-diff-before').srcdoc = previewSrcdoc({ html: beforeHtml }, { showAnswer: true, styles: shellStyles });
  document.getElementById('ai-diff-after').srcdoc = previewSrcdoc({ html }, { showAnswer: true, styles: shellStyles });
  aiDiff.classList.remove('hidden');
  aiShow(`AI 응답 도착 (${id}) — 미리보기를 확인하고 적용/폐기하세요.`);
  document.getElementById('ai-apply').onclick = async () => {
    const applied = applyAiResponse(doc, id, html); // DOMParser 정제 포함
    aiDiff.classList.add('hidden');
    if (!applied) { aiShow('적용 대상 블록을 찾지 못했습니다(삭제됨?).'); return; }
    aiApplied = applied;
    await fetch(`/ai/${encodeURIComponent(id)}/applied`, { method: 'POST' });
    onEdit();
    aiShow('AI 재작성이 적용되었습니다. 저장 전까지 되돌릴 수 있습니다.', { undo: true });
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
    document.body.dataset.aiMarkerSet = String(!!(result.id && doc.querySelector(`[data-ai-req="${CSS.escape(result.id)}"]`)));
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
  }
  document.body.dataset.seedDone = seed;
}
