// floatLayout.js — 자유 배치(float) 개체의 배치 위생 advisory 3종.
//
// **경고만 한다.** 여기서 나오는 어떤 finding 도 export 를 막지 않는다(severity 전건 'warning',
// exportGate.js 무접촉). 인쇄물 편집기에서 겹침·이탈은 "틀린 상태"가 아니라 "교사가 알고 정할 일"
// 이라, 판정이 아니라 신호를 주는 것이 이 모듈의 역할이다.
//
// ── 왜 src/usecases 가 아니라 여기(src/editor)인가 ─────────────────────────────
// 규칙 3종 중 float-covers-flow 는 **DOM 측정**이 필요하다. flow 개체에는 정의상 rect 가 없어
// (objectFactory 의 delete obj.rect — 원칙 3) 순수 개체 트리만으로는 원리적으로 계산할 수 없다.
// 규칙 집합을 두 계층으로 쪼개는 것보다 측정이 있는 편집기 계층에 모으는 편이 낫다.
// 부수 효과로 **이 모듈 자신의** 서빙 문제는 사라진다: /editor/* 라우트는 browserGraph 화이트리스트를
// 검사하지 않으므로(staticRoutes.js) 새 엔트리 등록이 필요 없다. 반대로 /src/* 는 화이트리스트 밖이면
// 404 이고, 404 는 정적 ESM import 실패 → 모듈 그래프 전체 사망 → 편집기 백지가 된다.
//
// ⚠ 절반만 자유롭다 — **의존 대상은 여전히 화이트리스트 게이트다.** 아래 paper.js 는 검수 체인
//   (ValidateWorksheet→paper.js)의 전이 import 라서 지금 그래프 안에 들어와 있을 뿐이고, 그 체인이
//   paper.js 를 떼는 순간 /src/usecases/paper.js 가 404 → 이 모듈 로드 실패 → 편집기 백지다.
//   test/unit/float-layout.test.js 의 마지막 테스트가 그 멤버십을 단정해 조용한 이탈을 막는다.
//
// ⚠ 그래서 아래 import 는 반드시 **절대 specifier** 여야 한다. '../usecases/paper.js' 로 쓰면
//    브라우저가 '/usecases/paper.js' 로 해석해 어느 라우트에도 안 걸리고 같은 404 가 재발한다.
//    (같은 규약: inspector.js · reviewChip.js · reflow.js · ai.js)
//
// ── 알려진 사정거리 한계 ──────────────────────────────────────────────────────
// 이 규칙들은 **편집기 런타임에만** 산다 — CLI `validate` 나 파이프라인 검수에는 없다. 즉 AI 가
// 만든 겹친 float 은 교사가 편집기를 열어야 보인다. 의도적 선택이며(측정 규칙을 순수 CLI 로
// 옮길 수 없고, 나머지 둘만 CLI 에 넣으면 규칙 집합이 런타임별로 갈라져 더 나쁘다), 재검토 시점은
// PaginateObjectTree 가 flow 높이를 트리에 기록하게 되는 때다 — 그 순간 순수 계산이 가능해진다.
import { resolvePaper, paperDims, paperMargins } from '/src/usecases/paper.js';

const MM_TO_PX = 96 / 25.4;

/** 두 축 모두 이만큼 겹쳐야 "겹침"으로 본다. 스침·모서리 접촉은 정상 배치라 세지 않는다. */
export const OVERLAP_TOL_MM = 1;
/** 여백선을 이 정도 넘는 것은 디자인 여유로 본다(1mm 침범마다 경고가 뜨면 배지가 죽는다). */
export const BOUNDS_TOL_MM = 2;

