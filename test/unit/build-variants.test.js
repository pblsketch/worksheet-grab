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
