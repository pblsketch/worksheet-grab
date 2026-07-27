import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tmp.js — 렌더/단위 테스트 공용 wsg-* 임시 디렉터리 정리 훅(US-20 §산출 2).
//
// 배경(MEMORY: render-temp-disk-exhaustion): 렌더 테스트가 만드는 Chrome userDataDir·워크스페이스
// 임시 디렉터리가 실행마다 누적되면 C: 드라이브가 소진돼 무작위 Chrome 500/타임아웃을 유발한다.
// 대부분의 렌더 헬퍼는 자신이 만든 Chrome userDataDir 는 이미 개별적으로 rmSync 하지만(각 파일의
// dumpDom 관례), 워크스페이스 base 디렉터리(FsWorkspaceRepository 용)는 정리하지 않는 파일이 많고
// 단위 테스트(test/unit/**)는 대부분 아예 정리하지 않는다(감사: mkdtemp 호출 20여 곳, rmSync 0곳).
//
// 정책: 접두사 `wsg-` 로 시작하는 항목만 대상(과도한 전역 삭제 금지). 종료 시 자기 정리는
// makeTmpDir()/makeTmpDirSync() 가 반환하는 cleanup() 을 호출부가 finally 에서 부르는 관례로,
// 시작 시 잔존 청소는 sweepStaleWsgTmp() 가 60분(기본) 이상 지난 항목만 삭제한다(현재 실행 중인
// 다른 테스트의 tmp 를 건드리지 않도록 나이 기준을 둔다).

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
// 조용히 삼키고 sweepStaleWsgTmp() 의 60분 재시도에 맡긴다(설계된 최종 안전망).
function safeCleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* 다음 sweepStaleWsgTmp() 스윕에서 재시도 */
  }
}

/** wsg-* 임시 디렉터리를 비동기로 만들고, 호출부가 finally 에서 부를 cleanup() 을 함께 반환한다. */
export async function makeTmpDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => safeCleanup(dir) };
}

/** makeTmpDir 의 동기판(Chrome userDataDir 등 즉시 값이 필요한 자리). */
export function makeTmpDirSync(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => safeCleanup(dir) };
}
