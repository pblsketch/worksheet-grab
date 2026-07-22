// Theme — 교과 테마 토큰(CSS 변수 6종). 교과색은 오직 이 토큰으로만 표현된다.
// 하드코딩 금지: 블록은 var(--c) 등만 참조하고, 실제 값은 여기(=themes/*.css)에서 온다.
export const THEME_TOKENS = ['--c', '--c2', '--clite', '--cstrip', '--clabel', '--cink'];

export class Theme {
  constructor({ name, subject, tokens }) {
    if (!name) throw new TypeError('Theme.name 은 필수입니다.');
    for (const key of THEME_TOKENS) {
      if (!tokens || !tokens[key]) {
        throw new Error(`Theme "${name}" 에 토큰 ${key} 가 없습니다.`);
      }
    }
    this.name = name;
    this.subject = subject ?? null;
    this.tokens = { ...tokens };
    Object.freeze(this.tokens);
    Object.freeze(this);
  }

  /** :root { --c: ...; } CSS 블록으로 직렬화. */
  toRootCss() {
    const body = THEME_TOKENS.map((k) => `  ${k}: ${this.tokens[k]};`).join('\n');
    return `:root {\n${body}\n}`;
  }

  /**
   * 임의 셀렉터로 스코프한 토큰 블록으로 직렬화(자료집 멤버별 유일 래퍼 방출용).
   * toRootCss 와 동일한 6토큰(THEME_TOKENS)을 방출하고 셀렉터만 교체한다 — 같은 팔레트
   * 원천(=themes/*.css)에서 파생되므로 :root 방출분과 값이 어긋나지 않는다.
   * @param {string} selector 예: `[data-wb-member="0"]`
   */
  toScopedCss(selector) {
    if (typeof selector !== 'string' || !selector.trim()) {
      throw new TypeError('toScopedCss 는 selector 문자열이 필요합니다.');
    }
    const body = THEME_TOKENS.map((k) => `  ${k}: ${this.tokens[k]};`).join('\n');
    return `${selector} {\n${body}\n}`;
  }

  /** 이 테마가 사용하는 팔레트 hex 값 집합(소문자). 검증기의 하드코딩 탐지 근거. */
  paletteHexes() {
    return new Set(
      THEME_TOKENS.map((k) => String(this.tokens[k]).toLowerCase()).filter((v) => /^#[0-9a-f]{3,6}$/.test(v)),
    );
  }
}
