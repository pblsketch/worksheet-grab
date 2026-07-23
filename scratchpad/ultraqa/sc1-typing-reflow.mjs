// 시나리오 1 — 빠른 연속 타이핑 중 리플로우 경합(실 CDP 키보드).
// 공격: 페이지 경계 근처 richtext 를 편집하며 버스트 타이핑→300ms+ 휴지(리플로우 발화)→
// 재로드 창(iframe reload) 안에서 즉시 타이핑 재개. 문자 유실·편집 상태 파괴·콘솔 에러를 실측.
// 실행: node scratchpad/ultraqa/sc1-typing-reflow.mjs
import { launchQa, assertLog, sleep } from './harness.mjs';

function fixture() {
  const flow = [{ id: 't1', type: 'title', placement: 'flow', text: '리플로우 경합 공격' }];
  for (let i = 1; i <= 8; i++) {
    flow.push({ id: `q${i}`, type: 'question', placement: 'flow', qtype: 'essay', prompt: `서술형 질문 ${i} — 페이지를 채우기 위한 본문입니다. 충분히 긴 프롬프트 텍스트.`, qnum: i });
    flow.push({ id: `a${i}`, type: 'answer-area', placement: 'flow', style: 'line', lines: 3 });
  }
  flow.push({ id: 'rt', type: 'richtext', placement: 'flow', html: '<p>타이핑 대상 문단.</p>' });
  return {
    pagination: 'paginated', docTitle: '리플로우경합', lang: 'ko',
    standards: [], paper: null,
    pages: [{ flow, float: [] }],
  };
}

const A = assertLog();
const s = await launchQa({ document: fixture(), docName: '경합문서' });
const evidence = { bursts: [], reloads: 0 };
try {
  await s.navigate();

  // iframe 재로드 감지 마커 — 현재 iframe contentWindow 에 플래그를 심는다.
  const plantMarker = () => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    f.contentWindow.__qaMarker = true; return true;
  })()`);
  const markerAlive = () => s.evalExpr(`(() => {
    const f = document.querySelector('#stage iframe:not(.hidden)');
    return f.contentWindow.__qaMarker === true;
  })()`);

  const rt = await s.centerOf('[data-oid="rt"]');
  await s.dblclick(rt.x, rt.y);
  A.check((await s.objState('rt')).editing === true, '공격 대상 richtext 편집 진입');
  await plantMarker();

  // 8 버스트: 각 버스트는 고유 토큰 5개(예: "B03x0 B03x1 …"), 버스트 사이 350~420ms 휴지로
  // 리플로우 발화를 유도하고, 휴지 직후 즉시 다음 버스트를 꽂는다(재로드 창 공격).
  const expectedTokens = [];
  for (let b = 0; b < 8; b++) {
    const tokens = Array.from({ length: 5 }, (_, k) => `B${String(b).padStart(2, '0')}x${k}`);
    expectedTokens.push(...tokens);
    await s.typeText(' ' + tokens.join(' '), { perCharMs: 8 });
    const st = await s.objState('rt');
    const reloaded = !(await markerAlive());
    if (reloaded) { evidence.reloads += 1; await plantMarker(); }
    const active = await s.evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      const ae = f.contentDocument.activeElement;
      return ae ? (ae.closest('[data-oid]')?.dataset.oid ?? ae.tagName) : null;
    })()`);
    evidence.bursts.push({ b, editing: st?.editing, reloaded, active,
      reflowRuns: await s.evalExpr(`document.body.dataset.reflowRuns || '0'`),
      reflowChanges: await s.evalExpr(`document.body.dataset.reflowChanges || '0'`) });
    await sleep(380 + (b % 3) * 40); // 리플로우 디바운스(300ms)를 넘겨 발화 유도
  }

  await sleep(1200); // 최종 리플로우 안정화
  await s.pressKey('Escape');

  const finalDoc = await s.evalExpr(`(() => {
    const core = window.__qaCore; return null; })()`).catch(() => null);
  // core 접근 훅이 없으므로 /shell.json 대신 저장 전 상태를 셸 재요청으로 얻을 수 없음 —
  // Ctrl+S 로 체크포인트 후 shell.json 으로 확정 문서를 읽는다.
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1500);
  const shell = await s.shellJson();
  const allHtml = JSON.stringify(shell.document);

  const missing = expectedTokens.filter((t) => !allHtml.includes(t));
  console.log('[evidence]', JSON.stringify(evidence, null, 1));
  console.log('[missing tokens]', missing.length ? missing : '(none)');
  A.check(evidence.bursts.some((x) => Number(x.reflowRuns) > 0), '리플로우가 실제로 발화함(공격 유효성)');
  A.check(missing.length === 0, `타이핑 문자 무손실(유실 토큰 ${missing.length}/${expectedTokens.length})`);
  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 5));

  // 페이지가 실제로 늘었는지(경계 넘김이 일어났는지) 참고 기록
  console.log('[pages]', shell.document.pages.length, '[reloads]', evidence.reloads);
  await s.screenshot('sc1-final.png');
} finally {
  await s.close();
}
process.exitCode = A.summary('sc1-typing-reflow') ? 0 : 1;
