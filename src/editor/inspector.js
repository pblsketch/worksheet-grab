// inspector.js — editor-v4 S4.3 우측 인스펙터. 선택 상태에 반응해 3섹션을 교체한다.
//   선택 없음   → 문서 설정(용지 프리셋·방향·단·여백, /paper 재배선) + 검수 상세 목록
//   단일 선택   → 타입 이름·위치/크기(float 시 mm)·flow⇄float·answer 토글·타입별 속성
//   다중 선택   → 정렬 6종 + 균등 분배(float 한정)
//
// DOM 은 이 모듈이 직접 만들고(root.replaceChildren), 값 변경은 콜백으로만 상위(editor.js)에
// 알린다 — history 커밋·리플로우 트리거는 이 모듈의 관심사가 아니다(관심사 분리, selection.js
// 관례와 동형).

import { icon } from './icons.js';
import { QTYPE_LABELS, SHAPE_KINDS, DASH_STYLES, ANSWER_AREA_STYLES, ORGANIZER_EDIT_SPECS } from './objectFactory.js';
import {
  ANSWERABLE_TYPES, QUESTION_TYPES, SIZEABLE_TYPES, PLACEMENT_TOGGLEABLE_TYPES,
  ALIGN_VALUES, WIDTH_PCT_MIN, WIDTH_PCT_MAX, CALLOUT_VARIANTS,
} from '/src/domain/schema/index.js';
import { PAPER_PRESETS, resolvePaper, matchPreset, paperDims, paperMargins } from '/src/usecases/paper.js';

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

// 개체 타입 → 사용자용 한국어 이름(인스펙터 헤더). 내부 데이터 모델은 계속 영문 타입명을 쓴다.
const TYPE_LABELS = Object.freeze({
  title: '제목', question: '문항', table: '표', 'image-slot': '이미지', 'answer-area': '답란',
  richtext: '자유 텍스트', shape: '도형', divider: '구분선', 'passage-slot': '지문 슬롯', 'std-box': '학습목표 박스',
  callout: '강조상자', organizer: '그림 조직자', spacer: '빈 공간', 'page-break': '페이지 나누기',
});
// placement(flow/float) → 사용자용 한국어(#9): float=자유 배치, flow=본문 배치(교사 친화 표현, US-E4).
const PLACEMENT_LABEL = Object.freeze({ float: '자유 배치', flow: '본문 배치' });

