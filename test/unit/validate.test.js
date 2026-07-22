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
