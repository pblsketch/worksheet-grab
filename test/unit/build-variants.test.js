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
