import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('CSV 경로 설정: 생성자 csvPath > GEPAI_CSV 환경변수 > 기본 경로', async () => {
  const { resolveCsvPath, DEFAULT_CSV_PATH } = await import('../../src/adapters/GepaiCurriculum.js');
  const prev = process.env.GEPAI_CSV;
  try {
    delete process.env.GEPAI_CSV;
    assert.equal(resolveCsvPath(null), DEFAULT_CSV_PATH);
    process.env.GEPAI_CSV = 'X:/custom/standards.csv';
    assert.equal(resolveCsvPath(null), 'X:/custom/standards.csv');
    assert.equal(resolveCsvPath('Y:/explicit.csv'), 'Y:/explicit.csv', '명시 경로가 환경변수보다 우선');
  } finally {
    if (prev === undefined) delete process.env.GEPAI_CSV; else process.env.GEPAI_CSV = prev;
  }
});

test('search 다단어 키워드: 토큰 분해 + 특이도(매칭 토큰 총 길이) 랭킹', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-cur-'));
  const csv = join(dir, 'std.csv');
  await writeFile(csv, [
    '학교,과목,학년,성취기준 코드,성취기준 내용',
    '중학교,과학,중2,[9과00-01],빛의 작용을 설명한다',            // "작용"(2)만
    '중학교,과학,중2,[9과00-02],광합성 산물을 설명한다',          // "광합성"(3)만
    '중학교,과학,중2,[9과00-03],광합성 작용의 원리를 설명한다',   // 양토큰(5)
    '중학교,과학,중2,[9과00-04],소화 과정을 설명한다',            // 무관 — 제외
    '',
  ].join('\n'), 'utf8');
  const cur = new GepaiCurriculum({ csvPath: csv });
  const r = await cur.search({ subject: '과학', keyword: '광합성 작용', limit: 10 });
  assert.deepEqual(
    r.map((s) => s.code),
    ['[9과00-03]', '[9과00-02]', '[9과00-01]'],
    '전 토큰 일치 > 긴 토큰(광합성) > 짧은 토큰(작용), 무관 행 제외',
  );
  // 단일 키워드 동작 불변: 구문 전체 부분일치만
  const single = await cur.search({ subject: '과학', keyword: '광합성', limit: 10 });
  assert.deepEqual(single.map((s) => s.code), ['[9과00-02]', '[9과00-03]']);
});

test('CSV 미존재 시 search 는 "0건"이 아니라 경로 안내 오류를 낸다', async () => {
  const cur = new GepaiCurriculum({ csvPath: 'Z:/no/such/standards.csv' });
  await assert.rejects(
    () => cur.search({ subject: '과학', keyword: '광합성' }),
    /성취기준 CSV 를 찾을 수 없습니다[\s\S]*GEPAI_CSV/,
  );
});
