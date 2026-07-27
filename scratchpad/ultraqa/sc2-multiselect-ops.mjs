// 시나리오 2 — 다중 선택 연쇄 조작(실 CDP: Shift+클릭 additive, 인스펙터 일괄, 해제 사다리).
// 실행: node scratchpad/ultraqa/sc2-multiselect-ops.mjs
import { launchQa, standardFixture, assertLog, sleep } from './harness.mjs';

const A = assertLog();
const s = await launchQa({ document: standardFixture(), docName: '다중선택' });
try {
  await s.navigate();

  const selectedIds = () => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    return [...f.contentDocument.querySelectorAll('.wg-selected')].map((e) => e.dataset.oid).sort();
  })()`);
  const tbMode = () => s.evalExpr(`document.getElementById('context-toolbar').dataset.tbMode`);

  // 1) 클릭 + Shift클릭 ×2 = 3개 additive 선택
  const t1 = await s.centerOf('[data-oid="t1"]');
  await s.click(t1.x, t1.y);
  const q1 = await s.centerOf('[data-oid="q1"] .q');
  await s.click(q1.x, q1.y, { modifiers: 8 }); // Shift
  const r1 = await s.centerOf('[data-oid="r1"]');
  await s.click(r1.x, r1.y, { modifiers: 8 });
  A.check(JSON.stringify(await selectedIds()) === JSON.stringify(['q1', 'r1', 't1']), 'Shift+클릭 additive 3개 선택');
  A.check((await tbMode()) === 'multi', '컨텍스트 툴바 multi 모드');

  // 2) Shift+클릭 재클릭 = 집합에서 토글 제거
  await s.click(q1.x, q1.y, { modifiers: 8 });
  A.check(JSON.stringify(await selectedIds()) === JSON.stringify(['r1', 't1']), 'Shift+재클릭으로 토글 해제');

  // 3) Ctrl+클릭도 additive (modifiers 2)
  await s.click(q1.x, q1.y, { modifiers: 2 });
  A.check((await selectedIds()).length === 3, 'Ctrl+클릭 additive');

  // 4) 다중 선택 상태에서 Esc = 전체 해제
  await s.pressKey('Escape');
  A.check((await selectedIds()).length === 0, 'Esc 로 다중 선택 전체 해제');

  // 5) 다중 선택 → 일반 클릭 = 단일 교체
  await s.click(t1.x, t1.y);
  await s.click(r1.x, r1.y, { modifiers: 8 });
  await s.click(q1.x, q1.y); // 일반 클릭
  A.check(JSON.stringify(await selectedIds()) === JSON.stringify(['q1']), '일반 클릭은 단일 교체');

  // 6) 다중 선택 중 하나를 더블클릭 → 그 개체만 편집(다른 선택 해제)
  await s.click(t1.x, t1.y);
  await s.click(r1.x, r1.y, { modifiers: 8 });
  await s.dblclick(t1.x, t1.y);
  const st = await s.objState('t1');
  A.check(st.editing === true && st.ceCount === 1, '다중 선택 중 더블클릭 → 단일 편집 진입');
  A.check((await selectedIds()).length === 1, '편집 진입 시 나머지 선택 해제');
  await s.pressKey('Escape');
  await s.pressKey('Escape');

  // 7) float 포함 다중 선택(인스펙터 allFloat 분기 확인용 참고 기록)
  const f1Handle = await s.centerOf('[data-oid="f1"] .wg-float-handle');
  await s.click(f1Handle.x, f1Handle.y);
  await s.click(t1.x, t1.y, { modifiers: 8 });
  A.check((await selectedIds()).length === 2, 'float+flow 혼합 다중 선택 가능');
  A.check((await tbMode()) === 'multi', '혼합 다중 선택도 multi 모드');

  // 8) 다중 선택 뒤 저장 왕복 — 문서 불변(선택은 뷰 상태일 뿐)
  const before = JSON.stringify((await s.shellJson()).document);
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1200);
  const after = JSON.stringify((await s.shellJson()).document);
  A.check(before === after, '다중 선택 상태 저장이 문서를 오염시키지 않음');
  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 5));
} finally {
  await s.close();
}
process.exitCode = A.summary('sc2-multiselect-ops') ? 0 : 1;
