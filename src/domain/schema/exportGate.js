import { PAGINATION_STATES } from './ObjectCatalog.js';

// checkExportGate — 문서 수준 pagination 상태와 export 가능 여부의 계약(D-A, R2-4)을 순수 판정한다.
//   scaffold  = compose 스캐폴드 산출물(경계 미계산) → export 거부.
//   paginated = Chrome 측정 패스가 pages[] 경계를 영속화 완료 → export 허용.
// FS/DOM/Chrome 무접촉. 실제 페이지네이션 패스·export 유스케이스(ExportDocument, S3.5/M2 소관 — 이번
// 범위 밖)가 이 판정을 호출해 게이트로 승격한다.

/** @param {{pagination:string}} document @returns {{exportable:boolean, reason:string|null, message:string|null}} */
export function checkExportGate(document) {
  const pagination = document?.pagination;
  if (!PAGINATION_STATES.includes(pagination)) {
    throw new TypeError(`document.pagination 은 ${PAGINATION_STATES.join('|')} 중 하나여야 합니다: ${pagination}`);
  }
  const exportable = pagination === 'paginated';
  return {
    exportable,
    reason: exportable ? null : 'scaffold-not-exportable',
    message: exportable ? null : 'scaffold 문서는 Chrome 측정 페이지네이션 패스를 통과하기 전에는 export 할 수 없습니다(D-A, R2-4).',
  };
}
