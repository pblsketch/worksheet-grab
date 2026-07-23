import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';
import { ValidateWorksheet, MIN_ANSWER_LEN } from '../../src/usecases/ValidateWorksheet.js';
import { BuildVariants, ANSWER_CLASSES } from '../../src/usecases/BuildVariants.js';
import { collectTextInside } from '../../src/usecases/html-scan.js';

// harness-reviewer-contract — S3.2(06_plan_final.md 182~184행): worksheet-reviewer 계약이
// "구조 검증(1층) + 렌더 실측(2층)" 2층 게이트로 실제 동작함을 증명하는 하네스 계약 테스트다.
// Chrome 은 쓰지 않는다 — RenderObjectTree(BuildVariants.executeObjectTree 경유)의 순수 문자열
// 산출을 실측(grep) 대상으로 삼는다(.claude/agents/worksheet-reviewer.md 의 2층 규약과 동형).
//
//  1층(구조·결정적): ValidateObjectTree/ValidateWorksheet.execute(document) — 코드가 판정.
//  2층(렌더 실측): BuildVariants.executeObjectTree(document, assets) 로 student/teacher 를 얻고,
//    teacher 의 .answer/.plot-ans 내부 텍스트(=알려진 정답)가 student 렌더 문자열에 남아있는지 grep.
//    1층 구조 검증은 richtext(무손실 탈출구) 내부에 평문으로 박힌 정답까지는 잡지 못한다 — 그래서
//    2층 실측이 별도로 필요하다는 것이 이 파일의 핵심 주장이다.

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };

// MIN_ANSWER_LEN(짧은 숫자 오탐 방지 임계) 이상 — 실제 정답 누출 판정과 동일 기준을 쓴다.
const ANSWER_TEXT = '정답은전압과전류가서로비례한다는것이다';
assert.ok(ANSWER_TEXT.length >= MIN_ANSWER_LEN, '픽스처 정답 문자열은 최소 길이 이상이어야 함');

/** @param {string} richtextHtml — 평문 정답 누출 실수를 재현할 자유 텍스트 블록. */
function fixtureDocument(richtextHtml) {
  return {
    pagination: 'paginated',
    pages: [
      {
        flow: [
          { id: 'std1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] },
          { id: 'title1', type: 'title', placement: 'flow', text: '전압과 전류의 관계' },
          {
            id: 'q1', type: 'question', placement: 'flow', qtype: 'essay',
            prompt: '전압과 전류는 어떤 관계일까?',
            answerKey: { text: ANSWER_TEXT },
          },
          { id: 'r1', type: 'richtext', placement: 'flow', html: richtextHtml },
        ],
        float: [],
      },
    ],
  };
}

/** 2층 실측 헬퍼 — teacher 의 알려진 정답 문자열이 student 렌더에 남는지 grep(BuildVariants 산출 실측). */
function leakedAnswerStrings(document) {
  const { student, teacher } = new BuildVariants().executeObjectTree(document, ASSETS);
  const knownAnswers = collectTextInside(teacher, ANSWER_CLASSES).filter((t) => t.length >= MIN_ANSWER_LEN);
  return knownAnswers.filter((a) => student.includes(a));
}

// ── (b) 정상 픽스처: 1층·2층 모두 PASS ──────────────────────────────────────

test('정상 픽스처: 1층(ValidateObjectTree) 구조 검증 PASS', () => {
  const doc = fixtureDocument('<p>자유 서술 활동입니다.</p>');
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, true, JSON.stringify(findings));
});

test('정상 픽스처: 1층(ValidateWorksheet.execute(document)) 구조 검증 PASS', () => {
  const doc = fixtureDocument('<p>자유 서술 활동입니다.</p>');
  const { ok } = new ValidateWorksheet().execute(doc);
  assert.equal(ok, true);
});

test('정상 픽스처: 2층 렌더 실측 — student 렌더에 정답 문자열이 남지 않는다', () => {
  const doc = fixtureDocument('<p>자유 서술 활동입니다.</p>');
  const leaked = leakedAnswerStrings(doc);
  assert.deepEqual(leaked, [], 'student 렌더에 정답 문자열이 남으면 안 됨(PASS 재료)');
});

// ── (a) 누출 픽스처: 1층은 통과하지만 2층 실측이 FAIL 판정 재료를 산출 ─────────

test('누출 픽스처: richtext 안 평문 정답은 1층 구조 검증을 통과한다(richtext 는 자유 탈출구)', () => {
  const doc = fixtureDocument(`<p>힌트: ${ANSWER_TEXT}</p>`);
  const { ok, findings } = new ValidateObjectTree().execute(doc);
  assert.equal(ok, true, '평문 정답 삽입 자체는 카탈로그/슬롯 규칙 위반이 아니므로 1층은 못 잡는다: ' + JSON.stringify(findings));
});

test('누출 픽스처: 2층 렌더 실측이 student 렌더의 정답 문자열 잔존을 FAIL 재료로 산출한다', () => {
  const doc = fixtureDocument(`<p>힌트: ${ANSWER_TEXT}</p>`);
  const leaked = leakedAnswerStrings(doc);
  assert.ok(
    leaked.includes(ANSWER_TEXT),
    '2층 실측(BuildVariants.executeObjectTree 산출 grep)이 student 렌더에 남은 정답 문자열을 잡아내야 함',
  );
});

test('누출 픽스처: teacher 렌더는 정답을 정상 포함한다(대조군 — student 만 문제)', () => {
  const doc = fixtureDocument(`<p>힌트: ${ANSWER_TEXT}</p>`);
  const { teacher } = new BuildVariants().executeObjectTree(doc, ASSETS);
  assert.ok(teacher.includes(ANSWER_TEXT), 'teacher 는 정답을 포함해야 정상');
});
