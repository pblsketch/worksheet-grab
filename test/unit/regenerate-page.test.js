import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { RegeneratePage } from '../../src/usecases/RegeneratePage.js';
import { run } from '../../src/cli/index.js';

// T2 — RegeneratePage 유스케이스 + CLI(doc regenerate-page). 합의 계획 §2(d), C7·C9.
// pages[N-1] 만 교체 → SaveDocument 저장 위임(누출 재검증·히스토리 스냅샷 +1 자동) +
// aiBridge 대칭 가드(성취기준 gen·저작권 슬롯 제외-타입 삭제·변조·위조 거부).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

/** vocabulary.json 이 없는 저장소(FsBlockRepository 상속) — C7 fail-closed 테스트 전용. */
class NoVocabRepository extends FsBlockRepository {
  async readVocabulary() { return null; }
}

// 3쪽 픽스처: 1쪽(제외-타입 없음), 2쪽(standard-label gen + passage copyrightSlot + subq),
// 3쪽(제외-타입 없음) — 삭제/변조/위조·리플레이스 시나리오를 각 페이지에 분리 배치.
function threePageManifest() {
  return {
    id: 'regen-fixture', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
    docTitle: 'T2 픽스처', head: { katex: false }, runHead: 'T2', runFoot: { left: 'T2', rightPrefix: '' },
    standards: [], standardsText: {},
    pages: [
      [
        { type: 'header', html: '<div>1쪽 헤더</div>' },
        { type: 'subq', html: '<p class="subq"><span class="qnum">1</span>문항1</p>' },
      ],
      [
        { type: 'standard-label', gen: 'standard-label' },
        { type: 'passage', html: '<div class="passage"><div class="slot"></div></div>' },
        { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>문항2</p>' },
      ],
      [
        { type: 'subq', html: '<p class="subq"><span class="qnum">3</span>문항3</p>' },
        { type: 'content', html: '<div>3쪽 본문</div>' },
      ],
    ],
  };
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-regen-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = threePageManifest();
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.execute({ name: '문서', manifest, now: new Date('2026-07-22T01:00:00.000Z') });
  return { base, workspace, blockRepository, manifest };
}

test('정상 재생성: pages[i]만 교체·타 페이지 바이트 불변·SaveDocument 경유(스냅샷 +1)', async () => {
  const { workspace, blockRepository, manifest } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  const newPage2 = [
    { type: 'standard-label', gen: 'standard-label' },
    { type: 'passage', html: '<div class="passage"><div class="slot"></div></div>' },
    { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>재생성된 문항2</p>' },
  ];
  const result = await regen.execute({ docName: '문서', page: 2, newPageBlocks: newPage2, now: new Date('2026-07-22T02:00:00.000Z') });
  assert.equal(result.unsafe, false);
  assert.equal(result.meta.revision, 2, 'SaveDocument 경유 — 리비전 +1');
  assert.equal((await workspace.listSnapshots('문서')).length, 2, '히스토리 스냅샷 +1');

  const saved = await workspace.readManifest('문서');
  assert.deepEqual(saved.pages[0], manifest.pages[0], '1쪽 바이트(직렬화) 불변');
  assert.deepEqual(saved.pages[2], manifest.pages[2], '3쪽 바이트(직렬화) 불변');
  assert.equal(JSON.stringify(saved.pages[0]), JSON.stringify(manifest.pages[0]));
  assert.equal(JSON.stringify(saved.pages[2]), JSON.stringify(manifest.pages[2]));
  assert.notDeepEqual(saved.pages[1], manifest.pages[1], '2쪽만 교체');
  assert.ok(JSON.stringify(saved.pages[1]).includes('재생성된 문항2'));
});

test('C9 삭제 거부: 제외-타입(standard-label·passage) 블록을 신규 페이지에서 빼면 거부', async () => {
  const { workspace, blockRepository } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  const newPage2WithoutExcluded = [
    { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>재생성된 문항2</p>' },
  ];
  await assert.rejects(
    () => regen.execute({ docName: '문서', page: 2, newPageBlocks: newPage2WithoutExcluded }),
    /보존되지 않았습니다.*삭제.*변조.*위조/,
  );
  assert.equal((await workspace.readMeta('문서')).revision, 1, '거부 시 저장 없음(리비전 불변)');
});

test('3층 정책(2026-07-23): passage(지문 슬롯) 내용 변경은 허용된다(교사·AI 편집 가능) — 성취기준 보존은 삭제/위조 테스트가 담당', async () => {
  const { workspace, blockRepository } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  // 성취기준(standard-label)은 그대로 두고 지문(passage) 본문만 채운다 → 3층 정책으로 편집 허용(저장 성공).
  const editedPassagePage2 = [
    { type: 'standard-label', gen: 'standard-label' },
    { type: 'passage', html: '<div class="passage"><div class="slot">교사가 직접 입력한 지문 본문</div></div>' },
    { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>문항2</p>' },
  ];
  const result = await regen.execute({ docName: '문서', page: 2, newPageBlocks: editedPassagePage2, now: new Date('2026-07-22T02:00:00.000Z') });
  assert.equal(result.meta.revision, 2, '지문 편집은 정상 저장(리비전 +1)');
  const saved = await workspace.readManifest('문서');
  assert.ok(JSON.stringify(saved.pages[1]).includes('교사가 직접 입력한 지문 본문'), '변경한 지문 본문이 저장에 반영');
});

test('C9 위조 거부: 제외-타입이 없던 페이지에 새로 끼워 넣으면 거부', async () => {
  const { workspace, blockRepository } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  // 3쪽(원래 제외-타입 없음)에 standard-label 을 위조 삽입.
  const forgedPage3 = [
    { type: 'subq', html: '<p class="subq"><span class="qnum">3</span>문항3</p>' },
    { type: 'standard-label', gen: 'standard-label' },
  ];
  await assert.rejects(
    () => regen.execute({ docName: '문서', page: 3, newPageBlocks: forgedPage3 }),
    /보존되지 않았습니다.*삭제.*변조.*위조/,
  );
});

test('C7 vocabulary 로드 실패 시 fail-closed(null 이면 저장 거부)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-regen-novocab-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const realRepo = new FsBlockRepository({ root: ROOT });
  const noVocabRepo = new NoVocabRepository({ root: ROOT });
  assert.equal(await noVocabRepo.readVocabulary(), null, '전제: 이 저장소는 vocabulary 를 못 읽는다');

  const saver = new SaveDocument({ workspace, blockRepository: realRepo, curriculum: null });
  await saver.execute({ name: '문서', manifest: threePageManifest(), now: new Date('2026-07-22T01:00:00.000Z') });

  const regen = new RegeneratePage({ workspace, blockRepository: noVocabRepo, curriculum: null });
  await assert.rejects(
    () => regen.execute({
      docName: '문서', page: 2,
      newPageBlocks: [{ type: 'subq', html: '<p class="subq"><span class="qnum">2</span>x</p>' }],
    }),
    /fail-closed|불러오지 못했습니다/,
  );
  assert.equal((await workspace.readMeta('문서')).revision, 1, 'fail-closed — 저장 시도 자체가 없어 리비전 불변');
});

test('범위 밖 페이지 번호는 error', async () => {
  const { workspace, blockRepository } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  await assert.rejects(
    () => regen.execute({ docName: '문서', page: 0, newPageBlocks: [] }),
    /범위를 벗어났습니다/,
  );
  await assert.rejects(
    () => regen.execute({ docName: '문서', page: 4, newPageBlocks: [] }),
    /범위를 벗어났습니다/,
  );
});

test('정답 누출 페이지 주입: meta.unsafe 전이(SaveDocument 게이트 재검증 대칭)', async () => {
  const { workspace, blockRepository } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  const leakyPage3 = [
    { type: 'question', html: '<div class="q">광합성이란?</div>' },
    { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
    { type: 'content', html: `<p>참고: ${ANSWER}</p>` }, // 마크 밖 평문 누출
  ];
  const result = await regen.execute({ docName: '문서', page: 3, newPageBlocks: leakyPage3 });
  assert.equal(result.unsafe, true, '누출 재검증이 regenerate-page 경로에도 대칭 적용');
  assert.ok(result.leakFindings.length > 0);
  assert.equal((await workspace.readMeta('문서')).unsafe, true);
});

test('문항 번호 불연속: 에러가 아니라 경고 문자열 반환', async () => {
  const { workspace, blockRepository } = await fixture();
  const regen = new RegeneratePage({ workspace, blockRepository, curriculum: null });
  const gappedPage2 = [
    { type: 'standard-label', gen: 'standard-label' },
    { type: 'passage', html: '<div class="passage"><div class="slot"></div></div>' },
    { type: 'subq', html: '<p class="subq"><span class="qnum">9</span>번호 불연속</p>' }, // 2 대신 9
  ];
  const result = await regen.execute({ docName: '문서', page: 2, newPageBlocks: gappedPage2 });
  assert.equal(result.unsafe, false, '연속성 경고는 에러가 아니다');
  assert.match(result.continuityWarning, /연속성 경고/);
});

// ── CLI(doc regenerate-page) ────────────────────────────────────────────

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

test('CLI doc regenerate-page: 정상 재생성 → exit 0 + rev 증가', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-regen-cli-'));
  const setup = logger();
  const manifestPath = join(base, 'fixture.manifest.json');
  await writeFile(manifestPath, JSON.stringify(threePageManifest(), null, 2), 'utf8');
  await run(['doc', 'save', '문서', '--from', manifestPath, '--workspaces-dir', base], { root: ROOT, log: setup.log, err: setup.err });

  const pagePath = join(base, 'page2.json');
  await writeFile(pagePath, JSON.stringify([
    { type: 'standard-label', gen: 'standard-label' },
    { type: 'passage', html: '<div class="passage"><div class="slot"></div></div>' },
    { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>CLI 재생성</p>' },
  ], null, 2), 'utf8');

  const { lines, log, err } = logger();
  const code = await run(['doc', 'regenerate-page', '문서', '2', '--from', pagePath, '--workspaces-dir', base], { root: ROOT, log, err });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => /doc regenerate-page: 문서 페이지 2 재생성 → rev 2/.test(l)));
});

test('CLI doc regenerate-page: 가드 위반은 비영 종료(오류 출력)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-regen-cli-guard-'));
  const setup = logger();
  const manifestPath = join(base, 'fixture.manifest.json');
  await writeFile(manifestPath, JSON.stringify(threePageManifest(), null, 2), 'utf8');
  await run(['doc', 'save', '문서', '--from', manifestPath, '--workspaces-dir', base], { root: ROOT, log: setup.log, err: setup.err });

  const pagePath = join(base, 'page2-bad.json');
  await writeFile(pagePath, JSON.stringify([
    { type: 'subq', html: '<p class="subq"><span class="qnum">2</span>제외타입 없이 재생성</p>' },
  ], null, 2), 'utf8');

  const { log, err } = logger();
  await assert.rejects(
    () => run(['doc', 'regenerate-page', '문서', '2', '--from', pagePath, '--workspaces-dir', base], { root: ROOT, log, err }),
    /보존되지 않았습니다/,
  );
});

