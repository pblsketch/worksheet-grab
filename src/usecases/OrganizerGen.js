// OrganizerGen — 파라메트릭 시각 조직자 생성기.
//
// 엔진이 개수(params)로부터 SVG 를 **결정적으로** 그린다. 좌표·도형은 엔진이 계산하고,
// AI/교사는 개수만 지정한다 → '닫힌 카탈로그 · AI 좌표 생성 금지' 불변식을 지키면서도
// "원 3개 벤다이어그램", "개념 5칸 지도" 같은 요청에 맞춰 레이아웃을 바꿀 수 있다.
//
// 산출 HTML 은 정적 블록(blocks/core/venn.html 등)과 **같은 cssClass** 를 써서 blocks.css
// 스타일(색·인쇄안전 .keep)이 그대로 적용된다. params 없는 기본 개수는 정적 블록과 동일하다.

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const cap = (t) => `<div class="org-cap">${escText(t)}</div>`;

function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 슬롯 텍스트 — labels[key] 가 비어 있지 않으면 그 값을, 아니면 기본값 d 를 이스케이프해 돌려준다.
 * labels 는 슬롯 **이름(key)→글자** 맵이다(배열 index 가 아니라 이름 — 개수를 바꿔도 슬롯 뜻이 밀리지
 * 않게 한다, ADR §6-1). 기본값이 있는 슬롯은 d 로, 비어 있는(자유 기입) 슬롯은 d='' 로 호출해 값이
 * 없으면 빈 문자열을 받아 호출부가 <text> 자체를 생략한다(원본 빈 칸과 바이트 동일 유지).
 */
function slotText(labels, key, d = '') {
  const v = (labels && typeof labels === 'object' && !Array.isArray(labels)) ? labels[key] : undefined;
  return escText(v != null && String(v).trim() !== '' ? v : d);
}

/**
 * 벤다이어그램 — params.circles: 2(기본) 또는 3. labels: 슬롯 이름→글자 맵.
 *  - 2원 슬롯: left(A)·right(B)·common(공통점)
 *  - 3원 슬롯: a(A)·b(B)·c(C)·common(공통)
 * 좌표·도형·글자 크기는 엔진이 소유한다(원칙 3) — labels 는 슬롯 글자만 바꾼다. 슬롯을 이름으로
 * 저장하므로 원 개수를 2↔3 으로 바꿔도 공통(common) 라벨이 유지된다(ADR §6-1). 라벨은 이스케이프된다.
 * 시그니처 (params, labels) — 기존 호출 `vennSvg({circles})`(labels 미지정=기본 라벨)와 하위호환.
 */
export function vennSvg(params = {}, labels = {}) {
  const { circles = 2 } = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  const n = Number(circles) === 3 ? 3 : 2;
  if (n === 2) {
    return `<div class="venn keep">
    <svg width="440" height="240" viewBox="0 0 440 240" ${NS} role="img" aria-label="벤다이어그램(2원)">
      <circle cx="165" cy="125" r="100" stroke-width="1.6"/>
      <circle cx="275" cy="125" r="100" stroke-width="1.6"/>
      <text x="95" y="130" font-size="13" text-anchor="middle">${slotText(labels, 'left', 'A')}</text>
      <text x="345" y="130" font-size="13" text-anchor="middle">${slotText(labels, 'right', 'B')}</text>
      <text x="220" y="28" font-size="11" text-anchor="middle" class="v-mid">${slotText(labels, 'common', '공통점')}</text>
    </svg>
    ${cap('양쪽 바깥에는 차이점, 가운데 겹치는 곳에는 공통점을 쓰자.')}
  </div>`;
  }
  // 3원 — 삼각 배치(고전 3-집합 벤다이어그램).
  return `<div class="venn keep">
    <svg width="460" height="330" viewBox="0 0 460 330" ${NS} role="img" aria-label="벤다이어그램(3원)">
      <circle cx="185" cy="132" r="105" stroke-width="1.6"/>
      <circle cx="275" cy="132" r="105" stroke-width="1.6"/>
      <circle cx="230" cy="212" r="105" stroke-width="1.6"/>
      <text x="118" y="92" font-size="13" text-anchor="middle">${slotText(labels, 'a', 'A')}</text>
      <text x="342" y="92" font-size="13" text-anchor="middle">${slotText(labels, 'b', 'B')}</text>
      <text x="230" y="300" font-size="13" text-anchor="middle">${slotText(labels, 'c', 'C')}</text>
      <text x="230" y="150" font-size="10" text-anchor="middle" class="v-mid">${slotText(labels, 'common', '공통')}</text>
    </svg>
    ${cap('세 원이 겹치는 부분에는 공통점, 바깥에는 각 대상의 특징을 쓰자.')}
  </div>`;
}

