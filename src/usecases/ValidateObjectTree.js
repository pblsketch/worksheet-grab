import { validateObjectShape, PAGINATION_STATES } from '../domain/schema/index.js';
import { resolvePagePaper, resolvePaper } from './paper.js';

// ValidateObjectTree — 개체 트리(문서) 구조 유효성을 순수 검사한다(S1.2). Chrome/FS/DOM 무접촉.
// ValidateWorksheet(HTML 정적 검사, src/usecases/ValidateWorksheet.js)의 개체 트리 버전 — 같은
// 관례를 따른다: execute(document) → { ok, findings:[{rule,message,severity?,...}] }. severity 를
// 명시하지 않은 finding 은 기본 'error'(게이트 차단)로 취급한다 — ok 는 severity:'error'(또는 미명시)
// findings 가 없을 때만 true 다. severity:'warning' 을 명시적으로 붙인 finding(예: 저작권 지문
// 출처 미기재 advisory)은 ok 를 false 로 만들지 않는다(ValidateWorksheet 도 이 severity 를 그대로
// 보존해 승격한다 — #executeObjectTree 참조).
//
// 검사 층위:
//  1) 문서 수준 — pagination 이 scaffold|paginated 중 하나(R2-4). export 가능 여부(scaffold 거부·
//     paginated 허용) 판정 자체는 checkExportGate(도메인 스키마, src/domain/schema/exportGate.js)가
//     맡고 ExportDocument(M2/S3.5 소관 — 이번 범위 밖)가 게이트로 승격한다. 이 클래스는 상태값
//     유효성만 구조적으로 확인한다.
//  2) 개체 낱개 — validateObjectShape 위임(닫힌 카탈로그·타입별 필수필드·flow/float 개체 자체 규칙
//     ·AI 대상 제외 슬롯 불변·표 분할불가·answer 위치 규칙).
//  3) 트리 정합 — pages[].flow/float 버킷과 개체 자신의 placement 필드가 일치하는지(배치 오분류 방지).
//  4) advisory(warning, 게이트 비차단) — 저작권 지문(passage-slot) 본문이 채워졌는데 출처(source)가
//     없으면 권고만 한다(2층 정책, 2026-07-23 — AI 는 여전히 채우지 못하지만 교사 입력은 허용).
export class ValidateObjectTree {
  /** @param {{pagination:string, pages:Array<{flow:object[], float:object[]}>}} document */
  execute(document) {
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      return { ok: false, findings: [{ rule: 'invalid-document', message: '개체 트리 문서는 object 여야 합니다.' }] };
    }

    const findings = [];
    this.#checkPagination(document, findings);
    this.#checkPageIdentity(document, findings);
    this.#checkPages(document, findings);
    this.#checkAdvisories(document, findings);

