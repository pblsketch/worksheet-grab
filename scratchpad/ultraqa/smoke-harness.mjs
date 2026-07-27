// 하네스 자체 스모크 — launch→navigate→클릭 선택→더블클릭 편집→타이핑→Esc→shell.json→close.
import { launchQa, standardFixture, assertLog, sleep } from './harness.mjs';

const A = assertLog();
const s = await launchQa({ document: standardFixture(), docName: '스모크' });
try {
  await s.navigate();
  A.check(true, 'navigate + data-ready');

  const t = await s.centerOf('[data-oid="t1"]');
  await s.click(t.x, t.y);
  A.check((await s.objState('t1')).selected === true, '클릭 선택');

  await s.dblclick(t.x, t.y);
  const st = await s.objState('t1');
  A.check(st.editing === true && st.ceCount === 1, '더블클릭 편집 진입');

  await s.typeText('X');
  await s.insertText('한글주입');
  A.check((await s.objState('t1')).text.includes('한글주입'), 'insertText 한글 반영');

  await s.pressKey('Escape');
  A.check((await s.objState('t1')).editing === false, 'Esc 편집 종료');

  const shell = await s.shellJson();
  A.check(shell && typeof shell === 'object', 'shell.json 응답');
  console.log('[info] shell keys:', Object.keys(shell).join(','));
  console.log('[info] consoleErrors:', s.consoleErrors.length);
} finally {
  await s.close();
}
process.exitCode = A.summary('smoke-harness') ? 0 : 1;
