import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GenerateWorksheet } from '../../src/usecases/GenerateWorksheet.js';
import { EditWorksheet, itemNumber } from '../../src/usecases/EditWorksheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function mockCurriculum(standards) {
  return { async search() { return standards; }, async resolve() { return null; } };
}

async function sciManifest() {
  const repo = new FsBlockRepository({ root: ROOT });
  const standards = [{ code: '[9과12-01]', text: '광합성 과정을 이해한다.', subject: '과학' }];
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum(standards) });
  const { manifest } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });
  return manifest;
}

// 지시문 파서 --------------------------------------------------------------
test('US-M4-2: 파서 "3번 문항 빼고 성찰 추가" → [removeItem:3, addSection:reflection]', () => {
  const ops = EditWorksheet.parseInstruction('3번 문항 빼고 성찰 추가');
  assert.deepEqual(ops, [
    { op: 'removeItem', n: 3 },
    { op: 'addSection', kind: 'reflection' },
  ]);
});

test('US-M4-2: 파서 변형 표현 허용(제거/삭제, 성찰 넣어)', () => {
  assert.deepEqual(
    EditWorksheet.parseInstruction('2번 문항 삭제해줘'),
    [{ op: 'removeItem', n: 2 }],
  );
  assert.deepEqual(
    EditWorksheet.parseInstruction('성찰 섹션 넣어줘'),
    [{ op: 'addSection', kind: 'reflection' }],
  );
});

test('US-M4-2: 파서가 이해 못하면 명확히 실패', () => {
  assert.throws(() => EditWorksheet.parseInstruction('아무 말'), /이해하지 못했/);
});

// itemNumber 도출 ---------------------------------------------------------
test('US-M4-2: itemNumber — subq qnum / section-heading n / 숫자없음(null)', () => {
  assert.equal(itemNumber({ type: 'subq', html: '<p class="subq"><span class="qnum">3</span>...' }), 3);
  assert.equal(itemNumber({ type: 'section-heading', html: '<h2 class="sec"><span class="n">7</span>...' }), 7);
  assert.equal(itemNumber({ type: 'section-heading', html: '<h2 class="sec"><span class="n">＊</span>...' }), null);
  assert.equal(itemNumber({ type: 'content', html: 'no number' }), null);
});

// removeItem 동작 ---------------------------------------------------------
test('US-M4-2: removeItem(3) 은 3번 문항 + 종속 블록을 제거(순수, 원본 불변)', async () => {
  const manifest = await sciManifest();
  const before = JSON.stringify(manifest);

  const { manifest: edited, applied } = new EditWorksheet().execute(manifest, [{ op: 'removeItem', n: 3 }]);

  // 원본 매니페스트는 변형되지 않는다(순수).
  assert.equal(JSON.stringify(manifest), before, '입력 매니페스트 불변');

  // 편집본에는 번호 3 문항이 없다.
  const numsBefore = manifest.pages.flat().map(itemNumber).filter((x) => x != null);
  const numsAfter = edited.pages.flat().map(itemNumber).filter((x) => x != null);
  assert.ok(numsBefore.includes(3), '원본에 3번 존재');
  assert.ok(!numsAfter.includes(3), '편집본에 3번 없음');

  // 블록 총수는 줄어든다(문항 + 종속 블록 제거).
  const cntBefore = manifest.pages.flat().length;
  const cntAfter = edited.pages.flat().length;
  assert.ok(cntAfter < cntBefore, '블록 수 감소');
  assert.match(applied[0], /removeItem\(3\)/);
});

test('US-M4-2: removeItem 존재하지 않는 번호는 명확히 실패', async () => {
  const manifest = await sciManifest();
  assert.throws(
    () => new EditWorksheet().execute(manifest, [{ op: 'removeItem', n: 99 }]),
    /99번 문항을 찾지 못했습니다/,
  );
});

// addSection 동작 ---------------------------------------------------------
test('US-M4-2: addSection(reflection) 은 마지막 페이지에 성찰 섹션을 추가', async () => {
  const manifest = await sciManifest();
  const lastPageLenBefore = manifest.pages[manifest.pages.length - 1].length;

  const { manifest: edited } = new EditWorksheet().execute(manifest, [{ op: 'addSection', kind: 'reflection' }]);

  const lastPage = edited.pages[edited.pages.length - 1];
  assert.equal(lastPage.length, lastPageLenBefore + 2, '성찰 블록 2개 추가');
  const joined = lastPage.map((b) => b.html || '').join('');
  assert.match(joined, /성찰/, '성찰 헤딩 존재');
  assert.match(joined, /note-under/, '성찰 기록란(코어 클래스) 존재');
});

// 복합(수용 시나리오) -----------------------------------------------------
test('US-M4-2: "3번 문항 빼고 성찰 추가" 복합 편집이 매니페스트에 함께 반영', async () => {
  const manifest = await sciManifest();
  const ops = EditWorksheet.parseInstruction('3번 문항 빼고 성찰 추가');
  const { manifest: edited } = new EditWorksheet().execute(manifest, ops);

  const numsAfter = edited.pages.flat().map(itemNumber).filter((x) => x != null);
  assert.ok(!numsAfter.includes(3), '3번 제거');
  assert.match(edited.pages.flat().map((b) => b.html || '').join(''), /성찰/, '성찰 추가');
});
