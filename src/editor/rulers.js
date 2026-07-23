// rulers — 눈금자 · 격자 · 정렬 안내선(파워포인트 모델).
//
// 셋 다 부모 오버레이에만 그린다. iframe(.sheet) 안에 편집 크롬을 주입하지 않는다는
// 원칙 때문이다 — 주입하면 역동기화가 그걸 문서 내용으로 포집해 저장본이 오염된다.
//
// 단위는 mm 다. 이 제품의 진실원천이 A4 인쇄이고, 교사가 "여백 15mm" 처럼 mm 로 말한다.
// px 눈금은 화면에서만 뜻이 있고 인쇄와 어긋난다.

const MM = 96 / 25.4;

/** 눈금 간격 — 자에 숫자를 몇 mm 마다 쓸지. 10mm 는 A4(210×297)에서 읽기 좋은 단위. */
const MAJOR_MM = 10;
const MINOR_MM = 5;

function tick(cls, styles) {
  const el = document.createElement('div');
  el.className = cls;
  Object.assign(el.style, styles);
  return el;
}

/**
 * 시트 위·왼쪽에 자를 그린다. 각 쪽마다 붙여 어느 쪽을 보든 바로 잴 수 있게 한다.
 * @param {{overlay:Element, sheets:Element[], frameLeft:number, frameTop:number}} ctx
 */
export function drawRulers({ overlay, sheets, frameLeft, frameTop }) {
  for (const sheet of sheets) {
    const r = sheet.getBoundingClientRect();
    const x0 = frameLeft + r.left;
    const y0 = frameTop + r.top;
    const wMm = r.width / MM;
    const hMm = r.height / MM;

    const hBar = tick('ruler ruler-h', { left: `${x0}px`, top: `${y0 - 18}px`, width: `${r.width}px` });
    const vBar = tick('ruler ruler-v', { left: `${x0 - 18}px`, top: `${y0}px`, height: `${r.height}px` });

    for (let mm = 0; mm <= wMm + 0.5; mm += MINOR_MM) {
      const major = mm % MAJOR_MM === 0;
      const t = tick(`ruler-tick${major ? ' major' : ''}`, { left: `${mm * MM}px` });
      if (major && mm > 0) {
        const label = document.createElement('span');
        label.className = 'ruler-label';
        label.textContent = String(mm);
        t.appendChild(label);
      }
      hBar.appendChild(t);
    }
    for (let mm = 0; mm <= hMm + 0.5; mm += MINOR_MM) {
      const major = mm % MAJOR_MM === 0;
      const t = tick(`ruler-tick${major ? ' major' : ''}`, { top: `${mm * MM}px` });
      if (major && mm > 0) {
        const label = document.createElement('span');
        label.className = 'ruler-label';
        label.textContent = String(mm);
        t.appendChild(label);
      }
      vBar.appendChild(t);
    }
    overlay.append(hBar, vBar);
  }
}

/**
 * 격자. 시트 전체에 깔되 그리기는 CSS 그라디언트 한 장으로 끝낸다 —
 * mm 당 요소를 만들면 A4 한 쪽에 수백 개가 생겨 스크롤이 버벅인다.
 */
export function drawGrid({ overlay, sheets, frameLeft, frameTop, spacingMm = 5 }) {
  const step = spacingMm * MM;
  for (const sheet of sheets) {
    const r = sheet.getBoundingClientRect();
    const g = tick('canvas-grid', {
      left: `${frameLeft + r.left}px`,
      top: `${frameTop + r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      backgroundSize: `${step}px ${step}px, ${step}px ${step}px, ${step * 2}px ${step * 2}px, ${step * 2}px ${step * 2}px`,
    });
    overlay.appendChild(g);
  }
}

/**
 * 정렬 안내선 판정 — 개체 중심이 쪽 중심과 맞는가.
 * 스냅 임계는 화면 픽셀이 아니라 mm 로 잡는다(확대율이 달라져도 손맛이 같아야 한다).
 *
 * @returns {{snapDx:number, snapDy:number, guides:{axis:'x'|'y', at:number}[]}}
 *   snapDx/Dy 는 "지금 위치에서 얼마나 더 밀어야 정확히 중앙인가"(px).
 */
export function centerSnap(objRect, sheetRect, thresholdMm = 2) {
  const t = thresholdMm * MM;
  const guides = [];
  let snapDx = 0;
  let snapDy = 0;

  const objCx = objRect.left + objRect.width / 2;
  const sheetCx = sheetRect.left + sheetRect.width / 2;
  if (Math.abs(objCx - sheetCx) <= t) {
    snapDx = sheetCx - objCx;
    guides.push({ axis: 'x', at: sheetCx });
  }
  const objCy = objRect.top + objRect.height / 2;
  const sheetCy = sheetRect.top + sheetRect.height / 2;
  if (Math.abs(objCy - sheetCy) <= t) {
    snapDy = sheetCy - objCy;
    guides.push({ axis: 'y', at: sheetCy });
  }
  return { snapDx, snapDy, guides };
}

/** 정렬 안내선 그리기(드래그 중에만 보인다). at 은 시트 기준 좌표. */
export function drawAlignGuides({ overlay, guides, sheetRect, frameLeft, frameTop }) {
  for (const g of guides) {
    if (g.axis === 'x') {
      overlay.appendChild(tick('align-guide align-x', {
        left: `${frameLeft + g.at}px`,
        top: `${frameTop + sheetRect.top}px`,
        height: `${sheetRect.height}px`,
      }));
    } else {
      overlay.appendChild(tick('align-guide align-y', {
        top: `${frameTop + g.at}px`,
        left: `${frameLeft + sheetRect.left}px`,
        width: `${sheetRect.width}px`,
      }));
    }
  }
}
