import { GenerateWorksheet } from './GenerateWorksheet.js';
import { BuildVariants } from './BuildVariants.js';
import { ValidateWorksheet } from './ValidateWorksheet.js';
import { loadKnownSubjectHexes } from './renderAssets.js';

// RunPipeline — 교사의 한 문장(학년교과+주제)을 종단 구동한다:
//   성취기준 조회 → 조립(generate) → 2벌 분기(build-variants) → 검수 게이트(validate).
// 검수 게이트는 fail-closed: student/teacher 어느 쪽이든 정답 누출(error)이면 gate=false.
// 렌더는 IO 이므로 이 유스케이스가 아니라 바깥(CLI)에서 게이트 통과 후 수행한다.
// Chrome/파일시스템 불필요 → 목 없이 단위 테스트 가능.
export class RunPipeline {
  /** @param {{blockRepository, curriculum}} deps */
  constructor({ blockRepository, curriculum }) {
    if (!blockRepository) throw new TypeError('RunPipeline 은 BlockRepository 가 필요합니다.');
    if (!curriculum) throw new TypeError('RunPipeline 은 CurriculumProvider 가 필요합니다.');
    this.repo = blockRepository;
    this.curriculum = curriculum;
  }

  /**
   * @param {{grade:string, subject:string, topic:string, limit?:number, codes?:string[]}} args
   * @returns {Promise<{html,student,teacher,worksheet,standards,review,gate,manifest}>}
   */
  async execute({ grade, subject, topic, limit = 6, codes = null }) {
    // 1) 성취기준 조회 + 조립
    const gen = new GenerateWorksheet({ blockRepository: this.repo, curriculum: this.curriculum });
    const { html, worksheet, standards, manifest } = await gen.execute({ grade, subject, topic, limit, codes });

    // 2) 학생용/교사용 2벌
    const { student, teacher } = new BuildVariants().execute(html);

    // 3) 검수 게이트(정답 누출·하드코딩 교과색). 교과 팔레트는 테마에서 도출.
    const knownSubjectHexes = await loadKnownSubjectHexes(this.repo);
    const validator = new ValidateWorksheet({ knownSubjectHexes, paper: manifest.paper });
    const review = {
      student: validator.execute(student),
      teacher: validator.execute(teacher),
    };
    const gate = review.student.ok && review.teacher.ok;

    return { html, student, teacher, worksheet, standards, review, gate, manifest };
  }
}
