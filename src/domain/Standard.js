// Standard — 성취기준(코드 + 원문 + 교과).
// 불변식: 원문(text)은 외부(gepai CSV/MCP)에서만 주입된다. 도메인은 원문을 창작하지 않는다.
export class Standard {
  constructor({ code, text, subject = null }) {
    if (!code || typeof code !== 'string') {
      throw new TypeError('Standard.code 는 필수 문자열입니다.');
    }
    if (text == null || typeof text !== 'string' || text.trim() === '') {
      // 원문 없이 성취기준을 만들 수 없다 → 창작 금지 불변식의 구조적 강제.
      throw new Error(`Standard "${code}" 의 원문(text)이 외부에서 주입되지 않았습니다(창작 금지).`);
    }
    this.code = code.trim();
    this.text = text.trim();
    this.subject = subject;
    Object.freeze(this);
  }

  /** 코드 표기를 대괄호 정규형([코드])으로 반환. */
  bracketedCode() {
    const c = this.code.replace(/^\[|\]$/g, '');
    return `[${c}]`;
  }
}
