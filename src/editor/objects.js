// objects — 캔버스에서 "고를 수 있는 개체"를 판별하고 그 속성을 편집한다.
//
// 왜 필요한가: AI 초안에는 표·그래프(SVG)·테두리 상자·밑줄이 이미 들어 있는데, 편집기가
// 텍스트 커서만 잡아서 교사가 고칠 수 있는 건 글자뿐이었다. 편집 엔진의 한계가 아니라
// "개체를 선택할 수단이 없다"는 문제다.
//
// 판별을 클래스 목록으로 하드코딩하지 않는다 — 블록 라이브러리가 늘어날 때마다 목록이
// 낡기 때문이다. 대신 "계산된 스타일에 눈에 보이는 테두리나 배경이 있는가"로 정한다.
// 그러면 아직 없는 블록도 자동으로 편집 대상이 된다.
//
// 모든 변경은 요소의 인라인 style 에 쓴다. blocks.css 를 고치면 모든 문서가 함께
// 바뀌고, 인라인이라야 블록 innerHTML 에 실려 기존 manifest 왕복·인쇄 경로를 그대로 탄다.

const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];

/** 눈에 보이는 테두리가 있는가(한 변이라도). */
function borderSides(cs) {
  return SIDES.filter((s) => {
    const w = parseFloat(cs[`border${s}Width`]);
    const style = cs[`border${s}Style`];
    return w > 0 && style !== 'none' && !TRANSPARENT.test(cs[`border${s}Color`]);
  });
}

function hasVisibleFrame(el, win) {
  const cs = win.getComputedStyle(el);
  if (borderSides(cs).length) return true;
  return !TRANSPARENT.test(cs.backgroundColor) && cs.backgroundColor !== 'rgb(255, 255, 255)';
}

/**
 * 클릭 지점에서 위로 올라가며 무엇을 고른 것인지 정한다.
 * 안쪽 것을 우선한다 — 표 안의 셀을 눌렀으면 표가 아니라 셀이 잡혀야 자연스럽다.
 * @returns {{kind:string, el:Element, table?:Element}|null}
 */
export function classifyTarget(node, win) {
  let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el?.closest) return null;

  const shape = el.closest('.wg-shape');
  if (shape) return { kind: 'shape', el: shape };
  const text = el.closest('.wg-text');
  if (text) return { kind: 'textbox', el: text };
  if (el.tagName === 'IMG') return { kind: 'image', el };
  const img = el.closest('img');
  if (img) return { kind: 'image', el: img };
  const svg = el.closest('svg');
  if (svg) return { kind: 'svg', el: svg };

  const cell = el.closest('td, th');
  if (cell) return { kind: 'cell', el: cell, table: cell.closest('table') };
  const table = el.closest('table');
  if (table) return { kind: 'table', el: table };

  // 테두리·배경을 가진 가장 안쪽 요소. .wg-block 경계에서 멈춘다 —
  // 그 위(.sheet)는 용지이지 편집 개체가 아니다.
  let cur = el;
  while (cur && !cur.classList?.contains('wg-block') && cur.tagName !== 'BODY') {
    if (hasVisibleFrame(cur, win)) return { kind: 'box', el: cur };
    cur = cur.parentElement;
  }
  return null;
}

/**
 * 지금 고른 것의 바깥 개체. "가장 안쪽 우선"이라 라벨 같은 자식이 먼저 잡히는데,
 * 그러면 바깥 상자에 닿을 길이 없다 — Esc 로 한 겹씩 올라간다(그림판·슬라이드 관례).
 */
export function parentTarget(picked, win) {
  const start = picked?.el?.parentElement;
  if (!start) return null;
  if (picked.kind === 'cell') {
    const table = picked.el.closest('table');
    if (table) return { kind: 'table', el: table };
  }
  let cur = start;
  while (cur && !cur.classList?.contains('wg-block') && cur.tagName !== 'BODY') {
    if (cur.tagName === 'TABLE') return { kind: 'table', el: cur };
    if (hasVisibleFrame(cur, win)) return { kind: 'box', el: cur };
    cur = cur.parentElement;
  }
  return null;
}

/** 선택한 개체를 사람이 알아볼 이름으로 — 인스펙터 제목·섹션 머리에 쓴다. */
export function targetLabel(picked) {
  if (!picked?.el) return '문서';
  // 텍스트 상자·도형은 클래스가 항상 wg-text/wg-shape 라 (.클래스) 꼬리표가 군더더기다.
  if (picked.kind === 'textbox') return '텍스트 상자';
  const cls = picked.el.className?.split?.(/\s+/)[0];
  const base = { table: '표', cell: '표 · 셀', svg: '그림', image: '이미지', box: '상자 · 선' }[picked.kind] ?? '개체';
  return cls ? `${base} (.${cls})` : base;
}

