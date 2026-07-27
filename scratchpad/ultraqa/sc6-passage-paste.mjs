// 시나리오 6 — 지문 붙여넣기(긴 본문·특수문자·의사 HTML) + 저장 왕복(실 CDP insertText — IME/붙여넣기 경로 근사).
// 실행: node scratchpad/ultraqa/sc6-passage-paste.mjs
import { launchQa, assertLog, sleep } from './harness.mjs';

function fixture() {
  return {
    pagination: 'paginated', docTitle: '지문붙여넣기', lang: 'ko', standards: [], paper: null,
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '지문 테스트' },
        { id: 'ps1', type: 'passage-slot', placement: 'flow', slotLabel: '읽기 지문' },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '지문을 읽고 답하시오.', qnum: 1 },
      ],
      float: [],
    }],
  };
}

// 긴 본문(3문단 × 반복) + 특수문자 지뢰밭
const SPECIALS = `특수문자: & < > " ' \` &amp; &lt;b&gt; 〈꺾쇠〉 «guillemet» — – … ₩12,345 100% #태그 @멘션 😀🎓 ㄱㄴㄷ 각`;
const PSEUDO_HTML = `<script>alert('주입')</script> <img src=x onerror=alert(1)> <div class="answer">가짜정답</div>`;
const PARA = '문해력은 글을 읽고 뜻을 이해하는 힘이다. 학생들은 지문을 반복해 읽으며 구조를 파악한다. ';
const LONG_BODY = (PARA.repeat(20) + '\n' + SPECIALS + '\n' + PSEUDO_HTML + '\n' + PARA.repeat(20)).trim();

const A = assertLog();
const s = await launchQa({ document: fixture(), docName: '지문문서' });
try {
  await s.navigate();

  // 더블클릭 → 편집 진입(슬롯 플레이스홀더 제거 확인 포함)
  const ps = await s.centerOf('[data-oid="ps1"]');
  await s.dblclick(ps.x, ps.y);
  const st0 = await s.objState('ps1');
  A.check(st0.editing === true, 'passage-slot 편집 진입');
  A.check(!st0.text.includes('삽입'), '플레이스홀더 안내 문구가 본문에서 제거됨');

  // 붙여넣기(대량 텍스트 일괄 삽입 — 실 붙여넣기와 동일한 insertText 경로)
  await s.insertText(LONG_BODY);
  await sleep(1200); // input 반영 + 리플로우
  await s.pressKey('Escape');
  await sleep(800);

  // 저장 → 서버 왕복
  await s.pressKey('s', { modifiers: 2 });
  await sleep(1800);
  const shell = await s.shellJson();
  const ps1 = shell.document.pages.flatMap((p) => p.flow || []).find((o) => o.id === 'ps1');
  A.check(!!ps1 && typeof ps1.bodyHtml === 'string', '저장 문서에 bodyHtml 존재');

  const body = ps1?.bodyHtml || '';
  A.check(body.includes('문해력은 글을 읽고'), '긴 본문 보존');
  A.check(body.includes('〈꺾쇠〉') && body.includes('😀🎓'), '특수문자·이모지 보존');
  // 의사 HTML 은 "텍스트"로 들어가야 함 — 실행 가능한 script 태그가 그대로 실리면 안 됨
  A.check(!/<script>/i.test(body), '붙여넣은 <script> 가 실행 가능한 태그로 저장되지 않음(이스케이프됨)');
  A.check(body.includes('&lt;script&gt;') || body.includes('alert('.slice(0, 6)) === false || body.includes('&lt;'), '의사 HTML 이 텍스트로 이스케이프됨');
  A.check(!/<img[^>]+onerror/i.test(body), 'onerror 핸들러가 태그로 실리지 않음');
  // class=answer 의사 마크업도 태그가 아닌 텍스트여야 함(누출 방어와 무관해야 정상)
  A.check(!/<div class="answer">/.test(body), 'class=answer 의사 마크업이 태그로 실리지 않음');

  // 본문 길이(대량 유실 없음) — 원문 텍스트 길이의 90% 이상 보존(공백 정규화 감안)
  const textLen = body.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, 'x').length;
  A.check(textLen > LONG_BODY.length * 0.9, `본문 길이 보존(${textLen}/${LONG_BODY.length})`);

  // 리플로우로 페이지 확장 여부(참고)
  console.log('[pages]', shell.document.pages.length);

  // 재열기(새 셸 요청) 후에도 동일 — 서버 저장 확정 검증
  const shell2 = await s.shellJson();
  const ps1b = shell2.document.pages.flatMap((p) => p.flow || []).find((o) => o.id === 'ps1');
  A.check(ps1b?.bodyHtml === body, '재열기 왕복 무손실(bodyHtml 동일)');

  // 출처 미기재 advisory(passage-source-missing)가 게이트 비차단인지 — warnings 에 error 아님
  const srcWarn = (shell.warnings || []).find((w) => String(w.rule || '').includes('passage-source'));
  A.check(!srcWarn || srcWarn.severity !== 'error', '출처 미기재는 advisory(비차단)');

  A.check(s.consoleErrors.length === 0, `콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
  if (s.consoleErrors.length) console.log('[consoleErrors]', s.consoleErrors.slice(0, 5));
} finally {
  await s.close();
}
process.exitCode = A.summary('sc6-passage-paste') ? 0 : 1;
