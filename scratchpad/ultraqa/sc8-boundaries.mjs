// 시나리오 8 — 경계값: (a)빈 문서 (b)페이지보다 큰 단일 개체 (c)28행 표 분할 금지 (d)용지 전환 재페이지네이션.
// 실행: node scratchpad/ultraqa/sc8-boundaries.mjs
import { launchQa, assertLog, sleep } from './harness.mjs';

const A = assertLog();

// ── (a) 빈 문서 ──
{
  const s = await launchQa({
    document: { pagination: 'paginated', docTitle: '빈문서', lang: 'ko', standards: [], paper: null, pages: [{ flow: [], float: [] }] },
    docName: '빈문서',
  });
  try {
    await s.navigate();
    A.check(true, '(a) 빈 문서 에디터 정상 로드');
    // 삽입 탭 → 첫 카드 클릭 → 개체 생김
    const tab = await s.centerOfTop('[data-tab="insert"]');
    await s.click(tab.x, tab.y);
    const card = await s.centerOfTop('#insert-grid .insert-card');
    await s.click(card.x, card.y);
    await sleep(600);
    const n = await s.evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      return f.contentDocument.querySelectorAll('[data-oid]').length;
    })()`);
    A.check(n === 1, `(a) 빈 문서에 삽입 동작 (개체 ${n})`);
    await s.pressKey('s', { modifiers: 2 });
    await sleep(1200);
    const shell = await s.shellJson();
    A.check(shell.document.pages.length >= 1, '(a) 저장 왕복 정상');
    A.check(s.consoleErrors.length === 0, `(a) 콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  } finally { await s.close(); }
}

// ── (b) 페이지보다 큰 단일 richtext ──
{
  const giant = '<p>' + '한 페이지를 넘기는 매우 긴 문단입니다. '.repeat(20) + '</p>';
  const s = await launchQa({
    document: {
      pagination: 'paginated', docTitle: '거대개체', lang: 'ko', standards: [], paper: null,
      pages: [{ flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '거대 개체' },
        { id: 'giant', type: 'richtext', placement: 'flow', html: giant.repeat(60) }, // ~A4 3장 분량 단일 개체
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '후속 질문', qnum: 1 },
      ], float: [] }],
    },
    docName: '거대개체',
  });
  try {
    await s.navigate();
    // 제목에 한 글자 타이핑 → 리플로우 트리거 → 무한 루프 없이 안정화되는지
    const t1 = await s.centerOf('[data-oid="t1"]');
    await s.dblclick(t1.x, t1.y);
    await s.typeText('X');
    await s.pressKey('Escape');
    await sleep(2500);
    const runs = Number(await s.evalExpr(`document.body.dataset.reflowRuns || '0'`));
    A.check(runs >= 1 && runs <= 6, `(b) 리플로우 발화하되 무한 루프 없음 (runs=${runs})`);
    const info = await s.evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      const d = f.contentDocument;
      const sheets = [...d.querySelectorAll('.sheet')];
      const giantSheet = sheets.findIndex((sh) => sh.querySelector('[data-oid="giant"]'));
      const qSheet = sheets.findIndex((sh) => sh.querySelector('[data-oid="q1"]'));
      const giantCount = d.querySelectorAll('[data-oid="giant"]').length;
      return { sheets: sheets.length, giantSheet, qSheet, giantCount };
    })()`);
    console.log('[b info]', JSON.stringify(info));
    A.check(info.giantCount === 1, '(b) 거대 개체는 분할 없이 1개(통째 귀속)');
    A.check(info.qSheet > info.giantSheet, '(b) 후속 개체는 다음 페이지로 밀림');
    await s.pressKey('s', { modifiers: 2 });
    await sleep(1500);
    const shell = await s.shellJson();
    A.check(shell.document.pagination === 'paginated', '(b) 저장 후 paginated 유지');
    A.check(s.consoleErrors.length === 0, `(b) 콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
    if (s.consoleErrors.length) console.log('[b consoleErrors]', s.consoleErrors.slice(0, 5));
  } finally { await s.close(); }
}

// ── (c) 28행 표 — 분할 금지·통째 이동(불변식 8) ──
{
  const rows = Array.from({ length: 28 }, (_, i) => [{ text: `항목 ${i + 1}` }, { text: `값 ${i + 1}` }]);
  const s = await launchQa({
    document: {
      pagination: 'paginated', docTitle: '표경계', lang: 'ko', standards: [], paper: null,
      pages: [{ flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '표 경계 테스트' },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>' + '표 앞 내용. '.repeat(400) + '</p>' },
        { id: 'big-table', type: 'table', placement: 'flow', splittable: false, rows },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '표를 보고 답하시오.', qnum: 1 },
      ], float: [] }],
    },
    docName: '표경계',
  });
  try {
    await s.navigate();
    const t1 = await s.centerOf('[data-oid="t1"]');
    await s.dblclick(t1.x, t1.y);
    await s.typeText('X');
    await s.pressKey('Escape');
    await sleep(2500);
    const info = await s.evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      const d = f.contentDocument;
      const sheets = [...d.querySelectorAll('.sheet')];
      const tableSheets = sheets.map((sh, i) => sh.querySelector('[data-oid="big-table"]') ? i : -1).filter((i) => i >= 0);
      const trCount = d.querySelectorAll('[data-oid="big-table"] tr').length;
      return { sheets: sheets.length, tableSheets, trCount };
    })()`);
    console.log('[c info]', JSON.stringify(info));
    A.check(info.tableSheets.length === 1, `(c) 28행 표가 정확히 1개 페이지에만 존재(분할 없음, 페이지 ${JSON.stringify(info.tableSheets)})`);
    A.check(info.trCount === 28, `(c) 행 손실 없음 (${info.trCount}/28)`);
    A.check(info.sheets >= 2, '(c) 표가 뒤 페이지로 통째 이동(다중 페이지)');
    A.check(s.consoleErrors.length === 0, `(c) 콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  } finally { await s.close(); }
}

