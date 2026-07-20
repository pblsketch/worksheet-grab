import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseCsv, normalizeCode, GepaiCurriculum, DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';

test('normalizeCode: 대괄호 유무 무관하게 [코드] 정규화', () => {
  assert.equal(normalizeCode('9과14-02'), '[9과14-02]');
  assert.equal(normalizeCode('[9과14-02]'), '[9과14-02]');
});

test('parseCsv: 따옴표 안 콤마·개행 처리', () => {
  const rows = parseCsv('a,b\n"x,1","y\n2"\n');
  assert.deepEqual(rows[0], ['a', 'b']);
  assert.deepEqual(rows[1], ['x,1', 'y\n2']);
});

test('MCP 실패 시 CSV 폴백(포트 계약)', async () => {
  const failingMcp = { async resolve() { throw new Error('No such tool'); } };
  const cur = new GepaiCurriculum({ mcpClient: failingMcp });
  // CSV 가 있으면 폴백 성공, 없으면 null (둘 다 예외 없이 동작해야 함)
  const r = await cur.resolve('[9과14-02]');
  if (existsSync(DEFAULT_CSV_PATH)) {
    assert.ok(r && /전기 회로/.test(r.text), 'CSV 폴백으로 원문 조회');
  } else {
    assert.equal(r, null);
  }
});

test('CSV 어댑터: 성취기준 원문 조회(파일 있을 때만)', { skip: !existsSync(DEFAULT_CSV_PATH) }, async () => {
  const cur = new GepaiCurriculum({});
  for (const code of ['[9과14-02]', '[12독작01-01]', '[12독작01-14]']) {
    const r = await cur.resolve(code);
    assert.ok(r && r.text.length > 5, `${code} 원문 조회`);
  }
});

test('G1: search 로 중2 과학 광합성 성취기준을 CSV에서 조회', { skip: !existsSync(DEFAULT_CSV_PATH) }, async () => {
  const cur = new GepaiCurriculum({});
  const r = await cur.search({ school: '중학교', subject: '과학', keyword: '광합성', limit: 10 });
  const codes = r.map((s) => s.code);
  assert.ok(codes.includes('[9과12-01]'), '광합성 핵심 성취기준 포함');
  assert.ok(r.length >= 3, '광합성 관련 3개 이상');
  assert.ok(r.every((s) => s.text.includes('광합성')), '모든 결과 원문에 키워드 포함');
});

test('G1: search 는 MCP 실패 시 CSV 폴백(포트 계약)', { skip: !existsSync(DEFAULT_CSV_PATH) }, async () => {
  const failingMcp = { async search() { throw new Error('No such tool'); } };
  const cur = new GepaiCurriculum({ mcpClient: failingMcp });
  const r = await cur.search({ school: '중학교', subject: '과학', keyword: '광합성' });
  assert.ok(r.length >= 1, 'MCP off 여도 CSV 로 검색 성공');
});
