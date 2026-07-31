// canvasInline.js — editor-v4 S4.3 캔버스 인라인 조작: 텍스트 편집 중 버블 툴바, `/` 슬래시 메뉴
// (닫힌 카탈로그 삽입), flow 개체 hover ⠿ 핸들(드래그 재정렬)+`+` 삽입 버튼, 우클릭 메뉴.
//
// selection.js 와 마찬가지로 iframe 문서에 매 load 마다 attach() 로 리스너를 다시 건다. 팝업(버블·
// 슬래시·컨텍스트 메뉴)은 iframe 밖(부모 문서)에 fixed 포지션으로 띄운다.
//
// 핸들/삽입 버튼은 `.wg-obj` **안**이 아니라 `.sheet` 에 딸린 별도 오버레이 레이어에 절대좌표로
// 띄운다(getBoundingClientRect 상대 계산) — richtext 개체는 EDIT_FIELD(selector:null) 규약상
// `.wg-obj` 자신이 contenteditable 대상이 되므로, 그 안에 자식을 넣으면 selection.js 의
// readField(innerHTML 그대로 읽기)가 핸들/버튼 마크업까지 obj.html 에 섞어 저장해 콘텐츠를
// 오염시킨다(실제로 처음엔 안에 넣었다가 이 문제를 realize 하고 오버레이 방식으로 다시 짰다).

import { CATALOG_ITEMS } from './objectFactory.js';
// 크기 손잡이(2026-07-28) — 어느 타입에 손잡이를 낼지·폭 한계는 스키마가 단일 출처다.
import { SIZEABLE_TYPES, WIDTH_PCT_MIN, WIDTH_PCT_MAX } from '/src/domain/schema/index.js';

const MM_TO_PX = 96 / 25.4;

/** 본체 드래그 승격 임계(px). leftPanel.js 의 페이지 썸네일 재정렬이 쓰는 값과 동일 — 같은 종류의
 *  상호작용(리스트 드래그 재정렬)에 다른 숫자를 쓸 이유가 없다. 96dpi 기준 5px ≈ 1.32mm 라
 *  클릭 시 손떨림(1~3px)은 흡수하고 의도적 끌기(10px+)는 즉시 통과한다. */
export const FLOW_DRAG_THRESHOLD_PX = 5;

/**
 * 개체 몸통 드래그로 **승격하지 않는** 지점. 전부 이미 소유자가 있는 조작 표면이다.
 *
 * 이 목록은 암묵 계약이 아니다 — `test/unit/body-drag-chokepoint.test.js` 가 강제한다:
 * `editorStyle.js` 에서 `pointer-events: auto` 를 받는 선택자는 전부 이 목록이나 명시적 예외
 * 목록(`.wg-float*` 3종 — `.wg-float` 조기 반환이 덮는다)에 있어야 하고, `src/editor/*.js` 의
 * 인라인 `pointerEvents:'auto'` 지정도 함께 검사한다. 새 조작 UI 를 추가하면서 여기 등록을
 * 잊으면 테스트가 빨개진다.
 *
 * `[contenteditable="true"]` 로 충분한 곳을 개별 등록하지 않는 것이 중요하다 — `.q-part[data-part]`
 * 와 `td[data-r]` 는 **편집 진입 시에만** contenteditable 을 얻으므로, 비편집 상태까지 막으면
 * question/table 개체 몸통의 대부분이 드래그 사각지대가 된다.
 */
export const NO_BODY_DRAG_SELECTORS = Object.freeze([
  '.wg-flow-handle', '.wg-flow-insert',      // canvasInline 자신의 오버레이 진입점
  '.wg-size-handle',                         // flow 개체 크기 조정(2026-07-28) — 같은 오버레이 층
  '.wg-resize-handle', '.wg-float-handle',   // selection.js 소관(자유 개체 이동·리사이즈)
  '.wg-col-handle',                          // tableEdit.js 소관(표 열 너비)
  '[contenteditable="true"]',                // 캐럿 이동·드래그 선택
  'button', 'input', 'select', 'textarea', 'a[href]',
]);

/** `closest()` 에 넘길 결합 셀렉터(위 목록의 파생값 — 목록이 단일 진실). */
const NO_BODY_DRAG = NO_BODY_DRAG_SELECTORS.join(',');

/**
 * 본체 드래그 승격 판정 — **순수 함수**(DOM 접근 0).
 *
 * 이 상호작용의 회귀 표면 대부분은 실마우스가 필요 없다. 임계·편집 가드·셀렉터 제외·float 양보를
 * 여기로 떼어내면 Chrome 없이 단위 테스트로 고정되고, 실마우스가 정말 필요한 잔여분은
 * 포인터 캡처 유지 · 교차 페이지 insertBefore · 드래그 후 click 삼키기 셋뿐이 된다.
 *
 * @param {{button?:number, editingId?:string|null, blockedBySelector?:boolean,
 *          isFloat?:boolean, hasObj?:boolean, dx?:number, dy?:number, threshold?:number}} ctx
 * @returns {boolean}
 */
