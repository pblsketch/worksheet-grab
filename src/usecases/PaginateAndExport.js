import { PaginateObjectTree } from './PaginateObjectTree.js';
import { SaveDocument } from './SaveDocument.js';
import { ExportDocument } from './ExportDocument.js';

// PaginateAndExport — S3.5(M3) 생성 파이프라인 페이지네이션 패스(06_plan_final.md 194~199행, D-A/R2-4).
//
// "Chrome 없이 단위" 원칙의 명시적 예외(계획서 195행): 개체 트리 생성 경로는 편집기 없이 직접
// export 될 수 있으므로(RunPipeline → ChromeRenderer 와 동형 경로), 생성 문서도 편집기와 같은
// Chrome 측정 패스(PaginateObjectTree)를 거쳐야 경계가 일치한다(원칙 2 — 이중 조판 금지). 이
// 유스케이스는 그 단일 배선점이다: pagination:'scaffold' 개체 트리 문서를 받아
//   1) PaginateObjectTree(Chrome 측정)로 paginated 승격
//   2) SaveDocument.checkpoint 로 워크스페이스에 커밋(체크포인트 계약, S2.4)
//   3) ExportDocument 로 학생/교사 PDF 2벌 export(scaffold 직접 export 는 ExportDocument 자체가
//      checkExportGate 로 거부 — 이 유스케이스를 거쳐야만 export 에 도달할 수 있다)
// 를 한 호출로 수행한다. compose 처럼 scaffold 산출만 하고 이 패스를 아직 거치지 않은 문서는
// export 불가 상태로 남는 것이 계약이다(R2-4) — CLI 노출 여부와 무관하게 이 유스케이스 하나가
// "scaffold → paginated → export" 경계를 강제한다.
export class PaginateAndExport {
  /**
   * @param {{workspace, blockRepository, measurer:{measure:Function},
   *   renderer:import('./ports.js').Renderer, fileExists:(path:string)=>boolean,
   *   removeFile?:(path:string)=>Promise<void>}} deps
   */
  constructor({ workspace, blockRepository, measurer, renderer, fileExists, removeFile = null }) {
    if (!workspace) throw new TypeError('PaginateAndExport 는 workspace 리포지토리가 필요합니다.');
    if (!blockRepository) throw new TypeError('PaginateAndExport 는 BlockRepository 가 필요합니다.');
    if (!measurer || typeof measurer.measure !== 'function') {
      throw new TypeError('PaginateAndExport 는 measurer{measure} 가 필요합니다.');
    }
    this.repo = blockRepository;
    this.paginator = new PaginateObjectTree({ measurer });
    this.saveDocument = new SaveDocument({ workspace, blockRepository, curriculum: null });
    this.exportDocument = new ExportDocument({ workspace, renderer, fileExists, removeFile });
  }

  /**
   * @param {{name:string, document:object, checkpointName?:string|null, virtualTimeBudget?:number,
   *   tolerancePx?:number, timeoutMs?:number, now?:Date}} args
   *   document: pagination:'scaffold' 개체 트리 문서(SaveDocument.checkpoint 와 동형 봉투 —
   *   pagination/pages 외 docTitle/subject/themeName/paper/standards 등 메타를 함께 담는다).
   * @returns {Promise<{name:string, rendered:Array, skipped:object, unsafe:boolean, reason:string|null,
   *   pageCount:number, pageOfId:Record<string,number>, gating:object}>}
   */
  async execute({ name, document, checkpointName = null, virtualTimeBudget, tolerancePx, timeoutMs, now = new Date() }) {
    if (!document || typeof document !== 'object' || document.pagination !== 'scaffold') {
      throw new TypeError('PaginateAndExport.execute 는 pagination:"scaffold" 개체 트리 문서(document)가 필요합니다.');
    }

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

    // 1) scaffold → paginated(Chrome 측정 패스, D-A 단일 권한).
    const { document: paginatedCore, gating, pageOfId } = await this.paginator
      .execute(document, assets, renderMeta, { tolerancePx, timeoutMs });
    // 문서 봉투(docTitle 등 메타)는 그대로 승계하고 pagination/pages 만 승격분으로 교체.
    const paginatedDoc = { ...document, ...paginatedCore };

    // 2) 워크스페이스 커밋(체크포인트 계약 — 호출 1회 = 디스크 커밋 1회, S2.4).
    const saved = await this.saveDocument.checkpoint({ name, document: paginatedDoc, checkpointName, now });

    // 3) export(ExportDocument 가 checkExportGate 로 paginated 를 재확인 — 이중 방어).
    const exported = await this.exportDocument.execute({ name, virtualTimeBudget });

    return {
      ...exported,
      pageCount: paginatedDoc.pages.length,
      pageOfId,
      gating,
      saveMeta: saved.meta,
    };
  }
}
