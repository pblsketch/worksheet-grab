import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBatchList } from '../../src/usecases/batchList.js';

// T7a — batchList 파서(순수, 의존성 0). 합의 계획 §2(c): 배치는 CLI 저작 명령이 아니라
// 장부 등록 입력(JSON/JSONL/CSV)의 파싱만 담당. 마크다운 명시 거부·필수 필드 결손·
// 중복 행은 전부 fail-closed(조용한 스킵 금지, 행 번호 지목).

test('JSON 배열: 정상 파싱 + row 1-based 부여 + optional 필드 null 기본값', () => {
  const rows = parseBatchList(JSON.stringify([
    { subject: '과학', grade: '중2', topic: '광합성', standardCode: '[9과14-02]', title: '광합성 탐구' },
    { subject: '국어', grade: '중1', topic: '설명문 구조' },
  ]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    row: 1, subject: '과학', grade: '중2', topic: '광합성', standardCode: '[9과14-02]', title: '광합성 탐구',
  });
  assert.deepEqual(rows[1], {
    row: 2, subject: '국어', grade: '중1', topic: '설명문 구조', standardCode: null, title: null,
  });
});

test('JSON 배열: format 힌트 명시 지정도 동작', () => {
  const rows = parseBatchList(JSON.stringify([{ subject: '과학', grade: '중2', topic: '광합성' }]), 'json');
  assert.equal(rows.length, 1);
});

test('JSONL: 줄당 객체 파싱 + 빈 줄 무시 + row 순번은 데이터 행 기준', () => {
  const text = [
    '{"subject":"과학","grade":"중2","topic":"광합성"}',
    '',
    '{"subject":"과학","grade":"중2","topic":"소화"}',
    '   ',
    '{"subject":"국어","grade":"중1","topic":"설명문"}',
  ].join('\n');
  const rows = parseBatchList(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.row), [1, 2, 3]);
  assert.equal(rows[2].topic, '설명문');
});

test('JSONL: 객체가 아닌 줄(배열·스칼라)은 행 번호와 함께 error', () => {
  const text = '{"subject":"과학","grade":"중2","topic":"광합성"}\n[1,2,3]';
  assert.throws(() => parseBatchList(text), /JSONL 2행은 객체여야 합니다/);
});

test('CSV: 정상 파싱(한국어 헤더) + 따옴표·쉼표 이스케이프', () => {
  const csv = [
    '교과,학년,주제,성취기준 코드,제목',
    '과학,중2,"광합성, 세포호흡",[9과14-02],광합성 탐구',
    '국어,중1,"그는 ""설명문""이라 불렀다",,',
  ].join('\n');
  const rows = parseBatchList(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].topic, '광합성, 세포호흡');
  assert.equal(rows[0].standardCode, '[9과14-02]');
  assert.equal(rows[1].topic, '그는 "설명문"이라 불렀다');
  assert.equal(rows[1].standardCode, null);
  assert.equal(rows[1].title, null);
});

