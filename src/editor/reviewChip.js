// reviewChip.js — 앱 바 검수 칩(ValidateWorksheet 재계산 + 상태 표시)의 소유자.
//
// Phase 5 모듈 경계 정리에서 editor.js 로부터 그대로 떼어 왔다(동작 무변경). 검수는 문서 변경마다
// 다시 도는 파생값이라 findings 를 여기서 소유하고, 인스펙터가 읽을 수 있게 getFindings 로 노출한다.
// 문서·렌더 DOM 은 주입받은 콜백으로만 읽는다(core/selection 을 import 하지 않는다).
import { ValidateWorksheet } from '/src/usecases/ValidateWorksheet.js';

export function createReviewChip({ chipEl, getDocument, getTeacherDoc, onChipClick }) {
  let findings = [];

  function runReview() {
    try {
      const doc = getDocument();
      const html = getTeacherDoc()?.documentElement?.outerHTML || '';
      const result = new ValidateWorksheet({}).execute(doc, html || undefined);
      findings = result.findings;
    } catch (e) {
      findings = [{ rule: 'review-error', severity: 'error', message: String(e?.message || e) }];
    }
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
