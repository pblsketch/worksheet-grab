import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('CLI 도움말은 내부 개발 코드 대신 사용자 용어를 쓴다', () => {
  const help = execFileSync(process.execPath, [join(ROOT, 'bin', 'worksheet-grab.js'), 'help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(help, /활동지 제작·편집 도구 \(베타\)/);
  for (const term of [
    'M1', 'M6', 'E3', 'E5', 'Phase 4', 'US-19', 'B′',
    'HITL', 'fail-closed', '스캐폴드', 'designer AI',
    'batchList', 'buildDocName', 'countPdfPages',
  ]) {
    assert.ok(!help.includes(term), `CLI 도움말에 내부 용어가 남음: ${term}`);
  }
});
