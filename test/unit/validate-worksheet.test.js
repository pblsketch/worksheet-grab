import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidateWorksheet } from '../../src/usecases/ValidateWorksheet.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (name) => resolve(HERE, '../fixtures', name);

test('수용기준 3: 정답 누출(.answer 밖 정답 텍스트)을 FAIL 로 탐지', async () => {
  const html = await readFile(fx('leak-student.html'), 'utf8');
  const { ok, findings } = new ValidateWorksheet().execute(html);
  assert.equal(ok, false, '정답 누출은 FAIL 이어야 함');
  assert.ok(findings.some((f) => f.rule === 'answer-leak' && f.severity === 'error'));
});

test('정답이 .answer 안에만 있으면 PASS(오탐 없음)', async () => {
  const html = await readFile(fx('clean-student.html'), 'utf8');
  const { ok, findings } = new ValidateWorksheet().execute(html);
  assert.equal(ok, true);
  assert.ok(!findings.some((f) => f.rule === 'answer-leak'));
});

test('수용기준 4: 하드코딩 교과색(#7cb342)을 범교과 위반으로 경고', () => {
  const hardcoded = `<style>.pill{background:#7cb342}</style><body><div class="pill">국어</div></body>`;
  const v = new ValidateWorksheet({ knownSubjectHexes: ['#7cb342', '#00838f'] });
  const { findings } = v.execute(hardcoded);
  assert.ok(
    findings.some((f) => f.rule === 'hardcoded-subject-color' && f.evidence === '#7cb342'),
    '하드코딩 교과색 경고가 있어야 함',
  );
});

test('테마 var + :root 정의는 하드코딩으로 보지 않는다(오탐 방지)', () => {
  const themed = `<style>:root{--c:#7cb342}\n.pill{background:var(--c)}\n/* 참고: #7cb342 는 국어색 */</style><body><div class="pill">국어</div></body>`;
  const v = new ValidateWorksheet({ knownSubjectHexes: ['#7cb342'] });
  const { findings } = v.execute(themed);
  assert.ok(!findings.some((f) => f.rule === 'hardcoded-subject-color'), ':root/주석/var 는 위반이 아님');
});

test('unfilled-slot: ［…슬롯］ 마커 잔존 시 warning(스캐폴드 상태 안내)', () => {
  const html = '<div class="qbox">［탐구 문제 슬롯］ 이 단원의 핵심 탐구 질문</div><p>［교사 예시 답안 슬롯］</p>';
  const { ok, findings } = new ValidateWorksheet().execute(html);
  const f = findings.find((x) => x.rule === 'unfilled-slot');
  assert.ok(f, 'unfilled-slot 경고 존재');
  assert.equal(f.severity, 'warning');
  assert.match(f.message, /2개/);
  assert.equal(ok, true, '경고는 게이트를 막지 않는다(fail 은 아님)');
});

test('unfilled-slot: 슬롯이 모두 채워지면 경고 없음', () => {
  const html = '<div class="qbox">빛의 세기에 따라 광합성량은 어떻게 달라질까?</div>';
  const { findings } = new ValidateWorksheet().execute(html);
  assert.ok(!findings.some((x) => x.rule === 'unfilled-slot'));
});

test('F5: 원격 이미지(http/https src)는 warning 으로 발화(fail-closed 아님)', () => {
  const html = '<p><img src="https://example.com/photo.png" alt="사진"></p>';
  const { ok, findings } = new ValidateWorksheet().execute(html);
  const f = findings.find((x) => x.rule === 'remote-image');
  assert.ok(f, 'remote-image 경고 존재');
  assert.equal(f.severity, 'warning');
  assert.equal(f.evidence, 'https://example.com/photo.png');
  assert.equal(ok, true, '경고는 게이트를 막지 않는다(error 아님)');
});

test('F5: 로컬 assets/ 상대경로 이미지는 통과(오탐 없음)', () => {
  const html = '<p><img src="assets/photo.png" alt="사진" style="width:60mm"></p>';
  const { findings } = new ValidateWorksheet().execute(html);
  assert.ok(!findings.some((x) => x.rule === 'remote-image'));
});

test('F5: data: URI 이미지는 통과(오탐 없음)', () => {
  const html = '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="사진"></p>';
  const { findings } = new ValidateWorksheet().execute(html);
  assert.ok(!findings.some((x) => x.rule === 'remote-image'));
});

test('team-fix: alt 부재/빈값 <img> 는 img-alt warning, alt 채우면 통과(접근성)', () => {
  const missing = '<body><img src="assets/a.png" style="width:60mm"><img src="assets/b.png" alt=""></body>';
  const { ok, findings } = new ValidateWorksheet().execute(missing);
  const f = findings.find((x) => x.rule === 'img-alt');
  assert.ok(f && f.severity === 'warning', 'alt 부재/빈값 경고');
  assert.equal(ok, true, '경고는 게이트를 막지 않는다(error 아님)');

  const withAlt = '<body><img src="assets/a.png" alt="광합성 도해" style="width:60mm"></body>';
  const { findings: f2 } = new ValidateWorksheet().execute(withAlt);
  assert.ok(!f2.some((x) => x.rule === 'img-alt'), 'alt 채우면 통과');
});