/** 개념 지도 — params.nodes: 3~6칸(기본 4). 슬롯: center(핵심 개념)·node1..nodeN(자유 기입, 빈칸 기본). */
export function conceptMapSvg(params = {}, labels = {}) {
  const { nodes = 4 } = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  const n = Math.max(3, Math.min(6, Number(nodes) | 0 || 4));
  const W = 490, H = 350, cx = W / 2, cy = H / 2;
  const rx = 64, ry = 34;        // 중심 타원(연결선이 드러나도록 약간 축소)
  const R = 140;                 // 노드 배치 반경 — 상자가 타원과 충분히 떨어져 연결선이 보이게
  const bw = 104, bh = 42;       // 노드 상자
  let lines = '', boxes = '';
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI / n); // 위에서 시작, 시계방향
    const bx = cx + R * Math.cos(ang);
    const by = cy + R * Math.sin(ang);
    lines += `<line x1="${cx}" y1="${cy}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>\n      `;
    boxes += `<rect x="${(bx - bw / 2).toFixed(1)}" y="${(by - bh / 2).toFixed(1)}" width="${bw}" height="${bh}" rx="6" class="cm-node" stroke-width="1.2"/>\n      `;
    const t = slotText(labels, `node${i + 1}`, '');
    if (t) boxes += `<text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" font-size="11" text-anchor="middle">${t}</text>\n      `;
  }
  return `<div class="conceptmap keep">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${NS} role="img" aria-label="개념 지도(${n}칸)">
      ${lines}<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" class="cm-core" stroke-width="1.6"/>
      <text x="${cx}" y="${cy + 4}" font-size="12" text-anchor="middle">${slotText(labels, 'center', '핵심 개념')}</text>
      ${boxes}</svg>
    ${cap(`가운데 핵심 개념에서 뻗어 나가는 생각·낱말을 ${n}칸에 적자.`)}
  </div>`;
}

// 파라메트릭 생성이 가능한 조직자 타입 → 생성기. AssembleWorksheet 가 entry.params 있을 때 사용.
/** 피시본 — params.branches: 2~6개 원인 가지(기본 4). 슬롯: result(결과)·cause1..causeN(기본 '원인'). */
export function fishboneSvg(params = {}, labels = {}) {
  const { branches = 4 } = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  const n = Math.max(2, Math.min(6, Number(branches) | 0 || 4));
  const W = 490, H = 240, y = 120;
  let g = '';
  for (let i = 0; i < n; i++) {
    const sx = n === 1 ? 220 : 100 + i * (240 / (n - 1));
    const up = i % 2 === 0;
    const ex = sx - 46, ey = up ? 34 : 206;
    g += `<line x1="${sx.toFixed(1)}" y1="${y}" x2="${ex.toFixed(1)}" y2="${ey}" class="fb-branch" stroke-width="1.2"/>\n      `;
    g += `<text x="${(ex - 4).toFixed(1)}" y="${up ? 28 : 218}" font-size="9.5" text-anchor="middle" class="fb-lab">${slotText(labels, `cause${i + 1}`, '원인')}</text>\n      `;
  }
  return `<div class="fishbone keep">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${NS} role="img" aria-label="피시본(원인 ${n}개)">
      <line x1="24" y1="${y}" x2="406" y2="${y}" class="fb-spine" stroke-width="1.8"/>
      <polygon points="412,${y} 398,${y - 7} 398,${y + 7}" class="fb-arrow"/>
      <rect x="414" y="95" width="66" height="50" rx="6" class="fb-result" stroke-width="1.4"/>
      <text x="447" y="${y + 4}" font-size="10" text-anchor="middle">${slotText(labels, 'result', '결과')}</text>
      ${g}</svg>
    ${cap('오른쪽 결과가 왜 생겼는지 가지마다 원인을 적자.')}
  </div>`;
}

