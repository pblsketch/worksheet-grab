import { MODE_TOKEN, Variant } from '../domain/index.js';
import { stripElementsByClass } from './html-scan.js';
import { RenderObjectTree } from './RenderObjectTree.js';

// BuildVariants — 단일 HTML(MODE_TOKEN 포함)을 학생용/교사용 2벌로 만든다.
// - teacher: MODE_TOKEN → "teacher" (정답 노출)
// - student: MODE_TOKEN → "student" + .answer/.plot-ans 내용 제거(정답 배제 불변식)
//
// 순수 함수. Chrome·FS 의존 없음(수용기준 6: 목 없이도 단위 테스트 가능).
export const ANSWER_CLASSES = ['answer', 'plot-ans'];

export class BuildVariants {
  /**
   * @param {string} html MODE_TOKEN 을 포함한 원본 HTML
   * @returns {{student:string, teacher:string}}
   */
  execute(html) {
    if (typeof html !== 'string') throw new TypeError('BuildVariants.execute 는 HTML 문자열이 필요합니다.');
    if (!html.includes(MODE_TOKEN)) {
      throw new Error(`입력 HTML 에 ${MODE_TOKEN} 이 없습니다. 치환할 모드 토큰이 필요합니다.`);
    }

    const teacher = replaceAll(html, MODE_TOKEN, Variant.TEACHER);

    // student: 토큰 치환 후 정답 내용을 물리적으로 제거한다.
    const studentTokened = replaceAll(html, MODE_TOKEN, Variant.STUDENT);
    const student = stripElementsByClass(studentTokened, ANSWER_CLASSES);

    return { student, teacher };
  }

  /** 특정 모드 1벌만. */
  executeOne(html, mode) {
    const both = this.execute(html);
    if (mode === Variant.STUDENT) return both.student;
    if (mode === Variant.TEACHER) return both.teacher;
    throw new Error(`알 수 없는 mode: ${mode}`);
  }

  /**
   * 개체 트리 문서 경로(S2.2, 06_plan_final.md 154~156행) — HTML 문자열이 아니라 개체 트리
   * document 를 입력받아 학생용/교사용 HTML 2벌을 만든다.
   * - student: answer:true 개체를 **트리 수준에서 물리 제거**(도메인 불변식 — RenderObjectTree 의
   *   `.answer` 클래스 방출에 기대지 않는다) 후 렌더. 남은 question.answerKey 도 함께 제거한다
   *   (answerKey 는 answer:true 와 별개 필드라 단독으로 남을 수 있음, HANDOFF-object-schema.md 51~55행).
   * - teacher: 트리 전체를 그대로 렌더.
   * - 렌더된 HTML 에는 기존 stripElementsByClass 를 2차 방어로 그대로 적용한다(richtext 탈출구
   *   내부에 하드코딩된 .answer 마크업 등 트리 수준 제거가 닿지 않는 잔존분 대비).
   * @param {object} document 개체 트리 문서(ValidateObjectTree 스키마)
   * @param {{paperCss:string, blocksCss:string, themeCss:string}} assets RenderObjectTree 주입 자산
   * @param {object} [meta] RenderObjectTree meta(§ RenderObjectTree.execute 참조)
   * @returns {{student:string, teacher:string}}
   */
  executeObjectTree(document, assets, meta = {}) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new TypeError('BuildVariants.executeObjectTree 는 개체 트리 문서(document)가 필요합니다.');
    }
    const renderer = new RenderObjectTree();

    const studentDoc = stripAnswersFromDocument(document);

    const { html: teacherRaw } = renderer.execute(document, assets, meta);
    const { html: studentRaw } = renderer.execute(studentDoc, assets, meta);

    const teacher = replaceAll(teacherRaw, MODE_TOKEN, Variant.TEACHER);
    const studentTokened = replaceAll(studentRaw, MODE_TOKEN, Variant.STUDENT);
    const student = stripElementsByClass(studentTokened, ANSWER_CLASSES);

    return { student, teacher };
  }
}

/** student 용 개체 트리 복제 — 각 페이지의 flow/float 에서 answer:true 개체를 물리 제거하고
 *  남은 question.answerKey 도 제거한다(도메인 불변식, S2.2). 원본 document 는 변경하지 않는다
 *  (teacher 경로는 원본을 그대로 재사용). */
function stripAnswersFromDocument(document) {
  const pages = Array.isArray(document.pages) ? document.pages : [];
  return {
    ...document,
    pages: pages.map((page) => ({
      ...page,
      flow: stripAnswerObjects(Array.isArray(page?.flow) ? page.flow : []),
      float: stripAnswerObjects(Array.isArray(page?.float) ? page.float : []),
    })),
  };
}

function stripAnswerObjects(objs) {
  return objs
    .filter((obj) => obj?.answer !== true)
    .map((obj) => {
      if (obj?.type === 'question' && 'answerKey' in obj) {
        const { answerKey, ...rest } = obj;
        return rest;
      }
      return obj;
    });
}

function replaceAll(s, find, repl) {
  return s.split(find).join(repl);
}
