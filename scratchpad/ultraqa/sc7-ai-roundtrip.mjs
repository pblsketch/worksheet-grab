// 시나리오 7 — AI 요청→모의 응답(ai respond --objects 동형)→미리보기→재생성 왕복→교체(실 CDP).
// 응답 주입은 CLI 와 동일한 파일 큐(FsAiBridgeRepository.putResponse)로 수행 — 무API 계약 그대로.
// 실행: node scratchpad/ultraqa/sc7-ai-roundtrip.mjs
import { launchQa, assertLog, sleep } from './harness.mjs';
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';

function fixture() {
  return {
    pagination: 'paginated', docTitle: 'AI왕복', lang: 'ko',
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    paper: null,
    pages: [{
      flow: [
        { id: 'sb1', type: 'std-box', placement: 'flow', codes: ['9과15-01'] },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>원래 본문입니다. 전압과 전류.</p>' },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '옴의 법칙을 설명하시오.', qnum: 1 },
      ],
      float: [],
    }],
  };
}

const A = assertLog();
const s = await launchQa({ document: fixture(), docName: 'AI문서' });
const bridge = new FsAiBridgeRepository({ baseDir: s.workspaceBase });
try {
  await s.navigate();

  const aiPhase = () => s.evalExpr(`document.getElementById('ai-panel')?.dataset.aiPhase ?? null`);
  const clickTop = async (sel) => { const c = await s.centerOfTop(sel); await s.click(c.x, c.y); };
  const waitPhase = async (phase, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if ((await aiPhase()) === phase) return true;
      await sleep(200);
    }
    return false;
  };

  // ── 0) std-box 가드: 선택 시 AI 버튼 비활성 ──
  const sb = await s.centerOf('[data-oid="sb1"]');
  await s.click(sb.x, sb.y);
  await sleep(200);
  A.check(await s.evalExpr(`document.getElementById('btn-ai').disabled`) === true, 'std-box 선택 시 AI 진입 버튼 비활성(클라이언트 가드)');
  // 서버 2층 가드: std-box 를 직접 POST → 400
  const res400 = await fetch(`${s.url}/ai/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rewrite', instruction: 'x', objects: [{ id: 'sb1', type: 'std-box', placement: 'flow', codes: ['9과15-01'] }] }),
  });
  A.check(res400.status === 400, `std-box 직접 요청 서버 400 (실측 ${res400.status})`);
  await s.pressKey('Escape');

  // ── 1) r1 선택 → AI 버튼 → 프리셋(난이도 낮추기) 클릭 → waiting ──
  const r1 = await s.centerOf('[data-oid="r1"]');
  await s.click(r1.x, r1.y);
  await sleep(200);
  await clickTop('#btn-ai');
  A.check((await aiPhase()) === 'compose', 'AI 패널 compose 진입');
  await clickTop('#ai-preset-easier');
  A.check(await waitPhase('waiting'), 'waiting 전이');

  // ── 2) 파일 큐에서 pending 확인 → 모의 응답 v1 주입 ──
  await sleep(400);
  let pending = await bridge.listPending();
  A.check(pending.length === 1, `파일 큐 pending 1건 (실측 ${pending.length})`);
  const req1 = pending[0];
  A.check(Array.isArray(req1.objects) && req1.objects[0]?.id === 'r1', '요청 objects 에 r1 에코 대상 포함');
  A.check(req1.objects.every((o) => o.type !== 'std-box'), '요청에 std-box 미포함');
  await bridge.putResponse({
    id: req1.id, schemaVersion: 3,
    objects: [{ id: 'r1', object: { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>AI_V1 쉬운 본문. 전압은 전기를 미는 힘.</p>' } }],
  });
  A.check(await waitPhase('preview'), '응답 도착 → preview 전이');

  // ── 3) 재생성 → 2번째 요청 → v2 응답 → 버전 2/2 ──
  await clickTop('#ai-regenerate');
  A.check(await waitPhase('waiting'), '재생성 → waiting 재전이');
  await sleep(400);
  pending = await bridge.listPending();
  A.check(pending.length === 1, `재생성 pending 1건 (실측 ${pending.length})`);
  const req2 = pending[0];
  A.check(req2.id !== req1.id, '재생성은 새 요청 id');
  await bridge.putResponse({
    id: req2.id, schemaVersion: 3,
    objects: [{ id: 'r1', object: { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>AI_V2 더 쉬운 본문. <script>alert(1)</script>전압!</p>' } }],
  });
  A.check(await waitPhase('preview'), 'v2 preview 전이');
  await sleep(300);
  const verLabel = await s.evalExpr(`document.getElementById('ai-version-label')?.textContent ?? '1 / 1'`);
  A.check(verLabel === '2 / 2', `버전 내비 2/2 (실측 ${verLabel})`);

  // ── 4) 교체 적용 → 문서 반영 + sanitize(script 제거) + 졸업 배지 ──
  await clickTop('#ai-apply-replace');
  await sleep(900);
  const domText = (await s.objState('r1'))?.text || '';
  A.check(domText.includes('AI_V2'), '교체 적용으로 캔버스에 v2 반영');
  const fresh = await s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    return f.contentDocument.querySelector('[data-oid="r1"]')?.dataset.aiFresh ?? null;
  })()`);
  A.check(fresh === 'true', 'AI 졸업 배지(data-ai-fresh) 표시');

  // 저장 → 문서에 v2 반영 + script sanitize 확인
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1500);
  const shell = await s.shellJson();
  const r1Saved = shell.document.pages.flatMap((p) => p.flow || []).find((o) => o.id === 'r1');
  A.check((r1Saved?.html || '').includes('AI_V2'), '저장 문서에 v2 반영');
  A.check(!/<script/i.test(r1Saved?.html || ''), 'AI 응답의 script 태그 sanitize 제거');

  // ── 5) 요청 파일 상태: req2=applied 즉시 prune(EditorHttpServer.js:331 설계 동작 → null),
  //        req1=cancelled 로 잔존 ──
  await sleep(500);
  const st1 = await bridge.getStatus(req1.id);
  const st2 = await bridge.getStatus(req2.id);
  A.check(st2 === null, `적용 요청은 applied 후 즉시 prune 되어 소멸 (실측 ${st2})`);
  A.check(st1 === 'cancelled', `미적용 요청 상태 cancelled (실측 ${st1})`);
  A.check((await bridge.listPending()).length === 0, '적용 후 pending 큐 비어 있음');

  // ── 6) AI 는 rect/신규 타입 금지 — 응답이 rect 를 실어도 flow 개체에 rect 가 주입되지 않는지 ──
  const r1b = await s.centerOf('[data-oid="r1"]'); // 교체 적용 후 레이아웃 변동 — 좌표 재계산
  await s.click(r1b.x, r1b.y);
  await sleep(300);
  await clickTop('#btn-ai');
  await clickTop('#ai-preset-harder');
  await waitPhase('waiting');
  await sleep(400);
  const req3 = (await bridge.listPending())[0];
  await bridge.putResponse({
    id: req3.id, schemaVersion: 3,
    objects: [{ id: 'r1', object: { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>AI_V3 rect 주입 시도</p>', rect: { xMm: 1, yMm: 1, wMm: 10, hMm: 10 } } }],
  });
  await waitPhase('preview');
  await clickTop('#ai-apply-replace');
  await sleep(900);
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1500);
  const shell3 = await s.shellJson();
  const r1v3 = shell3.document.pages.flatMap((p) => [...(p.flow || []), ...(p.float || [])]).find((o) => o.id === 'r1');
  console.log('[info] v3 적용 후 r1:', JSON.stringify({ placement: r1v3?.placement, hasRect: 'rect' in (r1v3 || {}) }));
  A.check(r1v3?.placement === 'flow' && !('rect' in (r1v3 || {})), 'AI 가 실은 rect 가 flow 개체에 주입되지 않음(불변식 7)');

  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 8));
} finally {
  await s.close();
}
process.exitCode = A.summary('sc7-ai-roundtrip') ? 0 : 1;