/** 순서 흐름도 — params.steps: 2~6단계(기본 4). 슬롯: step1..stepN(기본 단계 번호). */
export function flowchartSvg(params = {}, labels = {}) {
  const { steps = 4 } = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  const n = Math.max(2, Math.min(6, Number(steps) | 0 || 4));
  const bw = 88, bh = 46, gap = 42, mx = 12, y = 32;
  const W = mx * 2 + n * bw + (n - 1) * gap, H = 110;
  let boxes = '', arrows = '', labelsHtml = '';
  for (let i = 0; i < n; i++) {
    const x = mx + i * (bw + gap);
    boxes += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" class="fc-box"/>\n      `;
    labelsHtml += `<text x="${x + bw / 2}" y="${y + 29}" font-size="11" text-anchor="middle">${slotText(labels, `step${i + 1}`, String(i + 1))}</text>\n      `;
    if (i < n - 1) {
      const ax = x + bw, nx = x + bw + gap;
      arrows += `<line x1="${ax + 2}" y1="${y + 23}" x2="${nx - 6}" y2="${y + 23}" class="fc-link"/>`;
      arrows += `<polygon points="${nx},${y + 23} ${nx - 10},${y + 18} ${nx - 10},${y + 28}" class="fc-arrow"/>\n      `;
    }
  }
  return `<div class="flowchart keep">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${NS} role="img" aria-label="순서 흐름도(${n}단계)">
      ${arrows}${boxes}${labelsHtml}</svg>
    ${cap('왼쪽부터 순서대로 각 단계에 할 일이나 과정을 적자.')}
  </div>`;
}

/** 위계 트리 — params.children: 2~5개 하위(기본 3). 슬롯: top(상위 개념)·child1..childN(자유 기입, 빈칸 기본). */
export function hierarchySvg(params = {}, labels = {}) {
  const { children = 3 } = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  const n = Math.max(2, Math.min(5, Number(children) | 0 || 3));
  const cw = 120, ch = 52, gap = 18, cy = 150;
  const totalW = n * cw + (n - 1) * gap;
  const W = Math.max(300, totalW + 40), H = 216, cx = W / 2;
  const startX = (W - totalW) / 2;
  let boxes = '', lines = '';
  for (let i = 0; i < n; i++) {
    const x = startX + i * (cw + gap);
    lines += `<line x1="${cx}" y1="60" x2="${(x + cw / 2).toFixed(1)}" y2="${cy}" class="h-link"/>\n      `;
    boxes += `<rect x="${x.toFixed(1)}" y="${cy}" width="${cw}" height="${ch}" rx="6" class="h-node"/>\n      `;
    const t = slotText(labels, `child${i + 1}`, '');
    if (t) boxes += `<text x="${(x + cw / 2).toFixed(1)}" y="${cy + ch / 2 + 4}" font-size="11" text-anchor="middle">${t}</text>\n      `;
  }
  return `<div class="hierarchy keep">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${NS} role="img" aria-label="위계 트리(하위 ${n}개)">
      ${lines}<rect x="${(cx - 62).toFixed(1)}" y="14" width="124" height="46" rx="6" class="h-top"/>
      <text x="${cx}" y="42" font-size="12" text-anchor="middle">${slotText(labels, 'top', '상위 개념')}</text>
      ${boxes}</svg>
    ${cap('위쪽에 큰 개념, 아래에 그에 속하는 하위 개념을 적자.')}
  </div>`;
}

/** 헥사고날 싱킹 — params.count: 3~7개(기본 5). 슬롯: hex1..hexN(자유 기입, 빈칸 기본. 위줄부터 번호). */
export function hexagonSvg(params = {}, labels = {}) {
  const { count = 5 } = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  const n = Math.max(3, Math.min(7, Number(count) | 0 || 5));
  const R = 44, h = 38, sp = 100;
  const top = Math.ceil(n / 2), bot = n - top;
  const topW = top * sp, botW = bot * sp;
  const W = Math.max(topW, botW + sp / 2) + 40, H = bot > 0 ? 210 : 130;
  const hex = (cx, cy) => `<polygon points="${cx - R},${cy} ${cx - R / 2},${cy - h} ${cx + R / 2},${cy - h} ${cx + R},${cy} ${cx + R / 2},${cy + h} ${cx - R / 2},${cy + h}" class="hx"/>`;
  const hexText = (cx, cy, t) => (t ? `<text x="${cx}" y="${cy + 4}" font-size="11" text-anchor="middle">${t}</text>` : '');
  let g = '';
  const topStart = (W - topW) / 2 + sp / 2;
  for (let i = 0; i < top; i++) { const x = topStart + i * sp; g += hex(x, 75) + hexText(x, 75, slotText(labels, `hex${i + 1}`, '')) + '\n      '; }
  const botStart = (W - botW) / 2 + sp / 2;
  for (let i = 0; i < bot; i++) { const x = botStart + i * sp; g += hex(x, 165) + hexText(x, 165, slotText(labels, `hex${top + i + 1}`, '')) + '\n      '; }
  return `<div class="hexagon keep">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${NS} role="img" aria-label="헥사고날 싱킹(${n}개)">
      ${g}</svg>
    ${cap('각 육각형에 핵심 낱말을 하나씩 쓰고, 관련 있는 것끼리 변을 맞대어 연결하자.')}
  </div>`;
}

