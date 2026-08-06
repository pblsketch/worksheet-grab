// paper — 용지/방향의 단일 소스(순수, Chrome·FS 무지). manifest.paper 에서
// (CSS 오버라이드 스니펫 · PNG 픽셀 치수 · validate 여백 기준)을 전부 파생한다.
// 제약: Chrome 의 @page { size: … } 는 CSS 변수(var())를 해석하지 못하므로
// @page 는 항상 숫자 mm 리터럴로 주입하고, .sheet 치수·여백만 var() 로 흐른다.
// 두 값 모두 paperDims() 하나에서 파생되어 어긋나지 않는다.

export const PAPER_SIZES = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  // 한국 시험지/평가지 관행은 JIS B4. Chrome named 키워드 B4(ISO 250×353)와 무관하게
  // 숫자 mm 리터럴로 주입하므로 규격 애매성이 없다. ISO 가 필요하면 별도 프리셋으로 추가.
  B4: { w: 257, h: 364 },
};

// A4 세로 기본 여백 — assets/paper.css 의 var() 폴백 리터럴과 정확히 일치해야 한다
// (paper-fallback-equivalence 테스트가 강제). 비대칭 값은 "authored 섹션 수 = 인쇄
// 페이지 수"가 되도록 튜닝된 현행 인쇄틀이다. 대칭 20mm 등은 명시적 선택지일 뿐
// 조용한 기본값이 아니다 — paper:{size:"A4"} 만 붙여도 레이아웃이 변하면 안 된다.
export const DEFAULT_A4_MARGINS = '12mm 15mm 10mm 15mm';
const DEFAULT_MARGINS = '20mm';

/**
 * manifest.paper 를 정규화한다. 미지정(null/undefined)이면 null — 현행 A4 기본을
 * 뜻하며 CSS 를 전혀 주입하지 않는다(하위호환: 주입 0 = 산출 불변).
 * @param {{size?:string, orientation?:string, margins?:string, columns?:number}|null|undefined} paper
 * @returns {{size:string, orientation:'portrait'|'landscape', margins:string, columns:number}|null}
 */
export function resolvePaper(paper) {
  if (paper == null) return null;
  if (typeof paper !== 'object') throw new TypeError('paper 는 객체여야 합니다.');

  const size = String(paper.size ?? 'A4').toUpperCase();
  if (!PAPER_SIZES[size]) {
    throw new Error(`지원하지 않는 용지: "${paper.size}". 지원: ${Object.keys(PAPER_SIZES).join(', ')}`);
  }
  const orientation = String(paper.orientation ?? 'portrait');
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw new Error(`orientation 은 portrait|landscape 여야 합니다: "${paper.orientation}"`);
  }
  const margins = String(
    paper.margins ?? (size === 'A4' && orientation === 'portrait' ? DEFAULT_A4_MARGINS : DEFAULT_MARGINS),
  );
  parseMarginShorthand(margins); // fail-closed: 잘못된 여백 표기는 여기서 즉시 던진다.
  const columns = paper.columns ?? 1;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(`columns 는 1 이상의 정수여야 합니다: "${paper.columns}"`);
  }
  return { size, orientation, margins, columns };
}

/**
 * resolvePagePaper — 페이지별 용지 override(P3-b) 의 단일 해석점. 문서 전체 documentPaper(기존
 * manifest.paper/document.paper) 위에 페이지 메타 pagePaper 를 **필드 단위로 덮어** 얹은 뒤
 * resolvePaper 로 해석한다. 방향만 바꾼 페이지(pagePaper={orientation:'landscape'})는 문서 용지
 * 크기·여백을 그대로 물려받고 방향만 뒤집힌다 — 즉 "1쪽 세로 + 2쪽 가로" 복합 세트가 페이지 메타
 * 한 필드로 표현된다.
 *
 * 이 함수 하나가 페이지별 유효 용지의 유일한 진실원천이다(computeAvailableHeightPx·렌더·검증이
 * 전부 이걸 호출). resolvePaper 재사용이라 지원 용지·방향·여백 검증 규칙이 문서/페이지에서 갈리지
 * 않는다(fail-closed: 병합 결과가 유효하지 않으면 resolvePaper 가 그대로 던진다).
 *
 * @param {object|null|undefined} documentPaper 문서 전체 용지(미해석 원본)
 * @param {object|null|undefined} pagePaper 페이지별 override(미해석 원본). null/미지정이면 페이지는
 *   문서 용지를 그대로 상속한다(= resolvePaper(documentPaper), 둘 다 미지정이면 null = 현행 A4 기본).
 * @returns {{size:string, orientation:'portrait'|'landscape', margins:string, columns:number}|null}
 */
