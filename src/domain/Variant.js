// Variant — 학생용/교사용 산출 벌. 단일 HTML의 data-mode 토글로 표현된다.
// 불변식: student 벌은 정답(.answer/.plot-ans 내용)을 포함하지 않는다.
//         → BuildVariants 가 student 빌드에서 정답 내용을 제거(비노출)한다. grep 은 2차 방어.
export const MODE_TOKEN = 'MODE_TOKEN';

export class Variant {
  static STUDENT = 'student';
  static TEACHER = 'teacher';

  constructor(mode) {
    if (mode !== Variant.STUDENT && mode !== Variant.TEACHER) {
      throw new Error(`Variant.mode 는 student|teacher 여야 합니다: ${mode}`);
    }
    this.mode = mode;
    Object.freeze(this);
  }

  /** student 벌에서 정답이 배제되어야 하는가? */
  excludesAnswers() {
    return this.mode === Variant.STUDENT;
  }
}
