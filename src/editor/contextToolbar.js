// contextToolbar.js — editor-v4 S4.3 컨텍스트 툴바. 좌측 undo/redo·우측 줌/보기 메뉴는 고정,
// 가운데는 선택 상태에 따라 통째로 교체한다(빠른 삽입 / 텍스트 서식 / 표 / 이미지 / 도형 / 공통).
//
// richtext 개체만 B/I/U·색·정렬 서식이 실제로 보존된다(us16.md 기록 한계 — title/question/
// answer-area 는 평문 필드라 서식을 걸어도 동기화 시 textContent 만 읽어 태그가 소실된다,
// selection.js EDIT_FIELD 주석과 동형). 이 툴바는 그 한계를 그대로 존중해 richtext 편집 중에만
// 서식 버튼을 활성화한다(상세 서식 필드별 재설계는 이번 스토리 범위 밖).

import { icon } from './icons.js';
import { CATALOG_ITEMS } from './objectFactory.js';

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
  for (const [key, label] of [['margins', '여백선'], ['ruler', '눈금자'], ['grid', '격자']]) {
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
  right.appendChild(viewMenu);
  viewBtn.addEventListener('click', (e) => { e.stopPropagation(); viewMenu.classList.toggle('hidden'); });
  document.addEventListener('click', () => viewMenu.classList.add('hidden'));

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
    wrap.appendChild(btn({ title: 'flow⇄float 전환', iconName: 'layers', id: 'tb-flowfloat', onClick: () => opts.onFlowFloat(id) }));
    return wrap;
  }

  /**
   * @param {{mode:'empty'|'text'|'table'|'image'|'shape'|'object'|'multi', obj?:object, ids?:string[], editingType?:string|null}} state
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
    const isRichtextEditing = state.editingType === 'richtext';
    if (obj?.type === 'table') {
      const g = document.createElement('div');
      g.className = 'tb-group';
      g.appendChild(btn({ title: '행 추가', label: '+행', id: 'tb-add-row', onClick: () => opts.onTableRow('add-row') }));
      g.appendChild(btn({ title: '행 삭제', label: '-행', id: 'tb-del-row', onClick: () => opts.onTableRow('del-row') }));
      g.appendChild(btn({ title: '열 추가', label: '+열', id: 'tb-add-col', onClick: () => opts.onTableRow('add-col') }));
      g.appendChild(btn({ title: '열 삭제', label: '-열', id: 'tb-del-col', onClick: () => opts.onTableRow('del-col') }));
      g.appendChild(btn({ title: '헤더 토글', label: '헤더', id: 'tb-toggle-header', onClick: () => opts.onTableRow('toggle-header') }));
      middle.appendChild(g);
    } else if (obj?.type === 'image-slot') {
      const g = document.createElement('div');
      g.className = 'tb-group';
      g.appendChild(btn({ title: '이미지 교체', label: '교체', id: 'tb-image-replace', onClick: () => opts.onImageReplace(obj.id) }));
      middle.appendChild(g);
    } else if (obj?.type === 'shape') {
      const g = document.createElement('div');
      g.className = 'tb-group';
      const stroke = document.createElement('input');
      stroke.type = 'color'; stroke.id = 'tb-shape-stroke';
      stroke.value = /^#[0-9a-f]{6}$/i.test(obj.strokeColor) ? obj.strokeColor : '#111827';
      stroke.addEventListener('input', () => opts.onShapeColor('stroke', stroke.value));
      const fill = document.createElement('input');
      fill.type = 'color'; fill.id = 'tb-shape-fill';
      fill.value = /^#[0-9a-f]{6}$/i.test(obj.fillColor) ? obj.fillColor : '#ffffff';
      fill.addEventListener('input', () => opts.onShapeColor('fill', fill.value));
      g.appendChild(stroke);
      g.appendChild(fill);
      middle.appendChild(g);
    } else {
      // 텍스트 서식(richtext 편집 중에만 실제 적용) — title/question/answer-area 도 편집 중엔
      // 버튼을 노출하되 disabled(us16.md 한계 안내, 상세 서식은 후속 스토리).
      const g = document.createElement('div');
      g.className = 'tb-group';
      g.appendChild(btn({ title: '굵게', iconName: 'bold', id: 'tb-bold', disabled: !isRichtextEditing, onClick: () => opts.onFormat('bold') }));
      g.appendChild(btn({ title: '기울임', iconName: 'italic', id: 'tb-italic', disabled: !isRichtextEditing, onClick: () => opts.onFormat('italic') }));
      g.appendChild(btn({ title: '밑줄', iconName: 'underline', id: 'tb-underline', disabled: !isRichtextEditing, onClick: () => opts.onFormat('underline') }));
      const color = document.createElement('input');
      color.type = 'color'; color.id = 'tb-color'; color.disabled = !isRichtextEditing;
      color.addEventListener('input', () => opts.onFormat('foreColor', color.value));
      g.appendChild(color);
      g.appendChild(btn({ title: '왼쪽 정렬', iconName: 'alignLeft', id: 'tb-align-left', disabled: !isRichtextEditing, onClick: () => opts.onFormat('justifyLeft') }));
      g.appendChild(btn({ title: '가운데 정렬', iconName: 'alignCenter', id: 'tb-align-center', disabled: !isRichtextEditing, onClick: () => opts.onFormat('justifyCenter') }));
      g.appendChild(btn({ title: '오른쪽 정렬', iconName: 'alignRight', id: 'tb-align-right', disabled: !isRichtextEditing, onClick: () => opts.onFormat('justifyRight') }));
      middle.appendChild(g);
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
