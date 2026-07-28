import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

// tmp.js — 렌더/단위 테스트 공용 wsg-* 임시 디렉터리 정리 훅(US-20 §산출 2).
//
// 배경(MEMORY: render-temp-disk-exhaustion): 렌더 테스트가 만드는 Chrome userDataDir·워크스페이스
// 임시 디렉터리가 실행마다 누적되면 C: 드라이브가 소진돼 무작위 Chrome 500/타임아웃을 유발한다.
// 대부분의 렌더 헬퍼는 자신이 만든 Chrome userDataDir 는 이미 개별적으로 rmSync 하지만(각 파일의
// dumpDom 관례), 워크스페이스 base 디렉터리(FsWorkspaceRepository 용)는 정리하지 않는 파일이 많고
// 단위 테스트(test/unit/**)는 대부분 아예 정리하지 않는다(감사: mkdtemp 호출 20여 곳, rmSync 0곳).
//
// 정책: 접두사 `wsg-` 로 시작하는 항목만 대상(과도한 전역 삭제 금지). 정리 통로는 3겹이다.
//   ① makeTmpDir()/makeTmpDirSync() — 호출부가 finally 에서 cleanup() 을 부르는 즉시 정리.
//      Chrome userDataDir 처럼 "다음 렌더 전에 지금 지워야" 하는 자리에 쓴다.
//   ② autoTmpDir()/autoTmpDirSync() — 파일 종료 시 after() 훅이 일괄 정리(호출부 코드 불필요).
//      워크스페이스 base 처럼 파일이 끝날 때까지 살아 있어야 하는 자리에 쓴다.
//   ③ sweepStaleWsgTmp() — 시작 시 잔존 청소. **60분(기본) 이상 지난 것만** 지운다.
//      나이 기준은 성능 옵션이 아니라 안전장치다(병행 세션의 실행 중 tmp 를 지우지 않기 위한 것).
// ①이 실패한 것은 ②가 다시 시도하고, ②까지 실패한 것은 ③이 다음 실행에서 거둔다.

const STALE_MS_DEFAULT = 60 * 60 * 1000; // 60분

/** 시작 시 1회: os.tmpdir() 아래 `wsg-` 접두사 항목 중 ageMs 이상 지난 것만 청소한다.
 *  반환: 삭제 시도한 개수(실패는 조용히 건너뜀 — 사용 중인 다른 프로세스의 디렉터리일 수 있음). */
export function sweepStaleWsgTmp(ageMs = STALE_MS_DEFAULT) {
  const root = tmpdir();
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith('wsg-')) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (now - st.mtimeMs < ageMs) continue;
    try {
      rmSync(full, { recursive: true, force: true, maxRetries: 3 });
      removed++;
    } catch {
      // 사용 중이거나 권한 문제 — 다음 스윕에서 재시도, 여기서 실패를 테스트 실패로 만들지 않는다.
    }
  }
  return removed;
}

/** os.tmpdir() 아래 wsg-* 항목 개수(정리 훅 검증용 — 실행 전/후 잔존 비교). */
export function countWsgTmp() {
  const root = tmpdir();
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  return entries.filter((n) => n.startsWith('wsg-') && existsSync(join(root, n))).length;
}

// Windows 에서는 Chrome 프로세스 종료 직후에도 아주 짧게 파일 핸들이 안 풀려 rmSync 가
// EBUSY/EPERM 으로 실패할 때가 있다(us19.md 에 기록된 것과 동형 현상). cleanup() 이 여기서
// 던지면 호출부(테스트의 finally)에서 원래 실패 사유를 가리며 되레 진단을 어렵게 만든다 —
// 조용히 삼키고 파일 종료 시 재시도 · sweepStaleWsgTmp() 의 60분 스윕에 맡긴다(최종 안전망).
/** 삭제를 시도하고 성공 여부를 돌려준다(던지지 않는다). */
function tryRemove(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return true;
  } catch {
    return false;
  }
}

function safeCleanup(dir) {
  tryRemove(dir);
}

/** wsg-* 임시 디렉터리를 비동기로 만들고, 호출부가 finally 에서 부를 cleanup() 을 함께 반환한다. */
export async function makeTmpDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tracked.push(dir);
  return { dir, cleanup: () => safeCleanup(dir) };
}

/** makeTmpDir 의 동기판(Chrome userDataDir 등 즉시 값이 필요한 자리). */
export function makeTmpDirSync(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tracked.push(dir);
  return { dir, cleanup: () => safeCleanup(dir) };
}

// ── 자동 정리판(2026-07-28) ────────────────────────────────────────────────
// makeTmpDir 는 호출부가 finally 에서 cleanup() 을 부르는 관례라, 서버 종료 순서를 손으로
// 챙겨야 하는 렌더 테스트에는 맞지만 **단위 테스트에는 맞지 않는다** — mkdtemp 호출 80곳 중
// try/finally 를 가진 파일이 24개 중 5개뿐이라, 관례를 그대로 적용하려면 80곳을 구조 개편해야
// 한다. 그래서 파일 단위 after() 훅에 정리를 위임하는 변형을 둔다(호출부는 한 줄 치환).
//
// 등록을 **모듈 최상위에서** 하는 것이 핵심이다. 첫 호출 때 지연 등록하면 그 시점에 실행 중인
// 테스트의 훅으로 붙어 **그 테스트 하나만** 청소하고 끝난다(실측: dirA/dirB/dirC 중 dirA 만
// 지워짐). 최상위 등록이면 실패한 테스트가 만든 것까지 파일 종료 시 일괄 정리된다(실측 확인).
//
// node --test 는 테스트 파일마다 별도 프로세스를 쓰므로 이 배열은 파일 스코프로 격리된다.
//
// makeTmpDir/makeTmpDirSync 가 만든 것도 여기에 함께 실린다 — 그쪽 cleanup() 은 즉시 정리라
// Chrome 이 막 죽은 직후엔 EPERM 으로 실패하는데(아래 실측), 이 훅이 한 박자 뒤 다시 시도해
// 준다. 이미 지워진 디렉터리를 또 지우는 것은 force:true 라 무해하다.
const tracked = [];

// 파일 종료 시 2패스 정리. 1패스는 즉시(대부분 여기서 끝난다), 실패분만 잠깐 쉬었다 재시도한다.
//
// 왜 재시도가 필요한가(2026-07-28 실측): 렌더 전량 실행 직후 71건이 남았는데, **몇 분 뒤 같은
// 목록을 지우니 79건 중 78건이 성공**했다 — 영구 잠김이 아니라 Chrome·편집기 서버 종료 직후
// 핸들이 잠깐 안 풀리는 것뿐이고, rmSync 의 기본 재시도(maxRetries:3 ≈ 300ms)가 그보다 짧았다.
// 실패분에만 지연을 물리므로 정상 경로의 실행 시간은 늘지 않는다.
const RETRY_DELAY_MS = 800;

after(async () => {
  const dirs = tracked.splice(0);
  const failed = dirs.filter((dir) => !tryRemove(dir));
  if (!failed.length) return;
  await new Promise((resolve) => { setTimeout(resolve, RETRY_DELAY_MS); });
  for (const dir of failed) tryRemove(dir);
});

/** wsg-* 임시 디렉터리를 만들고 파일 종료 시 자동 정리 목록에 올린다(호출부 정리 불필요). */
export async function autoTmpDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tracked.push(dir);
  return dir;
}

/** autoTmpDir 의 동기판(Chrome userDataDir 등 즉시 값이 필요한 자리). */
export function autoTmpDirSync(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tracked.push(dir);
  return dir;
}
