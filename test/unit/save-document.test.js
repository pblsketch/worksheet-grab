import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { checkCommitIntegrity } from '../../src/usecases/workspace.js';

// S2.4 수용 기준(06_plan_final.md 162~165행, US-08): SaveDocument 2층 재정의 — 개체 트리
// 체크포인트 경로(checkpoint())는 "호출 1회 = 디스크 커밋 1회"다. 조작-단위 디스크 접촉(가드레일
// C-3 금지)이 없음을, 체크포인트 호출 횟수 == 스냅샷 개수로 증명한다. #detectDroppedMarks(레거시
// HTML 경로 전용, contenteditable 겨냥)는 개체 모델에서 answer:true 가 구조 속성이라 텍스트 편집으로
// 벗겨질 수 없어 은퇴됐다 — checkpoint() 는 workspace.readManifest(이전 버전 재조립용)를 아예
// 호출하지 않는다는 사실로 이를 증명한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

const T1 = new Date('2026-07-23T01:00:00.000Z');
const T2 = new Date('2026-07-23T02:00:00.000Z');
const T3 = new Date('2026-07-23T03:00:00.000Z');

function objDoc(flow, pageId = 'page-main') {
  return {
    docTitle: 'US-08 체크포인트 픽스처', subject: 'science', dataSubject: 'science',
    themeName: 'sci', lang: 'ko', runHead: 'US-08', runFoot: { left: 'US-08', rightPrefix: '' },
    standards: [], paper: null,
    pagination: 'paginated',
    pages: [{ id: pageId, flow, float: [] }],
  };
}

const QUESTION_BLOCK = { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '광합성이란 무엇인가?' };
const ANSWER_BLOCK = { id: 'ans1', type: 'richtext', placement: 'flow', answer: true, html: `<p>${ANSWER}</p>` };
const LEAK_BLOCK = { id: 'leak1', type: 'richtext', placement: 'flow', html: `<p>참고: ${ANSWER}</p>` };

// 정상: 정답이 answer:true 개체(.answer 렌더) 안에만 있다 → student 물리제거, 누출 없음.
const CLEAN_DOC = objDoc([QUESTION_BLOCK, ANSWER_BLOCK]);
// 누출: 같은 정답 텍스트가 answer:true 아닌 개체로도 존재 → teacher 자체 검사에서 마크 밖 잔존 적발.
const LEAKY_DOC = objDoc([QUESTION_BLOCK, ANSWER_BLOCK, LEAK_BLOCK]);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-save-checkpoint-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  return { workspace, blockRepository, saver, base };
}

test('checkpoint 1회 = rev+1·스냅샷+1·meta 갱신·검증 실행 — 호출 횟수만큼만 디스크에 닿는다', async () => {
  const { workspace, saver } = await fixture();

  const r1 = await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T1 });
  assert.equal(r1.meta.revision, 1);
  assert.equal(r1.unsafe, false);
  assert.equal(r1.leakFindings.length, 0, '정상 문서는 개체 트리 경로에서 누출 0');
  assert.equal((await workspace.listSnapshots('문서')).length, 1);

  // 여러 번 체크포인트해도(클라이언트 조작 히스토리는 이 계층 밖) 호출 횟수 == 스냅샷 개수만 성립하면
  // "조작마다 디스크 커밋" 금지(가드레일 C-3)가 지켜진다는 뜻이다 — checkpoint() 가 곧 커밋 단위.
  const r2 = await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T2 });
  assert.equal(r2.meta.revision, 2);
  assert.equal((await workspace.listSnapshots('문서')).length, 2, '체크포인트 2회 호출 == 스냅샷 2개');

  const r3 = await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T3 });
  assert.equal(r3.meta.revision, 3);
  assert.equal((await workspace.listSnapshots('문서')).length, 3, '체크포인트 3회 호출 == 스냅샷 3개');
});

test('ID 없는 호환 입력은 반환 문서를 다음 checkpoint에 전파하면 같은 ID를 유지', async () => {
  const { workspace, saver } = await fixture();
  const legacyObjectTree = objDoc([QUESTION_BLOCK]);
  delete legacyObjectTree.pages[0].id;

  const first = await saver.checkpoint({ name: '호환문서', document: legacyObjectTree, now: T1 });
  assert.match(first.document.pages[0].id, /^page-/);
  const second = await saver.checkpoint({ name: '호환문서', document: first.document, now: T2 });
  assert.equal(second.document.pages[0].id, first.document.pages[0].id);
  assert.equal((await workspace.readManifest('호환문서')).pages[0].id, first.document.pages[0].id);
});

test('checkpoint는 공백·중복 페이지 ID를 자동 수리하지 않고 거부', async () => {
  const { saver } = await fixture();
  const duplicate = {
    ...CLEAN_DOC,
    pages: [
      CLEAN_DOC.pages[0],
      { ...CLEAN_DOC.pages[0], id: CLEAN_DOC.pages[0].id, flow: [] },
    ],
  };
  await assert.rejects(() => saver.checkpoint({ name: '중복문서', document: duplicate, now: T1 }), /중복/);
  const blank = structuredClone(CLEAN_DOC);
  blank.pages[0].id = ' ';
  await assert.rejects(() => saver.checkpoint({ name: '공백문서', document: blank, now: T1 }), /비어 있지 않은/);
});

