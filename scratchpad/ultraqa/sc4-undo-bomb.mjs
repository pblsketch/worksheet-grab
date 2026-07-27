// 시나리오 4 — undo 폭탄(실 CDP: 이질 조작 6종 후 Ctrl+Z ×40 → Ctrl+Y ×40 → Ctrl+Z ×40).
// 실행: node scratchpad/ultraqa/sc4-undo-bomb.mjs
import { launchQa, standardFixture, assertLog, sleep } from './harness.mjs';

const A = assertLog();
const s = await launchQa({ document: standardFixture(), docName: '언두폭탄' });
try {
  await s.navigate();

  // 개체 인벤토리(뷰 상태 배제): oid·answer클래스·텍스트·float 위치·페이지 수
  const inventory = () => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    const d = f.contentDocument;
    const objs = [...d.querySelectorAll('[data-oid]')].map((el) => ({
      oid: el.dataset.oid,
      answer: el.classList.contains('answer') || !!el.querySelector(':scope > .answer'),
      text: el.textContent.replace(/[\\s\\u2807]+/g, ' ').trim().slice(0, 80),
      pos: el.classList.contains('wg-float') ? (el.style.left + '|' + el.style.top) : '',
    }));
    return JSON.stringify({ sheets: d.querySelectorAll('.sheet').length, objs });
  })()`);

  const inv0 = await inventory();

  // ── 이질 조작 6종 ──
  // 1) 제목 타이핑
  const t1 = await s.centerOf('[data-oid="t1"]');
  await s.dblclick(t1.x, t1.y);
  await s.typeText(' UNDOBOMB', { perCharMs: 8 });
  await s.pressKey('Escape');
  await sleep(500);
  // 2) q1 정답 토글
  const q1 = await s.centerOf('[data-oid="q1"] .q');
  await s.click(q1.x, q1.y);
  let btn = await s.centerOfTop('#tb-answer-toggle');
  await s.click(btn.x, btn.y);
  await sleep(450);
  // 3) r1 삭제
  const r1 = await s.centerOf('[data-oid="r1"]');
  await s.click(r1.x, r1.y);
  btn = await s.centerOfTop('#tb-delete');
  await s.click(btn.x, btn.y);
  await sleep(450);
  // 4) f1 드래그
  const h = await s.centerOf('[data-oid="f1"] .wg-float-handle');
  await s.dragTo(h.x, h.y, h.x + 45, h.y - 30);
  await sleep(300);
  // 드래그 후 click 삼킴 소진
  const sheet = await s.rectOf('.sheet');
  await s.click(sheet.x + sheet.width / 2, sheet.y + sheet.height - 15);
  // 5) 삽입(좌 패널 삽입 탭 → 첫 카드)
  let tab = await s.centerOfTop('[data-tab="insert"]');
  await s.click(tab.x, tab.y);
  const card = await s.centerOfTop('#insert-grid .insert-card');
  await s.click(card.x, card.y);
  await sleep(500);
  // 6) tb1 표 행 추가
  const tb1 = await s.centerOf('[data-oid="tb1"]');
  await s.click(tb1.x, tb1.y);
  btn = await s.centerOfTop('#tb-add-row');
  await s.click(btn.x, btn.y);
  await sleep(450);

  await s.pressKey('Escape');
  await sleep(600); // 잔여 커밋 안정화
  const inv1 = await inventory();
  A.check(inv0 !== inv1, '조작 6종이 실제로 문서를 바꿈(공격 유효성)');

  // ── Ctrl+Z ×40 (스택 깊이 초과 폭탄) ──
  for (let i = 0; i < 40; i++) { await s.pressKey('z', { modifiers: 2 }); await sleep(60); }
  await sleep(800);
  const invUndo = await inventory();
  A.check(invUndo === inv0, 'undo 폭탄 후 초기 상태로 완전 복원');

  // ── Ctrl+Y ×40 ──
  for (let i = 0; i < 40; i++) { await s.pressKey('y', { modifiers: 2 }); await sleep(60); }
  await sleep(800);
  const invRedo = await inventory();
  A.check(invRedo === inv1, 'redo 폭탄 후 조작 완료 상태로 복원');

  // ── 다시 Ctrl+Z ×40 ──
  for (let i = 0; i < 40; i++) { await s.pressKey('z', { modifiers: 2 }); await sleep(60); }
  await sleep(800);
  A.check((await inventory()) === inv0, '2차 undo 폭탄도 초기 상태 복원(스택 일관성)');

  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 8));
  if (invUndo !== inv0) {
    console.log('[diff] inv0 vs invUndo');
    console.log(inv0.slice(0, 600)); console.log('---'); console.log(invUndo.slice(0, 600));
  }
} finally {
  await s.close();
}
process.exitCode = A.summary('sc4-undo-bomb') ? 0 : 1;