export function shouldPromoteBodyDrag({
  button = 0, editingId = null, blockedBySelector = false,
  isFloat = false, hasObj = true, dx = 0, dy = 0, threshold = FLOW_DRAG_THRESHOLD_PX,
} = {}) {
  if (button !== 0) return false;        // 우클릭/가운데클릭 — 컨텍스트 메뉴 등 별도 소유자
  if (editingId) return false;           // 편집 중 = 캐럿·드래그 선택 우선(selection.js 관례)
  if (blockedBySelector) return false;   // NO_BODY_DRAG_SELECTORS 적중
  if (isFloat) return false;             // 자유 개체는 selection.js startFloatDrag 소관
  if (!hasObj) return false;             // .wg-obj 밖(빈 여백) = 마퀴 소관
  return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
}

function closeAll(popupsHost) {
  popupsHost.replaceChildren();
}

/** 상단·좌측 눈금자(#2)를 .sheet 마다 붙인다(숫자=cm). 표시 여부는 body.wg-show-ruler(CSS)가 정하고,
 *  이 함수는 DOM(눈금 숫자)만 idempotent 하게 만든다 — 줌 변형과 함께 스케일되도록 mm 단위로 배치한다. */
function decorateRulers(doc) {
  const show = doc.body?.classList.contains('wg-show-ruler');
  for (const sheet of doc.querySelectorAll('.sheet')) {
    let top = sheet.querySelector(':scope > .wg-ruler-top');
    let left = sheet.querySelector(':scope > .wg-ruler-left');
    if (!show) { top?.remove(); left?.remove(); continue; }
    if (getComputedStyle(sheet).position === 'static') sheet.style.position = 'relative';
    const cs = getComputedStyle(sheet);
    const wMm = Math.round((parseFloat(cs.width) || 0) / MM_TO_PX);
    const hMm = Math.round((parseFloat(cs.height) || 0) / MM_TO_PX);
    if (top && left && top.dataset.mm === String(wMm) && left.dataset.mm === String(hMm)) continue;
    top?.remove(); left?.remove();
    sheet.appendChild(buildRuler(doc, 'top', wMm));
    sheet.appendChild(buildRuler(doc, 'left', hMm));
  }
}

function buildRuler(doc, axis, lenMm) {
  const bar = doc.createElement('div');
  bar.className = axis === 'top' ? 'wg-ruler-top' : 'wg-ruler-left';
  bar.dataset.mm = String(lenMm);
  bar.setAttribute('aria-hidden', 'true');
  for (let cm = 1; cm * 10 < lenMm; cm++) {
    const num = doc.createElement('span');
    num.className = 'wg-ruler-num';
    num.textContent = String(cm);
    if (axis === 'top') num.style.left = `${cm * 10}mm`;
    else num.style.top = `${cm * 10}mm`;
    bar.appendChild(num);
  }
  return bar;
}

/**
 * @param {{
 *   popupsHost: HTMLElement,
 *   getSelectionState: () => {editingId:string|null, selectedIds:Set<string>},
 *   findObject: (id:string) => {obj:object}|null,
 *   onFormat: (cmd:string, value?:string) => void,
 *   onAnswerToggle: (id:string) => void,
 *   onInsertAfter: (item:object, afterId:string) => void,
 *   onDuplicate: (id:string) => void,
 *   onDelete: (id:string) => void,
 *   onFlowFloat: (id:string) => void,
 *   onSaveAsPreset: (id:string) => void,
 *   onReorderStep: (id:string, direction:'up'|'down') => void,
 *   onReorderCommit: () => void,
 *   onDragEnd?: () => void, // 본체 드래그 종료 — 뒤따르는 click 1회를 삼키게 알린다(핸들 경로는 미호출)
 *   excludedAiTypes: Set<string>, // US-19 — std-box(§7, 원칙 3) 는 AI 진입점 비활성(passage-slot 은
 *   3층 정책, 2026-07-23 2차 델타로 해제)
 *   onAiOpen: (id:string) => void, // US-19 — AI 패널을 이 개체로 연다
 *   onAuthorSection?: (afterId:string) => void, // B1 — 이 개체 뒤에 새 섹션을 AI 로 저작(프래그먼트 진입)
 * }} deps
 */
