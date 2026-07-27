// (c) 원인 규명 프로브 — 리플로우 발화/변경 카운터·측정 높이·페이지 배정 실측 덤프.
import { launchQa, sleep } from './harness.mjs';

const rows = Array.from({ length: 28 }, (_, i) => [{ text: `항목 ${i + 1}` }, { text: `값 ${i + 1}` }]);
const s = await launchQa({
  document: {
    pagination: 'paginated', docTitle: '표경계', lang: 'ko', standards: [], paper: null,
    pages: [{ flow: [
      { id: 't1', type: 'title', placement: 'flow', text: '표 경계 테스트' },
      { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>' + '표 앞 내용. '.repeat(120) + '</p>' },
      { id: 'big-table', type: 'table', placement: 'flow', splittable: false, rows },
      { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '표를 보고 답하시오.', qnum: 1 },
    ], float: [] }],
  },
  docName: '표경계프로브',
});
try {
  await s.navigate();
  const t1 = await s.centerOf('[data-oid="t1"]');
  await s.dblclick(t1.x, t1.y);
  await s.typeText('X');
  await s.pressKey('Escape');
  await sleep(3000);
  console.log('counters:', await s.evalExpr(`JSON.stringify({runs: document.body.dataset.reflowRuns, changes: document.body.dataset.reflowChanges})`));
  console.log('layout:', await s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    const d = f.contentDocument;
    const els = [...d.querySelectorAll('[data-oid]')];
    const info = els.map((el) => { const r = el.getBoundingClientRect(); return el.dataset.oid + ':' + Math.round(r.top) + '+' + Math.round(r.height); });
    const sheet = d.querySelector('.sheet').getBoundingClientRect();
    return JSON.stringify({ sheetH: Math.round(sheet.height), info });
  })()`));
  // 편집기 자체 measureFlow 를 직접 호출해 실측 heights 를 얻는다(제품 코드 경로 그대로)
  console.log('measure:', await s.evalExpr(`(async () => {
    const reflow = await import('/editor/reflow.js');
    const shellRes = await fetch('/shell.json'); const shell = await shellRes.json();
    const docTree = shell.document;
    const styleTag = reflow.extractStyleTag(shell.teacherHtml);
    const flat = reflow.flattenFlow(docTree);
    const meta = reflow.buildRenderMeta(docTree);
    const { heights } = await reflow.measureFlow(flat, { renderMeta: meta, styleTag });
    const { assignFlowToPages, computeAvailableHeightPx } = await import('/src/usecases/PaginateObjectTree.js');
    const avail = computeAvailableHeightPx(docTree.paper ?? null);
    const items = flat.map((o) => ({ id: o.id, heightPx: heights[o.id] ?? 0 }));
    const { pageOfId, pageCount } = assignFlowToPages(items, avail, { tolerancePx: 2 });
    return JSON.stringify({ avail, heights, pageOfId, pageCount });
  })()`));
} finally {
  await s.close();
}
