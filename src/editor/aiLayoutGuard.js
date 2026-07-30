// aiLayoutGuard.js — AI 산출 개체의 레이아웃 필드 불변식(순수). Chrome/DOM 없이 단위 검증하기 위해
// ai.js 의 적용 경로에서 이 함수 하나로 뽑아냈다(marqueeHits.js·pageScope.js 의 순수추출 선례).
//
// **왜 코드로 또 막나 — designer 계약(프롬프트)만으로는 못 막는다.**
// SIZE_FIELDS(폭·최소높이·정렬)와 자유배치 표현 속성(opacity·angle)은 designer 어휘에서 빠져 있지만
// 그건 프롬프트 수준의 약속일 뿐이다. 무API·개체 에코 계약상 요청 objects 에는 교사가 편집기에서
// 설정한 이 값들이 **그대로 실려 나가고**(ai.js buildRequestBody), AI 가 그 값을 되돌려주면
// ValidateObjectShape 는 통과한다 — SIZEABLE 타입(callout 포함)은 flow 에서 SIZE_FIELDS 를 허용하고,
// opacity/angle 은 전 타입 ALWAYS_ALLOWED 이기 때문이다. 프롬프트가 새도 조판·표현은 교사 소유로
// 남도록 **적용 시점에** 한 번 더 강제한다(심층 방어 — 원칙 3 의 연장: AI 는 내용만, 조판은 교사).

import { SIZE_FIELDS } from '/src/domain/schema/index.js';

/**
 * AI 저작 금지 레이아웃 필드 — 크기·정렬(SIZE_FIELDS: widthPct/minHeightMm/align) + 자유배치 표현
 * 속성(opacity·angle). SIZE_FIELDS 는 SSOT 에서 스프레드해 카탈로그가 늘면 여기도 따라 는다
 * (ai-layout-guard.test.js 가 SIZE_FIELDS ⊆ AI_LAYOUT_FIELDS 를 상시 단정).
 */
export const AI_LAYOUT_FIELDS = Object.freeze([...SIZE_FIELDS, 'opacity', 'angle']);

/**
 * AI 산출 개체에 레이아웃 불변식을 강제한 사본(순수 — 원본 불변).
 *  - AI 가 실은 레이아웃 값은 **언제나 버린다**(신뢰하지 않는다).
 *  - before(치환 대상 개체)가 있으면 그 **교사 값만** 되살린다 — AI 의 내용 재작성이 교사가 잡아 둔
 *    폭·정렬·불투명도·회전을 조용히 지우지 않도록(replace/echo 는 개체를 통째로 갈아끼우므로, 이걸
 *    안 하면 "AI 로 문구만 고쳤는데 크기가 원래대로 돌아갔다"가 된다).
 *  - before 가 없으면(신규 생성: insert/insert-section) 필드를 남기지 않는다 — AI 가 조판을 낳지 않는다.
 *
 * @param {object} obj    AI 가 돌려준 개체(정제 전/후 무관 — 레이아웃 필드만 다룬다).
 * @param {object|null} [before] 치환 대상인 기존 개체(교사 값의 출처). 신규 생성은 null.
 * @returns {object} 레이아웃 불변식을 만족하는 새 개체.
 */
export function enforceAiLayout(obj, before = null) {
  const clone = structuredClone(obj);
  for (const f of AI_LAYOUT_FIELDS) delete clone[f];
  if (before) {
    for (const f of AI_LAYOUT_FIELDS) {
      if (before[f] !== undefined) clone[f] = before[f];
    }
  }
  return clone;
}
