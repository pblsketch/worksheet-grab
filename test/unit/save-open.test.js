import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { OpenDocument } from '../../src/usecases/OpenDocument.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E1 저장/로드 오케스트레이션 + 누출 봉합 3케이스(§7 fail-closed × P5 저장 관대성).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

function baseManifest(blocks) {
  return {
    id: 'e1-fixture', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
    docTitle: 'E1 픽스처', head: { katex: false }, runHead: 'E1', runFoot: { left: 'E1', rightPrefix: '' },
    standards: [], standardsText: {},
    pages: [blocks],
  };
}

// 정상: 정답이 .answer 마크 안에만 있다 → student 물리제거, 누출 없음.
const CLEAN = baseManifest([
  { type: 'question', html: '<div class="q">광합성이란 무엇인가?</div>' },
  { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
]);
// 누출: 같은 정답 텍스트가 마크 밖 평문으로도 존재 → student 에 잔존하는 누출분.
const LEAKY = baseManifest([
  { type: 'question', html: '<div class="q">광합성이란 무엇인가?</div>' },
  { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
  { type: 'content', html: `<p>참고: ${ANSWER}</p>` },
]);

async function fixture() {
  const base = await autoTmpDir('wsg-save-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  return { workspace, saver, base };
}

test('저장 왕복: revision·history 반영 + open 로드 결과 완비 + 통합본 미기록', async () => {
  const { workspace, saver } = await fixture();
  const t1 = new Date('2026-07-21T01:00:00.000Z');
  const r1 = await saver.execute({ name: '문서', manifest: CLEAN, now: t1 });
  assert.equal(r1.unsafe, false);
  assert.equal(r1.meta.revision, 1);

  const r2 = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r2.meta.revision, 2);
  assert.equal(r2.meta.createdAt, t1.toISOString(), 'createdAt 보존');

  const opened = await new OpenDocument({ workspace }).execute({ name: '문서' });
  assert.deepEqual(opened.manifest, CLEAN);
  assert.equal(opened.meta.revision, 2);
  assert.equal(opened.history.length, 2);
  assert.deepEqual(opened.warnings, [], '정합 문서는 경고 없음');
  assert.ok(!existsSync(join(opened.paths.dir, 'worksheet.html')), '통합본(정답 물리 포함)은 워크스페이스에 절대 없음');
});

test('케이스1: .answer 마킹 정답 → student 물리제거·unsafe=false', async () => {
  const { saver } = await fixture();
  const r = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T01:00:00.000Z') });
  assert.equal(r.unsafe, false);
  const student = await readFile(r.paths.studentPath, 'utf8');
  const teacher = await readFile(r.paths.teacherPath, 'utf8');
  assert.ok(!student.includes(ANSWER), 'student 에서 정답 물리 제거(.answer 불변식)');
  assert.ok(teacher.includes(ANSWER), 'teacher 에는 정답 유지');
});

test('케이스2: 마크밖 평문 누출 → student.html 미생성 + worksheet.html 부재 + unsafe=true', async () => {
  const { workspace, saver } = await fixture();
  const r = await saver.execute({ name: '문서', manifest: LEAKY, now: new Date('2026-07-21T01:00:00.000Z') });
  assert.equal(r.unsafe, true);
  assert.ok(r.leakFindings.some((f) => f.rule === 'answer-leak'), '누출 근거 반환');
  assert.ok(!existsSync(r.paths.studentPath), '누출 시 student.html 쓰기 보류');
  assert.ok(!existsSync(join(r.paths.dir, 'worksheet.html')), '통합본도 부재(E1 미산출)');
  assert.ok(existsSync(r.paths.teacherPath), 'teacher·manifest·meta·history 는 저장(작업 손실 0)');
  assert.ok(existsSync(r.paths.manifestPath));
  assert.equal((await workspace.readMeta('문서')).unsafe, true);
  const opened = await new OpenDocument({ workspace }).execute({ name: '문서' });
  assert.ok(opened.warnings.some((w) => /unsafe/.test(w)), 'open 이 unsafe 경고');
});

test('케이스3: 누출 → 후속 정상 저장 시 unsafe 해제 + student 재생성', async () => {
  const { workspace, saver } = await fixture();
  await saver.execute({ name: '문서', manifest: LEAKY, now: new Date('2026-07-21T01:00:00.000Z') });
  const r2 = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.equal(r2.unsafe, false);
  assert.ok(existsSync(r2.paths.studentPath), '정상 저장으로 student 재생성');
  assert.equal((await workspace.readMeta('문서')).unsafe, false, 'unsafe 해제');
  assert.equal(r2.meta.revision, 2, '누출 저장도 리비전을 차지(작업 이력 보존)');
});

test('누출 재저장이 이전 정상 student 잔존을 제거한다(역방향 안전)', async () => {
  const { saver } = await fixture();
  const r1 = await saver.execute({ name: '문서', manifest: CLEAN, now: new Date('2026-07-21T01:00:00.000Z') });
  assert.ok(existsSync(r1.paths.studentPath));
  const r2 = await saver.execute({ name: '문서', manifest: LEAKY, now: new Date('2026-07-21T02:00:00.000Z') });
  assert.ok(!existsSync(r2.paths.studentPath), '구버전 student.html 잔존 금지(신선하지 않은 배포물 차단)');
});

test('open: 없는 문서는 명확한 오류', async () => {
  const { workspace } = await fixture();
  await assert.rejects(
    () => new OpenDocument({ workspace }).execute({ name: '없는문서' }),
    /문서가 없습니다/,
  );
});