/**
 * 회전 여부. 순수 규칙 2종은 이제 회전을 **제외하지 않고 꼭짓점(OBB)으로 계산**한다(2026-07-28).
 *
 * 종전에는 규칙 3종에서 통째로 뺐다 — 렌더가 `transform: rotate()` 를 걸면 실제 점유 영역이
 * rect 와 달라지는데(45°면 외접 상자가 약 1.41배) rect 기반 AABB 로 판정하면 순수 규칙은
 * **미탐**, 측정 규칙은 getBoundingClientRect 가 AABB 를 돌려주므로 **오탐**이라 두 규칙군이
 * 반대 방향으로 틀렸기 때문이다. 순수 규칙 쪽은 모델에 rect·angle 이 다 있으므로 꼭짓점을
 * 직접 구하면 정확해진다 — 그래서 그쪽만 OBB 로 올렸다.
 *
 * **측정 규칙(measureFloatCoverage)은 여전히 제외한다.** 그쪽은 브라우저가 돌려주는 AABB 가
 * 입력이라 같은 방법을 쓸 수 없고(모델 좌표를 화면 좌표로 다시 사영해야 한다), 그건 이번 범위
 * 밖이다. 제외를 유지하는 편이 오탐보다 낫다.
 */
function isRotated(obj) {
  return typeof obj?.angle === 'number' && obj.angle !== 0;
}

const DEG = Math.PI / 180;

/** 회전 각도(도). 렌더와 같은 범위로 클램프한다(RenderObjectTree 는 [-180,180]). */
function angleOf(obj) {
  const a = typeof obj?.angle === 'number' ? obj.angle : 0;
  return Math.max(-180, Math.min(180, a));
}

/** (회전 가능) rect 의 꼭짓점 4개(mm). 회전 중심은 렌더와 같은 `transform-origin:center center`. */
function cornersOf(rect, angleDeg) {
  const cx = rect.xMm + rect.wMm / 2;
  const cy = rect.yMm + rect.hMm / 2;
  const a = angleDeg * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = rect.wMm / 2;
  const hh = rect.hMm / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

/** 꼭짓점들의 축 정렬 외접 상자(mm). 회전 0 이면 원래 rect 와 정확히 같다. */
function aabbOfCorners(corners) {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const xMm = Math.min(...xs);
  const yMm = Math.min(...ys);
  return { xMm, yMm, wMm: Math.max(...xs) - xMm, hMm: Math.max(...ys) - yMm };
}

/**
 * 두 볼록 사각형의 **최소 침투 깊이**(mm). 떨어져 있으면 0. 분리축 정리(SAT).
 *
 * 축 정렬 사각형 둘이면 결과가 `min(겹침폭, 겹침높이)` 와 같다 — 즉 종전 규칙
 * "두 축 모두 TOL 이상"과 **정확히 같은 판정**이다(회전 0 산출 불변의 근거).
 */
function satPenetrationMm(ca, cb) {
  let min = Infinity;
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (!len) continue;
      const ax = -(q.y - p.y) / len; // 변의 법선(단위)
      const ay = (q.x - p.x) / len;
      let aLo = Infinity; let aHi = -Infinity; let bLo = Infinity; let bHi = -Infinity;
      for (const pt of ca) { const v = pt.x * ax + pt.y * ay; if (v < aLo) aLo = v; if (v > aHi) aHi = v; }
      for (const pt of cb) { const v = pt.x * ax + pt.y * ay; if (v < bLo) bLo = v; if (v > bHi) bHi = v; }
      const ov = Math.min(aHi, bHi) - Math.max(aLo, bLo);
      if (ov <= 0) return 0; // 분리축을 찾았다 = 안 겹친다
      if (ov < min) min = ov;
    }
  }
  return min === Infinity ? 0 : min;
}

/** 유한 number 4종 rect 만 계산에 넣는다(불량 rect 는 조용히 건너뛴다 — 여기서 던지면 칩이 빨개진다). */
function usableRect(obj) {
  const r = obj?.rect;
  if (!r) return null;
  return ['xMm', 'yMm', 'wMm', 'hMm'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k])) ? r : null;
}