test('CLI doc regenerate-page: unsafe 결과는 exit 1 + 경고 로그', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-regen-cli-unsafe-'));
  const setup = logger();
  const manifestPath = join(base, 'fixture.manifest.json');
  await writeFile(manifestPath, JSON.stringify(threePageManifest(), null, 2), 'utf8');
  await run(['doc', 'save', '문서', '--from', manifestPath, '--workspaces-dir', base], { root: ROOT, log: setup.log, err: setup.err });

  const pagePath = join(base, 'page3-leaky.json');
  await writeFile(pagePath, JSON.stringify([
    { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
    { type: 'content', html: `<p>참고: ${ANSWER}</p>` },
  ], null, 2), 'utf8');

  const { lines, log, err } = logger();
  const code = await run(['doc', 'regenerate-page', '문서', '3', '--from', pagePath, '--workspaces-dir', base], { root: ROOT, log, err });
  assert.equal(code, 1);
  assert.ok(lines.some((l) => /정답 누출 감지/.test(l)));
});

test('CLI 인자 검증: 문서명·N·--from 누락은 명확한 오류', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-regen-cli-args-'));
  const { log, err } = logger();
  await assert.rejects(
    () => run(['doc', 'regenerate-page', '--workspaces-dir', base], { root: ROOT, log, err }),
    /<문서명>/,
  );
  await assert.rejects(
    () => run(['doc', 'regenerate-page', '문서', '--workspaces-dir', base], { root: ROOT, log, err }),
    /<N>\(1-based/,
  );
  await assert.rejects(
    () => run(['doc', 'regenerate-page', '문서', 'abc', '--workspaces-dir', base], { root: ROOT, log, err }),
    /정수여야 합니다/,
  );
  await assert.rejects(
    () => run(['doc', 'regenerate-page', '문서', '2', '--workspaces-dir', base], { root: ROOT, log, err }),
    /--from/,
  );
});
