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
    /* 도형은 **칠해진 곳만** 잡는다(2026-07-28 — HANDOFF-object-schema §8 의 미해결 항목).
       도형 마크업은 div.wg-shape > svg > (rect|ellipse|line) 인데, div 와 svg 루트가 블록 박스라
       rect 전면에서 클릭을 먹었다 — 실측: fill:none 인 테두리 도형의 **빈 속**을 눌러도 아래 문단이
       아니라 도형이 선택됐다. 도형은 배경으로 깔라고 있는 타입이고(그래서 겹침 advisory 에서도
       제외한다) 속이 비었으면 아래가 눌리는 것이 자연스럽다.
       박스 두 겹을 통과시키고 실제 그려진 요소만 남기면, 판정은 CSS 가 알아서 해 준다 —
       visiblePainted 는 fill:none 이면 내부를 잡지 않고 stroke 만 잡는다. 그래서 "채운 도형은
       자기가 잡고, 테두리 도형은 선만 잡는다"가 별도 분기 없이 성립한다.
       선택 여부로 가르지 않는다: 선택된 도형이라고 빈 속이 갑자기 실체가 되지는 않으며, 조작은
       손잡이·리사이즈 핸들·stroke 로 충분하다.
       이 규칙은 편집기 전용이다 — blocks.css(학생 배포본 공유 자산)에는 넣지 않는다. */
    .wg-float > .wg-shape, .wg-float > .wg-shape > svg { pointer-events: none; }
    .wg-float > .wg-shape > svg > * { pointer-events: visiblePainted; }
    .wg-float.wg-selected, .wg-float.wg-editing { pointer-events: auto; cursor: grab; }
    /* flow 조작 칩과 같은 규칙(2026-07-28): 평소엔 숨고 가리킨 개체의 것만 드러난다. 종전엔 자유
       배치 개체마다 검은 칩이 불투명하게 항상 떠 있었다. 이 손잡이는 없앨 수 없다 — 미선택 float
       래퍼는 pointer-events:none 이라(스파이크 4-5 의 z-order 완화) 이것이 유일한 진입점이다.
       내용 위 hover 로 드러나므로 발견성은 유지된다: 래퍼는 none 이어도 자식은 auto 라 내용
       위에서는 pointermove 가 뜬다. */
    .wg-float-handle {
      position: absolute; top: -9px; left: -9px; width: 18px; height: 18px; z-index: 5;
      display: flex; align-items: center; justify-content: center;
      background: #111827; color: #fff; border-radius: 4px; font-size: 11px;
      pointer-events: auto; cursor: grab; user-select: none;
      opacity: 0; transition: opacity .12s ease-out;
    }
    .wg-float-handle.is-hot { opacity: .55; }
    .wg-float-handle:hover { opacity: 1; }
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
    /* 문항 선지·항목 인라인 편집(#3 2차) + 개체 부가 텍스트 조각 인라인 편집(#1·#1b) —
       학습목표 문장·박스 제목, 제목 배지/모서리/출처, 지문 제목/출처, 표 캡션.
       hover 시 옅은 밑줄로 "여기 고칠 수 있다"를 알린다(outline 계열이라 레이아웃 박스 불변 — R2-1). */
    .q-part[data-part], .wg-part[data-part] { cursor: text; }
    .q-part[data-part]:hover, .wg-part[data-part]:hover {
      outline: 1px dashed rgba(37,99,235,.55); outline-offset: 1px; border-radius: 3px;
    }
    /* 편집 표식은 조각의 **글자색·배경을 건드리지 않는다**(2026-07-28). 종전엔 배경을 반투명
       노랑으로 덮어썼는데, 자기 배경 위에 흰 글자를 얹은 조각 — 제목 배지 .pill(청록 바탕
       흰 글자) — 은 더블클릭하는 순간 **흰 바탕에 흰 글자가 되어 글자가 사라졌다**(사용자 보고,
       실측: background rgb(0,131,143) → rgba(255,235,59,.12) 인데 color 는 흰색 그대로).
       어떤 배색의 조각이 와도 안전하도록 바깥 글(box-shadow)로만 강조한다 — outline/box-shadow 는
       레이아웃 박스를 바꾸지 않아 R2-1 에도 무해하다.
       ⚠ 이 CSS 는 JS 템플릿 리터럴 안이다 — 주석에도 백틱을 쓰면 리터럴이 거기서 끊겨
       편집기 전체가 부팅에 실패한다(이 주석을 쓰다가 실제로 냈다). */
    .q-part.wg-part-editing, .wg-part.wg-part-editing {
      outline: 2px solid #dc2626; outline-offset: 1px; border-radius: 3px;
      box-shadow: 0 0 0 3px rgba(220,38,38,.18);
    }
    /* 표 셀 편집·병합·열 너비(#10) */
    td[data-r], th[data-r] { cursor: text; }
    .wg-cell-active { outline: 2px solid #2563eb !important; outline-offset: -2px; background: rgba(37,99,235,.07); }
    .wg-cell-editing { outline: 2px solid #dc2626 !important; background: rgba(255,235,59,.10); }
    .wg-col-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
    .wg-col-handle { position: absolute; top: 0; bottom: 0; width: 7px; pointer-events: auto; cursor: col-resize; }
    .wg-col-handle::after { content: ""; position: absolute; left: 3px; top: 0; bottom: 0; width: 1px; background: #2563eb; opacity: .3; }
    .wg-col-handle:hover::after { opacity: 1; width: 2px; }
    .wg-flow-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
    /* ⠿(끌기)와 +(삽입)를 **가로로** 갈라 놓는다(2026-07-28). 종전엔 둘 다 left:-22px 이고 세로로만
       엇갈려 있었는데, 컨트롤이 18px 인데 본문 개체 높이가 20px 남짓이라 세로 공간이 애초에 모자랐다
       — 실측에서 ⠿ 중심(top+9)이 정확히 + 의 시작점이라, 나중에 append 되는 + 가 히트테스트를
       가져가 ⠿ 를 아예 잡을 수 없었다(divider 처럼 높이 2px 면 완전히 겹친다). 세로 간격을 벌리는
       방식은 개체 사이 gap(약 14px)이 컨트롤보다 좁아 다음 개체의 ⠿ 를 덮는 문제로 옮겨갈 뿐이다.
       + 의 세로 위치(개체 하단)는 "이 개체 뒤에 삽입"이라는 뜻이라 그대로 두고 x 만 옮겼다.
       z-index 는 그래도 ⠿ 를 위로 — 좁은 여백에서 둘이 스치더라도 끌기를 잃지 않게 하는 안전판. */
    /* 평소에는 **보이지 않는다**(2026-07-28). 종전엔 개체마다 ⠿ 와 + 가 opacity:.35 로 항상 떠
       있어 왼쪽 여백에 칩이 개체 수만큼 줄줄이 늘어섰다 — 사용자 피드백의 실체는 기능이 아니라
       이 상시 노출이었다. 그래서 **가리키는 개체의 것만** 드러낸다(캔버스 편집기의 일반 관례).
       기능은 그대로 둔다: 얇은 개체는 몸통으로 못 잡는다(실측 — page-break 는 높이 0, divider 는
       2px 이라 본체 드래그가 성립하지 않는다). 편집 모드 래퍼에 높이를 주는 우회는 편집 레이아웃만
       키워 R2-1 을 깨므로, 레이아웃을 안 건드리는 오버레이 진입점은 여전히 필요하다.
       pointer-events 는 숨은 동안에도 auto 로 둔다 — 개체에서 여백의 손잡이로 마우스를 옮기는
       동안 hover 가 끊기면 다가가는 도중에 사라진다(종전과 히트테스트 동작 동일). */
    .wg-flow-handle, .wg-flow-insert { opacity: 0; transition: opacity .12s ease-out; }
    .wg-flow-handle.is-hot, .wg-flow-insert.is-hot { opacity: .55; }
    .wg-flow-handle {
      position: absolute; left: -22px; width: 18px; height: 18px; display: flex; align-items: center;
      justify-content: center; background: #374151; color: #fff; border-radius: 4px; font-size: 11px;
      pointer-events: auto; cursor: grab; user-select: none; z-index: 2;
    }
    .wg-flow-handle:hover { opacity: 1; }
    .wg-flow-insert {
      position: absolute; left: -44px; width: 18px; height: 18px; border: 0; border-radius: 4px;
      background: #2563eb; color: #fff; font-size: 13px; line-height: 1;
      pointer-events: auto; cursor: pointer; z-index: 1;
    }
    /* 키보드 사용자는 hover 가 없다 — + 는 button 이라 초점을 받을 수 있으므로 그때 드러낸다. */
    .wg-flow-insert:hover, .wg-flow-insert:focus-visible { opacity: 1; }
    /* flow 개체 크기 손잡이(2026-07-28) — 오버레이 층이라 개체 레이아웃 박스를 건드리지 않는다.
       크기 **값** 자체는 절대 여기 두지 않는다(R2-1): 인쇄가 못 보는 선언이 되어 페이지 수가
       갈린다. 값은 RenderObjectTree 가 인라인으로 낸다. 여기 있는 것은 손잡이 모양뿐이다.
       flow 는 좌표가 없어 오른쪽(폭)·아래(최소 높이)·모서리 3방향만 낸다. */
    .wg-size-handle {
      position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px;
      background: #fff; border: 2px solid #2563eb; border-radius: 2px;
      pointer-events: auto; z-index: 5;
    }
    .wg-size-handle:hover { background: #2563eb; }
    .wg-sh-e { cursor: ew-resize; }
    .wg-sh-s { cursor: ns-resize; }
    .wg-sh-se { cursor: nwse-resize; }
    /* 기본 개체 연속 드래그 재정렬 중 시각 피드백(#1·#2 2차) */
    .wg-flow-dragging { opacity: .55; outline: 2px dashed #2563eb; outline-offset: 1px; }
    /* 개체 몸통 드래그 재정렬 중 텍스트 선택 억제 — 승격 전 임계 구간(≤5px)에서 브라우저 네이티브
       선택이 이미 시작될 수 있어(실측: 10스텝 드래그에 23자) removeAllRanges 로 끊고 여기서
       재시작을 막는다. user-select 는 레이아웃 박스를 바꾸지 않으므로 위 R2-1 규약을 지킨다. */
    body.wg-body-dragging { user-select: none; }
    /* 레이아웃 전용 개체 2종 — 인쇄에는 아무것도 안 보이므로 편집 화면에서만 표식을 준다.
       ⚠ 위 R2-1 규약대로 **레이아웃 박스를 건드리지 않는다**: outline(흐름 밖) + position:relative
       (박스 크기 불변) + 절대배치 ::after 만 쓴다. margin/padding/height 는 절대 쓰지 않는다 —
       그러면 편집 측정과 인쇄 높이가 갈린다. 빈 공간의 height 와 페이지 나누기의 height:0 은
       렌더가 인라인으로 방출하므로 편집·인쇄가 같은 값을 쓴다. */
    .wg-spacer {
      position: relative; outline: 1px dashed rgba(100,116,139,.5); outline-offset: -1px;
      background: repeating-linear-gradient(135deg, rgba(100,116,139,.05) 0 6px, transparent 6px 12px);
    }
    .wg-spacer::after {
      content: attr(data-spacer-label); position: absolute; top: 2px; left: 4px;
      font-size: 8px; color: #94a3b8; pointer-events: none; white-space: nowrap;
    }
    .wg-pagebreak { position: relative; }
    .wg-pagebreak::after {
      content: "⎯⎯ 페이지 나누기 ⎯⎯"; position: absolute; left: 0; right: 0; top: -7px;
      text-align: center; font-size: 8px; letter-spacing: .04em; color: #dc2626;
      border-top: 1px dashed rgba(220,38,38,.55); pointer-events: none;
    }
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