export function createCanvasInline(deps) {
  const { popupsHost } = deps;
  const excludedAiTypes = deps.excludedAiTypes || new Set();
  let currentDoc = null;
  let currentFrame = null;

  // ── 버블 툴바(텍스트 선택 중, richtext 편집 한정 — us16.md 서식 한계 동형) ──
  function updateBubble() {
    closeBubbleOnly();
    const { editingId } = deps.getSelectionState();
    if (!editingId) return;
    const found = deps.findObject(editingId);
    // richtext + title/question 편집 중에만 버블 서식 툴바를 띄운다(서식 보존 필드 3종, selection.js).
    if (!found || !['richtext', 'title', 'question'].includes(found.obj.type)) return;
    const sel = currentDoc.defaultView.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const frameRect = currentFrame.getBoundingClientRect();

    const bubble = document.createElement('div');
    bubble.className = 'bubble-toolbar';
    bubble.id = 'canvas-bubble';
    bubble.style.left = `${frameRect.left + rect.left + rect.width / 2}px`;
    bubble.style.top = `${frameRect.top + rect.top - 36}px`;
    for (const [cmd, label] of [['bold', 'B'], ['italic', 'I'], ['underline', 'U']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.cmd = cmd;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); deps.onFormat(cmd); });
      bubble.appendChild(b);
    }
    const color = document.createElement('input');
    color.type = 'color';
    color.addEventListener('mousedown', (e) => e.preventDefault());
    color.addEventListener('input', () => deps.onFormat('foreColor', color.value));
    bubble.appendChild(color);
    const answerBtn = document.createElement('button');
    answerBtn.textContent = '★';
    answerBtn.dataset.cmd = 'answer';
    answerBtn.addEventListener('mousedown', (e) => { e.preventDefault(); deps.onAnswerToggle(editingId); });
    bubble.appendChild(answerBtn);
    popupsHost.appendChild(bubble);
  }
  function closeBubbleOnly() { popupsHost.querySelector('#canvas-bubble')?.remove(); }

  // ── `/` 슬래시 메뉴(닫힌 카탈로그만) ──
  function openSlashMenu(caretRect, afterId) {
    closeAll(popupsHost);
    const frameRect = currentFrame.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'slash-menu';
    menu.id = 'canvas-slash-menu';
    menu.dataset.slashOpen = 'true';
    menu.dataset.slashCount = String(CATALOG_ITEMS.length);
    menu.style.left = `${frameRect.left + caretRect.left}px`;
    menu.style.top = `${frameRect.top + caretRect.bottom + 4}px`;
    // US-19: 슬래시 메뉴도 AI 패널 진입점 — afterId(직전 개체) 를 대상으로 연다.
    const target = deps.findObject?.(afterId);
    const aiBtn = document.createElement('button');
    aiBtn.textContent = 'AI 로 편집';
    aiBtn.dataset.slashItem = 'ai';
    aiBtn.disabled = !target || excludedAiTypes.has(target.obj.type);
    aiBtn.addEventListener('click', () => {
      closeAll(popupsHost);
      document.body.dataset.slashOpen = 'false';
      deps.onAiOpen?.(afterId);
    });
    menu.appendChild(aiBtn);
    // B1: 슬래시 메뉴 "새 섹션 AI 저작" — afterId(직전 개체) 뒤에 제약 AI 가 새 섹션을 저작한다.
    // 그 개체를 고치는 게 아니라 뒤에 저작할 뿐이라 std-box·float 에서도 활성이다(rewrite 진입과 다름).
    const authorBtn = document.createElement('button');
    authorBtn.textContent = '새 섹션 AI 저작';
    authorBtn.dataset.slashItem = 'author-section';
    authorBtn.addEventListener('click', () => {
      closeAll(popupsHost);
      document.body.dataset.slashOpen = 'false';
      deps.onAuthorSection?.(afterId);
    });
    menu.appendChild(authorBtn);
    for (const item of CATALOG_ITEMS) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.dataset.slashItem = item.key;
      b.addEventListener('click', () => {
        closeAll(popupsHost);
        document.body.dataset.slashOpen = 'false';
        deps.onInsertAfter(item, afterId);
      });
      menu.appendChild(b);
    }
    popupsHost.appendChild(menu);
    document.body.dataset.slashOpen = 'true';
    document.body.dataset.slashCount = String(CATALOG_ITEMS.length);
    setTimeout(() => document.addEventListener('click', () => { closeAll(popupsHost); document.body.dataset.slashOpen = 'false'; }, { once: true }), 0);
  }

  // ── 어느 개체의 조작 칩을 드러낼 것인가(hover 추적) ──
  //
  // 칩은 CSS 가 기본 `opacity:0` 으로 숨기고, 여기서 붙이는 `.is-hot` 이 붙은 것만 보인다.
  // 오버레이가 `.wg-obj` **밖**(왼쪽 여백)에 있으므로 "개체 위" 만으로는 부족하다 — 개체에서
  // 칩으로 마우스를 옮기는 순간 hover 가 끊겨 다가가는 도중에 사라진다. 그래서 칩 자신 위도
  // 같은 개체를 가리키는 것으로 친다.
  let hotOid = null;

  function applyHot(doc) {
    for (const el of doc.querySelectorAll('.wg-flow-handle, .wg-flow-insert')) {
      el.classList.toggle('is-hot', !!hotOid && el.dataset.forOid === hotOid);
    }
  }

  function setHotOid(doc, oid) {
    if (hotOid === oid) return;
    hotOid = oid;
    applyHot(doc);
  }

  // ── flow 개체 hover ⠿ 핸들 + `+` 삽입 버튼(오버레이 — `.wg-obj` 밖) ──
  function decorateFlowHandles(doc) {
    for (const sheet of doc.querySelectorAll('.sheet')) {
      if (getComputedStyle(sheet).position === 'static') sheet.style.position = 'relative';
      let overlay = sheet.querySelector(':scope > .wg-flow-overlay');
      if (!overlay) {
        overlay = doc.createElement('div');
        overlay.className = 'wg-flow-overlay';
        sheet.appendChild(overlay);
      }
      overlay.replaceChildren();
      const sheetRect = sheet.getBoundingClientRect();
      for (const objEl of sheet.querySelectorAll(':scope .wg-obj[data-oid]')) {
        const r = objEl.getBoundingClientRect();
        const top = r.top - sheetRect.top;
        const handle = doc.createElement('div');
        handle.className = 'wg-flow-handle';
        handle.dataset.forOid = objEl.dataset.oid;
        handle.textContent = '⠿';
        handle.style.top = `${top}px`;
        overlay.appendChild(handle);
        const plus = doc.createElement('button');
        plus.className = 'wg-flow-insert';
        plus.type = 'button';
        plus.dataset.forOid = objEl.dataset.oid;
        plus.textContent = '+';
        plus.style.top = `${top + Math.max(0, r.height - 11)}px`;
        overlay.appendChild(plus);
      }
      decorateSizeHandles(doc, sheet, overlay, sheetRect);
    }
    // 오버레이를 통째로 다시 만들었으니(replaceChildren) hover 표시를 다시 입힌다 —
    // 안 그러면 재장식이 일어나는 순간(선택 변경·리플로우) 가리키던 칩이 사라진다.
    applyHot(doc);
  }

  /**
   * 최초 장식은 **레이아웃이 확정되기 전에** 돈다 — attach() 는 iframe 문서를 받자마자 불리고,
   * 그 시점엔 웹폰트·이미지가 아직 안 앉아 모든 `.wg-obj` 가 같은 y 를 돌려준다. 그래서 손잡이가
   * 전부 한 자리에 쌓였다(실측: 개체가 82/116/132/166 인데 손잡이 4개가 전부 top=23). 종전에는
   * 선택을 한 번 바꿔 재장식 경로를 태워야만 제자리를 찾았고, 그전까지는 첫 개체 것 하나만
   * 잡혔다 — "⠿ 를 못 잡는다"의 절반이 이것이었다.
   *
   * 그래서 ① 다음 프레임과 폰트 로드 완료 시점에 한 번씩 다시 그리고, ② 이후의 레이아웃 변화
   * (이미지 지연 로드·용지 전환·줌)도 ResizeObserver 로 따라간다.
   *
   * **드래그 중에는 절대 다시 그리지 않는다** — 오버레이를 갈아치우면 포인터 캡처가 끊겨 한 칸씩만
   * 움직이는 회귀가 난다(이 파일 `dragState` 머리말에 기록된 사고).
   */
  function scheduleHandleReflow(doc) {
    const view = doc.defaultView;
    if (!view) return;
    const redraw = () => {
      if (currentDoc !== doc || dragState) return;
      decorateFlowHandles(doc);
    };
    view.requestAnimationFrame?.(() => view.requestAnimationFrame(redraw));
    doc.fonts?.ready?.then(redraw).catch(() => { /* 폰트 API 없는 환경 — rAF 경로로 충분 */ });
    if (typeof view.ResizeObserver === 'function') {
      const ro = new view.ResizeObserver(() => redraw());
      for (const sheet of doc.querySelectorAll('.sheet')) ro.observe(sheet);
    }
  }

  /** 크기 손잡이 방향 — flow 는 좌표가 없으므로 **오른쪽·아래만** 의미가 있다(자유 개체의 8방향과 다른
   *  점). 왼쪽으로 끌어도 개체는 흐름 시작점에 붙어 있어 손잡이가 손을 따라오지 못한다. */
  const SIZE_DIRS = Object.freeze(['e', 's', 'se']);

  /**
   * 선택된 flow 개체 하나에 크기 손잡이 3개를 오버레이로 띄운다(2026-07-28).
   *
   * `.wg-obj` **안**에 넣지 않는 이유는 이 파일 머리말과 같다 — richtext 는 `.wg-obj` 자신이
   * contenteditable 대상이라 자식을 넣으면 readField(innerHTML)가 손잡이 마크업을 본문으로 저장한다.
   * (자유 개체는 `.wg-float` 안에 넣고 selection.js 가 읽을 때 걸러내지만, flow 는 애초에 오버레이
   * 규약으로 그 문제를 피해 왔다.)
   */
  function decorateSizeHandles(doc, sheet, overlay, sheetRect) {
    const { selectedIds, editingId } = deps.getSelectionState();
    if (editingId || !selectedIds || selectedIds.size !== 1) return;
    const targetId = [...selectedIds][0];
    const objEl = sheet.querySelector(`:scope .wg-obj[data-oid="${cssEscape(targetId)}"]`);
    if (!objEl || !SIZEABLE_TYPES.includes(objEl.dataset.ot)) return;

    // 줌(스테이지 transform:scale)으로 getBoundingClientRect 는 스크린 px 를 준다. 오버레이는 스케일된
    // 서브트리 안이라 style 값은 **레이아웃 px** 여야 한다 — tableEdit.js 열 손잡이와 같은 환산.
    const scale = sheet.offsetWidth ? sheetRect.width / sheet.offsetWidth : 1;
    const r = objEl.getBoundingClientRect();
    const x = (r.left - sheetRect.left) / scale;
    const y = (r.top - sheetRect.top) / scale;
    const w = r.width / scale;
    const h = r.height / scale;

    for (const dir of SIZE_DIRS) {
      const el = doc.createElement('div');
      el.className = `wg-size-handle wg-sh-${dir}`;
      el.dataset.dir = dir;
      el.dataset.forOid = targetId;
      el.setAttribute('aria-hidden', 'true');
      el.style.left = `${dir === 's' ? x + w / 2 : x + w}px`;
      el.style.top = `${dir === 'e' ? y + h / 2 : y + h}px`;
      overlay.appendChild(el);
    }
  }

  /**
   * 크기 손잡이 드래그. 드래그 중에는 DOM 에 직접 인라인 style 을 써서 즉시 반응시키고, 드롭에서만
   * 문서를 바꾼다(startFloatResize 와 같은 패턴 — 매 스텝 문서를 교체하면 재로드로 캡처가 끊긴다).
   *
   * 폭 기준(basis) 산출: 지금 개체가 차지한 폭과 그 개체의 현재 widthPct 로부터 **열 폭을 역산**한다.
   * `.sheet-body` 의 clientWidth 를 쓰지 않는 이유는 다단(column-count)에서 그것이 열 폭이 아니라 본문
   * 전체 폭이기 때문이다. 역산은 단 수와 무관하게 항상 맞는다.
   *
   * 줌: 폭은 비율(px/px)이라 스케일이 약분돼 보정이 필요 없지만, 높이는 mm(절대 단위)로 환산하므로
   * 반드시 scale 로 나눠야 한다.
   */
  function startSizeDrag(e, handle) {
    const id = handle.dataset.forOid;
    const dir = handle.dataset.dir;
    const found = deps.findObject(id);
    if (!found) return;
    const objEl = currentDoc.querySelector(`.wg-obj[data-oid="${cssEscape(id)}"]`);
    const sheet = objEl?.closest('.sheet');
    if (!objEl || !sheet) return;
    e.preventDefault();
    e.stopPropagation();

    const scale = sheet.offsetWidth ? sheet.getBoundingClientRect().width / sheet.offsetWidth : 1;
    const startRect = objEl.getBoundingClientRect();
    const startPct = typeof found.obj.widthPct === 'number' ? found.obj.widthPct : 100;
    const basisPx = startPct > 0 ? startRect.width / (startPct / 100) : startRect.width;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let nextPct = null;
    let nextMinH = null;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (dir.includes('e') && basisPx > 0) {
        // 스크린 px 끼리의 비율이라 줌이 약분된다(스케일 보정 불필요).
        nextPct = Math.min(WIDTH_PCT_MAX, Math.max(WIDTH_PCT_MIN, ((startRect.width + dx) / basisPx) * 100));
        objEl.style.width = `${nextPct}%`;
      }
      if (dir.includes('s')) {
        // mm 는 절대 단위 — 스크린 px 를 레이아웃 px 로 되돌린 뒤 환산한다.
        nextMinH = Math.max(1, (startRect.height + dy) / scale / MM_TO_PX);
        objEl.style.minHeight = `${nextMinH}mm`;
      }
    };
    const onUp = (ev) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('lostpointercapture', onUp);
      if (!moved) return;
      const patch = {};
      if (nextPct !== null) patch.widthPct = nextPct;
      if (nextMinH !== null) patch.minHeightMm = nextMinH;
      // 클램프·반올림은 resizeFlow(순수)가 소유한다 — 여기서 미리 다듬지 않는다(단일 관문).
      deps.onResize?.(id, patch);
      deps.onDragEnd?.();
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* 캡처 불가 환경 */ }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('lostpointercapture', onUp);
  }

  // 연속 재정렬·페이지 넘나들기(#1·#2 2차): 드래그 중 포인터 y 위치에 맞춰 objEl 을 모든 .sheet 의
  // .wg-obj 사이 어디로든 실시간 이동(insertBefore)하고, 드롭 시 DOM 최종 순서를 "페이지별 id 배열"로
  // 읽어 한 번에 커밋한다. 예전엔 한 스텝마다 decorateFlowHandles 로 손잡이를 다시 그려 포인터 캡처가
  // 끊겨 한 칸씩만 움직였다 — 드래그 중에는 손잡이를 재장식하지 않는다.
  let dragState = null;
  /**
   * flow 개체 드래그 재정렬. 진입점 2개(⠿ 핸들 · 개체 몸통)가 이 본문 하나를 공유하므로
   * 커밋 경로(`idsByPage` → `onFlowReorder`)가 같고 undo 동작도 자동으로 같다.
   *
   * @param {PointerEvent} e
   * @param {{id:string, captureEl:Element, bodyDrag?:boolean}} opts
   *   `captureEl` 은 **드래그 중 DOM 에서 이동하지 않는 요소**여야 한다 — `objEl` 자신은 아래
   *   onMove 가 `insertBefore` 로 옮기므로 캡처가 암묵 해제되어 드래그가 한 칸에서 멈춘다
   *   (위 :194-197 의 사고 기록이 정확히 그 사례). 핸들 경로는 handle, 본체 경로는 시작 `.sheet`.
   */
  function startFlowDrag(e, { id, captureEl, bodyDrag = false }) {
    const objEl = currentDoc.querySelector(`[data-oid="${cssEscape(id)}"]`);
    if (!objEl) return;
    e.preventDefault();
    // 캡처 실패는 "조용한 degrade" 가 아니라 **명시적 분기**다. 리스너를 captureEl 에 건 채로
    // 캡처만 실패하면 포인터가 그 .sheet 위에 있을 때만 이벤트가 들어와 교차 페이지 재정렬이
    // 조용히 깨진다 — 그래서 실패하면 버스를 문서로 바꾼다.
    let captured = false;
    try { captureEl.setPointerCapture(e.pointerId); captured = true; } catch { /* 캡처 불가 환경 */ }
    const bus = captured ? captureEl : currentDoc;
    const pointerId = e.pointerId;
    objEl.classList.add('wg-flow-dragging');
    dragState = { id, objEl };
    const onMove = (ev) => {
      if (!dragState) return;
      // 문서 버스에는 캡처 리타게팅이 없어 다른 포인터의 이벤트도 들어온다 — 시작 포인터만 본다
      // (마퀴가 selection.js 에서 쓰는 pointerId 가드와 동형).
      if (!captured && ev.pointerId !== pointerId) return;
      const y = ev.clientY;
      const candidates = [...currentDoc.querySelectorAll('.sheet .wg-obj[data-oid]')].filter((el) => el !== objEl);
      let placed = false;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          if (el.previousElementSibling !== objEl) el.parentNode.insertBefore(objEl, el);
          placed = true;
          break;
        }
      }
      if (!placed && candidates.length) {
        const last = candidates[candidates.length - 1];
        if (last.nextElementSibling !== objEl) last.parentNode.appendChild(objEl); // 마지막 개체 뒤(그 페이지 끝)
      }
    };
    const endEvent = captured ? 'lostpointercapture' : 'pointercancel';
    const onUp = (ev) => {
      if (!captured && ev.pointerId !== pointerId) return;
      try { captureEl.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제 */ }
      bus.removeEventListener('pointermove', onMove);
      bus.removeEventListener('pointerup', onUp);
      bus.removeEventListener(endEvent, onUp);
      objEl.classList.remove('wg-flow-dragging');
      dragState = null;
      const idsByPage = [...currentDoc.querySelectorAll('.sheet')].map((sheet) =>
        [...sheet.querySelectorAll('.wg-obj[data-oid]')].map((el) => el.dataset.oid));
      deps.onFlowReorder(idsByPage, id);
      // 본체 드래그 뒤에는 click 이 따라오고 그 target 이 공통 조상(.sheet)으로 잡혀 selection.js 의
      // "바깥 클릭 = 선택 해제" 경로를 타 버린다 — 그 한 번을 삼키게 알린다. 핸들 경로는 부르지
      // 않는다(핸들 click 은 애초에 선택을 만들지 않는다 — 현행 동작 무변경).
      if (bodyDrag) deps.onDragEnd?.();
    };
    bus.addEventListener('pointermove', onMove);
    bus.addEventListener('pointerup', onUp);
    // 캡처가 있으면 취소 시 lostpointercapture 가 온다. 캡처가 **없으면** 그건 오지 않고(잃을 캡처가
    // 없다) pointercancel 만 온다 — 그런데 문서에 lostpointercapture 를 걸면 같은 문서의 다른 캡처
    // 보유자(마퀴 documentElement · float 드래그/리사이즈 el)가 캡처를 놓을 때 버블로 올라와
    // **오발화**한다. 그래서 분기마다 정확히 하나만 건다.
    bus.addEventListener(endEvent, onUp);
  }

  function cssEscape(id) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
    return String(id).replace(/["\\]/g, '\\$&');
  }

  // ── 우클릭 메뉴(복제·삭제·flow⇄float·내 블록으로 저장·앞/뒤로 보내기) ──
  function openContextMenu(e, id) {
    e.preventDefault();
    closeAll(popupsHost);
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.id = 'canvas-ctx-menu';
    const frameRect = currentFrame.getBoundingClientRect();
    menu.style.left = `${frameRect.left + e.clientX}px`;
    menu.style.top = `${frameRect.top + e.clientY}px`;
    const targetForAi = deps.findObject?.(id);
    const aiDisabled = !targetForAi || excludedAiTypes.has(targetForAi.obj.type);
    const items = [
      ['AI 로 편집', () => deps.onAiOpen?.(id), aiDisabled, aiDisabled ? '(성취기준·저작권 슬롯 제외)' : '', 'ctx-ai'],
      // B1: 이 개체 뒤에 새 섹션을 AI 로 저작(그 개체를 고치지 않으므로 std-box 에서도 활성).
      ['새 섹션 AI 저작', () => deps.onAuthorSection?.(id), false, '', 'ctx-ai-author'],
      ['복제', () => deps.onDuplicate(id), false, '', null],
      ['삭제', () => deps.onDelete(id), false, '', null],
      ['본문 배치 ⇄ 자유 배치 전환', () => deps.onFlowFloat(id), false, '', null],
      ['내 블록으로 저장', () => deps.onSaveAsPreset(id), false, '', null],
      ['앞으로 보내기', null, true, '(스파이크 §4-5 후속)', null],
      ['뒤로 보내기', null, true, '(스파이크 §4-5 후속)', null],
    ];
    for (const [label, action, disabled, suffix, itemId] of items) {
      const b = document.createElement('button');
      b.textContent = disabled ? `${label}${suffix}` : label;
      b.disabled = disabled;
      if (itemId) b.id = itemId;
      if (action) b.addEventListener('click', () => { closeAll(popupsHost); action(); });
      menu.appendChild(b);
    }
    popupsHost.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => closeAll(popupsHost), { once: true }), 0);
  }

  function attach(doc, frameEl) {
    currentDoc = doc;
    currentFrame = frameEl;
    decorateFlowHandles(doc);
    decorateRulers(doc);
    scheduleHandleReflow(doc);

    // 가리키는 개체의 조작 칩만 드러낸다. 끌고 있는 동안에는 갱신하지 않는다 — 포인터가 개체를
    // 벗어나는 순간 잡고 있던 칩이 사라져 보이는 것을 막는다(칩 자체는 캡처 중이라 계속 동작한다).
    doc.addEventListener('pointermove', (e) => {
      if (dragState) return;
      const chip = e.target.closest?.('.wg-flow-handle, .wg-flow-insert');
      const objEl = e.target.closest?.('.wg-obj[data-oid]');
      setHotOid(doc, chip?.dataset.forOid ?? objEl?.dataset.oid ?? null);
    });
    doc.documentElement.addEventListener('pointerleave', () => setHotOid(doc, null));

    doc.addEventListener('selectionchange', () => updateBubble());
    doc.addEventListener('mouseup', () => updateBubble());

    // ── 본체 드래그 재정렬(arm → promote) ──
    // pointerdown 에서는 **arm 만** 한다. 여기서 preventDefault 를 부르면 클릭 선택과 더블클릭
    // 편집 진입이 함께 죽으므로 절대 부르지 않는다 — 대신 임계(5px)를 넘는 pointermove 가 와야
    // 승격한다. 마퀴(selection.js)와는 조건이 배타적이다: 마퀴는 `[data-oid]` 위에서 양보하고
    // 여기는 `.wg-obj[data-oid]` 가 없으면 arm 하지 않는다.
    let armed = null;

    const endBodyDrag = () => {
      const wasArmed = !!armed;
      armed = null;
      // 드래그 상태의 **최종 청소부**. onUp 은 captureEl(.sheet)이나 문서에 걸리는데, 리플로우가
      // 드래그 중에 끼어들면 reloadTeacherFrame 이 body.innerHTML 을 통째로 갈아 그 .sheet 가
      // detach 된다 — 그러면 onUp 이 영영 오지 않고 dragState 가 남아 **이후 모든 본체 드래그가
      // 조용히 막힌다**(실측으로 재현한 고착). 이 리스너는 문서에 걸려 있어 항상 오므로 여기서
      // 끊는다. 정상 경로에서는 onUp 이 먼저 돌아 이미 null 이라 무해하다.
      dragState = null;
      const wasDragging = doc.body.classList.contains('wg-body-dragging');
      if (wasDragging) doc.body.classList.remove('wg-body-dragging');
      for (const el of doc.querySelectorAll('.wg-flow-dragging')) el.classList.remove('wg-flow-dragging');
      // 임계 미달로 승격되지 않았어도 arm 구간(≤5px)에서 네이티브 텍스트 선택이 생겼을 수 있다.
      // arm 자체가 없었으면(편집 중·핸들·float·빈 여백) 건드리지 않는다 — 정상 텍스트 선택 보호.
      if (wasArmed || wasDragging) doc.defaultView.getSelection()?.removeAllRanges();
    };

    doc.addEventListener('pointerdown', (e) => {
      const sizeHandle = e.target.closest('.wg-size-handle');
      if (sizeHandle) { startSizeDrag(e, sizeHandle); return; }
      const handle = e.target.closest('.wg-flow-handle');
      if (handle) { startFlowDrag(e, { id: handle.dataset.forOid, captureEl: handle }); return; }
      const objEl = e.target.closest('.wg-obj[data-oid]');
      const sheet = objEl?.closest('.sheet');
      if (!shouldPromoteBodyDrag({
        button: e.button,
        editingId: deps.getSelectionState().editingId,
        blockedBySelector: !!e.target.closest(NO_BODY_DRAG),
        isFloat: !!e.target.closest('.wg-float'),
        hasObj: !!(objEl && sheet),
        dx: Infinity, dy: Infinity, // arm 단계에서는 임계를 보지 않는다(가드만 재사용)
      })) return;
      armed = { id: objEl.dataset.oid, sheet, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    });

    doc.addEventListener('pointermove', (e) => {
      // dragState 가 남아 있어도 그 개체가 문서에서 떨어져 나갔으면 죽은 드래그다(리플로우가
      // body.innerHTML 을 갈아치운 경우) — 스테일로 보고 끊는다. 이 가드가 없으면 한 번 고착된
      // 뒤로 본체 드래그가 영구히 안 된다.
      if (dragState && !dragState.objEl?.isConnected) dragState = null;
      if (!armed || dragState || e.pointerId !== armed.pointerId) return;
      if (!shouldPromoteBodyDrag({ dx: e.clientX - armed.x, dy: e.clientY - armed.y })) return;
      const a = armed;
      armed = null;
      // 승격 전 5px 구간에 브라우저 네이티브 텍스트 선택이 이미 시작됐을 수 있다(실측: 10스텝
      // 드래그에 23자). removeAllRanges 가 진행 중 제스처를 실제로 끊고, user-select:none 이
      // 재시작을 막는다. user-select 는 레이아웃 박스를 바꾸지 않아 R2-1(편집==인쇄) 안전.
      doc.body.classList.add('wg-body-dragging');
      doc.defaultView.getSelection()?.removeAllRanges();
      startFlowDrag(e, { id: a.id, captureEl: a.sheet, bodyDrag: true });
    });

    doc.addEventListener('pointerup', endBodyDrag);
    doc.addEventListener('pointercancel', endBodyDrag);

    doc.addEventListener('click', (e) => {
      const plus = e.target.closest('.wg-flow-insert');
      if (!plus) return;
      const rect = plus.getBoundingClientRect();
      openSlashMenu(rect, plus.dataset.forOid);
    });

    doc.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('[data-oid]');
      if (!el) return;
      openContextMenu(e, el.dataset.oid);
    });

    // `/` = 슬래시 메뉴(현재 편집 중인 개체 뒤에 삽입). 문자 자체는 본문에 남기지 않는다.
    doc.addEventListener('keydown', (e) => {
      if (e.key !== '/') return;
      const { editingId } = deps.getSelectionState();
      if (!editingId) return;
      e.preventDefault();
      const sel = doc.defaultView.getSelection();
      let caretRect = { left: 0, bottom: 0 };
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).cloneRange();
        const rects = r.getClientRects();
        if (rects.length > 0) caretRect = rects[0];
      }
      openSlashMenu(caretRect, editingId);
    });
  }

  function refreshDecoration() {
    if (currentDoc) { decorateFlowHandles(currentDoc); decorateRulers(currentDoc); }
  }

  return { attach, refreshDecoration, closeAll: () => closeAll(popupsHost) };
}
