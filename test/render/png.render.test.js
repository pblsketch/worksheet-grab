import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);
const quiet = () => {};

// PNG 시그니처(\x89PNG\r\n\x1a\n) 확인.
async function isPng(path) {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

// US-M6-1 수용: generate --png 가 PDF 와 별개의 PNG 파일을 산출한다.
test('US-M6-1: generate --png → student/teacher PNG 산출(유효 PNG)', { skip: !READY, timeout: 180000 }, async () => {
  const dir = await autoTmpDir('wsg-png-');
  const code = await run(['generate', '중2과학', '광합성', '--out', dir, '--png'], { root: ROOT, log: quiet, err: quiet });
  assert.equal(code, 0, 'generate --png 성공');

  for (const mode of ['student', 'teacher']) {
    const p = join(dir, `science-광합성-${mode}.png`);
    assert.ok(existsSync(p), `${mode} PNG 산출`);
    const s = await stat(p);
    assert.ok(s.size > 1000, `${mode} PNG 비어있지 않음(${s.size}B)`);
    assert.ok(await isPng(p), `${mode} 유효 PNG 시그니처`);
  }
});
