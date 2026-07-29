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
//              측정은 비동기(rAF·fonts.ready)라 **예약과 실행 사이에 문서가 바뀔 수 있다** — 그래서
//              검수 세대(reviewSeq)를 달아 낡은 예약은 화면을 만지지 못하게 한다(아래 D13 주석).
import { ValidateWorksheet } from '/src/usecases/ValidateWorksheet.js';
import { checkFloatGeometry, measureFloatCoverage } from '/editor/floatLayout.js';

export function createReviewChip({ chipEl, getDocument, getTeacherDoc, onChipClick }) {
  let findings = [];
  let base = [];
  let coverage = [];
  // 검수 세대(2026-07-29) — 예약된 측정이 아직 유효한지 판정하는 유일한 근거. runReview 마다 올린다.
  //
  // 종전 가드는 `getTeacherDoc() !== teacherDoc`(Document **정체성**)였는데, reloadTeacherFrame 은
  // 흰 깜빡임을 없애려고 iframe 을 갈지 않고 body.innerHTML 만 교체하도록 설계돼 있다(editor.js
  // 주석). 그래서 teacher 문서의 정체성은 편집기 수명 내내 그대로고 그 가드는 **사실상 트립하지
  // 않았다** — 낡은 예약이 최신 결과를 덮어써도 막지 못했다.
  //
  // 세대를 "재렌더"가 아니라 "검수 호출"에 붙인 이유: 재렌더 3경로(reloadTeacherFrame ·
  // history 복원 · 프레임 load)가 전부 직후에 runReview 를 부르므로 검수 세대는 재렌더 세대를
  // **포함한다**(놓치는 재렌더가 없다). 대가는 과잉 취소 — DOM 이 안 바뀐 검수(저장 완료 ·
  // 제목 커밋)가 비행 중인 측정을 취소할 수 있다. 그때는 이 모듈의 계약대로 **직전 측정값을
  // 유지**하고 다음 재렌더가 다시 잰다(빈 값으로 덮지 않는다). 낡은 쌍을 칠하는 것보다 낫다.
  let reviewSeq = 0;
  let fontsWaitingSeq = -1; // 폰트 대기를 세대당 한 번만(무한 재예약 방지)

  /**
   * @param {{measure?:boolean}} [opts] measure: 프레임이 방금 다시 그려졌을 때만 true.
   *   측정 규칙(float-covers-flow)은 flow 개체의 **화면 rect** 를 읽으므로 DOM 이 문서와
   *   맞아떨어지는 순간에만 유효하다.
   */
  function runReview({ measure = false } = {}) {
    const seq = ++reviewSeq;
    const doc = getDocument();
    try {
      const teacherDoc = getTeacherDoc();
      const html = teacherDoc?.documentElement?.outerHTML || '';
      const result = new ValidateWorksheet({}).execute(doc, html || undefined);
      base = [...result.findings, ...checkFloatGeometry(doc)];
      if (measure && teacherDoc) scheduleCoverage(seq, teacherDoc, doc);
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
  function scheduleCoverage(seq, teacherDoc, doc) {
    const run = () => {
      // 낡은 예약은 버린다 — `doc` 은 예약 시점의 모델이라 그 사이 검수가 다시 돌았다면 이 측정은
      // **낡은 모델 × 새 DOM** 이라는 어긋난 쌍이다. 최신 세대가 자기 측정을 이미 칠했을 수도 있다.
      if (seq !== reviewSeq) return;
      if (getTeacherDoc() !== teacherDoc) return; // 프레임 자체가 갈린 경우(현 설계에선 안 일어난다)
      if (teacherDoc.fonts && teacherDoc.fonts.status !== 'loaded') { waitForFonts(seq, teacherDoc, doc); return; }
      coverage = measureFloatCoverage(teacherDoc, doc);
      findings = [...base, ...coverage];
      paint();
    };
    const win = teacherDoc.defaultView;
    if (win?.requestAnimationFrame) win.requestAnimationFrame(() => win.requestAnimationFrame(run));
    else run();
  }

  /**
   * 웹폰트가 늦게 붙는 구간 보정 — flow rect 는 폰트 의존적이라 붙기 전 측정은 뒤집힌다.
   *
   * 대기 표식은 **세대당 하나**다. 종전엔 Document 당 하나였는데(`fontsWaitingOn === teacherDoc`)
   * 그 Document 가 편집기 수명 내내 같은 객체라, 최초 로드에서 한 번 대기하고 나면 이후로는
   * 폰트 게이트에 걸린 측정이 **영영 다시 예약되지 않았다**(새 글리프 때문에 fonts.status 가
   * 'loading' 으로 되돌아가는 일은 실제로 일어난다). 그러면 검수 결과가 조용히 낡은 채 굳는다.
   * 세대당 1회면 재예약 무한루프는 그대로 막으면서(같은 세대의 두 번째 대기는 무시) 세대가
   * 바뀔 때마다 다시 기다린다.
   */
  function waitForFonts(seq, teacherDoc, doc) {
    if (fontsWaitingSeq === seq) return;
    fontsWaitingSeq = seq;
    // 여기서 세대·정체성을 다시 보지 않는다 — 재예약분도 결국 scheduleCoverage 의 run 을 지나므로
    // 판정은 그 한 곳에만 둔다(같은 판정을 두 벌 두면 어느 쪽이 실제로 막는지 증명할 수 없다).
    teacherDoc.fonts.ready
      .then(() => scheduleCoverage(seq, teacherDoc, doc))
      .catch(() => { /* 폰트 API 실패는 무시 — 다음 재렌더가 다시 잰다 */ });
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
