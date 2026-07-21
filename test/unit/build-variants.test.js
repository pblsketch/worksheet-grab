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