    const ok = !findings.some((f) => (f.severity || 'error') === 'error');
    return { ok, findings };
  }

  #checkPagination(document, findings) {
    if (!PAGINATION_STATES.includes(document.pagination)) {
      findings.push({
        rule: 'invalid-pagination-state',
        message: `pagination 은 ${PAGINATION_STATES.join('|')} 중 하나여야 합니다: ${document.pagination}`,
      });
    }
  }

  #checkPageIdentity(document, findings) {
    const seen = new Set();
    const pages = Array.isArray(document.pages) ? document.pages : [];
    pages.forEach((page, pageIndex) => {
      const pageId = typeof page?.id === 'string' ? page.id.trim() : '';
      if (!pageId) {
        findings.push({
          rule: 'invalid-page-id',
          message: `pages[${pageIndex}].id 는 비어 있지 않은 문자열이어야 합니다.`,
          page: pageIndex,
        });
      } else if (seen.has(pageId)) {
        findings.push({
          rule: 'duplicate-page-id',
          message: `페이지 ID가 중복되었습니다: ${pageId}`,
          page: pageIndex,
          pageId,
        });
      } else {
        seen.add(pageId);
      }
      if (Object.hasOwn(page || {}, 'role')
        && (typeof page.role !== 'string' || page.role.trim() === '')) {
        findings.push({
          rule: 'invalid-page-role',
          message: `pages[${pageIndex}].role 은 지정할 경우 비어 있지 않은 문자열이어야 합니다.`,
          page: pageIndex,
        });
      }
      // 페이지별 용지 override(P3-b, optional) — 지정되면 문서 용지 위에 병합해 해석 가능해야 한다
      // (fail-closed: 지원 밖 용지·방향·여백은 resolvePagePaper 가 던지고, 여기서 error finding 으로
      //  승격해 게이트가 산출을 막는다). 미지정 페이지는 검사하지 않는다(문서 용지 상속 = 무회귀).
      if (Object.hasOwn(page || {}, 'paper')) {
        const p = page.paper;
        if (p !== null && (typeof p !== 'object' || Array.isArray(p))) {
          findings.push({
            rule: 'invalid-page-paper',
            message: `pages[${pageIndex}].paper 는 지정할 경우 객체(또는 null)여야 합니다.`,
            page: pageIndex,
          });
        } else if (p !== null) {
          let resolved = null;
          try {
            resolved = resolvePagePaper(document.paper ?? null, p);
          } catch (err) {
            findings.push({
              rule: 'invalid-page-paper',
              message: `pages[${pageIndex}].paper 해석 실패: ${err.message}`,
              page: pageIndex,
            });
          }
          // flow 전용 초판(AC-P3-4): 방향/크기가 문서와 **다른** 페이지에 float(자유배치) 개체가 있으면
          // 차단한다. float 원점은 .sheet padding edge 전제인데, 이질 용지에서 그 전제가 별도 검증되기
          // 전까지 방향 혼합을 flow 전용으로 한정한다(fail-closed — 명시적 차단). 문서와 같은 용지 override
          // 나 flow 전용 페이지는 통과.
          if (resolved) {
            let docResolved = null;
            try { docResolved = resolvePaper(document.paper ?? null); } catch { docResolved = null; }
            const differs = !docResolved
              || resolved.size !== docResolved.size
              || resolved.orientation !== docResolved.orientation;
            const hasFloat = Array.isArray(page.float) && page.float.length > 0;
            if (differs && hasFloat) {
              findings.push({
                rule: 'page-orientation-float-unsupported',
                message: `pages[${pageIndex}]: 방향/크기가 문서와 다른 페이지에는 float(자유배치) 개체를 둘 수 없습니다(flow 전용 초판 — AC-P3-4).`,
                page: pageIndex,
              });
            }
          }
        }
      }
    });
  }

  #checkPages(document, findings) {
    const pages = Array.isArray(document.pages) ? document.pages : [];
    pages.forEach((page, pageIndex) => {
      this.#checkBucket(page?.flow, 'flow', pageIndex, findings);
      this.#checkBucket(page?.float, 'float', pageIndex, findings);
    });
  }

  // bucketName: 문서가 개체를 담아둔 배열('flow'|'float'). 개체 자신의 placement 필드와
  // 일치해야 한다(불일치 시 rule:'bucket-placement-mismatch' — flow/float 정합 위반).
  #checkBucket(list, bucketName, pageIndex, findings) {
    const items = Array.isArray(list) ? list : [];
    for (const obj of items) {
      const { ok, findings: shapeFindings } = validateObjectShape(obj);
      if (!ok) {
        for (const f of shapeFindings) findings.push({ ...f, page: pageIndex, bucket: bucketName });
      }
      if (obj && typeof obj.placement === 'string' && obj.placement !== bucketName) {
        findings.push({
          rule: 'bucket-placement-mismatch',
          message: `${bucketName} 버킷에 담긴 개체의 placement 가 '${obj.placement}' 입니다(불일치).`,
          objectId: obj?.id ?? null,
          page: pageIndex,
          bucket: bucketName,
        });
      }
    }
  }

  // advisory(warning, 게이트 비차단): passage-slot.bodyHtml 이 채워졌는데 source 가 없으면 출처
  // 표기를 권고한다(2층 정책 — 교사 입력은 허용하되 출처 누락은 강제하지 않고 안내만 한다).
  #checkAdvisories(document, findings) {
    const pages = Array.isArray(document.pages) ? document.pages : [];
    pages.forEach((page, pageIndex) => {
      const items = [...(Array.isArray(page?.flow) ? page.flow : []), ...(Array.isArray(page?.float) ? page.float : [])];
      for (const obj of items) {
        if (!obj || obj.type !== 'passage-slot') continue;
        const hasBody = typeof obj.bodyHtml === 'string' && obj.bodyHtml.trim() !== '';
        const hasSource = typeof obj.source === 'string' && obj.source.trim() !== '';
        if (hasBody && !hasSource) {
          findings.push({
            rule: 'passage-source-missing',
            severity: 'warning',
            message: '저작권 지문(passage-slot) 본문이 있는데 출처(source)가 없습니다 — 출처 표기를 권장합니다(게이트 차단 아님).',
            objectId: obj.id ?? null,
            page: pageIndex,
          });
        }
      }
    });
  }
}
