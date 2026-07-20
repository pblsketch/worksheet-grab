import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidateWorksheet } from '../../src/usecases/ValidateWorksheet.js';

const V = () => new ValidateWorksheet({});
const rules = (html) => V().execute(html).findings.map((f) => f.rule);

// 여백 -------------------------------------------------------------------
test('US-M5-3: print-margin — 과소 여백(3mm) 경고, 정상 여백(12mm) 통과', () => {
  const bad = '<style>.sheet { padding: 3mm 3mm 3mm 3mm; }</style><div class="sheet"></div>';
  const ok = '<style>.sheet { padding: 12mm 15mm 10mm 15mm; }</style><div class="sheet"></div>';
  assert.ok(rules(bad).includes('print-margin'), '3mm 여백은 경고');
  assert.ok(!rules(ok).includes('print-margin'), '12/15/10mm 여백은 통과');
});

// 최소 폰트 ---------------------------------------------------------------
test('US-M5-3: min-font — 6pt 경고, 9pt 통과', () => {
  const bad = '<style>.x { font-size: 6pt; }</style>';
  const ok = '<style>.x { font-size: 9pt; }</style>';
  assert.ok(rules(bad).includes('min-font'), '6pt 는 경고');
  assert.ok(!rules(ok).includes('min-font'), '9pt 는 통과');
});

// keep-together ----------------------------------------------------------
test('US-M5-3: keep-together — 다행 표 + keep 미지원이면 경고, 지원 시 통과', () => {
  const bigTable = '<table><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr><tr><td>4</td></tr></table>';
  const bad = `<style>.sheet{padding:12mm;}</style>${bigTable}`;
  const okKeep = `<style>.sheet{padding:12mm;} .keep{page-break-inside:avoid;}</style>${bigTable}`;
  const okWrap = `<style>.sheet{padding:12mm;}</style><div class="keep">${bigTable}</div>`;
  assert.ok(rules(bad).includes('keep-together'), 'keep 미지원 다행 표는 경고');
  assert.ok(!rules(okKeep).includes('keep-together'), 'page-break-inside:avoid 지원 시 통과');
  assert.ok(!rules(okWrap).includes('keep-together'), '.keep 래핑 시 통과');
});

test('US-M5-3: keep-together — 짧은 표(≤3행)는 경고하지 않음(오탐 방지)', () => {
  const small = '<style>.sheet{padding:12mm;}</style><table><tr><td>1</td></tr><tr><td>2</td></tr></table>';
  assert.ok(!rules(small).includes('keep-together'), '2행 표는 경고 아님');
});