/** <input type="color"> 는 #rrggbb 만 받는다 — 저장값이 그 형태일 때만 초기값으로 쓰고, 아니면 기본색. */
const HEX6 = /^#[0-9a-f]{6}$/i;

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
export function createInspector({ root, onPaperChange, onPatchObject, onToggleFlowFloat, onToggleAnswer, onAlign, onImageUpload, onThemeChange = () => {}, onResize = () => {} }) {
  function render(state) {
    root.dataset.inspMode = state.mode;
    root.replaceChildren();
    if (state.mode === 'object') renderSingle(state.obj, state.paper ?? null);
    else if (state.mode === 'multi') renderMulti(state.ids, state.allFloat);
    else renderDocument(state.paper, state.findings || [], state.themeName || '', state.themes || []);
  }

  // 교과 테마 → 사용자용 한국어 라벨(색상 힌트 포함). themes/*.css 파일명이 곧 themeName 이다.
  const THEME_LABELS = Object.freeze({ ko: '국어 (초록)', sci: '과학 (청록)', social: '사회 (주황)', english: '영어 (남색)' });

  // ── 선택 없음: 문서 설정 + 검수 상세 ──
  function renderDocument(paper, findings, themeName, themes) {
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

    // 교과 테마(색상) 전환 — 내용은 그대로, pill·표 헤더·테두리·강조색만 교체(themes/*.css var). change 시 재저장+reload.
    if (themes.length) {
      const themeSel = el('select', { id: 'insp-theme' });
      for (const t of themes) themeSel.appendChild(el('option', { value: t, text: THEME_LABELS[t] || t, selected: t === themeName ? 'selected' : null }));
      themeSel.addEventListener('change', () => onThemeChange(themeSel.value));
      root.appendChild(field('테마(색상)', themeSel));
    }

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
  function renderSingle(obj, paper = null) {
    const typeName = TYPE_LABELS[obj.type] || obj.type;
    root.appendChild(el('h3', { text: `${typeName} · ${PLACEMENT_LABEL[obj.placement] || ''}`, 'data-insp-type': obj.type }));

    if (obj.placement === 'float' && obj.rect) {
      const grid = el('div', { class: 'insp-grid4' });
      for (const [key, label] of [['xMm', 'X'], ['yMm', 'Y'], ['wMm', 'W'], ['hMm', 'H']]) {
        const input = el('input', { type: 'number', step: '0.5', 'data-rect-key': key, value: String(obj.rect[key]) });
        input.addEventListener('change', () => onPatchObject(obj.id, { rect: { ...obj.rect, [key]: Number(input.value) || 0 } }));
        grid.appendChild(field(label, input, true));
      }
      root.appendChild(grid);
      // 투명도(0~100%)·회전(도) — 자유 배치 개체 표현 속성. change 로만 커밋(슬라이더 input 마다 재로드 방지).
      const opacityInput = el('input', { type: 'range', min: '0', max: '100', step: '5', id: 'insp-opacity', value: String(Math.round((typeof obj.opacity === 'number' ? obj.opacity : 1) * 100)) });
      opacityInput.addEventListener('change', () => onPatchObject(obj.id, { opacity: Math.max(0, Math.min(1, Number(opacityInput.value) / 100)) }));
      root.appendChild(field('투명도(%)', opacityInput));
      const angleInput = el('input', { type: 'number', min: '-180', max: '180', step: '5', id: 'insp-angle', value: String(typeof obj.angle === 'number' ? obj.angle : 0) });
      angleInput.addEventListener('change', () => onPatchObject(obj.id, { angle: Math.max(-180, Math.min(180, Number(angleInput.value) || 0)) }));
      root.appendChild(field('회전(도)', angleInput));
    }

    // ── 본문 배치(flow) 개체의 크기·정렬(2026-07-28) ─────────────────────────────
    // float 의 X/Y/W/H 와 나란히 놓이지만 성격이 다르다 — 좌표가 아니라 **흐름 안에서의 상대 크기**다
    // (flow 는 rect 를 가질 수 없다, 원칙 3). 그래서 폭은 mm 가 아니라 본문 폭 대비 %다.
    if (obj.placement === 'flow' && SIZEABLE_TYPES.includes(obj.type)) {
      const hasPct = typeof obj.widthPct === 'number';
      const grid = el('div', { class: 'insp-grid4' });

      const pctInput = el('input', {
        type: 'number', min: String(WIDTH_PCT_MIN), max: String(WIDTH_PCT_MAX), step: '5',
        id: 'insp-width-pct', value: hasPct ? String(obj.widthPct) : String(WIDTH_PCT_MAX),
      });
      pctInput.addEventListener('change', () => onResize(obj.id, { widthPct: Number(pctInput.value) }));
      grid.appendChild(field('폭(%)', pctInput, true));

      const minHInput = el('input', {
        type: 'number', min: '1', step: '1', id: 'insp-min-height',
        value: typeof obj.minHeightMm === 'number' ? String(obj.minHeightMm) : '',
      });
      minHInput.addEventListener('change', () => {
        const v = minHInput.value.trim();
        onResize(obj.id, { minHeightMm: v === '' ? null : Number(v) });
      });
      grid.appendChild(field('최소높이(mm)', minHInput, true));
      root.appendChild(grid);

      // %를 mm 로 환산해 함께 보인다 — 교사는 mm 로 감을 잡는데 저장은 %로 해야 용지·단 수를 바꿔도
      // 비율이 유지된다(mm 저장은 열을 넘겨 클램프가 필요하고, 클램프는 값을 되돌릴 수 없게 덮어쓴다).
      const bodyMm = contentWidthMm(paper);
      if (bodyMm) {
        const pct = hasPct ? obj.widthPct : WIDTH_PCT_MAX;
        root.appendChild(el('p', {
          class: 'insp-hint', id: 'insp-width-mm',
          text: `본문 폭 ${Math.round(bodyMm)}mm 기준 약 ${Math.round((bodyMm * pct) / 100)}mm`,
        }));
      }

      const alignSel = el('select', { id: 'insp-align' });
      for (const [value, label] of [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]) {
        alignSel.appendChild(el('option', { value, text: label }));
      }
      alignSel.value = ALIGN_VALUES.includes(obj.align) ? obj.align : 'left';
      // 폭이 100%면 정렬이 시각적으로 아무 일도 하지 않는다(남는 공간이 없다) — 끄고 이유를 밝힌다.
      alignSel.disabled = !hasPct || obj.widthPct >= WIDTH_PCT_MAX;
      alignSel.addEventListener('change', () => onResize(obj.id, { align: alignSel.value }));
      root.appendChild(field(alignSel.disabled ? '정렬(폭을 줄이면 사용)' : '정렬', alignSel));

      if (hasPct || typeof obj.minHeightMm === 'number' || obj.align !== undefined) {
        root.appendChild(el('button', {
          type: 'button', id: 'insp-size-reset', class: 'insp-btn',
          text: '크기 원래대로',
          onclick: () => onResize(obj.id, { widthPct: null, minHeightMm: null, align: null }),
        }));
      }
    }

    // 두 배치를 다 지원하는 타입에만 전환을 제안한다 — 제목·학습목표 박스처럼 flow 전용인 타입에
    // 버튼을 내밀면 눌러도 아무 일이 없어(무동작) 교사가 "고장 났다"고 읽는다.
    if (PLACEMENT_TOGGLEABLE_TYPES.includes(obj.type)) {
      root.appendChild(el('button', {
        type: 'button', id: 'insp-flowfloat-toggle', class: 'insp-btn',
        html: `${icon('layers')}<span>${obj.placement === 'float' ? '본문 배치로 전환' : '자유 배치로 전환'}</span>`,
        onclick: () => onToggleFlowFloat(obj.id),
      }));
    }

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

  /**
   * qtype 별 "항목 개수" 편집. 항목 **글자**는 캔버스에서 더블클릭해 고칠 수 있었지만, 개수를
   * 늘리거나 줄일 수단이 어디에도 없었다 — 삽입 기본값(객관식 보기 4개·연결형 2쌍·순서 3개)에
   * 갇혀 5번째 보기를 못 만들었다. 배열 원소는 렌더(cellText)가 문자열/{id,text} 를 모두 받으므로
   * 새 원소는 문자열로 넣는다(저작 경로 관례, objectFactory.questionDefaults 와 동형).
   */
  const QTYPE_ITEM_SPEC = Object.freeze({
    'multiple-choice': { fields: ['choices'], label: '보기', seed: (n) => `보기 ${n}` },
    'true-false': { fields: ['choices'], label: '판별 문장', seed: (n) => `문장 ${n}` },
    'fill-blank': { fields: ['choices'], label: '낱말 상자 항목', seed: (n) => `낱말 ${n}` },
    ordering: { fields: ['items'], label: '순서 항목', seed: (n) => `항목 ${n}` },
    matching: { fields: ['left', 'right'], label: '연결 쌍', seed: (n, f) => (f === 'left' ? `항목 ${n}` : `설명 ${n}`) },
  });

  function renderQuestionItemFields(obj, patch) {
    // 서술형은 항목이 아니라 답란 줄 수가 조절 대상이다(렌더 기본 4줄, 0=내장 답란 없음).
    if (obj.qtype === 'essay') {
      const lines = el('input', { type: 'number', min: '0', max: '30', id: 'insp-q-lines', value: String(obj.lines ?? 4) });
      lines.addEventListener('change', () => patch({ lines: Math.max(0, Math.min(30, Number(lines.value) || 0)) }));
      root.appendChild(field('답란 줄 수(0=없음)', lines));
      return;
    }
    const spec = QTYPE_ITEM_SPEC[obj.qtype];
    if (!spec) return;
    const counts = spec.fields.map((f) => (Array.isArray(obj[f]) ? obj[f].length : 0));
    const n = Math.max(...counts);
    root.appendChild(el('p', { class: 'insp-note', id: 'insp-q-item-count', text: `${spec.label} ${n}개 · 내용은 캔버스에서 더블클릭해 고칩니다` }));
    const add = el('button', { type: 'button', class: 'insp-btn', id: 'insp-q-add-item', text: `+ ${spec.label} 추가` });
    add.addEventListener('click', () => {
      const p = {};
      for (const f of spec.fields) {
        const arr = Array.isArray(obj[f]) ? obj[f] : [];
        p[f] = [...arr, spec.seed(arr.length + 1, f)];
      }
      patch(p);
    });
    const del = el('button', { type: 'button', class: 'insp-btn', id: 'insp-q-del-item', text: `- ${spec.label} 삭제` });
    del.addEventListener('click', () => {
      if (n <= 1) return; // 마지막 하나는 남긴다(빈 배열이면 렌더가 보조 영역을 통째로 생략한다)
      const p = {};
      for (const f of spec.fields) {
        const arr = Array.isArray(obj[f]) ? obj[f] : [];
        if (arr.length) p[f] = arr.slice(0, -1);
      }
      patch(p);
    });
    root.appendChild(el('div', { class: 'insp-row-buttons' }, [add, del]));
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
        // 제목 상단 배지(예: "중1 · 1차시")·모서리 표기·출처는 meta 로 저작 — 편집기에서 직접 수정(#6).
        const meta = obj.meta || {};
        const patchMeta = (k, v) => patch({ meta: { ...meta, [k]: v || undefined } });
        const pill = el('input', { type: 'text', id: 'insp-title-pill', value: meta.pill || '' });
        pill.addEventListener('change', () => patchMeta('pill', pill.value.trim()));
        root.appendChild(field('상단 배지(학년·차시 등)', pill));
        const page = el('input', { type: 'text', id: 'insp-title-page', value: meta.page || '' });
        page.addEventListener('change', () => patchMeta('page', page.value.trim()));
        root.appendChild(field('모서리 표기', page));
        const source = el('input', { type: 'text', id: 'insp-title-source', value: meta.source || '' });
        source.addEventListener('change', () => patchMeta('source', source.value.trim()));
        root.appendChild(field('출처 표기', source));
        root.appendChild(el('p', { class: 'insp-note', text: '이미 붙인 배지·모서리 표기·출처는 캔버스에서 더블클릭해 바로 고칠 수 있습니다(비우면 사라집니다).' }));
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
        renderQuestionItemFields(obj, patch);
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
        root.appendChild(el('p', { class: 'insp-note', text: '셀 편집: 캔버스에서 셀 더블클릭 · 병합: 셀 클릭 후 툴바 · 열 너비: 열 경계 드래그' }));
        const caption = el('input', { type: 'text', id: 'insp-caption', value: obj.caption || '' });
        caption.addEventListener('change', () => patch({ caption: caption.value }));
        root.appendChild(field('캡션', caption));
        // 표 테두리 색·두께(#5 2차) — CSS 변수로 렌더에 반영.
        const bColor = el('input', { type: 'color', id: 'insp-table-border-color', value: HEX6.test(obj.borderColor) ? obj.borderColor : '#cbd5c0' });
        bColor.addEventListener('input', () => patch({ borderColor: bColor.value }));
        root.appendChild(field('테두리 색', bColor));
        const bWidth = el('input', { type: 'number', id: 'insp-table-border-width', min: '0', max: '6', step: '0.5', value: String(obj.borderWidth ?? 1) });
        bWidth.addEventListener('change', () => patch({ borderWidth: Math.max(0, Number(bWidth.value) || 0) }));
        root.appendChild(field('테두리 두께(px)', bWidth));
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
        // 캡션(US-P3-5) — 렌더는 obj.caption 을 <figcaption> 으로 내보내는데 여기 입력란이 없어
        // 캡션을 붙일 방법 자체가 없었다. 캡션을 단 뒤에는 캔버스에서 figcaption 더블클릭으로
        // 직접 고칠 수 있다(selection.js EDIT_FIELD). 캡션 신설을 인스펙터에 두는 이유는
        // editMode 전용 빈 요소를 그리면 "편집==인쇄 하드 동치"(R2-1)가 깨지기 때문이다.
        const imgCaption = el('input', { type: 'text', id: 'insp-image-caption', value: obj.caption || '' });
        imgCaption.addEventListener('change', () => patch({ caption: imgCaption.value }));
        root.appendChild(field('캡션', imgCaption));
        root.appendChild(el('p', { class: 'insp-note', text: '캡션 편집: 캔버스에서 캡션 더블클릭' }));
        break;
      }
      case 'answer-area': {
        // 값은 계속 영문 토큰(line/dots/box)이지만 화면에는 한국어로 보인다 — 교사가 "dots" 가
        // 무엇인지 고르기 전에 알 수 없었다(다른 select 는 전부 한국어 라벨을 쓴다).
        const AA_STYLE_LABELS = { line: '밑줄', dots: '점(원형) 목록', box: '네모 칸' };
        const styleSel = el('select', { id: 'insp-aa-style' });
        for (const s of ANSWER_AREA_STYLES) styleSel.appendChild(el('option', { value: s, text: AA_STYLE_LABELS[s] || s, selected: obj.style === s ? 'selected' : null }));
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
      case 'spacer': {
        // 높이는 인쇄에도 그대로 반영된다(렌더가 인라인 height 로 방출 — 편집==인쇄).
        const hMm = el('input', { type: 'number', min: '1', step: '1', id: 'insp-spacer-height', value: String(obj.heightMm || 20) });
        hMm.addEventListener('change', () => patch({ heightMm: Math.max(1, Number(hMm.value) || 20) }));
        root.appendChild(field('높이(mm)', hMm));
        const sLabel = el('input', { type: 'text', id: 'insp-spacer-label', value: obj.label || '' });
        sLabel.addEventListener('change', () => patch({ label: sLabel.value }));
        root.appendChild(field('설명(화면 전용)', sLabel));
        break;
      }
      case 'page-break': {
        root.appendChild(el('p', { class: 'insp-note', text: '이 지점에서 페이지가 나뉩니다. 뒤따르는 내용이 새 페이지 첫머리가 되고 나머지는 뒤로 밀립니다 — 페이지가 담을 수 있는 양 자체가 늘지는 않습니다.' }));
        break;
      }
      case 'shape': {
        const SHAPE_KIND_LABELS = { rect: '사각형', circle: '원', line: '선' };
        const DASH_LABELS = { solid: '실선', dashed: '파선', dotted: '점선' };
        const kindSel = el('select', { id: 'insp-shape-kind' });
        for (const k of SHAPE_KINDS) kindSel.appendChild(el('option', { value: k, text: SHAPE_KIND_LABELS[k] || k, selected: obj.shapeKind === k ? 'selected' : null }));
        kindSel.addEventListener('change', () => patch({ shapeKind: kindSel.value }));
        root.appendChild(field('종류', kindSel));
        const stroke = el('input', { type: 'color', id: 'insp-shape-stroke', value: HEX6.test(obj.strokeColor) ? obj.strokeColor : '#111827' });
        stroke.addEventListener('input', () => patch({ strokeColor: stroke.value }));
        root.appendChild(field('선 색', stroke));
        const width = el('input', { type: 'number', id: 'insp-shape-width', min: '0.5', max: '12', step: '0.5', value: String(obj.strokeWidth ?? 1.6) });
        width.addEventListener('change', () => patch({ strokeWidth: Math.max(0.5, Number(width.value) || 1.6) }));
        root.appendChild(field('선 두께', width));
        const dashSel = el('select', { id: 'insp-shape-dash' });
        for (const d of DASH_STYLES) dashSel.appendChild(el('option', { value: d, text: DASH_LABELS[d] || d, selected: (obj.dash || 'solid') === d ? 'selected' : null }));
        dashSel.addEventListener('change', () => patch({ dash: dashSel.value }));
        root.appendChild(field('선 유형', dashSel));
        const fill = el('input', { type: 'color', id: 'insp-shape-fill', value: HEX6.test(obj.fillColor) ? obj.fillColor : '#ffffff' });
        fill.addEventListener('input', () => patch({ fillColor: fill.value }));
        root.appendChild(field('채우기', fill));
        break;
      }
      case 'richtext': {
        root.appendChild(el('p', { class: 'insp-note', text: '본문은 캔버스에서 더블클릭해 직접 편집합니다.' }));
        break;
      }
      case 'passage-slot': {
        // 3층 정책(2026-07-23 2차 델타)의 현재 내용을 그대로 적는다 — 종전 안내문은 "AI는 지문을
        // 채우거나 재작성하지 않습니다"라고 단정했지만, 그 뒤 passage-slot 이 AI_EXCLUDED_TYPES 에서
        // 빠져 편집기 AI 패널로 창작·재구성을 요청할 수 있게 됐다(사실과 어긋난 안내였다).
        root.appendChild(el('p', {
          class: 'insp-note',
          text: '지문은 교사가 직접 입력하는 것이 기본입니다(저작권법 제25조, 로컬 처리·교사 책임). 명시적으로 요청하면 AI가 창작·재구성·수준 조정도 할 수 있지만, 실존 저작물의 원문을 그대로 옮기지는 않습니다. 출처 표기를 권장합니다.',
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
        // 박스 서식(#3) — 지문 성격(자료·인용·안내)을 색으로 구분하고 싶다는 요구. 미지정이면
        // blocks.css 의 var() 기본값(#bbb / 1.5px / #fcfcfa)이 그대로 쓰인다.
        root.appendChild(el('h4', { text: '지문 상자 서식', style: 'margin-top:12px' }));
        const psBorder = el('input', { type: 'color', id: 'insp-slot-border-color', value: HEX6.test(obj.borderColor) ? obj.borderColor : '#bbbbbb' });
        psBorder.addEventListener('input', () => patch({ borderColor: psBorder.value }));
        root.appendChild(field('테두리 색', psBorder));
        const psWidth = el('input', { type: 'number', id: 'insp-slot-border-width', min: '0', max: '8', step: '0.5', value: String(obj.borderWidth ?? 1.5) });
        psWidth.addEventListener('change', () => patch({ borderWidth: Math.max(0, Number(psWidth.value) || 0) }));
        root.appendChild(field('테두리 두께(px)', psWidth));
        const psBg = el('input', { type: 'color', id: 'insp-slot-bg-color', value: HEX6.test(obj.bgColor) ? obj.bgColor : '#fcfcfa' });
        psBg.addEventListener('input', () => patch({ bgColor: psBg.value }));
        root.appendChild(field('배경색', psBg));
        const psReset = el('button', { type: 'button', class: 'insp-btn', id: 'insp-slot-style-reset', text: '서식 기본값으로' });
        psReset.addEventListener('click', () => patch({ borderColor: undefined, borderWidth: undefined, bgColor: undefined }));
        root.appendChild(psReset);
        break;
      }
      case 'std-box': {
        // 박스 제목(기본 '학습 목표') — 학교·교과마다 부르는 이름이 다르다. 캔버스에서도 고칠 수 있다.
        const heading = el('input', { type: 'text', id: 'insp-std-heading', value: obj.heading || '', placeholder: '학습 목표' });
        heading.addEventListener('change', () => patch({ heading: heading.value.trim() || undefined }));
        root.appendChild(field('박스 제목', heading));
        // objectives = 학습목표(저작 영역) — codes 와 달리 교사가 편집기에서 직접 다듬을 수 있다.
        const objectives = el('textarea', { id: 'insp-std-objectives', rows: '4', text: (obj.objectives || []).join('\n') });
        objectives.addEventListener('change', () => patch({ objectives: objectives.value.split('\n').map((s) => s.trim()).filter(Boolean) }));
        root.appendChild(field('학습 목표(줄바꿈으로 구분)', objectives));
        root.appendChild(el('p', { class: 'insp-note', text: '제목과 각 목표 문장은 캔버스에서 더블클릭해 바로 고칠 수 있습니다. 여기서는 줄을 늘리거나 줄입니다.' }));
        // 근거 성취기준 표시 — 기본은 꺼짐(활동지에는 대개 학습목표만 싣는다). 켜면 교사용에만 보인다.
        const stdLabel = el('label', { class: 'insp-check' });
        const stdCb = el('input', { type: 'checkbox', id: 'insp-std-show-standards' });
        stdCb.checked = obj.showStandards === true;
        stdCb.addEventListener('change', () => patch({ showStandards: stdCb.checked ? true : undefined }));
        stdLabel.appendChild(stdCb);
        stdLabel.appendChild(el('span', { text: '근거 성취기준 함께 표시(교사용에만 보임)' }));
        root.appendChild(stdLabel);
        // codes 는 curriculum-mapper 가 확정한 조회 참조라 편집기에서 직접 고치지 않는다(읽기 전용).
        // 표시를 꺼도 이 값은 그대로 남아, 다시 켜면 원문이 되살아난다.
        const codes = el('input', { type: 'text', id: 'insp-std-codes', value: (obj.codes || []).join(', '), readonly: 'readonly' });
        root.appendChild(field('성취기준 코드(읽기 전용)', codes));
        break;
      }
      case 'callout': {
        // 강조상자(M4) — 종류(variant)·제목·본문. 크기·정렬은 위 공통 크기 섹션(SIZEABLE)이 처리한다.
        // body 는 렌더가 raw 방출하는 살균 HTML 이지만 **교사 저작 HTML 은 여기서 살균하지 않는다**
        // (passage-slot bodyHtml 과 동일 규약 — 자기 문서 신뢰; 살균은 AI 경로 sanitizeObject 소관).
        const VARIANT_LABELS = { tip: '도움말', warning: '주의', note: '참고', summary: '핵심 정리' };
        const variant = CALLOUT_VARIANTS.includes(obj.variant) ? obj.variant : 'note';
        const vSel = el('select', { id: 'insp-callout-variant' });
        for (const v of CALLOUT_VARIANTS) vSel.appendChild(el('option', { value: v, text: VARIANT_LABELS[v] || v, selected: variant === v ? 'selected' : null }));
        vSel.addEventListener('change', () => patch({ variant: vSel.value }));
        root.appendChild(field('종류', vSel));
        const title = el('input', { type: 'text', id: 'insp-callout-title', value: obj.title || '', placeholder: VARIANT_LABELS[variant] });
        title.addEventListener('change', () => patch({ title: title.value.trim() || undefined }));
        root.appendChild(field('제목(비우면 종류 이름)', title));
        const body = el('textarea', { id: 'insp-callout-body', rows: '4', text: obj.body || '' });
        body.addEventListener('change', () => patch({ body: body.value }));
        root.appendChild(field('본문', body));
        root.appendChild(el('p', { class: 'insp-note', text: '본문에는 HTML 을 그대로 쓸 수 있습니다(예: <b>굵게</b>). 제목을 비우면 종류 이름(도움말·주의·참고·핵심 정리)이 머리띠에 표시됩니다.' }));
        break;
      }
      case 'organizer': {
        // 편집 가능 그림형 조직자(P3) — 개수(params)와 슬롯 라벨(labels)만 편집한다. 그림의 모양·좌표·
        // 글자 크기는 엔진(OrganizerGen)이 그리므로 여기서 만지지 않는다(원칙 3). 크기·정렬은 위 공통
        // 크기 섹션(SIZEABLE)이 처리한다.
        const KIND_LABELS = { venn: '벤다이어그램', conceptmap: '개념 지도', fishbone: '피시본', flowchart: '순서 흐름도', hierarchy: '위계 트리', hexagon: '헥사고날' };
        root.appendChild(el('p', { class: 'insp-note', text: `종류: ${KIND_LABELS[obj.kind] || obj.kind} · 그림의 모양·위치는 자동으로 그려집니다. 개수와 칸 글자만 정하면 됩니다.` }));
        const spec = ORGANIZER_EDIT_SPECS[obj.kind];
        if (!spec) {
          root.appendChild(el('p', { class: 'insp-note', text: '이 조직자는 아직 개수·라벨 편집을 지원하지 않습니다(이동·삭제만 가능).' }));
          break;
        }
        const params = (obj.params && typeof obj.params === 'object') ? obj.params : {};
        const count = Number(params[spec.param]) || spec.defaultCount;
        const countSel = el('select', { id: 'insp-organizer-count' });
        for (let c = spec.min; c <= spec.max; c += 1) {
          countSel.appendChild(el('option', { value: String(c), text: `${c}개`, selected: c === count ? 'selected' : null }));
        }
        countSel.addEventListener('change', () => patch({ params: { ...params, [spec.param]: Number(countSel.value) } }));
        root.appendChild(field(spec.countLabel || '개수', countSel));

        const slots = spec.slots(count);
        const labelsOf = (o) => ((o.labels && typeof o.labels === 'object' && !Array.isArray(o.labels)) ? o.labels : {});
        const labels = labelsOf(obj);
        slots.forEach((slot) => {
          const inp = el('input', { type: 'text', id: `insp-organizer-label-${slot.key}`, value: labels[slot.key] || '', placeholder: slot.def ? `기본: ${slot.def}` : '(빈칸)' });
          inp.addEventListener('change', () => {
            const next = { ...labelsOf(obj) };
            const v = inp.value.trim();
            if (v) next[slot.key] = v; else delete next[slot.key];
            patch({ labels: next });
          });
          root.appendChild(field(`${slot.label} 글자`, inp));
        });
        root.appendChild(el('p', { class: 'insp-note', text: '각 칸에 들어갈 글자만 적으면 됩니다(비우면 기본 안내 글자가 나옵니다). 그림의 원·선은 프로그램이 정확히 그립니다. 개수를 바꿔도 이름표는 슬롯 이름으로 유지됩니다.' }));
        break;
      }
      default: break;
    }
  }

  // ── 다중 선택: 정렬 6종 + 균등 분배(float 한정) ──
  function renderMulti(ids, allFloat) {
    root.appendChild(el('h3', { text: `개체 ${ids.length}개 선택` }));
    if (!allFloat) {
      root.appendChild(el('p', { class: 'insp-note', text: '정렬/분배는 자유 배치 개체만 지원합니다.' }));
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

  /**
   * 본문 폭(mm) — `.sheet-body` 열 하나의 폭. widthPct 의 % 가 실제로 몇 mm 인지 보조 표시하는 데 쓴다.
   * 다단이면 열 간격을 빼고 단 수로 나눈다(paper.css 의 column-count/column-gap 과 같은 계산).
   * paper 를 못 받았으면 null — 호출부가 힌트를 생략한다(틀린 수를 보여주느니 안 보이는 게 낫다).
   */
  function contentWidthMm(paper) {
    if (paper === null || paper === undefined) return null;
    const resolved = resolvePaper(paper) ?? resolvePaper({ size: 'A4' });
    if (!resolved) return null;
    const { w } = paperDims(resolved);
    const m = paperMargins(resolved);
    const cols = Math.max(1, resolved.columns ?? 1);
    const gapMm = 8; // paper.css `--sheet-colgap` 기본값과 동일
    const body = w - m.left - m.right;
    return cols === 1 ? body : (body - gapMm * (cols - 1)) / cols;
  }

  function field(label, inputEl, compact = false) {
    return el('label', { class: compact ? 'insp-field compact' : 'insp-field' }, [el('span', { text: label }), inputEl]);
  }

  return { render };
}
