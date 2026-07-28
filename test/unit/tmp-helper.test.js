import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { autoTmpDir } from '../helpers/tmp.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER_URL = pathToFileURL(join(ROOT, 'test/helpers/tmp.js')).href;

// test/helpers/tmp.js 자체의 회귀 방어. 이 헬퍼가 지키는 성질은 "테스트가 %TEMP% 를 남기지
// 않는다"인데, 그건 **자식 프로세스를 끝까지 돌려야** 관측된다 — after() 훅은 파일이 끝날 때
// 도는지라 같은 프로세스 안에서는 볼 수 없다. 그래서 픽스처 테스트 파일을 만들어
// `node --test` 로 돌린 뒤 남은 것을 밖에서 센다.
//
// **자식의 TMPDIR 을 샌드박스로 돌린다.** 단위 스위트는 파일 간 병렬 실행이라, 진짜
// os.tmpdir() 를 대상으로 세거나 쓸면 같이 돌고 있는 다른 테스트의 임시 디렉터리를 세거나
// 지우게 된다(sweepStaleWsgTmp(0) 이 특히 위험 — 그 사고가 실제로 있었다).
//
// 여기서 고정하는 함정 3건(전부 2026-07-28 실측으로 발견):
//   ① after() 지연 등록 — 첫 사용 때 등록하면 실행 중인 그 테스트의 훅이 되어 **하나만** 지운다.
//   ② 실패한 테스트가 만든 것도 정리되어야 한다.
//   ③ 즉시 정리(cleanup())가 실패해도 파일 종료 훅이 거둬야 한다(Windows 핸들 지연).

/** 샌드박스 TMPDIR 에서 픽스처 테스트 파일을 돌리고, 그 TMPDIR 경로와 종료코드를 돌려준다. */
async function runFixture(body) {
  const sandbox = await autoTmpDir('wsg-tmphelper-sandbox-'); // 이 파일 종료 시 자동 정리
  const suiteDir = join(sandbox, 'suite');
  const tempHome = join(sandbox, 'temp');
  mkdirSync(suiteDir, { recursive: true });
  mkdirSync(tempHome, { recursive: true });
  const file = join(suiteDir, 'fixture.test.js');
  writeFileSync(file, body.replaceAll('__HELPER__', HELPER_URL), 'utf8');

  const env = { ...process.env, TMPDIR: tempHome, TEMP: tempHome, TMP: tempHome };
  // 이 파일 자체가 `node --test` 아래서 돌기 때문에 NODE_TEST_CONTEXT=child-v8 ·
  // NODE_TEST_WORKER_ID 가 환경에 실려 있다. 그대로 물려주면 손자 러너가 IPC 리포터 모드로
  // 붙으려다 **테스트를 한 건도 실행하지 않고 종료코드 0** 으로 끝난다 — 잔존이 0 이니
  // 단정이 전부 통과하는 헛통과가 된다(변이 실험으로 발견: 정리 로직을 고장 내도 초록이었다).
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;

  let code = 0;
  let stdout = '';
  try {
    const r = await execFileAsync(process.execPath, ['--test', file], { cwd: ROOT, env });
    stdout = r.stdout;
  } catch (e) {
    code = typeof e.code === 'number' ? e.code : 1;
    stdout = String(e.stdout ?? '');
  }
  // 헛통과 방어: 픽스처가 실제로 돌았는지 확인한다(0건 실행이면 잔존도 0 이라 단정이 무의미).
  // 리포터는 spec(`ℹ pass 3`)이지만 TAP(`# pass 3`)으로 바뀌어도 읽히게 둘 다 받는다.
  const count = (label) => Number(new RegExp(`^[ℹ#]\\s*${label} (\\d+)`, 'm').exec(stdout)?.[1] ?? 0);
  return { tempHome, code, ran: count('pass') + count('fail') };
}

/** 샌드박스 TMPDIR 에 남은 wsg-* 개수(픽스처가 만든 것만 보인다). */
const leftover = (tempHome) => readdirSync(tempHome).filter((n) => n.startsWith('wsg-'));

test('autoTmpDir: 파일 종료 시 만든 것을 전부 정리한다 — 실패한 테스트가 만든 것까지', async () => {
  const { tempHome, ran } = await runFixture(`
    import { test } from 'node:test';
    import { autoTmpDir } from '__HELPER__';
    test('a', async () => { await autoTmpDir('wsg-probe-'); });
    test('b', async () => { await autoTmpDir('wsg-probe-'); });
    test('c 일부러 실패', async () => { await autoTmpDir('wsg-probe-'); throw new Error('의도된 실패'); });
  `);
  assert.equal(ran, 3, '픽스처 3건이 실제로 실행됐다(헛통과 방어)');
  // 지연 등록 회귀면 첫 테스트 것만 지워져 2개가 남는다.
  assert.deepEqual(leftover(tempHome), [], '3개 모두 정리(지연 등록 회귀 시 2개 잔존)');
});

test('makeTmpDirSync: 즉시 cleanup() 을 못 불러도 파일 종료 훅이 거둔다', async () => {
  // cleanup() 미호출 = 즉시 정리가 EPERM 으로 실패한 상황과 동치. 그래도 회수되어야 한다.
  const { tempHome, ran } = await runFixture(`
    import { test } from 'node:test';
    import { makeTmpDirSync, makeTmpDir } from '__HELPER__';
    test('sync cleanup 미호출', () => { makeTmpDirSync('wsg-probe-sync-'); });
    test('async cleanup 미호출', async () => { await makeTmpDir('wsg-probe-async-'); });
  `);
  assert.equal(ran, 2, '픽스처 2건이 실제로 실행됐다(헛통과 방어)');
  assert.deepEqual(leftover(tempHome), [], '즉시 정리를 안 해도 파일 종료 시 회수된다');
});

test('sweepStaleWsgTmp: 기본 나이 기준은 갓 만든 것을 보호한다(병행 세션 안전장치)', async () => {
  // 판정은 자식 안에서 한다 — 진짜 os.tmpdir() 를 쓸면 병렬 실행 중인 남의 tmp 가 날아간다.
  const { tempHome, code, ran } = await runFixture(`
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { existsSync, mkdtempSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { sweepStaleWsgTmp, countWsgTmp } from '__HELPER__';

    test('기본 인자는 지우지 않는다', () => {
      const fresh = mkdtempSync(join(tmpdir(), 'wsg-fresh-'));
      const before = countWsgTmp();
      sweepStaleWsgTmp();                       // 인자 없음 = 60분 기준
      assert.ok(existsSync(fresh), '갓 만든 것은 살아 있어야 한다');
      assert.equal(countWsgTmp(), before, '개수도 그대로');
      sweepStaleWsgTmp(0);                      // 보호 해제 — 샌드박스 안이라 안전
      assert.equal(existsSync(fresh), false, '(0) 은 실행 중인 것까지 지운다');
    });
  `);
  assert.equal(ran, 1, '픽스처 1건이 실제로 실행됐다(헛통과 방어)');
  assert.equal(code, 0, '자식 단정 통과');
  assert.deepEqual(leftover(tempHome), [], '픽스처가 남긴 것 없음');
});
