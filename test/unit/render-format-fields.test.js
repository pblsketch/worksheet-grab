import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { validateObjectShape } from '../../src/domain/schema/validateObjectShape.js';

// 문항/제목 인라인 서식(굵게/기울임) — 하위호환 서식 보존 필드(title.textHtml·question.promptHtml).
// 있으면 렌더가 이스케이프 없이 그대로 방출(richtext.html 관례), 없으면 평문을 이스케이프(하위호환).
// 스키마(validateObjectShape)는 두 옵션 필드를 허용해야 한다(그래야 편집기 저장이 통과).

const ASSETS = Object.freeze({ paperCss: '', blocksCss: '', themeCss: '' });

function renderOne(obj) {
  const doc = { pagination: 'scaffold', pages: [{ flow: [obj], float: [] }] };
  return new RenderObjectTree().execute(doc, ASSETS, {}, { editMode: false }).html;
}

test('renderTitle: textHtml 있으면 그대로 방출, 없으면 평문 이스케이프(폴백)', () => {
  const withHtml = renderOne({ id: 't1', type: 'title', placement: 'flow', text: '굵은 제목', textHtml: '굵은 <b>제목</b>' });
  assert.ok(withHtml.includes('굵은 <b>제목</b>'), 'textHtml 을 이스케이프 없이 방출');

  const fallback = renderOne({ id: 't2', type: 'title', placement: 'flow', text: 'A & B < C' });
  assert.ok(fallback.includes('A &amp; B &lt; C'), 'textHtml 없으면 평문 이스케이프');
  assert.ok(!fallback.includes('A & B < C'), '원문 특수문자가 날것으로 새지 않음');
});

test('renderQuestion: promptHtml 있으면 그대로 방출(qnum 별도), 없으면 평문 이스케이프(폴백)', () => {
  const withHtml = renderOne({ id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '기운 발문', qnum: 1, promptHtml: '기운 <i>발문</i>' });
  assert.ok(withHtml.includes('기운 <i>발문</i>'), 'promptHtml 을 이스케이프 없이 방출');
  assert.ok(withHtml.includes('class="qnum"'), 'qnum 배지는 여전히 별도로 렌더');

  const fallback = renderOne({ id: 'q2', type: 'question', placement: 'flow', qtype: 'essay', prompt: '3 < 5 이면?', qnum: 2 });
  assert.ok(fallback.includes('3 &lt; 5 이면?'), 'promptHtml 없으면 평문 이스케이프');
});

test('스키마: title.textHtml·question.promptHtml 는 허용 필드(저장 통과)', () => {
  const title = validateObjectShape({ id: 't1', type: 'title', placement: 'flow', text: '제목', textHtml: '<b>제목</b>' });
  assert.equal(title.ok, true, 'title.textHtml 허용');

  const q = validateObjectShape({ id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '발문', promptHtml: '<i>발문</i>' });
  assert.equal(q.ok, true, 'question.promptHtml 허용');

  // 대조: 여전히 카탈로그 밖 필드는 거부(불변식 유지)
  const bad = validateObjectShape({ id: 't2', type: 'title', placement: 'flow', text: '제목', bogusField: 1 });
  assert.equal(bad.ok, false, '카탈로그 밖 필드는 여전히 거부');
});