// ── (d) 용지 전환: A4 → A3접이(가로) → B4 → A4 복귀, 각 전환 후 재페이지네이션 일관성 ──
{
  const flow = [{ id: 't1', type: 'title', placement: 'flow', text: '용지 전환' }];
  for (let i = 1; i <= 10; i++) {
    flow.push({ id: `q${i}`, type: 'question', placement: 'flow', qtype: 'essay', prompt: `질문 ${i} — ` + '내용. '.repeat(30), qnum: i });
    flow.push({ id: `a${i}`, type: 'answer-area', placement: 'flow', style: 'line', lines: 4 });
  }
  const s = await launchQa({
    document: { pagination: 'paginated', docTitle: '용지전환', lang: 'ko', standards: [], paper: null, pages: [{ flow, float: [] }] },
    docName: '용지전환',
  });
  try {
    await s.navigate();
    const waitReady = async () => {
      for (let i = 0; i < 150; i++) {
        if (await s.evalExpr(`document.body.dataset.ready === 'true'`).catch(() => false)) return true;
        await sleep(200);
      }
      return false;
    };
    const sheetInfo = () => s.evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      const d = f.contentDocument;
      const sheets = [...d.querySelectorAll('.sheet')];
      const oids = [...d.querySelectorAll('[data-oid]')].map((e) => e.dataset.oid);
      const w = sheets[0] ? Math.round(sheets[0].getBoundingClientRect().width) : 0;
      const h = sheets[0] ? Math.round(sheets[0].getBoundingClientRect().height) : 0;
      return { n: sheets.length, w, h, objCount: oids.length, dup: oids.length !== new Set(oids).size };
    })()`);
    const base = await sheetInfo();
    console.log('[d base]', JSON.stringify(base));

    const applyPreset = async (presetId) => {
      await s.evalExpr(`(() => {
        const sel = document.getElementById('insp-paper-preset');
        sel.value = '${presetId}';
        sel.dispatchEvent(new Event('change'));
        return true;
      })()`);
      await sleep(1000); // save-first + POST /paper + location.reload
      const ok = await waitReady();
      await sleep(800);
      return ok;
    };

    // 선택 해제 상태(문서 인스펙터)여야 프리셋 select 존재
    A.check(await s.evalExpr(`!!document.getElementById('insp-paper-preset')`), '(d) 문서 인스펙터 용지 프리셋 표시');

    // 용지별 기대 시트 높이(px, 96dpi): A4세로 297mm=1123, A3가로 297mm=1123, B4세로 364mm=1376.
    const EXPECT_H = { 'a3-fold': 1123, 'b4-portrait': 1376, 'a4-portrait': 1123 };
    for (const preset of ['a3-fold', 'b4-portrait', 'a4-portrait']) {
      const ok = await applyPreset(preset);
      A.check(ok, `(d) ${preset} 전환 후 에디터 재로드 완료`);
      await sleep(2000); // 용지 변경 후 1회 리플로우(버그 #2 수정) 안정화
      const info = await sheetInfo();
      console.log(`[d ${preset}]`, JSON.stringify(info));
      A.check(info.objCount === base.objCount && !info.dup, `(d) ${preset} 전환 후 개체 무손실·무중복 (${info.objCount}/${base.objCount})`);
      A.check(Math.abs(info.h - EXPECT_H[preset]) <= 6, `(d) ${preset} 리플로우로 시트 높이가 용지 규격으로 정상화 (${info.h}px ≈ ${EXPECT_H[preset]}px)`);
      if (preset === 'a3-fold') A.check(info.w > base.w, '(d) A3 가로 폭 확대 반영');
      if (preset === 'a4-portrait') {
        A.check(Math.abs(info.w - base.w) <= 2, '(d) A4 복귀 시 원 치수 복원');
        A.check(info.n >= 2, `(d) A4 복귀 후 과적 콘텐츠가 다중 페이지로 재배정 (${info.n}p)`);
      }
    }
    A.check(s.consoleErrors.length === 0, `(d) 콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
    if (s.consoleErrors.length) console.log('[d consoleErrors]', s.consoleErrors.slice(0, 8));
  } finally { await s.close(); }
}

process.exitCode = A.summary('sc8-boundaries') ? 0 : 1;
