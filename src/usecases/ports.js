// ports.js — 유스케이스가 의존하는 포트(인터페이스) 정의.
// JS 는 인터페이스가 없으므로 "구현하지 않으면 던지는" 기반 클래스로 계약을 문서화한다.
// 변하는 3경계(Renderer·Curriculum·ContentAuthor) + 얇은 BlockRepository.

/** Renderer 포트 — HTML → PDF/PNG. 어댑터: ChromeHeadless(교체가능: Playwright 등). */
export class Renderer {
  async renderToPdf(/* inputPath, outputPath, options */) {
    throw new Error('Renderer.renderToPdf 미구현');
  }

  /** HTML → PNG(활동지 미리보기·카드용, 옵션). */
  async renderToPng(/* inputPath, outputPath, options */) {
    throw new Error('Renderer.renderToPng 미구현');
  }
}

/** CurriculumProvider 포트 — 성취기준 코드→원문(resolve) 및 조건 검색(search).
 *  어댑터: GepaiCsv(1차) / GepaiMcp(옵션). 원문은 조회만(창작 금지). */
export class CurriculumProvider {
  async resolve(/* code */) {
    throw new Error('CurriculumProvider.resolve 미구현');
  }

  /** @param {{school?:string, subject?:string, grade?:string, keyword?:string, limit?:number}} query
   *  @returns {Promise<Array<{code,text,subject,school,grade}>>} */
  async search(/* query */) {
    throw new Error('CurriculumProvider.search 미구현');
  }
}

/** BlockRepository 포트 — 블록 HTML·테마·에셋 로드. 어댑터: FsBlockRepository. */
export class BlockRepository {
  async readAsset(/* name */) { throw new Error('BlockRepository.readAsset 미구현'); }
  async loadBlockHtml(/* file */) { throw new Error('BlockRepository.loadBlockHtml 미구현'); }
  async listBlocks() { throw new Error('BlockRepository.listBlocks 미구현'); }
  async loadThemeCss(/* name */) { throw new Error('BlockRepository.loadThemeCss 미구현'); }
  async listThemes() { throw new Error('BlockRepository.listThemes 미구현'); }
  /** 무드 팩 CSS(themes/moods/{name}.css) — 디자인 토큰(--wg-*) 값 세트. 무드 지정 시에만 호출된다. */
  async loadMoodCss(/* name */) { throw new Error('BlockRepository.loadMoodCss 미구현'); }
  /** 등록된 무드 이름의 닫힌 목록(themes/moods/*.css). 없으면 []. 무드 fail-closed 검증에 쓴다. */
  async listMoods() { throw new Error('BlockRepository.listMoods 미구현'); }
  async readManifest(/* nameOrPath */) { throw new Error('BlockRepository.readManifest 미구현'); }
  /** 블록 타입 어휘 + 계약 레지스트리(blocks/vocabulary.json). 없으면 null. */
  async readVocabulary() { throw new Error('BlockRepository.readVocabulary 미구현'); }
  /** 아키타입(교과 초월 구조 패턴) 레지스트리(blocks/archetypes.json). 없으면 null. */
  async readArchetypes() { throw new Error('BlockRepository.readArchetypes 미구현'); }
}
