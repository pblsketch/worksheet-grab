// core.js — editor-v4 개체 트리 상태 저장소(S4.1, 개체 우선 조작 코어).
//
// DOM 무지 — 순수 JS 상태만 다룬다. /shell.json 이 준 document(개체 트리)를 단일 진실로 들고,
// id 로 개체를 찾아 갱신하는 최소 API 만 제공한다. selection.js(선택·인라인 편집)·history.js
// (undo/redo)·editor.js(부트스트랩·저장)가 전부 이 스토어를 경유해 문서를 읽고 쓴다.
//
// 개체 자체는 참조로 반환한다 — findObject(id).obj 를 직접 mutate 하면 그대로 문서에 반영된다
// (별도 setter 불필요). 단, undo/redo 로 setDocument() 가 문서 전체를 교체하면 이전에 들고 있던
// obj 참조는 즉시 낡은 것이 되므로, 호출부는 항상 findObject 를 다시 호출해야 한다(selection.js
// 는 obj 참조를 함수 호출 경계 밖으로 들고 나가지 않는다 — 설계 불변식).

/**
 * @param {object} initialDocument /shell.json 의 document(개체 트리) — pagination/pages 스키마.
 * @returns {{getDocument():object, setDocument(next:object):void, findObject(id:string):{obj:object}|null}}
 */
export function createDocumentStore(initialDocument) {
  let currentDocument = initialDocument;

  function allObjects() {
    const out = [];
    for (const page of currentDocument?.pages || []) {
      for (const obj of page?.flow || []) out.push(obj);
      for (const obj of page?.float || []) out.push(obj);
    }
    return out;
  }

  return {
    /** 현재 문서(개체 트리) — 항상 최신 참조를 돌려준다(캐시 금지). */
    getDocument() {
      return currentDocument;
    },
    /** undo/redo 복원 전용 — 문서 참조를 통째로 교체한다. */
    setDocument(next) {
      currentDocument = next;
    },
    /** id 로 개체를 찾는다(flow/float 전 페이지 순회). 없으면 null. */
    findObject(id) {
      const obj = allObjects().find((o) => o && o.id === id);
      return obj ? { obj } : null;
    },
    /** 모든 개체 평면 목록(디버깅·선택 범위 계산용). */
    allObjects,
  };
}