export const ORGANIZER_GENERATORS = {
  venn: vennSvg,
  conceptmap: conceptMapSvg,
  fishbone: fishboneSvg,
  flowchart: flowchartSvg,
  hierarchy: hierarchySvg,
  hexagon: hexagonSvg,
};

/**
 * SVG 조직자를 박스(px) 안에 꽉 맞게 스케일한다(가로/세로 중 꽉 차는 쪽 기준, 비율 유지 → 잘림 0).
 * viewBox 가 있는 SVG 만 대상. 표 등 viewBox 없는 HTML 은 그대로 반환(폭은 이미 width:100%).
 * @param {string} html 조직자 HTML
 * @param {number} boxW 박스 폭(px)
 * @param {number} boxH 박스 높이(px)
 */
export function fitSvgToBox(html, boxW, boxH) {
  const vb = html.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!vb || !(boxW > 0) || !(boxH > 0)) return html;
  const vbW = parseFloat(vb[1]), vbH = parseFloat(vb[2]);
  const s = Math.min(boxW / vbW, boxH / vbH);
  const w = Math.round(vbW * s), h = Math.round(vbH * s);
  return html.replace(/<svg width="\d+(?:\.\d+)?" height="\d+(?:\.\d+)?"/, `<svg width="${w}" height="${h}"`);
}

// 자연어 요청 → 파라메트릭 조직자 {type, params}. 교사의 "벤다이어그램 3원", "개념 5칸" 같은
// 문구에서 조직자 종류와 개수를 뽑는다. 무API 원칙상 자연어 이해의 주체는 AI 오케스트레이터이며,
// 이 헬퍼는 흔한 개수 표현을 결정적으로 파싱하는 편의·폴백이다(범위 밖 개수는 클램프).
const ORG_NL_SPECS = [
  { type: 'venn', kw: ['벤다이어그램', '벤 다이어그램'], param: 'circles', units: ['원'], min: 2, max: 3 },
  { type: 'conceptmap', kw: ['개념지도', '개념 지도', '마인드맵', '생각그물'], param: 'nodes', units: ['칸', '개념', '가지'], min: 3, max: 6 },
  { type: 'fishbone', kw: ['피시본', '생선뼈', '물고기뼈'], param: 'branches', units: ['가지', '원인'], min: 2, max: 6 },
  { type: 'flowchart', kw: ['흐름도', '순서도', '플로차트'], param: 'steps', units: ['단계', '칸'], min: 2, max: 6 },
  { type: 'hierarchy', kw: ['위계', '계층 구조', '분류 체계'], param: 'children', units: ['하위', '자식', '갈래'], min: 2, max: 5 },
  { type: 'hexagon', kw: ['헥사고날', '헥사곤', '육각형'], param: 'count', units: ['개', '칸'], min: 3, max: 7 },
];

/** 자연어 문구에서 파라메트릭 조직자 요청을 파싱. 없으면 null. */
export function parseOrganizerSpec(text) {
  const t = String(text || '');
  for (const o of ORG_NL_SPECS) {
    if (!o.kw.some((k) => t.includes(k))) continue;
    let num = null;
    for (const u of o.units) {
      const m = t.match(new RegExp(`(\\d+)\\s*${u}`)) || t.match(new RegExp(`${u}\\s*(\\d+)`));
      if (m) { num = Number(m[1]); break; }
    }
    if (num == null) { const m = t.match(/(\d+)\s*(개|원|칸|가지|단계|하위)/); if (m) num = Number(m[1]); }
    const params = {};
    if (num != null) params[o.param] = Math.max(o.min, Math.min(o.max, num));
    return { type: o.type, params };
  }
  return null;
}
