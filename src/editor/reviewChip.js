// reviewChip.js — 앱 바 검수 칩(ValidateWorksheet 재계산 + 상태 표시)의 소유자.
//
// Phase 5 모듈 경계 정리에서 editor.js 로부터 그대로 떼어 왔다(동작 무변경). 검수는 문서 변경마다
// 다시 도는 파생값이라 findings 를 여기서 소유하고, 인스펙터가 읽을 수 있게 getFindings 로 노출한다.
// 문서·렌더 DOM 은 주입받은 콜백으로만 읽는다(core/selection 을 import 하지 않는다).
//
// findings 소스가 둘이다:
//   base     — ValidateWorksheet + floatLayout.checkFloatGeometry(순수). 문서 변경마다 동기 재계산.
//   coverage — floatLayout.measureFloatCoverage(DOM 측정). **재렌더 뒤에만** 재계산하고 그 사이엔
//              직전 값을 유지한다. 매번 재계산하면 재렌더 없이 도는 경로(문서 제목 커밋 등)가
//              구 DOM 을 재거나, 방금 잰 결과를 빈 값으로 덮어쓴다.
import { ValidateWorksheet } from '/src/usecases/ValidateWorksheet.js';
import { checkFloatGeometry, measureFloatCoverage } from '/editor/floatLayout.js';

export function createReviewChip({ chipEl, getDocument, getTeacherDoc, onChipClick }) {
  let findings = [];
  let base = [];
  let coverage = [];
  let fontsWaitingOn = null; // 폰트 대기를 문서당 한 번만 걸기 위한 표식

  /**
   * @param {{measure?:boolean}} [opts] measure: 프레임이 방금 다시 그려졌을 때만 true.
   *   측정 규칙(float-covers-flow)은 flow 개체의 **화면 rect** 를 읽으므로 DOM 이 문서와
   *   맞아떨어지는 순간에만 유효하다.
   */
  function runReview({ measure = false } = {}) {
    const doc = getDocument();
    try {
      const teacherDoc = getTeacherDoc();
      const html = teacherDoc?.documentElement?.outerHTML || '';
      const result = new ValidateWorksheet({}).execute(doc, html || undefined);
      base = [...result.findings, ...checkFloatGeometry(doc)];
      if (measure && teacherDoc) scheduleCoverage(teacherDoc, doc);
      findings = [...base, ...coverage];
    } catch (e) {
      findings = [{ rule: 'review-error', severity: 'error', message: String(e?.message || e) }];
    }
    paint();
  }

  /**
   * 측정 규칙은 **다음 페인트 뒤에** 잰다.
   *
   * 실측으로 잡은 함정: body.innerHTML 을 갈아끼운 직후(그리고 iframe load 직후)에는 레이아웃이
   * 아직 안 잡혀 있어 `getBoundingClientRect()` 가 전부 0 을 돌려준다 — 겹침이 하나도 안 걸리고
   * findings 가 빈 채로 굳는다. 폰트 게이트만으로는 이걸 못 막는다(폰트가 캐시돼 이미 'loaded'
   * 면 재검수 예약조차 안 걸려서, 배지가 영영 안 뜬다).
   * rAF 두 번(레이아웃 → 페인트)을 기다린 뒤 재고, 폰트가 아직이면 fonts.ready 로 넘긴다.
   */
  function scheduleCoverage(teacherDoc, doc) {
    const run = () => {
      if (getTeacherDoc() !== teacherDoc) return; // 그 사이 프레임이 갈렸으면 버린다
      if (teacherDoc.fonts && teacherDoc.fonts.status !== 'loaded') { waitForFonts(teacherDoc, doc); return; }
      coverage = measureFloatCoverage(teacherDoc, doc);
      findings = [...base, ...coverage];
      paint();
    };
    const win = teacherDoc.defaultView;
    if (win?.requestAnimationFrame) win.requestAnimationFrame(() => win.requestAnimationFrame(run));
    else run();
  }

  /** 웹폰트가 늦게 붙는 최초 로드 구간 보정 — flow rect 는 폰트 의존적이라 붙기 전 측정은 뒤집힌다. */
  function waitForFonts(teacherDoc, doc) {
    if (fontsWaitingOn === teacherDoc) return;
    fontsWaitingOn = teacherDoc;
    teacherDoc.fonts.ready.then(() => {
      if (getTeacherDoc() !== teacherDoc) return;
      scheduleCoverage(teacherDoc, doc);
    }).catch(() => { /* 폰트 API 실패는 무시 — 다음 재렌더가 다시 잰다 */ });
  }

  function paint() {
    const hasError = findings.some((f) => f.severity === 'error');
    const hasWarn = findings.some((f) => f.severity === 'warning');
    const status = hasError ? 'error' : hasWarn ? 'warn' : 'ok';
    chipEl.dataset.reviewStatus = status;
    chipEl.dataset.reviewCount = String(findings.length);
    chipEl.textContent = status === 'ok' ? '검수 통과' : status === 'warn' ? `검수 경고 ${findings.length}` : `검수 오류 ${findings.length}`;
  }

  chipEl.addEventListener('click', () => onChipClick?.());

  return { runReview, getFindings: () => findings };
}
