import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { ValidateWorksheet } from '../../src/usecases/ValidateWorksheet.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);
const quiet = () => {};

async function knownSubjectHexes() {
  const repo = new FsBlockRepository({ root: ROOT });
  const themes = await repo.listThemes();
  return [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
}

// US-M5-2 수용: 영어 교과가 자체 블록(어휘·대화문)·테마로 student/teacher A4 PDF 로 렌더된다.
test('US-M5-2: generate 중2영어 → 어휘·대화문 블록 + english 테마, A4 PDF 렌더', { skip: !READY, timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-english-'));
  const code = await run(['generate', '중2영어', '감정', '--out', dir, '--pdf'], { root: ROOT, log: quiet, err: quiet });
  assert.equal(code, 0, 'generate 영어 성공');

  const student = await readFile(join(dir, 'english-감정-student.html'), 'utf8');
  assert.match(student, /data-subject="english"/, 'english data-subject');
  assert.match(student, /class="vocab"/, '어휘 블록');
  assert.match(student, /class="dialogue"/, '대화문 블록');
  assert.match(student, /--c:\s*#3949ab/, 'english 테마 토큰 주입');

  const hexes = await knownSubjectHexes();
  const v = new ValidateWorksheet({ knownSubjectHexes: hexes }).execute(student);
  assert.ok(!v.findings.some((f) => f.rule === 'hardcoded-subject-color'), '하드코딩 교과색 위반 없음');
  assert.ok(!v.findings.some((f) => f.rule === 'answer-leak'), '정답 누출 없음');

  for (const mode of ['student', 'teacher']) {
    const pages = await countPdfPages(join(dir, `english-감정-${mode}.pdf`));
    assert.ok(pages >= 2 && pages <= 3, `english-${mode} 페이지수 정상: ${pages}`);
  }
});
