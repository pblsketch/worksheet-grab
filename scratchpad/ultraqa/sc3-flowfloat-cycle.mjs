// 시나리오 3 — flow⇄float 전환 반복(실 CDP: 툴바 #tb-flowfloat 실클릭 ×8 + 드래그 + 저장 왕복).
// 실행: node scratchpad/ultraqa/sc3-flowfloat-cycle.mjs
import { launchQa, standardFixture, assertLog, sleep } from './harness.mjs';

const A = assertLog();
const s = await launchQa({ document: standardFixture(), docName: '전환반복' });
try {
  await s.navigate();

  const placementOf = (oid) => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    const el = f.contentDocument.querySelector('[data-oid="${oid}"]');
    if (!el) return null;
    return el.classList.contains('wg-float') ? 'float' : 'flow';
  })()`);

  // r1(richtext, flow) 선택 → 전환 8회: 매회 placement 가 실제로 뒤집히는지
  let target = await s.centerOf('[data-oid="r1"]');
  await s.click(target.x, target.y);
  A.check((await placementOf('r1')) === 'flow', '시작 상태 flow');

  let expected = 'flow';
  let okAll = true;
  for (let i = 0; i < 8; i++) {
    // float 상태에서는 개체가 이동했을 수 있으니 툴바 버튼은 최상위 문서 좌표로 클릭
    const btn = await s.centerOfTop('#tb-flowfloat');
    await s.click(btn.x, btn.y);
    await sleep(450); // applyDocOp(iframe 재로드)+선택 복원 대기
    expected = expected === 'flow' ? 'float' : 'flow';
    const actual = await placementOf('r1');
    if (actual !== expected) { okAll = false; console.log(`  [i=${i}] expected ${expected} got ${actual}`); }
  }
  A.check(okAll, 'flow⇄float 전환 8회 전부 일관되게 반영');
  A.check((await placementOf('r1')) === 'flow', '8회(짝수) 후 flow 복귀');

  // 전환 직후 선택 유지 확인(툴바가 계속 떠 있어야 연쇄 조작 가능)
  const st = await s.objState('r1');
  A.check(st.selected === true, '전환 반복 후에도 선택 유지');

  // float 로 만들어 드래그 → 다시 flow → rect 잔존 여부(스키마: flow 에 rect 있으면 검증 오류일 수 있음)
  const btn = await s.centerOfTop('#tb-flowfloat');
  await s.click(btn.x, btn.y);
  await sleep(450);
  A.check((await placementOf('r1')) === 'float', '9회차 float 전환');
  const handle = await s.centerOf('[data-oid="r1"] .wg-float-handle');
  await s.dragTo(handle.x, handle.y, handle.x + 50, handle.y + 35);
  const styleAfterDrag = (await s.objState('r1')).style;
  A.check(/left|top/.test(styleAfterDrag), 'float 드래그로 위치 inline style 반영');
  // 드래그 후 삼켜진 click 소진(.sheet 클릭) 뒤 r1 재선택 → flow 복귀
  const sheet = await s.rectOf('.sheet');
  await s.click(sheet.x + sheet.width / 2, sheet.y + sheet.height - 15);
  target = await s.centerOf('[data-oid="r1"]');
  // 미선택 float 본체는 pointer-events:none — 손잡이를 클릭해 선택
  const handle2 = await s.centerOf('[data-oid="r1"] .wg-float-handle');
  await s.click(handle2.x, handle2.y);
  const btn2 = await s.centerOfTop('#tb-flowfloat');
  await s.click(btn2.x, btn2.y);
  await sleep(450);
  A.check((await placementOf('r1')) === 'flow', '드래그 후 flow 복귀');

  // 저장 → 검증 통과 & 문서에 r1 flow + rect 부재(스키마 오염 없음)
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1500);
  const shell = await s.shellJson();
  const allObjs = shell.document.pages.flatMap((p) => [...(p.flow || []), ...(p.float || [])]);
  const r1 = allObjs.find((o) => o.id === 'r1');
  A.check(!!r1 && r1.placement === 'flow', '저장된 문서에서 r1 placement=flow');
  A.check(!('rect' in (r1 || {})), 'flow 복귀 후 rect 필드 잔존 없음');
  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 5));
} finally {
  await s.close();
}
process.exitCode = A.summary('sc3-flowfloat-cycle') ? 0 : 1;
