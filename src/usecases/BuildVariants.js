import { MODE_TOKEN, Variant } from '../domain/index.js';
import { stripElementsByClass } from './html-scan.js';

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
}

function replaceAll(s, find, repl) {
  return s.split(find).join(repl);
}
