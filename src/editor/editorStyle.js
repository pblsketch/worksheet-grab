// editorStyle.js — teacher iframe 문서에 주입하는 편집 보조 CSS.
//
// 부모 문서의 editor.css 는 iframe 내부에 닿지 않으므로, 개체 경계 시각화·자유 개체 pointer-events
// 정책·손잡이·눈금자·격자·AI 배지 같은 "편집 중에만 보이는" 스타일은 프레임 로드마다 여기서
// <style> 로 심는다. Phase 5 에서 editor.js 로부터 그대로 떼어 왔다(선언 내용 무변경).
//
// R2-1 주의: 이 CSS 는 편집 화면 전용이라 **레이아웃 박스를 바꾸면 안 된다** — 편집==인쇄 하드
// 동치는 리플로우 측정(editMode:true)과 인쇄(false)가 같은 흐름 높이를 내는 데 달려 있다.
// 그래서 여기 있는 규칙은 전부 outline/background/position:absolute 오버레이·pointer-events 뿐이고
// margin/padding/width 처럼 흐름을 미는 속성은 쓰지 않는다.

/** 개체 경계 시각화(선택/편집 외곽선) + float 미선택 pointer-events:none 정책 + flow 오버레이
 *  핸들/삽입버튼 스타일을 iframe head 에 주입한다. 부모 CSS(editor.css)는 iframe 내부에 닿지 않는다. */
