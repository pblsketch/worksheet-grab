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

// 복수 문항 열거 + 부분 적용 방지 --------------------------------------------
test('파서: "1번과 2번 문항 빼줘" → 두 문항 모두 제거(부분 적용 금지)', () => {
  assert.deepEqual(
    EditWorksheet.parseInstruction('1번과 2번 문항 빼줘'),
    [{ op: 'removeItem', n: 1 }, { op: 'removeItem', n: 2 }],
  );
});

test('파서: "1, 3번 제거" / "2번하고 4번 삭제" 열거 변형 허용', () => {
  assert.deepEqual(
    EditWorksheet.parseInstruction('1, 3번 제거'),
    [{ op: 'removeItem', n: 1 }, { op: 'removeItem', n: 3 }],
  );
  assert.deepEqual(
    EditWorksheet.parseInstruction('2번하고 4번 삭제해줘'),
    [{ op: 'removeItem', n: 2 }, { op: 'removeItem', n: 4 }],
  );
});

test('파서: "1번은 그대로 두고 2번만 빼줘" → 유지 동사가 번호를 소비(2번만 제거)', () => {
  assert.deepEqual(
    EditWorksheet.parseInstruction('1번은 그대로 두고 2번만 빼줘'),
    [{ op: 'removeItem', n: 2 }],
  );
});

test('파서: "1번 참고, 2번 삭제" → 참고(유지)가 1번을 소비, 2번만 제거(과삭제 방지)', () => {
  // 회귀(Codex 교차 QA): 과거엔 1번이 뒤 삭제 동사로 흘러 1·2번 모두 삭제됐다.
  assert.deepEqual(
    EditWorksheet.parseInstruction('1번 참고, 2번 삭제'),
    [{ op: 'removeItem', n: 2 }],
  );
});

test('파서: 동작 없는 번호가 남으면 부분 적용 대신 전체 실패', () => {
  assert.throws(
    () => EditWorksheet.parseInstruction('3번 문항을 맨 위로 옮겨줘'),
    /3번에 적용할 동작을 이해하지 못했습니다/,
  );
  // 일부만 이해되는 지시도 통째로 거부한다(이해된 2번만 조용히 적용 금지).
  assert.throws(
    () => EditWorksheet.parseInstruction('2번 빼고 5번은 위로 올려'),
    /5번에 적용할 동작을 이해하지 못했습니다/,
  );
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

  // 편집본에는 3번 문항의 "내용"이 없다(재번호로 번호 3 자체는 다시 존재할 수 있음).
  const htmlOf = (m) => m.pages.flat().map((b) => b.html || '').join('');
  assert.match(htmlOf(manifest), /실험 과정에 따라 측정하고/, '원본에 3번 내용 존재');
  assert.doesNotMatch(htmlOf(edited), /실험 과정에 따라 측정하고/, '편집본에 3번 내용 없음');

  // 항목 수 1개 감소 + 번호는 1..N 로 재부여(구멍 없음).
  const numsBefore = manifest.pages.flat().map(itemNumber).filter((x) => x != null);
  const numsAfter = edited.pages.flat().map(itemNumber).filter((x) => x != null);
  assert.equal(numsAfter.length, numsBefore.length - 1, '항목 1개 감소');
  assert.deepEqual(numsAfter, numsAfter.map((_, i) => i + 1), '번호 1..N 연속(재번호)');

  // 블록 총수는 줄어든다(문항 + 종속 블록 제거).
  const cntBefore = manifest.pages.flat().length;
  const cntAfter = edited.pages.flat().length;
  assert.ok(cntAfter < cntBefore, '블록 수 감소');
  assert.match(applied[0], /removeItem\(3\)/);
  assert.ok(applied.some((a) => /renumber/.test(a)), '재번호 수행 보고');
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

  const joined = edited.pages.flat().map((b) => b.html || '').join('');
  assert.doesNotMatch(joined, /실험 과정에 따라 측정하고/, '3번(내용 기준) 제거');
  assert.match(joined, /성찰/, '성찰 추가');
});

// 재번호(G5) ---------------------------------------------------------------
test('G5: removeItem 후 번호가 1..N 로 재부여되어 인쇄물에 구멍이 없다', async () => {
  const manifest = await sciManifest();
  const { manifest: edited } = new EditWorksheet().execute(manifest, [{ op: 'removeItem', n: 1 }, { op: 'removeItem', n: 2 }]);
  const numsAfter = edited.pages.flat().map(itemNumber).filter((x) => x != null);
  assert.deepEqual(numsAfter, numsAfter.map((_, i) => i + 1), '1..N 연속');
  assert.ok(numsAfter.length >= 1 && numsAfter[0] === 1, '1번부터 시작');
});

test('G5: 번호가 재시작/중복되는 다중 수열 문서는 재번호를 건너뛴다(의미 보존)', () => {
  const manifest = {
    pages: [[
      { type: 'subq', html: '<p class="subq"><span class="qnum">1</span>활동1-1</p>' },
      { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>활동1-2</p>' },
      { type: 'subq', html: '<p class="subq"><span class="qnum">1</span>활동2-1</p>' },
      { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>활동2-2</p>' },
    ]],
  };
  const { manifest: edited } = new EditWorksheet().execute(manifest, [{ op: 'removeItem', n: 2 }]);
  const nums = edited.pages.flat().map(itemNumber).filter((x) => x != null);
  assert.deepEqual(nums, [1, 1, 2], '첫 2번만 제거되고 재번호는 수행되지 않음');
});

test('G5: addSection 만 있으면 재번호를 수행하지 않는다(성찰 ＊ 유지)', async () => {
  const manifest = await sciManifest();
  const { manifest: edited, applied } = new EditWorksheet().execute(manifest, [{ op: 'addSection', kind: 'reflection' }]);
  assert.ok(!applied.some((a) => /renumber/.test(a)));
  assert.match(edited.pages.flat().map((b) => b.html || '').join(''), /＊/, '성찰 ＊ 마커 유지');
});
