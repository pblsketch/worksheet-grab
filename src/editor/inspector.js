// inspector.js — editor-v4 S4.3 우측 인스펙터. 선택 상태에 반응해 3섹션을 교체한다.
//   선택 없음   → 문서 설정(용지 프리셋·방향·단·여백, /paper 재배선) + 검수 상세 목록
//   단일 선택   → 타입 이름·위치/크기(float 시 mm)·flow⇄float·answer 토글·타입별 속성
//   다중 선택   → 정렬 6종 + 균등 분배(float 한정)
//
// DOM 은 이 모듈이 직접 만들고(root.replaceChildren), 값 변경은 콜백으로만 상위(editor.js)에
// 알린다 — history 커밋·리플로우 트리거는 이 모듈의 관심사가 아니다(관심사 분리, selection.js
// 관례와 동형).

import { icon } from './icons.js';
import { QTYPE_LABELS, SHAPE_KINDS, ANSWER_AREA_STYLES } from './objectFactory.js';
import { ANSWERABLE_TYPES, QUESTION_TYPES } from '/src/domain/schema/index.js';
import { PAPER_PRESETS, resolvePaper, matchPreset } from '/src/usecases/paper.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

const ALIGN_BUTTONS = [
  ['left', '왼쪽 정렬', 'alignLeft'], ['center-h', '가로 가운데', 'alignCenter'], ['right', '오른쪽 정렬', 'alignRight'],
  ['top', '위 정렬', 'alignLeft'], ['middle-v', '세로 가운데', 'alignCenter'], ['bottom', '아래 정렬', 'alignRight'],
];

/**
 * @param {{
 *   root: HTMLElement,
 *   onPaperChange: (paper:object|null)=>void,
 *   onPatchObject: (id:string, patch:object)=>void,
 *   onToggleFlowFloat: (id:string)=>void,
 *   onToggleAnswer: (id:string)=>void,
 *   onAlign: (ids:string[], mode:string)=>void,
 *   onImageUpload: (id:string, file:File)=>void,
 * }} opts
 */