export function injectEditorStyle(doc) {
  const style = doc.createElement('style');
  style.id = 'wg-editor-style';
  style.textContent = `
    .sheet { position: relative; }
    [data-oid] { cursor: pointer; }
    [data-oid].wg-selected { outline: 2px solid #2563eb; outline-offset: 1px; }
    [data-oid].wg-editing { outline: 2px solid #dc2626 !important; background: rgba(255,235,59,.08); }
    [contenteditable="true"] { outline: 2px solid #dc2626 !important; cursor: text; }
    .wg-float:not(.wg-selected) { pointer-events: none; }
    /* 미선택 자유 개체의 "내용"은 클릭 가능(개체 몸통 클릭=선택, 이어서 드래그=이동 — 슬라이드/캔바
       관례). 래퍼 자신은 pointer-events:none 을 유지해 내용이 없는 빈 영역은 아래 flow 로 클릭이
       통과한다(스파이크 §4-5 z-order 완화 취지 보존 — 내용 위 클릭만 개체를 잡는다). 드래그 역학은
       ⠿ 핸들 경로와 동일(pointerdown → startFloatDrag: 선택 후 이동, 실마우스 검증된 pointer capture). */
    .wg-float:not(.wg-selected) > * { pointer-events: auto; }
    .wg-float.wg-selected, .wg-float.wg-editing { pointer-events: auto; cursor: grab; }
    .wg-float-handle {
      position: absolute; top: -9px; left: -9px; width: 18px; height: 18px; z-index: 5;
      display: flex; align-items: center; justify-content: center;
      background: #111827; color: #fff; border-radius: 4px; font-size: 11px;
      pointer-events: auto; cursor: grab; user-select: none;
    }
    /* 자유 개체 8방향 리사이즈 손잡이(#8) — 단일 선택·비편집 상태에서만 selection.js 가 붙인다. */
    .wg-resize-handle {
      position: absolute; width: 11px; height: 11px; z-index: 7; background: #2563eb;
      border: 1.5px solid #fff; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.2);
      pointer-events: auto; user-select: none;
    }
    .wg-rh-nw { top: -6px; left: -6px; cursor: nwse-resize; }
    .wg-rh-n  { top: -6px; left: calc(50% - 5.5px); cursor: ns-resize; }
    .wg-rh-ne { top: -6px; right: -6px; cursor: nesw-resize; }
    .wg-rh-e  { top: calc(50% - 5.5px); right: -6px; cursor: ew-resize; }
    .wg-rh-se { bottom: -6px; right: -6px; cursor: nwse-resize; }
    .wg-rh-s  { bottom: -6px; left: calc(50% - 5.5px); cursor: ns-resize; }
    .wg-rh-sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .wg-rh-w  { top: calc(50% - 5.5px); left: -6px; cursor: ew-resize; }
    /* 문항 선지·항목 인라인 편집(#3 2차) */
    .q-part[data-part] { cursor: text; }
    .q-part.wg-part-editing { outline: 2px solid #dc2626; background: rgba(255,235,59,.12); border-radius: 3px; }
    /* 표 셀 편집·병합·열 너비(#10) */
    td[data-r], th[data-r] { cursor: text; }
    .wg-cell-active { outline: 2px solid #2563eb !important; outline-offset: -2px; background: rgba(37,99,235,.07); }
    .wg-cell-editing { outline: 2px solid #dc2626 !important; background: rgba(255,235,59,.10); }
    .wg-col-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
    .wg-col-handle { position: absolute; top: 0; bottom: 0; width: 7px; pointer-events: auto; cursor: col-resize; }
    .wg-col-handle::after { content: ""; position: absolute; left: 3px; top: 0; bottom: 0; width: 1px; background: #2563eb; opacity: .3; }
    .wg-col-handle:hover::after { opacity: 1; width: 2px; }
    .wg-flow-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
    .wg-flow-handle {
      position: absolute; left: -22px; width: 18px; height: 18px; display: flex; align-items: center;
      justify-content: center; background: #374151; color: #fff; border-radius: 4px; font-size: 11px;
      opacity: .35; pointer-events: auto; cursor: grab; user-select: none;
    }
    .wg-flow-handle:hover { opacity: 1; }
    .wg-flow-insert {
      position: absolute; left: -22px; width: 18px; height: 18px; border: 0; border-radius: 4px;
      background: #2563eb; color: #fff; font-size: 13px; line-height: 1; opacity: .35;
      pointer-events: auto; cursor: pointer;
    }
    .wg-flow-insert:hover { opacity: 1; }
    /* 기본 개체 연속 드래그 재정렬 중 시각 피드백(#1·#2 2차) */
    .wg-flow-dragging { opacity: .55; outline: 2px dashed #2563eb; outline-offset: 1px; }
    /* 개체 몸통 드래그 재정렬 중 텍스트 선택 억제 — 승격 전 임계 구간(≤5px)에서 브라우저 네이티브
       선택이 이미 시작될 수 있어(실측: 10스텝 드래그에 23자) removeAllRanges 로 끊고 여기서
       재시작을 막는다. user-select 는 레이아웃 박스를 바꾸지 않으므로 위 R2-1 규약을 지킨다. */
    body.wg-body-dragging { user-select: none; }
    body.wg-show-margins .sheet::after {
      content: ""; position: absolute; inset: var(--sheet-pad, 12mm 15mm 10mm 15mm);
      border: 1px dashed rgba(37,99,235,.55); pointer-events: none; z-index: 3;
    }
    /* 격자(#1) — 투명도는 --wg-grid-alpha(툴바 보기 메뉴 슬라이더가 body 에 세팅) 로 조절한다. */
    body.wg-show-grid .sheet {
      background-image:
        repeating-linear-gradient(0deg, rgba(37,99,235,var(--wg-grid-alpha,.08)) 0 1px, transparent 1px 5mm),
        repeating-linear-gradient(90deg, rgba(37,99,235,var(--wg-grid-alpha,.08)) 0 1px, transparent 1px 5mm);
    }
    /* 눈금자(#2) — canvasInline.decorateRulers 가 .sheet 마다 상단·좌측 자를 붙이고, 여기 CSS 가
       body.wg-show-ruler 일 때만 표시한다. 눈금·숫자는 mm 단위로 배치해 줌 변형과 함께 스케일된다. */
    .wg-ruler-top, .wg-ruler-left { display: none; }
    body.wg-show-ruler .wg-ruler-top, body.wg-show-ruler .wg-ruler-left {
      display: block; position: absolute; z-index: 4; pointer-events: none;
      background: rgba(248,250,252,.92); color: #64748b; font-size: 7px; line-height: 1;
    }
    body.wg-show-ruler .wg-ruler-top {
      top: 0; left: 0; right: 0; height: 5.2mm; border-bottom: 1px solid #cbd5e1;
      background-image: repeating-linear-gradient(90deg, #94a3b8 0 1px, transparent 1px 5mm);
    }
    body.wg-show-ruler .wg-ruler-left {
      top: 0; left: 0; bottom: 0; width: 5.2mm; border-right: 1px solid #cbd5e1;
      background-image: repeating-linear-gradient(0deg, #94a3b8 0 1px, transparent 1px 5mm);
    }
    .wg-ruler-num { position: absolute; color: #475569; }
    .wg-ruler-top .wg-ruler-num { top: 0.7mm; transform: translateX(1px); }
    .wg-ruler-left .wg-ruler-num { left: 0.6mm; transform: translateY(-3px); }
    /* US-19 AI 산출 졸업 배지 — data-ai-fresh는 일시적: 사용자가 그 개체를 편집하는 순간 제거된다. */
    [data-ai-fresh="true"] { position: relative; }
    [data-ai-fresh="true"]::after {
      content: "AI"; position: absolute; top: -8px; right: -8px; z-index: 6;
      background: #7c3aed; color: #fff; font-size: 9px; font-weight: 800; line-height: 1;
      padding: 3px 4px; border-radius: 4px; pointer-events: none;
    }
  `;
  doc.head.appendChild(style);
}
