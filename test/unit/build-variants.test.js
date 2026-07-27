import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';

const SAMPLE = `<body data-mode="MODE_TOKEN">
  <span class="answer">정답: 전압에 정비례한다</span>
  <g class="plot-ans"><circle/></g>
  <div class="q">질문</div>
</body>`;

test('수용기준 1: MODE_TOKEN 을 student/teacher 2벌로 치환', () => {
  const { student, teacher } = new BuildVariants().execute(SAMPLE);
  assert.ok(!student.includes('MODE_TOKEN'), 'student 에 MODE_TOKEN 잔존 금지');
  assert.ok(!teacher.includes('MODE_TOKEN'), 'teacher 에 MODE_TOKEN 잔존 금지');
  assert.match(student, /data-mode="student"/);
  assert.match(teacher, /data-mode="teacher"/);
});

test('student 벌은 .answer/.plot-ans 내용을 물리적으로 제거(정답 배제 불변식)', () => {
  const { student, teacher } = new BuildVariants().execute(SAMPLE);
  // teacher 는 정답 텍스트 유지
  assert.match(teacher, /정답: 전압에 정비례한다/);
  // student 는 정답 텍스트 제거(빈 래퍼만 유지)
  assert.ok(!student.includes('전압에 정비례한다'), 'student 에 정답 텍스트가 남으면 안 됨');
  assert.match(student, /<span class="answer"><\/span>/);
  assert.ok(!student.includes('<circle/>'), 'plot-ans 내부도 제거되어야 함');
  assert.match(student, /<div class="q">질문<\/div>/, '비정답 콘텐츠는 보존');
});

test('MODE_TOKEN 이 없으면 오류', () => {
  assert.throws(() => new BuildVariants().execute('<body></body>'), /MODE_TOKEN/);
});

// 누출 게이트 회귀(Codex 교차 QA): 정답 제거는 따옴표 없는 class·속성값 속 '>' 에도
// 견뎌야 한다 — 엔진측(manifest/블록) HTML 은 DOM 재직렬화를 거치지 않으므로
// 이런 형태가 그대로 학생용에 흘러 정답이 노출될 수 있다.
test('정답 제거: 따옴표 없는 class=answer 도 물리 제거된다', () => {
  const html = '<body data-mode="MODE_TOKEN"><span class=answer>비밀정답노출차단</span></body>';
  const { student } = new BuildVariants().execute(html);
  assert.ok(!student.includes('비밀정답노출차단'), '따옴표 없는 class 도 스트립되어야 한다');
});

test('정답 제거: 정답 앞 속성값에 >가 있어도 class=answer 를 놓치지 않는다', () => {
  const html = '<body data-mode="MODE_TOKEN"><span data-note="1>2" class="answer">부등호정답노출차단</span></body>';
  const { student } = new BuildVariants().execute(html);
  assert.ok(!student.includes('부등호정답노출차단'), '속성값 속 > 로 태그가 조기 절단되면 안 된다');
});

// void 요소(img·input 등)에 마크 클래스가 직접 붙으면 비울 "내용"이 없어 태그 자체가
// 정답 콘텐츠다 — 텍스트 기반 누출 탐지가 이미지를 못 보므로 태그를 통째 제거해야 한다(Codex 교차 QA).
test('정답 제거: <img class="answer"> 직접 마킹도 student 에서 태그째 물리 제거된다', () => {
  const html = '<body data-mode="MODE_TOKEN"><img class="answer" src="assets/정답샷.png" alt="정답"><p>본문</p></body>';
  const { student, teacher } = new BuildVariants().execute(html);
  assert.ok(!student.includes('assets/정답샷.png'), 'student 에 정답 이미지 참조가 남으면 안 됨');
  assert.ok(!student.includes('<img'), 'void 태그 자체가 제거되어야 함');
  assert.match(teacher, /assets\/정답샷\.png/, 'teacher 는 유지');
  assert.match(student, /<p>본문<\/p>/, '비정답 콘텐츠는 보존');
});

test('정답 제거: span.answer 로 감싼 이미지는 기존대로 내용만 제거(빈 래퍼 유지)', () => {
  const html = '<body data-mode="MODE_TOKEN"><span class="answer"><img src="assets/x.png"></span></body>';
  const { student } = new BuildVariants().execute(html);
  assert.ok(!student.includes('assets/x.png'), 'student 에 이미지 참조 제거');
  assert.match(student, /<span class="answer"><\/span>/, '답란 셸은 유지');
});

