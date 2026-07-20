import { Block } from './Block.js';
import { Standard } from './Standard.js';

// Worksheet — 순수 도메인 애그리게이트. 페이지(정렬된 Block[])의 목록.
// Chrome·gepai·FS·paper-css 를 전혀 모른다. 직렬화는 Presenter(유스케이스)가 담당.
//
// 불변식:
//  - 최소 1개 페이지, 각 페이지는 정렬된 Block[].
//  - 성취기준은 외부 주입된 Standard[](원문 포함)만.
//  - 저작권 지문은 슬롯으로 유지(도메인은 슬롯 텍스트를 채우지 않는다).
export class Worksheet {
  constructor({
    subject,
    themeName,
    docTitle = '',
    standards = [],
    pages = [],
    head = { katex: false },
    runHead = '',
    runFoot = { left: '', right: '' },
  }) {
    if (!subject) throw new TypeError('Worksheet.subject 는 필수입니다.');
    if (!themeName) throw new TypeError('Worksheet.themeName 은 필수입니다.');
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error('Worksheet 는 최소 1개 페이지가 필요합니다.');
    }
    for (const [pi, page] of pages.entries()) {
      if (!Array.isArray(page) || page.length === 0) {
        throw new Error(`페이지 ${pi + 1} 는 최소 1개 블록이 필요합니다.`);
      }
      for (const b of page) {
        if (!(b instanceof Block)) {
          throw new TypeError(`페이지 ${pi + 1} 에 Block 이 아닌 요소가 있습니다.`);
        }
      }
    }
    for (const s of standards) {
      if (!(s instanceof Standard)) {
        throw new TypeError('standards 는 Standard 인스턴스 배열이어야 합니다(원문 주입 강제).');
      }
    }
    this.subject = subject;
    this.themeName = themeName;
    this.docTitle = docTitle;
    this.standards = [...standards];
    this.pages = pages.map((p) => [...p]);
    this.head = { katex: false, ...head };
    this.runHead = runHead;
    this.runFoot = { left: '', right: '', ...runFoot };
    Object.freeze(this);
  }

  /** 총 페이지 수(렌더 시 PDF 페이지 수의 기대치). */
  pageCount() {
    return this.pages.length;
  }

  /** 모든 블록을 평탄화. */
  allBlocks() {
    return this.pages.flat();
  }

  /** 특정 type 블록이 존재하는가(재조립 컴포넌트 존재 검증용). */
  hasBlockType(type) {
    return this.allBlocks().some((b) => b.type === type);
  }
}
