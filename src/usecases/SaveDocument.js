import { AssembleWorksheet } from './AssembleWorksheet.js';
import { BuildVariants, ANSWER_CLASSES } from './BuildVariants.js';
import { ValidateWorksheet, MIN_ANSWER_LEN, SLICE_LEN } from './ValidateWorksheet.js';
import { collectTextInside, textOutside } from './html-scan.js';
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
      ...(await this.#detectDroppedMarks(layout.name, student)),
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

  // ⭐ unwrap 누출의 최후 그물(E3, 한계 있는 심층방어 최외곽): 직전 저장본에서 .answer
  // 마크 안에 있던 긴 정답이 이번 저장의 student 에 마크 밖 평문으로 남았으면
  // (= 편집 중 마크가 벗겨짐) error 로 승격한다. 검색은 raw HTML 이 아니라
  // textOutside 정규화 텍스트 기준(#checkAnswerLeak 과 동일 패턴), 전체 일치 또는
  // 앞 SLICE_LEN 부분열 일치(부분수정 잔존 포착). MIN_ANSWER_LEN 미만 단답과 대폭
  // 수정은 못 잡는다 — 주 방어는 에디터의 세션 마크 태깅 + 기존 마크 confirm 이다.
  // 최초 저장(이전 manifest 없음)은 skip. 이전 저장에서 이미 벗겨진 마크는
  // prevTeacher 의 .answer 에 없으므로 비교가 자연 skip(추가 오탐 없음).
  async #detectDroppedMarks(name, newStudent) {
    if (!this.workspace.docExists(name)) return [];
    let prevManifest;
    try {
      prevManifest = await this.workspace.readManifest(name);
    } catch {
      return []; // 미완성 디렉토리(manifest 부재) — 비교 대상 없음
    }
    const asm = new AssembleWorksheet({ blockRepository: this.repo, curriculum: this.curriculum });
    const { html: prevHtml } = await asm.execute(prevManifest);
    const { teacher: prevTeacher } = new BuildVariants().execute(prevHtml);
    const prevMarks = [...new Set(collectTextInside(prevTeacher, ANSWER_CLASSES))]
      .filter((t) => t.length >= MIN_ANSWER_LEN);
    if (prevMarks.length === 0) return [];

    const outside = textOutside(newStudent, ANSWER_CLASSES);
    const findings = [];
    for (const markText of prevMarks) {
      const hit = outside.includes(markText)
        || (markText.length >= SLICE_LEN && outside.includes(markText.slice(0, SLICE_LEN)));
      if (hit) {
        findings.push({
          rule: 'answer-mark-dropped',
          severity: 'error',
          message: '직전 저장본에서 정답 마크(.answer) 안에 있던 텍스트가 이번 저장의 학생용에 평문으로 남았습니다(마크 해제 의심).',
          evidence: markText.length > 60 ? markText.slice(0, 60) + '…' : markText,
        });
      }
    }
    return findings;
  }
}
