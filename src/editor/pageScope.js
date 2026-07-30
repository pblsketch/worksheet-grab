// pageScope.js — 페이지-scope AI 대상 수집(순수). ai.js 가 pageId 들을 page 객체로 해석해 이 함수에
// 넘긴다 — 다중 페이지("선택한 N개 페이지 전체")를 Chrome 없이 유닛으로 고정하기 위해 DOM/deps
// 글루와 분리한다(marqueeHits.js·body-drag.js 의 순수추출 선례).
//
// std-box(성취기준 원문) 등 제외 타입은 여기서 조용히 뺀다 — 페이지 전체라는 이유로 성취기준이
// AI 대상이 되면 안 된다(원칙 3). 선택 경로처럼 던지지 않는 이유는 교사가 특정 개체를 지목한 게
// 아니기 때문이다(ai.js collectPageTargets 의 기존 규약과 동일).

/**
 * 여러 페이지의 flow+float 개체를 AI 대상 목록으로 모은다(등장 순서, id 중복 제거).
 * @param {Array<{flow?:object[], float?:object[]}>} pages 대상 페이지 객체 배열.
 * @param {Iterable<string>} [excludedTypes] AI 대상에서 제외할 개체 타입(예: std-box).
 * @returns {Array<{id:string, obj:object}>} 대상 개체 목록.
 */
export function pageScopeTargets(pages, excludedTypes = []) {
  const excluded = excludedTypes instanceof Set ? excludedTypes : new Set(excludedTypes);
  const seen = new Set();
  const targets = [];
  for (const page of pages || []) {
    if (!page) continue;
    for (const obj of [...(page.flow || []), ...(page.float || [])]) {
      if (!obj || !obj.id || excluded.has(obj.type)) continue;
      if (seen.has(obj.id)) continue; // 같은 id 가 두 번(방어) — 첫 등장만
      seen.add(obj.id);
      targets.push({ id: obj.id, obj });
    }
  }
  return targets;
}
