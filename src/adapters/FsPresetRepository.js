import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { emptyIndex, validateIndex } from '../usecases/presets.js';

// FsPresetRepository — 프리셋 인덱스(<baseDir>/.presets/presets.json)의 파일 IO.
// 프리셋은 여러 문서에 재사용되는 공유 자산이라 손상 폭발 반경이 개별 문서보다 크다 —
// 쓰기는 tmp→(기존본 .bak 보존)→rename 원자 교체, 읽기는 정합 실패 시 .bak 폴백,
// 둘 다 실패하면 빈 인덱스 + 경고(작업은 계속 가능, 조용한 손실 금지).
export class FsPresetRepository {
  /** @param {{baseDir:string}} opts baseDir = 워크스페이스 루트(FsWorkspaceRepository.baseDir 공유) */
  constructor({ baseDir }) {
    if (!baseDir) throw new TypeError('FsPresetRepository 는 baseDir 가 필요합니다.');
    this.baseDir = resolve(baseDir);
    this.dir = join(this.baseDir, '.presets');
    if (!this.dir.startsWith(this.baseDir + sep)) throw new Error('경로 이탈이 차단되었습니다.');
    this.indexPath = join(this.dir, 'presets.json');
    this.bakPath = join(this.dir, 'presets.bak.json');
    this.tmpPath = join(this.dir, 'presets.json.tmp');
  }

  /** @returns {Promise<{index:object, warning:string|null}>} */
  async readIndex() {
    for (const [path, isBak] of [[this.indexPath, false], [this.bakPath, true]]) {
      if (!existsSync(path)) continue;
      try {
        const index = JSON.parse(await readFile(path, 'utf8'));
        if (validateIndex(index)) {
          return { index, warning: isBak ? '프리셋 인덱스가 손상되어 백업본으로 복구했습니다.' : null };
        }
      } catch { /* 손상 — 다음 후보(백업) 시도 */ }
    }
    return {
      index: emptyIndex(),
      warning: existsSync(this.indexPath) ? '프리셋 인덱스·백업이 모두 손상되어 빈 목록으로 시작합니다.' : null,
    };
  }

  async writeIndex(index) {
    await mkdir(this.dir, { recursive: true });
    if (existsSync(this.indexPath)) await copyFile(this.indexPath, this.bakPath);
    await writeFile(this.tmpPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
    await rename(this.tmpPath, this.indexPath);
  }
}