test('명명 체크포인트: 이름이 meta.checkpoints 에 기록되고 그 일련번호로 스냅샷 복원 가능', async () => {
  const { workspace, saver } = await fixture();
  await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T1 }); // rev1, 무명

  const NAMED_DOC = objDoc([QUESTION_BLOCK]); // rev2 시점 문서 상태(식별 가능하게 단순화)
  const r2 = await saver.checkpoint({ name: '문서', document: NAMED_DOC, now: T2, checkpointName: '1교시 배포판' });
  assert.equal(r2.meta.revision, 2);
  const entry = r2.meta.checkpoints.find((c) => c.name === '1교시 배포판');
  assert.ok(entry, '명명 체크포인트가 meta.checkpoints 이력에 기록됨');
  assert.equal(entry.revision, 2);
  assert.equal(entry.at, T2.toISOString());
  const savedNamedDocument = await workspace.readManifest('문서');
  assert.match(savedNamedDocument.pages[0].id, /^page-/);

  await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T3 }); // rev3, 그 뒤 다시 편집

  const restored = await workspace.readSnapshot('문서', entry.serial);
  assert.deepEqual(restored, savedNamedDocument, '이름으로 찾은 일련번호로 정규화된 저장 시점 문서 그대로 복원 가능');
});

test('rev==스냅샷개수 불변식 유지(checkCommitIntegrity 통과)', async () => {
  const { workspace, saver } = await fixture();
  await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T1 });
  await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T2 });

  const meta = await workspace.readMeta('문서');
  const snapshots = await workspace.listSnapshots('문서');
  const { ok, warnings } = checkCommitIntegrity({ meta, snapshots });
  assert.equal(ok, true);
  assert.deepEqual(warnings, []);
});

test('unsafe 승격 존속: 누출 검증 실패 시 student 보류 + meta.unsafe=true(fail-closed)', async () => {
  const { workspace, saver } = await fixture();
  const r = await saver.checkpoint({ name: '문서', document: LEAKY_DOC, now: T1 });
  assert.equal(r.unsafe, true);
  assert.ok(r.leakFindings.some((f) => f.rule === 'answer-leak'), '누출 근거 반환');
  assert.ok(!existsSync(r.paths.studentPath), '누출 시 student.html 쓰기 보류');
  assert.ok(existsSync(r.paths.teacherPath), 'teacher·manifest·meta·history 는 저장(작업 손실 0)');
  assert.equal((await workspace.readMeta('문서')).unsafe, true);
});

test('개체 트리 경로에서 dropped-marks 은퇴: readManifest(이전 버전 비교용) 미호출 + answer-mark-dropped 규칙 부재', async () => {
  const { workspace, saver } = await fixture();
  let readManifestCalls = 0;
  const originalReadManifest = workspace.readManifest.bind(workspace);
  workspace.readManifest = async (...args) => {
    readManifestCalls += 1;
    return originalReadManifest(...args);
  };

  await saver.checkpoint({ name: '문서', document: CLEAN_DOC, now: T1 });
  // answer:true 개체(ANSWER_BLOCK)를 통째로 제거하는 편집 — 레거시 #detectDroppedMarks 라면
  // 직전 저장본과 재조립·비교했을 값. 개체 트리 경로는 애초에 그 비교 자체를 수행하지 않는다.
  const droppedDoc = objDoc([QUESTION_BLOCK]);
  const r = await saver.checkpoint({ name: '문서', document: droppedDoc, now: T2 });

  assert.equal(readManifestCalls, 0, 'checkpoint() 는 dropped-marks 비교용 readManifest 를 전혀 호출하지 않는다(은퇴)');
  assert.equal(r.unsafe, false);
  assert.equal(r.leakFindings.filter((f) => f.rule === 'answer-mark-dropped').length, 0, '개체 트리 경로에는 answer-mark-dropped 규칙 자체가 없다');
  assert.equal(r.leakFindings.length, 0, '누출 0');
});

test('기존 HTML manifest 저장 경로(execute) 무회귀 — checkpoint 신설과 공존', async () => {
  const { workspace, saver } = await fixture();
  const manifest = {
    id: 'legacy', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
    docTitle: '레거시 문서', head: { katex: false }, runHead: '', runFoot: { left: '', rightPrefix: '' },
    standards: [], standardsText: {},
    pages: [[{ type: 'question', html: '<div class="q">기존 경로 질문</div>' }]],
  };
  const r = await saver.execute({ name: '레거시문서', manifest, now: T1 });
  assert.equal(r.unsafe, false);
  assert.equal(r.meta.revision, 1);
  assert.ok(existsSync(r.paths.studentPath));
  assert.ok(existsSync(r.paths.teacherPath));

  // 개체 트리 문서를 별도 이름으로 checkpoint 해도 서로 간섭하지 않는다(같은 workspace 인스턴스 공유).
  const r2 = await saver.checkpoint({ name: '개체문서', document: CLEAN_DOC, now: T1 });
  assert.equal(r2.unsafe, false);
  assert.equal((await workspace.listDocuments()).length, 2);
});
