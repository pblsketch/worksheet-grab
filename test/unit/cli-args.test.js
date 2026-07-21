// CLI 인자 처리 회귀(QA 발견분): 값 필수 플래그 fail-fast · 다단어 주제 흡수.
// bin 을 거치지 않고 run() 인프로세스 호출 — 종료코드·메시지를 직접 계측한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CSV_READY = existsSync(DEFAULT_CSV_PATH);

function capture() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

test('값 필수 플래그가 값 없이 오면 즉시 사용법 오류(exit 2) — 저수준 타입 오류 노출 금지', async () => {
  const io = capture();
  const code = await run(['render', 'poc/whatever.html', '--out'], { root: ROOT, ...io });
  assert.equal(code, 2);
  assert.match(io.lines.join('\n'), /--out 플래그에 값이 필요합니다/);
});

test('값 필수 플래그: --doc 도 동일 정책(bare --doc 이 조용히 out/ 로 새지 않는다)', async () => {
  const io = capture();
  const code = await run(['pipeline', '중2과학', '광합성', '--doc'], { root: ROOT, ...io });
  assert.equal(code, 2);
  assert.match(io.lines.join('\n'), /--doc 플래그에 값이 필요합니다/);
});

test('다단어 주제: 뒷 토큰이 조용히 잘리지 않고 주제로 흡수된다(fail-open 방지)', { skip: !CSV_READY }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-cliargs-'));
  const io = capture();
  // "광합성 작용" 전체가 주제로 전달됐음을 성취기준 조회 오류 메시지로 계측
  // (과거: "작용" 유실 + exit 0 오생성).
  await assert.rejects(
    run(['generate', '중2과학', '광합성', '작용', '--no-render', '--out', dir], { root: ROOT, ...io }),
    /광합성 작용/,
  );
});

test('다단어 주제 + 띄어 쓴 학년교과("중2 과학") 조합도 동일하게 흡수된다', { skip: !CSV_READY }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-cliargs-'));
  const io = capture();
  await assert.rejects(
    run(['generate', '중2', '과학', '광합성', '작용', '--no-render', '--out', dir], { root: ROOT, ...io }),
    /광합성 작용/,
  );
});
