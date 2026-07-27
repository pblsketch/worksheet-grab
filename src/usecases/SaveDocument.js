import { AssembleWorksheet } from './AssembleWorksheet.js';
import { BuildVariants, ANSWER_CLASSES } from './BuildVariants.js';
import { ValidateWorksheet, MIN_ANSWER_LEN, SLICE_LEN } from './ValidateWorksheet.js';
import { collectTextInside, textOutside } from './html-scan.js';
import { buildMeta, nextSnapshotSerial, snapshotName } from './workspace.js';
import { deriveRenderMeta } from './RenderObjectTree.js';
import { loadRenderAssets, loadKnownSubjectHexes } from './renderAssets.js';
import { normalizePageIdentity } from '../domain/schema/PageIdentity.js';

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

    const knownSubjectHexes = await loadKnownSubjectHexes(this.repo);
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

  /**
   * checkpoint — 개체 트리 문서의 디스크 커밋 계약(S2.4, C-3, 06_plan_final.md 162~165행).
   * 인메모리 조작 히스토리(undo/redo — 이동·타이핑·삽입 등 낱개 조작)는 클라이언트 소관이라 여기서
   * 다루지 않는다. 이 메서드가 "체크포인트 = 디스크 커밋 단위" 계약 그 자체다: 호출 1회 = manifest
   * 자리(개체 트리 document)·HTML 2벌·스냅샷 1개·meta(rev+1) 를 함께 쓰고 검증까지 마친다. 호출하지
   * 않으면 아무것도 쓰이지 않는다 — "조작마다 rev 증가·스냅샷 파일 1개" 금지(가드레일)의 실현이다.
   *
   * #detectDroppedMarks(contenteditable 겨냥, execute() HTML 경로 전용)는 이 경로에서 실행하지
   * 않는다 — 개체 모델의 answer:true 는 구조 속성(개체 자체가 정답이거나 아니거나)이라 텍스트 편집만
   * 으로는 벗겨질 수 없어(마크 "해제"라는 사건이 발생 불가) 은퇴 근거가 성립한다. 누출 방어는
   * ①BuildVariants.executeObjectTree 의 트리 수준 answer:true 필터(+stripElementsByClass 2차방어)
   * ②ValidateWorksheet 의 개체 트리 2층(구조 error + 렌더 HTML 누출 grep)으로 유지한다 — HTML manifest
   * 저장 경로(execute())는 여전히 contenteditable 이 남아 있는 동안 #detectDroppedMarks 를 존치한다.
   *
   * @param {{name:string, document:object, checkpointName?:string|null, now?:Date}} args
   *   document: {pagination, pages, docTitle?, subject?, dataSubject?, themeName?, lang?, runHead?,
   *   runFoot?, head?:{katex?}, paper?, standards?:Array<{code,text}>} — pagination/pages 는
   *   ValidateObjectTree/RenderObjectTree 스키마 그대로, 나머지는 렌더·meta.json 부가정보(legacy
   *   manifest 와 동형으로 메타데이터+pages 를 한 봉투에 담는다). standards 는 이미 해석된 원문이어야
   *   한다(RenderObjectTree 계약 — 여기서 CSV/MCP 를 조회하지 않는다, 원칙 3).
   *   checkpointName: 명명 체크포인트면 meta.checkpoints 이력에 기록(workspace.js#buildMeta).
   * @returns {Promise<{name:string, paths:object, meta:object, document:object, unsafe:boolean, leakFindings:object[]}>}
   */
  async checkpoint({ name, document, checkpointName = null, now = new Date() }) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new TypeError('SaveDocument.checkpoint 는 개체 트리 문서(document)가 필요합니다.');
    }
    document = normalizePageIdentity(document, { repairInvalid: false });
    const layout = this.workspace.layout(name);

    const assets = await loadRenderAssets(this.repo, document);
    const renderMeta = deriveRenderMeta(document);
    const { student, teacher } = new BuildVariants().executeObjectTree(document, assets, renderMeta);

    const knownSubjectHexes = await loadKnownSubjectHexes(this.repo);
    const validator = new ValidateWorksheet({ knownSubjectHexes, paper: document.paper });
    // teacher: 개체 트리 경로(구조 error 승격) + 렌더 HTML 누출 grep 2층을 한 호출로 수행.
    // student: HTML 문자열 경로만(구조 검증은 teacher 쪽에서 이미 수행 — 중복 불필요).
    const leakFindings = [
      ...validator.execute(document, teacher).findings,
      ...validator.execute(student).findings,
    ].filter((f) => f.severity === 'error');
    const unsafe = leakFindings.length > 0;

    if (!this.workspace.docExists(layout.name)) await this.workspace.createDoc(layout.name);
    // 쓰기 순서(부분쓰기 감지 계약): manifest → HTML → 스냅샷 → meta(커밋 마커 최종) — execute() 와 동형.
    await this.workspace.writeManifest(layout.name, document);
    await this.workspace.writeVariantHtml(layout.name, unsafe ? { teacher } : { student, teacher });
    if (unsafe) await this.workspace.removeStudentHtml(layout.name);
    const serial = nextSnapshotSerial(await this.workspace.listSnapshots(layout.name));
    await this.workspace.writeSnapshot(layout.name, snapshotName(serial, now), document);
    const prev = await this.workspace.readMeta(layout.name);
    const meta = buildMeta(layout.name, document, { now, prev, unsafe, checkpointName, serial });
    await this.workspace.writeMeta(layout.name, meta);

    return { name: layout.name, paths: layout, meta, document, unsafe, leakFindings };
  }
}
