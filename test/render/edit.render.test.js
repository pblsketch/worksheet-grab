import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);
const quiet = () => {};

// US-M4-3 수용(재렌더): 편집 후 CLI 재렌더가 유효한 A4 PDF 를 산출한다.
test('US-M4-3: edit → 재렌더가 유효 PDF 산출(페이지 잘림 없음)', { skip: !READY, timeout: 180000 }, async () => {
  const dir = await autoTmpDir('wsg-editr-');

  // 생성(렌더 없이 manifest 확보)
  await run(['generate', '중2과학', '광합성', '--out', dir], { root: ROOT, log: quiet, err: quiet });
  const manifestPath = join(dir, 'science-광합성.manifest.json');
  assert.ok(existsSync(manifestPath), 'manifest.json 산출');

  // 편집 + 재렌더(--no-render 미지정)
  const code = await run(
    ['edit', manifestPath, '3번 문항 빼고 성찰 추가', '--out', dir],
    { root: ROOT, log: quiet, err: quiet },
  );
  assert.equal(code, 0, 'edit(재렌더 포함) 성공');

  // PDF 산출 확인 — G4: 편집본은 원본 보존을 위해 -v2 베이스로 산출된다.
  const files = await readdir(dir);
  const pdfs = files.filter((f) => f.endsWith('.pdf'));
  assert.ok(pdfs.includes('science-광합성-v2-student.pdf'), 'student PDF 재렌더(-v2)');
  assert.ok(pdfs.includes('science-광합성-v2-teacher.pdf'), 'teacher PDF 재렌더(-v2)');

  for (const pdf of ['science-광합성-v2-student.pdf', 'science-광합성-v2-teacher.pdf']) {
    const pages = await countPdfPages(join(dir, pdf));
    assert.ok(pages >= 2 && pages <= 4, `${pdf} 페이지수 정상(2~4): ${pages}`);
  }
});
