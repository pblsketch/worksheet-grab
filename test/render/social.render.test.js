import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { ValidateWorksheet } from '../../src/usecases/ValidateWorksheet.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

async function knownSubjectHexes() {
  const repo = new FsBlockRepository({ root: ROOT });
  const themes = await repo.listThemes();
  return [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);
const quiet = () => {};

// US-M5-1 수용: 사회 교과가 자체 블록(지도·연표)·테마로 student/teacher A4 PDF 로 렌더된다.
test('US-M5-1: generate 중2사회 → 지도·연표 블록 + social 테마, A4 PDF 렌더', { skip: !READY, timeout: 180000 }, async () => {
  const dir = await autoTmpDir('wsg-social-');
  const code = await run(['generate', '중2사회', '인구', '--out', dir, '--pdf'], { root: ROOT, log: quiet, err: quiet });
  assert.equal(code, 0, 'generate 사회 성공');

  const student = await readFile(join(dir, 'social-인구-student.html'), 'utf8');
  assert.match(student, /data-subject="social"/, 'social data-subject');
  assert.match(student, /class="mapbox"/, '지도 블록');
  assert.match(student, /class="timeline"/, '연표 블록');
  assert.match(student, /--c:\s*#b26a00/, 'social 테마 토큰 주입');
  // 범교과: 사회 색을 :root 밖에서 하드코딩하지 않았는지 — 검증기로 확인(권위 있는 체크).
  const hexes = await knownSubjectHexes();
  const v = new ValidateWorksheet({ knownSubjectHexes: hexes }).execute(student);
  assert.ok(!v.findings.some((f) => f.rule === 'hardcoded-subject-color'), '하드코딩 교과색 위반 없음');
  assert.ok(!v.findings.some((f) => f.rule === 'answer-leak'), '정답 누출 없음');

  for (const mode of ['student', 'teacher']) {
    const pages = await countPdfPages(join(dir, `social-인구-${mode}.pdf`));
    assert.ok(pages >= 2 && pages <= 3, `social-${mode} 페이지수 정상: ${pages}`);
  }
});
