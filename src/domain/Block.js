import { BlockContent } from './BlockContent.js';

// Block — 활동지를 구성하는 최소 단위. 공통 코어 또는 교과 팩에 속한다.
// content 는 불투명 HTML 값객체. type/category 는 재조립·검증의 메타데이터.
export const BLOCK_CATEGORIES = Object.freeze(['core', 'subjectPack']);

export class Block {
  constructor({ id, type, category = 'core', subject = null, content }) {
    if (!id) throw new TypeError('Block.id 는 필수입니다.');
    if (!type) throw new TypeError('Block.type 은 필수입니다.');
    if (!BLOCK_CATEGORIES.includes(category)) {
      throw new Error(`Block.category 는 ${BLOCK_CATEGORIES.join('|')} 중 하나여야 합니다: ${category}`);
    }
    this.id = id;
    this.type = type;
    this.category = category;
    this.subject = subject;
    this.content = content instanceof BlockContent ? content : new BlockContent(String(content ?? ''));
    Object.freeze(this);
  }

  isCore() {
    return this.category === 'core';
  }

  toHtml() {
    return this.content.toHtml();
  }
}
