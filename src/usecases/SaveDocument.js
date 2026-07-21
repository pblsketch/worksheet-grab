import { AssembleWorksheet } from './AssembleWorksheet.js';
import { BuildVariants } from './BuildVariants.js';
import { ValidateWorksheet } from './ValidateWorksheet.js';
import { buildMeta, nextSnapshotSerial, snapshotName } from './workspace.js';

// SaveDocument — 워크스페이스 문서 저장의 단일 진입점. E2 에디터 서버·CLI(doc save/
// --doc/restore)가 전부 이 함수를 경유한다 → 정답 누출 방어선이 모든 경로에서 대칭.
//
// 원칙(§7 fail-closed × P5 저장 관대성의 신테시스):
//  - manifest·history 스냅샷·teacher.html·meta 는 항상 저장한다(작업 손실 0, 무료 undo).
//  - 재렌더 2벌을 ValidateWorksheet 로 검사(RunPipeline 게이트와 동일 시맨틱)해 정답
//    누출(error)이면 student.html 쓰기를 보류(기존 파일 제거)하고 meta.unsafe=true 를
//    남긴다. E6 export 가 이 마커를 fail-closed 로 승격한다. 쓰기 보류 대상은 student 만 —
//    teacher 는 정답 포함이 정상이며, teacher 인쇄안전의 최종 차단은 E6 export 소관이다.
//  - worksheet.html(통합본)은 절대 쓰지 않는다 — MODE_TOKEN 미치환 원본은 정답을
//    물리 포함한 누출 벡터다(E2 편집 캔버스 소관으로 예약).
export class SaveDocument {
  /** @param {{workspace, blockRepository, curriculum}} deps */
  constructor({ workspace, blockRepository, curriculum }) {
    if (!workspace) throw new TypeError('SaveDocument 는 workspace 리포지토리가 필요합니다.');
    if (!blockRepository) throw new TypeError('SaveDocument 는 BlockRepository 가 필요합니다.');
    this.workspace = workspace;
    this.repo = blockRepository;
    this.curriculum = curriculum ?? null;
  }

  /**
   * @param {{name:string, manifest:object, now?:Date}} args now 는 테스트 결정성용 주입점.
   * @returns {Promise<{name:string, paths:object, meta:object, unsafe:boolean, leakFindings:object[]}>}
   */
  async execute({ name, manifest, now = new Date() }) {
    const layout = this.workspace.layout(name);

    // 재렌더: 통합본은 메모리 내 중간물로만 쓰고, 산출물은 student/teacher 2벌뿐.
    const asm = new AssembleWorksheet({ blockRepository: this.repo, curriculum: this.curriculum });
    const { html } = await asm.execute(manifest);
    const { student, teacher } = new BuildVariants().execute(html);

    const themes = await this.repo.listThemes();
    const knownSubjectHexes = [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
    const validator = new ValidateWorksheet({ knownSubjectHexes, paper: manifest.paper });
    // 누출 판정은 RunPipeline 게이트와 동일하게 student+teacher 양벌의 error 합집합.
    // student 는 .answer 가 이미 물리 제거된 상태라 answer-leak 규칙이 발화할 수 없다 —
    // "정답 텍스트가 마크 밖에 평문으로 남았는가"는 마크가 살아 있는 teacher 쪽에서
    // 탐지되며, 그 마크 밖 평문이 곧 student 에 잔존하는 누출분이다.
    const leakFindings = [
      ...validator.execute(student).findings,
      ...validator.execute(teacher).findings,
    ].filter((f) => f.severity === 'error');
    const unsafe = leakFindings.length > 0;

    if (!this.workspace.docExists(layout.name)) await this.workspace.createDoc(layout.name);
    // 쓰기 순서(부분쓰기 감지 계약): manifest → HTML → 스냅샷 → meta(커밋 마커 최종).
    await this.workspace.writeManifest(layout.name, manifest);
    await this.workspace.writeVariantHtml(layout.name, unsafe ? { teacher } : { student, teacher });
    if (unsafe) await this.workspace.removeStudentHtml(layout.name);
    const serial = nextSnapshotSerial(await this.workspace.listSnapshots(layout.name));
    await this.workspace.writeSnapshot(layout.name, snapshotName(serial, now), manifest);
    const prev = await this.workspace.readMeta(layout.name);
    const meta = buildMeta(layout.name, manifest, { now, prev, unsafe });
    await this.workspace.writeMeta(layout.name, meta);

    return { name: layout.name, paths: layout, meta, unsafe, leakFindings };
  }
}