test('CSV: 영어 헤더(subject,grade,topic,standardCode,title)도 인식', () => {
  const csv = 'subject,grade,topic,standardCode,title\n과학,중2,광합성,[9과14-02],광합성 탐구';
  const rows = parseBatchList(csv, 'csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject, '과학');
});

test('CSV: 필수 열(subject/grade/topic) 결손 헤더는 명확한 error', () => {
  const csv = '교과,학년\n과학,중2';
  assert.throws(() => parseBatchList(csv), /CSV 헤더에 "topic" 열이 없습니다/);
});

test('필수 필드 결손 행: 조용히 스킵하지 않고 행 번호와 함께 error(JSON)', () => {
  const rows = [
    { subject: '과학', grade: '중2', topic: '광합성' },
    { subject: '', grade: '중1', topic: '설명문' }, // subject 결손
  ];
  assert.throws(() => parseBatchList(JSON.stringify(rows)), /batchList: 2행에 필수 필드가 없습니다\(subject\)/);
});

test('필수 필드 결손 행(topic 누락, JSONL)', () => {
  const text = '{"subject":"과학","grade":"중2"}';
  assert.throws(() => parseBatchList(text), /1행에 필수 필드가 없습니다\(topic\)/);
});

test('마크다운 표는 명시 거부', () => {
  const md = [
    '| 교과 | 학년 | 주제 |',
    '| --- | --- | --- |',
    '| 과학 | 중2 | 광합성 |',
  ].join('\n');
  assert.throws(() => parseBatchList(md), /마크다운은 지원하지 않습니다/);
});

test('마크다운 리스트는 명시 거부', () => {
  const md = [
    '- 과학 중2 광합성',
    '- 국어 중1 설명문',
    '- 수학 중3 함수',
  ].join('\n');
  assert.throws(() => parseBatchList(md), /마크다운은 지원하지 않습니다/);
});

test('중복 행(동일 topic+standardCode)은 두 행 번호를 지목해 거부', () => {
  const rows = [
    { subject: '과학', grade: '중2', topic: '광합성', standardCode: '[9과14-02]' },
    { subject: '과학', grade: '중3', topic: '광합성', standardCode: '[9과14-02]' },
  ];
  assert.throws(
    () => parseBatchList(JSON.stringify(rows)),
    /중복 행 — 1행과 2행이 동일한 topic\("광합성"\) \+ standardCode\("\[9과14-02\]"\) 조합입니다/,
  );
});

test('중복 행: standardCode 둘 다 없어도 topic 만으로 동일하면 중복', () => {
  const rows = [
    { subject: '과학', grade: '중2', topic: '광합성' },
    { subject: '과학', grade: '중3', topic: '광합성' },
  ];
  assert.throws(() => parseBatchList(JSON.stringify(rows)), /중복 행 — 1행과 2행/);
});

test('중복 아님: 동일 topic 이라도 standardCode 가 다르면 통과', () => {
  const rows = [
    { subject: '과학', grade: '중2', topic: '광합성', standardCode: '[9과14-02]' },
    { subject: '과학', grade: '중3', topic: '광합성', standardCode: '[9과15-01]' },
  ];
  const parsed = parseBatchList(JSON.stringify(rows));
  assert.equal(parsed.length, 2);
});

test('빈 입력은 error(조용한 무행 반환 금지)', () => {
  assert.throws(() => parseBatchList(''), /입력이 비어 있습니다/);
  assert.throws(() => parseBatchList('   \n\n  '), /입력이 비어 있습니다/);
});

test('BOM + CRLF 개행도 정상 파싱(JSON)', () => {
  const bom = '﻿';
  const text = bom + JSON.stringify([{ subject: '과학', grade: '중2', topic: '광합성' }]).replace(/\n/g, '\r\n');
  const rows = parseBatchList(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject, '과학');
});

test('BOM + CRLF 개행도 정상 파싱(CSV)', () => {
  const bom = '﻿';
  const csv = bom + ['교과,학년,주제', '과학,중2,광합성', '국어,중1,설명문'].join('\r\n');
  const rows = parseBatchList(csv, 'csv');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].topic, '광합성');
  assert.equal(rows[1].topic, '설명문');
});

test('지원하지 않는 형식 힌트는 error', () => {
  assert.throws(() => parseBatchList('[]', 'yaml'), /지원하지 않는 형식 힌트/);
});

test('JSON: 최상위가 배열이 아니면 error(format:"json" 명시 — 단일 객체는 auto 판별상 JSONL 로도 유효하므로 힌트로 고정)', () => {
  assert.throws(() => parseBatchList(JSON.stringify({ subject: '과학' }), 'json'), /최상위가 배열이어야 합니다/);
});

test('CSV 자동 판별: 헤더만 있고 데이터 행 없음 → 빈 배열(에러 아님, 유효한 0행)', () => {
  const rows = parseBatchList('교과,학년,주제');
  assert.deepEqual(rows, []);
});
