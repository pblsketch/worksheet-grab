/**
 * 한글(CJK) IME 조합 상태 추적 — 편집기 전역 단일 인스턴스.
 *
 * 왜 필요한가(실측 근거: `.omo/evidence/p3-ime-composition-repro.md`):
 * 조합 중에도 브라우저는 DOM 에 조합 문자를 넣고 `input` 이벤트를 발생시킨다(`isComposing:true`).
 * 그 이벤트로 개체 필드를 되읽고 리플로우를 예약하면, 조합이 끝나기 전에 리플로우가 teacher
 * `<body>` 를 다시 그려 **편집 중이던 DOM 노드를 교체**한다. 브라우저 IME 는 여전히 옛 노드
 * 기준의 조합을 들고 있다가 확정 시 같은 글자를 한 번 더 넣는다 — CDP 실조합 재현에서
 * `학` 한 글자가 `학학` 이 되는 문자 중복(데이터 손상)이 관측됐다.
 *
 * 규약:
 * - 조합 중 개체 필드 되읽기 금지 → 각 `input` 리스너가 `e.isComposing` 으로 건너뛴다.
 * - 조합 중 DOM 교체 금지 → `isComposing()` 으로 리플로우를 미룬다.
 * - 조합 확정 시 한 번만 동기화 → `onCompositionEnd()` 구독자가 처리한다(undo 도 음절 1스텝).
 */

let composing = false;
const endListeners = new Set();

/**
 * teacher 문서에 조합 리스너를 배선한다. 같은 document 에 두 번 걸지 않는다
 * (재로드는 `<body>` innerHTML 치환이라 document 정체성이 유지된다 — 커밋 4c63930).
 * @param {Document} doc
 */
export function attachComposition(doc) {
  if (!doc || doc.__wgCompositionAttached) return;
  doc.__wgCompositionAttached = true;
  doc.addEventListener('compositionstart', () => { composing = true; });
  doc.addEventListener('compositionend', () => {
    composing = false;
    // 한 구독자가 실패해도 나머지는 반드시 호출한다 — 구독자 중 하나가 미뤄둔 리플로우 재개를
    // 담당하므로(editor.js), 앞선 구독자의 예외로 그게 건너뛰어지면 리플로우가 영영 멈춘다.
    for (const fn of [...endListeners]) {
      try { fn(); } catch (e) { console.error('조합 확정 구독자 실패:', e); }
    }
  });
}

/** 지금 IME 조합이 진행 중인가. 리플로우·재렌더 게이트가 이걸 본다. */
export function isComposing() {
  return composing;
}

/**
 * 조합 상태를 강제로 푼다 — `<body>` 를 치환한 직후처럼 조합 중이던 노드가 사라져
 * `compositionend` 가 영영 오지 않을 수 있는 지점에서 부른다. 이게 없으면 `composing` 이
 * true 로 굳어 리플로우가 영구히 멈춘다(편집이 조용히 페이지에 반영되지 않는 최악의 실패).
 * 이미 풀려 있으면 아무것도 하지 않는다(구독자 중복 호출 방지).
 */
export function releaseComposition() {
  if (!composing) return;
  composing = false;
  for (const fn of [...endListeners]) {
    try { fn(); } catch (e) { console.error('조합 해제 구독자 실패:', e); }
  }
}

/**
 * 조합 확정 직후 호출될 콜백을 등록한다.
 * @param {() => void} fn
 * @returns {() => void} 해제 함수
 */
export function onCompositionEnd(fn) {
  endListeners.add(fn);
  return () => endListeners.delete(fn);
}

/** 테스트 전용 — 모듈 전역 상태를 초기화한다. */
export function resetCompositionForTest() {
  composing = false;
  endListeners.clear();
}
