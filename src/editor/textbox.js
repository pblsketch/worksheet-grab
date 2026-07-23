// textbox — 활동지 위 자유 배치 텍스트 상자(구글 슬라이드·Canva 식).
//
// 도형(shapes.js)과 같은 "블록 앵커 + 절대배치" 섬이지만, 내용이 편집 가능한 텍스트라는
// 점이 다르다. 커서가 있던 .wg-block 안에 높이 0 의 기준점(.wg-text-layer)을 두고 그
// 기준점에 텍스트 상자를 절대배치한다. 쪽이 아니라 블록에 앵커하는 이유는 도형과 같다 —
// 리플로우로 블록이 다음 쪽으로 밀리면 텍스트 상자도 함께 가야 인쇄 사고가 안 난다.
//
// 두 가지 모드(슬라이드/Canva 관례):
//   · 개체 모드(기본) — 단일 클릭으로 선택, 끌어서 이동, 모서리로 크기. 캐럿은 안 들어간다.
//   · 편집 모드 — 더블클릭으로 진입, 안쪽 .wg-text 가 contenteditable=true 가 되어 타이핑.
// 레이어는 항상 contenteditable=false 섬이고, 안쪽 .wg-text 의 편집 가능 여부만 토글한다.
// 편집 모드에서 글자를 고르면 기존 툴바(bold·색·폰트·정렬)가 execCommand 로 그대로 먹는다.
//
// 치수는 mm(인쇄 진실원천). 폭은 명시, 높이는 기본 자동(내용에 따라 늘어남) — s 핸들을
// 끌면 명시 높이가 붙는다. 서식은 CSS 변수로 실어 저장 innerHTML 에 그대로 왕복한다.

export const TEXT_DEFAULTS = {
  fontSize: 11, // pt
  color: '#333333',
  align: 'left', // left | center | right
  widthMm: 50,
};

const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 텍스트 상자 1개의 마크업(앵커 기준점 포함). 내용이 비면 자리표시 없이 빈 상자. */
export function textboxMarkup(opts = {}) {
  const {
    text = '', leftMm = 0, topMm = 0, widthMm = TEXT_DEFAULTS.widthMm, heightMm = null,
    fontSize = TEXT_DEFAULTS.fontSize, color = TEXT_DEFAULTS.color, align = TEXT_DEFAULTS.align,
  } = opts;
  const style = [
    `left:${round(leftMm)}mm`, `top:${round(topMm)}mm`, `width:${round(widthMm)}mm`,
    heightMm != null ? `height:${round(heightMm)}mm` : null,
    `--wg-fs:${fontSize}pt`, `--wg-color:${color}`, `--wg-align:${align}`,
  ].filter(Boolean).join(';');
  return `<div class="wg-text-layer"><div class="wg-text" style="${style}">${esc(text)}</div></div>`;
}

function round(v) { return Math.round((Number(v) || 0) * 10) / 10; }

/**
 * 커서가 놓인 .wg-block 안에 텍스트 상자를 넣는다.
 * @returns {HTMLElement|null} 삽입된 .wg-text
 */
export function insertTextbox(doc, block, opts = {}) {
  if (!block) return null;
  const holder = doc.createElement('div');
  holder.innerHTML = textboxMarkup(opts);
  const layer = holder.firstElementChild;
  block.appendChild(layer);
  return layer.querySelector('.wg-text');
}

/** el 이 텍스트 상자 본체인가. */
export const isTextbox = (el) => !!el?.classList?.contains('wg-text');

/**
 * 텍스트 상자를 편집 세션 전용 상태로 표식한다.
 * 레이어는 비편집 섬(캐럿·네이티브 DnD 차단), 안쪽 .wg-text 는 개체 모드(비편집)로 시작.
 * 편집 모드 진입은 setTextboxEditing 이 담당한다. 저장 시 이 표식은 제거된다.
 */
export function markTextIslands(doc) {
  for (const layer of doc.querySelectorAll('.wg-text-layer')) {
    layer.setAttribute('contenteditable', 'false');
    layer.setAttribute('draggable', 'false');
    const text = layer.querySelector('.wg-text');
    if (text && text.getAttribute('contenteditable') !== 'true') {
      text.setAttribute('contenteditable', 'false');
    }
  }
}

/** 편집 모드 토글 — on 이면 캐럿 진입 가능(contenteditable=true), off 면 개체 모드. */
export function setTextboxEditing(textEl, on) {
  if (!isTextbox(textEl)) return;
  textEl.setAttribute('contenteditable', on ? 'true' : 'false');
}

/** 인라인 style 에서 mm 수치를 읽는다(없으면 null). */
export function textboxMm(textEl, prop) {
  const raw = textEl.style.getPropertyValue(prop);
  if (!raw) return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

/** 텍스트 상자의 현재 서식·치수 — 인스펙터가 읽는다. */
export function textboxStyle(textEl) {
  const cssvar = (name, fallback) => (textEl.style.getPropertyValue(name) || fallback).trim();
  return {
    text: textEl.textContent,
    fontSize: parseFloat(cssvar('--wg-fs', `${TEXT_DEFAULTS.fontSize}pt`)) || TEXT_DEFAULTS.fontSize,
    color: cssvar('--wg-color', TEXT_DEFAULTS.color),
    align: cssvar('--wg-align', TEXT_DEFAULTS.align),
    widthMm: textboxMm(textEl, 'width') ?? TEXT_DEFAULTS.widthMm,
    heightMm: textboxMm(textEl, 'height'), // null = 자동 높이
    leftMm: textboxMm(textEl, 'left') ?? 0,
    topMm: textboxMm(textEl, 'top') ?? 0,
  };
}

/** 서식/치수 갱신 — patch 의 키만 바꾼다. */
export function setTextboxStyle(textEl, patch) {
  if (patch.fontSize != null) textEl.style.setProperty('--wg-fs', `${patch.fontSize}pt`);
  if (patch.color != null) textEl.style.setProperty('--wg-color', String(patch.color));
  if (patch.align != null) textEl.style.setProperty('--wg-align', String(patch.align));
  for (const key of ['width', 'height', 'left', 'top']) {
    const mmKey = `${key}Mm`;
    if (patch[mmKey] != null) textEl.style.setProperty(key, `${round(patch[mmKey])}mm`);
  }
}