/** 두 rect 의 교집합 폭/높이(mm). 안 겹치면 0 이하. */
function overlapMm(a, b) {
  return {
    w: Math.min(a.xMm + a.wMm, b.xMm + b.wMm) - Math.max(a.xMm, b.xMm),
    h: Math.min(a.yMm + a.hMm, b.yMm + b.hMm) - Math.max(a.yMm, b.yMm),
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** 인쇄 안전영역(여백 박스) — 교사가 "보기▸여백 표시"로 보는 그 상자와 같은 값. */
function safeArea(paper) {
  const resolved = resolvePaper(paper) ?? resolvePaper({ size: 'A4' }); // buildCanvasMeta 와 같은 폴백
  const { w, h } = paperDims(resolved);
  const m = paperMargins(resolved);
  return { left: m.left, top: m.top, right: w - m.right, bottom: h - m.bottom, pageW: w, pageH: h };
}

/**
 * 순수 규칙 2종 — float↔float 겹침 · 인쇄 안전영역 이탈. DOM 을 만지지 않는다.
 * @param {object} document 개체 트리 문서
 * @returns {Array<{rule:string, severity:'warning', message:string, evidence:string, objectId:string, otherId?:string, page:number}>}
 */
export function checkFloatGeometry(document) {
  try {
    const pages = Array.isArray(document?.pages) ? document.pages : [];
    if (!pages.length) return [];
    const area = safeArea(document?.paper ?? null);
    const findings = [];

    pages.forEach((page, pageIndex) => {
      const floats = (Array.isArray(page?.float) ? page.float : []).filter((o) => usableRect(o));

      // ① 겹침 — shape 는 제외한다. 도형은 배경으로 깔라고 있는 타입이고(float 전용),
      //    float[] 배열 순서가 곧 페인트 순서라 "도형 위에 얹기"는 정상 사용이다.
      const overlapTargets = floats.filter((o) => o.type !== 'shape');
      for (let i = 0; i < overlapTargets.length; i++) {
        for (let j = i + 1; j < overlapTargets.length; j++) {
          const a = overlapTargets[i];
          const b = overlapTargets[j];
          // 회전이 없으면 종전 경로 그대로 — evidence 문자열까지 바이트 동일하게 둔다.
          // 하나라도 회전했으면 꼭짓점 교차(SAT)로 판정한다.
          const rotated = isRotated(a) || isRotated(b);
          let ov;
          if (rotated) {
            const depth = satPenetrationMm(cornersOf(a.rect, angleOf(a)), cornersOf(b.rect, angleOf(b)));
            if (depth < OVERLAP_TOL_MM) continue;
            ov = { w: depth, h: depth, depth };
          } else {
            ov = overlapMm(a.rect, b.rect);
            if (ov.w < OVERLAP_TOL_MM || ov.h < OVERLAP_TOL_MM) continue;
          }
          findings.push({
            rule: 'float-overlap',
            severity: 'warning',
            message: `${pageIndex + 1}쪽 자유 개체 2개가 겹칩니다 — 필요한 자리로 옮기세요.`,
            evidence: ov.depth != null
              ? `${round1(ov.depth)}mm 겹침(회전 개체 — 꼭짓점 기준)`
              : `${round1(ov.w)}mm × ${round1(ov.h)}mm 겹침`,
            objectId: a.id, otherId: b.id, page: pageIndex,
          });
        }
      }

      // ② 지면 이탈 — shape 도 받는다(용지 밖으로 나간 도형은 실제로 잘린다).
      for (const o of floats) {
        // 회전 개체는 꼭짓점의 외접 상자로 잰다 — 회전 0 이면 rect 와 정확히 같아 산출이 안 바뀐다.
        const r = isRotated(o) ? aabbOfCorners(cornersOf(o.rect, angleOf(o))) : o.rect;
        const out = {
          left: area.left - r.xMm,
          top: area.top - r.yMm,
          right: (r.xMm + r.wMm) - area.right,
          bottom: (r.yMm + r.hMm) - area.bottom,
        };
        const worst = Object.entries(out).reduce((best, cur) => (cur[1] > best[1] ? cur : best), ['', -Infinity]);
        if (worst[1] <= BOUNDS_TOL_MM) continue;
        const offPaper = r.xMm < 0 || r.yMm < 0 || (r.xMm + r.wMm) > area.pageW || (r.yMm + r.hMm) > area.pageH;
        const dir = { left: '왼쪽', top: '위', right: '오른쪽', bottom: '아래' }[worst[0]];
        findings.push({
          rule: 'float-out-of-bounds',
          severity: 'warning',
          message: offPaper
            ? `${pageIndex + 1}쪽 자유 개체가 ${dir}으로 용지 밖까지 나갔습니다 — 그 부분은 인쇄되지 않습니다. 여백선은 보기▸여백 표시로 확인하세요.`
            : `${pageIndex + 1}쪽 자유 개체가 ${dir} 여백선을 넘었습니다(용지 안). 여백선은 보기▸여백 표시로 확인하세요.`,
          evidence: `${dir} ${round1(worst[1])}mm 초과${offPaper ? ' · 용지 밖' : ''}`,
          objectId: o.id, page: pageIndex,
        });
      }
    });

    return findings;
  } catch {
    // 검수 칩은 예외를 severity:'error' 로 승격해 칩을 빨갛게 만든다 — advisory 가 그러면 안 된다.
    return [];
  }
}

/**
 * 측정 규칙 1종 — 자유 개체가 본문(flow)을 덮고 있는가.
 *
 * flow 에는 rect 가 없으므로(원칙 3) 화면에서 재는 수밖에 없다. 그래서 이 함수만 DOM 을 받는다.
 *
 * **호출 계약 3가지**
 * 1) 재렌더 **뒤** 경로에서만 부를 것. 프레임 재로드 없이 검수를 도는 경로(예: 문서 제목 커밋)에서
 *    부르면 구 DOM 을 재게 된다. reviewChip 이 measure 플래그로 이를 구분한다.
 * 2) 문서에 float 이 하나도 없으면 **DOM 을 만지지 않고 즉시 반환**한다. applyDocOp 은 삽입·삭제·
 *    undo·AI 적용이 전부 지나는 관문이고 현행 검수는 문자열 정적 검사라 레이아웃을 유발하지
 *    않는다 — 대다수 활동지(float 0개)에서 비용이 0 이어야 한다.
 * 3) 폰트 게이팅: flow rect 는 **폰트 의존적**이고 float rect 는 아니다(mm 인라인 스타일). 웹폰트가
 *    아직 안 붙은 상태로 재면 판정이 뒤집힌다. 이 리포의 측정 규약(reflow.js gateReady ·
 *    PaginationMeasurer gateInPage)은 document.fonts.ready 와 KaTeX 등록을 await 하지만, 검수는
 *    동기 경로라 여기서는 **동기 등가물**을 쓴다: fonts.status 가 'loaded' 가 아니면 측정을
 *    건너뛰고 [] 를 돌려준다. 폰트가 늦게 붙는 최초 로드 구간에서는 배지가 잠깐 늦게 뜨고,
 *    reviewChip 이 fonts.ready 에 한 번 재검수를 걸어 그 구간을 메운다.
 *    (KaTeX 는 수식 폭에만 영향을 주고 auto-render 가 폰트 로드 뒤에 도는 구조라 fonts 게이트가
 *     사실상 함께 덮는다 — 별도 대기는 두지 않는다.)
 *
 * @param {Document} doc teacher iframe 문서
 * @param {object} document 개체 트리 문서
 */
export function measureFloatCoverage(doc, document) {
  try {
    const pages = Array.isArray(document?.pages) ? document.pages : [];
    // (2) 조기 탈출 — DOM 접근 전에.
    const hasFloat = pages.some((p) => (Array.isArray(p?.float) ? p.float : []).some((o) => usableRect(o) && !isRotated(o)));
    if (!hasFloat || !doc) return [];
    // (3) 폰트 게이트.
    if (doc.fonts && doc.fonts.status !== 'loaded') return [];

    const sheets = [...doc.querySelectorAll('.sheet')];
    if (!sheets.length) return [];
    const findings = [];
    // 문서 전체에서 파생되므로 시트마다 다시 만들 이유가 없다.
    const byId = new Map();
    for (const p of pages) for (const o of (Array.isArray(p?.float) ? p.float : [])) byId.set(o.id, o);

    sheets.forEach((sheet, pageIndex) => {
      const floatEls = [...sheet.querySelectorAll('.wg-float[data-oid]')];
      if (!floatEls.length) return;
      const flowEls = [...sheet.querySelectorAll('.wg-obj[data-oid]')];
      if (!flowEls.length) return;

      const sr = sheet.getBoundingClientRect();
      const scale = sheet.offsetWidth ? sr.width / sheet.offsetWidth : 1;
      if (!scale) return;
      const toMm = (r) => ({
        xMm: (r.left - sr.left) / scale / MM_TO_PX,
        yMm: (r.top - sr.top) / scale / MM_TO_PX,
        wMm: r.width / scale / MM_TO_PX,
        hMm: r.height / scale / MM_TO_PX,
      });

      const flowBoxes = flowEls
        .map((el) => ({ id: el.dataset.oid, box: toMm(el.getBoundingClientRect()) }))
        .filter((f) => f.box.wMm > 0 && f.box.hMm > 0);

      for (const el of floatEls) {
        const id = el.dataset.oid;
        const obj = byId.get(id);
        if (!obj || isRotated(obj)) continue;                  // 회전 제외
        // shape 제외 — G3 스파이크 실측으로 계획 결정을 뒤집은 지점이다.
        //   원안: "도형이 본문을 덮는 건 클릭 가로채기를 유발하니 경고 대상".
        //   실측: 실문서(소설의서술자-동백꽃)는 도형 8개가 본문 개체를 60×30mm **전체로** 덮고
        //         있었다 — 배경으로 깔린 정상 저작이다. 이걸 세면 승격 1회에 findings 11건이
        //         뜨고(허용치를 12mm 까지 올려도 안 줄어든다 — 전체 겹침이라) 배지가 죽는다.
        //   판단: shape 은 float 전용 타입이고 본문 위에 까는 것이 설계된 용도다. 겹침 규칙 2종
        //         에서 모두 빼고 **이탈(잘림)만** 알린다 — "의도적 배치 타입은 겹침을 경고하지
        //         않되 인쇄에서 잘리는 것은 알린다"로 일관된다. 클릭 가로채기는 shape 의 본질적
        //         성질이지 이상 상태가 아니다(HANDOFF-object-schema.md §8 의 미해결 항목).
        if (obj.type === 'shape') continue;
        // 승격 직후의 float 은 선택 상태다. 그때 배지를 띄우면 "방금 네가 한 조작"을 이상으로
        // 보고하는 꼴이라 통보로서 의미가 없다.
        // ⚠ 억제가 풀리는 시점은 "선택 해제"가 아니라 **다음 문서 변경**이다 — 선택 해제(클릭·Esc·
        //   칩 클릭)는 재측정을 유발하지 않는다(onSelectionChange·onChipClick 은 캐시를 읽어 UI 만
        //   갱신한다). 클릭마다 재측정하면 조작 한 번에 강제 레이아웃이 붙어서 그렇게 두지 않았다.
        if (el.classList.contains('wg-selected')) continue;
        const fBox = toMm(el.getBoundingClientRect());
        if (!(fBox.wMm > 0) || !(fBox.hMm > 0)) continue;
        // **float 하나당 1건**으로 집계한다(쌍마다 1건이 아니라).
        // 승격된 개체는 본문 전폭 판이라 아래 flow 를 여러 개 동시에 덮는다 — 쌍 기준으로 세면
        // 승격 5회에 20건 넘게 뜬다(G3 스파이크 실측 24건). 그런데 교사의 할 일은 "그 개체를
        // 옮긴다" 하나뿐이라, 행동 단위와 경고 단위를 맞춘다. 몇 개를 덮는지는 evidence 로 남긴다.
        const covered = [];
        for (const flow of flowBoxes) {
          const ov = overlapMm(fBox, flow.box);
          if (ov.w < OVERLAP_TOL_MM || ov.h < OVERLAP_TOL_MM) continue;
          covered.push({ id: flow.id, area: ov.w * ov.h, w: ov.w, h: ov.h });
        }
        if (!covered.length) continue;
        const worst = covered.reduce((a, b) => (b.area > a.area ? b : a));
        findings.push({
          rule: 'float-covers-flow',
          severity: 'warning',
          message: `${pageIndex + 1}쪽 자유 개체가 본문을 덮고 있습니다 — 이제 원하는 자리로 옮기세요.`,
          evidence: covered.length === 1
            ? `본문 1개를 ${round1(worst.w)}mm × ${round1(worst.h)}mm 가림`
            : `본문 ${covered.length}개를 가림(가장 넓은 곳 ${round1(worst.w)}mm × ${round1(worst.h)}mm)`,
          objectId: id, otherId: worst.id, coveredIds: covered.map((c) => c.id), page: pageIndex,
        });
      }
    });

    return findings;
  } catch {
    return [];
  }
}
