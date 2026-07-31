// authorAnchor.js — B1 "새 섹션 AI 저작" 진입점의 앵커 산출(순수, DOM/deps 무의존).
//
// 프래그먼트 저작에서 **삽입 위치는 교사의 클릭이 정한다**(AI 가 아니다) — 이 순수 함수가 (대상)
// 페이지 + 선택 개체로부터 insert-section 앵커를 결정한다. pageScope.js·marqueeHits.js 선례처럼
// DOM 글루와 분리해 Chrome 없이 유닛으로 고정한다.
//
// 앵커 4태(insert-section 은 float 앵커를 허용하지 않으므로 float 선택은 페이지 말미로 흘린다):
//  - 선택이 이 페이지의 본문 흐름(flow) 개체 → 그 개체 뒤              → { afterId }
//  - 선택 없음·자유배치(float) 선택·다른 페이지 선택 + flow≥1        → 이 페이지 마지막 flow 개체 뒤 → { afterId }
//  - 이 페이지에 flow 개체 없음 + 문서에 앞선 flow 개체 있음(빈 페이지) → 문서 내 마지막 flow 개체 뒤 → { afterId }
//  - 이 페이지에 flow 개체 없음 + 문서에도 flow 개체 없음(완전 빈 문서) → 페이지 말미 append          → { pageId }
//
// 빈 페이지에 pageId 로 앵커하지 않고 문서의 마지막 flow 개체 뒤로 붙이는 이유: 콘텐츠 기반 페이지네이션
// 에서 **빈 페이지는 reflow 가 지운다**(후행 빈 페이지 특히). 무API 저작은 요청→응답 사이가 길어 그 사이
// reflow 가 페이지를 지우면 pageId 앵커가 스테일이 된다. 안정 개체(마지막 flow)에 붙이면 새 섹션이
// 문서 말미로 흘러 교사가 새 페이지에 저작한 것과 같은 결과가 되고, 스테일도 없다. 완전 빈 문서만
// 앵커할 개체가 없어 pageId 로 append 하는데, 이땐 페이지가 유일해 reflow 가 지우지 않는다(안정).

/**
 * insert-section 앵커를 결정한다.
 * @param {{id?:string, flow?:object[], float?:object[]}} page 삽입 대상 페이지(보통 활성 페이지).
 * @param {{id?:string, placement?:string}|null} [selectedObj] 선택 개체(있으면). float 는 페이지 말미로.
 * @param {string|null} [lastDocFlowId] 문서에서 이 페이지까지의 마지막 flow 개체 id(빈 페이지 폴백용).
 * @returns {{afterId:string}|{pageId:string}|null} 앵커. page(또는 page.id)가 없으면 null.
 */
export function computeAuthorAnchor(page, selectedObj = null, lastDocFlowId = null) {
  if (!page || typeof page !== 'object') return null;
  const flow = Array.isArray(page.flow) ? page.flow : [];

  // 선택이 이 페이지의 flow 개체면 그 뒤 — 교사가 지목한 자리.
  if (selectedObj && selectedObj.id && selectedObj.placement !== 'float') {
    if (flow.some((o) => o && o.id === selectedObj.id)) return { afterId: selectedObj.id };
  }

  // 이 페이지에 flow 개체가 있으면 그 말미(마지막 flow 개체 뒤).
  const lastFlow = flow.length ? flow[flow.length - 1] : null;
  if (lastFlow && lastFlow.id) return { afterId: lastFlow.id };

  // 빈 페이지: 문서 내 마지막 flow 개체 뒤(안정 앵커). 없으면(완전 빈 문서) 페이지 append.
  if (typeof lastDocFlowId === 'string' && lastDocFlowId) return { afterId: lastDocFlowId };
  return page.id ? { pageId: page.id } : null;
}