// ── S2.2: 개체 트리 문서 경로(executeObjectTree) — render-object-tree.test.js 와 동형 픽스처 사용 ──

const OBJ_ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };

function objDocWith(flow = [], float = []) {
  return { pagination: 'paginated', pages: [{ flow, float }] };
}

test('개체 트리 경로: teacher 는 answer:true 개체와 answerKey 를 전체 포함', () => {
  const document = objDocWith([
    { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '질문본문', answerKey: { text: '정답본문' } },
    { id: 'a1', type: 'title', placement: 'flow', text: '정답전용제목', answer: true },
  ]);
  const { teacher } = new BuildVariants().executeObjectTree(document, OBJ_ASSETS);
  assert.match(teacher, /질문본문/);
  assert.match(teacher, /정답본문/);
  assert.match(teacher, /정답전용제목/);
});

test('개체 트리 경로: student 는 answer:true 개체를 트리 수준에서 물리 제거(빈 래퍼조차 없음)', () => {
  const document = objDocWith([
    { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '질문본문' },
    { id: 'a1', type: 'title', placement: 'flow', text: '정답전용제목', answer: true },
  ]);
  const { student } = new BuildVariants().executeObjectTree(document, OBJ_ASSETS);
  assert.match(student, /질문본문/, '비정답 콘텐츠는 보존');
  assert.ok(!student.includes('정답전용제목'), 'answer:true 개체는 트리 수준에서 물리 제거되어야 함');
  assert.ok(!student.includes('class="answer"'), '빈 래퍼조차 남지 않아야 함(HTML 경로와 달리 개체 자체가 제거됨)');
});

test('개체 트리 경로: question.answerKey 는 answer:true 여부와 무관하게 student 에서 제거', () => {
  const document = objDocWith([
    { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '질문본문', answerKey: { text: '누출되면안되는정답' } },
  ]);
  const { student, teacher } = new BuildVariants().executeObjectTree(document, OBJ_ASSETS);
  assert.ok(!student.includes('누출되면안되는정답'), 'answerKey 는 단독 필드라도 student 에서 제거되어야 함');
  assert.match(teacher, /누출되면안되는정답/, 'teacher 는 answerKey 유지');
});

test('개체 트리 경로: float 개체도 answer:true 면 동일하게 물리 제거된다', () => {
  const document = objDocWith([], [
    { id: 'sh1', type: 'shape', placement: 'float', rect: { xMm: 1, yMm: 1, wMm: 1, hMm: 1 }, shapeKind: 'rect', answer: true },
  ]);
  const { student, teacher } = new BuildVariants().executeObjectTree(document, OBJ_ASSETS);
  assert.ok(!student.includes('wg-float'), 'float answer:true 개체가 student 에 남으면 안 됨');
  assert.match(teacher, /wg-float/, 'teacher 는 float 유지');
});

test('개체 트리 경로: 렌더된 HTML 에 기존 stripElementsByClass 2차 방어 존속(richtext 잔존 .answer 도 제거)', () => {
  // richtext 는 무손실 탈출구라 원본 HTML 을 그대로 방출한다 — 트리 수준 answer:true 제거는
  // "개체" 단위라 richtext 내부에 하드코딩된 .answer 마크업까지는 닿지 않는다. 2차 grep 방어가
  // 이 잔존분을 걷어내는지 검증(누출 게이트 이중화).
  const document = objDocWith([
    { id: 'r1', type: 'richtext', placement: 'flow', html: '<div>본문<span class="answer">숨겨진정답잔존</span></div>' },
  ]);
  const { student, teacher } = new BuildVariants().executeObjectTree(document, OBJ_ASSETS);
  assert.ok(!student.includes('숨겨진정답잔존'), '2차 방어(stripElementsByClass)가 richtext 내부 잔존 .answer 도 걷어내야 함');
  assert.match(teacher, /숨겨진정답잔존/);
});

test('개체 트리 경로 신설이 기존 HTML 경로(execute)에 회귀를 일으키지 않는다', () => {
  const { student, teacher } = new BuildVariants().execute(SAMPLE);
  assert.match(student, /data-mode="student"/);
  assert.match(teacher, /data-mode="teacher"/);
  assert.ok(!student.includes('전압에 정비례한다'));
});
