// shapes — 활동지 위 도형(원·타원·사각형·삼각형·선·화살표).
//
// 배치 모델은 "블록 앵커 + 상대 오프셋"이다(한글/워드의 개체 앵커).
// 도형은 커서가 있던 .wg-block 안에 높이 0 의 기준점(.wg-shape-layer)을 하나 두고
// 그 기준점에 절대배치된다. 기준점은 블록 흐름 안에 있으므로 리플로우로 블록이 다음
// 쪽으로 밀리면 도형도 같이 간다 — 쪽에 절대배치하면 본문만 밀리고 도형이 제자리에
// 남아 인쇄 사고가 난다.
//
// .wg-block 자체는 편집 중 display:contents(박스 없음)라 위치 기준이 될 수 없다.
// 그래서 실제 박스를 만드는 층이 따로 필요하다(그게 .wg-shape-layer).
//
// 렌더는 인라인 SVG — 의존성 0이고, 저장 시 블록 innerHTML 에 그대로 실려 왕복한다.
// 치수는 mm(인쇄 진실원천), 선 굵기는 vector-effect:non-scaling-stroke 로 비균등
// 확대에도 일정하게 유지된다.

const KINDS = {
  circle: { label: '원', w: 24, h: 24, viewBox: '0 0 100 100', body: '<ellipse cx="50" cy="50" rx="49" ry="49"/>' },
  ellipse: { label: '타원', w: 34, h: 20, viewBox: '0 0 100 100', body: '<ellipse cx="50" cy="50" rx="49" ry="49"/>' },
  rect: { label: '사각형', w: 34, h: 22, viewBox: '0 0 100 100', body: '<rect x="1" y="1" width="98" height="98"/>' },
  triangle: { label: '삼각형', w: 28, h: 24, viewBox: '0 0 100 100', body: '<polygon points="50,2 98,98 2,98"/>' },
  line: { label: '선', w: 40, h: 6, viewBox: '0 0 100 20', body: '<line x1="1" y1="10" x2="99" y2="10"/>' },
  arrow: {
    label: '화살표', w: 40, h: 8, viewBox: '0 0 100 20',
    body: '<line x1="1" y1="10" x2="74" y2="10"/><polygon class="head" points="99,10 72,2 72,18"/>',
  },
};

export const SHAPE_KINDS = Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label }));
export const shapeLabel = (kind) => KINDS[kind]?.label ?? '도형';

export const SHAPE_DEFAULTS = { fill: 'none', stroke: '#333333', strokeWidth: 1.6, dash: '0' };
/** 선 종류 — 값은 stroke-dasharray 그대로(0 = 실선). */
export const DASH_STYLES = [
  { id: '0', label: '실선' },
  { id: '6 4', label: '파선' },
  { id: '1.5 3', label: '점선' },
];

/** 도형 1개의 마크업(앵커 기준점 포함). */
export function shapeMarkup(kind, opts = {}) {
  const k = KINDS[kind];
  if (!k) return null;
  const {
    widthMm = k.w, heightMm = k.h, leftMm = 0, topMm = 0,
    fill = SHAPE_DEFAULTS.fill, stroke = SHAPE_DEFAULTS.stroke,
    strokeWidth = SHAPE_DEFAULTS.strokeWidth, dash = SHAPE_DEFAULTS.dash,
  } = opts;
  const style = [
    `left:${leftMm}mm`, `top:${topMm}mm`, `width:${widthMm}mm`, `height:${heightMm}mm`,
    `--wg-fill:${fill}`, `--wg-stroke:${stroke}`, `--wg-sw:${strokeWidth}`, `--wg-dash:${dash}`,
  ].join(';');
  return `<div class="wg-shape-layer"><svg class="wg-shape" data-shape="${kind}"`
    + ` viewBox="${k.viewBox}" preserveAspectRatio="none" style="${style}">${k.body}</svg></div>`;
}

/**
 * 커서가 놓인 .wg-block 안에 도형을 넣는다. 앵커 기준점은 블록 말미에 붙이되,
 * 도형 자체는 블록 위쪽으로 겹쳐 보이도록 top 을 음수로 시작한다(넣자마자 보이게).
 * @returns {SVGElement|null} 삽입된 도형
 */
export function insertShape(doc, kind, block, opts = {}) {
  if (!block) return null;
  const markup = shapeMarkup(kind, { topMm: -12, leftMm: 8, ...opts });
  if (!markup) return null;
  const holder = doc.createElement('div');
  holder.innerHTML = markup;
  const layer = holder.firstElementChild;
  block.appendChild(layer);
  return layer.querySelector('.wg-shape');
}

/**
 * 도형을 contenteditable 안의 "비편집 섬"으로 만든다.
 *
 * 이게 없으면 브라우저가 도형을 본문 텍스트의 일부로 취급해서, 끌 때 내 드래그 대신
 * 네이티브 DnD(요소를 글 사이로 옮기기)와 텍스트 선택이 먼저 발동한다 — 위치 이동이
 * 되다 말다 하는 원인. contenteditable=false 로 캐럿이 안 들어가게 하고 draggable=false
 * 로 네이티브 끌기를 끈다.
 *
 * 편집 세션 전용 표식이라 저장 시에는 제거된다(serializeSheets).
 */
export function markShapeIslands(doc) {
  for (const layer of doc.querySelectorAll('.wg-shape-layer')) {
    layer.setAttribute('contenteditable', 'false');
    layer.setAttribute('draggable', 'false');
  }
}

/** svg 인라인 스타일에서 mm 수치를 읽는다(없으면 0). */
export function shapeMm(shape, prop) {
  const v = parseFloat(shape.style.getPropertyValue(prop));
  return Number.isFinite(v) ? v : 0;
}

/** 도형의 현재 서식 — 인스펙터가 읽는다. */
export function shapeStyle(shape) {
  const cs = (name, fallback) => (shape.style.getPropertyValue(name) || fallback).trim();
  return {
    fill: cs('--wg-fill', SHAPE_DEFAULTS.fill),
    stroke: cs('--wg-stroke', SHAPE_DEFAULTS.stroke),
    strokeWidth: cs('--wg-sw', String(SHAPE_DEFAULTS.strokeWidth)),
    dash: cs('--wg-dash', SHAPE_DEFAULTS.dash),
    widthMm: shapeMm(shape, 'width'),
    heightMm: shapeMm(shape, 'height'),
    leftMm: shapeMm(shape, 'left'),
    topMm: shapeMm(shape, 'top'),
  };
}

/** 도형 서식/치수 갱신. patch 의 키만 바꾼다. */
export function setShapeStyle(shape, patch) {
  const map = {
    fill: '--wg-fill', stroke: '--wg-stroke', strokeWidth: '--wg-sw', dash: '--wg-dash',
  };
  for (const [key, prop] of Object.entries(map)) {
    if (patch[key] != null) shape.style.setProperty(prop, String(patch[key]));
  }
  for (const key of ['width', 'height', 'left', 'top']) {
    const mmKey = `${key}Mm`;
    if (patch[mmKey] != null) shape.style.setProperty(key, `${Math.round(patch[mmKey] * 10) / 10}mm`);
  }
}