/** 인라인 style 우선, 없으면 계산값 — 인스펙터 초기값. */
function effective(el, win, prop, cssProp) {
  const inline = el.style.getPropertyValue(cssProp);
  if (inline) return inline.trim();
  return win.getComputedStyle(el)[prop];
}

const rgbToHex = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
  if (!m) return null;
  return `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
};

/** 테두리·배경 상자의 현재 서식. */
export function boxStyle(el, win) {
  const cs = win.getComputedStyle(el);
  const sides = borderSides(cs);
  // 여러 변의 값이 다를 수 있다 — 대표값은 실제로 그려진 첫 변에서 읽는다.
  const side = sides[0] ?? 'Top';
  const bg = effective(el, win, 'backgroundColor', 'background-color');
  return {
    sides,
    borderColor: rgbToHex(cs[`border${side}Color`]) ?? '#333333',
    borderWidth: Math.round(parseFloat(cs[`border${side}Width`]) * 10) / 10 || 0,
    borderStyle: cs[`border${side}Style`] === 'none' ? 'none' : cs[`border${side}Style`],
    background: TRANSPARENT.test(bg) ? 'none' : (rgbToHex(bg) ?? '#ffffff'),
    radius: Math.round(parseFloat(cs.borderRadius) || 0),
    heightMm: el.style.height?.endsWith('mm')
      ? parseFloat(el.style.height)
      : Math.round((el.getBoundingClientRect().height / (96 / 25.4)) * 10) / 10,
  };
}

/**
 * 상자 서식 적용. 원래 한 변만 그려진 요소(.note-under 같은 밑줄)는 그 변만 건드린다 —
 * 사면 전체에 테두리를 두르면 밑줄이 상자가 되어 버린다.
 */
export function setBoxStyle(el, patch, win) {
  const cur = boxStyle(el, win);
  const sides = cur.sides.length ? cur.sides : SIDES;
  if (patch.borderColor != null) for (const s of sides) el.style[`border${s}Color`] = patch.borderColor;
  if (patch.borderWidth != null) for (const s of sides) el.style[`border${s}Width`] = `${patch.borderWidth}px`;
  if (patch.borderStyle != null) for (const s of sides) el.style[`border${s}Style`] = patch.borderStyle;
  if (patch.background != null) el.style.backgroundColor = patch.background === 'none' ? 'transparent' : patch.background;
  if (patch.radius != null) el.style.borderRadius = `${patch.radius}px`;
  if (patch.heightMm != null) el.style.height = `${patch.heightMm}mm`;
}

/** 표 전체 셀에 테두리 서식을 건다(표는 셀 단위로 선이 그려진다). */
export function setTableStyle(table, patch) {
  const cells = table.querySelectorAll('td, th');
  for (const c of cells) {
    if (patch.borderColor != null) c.style.borderColor = patch.borderColor;
    if (patch.borderWidth != null) c.style.borderWidth = `${patch.borderWidth}px`;
    if (patch.borderStyle != null) c.style.borderStyle = patch.borderStyle;
  }
  // 머리 배경: 머리행이 있으면 th 에, 없고 첫 열이 머리 역할이면(.vartable) 그 열에.
  // 예전엔 th 만 봤기 때문에 .vartable 에서는 눌러도 아무 일이 없었다.
  if (patch.headBackground != null) {
    const ths = table.querySelectorAll('th');
    if (ths.length) {
      for (const th of ths) th.style.backgroundColor = patch.headBackground;
    } else if (hasHeaderCol(table)) {
      for (const row of table.rows) {
        if (row.cells[0]) row.cells[0].style.backgroundColor = patch.headBackground;
      }
    }
  }
}

// ── 표 구조 편집 ──
//
// 활동지의 표는 머리 구조가 제각각이다(실측):
//   .data/.rubric/.cmp/.memo → 첫 "행"이 th
//   .vartable                → th 가 없고 첫 "열"(td.k)이 머리 역할
// 그래서 모델 셀을 통째로 복제하면 사고가 난다 — 머리행 아래 행을 추가하면 머리가
// 두 개가 되고(실측), th 의 인라인 width:34% 까지 복제돼 열을 늘리면 폭 합이
// 168% 가 되어 레이아웃이 깨졌다(실측). 아래 규칙으로 그 둘을 막는다.

/** 셀이 전부 th 인 행 = 머리행. */
export const isHeaderRow = (row) => row.cells.length > 0 && [...row.cells].every((c) => c.tagName === 'TH');

/** 표에 머리행이 있는가(인스펙터가 '머리행 배경'을 보일지 판단). */
export const hasHeaderRow = (table) => [...(table?.rows ?? [])].some(isHeaderRow);

/** 첫 열이 머리 역할인가(.vartable 처럼 th 없이 td.k 로 라벨을 세우는 표). */
export const hasHeaderCol = (table) => {
  const rows = [...(table?.rows ?? [])];
  if (rows.length < 2 || hasHeaderRow(table)) return false;
  return rows.every((r) => r.cells[0]?.classList.length > 0)
    && new Set(rows.map((r) => r.cells[0].className)).size === 1;
};

/** 폭 지정을 뺀 style — 열 개수가 바뀌면 이전 폭은 무조건 틀린 값이 된다. */
function styleWithoutWidth(cell) {
  const raw = cell.getAttribute('style');
  if (!raw) return null;
  const kept = raw.split(';').map((d) => d.trim()).filter((d) => d && !/^width\s*:/i.test(d));
  return kept.length ? `${kept.join('; ')};` : null;
}

/** 머리행에 폭이 지정돼 있으면 열 수에 맞춰 균등 재배분(합 100%). */
function redistributeWidths(table) {
  const header = [...table.rows].find(isHeaderRow) ?? table.rows[0];
  if (!header) return;
  const cells = [...header.cells];
  if (!cells.some((c) => /width\s*:/i.test(c.getAttribute('style') || ''))) return;
  const each = Math.floor((100 / cells.length) * 10) / 10;
  cells.forEach((c, i) => {
    const base = styleWithoutWidth(c);
    // 마지막 칸이 나머지를 흡수해 반올림 오차로 합이 100 을 넘지 않게 한다.
    const w = i === cells.length - 1 ? Math.round((100 - each * (cells.length - 1)) * 10) / 10 : each;
    c.setAttribute('style', `${base ? `${base} ` : ''}width:${w}%;`);
  });
}

/** 구조는 물려받되 폭·내용은 물려받지 않는 빈 셀. */
function makeCell(doc, model, tag) {
  const el = doc.createElement(tag);
  if (model?.className) el.className = model.className;
  const style = model ? styleWithoutWidth(model) : null;
  if (style) el.setAttribute('style', style);
  return el;
}

export const tableOps = {
  /** 기준 행 아래에 데이터 행을 넣는다. 머리행은 절대 복제하지 않는다(머리는 하나여야 한다). */
  addRow(table, refCell) {
    const rows = [...table.rows];
    if (!rows.length) return false;
    const at = refCell ? refCell.closest('tr').rowIndex : rows.length - 1;
    // 새 행의 생김새는 "데이터 행"에서 가져온다 — 머리행을 골랐어도 그 아래 데이터 행 모양으로.
    const model = rows.find((r, i) => i > at && !isHeaderRow(r))
      ?? rows.find((r) => !isHeaderRow(r))
      ?? rows[at];
    const doc = table.ownerDocument;
    const row = table.insertRow(at + 1);
    for (let i = 0; i < rows[at].cells.length; i++) {
      row.appendChild(makeCell(doc, model.cells[i] ?? model.cells[0], 'td'));
    }
    return true;
  },

  removeRow(table, refCell) {
    const rows = [...table.rows];
    const dataRows = rows.filter((r) => !isHeaderRow(r));
    if (dataRows.length <= 1) return false; // 데이터 행이 하나뿐이면 표가 껍데기만 남는다
    const at = refCell ? refCell.closest('tr').rowIndex : rows.length - 1;
    table.deleteRow(at);
    return true;
  },

  /** 기준 열 오른쪽에 한 열 추가. 행마다 그 행의 셀 종류(th/td)를 따르고 폭은 재배분한다. */
  addCol(table, refCell) {
    const cols = table.rows[0]?.cells.length ?? 0;
    if (!cols) return false;
    const at = refCell ? refCell.cellIndex : cols - 1;
    const doc = table.ownerDocument;
    for (const row of table.rows) {
      const model = row.cells[Math.min(at, row.cells.length - 1)];
      const tag = isHeaderRow(row) ? 'th' : 'td';
      // .vartable 처럼 첫 열이 머리인 표는 새 열에 그 라벨 class 를 물려주면 안 된다.
      const shape = (at === 0 && hasHeaderCol(table)) ? null : model;
      row.insertBefore(makeCell(doc, shape, tag), row.cells[at + 1] ?? null);
    }
    redistributeWidths(table);
    return true;
  },

  removeCol(table, refCell) {
    const first = table.rows[0];
    if (!first || first.cells.length <= 1) return false;
    const at = refCell ? refCell.cellIndex : first.cells.length - 1;
    for (const row of table.rows) if (row.cells[at]) row.deleteCell(at);
    redistributeWidths(table);
    return true;
  },
};

const MM = 96 / 25.4;

/**
 * 흐름 개체(표·그림·상자·이미지)의 크기와 위치.
 *
 * 위치를 절대좌표가 아니라 여백으로 다루는 이유: 이들은 글 흐름 안에 있어서 도형처럼
 * 띄워 버리면 뒤 내용이 밀려들어와 겹치고 인쇄가 깨진다. 한글·워드가 흐름 개체를
 * 여백으로 미는 것과 같은 방식이라야 리플로우가 계속 성립한다.
 */
export function objectBox(el, win) {
  const cs = win.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const mm = (v) => Math.round((parseFloat(v) || 0) / MM * 10) / 10;
  return {
    widthMm: Math.round((r.width / MM) * 10) / 10,
    heightMm: Math.round((r.height / MM) * 10) / 10,
    marginLeftMm: mm(cs.marginLeft),
    marginTopMm: mm(cs.marginTop),
  };
}

/** 크기·여백 적용. width 는 표에선 table 자체, 그림에선 svg 에 건다. */
export function setObjectBox(el, patch) {
  const put = (prop, v) => { el.style[prop] = `${Math.round(v * 10) / 10}mm`; };
  if (patch.widthMm != null) {
    put('width', Math.max(5, patch.widthMm));
    if (el.tagName.toLowerCase() === 'svg') el.removeAttribute('width');
  }
  if (patch.heightMm != null) {
    put('height', Math.max(3, patch.heightMm));
    if (el.tagName.toLowerCase() === 'svg') el.removeAttribute('height');
  }
  // 왼쪽 여백은 음수도 허용한다(판면 밖으로 살짝 빼는 편집은 실제로 쓰인다).
  if (patch.marginLeftMm != null) put('marginLeft', patch.marginLeftMm);
  if (patch.marginTopMm != null) put('marginTop', patch.marginTopMm);
}

/** 크기·이동을 손댈 수 있는 개체인가(문서·셀 자체는 제외 — 셀은 표로 다룬다). */
export const isMovableKind = (kind) => ['table', 'svg', 'box', 'image', 'shape', 'textbox'].includes(kind);

/** SVG 그래프의 현재 서식 — 내부 도형들의 대표값. */
export function svgStyle(svg, win) {
  const shapes = [...svg.querySelectorAll('path, line, rect, circle, ellipse, polygon, polyline')];
  const first = shapes[0];
  const cs = first ? win.getComputedStyle(first) : null;
  const box = svg.getBoundingClientRect();
  const MM = 96 / 25.4;
  return {
    shapeCount: shapes.length,
    stroke: (cs && rgbToHex(cs.stroke)) ?? '#333333',
    strokeWidth: cs ? (Math.round(parseFloat(cs.strokeWidth) * 10) / 10 || 1) : 1,
    fill: cs && !TRANSPARENT.test(cs.fill) && cs.fill !== 'none' ? (rgbToHex(cs.fill) ?? 'none') : 'none',
    widthMm: Math.round((box.width / MM) * 10) / 10,
    heightMm: Math.round((box.height / MM) * 10) / 10,
  };
}

/** SVG 일괄 서식/크기. 내부 요소마다 인라인으로 걸어 원본 속성(stroke=…)을 이긴다. */
export function setSvgStyle(svg, patch) {
  const shapes = [...svg.querySelectorAll('path, line, rect, circle, ellipse, polygon, polyline')];
  for (const s of shapes) {
    if (patch.stroke != null) s.style.stroke = patch.stroke;
    if (patch.strokeWidth != null) s.style.strokeWidth = String(patch.strokeWidth);
    if (patch.fill != null) s.style.fill = patch.fill;
  }
  if (patch.widthMm != null) { svg.style.width = `${patch.widthMm}mm`; svg.removeAttribute('width'); }
  if (patch.heightMm != null) { svg.style.height = `${patch.heightMm}mm`; svg.removeAttribute('height'); }
}
