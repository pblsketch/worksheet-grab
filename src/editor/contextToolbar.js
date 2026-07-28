// contextToolbar.js — editor-v4 S4.3 컨텍스트 툴바. 좌측 undo/redo·우측 줌/보기 메뉴는 고정,
// 가운데는 선택 상태에 따라 통째로 교체한다(빠른 삽입 / 텍스트 서식 / 표 / 이미지 / 도형 / 공통).
//
// richtext + title/question 편집 중에만 B/I/U·색·정렬·글꼴 서식이 활성화된다 — 이 세 타입은
// 서식 보존 필드(richtext.html · title.textHtml · question.promptHtml)로 살균 HTML 을 되읽어
// 태그가 유지된다(selection.js syncEditingField). answer-area 등 나머지 평문 필드는 textContent 만
// 읽어 태그가 소실되므로 서식 버튼을 비활성화한다.

import { icon } from './icons.js';
import { CATALOG_ITEMS } from './objectFactory.js';
import { PLACEMENT_TOGGLEABLE_TYPES } from '/src/domain/schema/index.js';

function btn({ id, title, iconName, label, onClick, disabled = false }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tb-btn';
  if (id) b.id = id;
  b.title = title || label || '';
  b.disabled = disabled;
  b.innerHTML = iconName ? icon(iconName) : '';
  if (label) b.innerHTML += `<span>${label}</span>`;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const QUICK_INSERT_KEYS = ['title', 'richtext', 'table', 'image-slot', 'question:short-answer', 'shape'];

// 폰트 컨트롤(#3) — 자유 텍스트(richtext) 편집 중에만 서식이 보존된다(us16.md 한계와 동형).
// value 는 CSS font-family / font-size 그대로 넘긴다.
const FONT_FAMILIES = [
  ['', '글꼴'], ['Pretendard, sans-serif', 'Pretendard'], ['"Malgun Gothic","맑은 고딕",sans-serif', '맑은 고딕'],
  ['"NanumGothic","나눔고딕",sans-serif', '나눔고딕'], ['Batang,"바탕",serif', '바탕'],
  ['Dotum,"돋움",sans-serif', '돋움'], ['Gulim,"굴림",sans-serif', '굴림'],
];
const FONT_SIZES = ['', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt'];

function selectEl({ id, options, title, disabled, onChange }) {
  const sel = document.createElement('select');
  sel.className = 'tb-select';
  if (id) sel.id = id;
  if (title) sel.title = title;
  sel.disabled = disabled;
  for (const opt of options) {
    const [value, label] = Array.isArray(opt) ? opt : [opt, opt || '크기'];
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { if (sel.value) onChange(sel.value); sel.selectedIndex = 0; });
  return sel;
}

// 색상 컨트롤(US-E4) — 무엇을 바꾸는지 식별되도록 텍스트 라벨 + title 을 붙인 색상 입력.
// raw <input type=color> 스와치만 두면 글자색인지 채우기인지 알 수 없다.
function colorField({ id, title, label, value, disabled = false, onInput }) {
  const wrap = document.createElement('label');
  wrap.className = 'tb-color-field';
  wrap.title = title;
  wrap.appendChild(document.createTextNode(label));
  const input = document.createElement('input');
  input.type = 'color';
  input.id = id;
  input.title = title;
  if (value) input.value = value;
  input.disabled = disabled;
  input.addEventListener('input', () => onInput(input.value));
  wrap.appendChild(input);
  return wrap;
}

/**
 * @param {{
 *   root: HTMLElement, // 툴바 루트 — 좌(#tb-left)·가운데(#tb-middle)·우(#tb-right) 컨테이너 포함
 *   history: {undo, redo, canUndo, canRedo},
 *   onQuickInsert: (item:object)=>void,
 *   onDuplicate: (id:string)=>void, onDelete: (id:string)=>void, onFlowFloat: (id:string)=>void,
 *   onFormat: (cmd:'bold'|'italic'|'underline'|'foreColor'|'justifyLeft'|'justifyCenter'|'justifyRight', value?:string)=>void,
 *   onAnswerToggle: (id:string)=>void,
 *   onTableRow: (action:'add-row'|'del-row'|'add-col'|'del-col')=>void,
 *   onImageReplace: (id:string)=>void,
 *   onShapeColor: (kind:'stroke'|'fill', hex:string)=>void,
 *   onZoom: (pct:number)=>void,
 *   onViewToggle: (key:'margins'|'ruler'|'grid')=>void,
 *   onZOrder?: (id:string, mode:'front'|'back'|'forward'|'backward')=>void, // float z-순서(배열 위치)
 *   excludedAiTypes: Set<string>, // US-19 — std-box(§7, 원칙 3) 는 AI 버튼 비활성(passage-slot 은
 *   3층 정책, 2026-07-23 2차 델타로 해제)
 *   onAiOpen: (id:string)=>void,  // US-19 — AI 패널을 이 개체로 연다
 * }} opts
 */
export function createContextToolbar(opts) {
  const { root, history } = opts;
  const excludedAiTypes = opts.excludedAiTypes || new Set();
  const left = root.querySelector('#tb-left');
  const middle = root.querySelector('#tb-middle');
  const right = root.querySelector('#tb-right');

  // 왼쪽 패널(페이지·삽입·내 블록) 접기/펼치기 — 캔버스 공간 확보. 상태·지속은 editor.js 소유.
  left.appendChild(btn({ id: 'tb-toggle-left', title: '왼쪽 패널 접기/펼치기', iconName: 'panelLeft', onClick: () => opts.onTogglePanel?.('left') }));
  left.appendChild(btn({ id: 'tb-undo', title: '실행 취소 (Ctrl+Z)', iconName: 'undo', onClick: () => { history.undo(); opts.onStateChange?.(); } }));
  left.appendChild(btn({ id: 'tb-redo', title: '다시 실행 (Ctrl+Shift+Z)', iconName: 'redo', onClick: () => { history.redo(); opts.onStateChange?.(); } }));

  // 우측: 줌(50~200%) + 보기 메뉴(여백선·눈금자·격자)
  let zoomPct = 100;
  const zoomOut = btn({ id: 'tb-zoom-out', title: '축소', iconName: 'zoomOut', onClick: () => setZoom(zoomPct - 10) });
  const zoomLabel = document.createElement('span');
  zoomLabel.id = 'tb-zoom-label';
  zoomLabel.className = 'tb-zoom-label';
  zoomLabel.textContent = '100%';
  const zoomIn = btn({ id: 'tb-zoom-in', title: '확대', iconName: 'zoomIn', onClick: () => setZoom(zoomPct + 10) });
  function setZoom(pct) {
    zoomPct = Math.max(50, Math.min(200, pct));
    zoomLabel.textContent = `${zoomPct}%`;
    opts.onZoom(zoomPct);
  }
  right.appendChild(zoomOut);
  right.appendChild(zoomLabel);
  right.appendChild(zoomIn);

  const viewBtn = btn({ id: 'tb-view-menu', title: '보기', iconName: 'grid', label: '보기' });
  right.appendChild(viewBtn);
  const viewMenu = document.createElement('div');
  viewMenu.id = 'tb-view-dropdown';
  viewMenu.className = 'view-dropdown hidden';
  const viewState = { margins: true, ruler: true, grid: false };
  for (const [key, label] of [['margins', '여백선'], ['ruler', '눈금자(상·좌 cm)'], ['grid', '격자(5mm)']]) {
    const label2 = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = viewState[key];
    cb.dataset.viewKey = key;
    cb.addEventListener('change', () => { viewState[key] = cb.checked; opts.onViewToggle(key, cb.checked); });
    label2.appendChild(cb);
    label2.appendChild(document.createTextNode(label));
    viewMenu.appendChild(label2);
  }
  // 격자 투명도 슬라이더(#1) — 0.02~0.35 알파. 슬라이더 조작 시 격자를 자동으로 켠다.
  const opRow = document.createElement('label');
  opRow.className = 'view-op-row';
  opRow.appendChild(document.createTextNode('격자 진하기'));
  const opSlider = document.createElement('input');
  opSlider.type = 'range'; opSlider.id = 'tb-grid-alpha';
  opSlider.min = '2'; opSlider.max = '35'; opSlider.step = '1'; opSlider.value = '8';
  opSlider.addEventListener('input', () => {
    opts.onGridOpacity?.(Number(opSlider.value) / 100);
    const gridCb = viewMenu.querySelector('input[data-view-key="grid"]');
    if (gridCb && !gridCb.checked) { gridCb.checked = true; viewState.grid = true; opts.onViewToggle('grid', true); }
  });
  opRow.appendChild(opSlider);
  viewMenu.appendChild(opRow);
  right.appendChild(viewMenu);
  // 오른쪽 패널(인스펙터) 접기/펼치기 — 툴바 우측 끝에 둔다(인스펙터는 replaceChildren 로 내용을
  // 갈아끼우므로 패널 내부에 정적 토글을 둘 수 없다).
  right.appendChild(btn({ id: 'tb-toggle-right', title: '오른쪽 패널 접기/펼치기', iconName: 'panelRight', onClick: () => opts.onTogglePanel?.('right') }));
  // 위치(#보기): CSS 매직 offset 대신 보기 버튼 rect 기준으로 버튼 바로 아래에 고정 배치한다.
  function openViewMenu() {
    const r = viewBtn.getBoundingClientRect();
    viewMenu.style.top = `${Math.round(r.bottom + 4)}px`;
    viewMenu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    viewMenu.classList.remove('hidden');
  }
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (viewMenu.classList.contains('hidden')) openViewMenu();
    else viewMenu.classList.add('hidden');
  });
  // 닫힘(#보기): 바깥 클릭에서만 닫는다 — 메뉴/버튼 내부(체크박스·슬라이더) 클릭엔 유지한다
  // (기존엔 상시 document 리스너가 내부 클릭까지 닫아, 토글 하나 켤 때마다 메뉴가 사라졌다).
  document.addEventListener('click', (e) => {
    if (viewMenu.classList.contains('hidden')) return;
    if (viewMenu.contains(e.target) || viewBtn.contains(e.target)) return;
    viewMenu.classList.add('hidden');
  });

  function updateUndoRedo() {
    left.querySelector('#tb-undo').disabled = !history.canUndo();
    left.querySelector('#tb-redo').disabled = !history.canRedo();
  }

  function commonObjectButtons(obj) {
    const id = obj.id;
    const wrap = document.createElement('div');
    wrap.className = 'tb-group tb-common';
    wrap.appendChild(btn({
      title: excludedAiTypes.has(obj.type) ? 'AI 로 편집(성취기준·저작권 슬롯은 제외)' : 'AI 로 편집',
      label: 'AI', id: 'tb-ai', disabled: excludedAiTypes.has(obj.type), onClick: () => opts.onAiOpen(id),
    }));
    wrap.appendChild(btn({ title: '복제', iconName: 'copy', id: 'tb-duplicate', onClick: () => opts.onDuplicate(id) }));
    wrap.appendChild(btn({ title: '삭제', iconName: 'trash', id: 'tb-delete', onClick: () => opts.onDelete(id) }));
    // 인스펙터와 같은 판정 — 두 배치를 다 지원하는 타입에만 낸다(무동작 버튼 금지).
    if (PLACEMENT_TOGGLEABLE_TYPES.includes(obj.type)) {
      wrap.appendChild(btn({ title: '본문 배치 ⇄ 자유 배치 전환', iconName: 'layers', id: 'tb-flowfloat', onClick: () => opts.onFlowFloat(id) }));
    }
    // z-순서(맨앞/맨뒤) — 자유 배치(float) 개체 전용. 겹친 자유 개체의 앞뒤를 바꾼다(같은 페이지
    // float[] 배열 위치 = 페인트 순서, 편집 캔버스=인쇄 동일). flow 개체는 좌표·겹침이 없어 미노출.
    if (obj.placement === 'float') {
      wrap.appendChild(btn({ title: '맨 앞으로', label: '맨앞', id: 'tb-z-front', onClick: () => opts.onZOrder?.(id, 'front') }));
      wrap.appendChild(btn({ title: '한 단계 앞으로', label: '앞으로', id: 'tb-z-forward', onClick: () => opts.onZOrder?.(id, 'forward') }));
      wrap.appendChild(btn({ title: '한 단계 뒤로', label: '뒤로', id: 'tb-z-backward', onClick: () => opts.onZOrder?.(id, 'backward') }));
      wrap.appendChild(btn({ title: '맨 뒤로', label: '맨뒤', id: 'tb-z-back', onClick: () => opts.onZOrder?.(id, 'back') }));
    }
    return wrap;
  }

  /**
   * @param {{mode:'empty'|'text'|'table'|'image'|'shape'|'object'|'multi', obj?:object, ids?:string[],
   *   editingType?:string|null, editable?:boolean}} state
   */
  function render(state) {
    root.dataset.tbMode = state.mode;
    middle.replaceChildren();
    updateUndoRedo();

    if (state.mode === 'empty') {
      for (const key of QUICK_INSERT_KEYS) {
        const item = CATALOG_ITEMS.find((c) => c.key === key);
        if (!item) continue;
        middle.appendChild(btn({
          title: `빠른 삽입 · ${item.label}`, label: item.label, id: `tb-quick-${item.type}${item.qtype ? `-${item.qtype}` : ''}`,
          onClick: () => opts.onQuickInsert(item),
        }));
      }
      return;
    }

    if (state.mode === 'multi') {
      middle.appendChild(document.createTextNode(`${(state.ids || []).length}개 선택됨 — 정렬/분배는 우측 인스펙터`));
      return;
    }

    const obj = state.obj;
    // 인라인 서식이 실제로 보존되는 편집 타입(richtext + title/question — textHtml/promptHtml 서식
    // 보존 필드). 이 타입을 편집 중일 때만 서식 버튼을 활성화한다.
    const isTextFormatting = ['richtext', 'title', 'question'].includes(state.editingType);
    if (obj?.type === 'table') {
      const g = document.createElement('div');
      g.className = 'tb-group';
      g.appendChild(btn({ title: '행 추가', label: '+행', id: 'tb-add-row', onClick: () => opts.onTableRow('add-row') }));
      g.appendChild(btn({ title: '행 삭제', label: '-행', id: 'tb-del-row', onClick: () => opts.onTableRow('del-row') }));
      g.appendChild(btn({ title: '열 추가', label: '+열', id: 'tb-add-col', onClick: () => opts.onTableRow('add-col') }));
      g.appendChild(btn({ title: '열 삭제', label: '-열', id: 'tb-del-col', onClick: () => opts.onTableRow('del-col') }));
      g.appendChild(btn({ title: '헤더 토글', label: '헤더', id: 'tb-toggle-header', onClick: () => opts.onTableRow('toggle-header') }));
      middle.appendChild(g);
      // 셀 병합/분할(#10) — 셀을 클릭해 활성 셀을 고른 뒤 병합한다. 셀 편집은 캔버스에서 셀 더블클릭.
      const g2 = document.createElement('div');
      g2.className = 'tb-group';
      g2.appendChild(btn({ title: '오른쪽 셀과 병합', label: '병합→', id: 'tb-merge-right', onClick: () => opts.onTableMerge?.('right') }));
      g2.appendChild(btn({ title: '아래 셀과 병합', label: '병합↓', id: 'tb-merge-down', onClick: () => opts.onTableMerge?.('down') }));
      g2.appendChild(btn({ title: '병합 해제', label: '병합해제', id: 'tb-merge-split', onClick: () => opts.onTableMerge?.('split') }));
      middle.appendChild(g2);
    } else if (obj?.type === 'image-slot') {
      const g = document.createElement('div');
      g.className = 'tb-group';
      g.appendChild(btn({ title: '이미지 교체', label: '교체', id: 'tb-image-replace', onClick: () => opts.onImageReplace(obj.id) }));
      middle.appendChild(g);
    } else if (obj?.type === 'shape') {
      const g = document.createElement('div');
      g.className = 'tb-group';
      g.appendChild(colorField({
        id: 'tb-shape-stroke', title: '선 색', label: '선',
        value: /^#[0-9a-f]{6}$/i.test(obj.strokeColor) ? obj.strokeColor : '#111827',
        onInput: (v) => opts.onShapeColor('stroke', v),
      }));
      g.appendChild(colorField({
        id: 'tb-shape-fill', title: '채우기 색', label: '채움',
        value: /^#[0-9a-f]{6}$/i.test(obj.fillColor) ? obj.fillColor : '#ffffff',
        onInput: (v) => opts.onShapeColor('fill', v),
      }));
      middle.appendChild(g);
    } else {
      // 텍스트 서식(richtext 편집 중에만 실제 적용) — title/question/answer-area 도 편집 중엔
      // 버튼을 노출하되 disabled(us16.md 한계 안내, 상세 서식은 후속 스토리).
      const g = document.createElement('div');
      g.className = 'tb-group';
      // 폰트 종류·크기(#3) — 자유 텍스트 편집 중에만 활성.
      g.appendChild(selectEl({
        id: 'tb-font-family', options: FONT_FAMILIES, title: '글꼴', disabled: !isTextFormatting,
        onChange: (v) => opts.onFont?.('family', v),
      }));
      g.appendChild(selectEl({
        id: 'tb-font-size', options: FONT_SIZES, title: '글자 크기', disabled: !isTextFormatting,
        onChange: (v) => opts.onFont?.('size', v),
      }));
      g.appendChild(btn({ title: '굵게', iconName: 'bold', id: 'tb-bold', disabled: !isTextFormatting, onClick: () => opts.onFormat('bold') }));
      g.appendChild(btn({ title: '기울임', iconName: 'italic', id: 'tb-italic', disabled: !isTextFormatting, onClick: () => opts.onFormat('italic') }));
      g.appendChild(btn({ title: '밑줄', iconName: 'underline', id: 'tb-underline', disabled: !isTextFormatting, onClick: () => opts.onFormat('underline') }));
      g.appendChild(colorField({
        id: 'tb-color', title: '글자 색', label: '글자색', disabled: !isTextFormatting,
        onInput: (v) => opts.onFormat('foreColor', v),
      }));
      g.appendChild(btn({ title: '왼쪽 정렬', iconName: 'alignLeft', id: 'tb-align-left', disabled: !isTextFormatting, onClick: () => opts.onFormat('justifyLeft') }));
      g.appendChild(btn({ title: '가운데 정렬', iconName: 'alignCenter', id: 'tb-align-center', disabled: !isTextFormatting, onClick: () => opts.onFormat('justifyCenter') }));
      g.appendChild(btn({ title: '오른쪽 정렬', iconName: 'alignRight', id: 'tb-align-right', disabled: !isTextFormatting, onClick: () => opts.onFormat('justifyRight') }));
      // 서식 확장(목록·형광펜·링크·서식지우기) — richtext 편집 중에만 실제 보존(자유 텍스트 field:'html'
      // 직결). 형광펜(hiliteColor)은 paper.css 의 print-color-adjust:exact 로 인쇄에도 반영된다.
      g.appendChild(btn({ title: '불릿 목록', iconName: 'list', id: 'tb-list-ul', disabled: !isTextFormatting, onClick: () => opts.onFormat('insertUnorderedList') }));
      g.appendChild(btn({ title: '번호 목록', iconName: 'listOrdered', id: 'tb-list-ol', disabled: !isTextFormatting, onClick: () => opts.onFormat('insertOrderedList') }));
      g.appendChild(btn({ title: '형광펜', iconName: 'highlighter', id: 'tb-highlight', disabled: !isTextFormatting, onClick: () => opts.onFormat('hiliteColor', '#fff59d') }));
      g.appendChild(btn({ title: '링크', iconName: 'link', id: 'tb-link', disabled: !isTextFormatting, onClick: () => opts.onLink?.() }));
      g.appendChild(btn({ title: '서식 지우기', iconName: 'eraser', id: 'tb-clear-format', disabled: !isTextFormatting, onClick: () => opts.onFormat('removeFormat') }));
      middle.appendChild(g);
    }

    // 편집 발견성 힌트(US-E4) — 더블클릭으로 편집 가능한 개체를 선택했고 아직 편집 중이 아니면
    // "더블클릭하여 편집" 안내를 노출한다(비편집 타입 std-box/표/이미지/도형/구분선엔 노출 안 함).
    if (obj && state.editable && !state.editingType) {
      const hint = document.createElement('span');
      hint.id = 'tb-edit-hint';
      hint.className = 'tb-edit-hint';
      hint.textContent = '더블클릭하여 편집';
      middle.appendChild(hint);
    }

    if (obj) {
      const answerBtn = btn({ title: '정답 토글', iconName: 'star', id: 'tb-answer-toggle', onClick: () => opts.onAnswerToggle(obj.id) });
      answerBtn.classList.toggle('active', obj.answer === true);
      middle.appendChild(answerBtn);
      middle.appendChild(commonObjectButtons(obj));
    }
  }

  return { render, updateUndoRedo };
}
