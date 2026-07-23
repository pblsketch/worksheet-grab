// 시나리오 5 — 페이지 추가/삭제/복제 조합(실 CDP: 썸네일 우클릭 메뉴 + #btn-add-page).
// 알려진 한계(§5): 빈 페이지는 다음 콘텐츠 편집 리플로우에서 사라질 수 있음 — 버그로 단정하지 않음.
// 실행: node scratchpad/ultraqa/sc5-page-combos.mjs
import { launchQa, standardFixture, assertLog, sleep } from './harness.mjs';

const A = assertLog();
const s = await launchQa({ document: standardFixture(), docName: '페이지조합' });
try {
  await s.navigate();

  const sheetCount = () => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    return f.contentDocument.querySelectorAll('.sheet').length;
  })()`);
  const thumbCount = () => s.evalExpr(`document.querySelectorAll('#thumb-list .thumb').length`);
  const oidsAll = () => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    return [...f.contentDocument.querySelectorAll('[data-oid]')].map((e) => e.dataset.oid);
  })()`);

  A.check((await sheetCount()) === 1, '시작: 1페이지');

  // 1) + 새 페이지 → 2페이지, 썸네일 동기화
  const addBtn = await s.centerOfTop('#btn-add-page');
  await s.click(addBtn.x, addBtn.y);
  await sleep(600);
  A.check((await sheetCount()) === 2, '+새 페이지 → 2페이지');
  A.check((await thumbCount()) === 2, '썸네일 2개 동기화');

  // 2) 1페이지(콘텐츠) 우클릭 → 복제 → 3페이지 & data-oid 전역 유일성 유지 확인
  const thumb1 = await s.centerOfTop('#thumb-list .thumb:nth-child(1)');
  await s.mouse.rightClick(thumb1.x, thumb1.y);
  await sleep(200);
  const dupBtn = await s.evalExpr(`(() => {
    const m = document.querySelector('.ctx-menu');
    const b = [...m.querySelectorAll('button')].find((x) => x.textContent === '복제');
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await s.click(dupBtn.x, dupBtn.y);
  await sleep(700);
  A.check((await sheetCount()) === 3, '콘텐츠 페이지 복제 → 3페이지');
  const ids = await oidsAll();
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  A.check(dupIds.length === 0, `복제 후 data-oid 전역 유일(중복: ${JSON.stringify(dupIds.slice(0, 5))})`);

  // 3) 저장 → 서버 검증 통과 여부(중복 id 면 ValidateObjectTree 가 잡아야 함)
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1500);
  const shell = await s.shellJson();
  const savedIds = shell.document.pages.flatMap((p) => [...(p.flow || []), ...(p.float || [])]).map((o) => o.id);
  const savedDup = savedIds.filter((id, i) => savedIds.indexOf(id) !== i);
  A.check(savedDup.length === 0, '저장 문서에도 id 중복 없음');
  A.check((shell.warnings || []).every((w) => w.severity !== 'error'), `저장 검증 error 없음(warnings: ${(shell.warnings || []).length})`);

  // 4) 마지막 페이지 우클릭 → 삭제 → 2페이지
  const lastThumb = await s.centerOfTop('#thumb-list .thumb:last-child');
  await s.mouse.rightClick(lastThumb.x, lastThumb.y);
  await sleep(200);
  const delBtn = await s.evalExpr(`(() => {
    const m = document.querySelector('.ctx-menu');
    const b = [...m.querySelectorAll('button')].find((x) => x.textContent === '삭제');
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await s.click(delBtn.x, delBtn.y);
  await sleep(700);
  A.check((await sheetCount()) === 2, '마지막 페이지 삭제 → 2페이지');

  // 5) 콘텐츠 페이지(1) 삭제 → 개체 소실 여부 관찰 → undo 복원
  const beforeDel = (await oidsAll()).length;
  const th1 = await s.centerOfTop('#thumb-list .thumb:nth-child(1)');
  await s.mouse.rightClick(th1.x, th1.y);
  await sleep(200);
  const delBtn2 = await s.evalExpr(`(() => {
    const m = document.querySelector('.ctx-menu');
    const b = [...m.querySelectorAll('button')].find((x) => x.textContent === '삭제');
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await s.click(delBtn2.x, delBtn2.y);
  await sleep(700);
  const afterDel = (await oidsAll()).length;
  console.log(`[info] 콘텐츠 페이지 삭제: 개체 ${beforeDel} → ${afterDel}`);
  await s.pressKey('z', { modifiers: 2 });
  await sleep(700);
  A.check((await oidsAll()).length === beforeDel, '콘텐츠 페이지 삭제를 undo 로 복원(개체 수 일치)');

  // 6) 추가→삭제→추가→복제→삭제 연쇄 후 콘솔 무결
  for (const [action, times] of [['add', 2], ['del-last', 1], ['add', 1], ['del-last', 2]]) {
    for (let i = 0; i < times; i++) {
      if (action === 'add') {
        const b = await s.centerOfTop('#btn-add-page');
        await s.click(b.x, b.y);
      } else {
        const lt = await s.centerOfTop('#thumb-list .thumb:last-child');
        await s.mouse.rightClick(lt.x, lt.y);
        await sleep(200);
        const db = await s.evalExpr(`(() => {
          const m = document.querySelector('.ctx-menu');
          const b = [...m.querySelectorAll('button')].find((x) => x.textContent === '삭제');
          const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await s.click(db.x, db.y);
      }
      await sleep(500);
    }
  }
  A.check((await sheetCount()) === (await thumbCount()), '연쇄 조작 후 시트·썸네일 개수 동기화');
  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 8));
} finally {
  await s.close();
}
process.exitCode = A.summary('sc5-page-combos') ? 0 : 1;
