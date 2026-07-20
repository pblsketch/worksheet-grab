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