// ── S2.3: 개체 트리 경로(신설) ──────────────────────────────────────────────
// execute(document, renderedHtml?) — 1층 구조 검증(ValidateObjectTree 위임)·2층 렌더 실측(선택).
// baseDocument 는 test/unit/validate-object-tree.test.js 의 S1.2 수용 픽스처와 동일한 형태를 쓴다.

function baseDocument() {
  return {
    pagination: 'paginated',
    pages: [
      {
        id: 'page-main',
        flow: [
          { id: 'std1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] },
          { id: 'title1', type: 'title', placement: 'flow', text: '전압과 전류의 관계' },
          { id: 'pas1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
          { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압과 전류는 어떤 관계일까?' },
        ],
        float: [],
      },
    ],
  };
}

test('개체 트리 경로: 정상 문서는 PASS(구조 검증만, renderedHtml 없이)', () => {
  const { ok, findings } = new ValidateWorksheet().execute(baseDocument());
  assert.equal(ok, true, JSON.stringify(findings));
});

test('개체 트리 경로: 구조 위반은 FAIL 이며 ValidateObjectTree 규칙이 그대로 위임된다', () => {
  const doc = baseDocument();
  doc.pages[0].flow.push({ id: 'bad1', type: 'sidebar', placement: 'flow', text: '강조박스' });
  const { ok, findings } = new ValidateWorksheet().execute(doc);
  assert.equal(ok, false, '닫힌 카탈로그 밖 타입은 구조 위반으로 FAIL 이어야 함');
  const f = findings.find((x) => x.rule === 'unknown-type');
  assert.ok(f, 'ValidateObjectTree 의 unknown-type 규칙이 위임되어야 함');
  assert.equal(f.severity, 'error', '구조 위반은 error(게이트 차단)로 승격되어야 함');
});

test('개체 트리 경로: 슬롯 변조(std-box 원문 창작 주입)도 구조 위반 FAIL 로 위임된다', () => {
  const doc = baseDocument();
  doc.pages[0].flow[0] = { ...doc.pages[0].flow[0], text: '(AI가 창작한) 전압과 전류는 비례한다' };
  const { ok, findings } = new ValidateWorksheet().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((x) => x.rule === 'slot-invariant' && x.severity === 'error'));
});

test('개체 트리 경로: renderedHtml 이 함께 주어지면 2층 인쇄 안전 warning 이 유지된다(게이트는 막지 않음)', () => {
  const doc = baseDocument();
  const narrowMarginHtml = '<style>.sheet{padding:2mm;}</style><body><p>본문</p></body>';
  const { ok, findings } = new ValidateWorksheet({ minMarginMm: 8 }).execute(doc, narrowMarginHtml);
  assert.equal(ok, true, '구조는 정상이고 인쇄 안전은 warning 이므로 게이트를 막지 않아야 함');
  const f = findings.find((x) => x.rule === 'print-margin');
  assert.ok(f, '2층 렌더 실측에서 print-margin warning 이 나와야 함');
  assert.equal(f.severity, 'warning');
});

test('개체 트리 경로: renderedHtml 의 정답 누출(2층)은 구조가 정상이어도 게이트를 FAIL 시킨다', () => {
  const doc = baseDocument();
  const leakHtml = '<div class="answer">전압과 전류는 비례관계이다(정답)</div><p>전압과 전류는 비례관계이다(정답)</p>';
  const { ok, findings } = new ValidateWorksheet().execute(doc, leakHtml);
  assert.equal(ok, false, '2층 누출 grep 도 error 게이트로 유지되어야 함');
  assert.ok(findings.some((x) => x.rule === 'answer-leak' && x.severity === 'error'));
});

test('개체 트리 경로: passage-slot advisory(출처 미기재)는 warning 으로 위임되고 게이트를 막지 않는다', () => {
  const doc = baseDocument();
  doc.pages[0].flow = doc.pages[0].flow.map((o) => (
    o.id === 'pas1' ? { ...o, bodyHtml: '교사가 직접 입력한 지문 본문입니다.' } : o
  ));
  const { ok, findings } = new ValidateWorksheet().execute(doc);
  assert.equal(ok, true, 'advisory 는 게이트를 막지 않아야 함: ' + JSON.stringify(findings));
  const f = findings.find((x) => x.rule === 'passage-source-missing');
  assert.ok(f, 'ValidateObjectTree 의 passage-source-missing advisory 가 위임되어야 함');
  assert.equal(f.severity, 'warning', 'advisory 는 error 로 승격되면 안 됨');
});

test('개체 트리 경로: 문자열도 객체도 아닌 입력은 TypeError', () => {
  assert.throws(() => new ValidateWorksheet().execute(42), TypeError);
  assert.throws(() => new ValidateWorksheet().execute(null), TypeError);
});
