import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';

// harness-designer-contract — US-10(S3.1, 06_plan_final.md 178~180행) 수용 기준.
// .claude/agents/worksheet-designer.md + .claude/skills/worksheet-design/ 가 개정 선언한
// "AI 는 개체 트리 JSON(pagination:'scaffold')을 산출하고, 좌표(rect)는 만들지 않으며(교사 편집 전용
// float 은 생성 금지), 성취기준(std-box) 원문은 창작하지 않는다"는 계약이 실제로 ValidateObjectTree 를
// 통과하는 샘플 픽스처로 성립함을 단정한다(문항·표·답란·std-box 포함). 저작권 지문(passage-slot)은
// 3층 정책(2026-07-23 2차 델타)으로 "사용자가 명시 요청하지 않은 일반 조립에서는 기본이 빈 슬롯"이라는
// 조건부 계약으로 바뀌었다 — 아래 passage-slot 전용 테스트가 그 기본값(디폴트 산출은 여전히 비어
// 있음)을 단정한다. 문서 산출·경계 계산 자체(S3.5 페이지네이션 패스)는 이 테스트 범위 밖이다.

function designerScaffoldFixture() {
  return {
    pagination: 'scaffold',
    docTitle: '전압과 전류 탐구',
    themeName: 'teal',
    pages: [
      {
        flow: [
          { id: 'std1', type: 'std-box', placement: 'flow', codes: ['[9과14-02]'] },
          {
            id: 'title1', type: 'title', placement: 'flow', text: '전압과 전류의 관계',
            level: 1, meta: { pill: '2단원 3차시' },
          },
          { id: 'pas1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
          {
            id: 'q1', type: 'question', placement: 'flow', qtype: 'essay',
            prompt: '전압과 전류는 어떤 관계일까?',
            answerKey: { text: '전압이 커지면 전류도 커진다(옴의 법칙).', html: '<p>전압이 커지면 전류도 커진다(옴의 법칙).</p>' },
          },
          {
            id: 'q2', type: 'question', placement: 'flow', qtype: 'multiple-choice',
            prompt: '옴의 법칙 공식은?',
            choices: [{ id: 'a', text: 'V=IR' }, { id: 'b', text: 'V=I/R' }],
            answer: true,
          },
          {
            id: 'tb1', type: 'table', placement: 'flow', splittable: false, caption: '측정 결과',
            rows: [[{ text: '전압(V)', header: true }, { text: '전류(A)', header: true }]],
          },
          { id: 'ans1', type: 'answer-area', placement: 'flow', style: 'line', lines: 3 },
          { id: 'img1', type: 'image-slot', placement: 'flow', src: 'assets/circuit.png', alt: '회로도' },
          { id: 'div1', type: 'divider', placement: 'flow' },
          { id: 'rt1', type: 'richtext', placement: 'flow', html: '<p>$ R=\\dfrac{V}{I} $</p>', sourceType: 'formula' },
        ],
        float: [],
      },
    ],
  };
}

test('worksheet-designer 계약 픽스처(문항·표·답란·std-box 포함)는 ValidateObjectTree PASS', () => {
  const { ok, findings } = new ValidateObjectTree().execute(designerScaffoldFixture());
  assert.equal(ok, true, JSON.stringify(findings));
});

test('worksheet-designer 산출은 pagination:scaffold 단일 페이지(경계는 S3.5 페이지네이션 패스 몫)', () => {
  const doc = designerScaffoldFixture();
  assert.equal(doc.pagination, 'scaffold');
  assert.equal(doc.pages.length, 1);
});

test('AI 저작 개체는 좌표(rect)를 갖지 않는다 — 전량 placement:flow, float 개체는 스스로 만들지 않음', () => {
  const doc = designerScaffoldFixture();
  const allFlow = doc.pages.flatMap((p) => p.flow);
  assert.ok(allFlow.length > 0);
  for (const obj of allFlow) {
    assert.equal(obj.placement, 'flow', `${obj.id} 는 placement:'flow' 여야 함`);
    assert.equal(Object.prototype.hasOwnProperty.call(obj, 'rect'), false, `${obj.id} 는 rect(좌표)를 가질 수 없음(원칙 3)`);
  }
  assert.equal(doc.pages[0].float.length, 0, '디자이너(AI)는 float 개체를 스스로 생성하지 않는다(교사 편집 전용, M4)');
});

test('std-box 는 codes 참조만 담는다 — 성취기준 원문 창작 필드가 없다(슬롯 불변)', () => {
  const doc = designerScaffoldFixture();
  const std = doc.pages[0].flow.find((o) => o.type === 'std-box');
  assert.ok(std);
  assert.deepEqual(Object.keys(std).sort(), ['codes', 'id', 'placement', 'type']);
  assert.ok(Array.isArray(std.codes) && std.codes.length > 0);
});

test('passage-slot 기본값(3층 정책, 2026-07-23 2차 델타): 사용자가 지문 생성을 명시 요청하지 않은 일반 조립에서는 slotLabel 안내만 담는다 — bodyHtml 을 창작해 채우지 않는다', () => {
  const doc = designerScaffoldFixture();
  const passage = doc.pages[0].flow.find((o) => o.type === 'passage-slot');
  assert.ok(passage);
  assert.equal(typeof passage.slotLabel, 'string');
  assert.equal(passage.bodyHtml, undefined, '명시 요청이 없으면(이 픽스처처럼) 기본은 빈 슬롯이어야 함 — bodyHtml 창작은 사용자 명시 요청 시에만 허용');
});

test('answer:true 는 title/question/table/richtext 4종에만 실린다(정답 위치 규칙)', () => {
  const doc = designerScaffoldFixture();
  const answerable = doc.pages[0].flow.filter((o) => o.answer === true);
  assert.ok(answerable.length > 0);
  for (const obj of answerable) {
    assert.ok(['title', 'question', 'table', 'richtext'].includes(obj.type), `${obj.id}(${obj.type}) 는 answer:true 를 실을 수 없는 타입`);
  }
});
