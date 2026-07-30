// marqueeHits.js — 마퀴(드래그 박스) 교차 판정(순수). selection.js 의 finishMarquee 가 DOM 에서
// 개체 rect 를 모아 이 함수에 넘긴다 — 실마우스 없이 회귀 표면(교차·중복제거·flow/float 포함)을
// 유닛으로 고정하기 위해 DOM 글루와 분리한다(body-drag.js 의 shouldPromoteBodyDrag 순수추출 선례).

/**
 * 박스와 **실제로 겹치는**(경계 접촉은 제외) 개체의 oid 목록 — 등장 순서 보존, 중복 제거.
 *
 * 교차식은 기존 float 마퀴(selection.js)의 판정과 문자 그대로 동일하다:
 *   r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
 * (엄격 겹침 — 변이 정확히 맞닿는 경우는 선택하지 않는다.)
 *
 * @param {Array<{oid:string, rect:{left:number,top:number,right:number,bottom:number}}>} objects
 *   화면에 그려진 선택 대상 개체들. flow(.wg-obj)·float(.wg-float) 구분 없이 호출부가 합쳐 넘긴다
 *   — 활동지 본문 대부분이 flow 라, 이 둘을 함께 넘겨야 "영역으로 잡기"가 제목·문항·지문·표를 잡는다.
 * @param {{left:number, top:number, right:number, bottom:number}} box 정규화된 선택 사각형.
 * @returns {string[]} box 와 겹치는 개체 oid(문자열), 중복 제거.
 */
export function marqueeHitOids(objects, box) {
  const seen = new Set();
  const hits = [];
  for (const o of objects || []) {
    if (!o || !o.rect || o.oid == null) continue;
    const r = o.rect;
    if (r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) {
      const id = String(o.oid);
      if (!seen.has(id)) { seen.add(id); hits.push(id); }
    }
  }
  return hits;
}
