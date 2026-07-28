import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { autoTmpDir } from '../helpers/tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = join(ROOT, 'bin', 'worksheet-grab.js');
const HAS_CSV = existsSync(DEFAULT_CSV_PATH);

function runBin(args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolvePromise({ code, out, err }));
  });
}

// US-M6-2 수용: 설치형 CLI 가 임의 작업 디렉토리(새 환경 모사)에서 한 문장으로 활동지를 생성한다.
// root 는 bin 경로 기준으로 해결되므로 CWD 와 무관해야 한다.
test('US-M6-2: 새 환경 스모크 — 임의 CWD 에서 pipeline 한 문장 생성', { skip: !HAS_CSV, timeout: 60000 }, async () => {
  const alienCwd = await autoTmpDir('wsg-cwd-');   // 리포와 무관한 CWD
  const outDir = await autoTmpDir('wsg-out-');

  const { code, out, err } = await runBin(
    ['pipeline', '중2과학', '광합성', '--out', outDir, '--no-render'],
    alienCwd,
  );

  assert.equal(code, 0, `pipeline 종료코드 0 (stderr: ${err.slice(-300)})`);
  assert.match(out, /검수 게이트: PASS/, '검수 게이트 통과');
  assert.ok(existsSync(join(outDir, 'science-광합성.manifest.json')), '매니페스트 산출');
  assert.ok(existsSync(join(outDir, 'science-광합성-student.html')), 'student HTML 산출');
  assert.ok(existsSync(join(outDir, 'science-광합성-teacher.html')), 'teacher HTML 산출');
});

test('US-M6-2: help 는 CWD 무관하게 동작(설치형 진입점 확인)', async () => {
  const alienCwd = await autoTmpDir('wsg-help-');
  const { code, out } = await runBin(['help'], alienCwd);
  assert.equal(code, 0);
  assert.match(out, /pipeline/, 'help 에 pipeline 명령 노출');
  assert.match(out, /edit/, 'help 에 edit 명령 노출');
});
