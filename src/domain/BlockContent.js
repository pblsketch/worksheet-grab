// BlockContent — 블록 HTML을 감싸는 불투명(opaque) 값객체.
// 도메인은 HTML 내부 구조를 모른 채 "값"으로만 다룬다(PLAN 4.5 긴장 해소).
// AI가 자유 저작한 HTML 유연성과 도메인 순수성을 양립시키는 경계.
export class BlockContent {
  #html;

  constructor(html) {
    if (typeof html !== 'string') {
      throw new TypeError('BlockContent 는 HTML 문자열이어야 합니다.');
    }
    this.#html = html;
  }

  /** 원시 HTML 문자열을 반환한다(직렬화/렌더 경계에서만 사용). */
  toHtml() {
    return this.#html;
  }
}
