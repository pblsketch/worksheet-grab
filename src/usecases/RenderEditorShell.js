import { AssembleWorksheet } from './AssembleWorksheet.js';
import { BuildVariants } from './BuildVariants.js';
import { RenderObjectTree } from './RenderObjectTree.js';
import { MODE_TOKEN, Variant } from '../domain/index.js';
import { resolvePaper, paperToPx, paperMargins } from './paper.js';

// RenderEditorShell — 에디터 셸(E2)의 페이지 합성(순수 usecase). manifest 를 조립해
// student/teacher 두 물리 문서와 캔버스 메타(용지 치수·여백)를 만든다.
// 여백선 마크업은 HTML 에 주입하지 않는다 — 부모 오버레이(editor.js)가 canvasMeta.margins
// 를 소비한다(E3 에서 iframe 문서가 contenteditable 이 되어도 편집 대상 무오염).
export class RenderEditorShell {
  /** @param {{blockRepository, curriculum}} deps */
  constructor({ blockRepository, curriculum }) {
    if (!blockRepository) throw new TypeError('RenderEditorShell 은 BlockRepository 가 필요합니다.');
    this.repo = blockRepository;
    this.curriculum = curriculum ?? null;
  }

  /**
   * @param {{manifest:object, meta?:object|null, knownSubjectHexes?:string[], docName?:string|null}} args
   * @returns {Promise<{teacherHtml:string, studentHtml:string, canvasMeta:object, validationSeed:object}>}
   */
  async execute({ manifest, meta = null, knownSubjectHexes = [], docName = null }) {
    const asm = new AssembleWorksheet({ blockRepository: this.repo, curriculum: this.curriculum });
    // teacher 캔버스만 editMode(블록 경계 래퍼) — E3 편집·역동기화 대상.
    // student 는 clean 조립의 파생(래퍼 무오염, 미리보기 전용).
    const { html: editHtml } = await asm.execute(manifest, { editMode: true });
    const { html } = await asm.execute(manifest);
    const teacher = new BuildVariants().execute(editHtml).teacher;
    const { student } = new BuildVariants().execute(html);

    // paper 미지정 문서도 캔버스 메타는 현행 기본(A4 세로·비대칭 여백)으로 산출한다 —
    // resolvePaper(null)=null 은 "CSS 주입 0" 규약이므로 여기서만 A4 로 구체화.
    const resolved = resolvePaper(manifest.paper) ?? resolvePaper({ size: 'A4' });
    const canvasMeta = {
      paper: resolved,
      dims: paperToPx(resolved),
      margins: paperMargins(resolved),
    };
    return {
      teacherHtml: teacher,
      studentHtml: student,
      canvasMeta,
      validationSeed: { knownSubjectHexes, paper: manifest.paper ?? null },
      docTitle: manifest.docTitle || '',
      docName,
      meta,
    };
  }

  /**
   * executeObjectTree — 개체 트리 문서용 에디터 셸 조립(S4.0, C-6/GAP-5). execute()(HTML manifest
   * 경로)와 같은 페이로드 계약(teacherHtml/studentHtml/canvasMeta/…)을 개체 트리 document 입력으로
   * 만든다. teacher 만 editMode(RenderObjectTree 의 data-oid 경계 래퍼) — student 는 clean 파생
   * (BuildVariants.executeObjectTree 의 answer:true 트리 제거 경로).
   * @param {{document:object, meta?:object|null, knownSubjectHexes?:string[], docName?:string|null}} args
   * @returns {Promise<{teacherHtml:string, studentHtml:string, canvasMeta:object, validationSeed:object,
   *   docTitle:string, docName:string|null, meta:object|null}>}
   */
  async executeObjectTree({ document, meta = null, knownSubjectHexes = [], docName = null }) {
    const assets = {
      paperCss: await this.repo.readAsset('paper.css'),
      blocksCss: await this.repo.readAsset('blocks.css'),
      themeCss: document.themeName ? await this.repo.loadThemeCss(document.themeName) : '',
    };
    const renderMeta = {
      lang: document.lang || 'ko',
      docTitle: document.docTitle || '',
      dataSubject: document.dataSubject || document.subject || '',
      themeName: document.themeName || '',
      runHead: document.runHead || '',
      runFoot: document.runFoot || {},
      katex: !!(document.head && document.head.katex),
      paper: document.paper ?? null,
      standards: Array.isArray(document.standards) ? document.standards : [],
    };
    // teacher: editMode(data-oid 경계 래퍼) 렌더 후 MODE_TOKEN 을 직접 치환(정답 보존 — 물리 제거 없음).
    const { html: editHtmlRaw } = new RenderObjectTree().execute(document, assets, renderMeta, { editMode: true });
    const teacherHtml = editHtmlRaw.split(MODE_TOKEN).join(Variant.TEACHER);
    // student: BuildVariants.executeObjectTree 가 트리 수준 answer:true 제거 후 clean 렌더.
    const { student: studentHtml } = new BuildVariants().executeObjectTree(document, assets, renderMeta);

    const resolved = resolvePaper(document.paper) ?? resolvePaper({ size: 'A4' });
    const canvasMeta = {
      paper: resolved,
      dims: paperToPx(resolved),
      margins: paperMargins(resolved),
    };
    return {
      teacherHtml,
      studentHtml,
      canvasMeta,
      validationSeed: { knownSubjectHexes, paper: document.paper ?? null },
      docTitle: document.docTitle || '',
      docName,
      meta,
    };
  }
}
