import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';

// S1.2 수용 기준(06_plan_final.md 136행): 정상 PASS + 위반 4계열(미지정 타입/슬롯 변조/
// AI 좌표/표 분할 지정) 각각 FAIL.

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
          { id: 'tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: '1' }]] },
        ],
        float: [
          { id: 'mem1', type: 'answer-area', placement: 'float', rect: { xMm: 10, yMm: 10, wMm: 30, hMm: 10 }, style: 'box' },
        ],
      },
    ],
  };
}

test('정상 문서는 PASS', () => {
  const { ok, findings } = new ValidateObjectTree().execute(baseDocument());
  assert.equal(ok, true, JSON.stringify(findings));
});

test('FAIL 1/4: 미지정 타입(닫힌 카탈로그 밖)', () => {
  const doc = baseDocument();
  doc.pages[0].flow.push({ id: 'bad1', type: 'callout', placement: 'flow', text: '강조박스' });
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'unknown-type'));
});

test('FAIL 2/4: 슬롯 변조(std-box 에 성취기준 원문을 창작해 주입 시도)', () => {
  const doc = baseDocument();
  doc.pages[0].flow[0] = { ...doc.pages[0].flow[0], text: '(AI가 창작한) 전압과 전류는 비례한다' };
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'slot-invariant'));
});

test('FAIL 3/4: AI 좌표 생성(placement:flow 인데 rect 존재)', () => {
  const doc = baseDocument();
  doc.pages[0].flow.push({
    id: 'q9', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: 'AI 가 생성한 질문',
    rect: { xMm: 5, yMm: 5, wMm: 10, hMm: 10 },
  });
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'rect-forbidden-in-flow'));
});

test('FAIL 4/4: 표 분할 지정(splittable:true)', () => {
  const doc = baseDocument();
  doc.pages[0].flow.push({ id: 'tb2', type: 'table', placement: 'flow', splittable: true, rows: [[{ text: '1' }]] });
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'table-splittable-violation'));
});

test('flow/float 정합: float 버킷에 placement:flow 개체가 담기면 FAIL(bucket-placement-mismatch)', () => {
  const doc = baseDocument();
  doc.pages[0].float.push({ id: 'mismatch1', type: 'divider', placement: 'flow' });
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'bucket-placement-mismatch'));
});

test('pagination 상태값이 scaffold|paginated 밖이면 FAIL(invalid-pagination-state)', () => {
  const doc = baseDocument();
  doc.pagination = 'draft';
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, false);
  assert.ok(findings.some((f) => f.rule === 'invalid-pagination-state'));
});

test('pagination:scaffold 문서 자체는 구조적으로 유효(export 거부는 별개 계약, checkExportGate 몫)', () => {
  const doc = baseDocument();
  doc.pagination = 'scaffold';
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, true, JSON.stringify(findings));
});

// ── advisory(2층 정책, 2026-07-23): 저작권 지문 본문이 있는데 출처가 없으면 warning(게이트 비차단) ──

test('advisory: passage-slot 본문(bodyHtml) 있고 출처(source) 없으면 warning — ok 는 여전히 true(게이트 비차단)', () => {
  const doc = baseDocument();
  doc.pages[0].flow = doc.pages[0].flow.map((o) => (
    o.id === 'pas1' ? { ...o, bodyHtml: '교사가 직접 입력한 지문 본문입니다.' } : o
  ));
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, true, 'advisory 는 게이트를 막지 않아야 함: ' + JSON.stringify(findings));
  const f = findings.find((x) => x.rule === 'passage-source-missing');
  assert.ok(f, 'passage-source-missing advisory 가 있어야 함');
  assert.equal(f.severity, 'warning');
  assert.equal(f.objectId, 'pas1');
});

test('advisory: 출처(source)까지 채우면 passage-source-missing 이 사라진다', () => {
  const doc = baseDocument();
  doc.pages[0].flow = doc.pages[0].flow.map((o) => (
    o.id === 'pas1' ? { ...o, bodyHtml: '본문', source: '국립국어원(2024)' } : o
  ));
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, true);
  assert.ok(!findings.some((x) => x.rule === 'passage-source-missing'));
});

test('advisory: 본문이 비어 있으면(슬롯 상태) 출처 누락을 경고하지 않는다(오탐 방지)', () => {
  const doc = baseDocument();
  const { findings } = new ValidateObjectTree().execute(doc);
  assert.ok(!findings.some((x) => x.rule === 'passage-source-missing'));
});
