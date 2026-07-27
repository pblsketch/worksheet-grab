// banner.js — 앱 바 아래 알림 배너(저장·내보내기·업로드·용지 변경이 공유하는 단일 표시 지점).
//
// Phase 5 에서 editor.js 의 showBanner 를 그대로 옮겨 왔다. 저장 모듈에 두면 내보내기 모듈이
// 저장 모듈에 의존하게 되므로(배너는 저장 전용이 아니다) 독립 모듈로 분리하고 두 모듈 모두
// 주입받는다. 동작 계약은 불변: ok 는 4초 후 자동 소멸, warn/error 는 다음 배너까지 유지한다.
export function createBanner({ root }) {
  let timer = null;
  return function showBanner(kind, text) {
    root.className = `save-banner ${kind}`;
    root.textContent = text;
    root.classList.remove('hidden');
    clearTimeout(timer);
    if (kind === 'ok') timer = setTimeout(() => root.classList.add('hidden'), 4000);
  };
}