export function resolvePagePaper(documentPaper, pagePaper) {
  if (pagePaper == null) return resolvePaper(documentPaper ?? null);
  if (typeof pagePaper !== 'object' || Array.isArray(pagePaper)) {
    throw new TypeError('page.paper 는 객체여야 합니다.');
  }
  const base = documentPaper != null && typeof documentPaper === 'object' && !Array.isArray(documentPaper)
    ? documentPaper
    : {};
  return resolvePaper({ ...base, ...pagePaper });
}

/** orientation 반영 실제 치수(mm). landscape 면 장·단변 swap. @page·.sheet 공통 파생점. */
export function paperDims(resolved) {
  const { w, h } = PAPER_SIZES[resolved.size];
  return resolved.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

const PX_PER_MM = 96 / 25.4; // CSS px @96dpi

/** 콘텐츠 박스(여백 안쪽) 크기를 px 로. 조직자 자동 맞춤(fit)의 박스 계산에 쓴다. */
export function paperContentPx(resolved) {
  const { w, h } = paperDims(resolved);
  const m = paperMargins(resolved);
  return {
    w: Math.round((w - m.left - m.right) * PX_PER_MM),
    h: Math.round((h - m.top - m.bottom) * PX_PER_MM),
  };
}

/** CSS 여백 shorthand(mm) → {top,right,bottom,left} (mm 숫자). 1·2·3·4값 지원. */
/** 다단 열 사이 간격(mm). paperCss 가 방출하는 `--sheet-colgap` 의 값이자, 페이지네이션이 열 폭을
 *  계산할 때 쓰는 값이다 — 두 곳에 따로 적으면 조용히 어긋나므로 여기 하나만 둔다. */
export const COLUMN_GAP_MM = 8;

export function paperMargins(resolved) {
  return parseMarginShorthand(resolved.margins);
}

function parseMarginShorthand(margins) {
  const tokens = String(margins).trim().split(/\s+/);
  const vals = tokens.map((t) => {
    const m = /^([0-9]+(?:\.[0-9]+)?)mm$/.exec(t);
    if (!m) throw new Error(`여백은 "12mm" 형식(mm 단위)이어야 합니다: "${t}" (전체: "${margins}")`);
    return parseFloat(m[1]);
  });
  if (vals.length === 1) return { top: vals[0], right: vals[0], bottom: vals[0], left: vals[0] };
  if (vals.length === 2) return { top: vals[0], right: vals[1], bottom: vals[0], left: vals[1] };
  if (vals.length === 3) return { top: vals[0], right: vals[1], bottom: vals[2], left: vals[1] };
  if (vals.length === 4) return { top: vals[0], right: vals[1], bottom: vals[2], left: vals[3] };
  throw new Error(`여백 값은 1~4개여야 합니다: "${margins}"`);
}

const mm = (n) => `${Number.isInteger(n) ? n : parseFloat(n.toFixed(3))}mm`;

/**
 * paper.css 뒤에 인라인할 오버라이드 스니펫. resolved=null 이면 ''(주입 0).
 * @page 는 숫자 mm 리터럴(캐스케이드로 기본 @page{size:A4} 를 덮음), 나머지는 :root 변수.
 * --sheet-cols/--sheet-colgap 는 columns>1 일 때만 emit(.sheet-body 가 소비).
 * columns<=1(미지정 포함)은 미방출 = 기존 출력 바이트 불변.
 */
export function paperCss(resolved) {
  if (resolved == null) return '';
  const { w, h } = paperDims(resolved);
  const m = paperMargins(resolved);
  // 다단은 columns>1 일 때만 방출한다 — columns<=1 은 델타 ∅(기존 스니펫과 바이트 동일).
  // --sheet-colh: 열 높이 = 페이지 콘텐츠 박스 높이. `column-fill:auto` 는 컨테이너 높이가
  // **정해져야** 열을 나눈다 — .sheet 가 min-height 라 이걸 안 주면 .sheet-body 가 그냥 자라서
  // 내용이 전부 1열에 들어가고 2단이 아예 형성되지 않는다(2026-07-29 실측: sheetH 2247px,
  // x 군집 1개). columns>1 일 때만 방출하므로 단단 출력은 바이트 불변이다.
  const colVars = resolved.columns > 1
    ? `\n  --sheet-cols: ${resolved.columns};\n  --sheet-colgap: ${COLUMN_GAP_MM}mm;`
      + `\n  --sheet-colh: ${mm(h - m.top - m.bottom)};`
    : '';
  return `/* ===== 용지 오버라이드 (manifest.paper: ${resolved.size} ${resolved.orientation}) ===== */
@page { size: ${mm(w)} ${mm(h)}; margin: 0; }
:root {
  --sheet-w: ${mm(w)};
  --sheet-h: ${mm(h)};
  --sheet-pad: ${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)};
  --sheet-pad-l: ${mm(m.left)};
  --sheet-pad-r: ${mm(m.right)};${colVars}
}`;
}

// 교사용 포맷 프리셋(§3.3). "A3 접이"는 E6 에선 A3 가로 단일 시트 렌더까지 —
// A4 4쪽 소책자 imposition(논리 페이지 재배열)은 후속 에픽. margins 생략 =
// resolvePaper 기본값(A4 세로만 현행 비대칭, 그 외 20mm). null = 현행 A4 기본(주입 0).
export const PAPER_PRESETS = [
  { id: 'a4-portrait', label: 'A4 세로 (기본)', paper: null },
  { id: 'a3-fold', label: 'A3 접이 (가로)', paper: { size: 'A3', orientation: 'landscape' } },
  { id: 'a4-landscape', label: 'A4 가로', paper: { size: 'A4', orientation: 'landscape' } },
  { id: 'b4-portrait', label: 'B4 세로 (시험지)', paper: { size: 'B4', orientation: 'portrait' } },
  { id: 'b4-2col', label: 'B4 세로 2단(시험지)', paper: { size: 'B4', orientation: 'portrait', columns: 2 } },
];

/**
 * 현재 manifest.paper 가 어느 프리셋인지 역판정. 어느 것도 아니면 'custom'(고급 조합).
 * size·orientation 만 비교한다 — margins·columns 를 바꾼 경우도 custom.
 */
export function matchPreset(paper) {
  const cur = resolvePaper(paper);
  for (const p of PAPER_PRESETS) {
    const preset = resolvePaper(p.paper);
    if (cur == null && preset == null) return p.id;
    if (
      cur && preset &&
      cur.size === preset.size && cur.orientation === preset.orientation &&
      cur.margins === preset.margins && cur.columns === preset.columns
    ) return p.id;
  }
  return 'custom';
}

/** PNG 렌더용 픽셀 치수. */
export function paperToPx(resolved, dpi = 96) {
  const { w, h } = paperDims(resolved);
  return { width: Math.round((w * dpi) / 25.4), height: Math.round((h * dpi) / 25.4) };
}

/** PDF MediaBox 기대치(pt). 테스트/검증용. */
export function paperToPt(resolved) {
  const { w, h } = paperDims(resolved);
  return { w: (w * 72) / 25.4, h: (h * 72) / 25.4 };
}

/**
 * buildCanvasMeta — 편집기 캔버스가 소비하는 용지 메타(용지 사양·px 치수·여백).
 *
 * paper 미지정 문서도 캔버스 메타는 현행 기본(A4 세로·비대칭 여백)으로 산출한다 —
 * resolvePaper(null)=null 은 "CSS 주입 0" 규약이므로 여기서만 A4 로 구체화한다.
 * Phase 5: RenderEditorShell 의 execute/executeObjectTree 두 경로에 같은 5줄이 있던 것을 모았다.
 * @param {object|null} paper manifest.paper 또는 document.paper 원본(미해석)
 */
export function buildCanvasMeta(paper) {
  const resolved = resolvePaper(paper) ?? resolvePaper({ size: 'A4' });
  return { paper: resolved, dims: paperToPx(resolved), margins: paperMargins(resolved) };
}

/** validate 여백 기준: 4방향 여백 중 최소(mm). */
export function paperMarginMinMm(resolved) {
  const m = paperMargins(resolved);
  return Math.min(m.top, m.right, m.bottom, m.left);
}
