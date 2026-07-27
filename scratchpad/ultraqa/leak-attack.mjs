// ultraqa 시나리오 — 정답 누출 공격(불변식 1). 우회 위치에 정답을 심고 student HTML 을 grep.
// 실행: node scratchpad/ultraqa/leak-attack.mjs
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { assertLog } from './harness.mjs';

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };
const A = assertLog();

// 각 페이로드에 고유 마커 문자열을 심어 student 산출물에서 잔존 여부를 grep 한다.
const LEAK = {
  answerKey: 'LEAK_ANSWERKEY_7f1',
  richAnswerObj: 'LEAK_RICH_ANSWEROBJ_7f2',
  tableAnswerObj: 'LEAK_TABLE_ANSWEROBJ_7f3',
  tableCaption: 'LEAK_TABLE_CAPTION_7f4',
  spanDq: 'LEAK_SPAN_DQ_7f5',
  spanSq: 'LEAK_SPAN_SQ_7f6',
  spanBare: 'LEAK_SPAN_BARE_7f7',
  multiClass: 'LEAK_MULTI_CLASS_7f8',
  nested: 'LEAK_NESTED_7f9',
  plotAns: 'LEAK_PLOT_ANS_7fa',
  imgSrc: 'LEAK_IMG_SRC_7fb.png',
  attrGt: 'LEAK_ATTR_GT_7fc',
  floatAnswer: 'LEAK_FLOAT_ANSWER_7fd',
  titleAnswer: 'LEAK_TITLE_ANSWER_7fe',
  whitespaceClass: 'LEAK_WS_CLASS_7ff',
  tabClass: 'LEAK_TAB_CLASS_800',
};

const document = {
  pagination: 'paginated',
  docTitle: '누출 공격 문서',
  pages: [{
    flow: [
      // 1) answerKey 단독(answer:false 질문)
      { id: 'q1', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '질문', answerKey: { text: LEAK.answerKey } },
      // 2) answer:true richtext(평문 정답)
      { id: 'r1', type: 'richtext', placement: 'flow', html: `<p>${LEAK.richAnswerObj}</p>`, answer: true },
      // 3) answer:true 표(셀 + 캡션에 정답)
      { id: 'tb1', type: 'table', placement: 'flow', splittable: false, caption: LEAK.tableCaption, rows: [[{ text: LEAK.tableAnswerObj }, { text: '값' }]], answer: true },
      // 4) answer:false richtext 안에 class=answer 변형들(2차 방어 우회 시도)
      {
        id: 'r2', type: 'richtext', placement: 'flow', html: [
          `<p>본문 유지 확인용</p>`,
          `<span class="answer">${LEAK.spanDq}</span>`,
          `<span class='answer'>${LEAK.spanSq}</span>`,
          `<span class=answer>${LEAK.spanBare}</span>`,
          `<div class="note answer extra">${LEAK.multiClass}</div>`,
          `<div class="answer"><div><span>${LEAK.nested}</span></div></div>`,
          `<span class="plot-ans">${LEAK.plotAns}</span>`,
          `<img class="answer" src="${LEAK.imgSrc}">`,
          `<span title="a>b" class="answer">${LEAK.attrGt}</span>`,
          `<span class=" answer ">${LEAK.whitespaceClass}</span>`,
          `<span class="answer\t">${LEAK.tabClass}</span>`,
        ].join('\n'),
      },
      // 5) answer:true title(ANSWERABLE_TYPES 에 title 포함)
      { id: 't2', type: 'title', placement: 'flow', text: LEAK.titleAnswer, answer: true },
    ],
    float: [
      // 6) float answer:true richtext
      { id: 'f1', type: 'richtext', placement: 'float', html: `<p>${LEAK.floatAnswer}</p>`, answer: true, rect: { xMm: 100, yMm: 200, wMm: 60, hMm: 30 } },
    ],
  }],
};

const { student, teacher } = new BuildVariants().executeObjectTree(document, ASSETS);

// teacher 에는 전량 보존(대조군) — answer 콘텐츠가 아예 안 실렸다면 공격 자체가 무효.
for (const [k, marker] of Object.entries(LEAK)) {
  A.check(teacher.includes(marker), `대조군: teacher 에 ${k} 마커 존재`);
}
// student 에는 전량 부재(불변식 1).
for (const [k, marker] of Object.entries(LEAK)) {
  A.check(!student.includes(marker), `불변식 1: student 에 ${k} 마커 부재`);
}
// class="answer" 래퍼 잔존 여부(개체 경로는 빈 래퍼조차 없어야 하나, richtext 내부 잔존 셸은 허용 —
// 내용이 비어 있으면 누출 아님). 참고 정보로만 출력.
const shellCount = (student.match(/class="[^"]*answer[^"]*"/g) || []).length;
console.log(`[info] student 내 answer 클래스 셸(내용 제거됨) 잔존: ${shellCount}건`);

const ok = A.summary('leak-attack');
process.exitCode = ok ? 0 : 1;
