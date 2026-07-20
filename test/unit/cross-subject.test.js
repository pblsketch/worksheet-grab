import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum, DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { GenerateWorksheet } from '../../src/usecases/GenerateWorksheet.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { ValidateWorksheet } from '../../src/usecases/ValidateWorksheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CSV = existsSync(DEFAULT_CSV_PATH);

// 4교과 × (학년교과, 주제). 주제는 각 교과 성취기준에서 실제 매칭되는 키워드.
const SUBJECTS = [
  { gradeSubject: '중3국어', topic: '매체' },
  { gradeSubject: '중2과학', topic: '광합성' },
  { gradeSubject: '중2사회', topic: '인구' },
  { gradeSubject: '중2영어', topic: '감정' },
];

// 공통 코어 블록(교과 무관): 헤더·성취기준 라벨·번호 섹션 헤딩·루브릭.
const CORE_MARKERS = [
  { name: 'header', re: /class="(?:wsheet-title-wrap|title-wrap)"/ },
  { name: 'standard-label', re: /class="std-box"/ },
  { name: 'section-heading', re: /<h2 class="sec">/ },
  { name: 'rubric', re: /class="rubric"/ },
];

test('US-M5-3: 공통 코어 블록이 국어·과학·사회·영어 4교과에서 검증 통과', { skip: !HAS_CSV, timeout: 60000 }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const curriculum = new GepaiCurriculum({}); // MCP off, CSV
  const themes = await repo.listThemes();
  const knownSubjectHexes = [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
  const validator = new ValidateWorksheet({ knownSubjectHexes });

  assert.ok(SUBJECTS.length >= 4, '≥4교과');

  for (const { gradeSubject, topic } of SUBJECTS) {
    const m = /^([초중고]\s*\d*)\s*(.+)$/.exec(gradeSubject);
    const grade = m[1];
    const subject = m[2];
    const gen = new GenerateWorksheet({ blockRepository: repo, curriculum });
    const { html } = await gen.execute({ grade, subject, topic });
    const { student, teacher } = new BuildVariants().execute(html);

    // 공통 코어 블록 존재
    for (const { name, re } of CORE_MARKERS) {
      assert.match(html, re, `${subject}: 코어 블록 ${name} 존재`);
    }

    // 검증 통과: student/teacher 모두 error 0, 인쇄안전 warning(margin/keep) 0
    for (const [mode, doc] of [['student', student], ['teacher', teacher]]) {
      const { ok, findings } = validator.execute(doc);
      assert.equal(ok, true, `${subject}/${mode}: 검증 error 없음`);
      const printWarn = findings.filter((f) => ['print-margin', 'keep-together', 'min-font'].includes(f.rule));
      assert.equal(printWarn.length, 0, `${subject}/${mode}: 인쇄안전 위반 없음 (${printWarn.map((f) => f.rule).join(',')})`);
      const colorWarn = findings.filter((f) => f.rule === 'hardcoded-subject-color');
      assert.equal(colorWarn.length, 0, `${subject}/${mode}: 하드코딩 교과색 없음`);
    }
  }
});
