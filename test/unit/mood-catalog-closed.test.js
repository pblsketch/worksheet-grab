import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';

// P4: "교사 목적 → 닫힌 5무드 이름만 선택" 규약의 닫힌 목록 보증. 에이전트/스킬 문서가 참조하는
// 무드 목록이 엔진의 단일 진실 원천(themes/moods/*.css == listMoods())과 어긋나지 않는지 가드한다.
// 무드를 추가/제거하면 이 테스트가 빨개져 P4 규약 문서(themes.md·worksheet-planner/designer) 동기화를 강제한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLOSED_MOODS = ['angular', 'calm', 'exam', 'soft', 'wide'];

test('P4: 무드 카탈로그가 닫힌 5종 그대로(listMoods == themes/moods/*.css == 규약 문서)', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const moods = (await repo.listMoods()).slice().sort();
  assert.deepEqual(moods, CLOSED_MOODS,
    `무드 카탈로그는 닫힌 5종이어야 함(변경 시 P4 규약 문서 동기화 필요): ${moods.join(',')}`);

  // 2차 원천 금지: 파일 시스템 목록과 listMoods() 가 정확히 일치.
  const files = (await readdir(join(ROOT, 'themes', 'moods')))
    .filter((f) => f.endsWith('.css'))
    .map((f) => f.replace(/\.css$/, ''))
    .sort();
  assert.deepEqual(files, CLOSED_MOODS, 'themes/moods/*.css 파일 목록 == listMoods() (단일 진실 원천)');
});