export function createInspector({ root, onPaperChange, onPatchObject, onToggleFlowFloat, onToggleAnswer, onAlign, onImageUpload }) {
  function render(state) {
    root.dataset.inspMode = state.mode;
    root.replaceChildren();
    if (state.mode === 'object') renderSingle(state.obj);
    else if (state.mode === 'multi') renderMulti(state.ids, state.allFloat);
    else renderDocument(state.paper, state.findings || []);
  }

  // ── 선택 없음: 문서 설정 + 검수 상세 ──
  function renderDocument(paper, findings) {
    const resolved = resolvePaper(paper) ?? resolvePaper({ size: 'A4' });
    const presetId = matchPreset(paper);
    root.appendChild(el('h3', { text: '문서 설정' }));

    const presetSel = el('select', { id: 'insp-paper-preset' });
    for (const p of PAPER_PRESETS) presetSel.appendChild(el('option', { value: p.id, text: p.label, selected: p.id === presetId ? 'selected' : null }));
    presetSel.appendChild(el('option', { value: 'custom', text: '사용자 지정', selected: presetId === 'custom' ? 'selected' : null }));
    presetSel.addEventListener('change', () => {
      const found = PAPER_PRESETS.find((p) => p.id === presetSel.value);
      if (found) onPaperChange(found.paper);
    });
    root.appendChild(field('용지 프리셋', presetSel));

    const orientSel = el('select', { id: 'insp-orientation' });
    orientSel.appendChild(el('option', { value: 'portrait', text: '세로', selected: resolved.orientation === 'portrait' ? 'selected' : null }));
    orientSel.appendChild(el('option', { value: 'landscape', text: '가로', selected: resolved.orientation === 'landscape' ? 'selected' : null }));
    orientSel.addEventListener('change', () => onPaperChange({ ...resolved, orientation: orientSel.value }));
    root.appendChild(field('방향', orientSel));

    const colsInput = el('input', { type: 'number', min: '1', max: '4', id: 'insp-columns', value: String(resolved.columns) });
    colsInput.addEventListener('change', () => onPaperChange({ ...resolved, columns: Math.max(1, Number(colsInput.value) || 1) }));
    root.appendChild(field('단 수', colsInput));

    const marginsInput = el('input', { type: 'text', id: 'insp-margins', value: resolved.margins });
    marginsInput.addEventListener('change', () => onPaperChange({ ...resolved, margins: marginsInput.value }));
    root.appendChild(field('여백(mm)', marginsInput));

    root.appendChild(el('h3', { text: '검수 상세', style: 'margin-top:16px' }));
    const list = el('ul', { class: 'review-detail', id: 'insp-review-list' });
    if (findings.length === 0) {
      list.appendChild(el('li', { class: 'review-ok', text: '문제가 발견되지 않았습니다.' }));
    } else {
      for (const f of findings) {
        list.appendChild(el('li', { class: `review-${f.severity || 'error'}`, text: `[${f.rule}] ${f.message || ''}` }));
      }
    }
    root.appendChild(list);
  }

  // ── 단일 선택 ──
  function renderSingle(obj) {
    root.appendChild(el('h3', { text: `개체 · ${obj.type}`, 'data-insp-type': obj.type }));

    if (obj.placement === 'float' && obj.rect) {
      const grid = el('div', { class: 'insp-grid4' });
      for (const [key, label] of [['xMm', 'X'], ['yMm', 'Y'], ['wMm', 'W'], ['hMm', 'H']]) {
        const input = el('input', { type: 'number', step: '0.5', 'data-rect-key': key, value: String(obj.rect[key]) });
        input.addEventListener('change', () => onPatchObject(obj.id, { rect: { ...obj.rect, [key]: Number(input.value) || 0 } }));
        grid.appendChild(field(label, input, true));
      }
      root.appendChild(grid);
    }

    const flowFloatBtn = el('button', {
      type: 'button', id: 'insp-flowfloat-toggle', class: 'insp-btn',
      html: `${icon('layers')}<span>${obj.placement === 'float' ? 'flow 로 전환' : 'float 로 전환'}</span>`,
      onclick: () => onToggleFlowFloat(obj.id),
    });
    root.appendChild(flowFloatBtn);

    if (ANSWERABLE_TYPES.includes(obj.type)) {
      const label = el('label', { class: 'insp-check' });
      const cb = el('input', { type: 'checkbox', id: 'insp-answer-toggle' });
      cb.checked = obj.answer === true;
      cb.addEventListener('change', () => onToggleAnswer(obj.id));
      label.appendChild(cb);
      label.appendChild(el('span', { html: `${icon('star')} 정답(교사용 전용)` }));
      root.appendChild(label);
    }

    root.appendChild(el('h4', { text: '속성', style: 'margin-top:14px' }));
    renderTypeFields(obj);
  }

  function renderTypeFields(obj) {
    const patch = (p) => onPatchObject(obj.id, p);
    switch (obj.type) {
      case 'title': {
        const t = el('input', { type: 'text', id: 'insp-text', value: obj.text || '' });
        t.addEventListener('change', () => patch({ text: t.value }));
        root.appendChild(field('제목 텍스트', t));
        const level = el('select', { id: 'insp-level' });
        level.appendChild(el('option', { value: '1', text: '큰 제목(h1)', selected: obj.level !== 2 ? 'selected' : null }));
        level.appendChild(el('option', { value: '2', text: '작은 제목(h2)', selected: obj.level === 2 ? 'selected' : null }));
        level.addEventListener('change', () => patch({ level: Number(level.value) }));
        root.appendChild(field('제목 크기', level));
        break;
      }
      case 'question': {
        const qtypeSel = el('select', { id: 'insp-qtype' });
        for (const q of QUESTION_TYPES) qtypeSel.appendChild(el('option', { value: q, text: QTYPE_LABELS[q] || q, selected: obj.qtype === q ? 'selected' : null }));
        qtypeSel.addEventListener('change', () => patch({ qtype: qtypeSel.value }));
        root.appendChild(field('문항 유형', qtypeSel));
        const prompt = el('textarea', { id: 'insp-prompt', rows: '3', text: obj.prompt || '' });
        prompt.addEventListener('change', () => patch({ prompt: prompt.value }));
        root.appendChild(field('발문', prompt));
        const qnum = el('input', { type: 'number', id: 'insp-qnum', value: obj.qnum != null ? String(obj.qnum) : '' });
        qnum.addEventListener('change', () => patch({ qnum: qnum.value === '' ? undefined : Number(qnum.value) }));
        root.appendChild(field('번호', qnum));
        break;
      }
      case 'table': {
        const rows = obj.rows || [];
        const info = el('p', { class: 'insp-note', text: `${rows.length}행 × ${(rows[0] || []).length}열` });
        root.appendChild(info);
        const addRow = el('button', { type: 'button', class: 'insp-btn', text: '+ 행 추가' });
        addRow.addEventListener('click', () => {
          const cols = (rows[0] || []).length || 1;
          patch({ rows: [...rows, Array.from({ length: cols }, () => ({ text: '' }))] });
        });
        const delRow = el('button', { type: 'button', class: 'insp-btn', text: '- 행 삭제' });
        delRow.addEventListener('click', () => { if (rows.length > 1) patch({ rows: rows.slice(0, -1) }); });
        const addCol = el('button', { type: 'button', class: 'insp-btn', text: '+ 열 추가' });
        addCol.addEventListener('click', () => patch({ rows: rows.map((r) => [...r, { text: '' }]) }));
        const delCol = el('button', { type: 'button', class: 'insp-btn', text: '- 열 삭제' });
        delCol.addEventListener('click', () => { if ((rows[0] || []).length > 1) patch({ rows: rows.map((r) => r.slice(0, -1)) }); });
        root.appendChild(el('div', { class: 'insp-row-buttons' }, [addRow, delRow, addCol, delCol]));
        const caption = el('input', { type: 'text', id: 'insp-caption', value: obj.caption || '' });
        caption.addEventListener('change', () => patch({ caption: caption.value }));
        root.appendChild(field('캡션', caption));
        break;
      }
      case 'image-slot': {
        const src = el('input', { type: 'text', id: 'insp-src', value: obj.src || '' });
        src.addEventListener('change', () => patch({ src: src.value }));
        root.appendChild(field('이미지 경로', src));
        const upload = el('input', { type: 'file', id: 'insp-image-upload', accept: 'image/png,image/jpeg,image/gif,image/webp' });
        upload.addEventListener('change', () => { if (upload.files[0]) onImageUpload(obj.id, upload.files[0]); });
        root.appendChild(field('업로드', upload));
        const alt = el('input', { type: 'text', id: 'insp-alt', value: obj.alt || '' });
        alt.addEventListener('change', () => patch({ alt: alt.value }));
        root.appendChild(field('대체 텍스트(alt)', alt));
        break;
      }
      case 'answer-area': {
        const styleSel = el('select', { id: 'insp-aa-style' });
        for (const s of ANSWER_AREA_STYLES) styleSel.appendChild(el('option', { value: s, text: s, selected: obj.style === s ? 'selected' : null }));
        styleSel.addEventListener('change', () => patch({ style: styleSel.value }));
        root.appendChild(field('스타일', styleSel));
        const lines = el('input', { type: 'number', min: '1', id: 'insp-aa-lines', value: String(obj.lines || 1) });
        lines.addEventListener('change', () => patch({ lines: Math.max(1, Number(lines.value) || 1) }));
        root.appendChild(field('줄 수', lines));
        const label = el('input', { type: 'text', id: 'insp-aa-label', value: obj.label || '' });
        label.addEventListener('change', () => patch({ label: label.value }));
        root.appendChild(field('라벨', label));
        break;
      }
      case 'shape': {
        const kindSel = el('select', { id: 'insp-shape-kind' });
        for (const k of SHAPE_KINDS) kindSel.appendChild(el('option', { value: k, text: k, selected: obj.shapeKind === k ? 'selected' : null }));
        kindSel.addEventListener('change', () => patch({ shapeKind: kindSel.value }));
        root.appendChild(field('종류', kindSel));
        const stroke = el('input', { type: 'color', id: 'insp-shape-stroke', value: /^#[0-9a-f]{6}$/i.test(obj.strokeColor) ? obj.strokeColor : '#111827' });
        stroke.addEventListener('input', () => patch({ strokeColor: stroke.value }));
        root.appendChild(field('선 색', stroke));
        const fill = el('input', { type: 'color', id: 'insp-shape-fill', value: /^#[0-9a-f]{6}$/i.test(obj.fillColor) ? obj.fillColor : '#ffffff' });
        fill.addEventListener('input', () => patch({ fillColor: fill.value }));
        root.appendChild(field('채우기', fill));
        break;
      }
      case 'richtext': {
        root.appendChild(el('p', { class: 'insp-note', text: '본문은 캔버스에서 더블클릭해 직접 편집합니다.' }));
        break;
      }
      case 'passage-slot': {
        root.appendChild(el('p', {
          class: 'insp-note',
          text: 'AI는 지문을 채우거나 재작성하지 않습니다 — 본문은 교사가 직접 입력합니다(저작권법 제25조, 로컬 처리·교사 책임). 출처 표기를 권장합니다.',
        }));
        const slotLabel = el('input', { type: 'text', id: 'insp-slot-label', value: obj.slotLabel || '' });
        slotLabel.addEventListener('change', () => patch({ slotLabel: slotLabel.value }));
        root.appendChild(field('슬롯 라벨', slotLabel));
        const title = el('input', { type: 'text', id: 'insp-slot-title', value: obj.title || '' });
        title.addEventListener('change', () => patch({ title: title.value }));
        root.appendChild(field('지문 제목', title));
        const body = el('textarea', { id: 'insp-slot-body', rows: '6', text: obj.bodyHtml || '' });
        body.addEventListener('change', () => patch({ bodyHtml: body.value }));
        root.appendChild(field('지문 본문', body));
        const source = el('input', { type: 'text', id: 'insp-slot-source', value: obj.source || '' });
        source.addEventListener('change', () => patch({ source: source.value }));
        root.appendChild(field('출처', source));
        break;
      }
      case 'std-box': {
        const codes = el('input', { type: 'text', id: 'insp-std-codes', value: (obj.codes || []).join(', ') });
        codes.addEventListener('change', () => patch({ codes: codes.value.split(',').map((s) => s.trim()).filter(Boolean) }));
        root.appendChild(field('성취기준 코드(쉼표 구분)', codes));
        break;
      }
      default: break;
    }
  }

  // ── 다중 선택: 정렬 6종 + 균등 분배(float 한정) ──
  function renderMulti(ids, allFloat) {
    root.appendChild(el('h3', { text: `개체 ${ids.length}개 선택` }));
    if (!allFloat) {
      root.appendChild(el('p', { class: 'insp-note', text: '정렬/분배는 float(자유배치) 개체만 지원합니다.' }));
      return;
    }
    const grid = el('div', { class: 'align-grid' });
    for (const [mode, label, iconName] of ALIGN_BUTTONS) {
      const btn = el('button', { type: 'button', class: 'insp-btn', 'data-align': mode, title: label, html: icon(iconName) });
      btn.addEventListener('click', () => onAlign(ids, mode));
      grid.appendChild(btn);
    }
    root.appendChild(grid);
    const distH = el('button', { type: 'button', class: 'insp-btn', 'data-align': 'distribute-h', text: '가로 균등 분배' });
    distH.addEventListener('click', () => onAlign(ids, 'distribute-h'));
    const distV = el('button', { type: 'button', class: 'insp-btn', 'data-align': 'distribute-v', text: '세로 균등 분배' });
    distV.addEventListener('click', () => onAlign(ids, 'distribute-v'));
    root.appendChild(el('div', { class: 'insp-row-buttons' }, [distH, distV]));
  }

  function field(label, inputEl, compact = false) {
    return el('label', { class: compact ? 'insp-field compact' : 'insp-field' }, [el('span', { text: label }), inputEl]);
  }

  return { render };
}
