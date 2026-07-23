import { OpenDocument } from './OpenDocument.js';
import { RenderPdf, DEFAULT_VIRTUAL_TIME_BUDGET } from './RenderPdf.js';
import { checkExportGate } from '../domain/schema/exportGate.js';

// ExportDocument — 워크스페이스 저장본을 학생용/교사용 PDF 로 내보낸다(E6).
// "저장이 곧 게이트": 디스크의 worksheet-*.html(SaveDocument 가 게이트 통과시킨
// 산출물)만 렌더하고 재조립하지 않는다. meta.unsafe 는 여기서 fail-closed 로 승격 —
// unsafe(또는 meta 부재 = 부분쓰기 의심)면 student PDF 를 거부한다. teacher 는
// 정답 포함이 정상인 교사 전용 산출물이라 항상 허용(§7 정신 = student 차단이 핵심).
//
// 개체 트리 문서 페이지네이션 게이트(D-A/R2-4, S3.5/US-14): SaveDocument.checkpoint 로 저장된
// 개체 트리 문서는 manifest.pagination 필드를 갖는다(레거시 HTML manifest 는 이 필드가 없다).
// scaffold(Chrome 측정 패스로 경계 확정 전)는 어느 변형도 인쇄 경계가 없어 student/teacher 구분과
// 무관하게 문서 전체가 export 불가능하다 — unsafe(=student 만 차단)와는 별개의, 더 앞선 게이트다.
// checkExportGate 가 거부하면 어떤 렌더도 시도하지 않고 즉시 예외로 거부한다(fail-closed).
// pagination 필드가 없는 문서(레거시 경로)는 이 분기를 타지 않아 기존 동작이 그대로 보존된다.

export const UNSAFE_STUDENT_MESSAGE =
  '정답 누출 감지로 학생용 PDF 를 차단했습니다(unsafe) — 에디터 검수 바에서 누출을 해소하고 다시 저장하세요.';
export const MISSING_STUDENT_MESSAGE =
  'worksheet-student.html 이 없어 학생용 PDF 를 건너뜁니다(부분쓰기 의심) — 문서를 다시 저장하면 복구됩니다.';

export class ExportDocument {
  /**
   * @param {{workspace, renderer: import('./ports.js').Renderer,
   *   fileExists:(path:string)=>boolean, removeFile?:(path:string)=>Promise<void>}} deps
   * fileExists/removeFile 은 IO 주입점(어댑터가 fs 를 넘긴다) — 유스케이스는 FS 무지 유지.
   */
  constructor({ workspace, renderer, fileExists, removeFile = null }) {
    if (!workspace) throw new TypeError('ExportDocument 는 workspace 리포지토리가 필요합니다.');
    if (typeof fileExists !== 'function') throw new TypeError('ExportDocument 는 fileExists 함수가 필요합니다.');
    this.openDocument = new OpenDocument({ workspace });
    this.renderPdf = new RenderPdf({ renderer });
    this.fileExists = fileExists;
    this.removeFile = removeFile;
  }

  /**
   * @param {{name:string, virtualTimeBudget?:number}} args
   * @returns {Promise<{name:string, rendered:{variant:string, path:string}[],
   *   skipped:{student?:'unsafe'|'missing'}, unsafe:boolean, reason:string|null}>}
   */
  async execute({ name, virtualTimeBudget = DEFAULT_VIRTUAL_TIME_BUDGET }) {
    const { name: docName, manifest, meta, paths } = await this.openDocument.execute({ name });

    if (manifest && typeof manifest === 'object' && manifest.pagination != null) {
      const gate = checkExportGate(manifest);
      if (!gate.exportable) {
        throw new Error(`${docName}: ${gate.message} (reason: ${gate.reason})`);
      }
    }

    // meta 부재 = 커밋 마커 없는 미완성/외부 문서 → fail-closed 로 unsafe 취급.
    const unsafe = meta == null || meta.unsafe === true;

    const rendered = [];
    const skipped = {};
    let reason = null;

    // teacher 먼저 — student 쪽 어떤 강등이 있어도 교사용 산출은 보존된다.
    await this.renderPdf.execute({
      inputPath: paths.teacherPath,
      outputPath: paths.teacherPdfPath,
      virtualTimeBudget,
    });
    rendered.push({ variant: 'teacher', path: paths.teacherPdfPath });

    if (unsafe) {
      skipped.student = 'unsafe';
      reason = UNSAFE_STUDENT_MESSAGE;
    } else if (!this.fileExists(paths.studentPath)) {
      // meta 는 안전하다는데 student.html 부재 = 부분쓰기 불일치. throw 하면
      // 이미 만든 teacher PDF 까지 무산되므로 graceful skip 으로 강등한다.
      skipped.student = 'missing';
      reason = MISSING_STUDENT_MESSAGE;
    }
    if (skipped.student) {
      // SaveDocument 의 removeStudentHtml 과 대칭: 이전 export 의 학생용 PDF 가
      // 스테일로 남으면 그 자체가 누출 벡터다 — skip 시 물리 제거한다.
      if (this.removeFile && this.fileExists(paths.studentPdfPath)) {
        await this.removeFile(paths.studentPdfPath);
      }
    } else {
      await this.renderPdf.execute({
        inputPath: paths.studentPath,
        outputPath: paths.studentPdfPath,
        virtualTimeBudget,
      });
      rendered.push({ variant: 'student', path: paths.studentPdfPath });
    }

    return { name: docName, rendered, skipped, unsafe, reason };
  }
}
