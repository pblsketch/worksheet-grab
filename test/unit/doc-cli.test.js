import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';
import { DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';

// E1 CLI 배선(run() 인프로세스, edit-cli.test 관례). Chrome 불필요.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CSV = existsSync(DEFAULT_CSV_PATH);
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

async function tmpBase() {
  return mkdtemp(join(tmpdir(), 'wsg-doccli-'));
}

const LEAKY_MANIFEST = {
  id: 'leak', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
  docTitle: '누출 픽스처', head: { katex: false }, runHead: '', runFoot: { left: '', rightPrefix: '' },
  standards: [], standardsText: {},
  pages: [[
    { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
    { type: 'content', html: `<p>참고: ${ANSWER}</p>` },
  ]],
};

test('doc save --from: 문서 생성(rev1) — worksheet.html 부재·2벌 산출', async () => {
  const base = await tmpBase();
  const { log, err } = logger();
  const code = await run(['doc', 'save', '광합성탐구', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base],
    { root: ROOT, log, err });
  assert.equal(code, 0);
  const dir = join(base, '광합성탐구');
  assert.ok(existsSync(join(dir, 'worksheet.manifest.json')));
  assert.ok(existsSync(join(dir, 'worksheet-student.html')));
  assert.ok(existsSync(join(dir, 'worksheet-teacher.html')));
  assert.ok(!existsSync(join(dir, 'worksheet.html')), 'SaveDocument 경유 증명 — writeVariantTrio 라면 통합본이 생겼을 것');
  const meta = JSON.parse(await readFile(join(dir, '.worksheet-grab/meta.json'), 'utf8'));
  assert.equal(meta.revision, 1);
  assert.equal(meta.unsafe, false);
});

test('doc save --from 누출 픽스처: exit 1 + student 보류 + unsafe (대칭 회귀)', async () => {
  const base = await tmpBase();
  const from = join(base, 'leaky.manifest.json');
  await writeFile(from, JSON.stringify(LEAKY_MANIFEST, null, 2), 'utf8');
  const { lines, log, err } = logger();
  const code = await run(['doc', 'save', '누출문서', '--from', from, '--workspaces-dir', base], { root: ROOT, log, err });
  assert.equal(code, 1, '누출 저장은 비영 종료(경고 신호)');
  const dir = join(base, '누출문서');
  assert.ok(!existsSync(join(dir, 'worksheet-student.html')), 'student 보류');
  assert.ok(!existsSync(join(dir, 'worksheet.html')), '통합본 부재');
  assert.ok(existsSync(join(dir, 'worksheet-teacher.html')), 'teacher 는 저장');
  const meta = JSON.parse(await readFile(join(dir, '.worksheet-grab/meta.json'), 'utf8'));
  assert.equal(meta.unsafe, true);
  assert.ok(lines.some((l) => /정답 누출 감지/.test(l)), '강한 경고 출력');
});

test('doc list/open/history: 상태·unsafe 배지·경고 노출', async () => {
  const base = await tmpBase();
  const q = logger();
  await run(['doc', 'save', '문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err });

  const list = logger();
  assert.equal(await run(['doc', 'list', '--workspaces-dir', base], { root: ROOT, log: list.log, err: list.err }), 0);
  assert.ok(list.lines.some((l) => /문서 — .*rev 1/.test(l)));

  const open = logger();
  assert.equal(await run(['doc', 'open', '문서', '--workspaces-dir', base], { root: ROOT, log: open.log, err: open.err }), 0);
  assert.ok(open.lines.some((l) => /로드·상태 표시 — 편집은 "edit-ui/.test(l)), 'open 은 로드·상태 표시임을 명시');
  assert.ok(open.lines.some((l) => /히스토리: 스냅샷 1개/.test(l)));

  const hist = logger();
  assert.equal(await run(['doc', 'history', '문서', '--workspaces-dir', base], { root: ROOT, log: hist.log, err: hist.err }), 0);
  assert.ok(hist.lines.some((l) => /^  0001-/.test(l)));
});

test('edit --doc <문서명>: 문서명 해석 편집 → rev 증가(out/ 미사용)', async () => {
  const base = await tmpBase();
  const q = logger();
  await run(['doc', 'save', '문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err });
  const { log, err } = logger();
  const code = await run(['edit', '--doc', '문서', '--workspaces-dir', base, '3번 문항 빼고 성찰 추가'], { root: ROOT, log, err });
  assert.equal(code, 0);
  const meta = JSON.parse(await readFile(join(base, '문서/.worksheet-grab/meta.json'), 'utf8'));
  assert.equal(meta.revision, 2);
  const manifest = JSON.parse(await readFile(join(base, '문서/worksheet.manifest.json'), 'utf8'));
  assert.ok(!JSON.stringify(manifest.pages).includes('실험 과정에 따라 전압을 바꾸며'), '3번 문항 제거 반영');
});

test('edit <워크스페이스 경로> --doc 불일치: 교차 저장 차단 오류', async () => {
  const base = await tmpBase();
  const q = logger();
  await run(['doc', 'save', '문서A', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err });
  const wsManifest = join(base, '문서A', 'worksheet.manifest.json');
  const { log, err } = logger();
  await assert.rejects(
    () => run(['edit', wsManifest, '3번 문항 빼줘', '--doc', '문서B', '--workspaces-dir', base], { root: ROOT, log, err }),
    /--doc "문서B" 가 입력 문서\("문서A"\)와 다릅니다/,
  );
});

test('doc save 동일 문서명 재저장은 갱신(rev 증가) — 충돌 실패는 생성(--doc)에만', async () => {
  const base = await tmpBase();
  const q = logger();
  await run(['doc', 'save', '문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err });
  const code = await run(['doc', 'save', '문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', base], { root: ROOT, log: q.log, err: q.err });
  assert.equal(code, 0, '저장은 갱신 시맨틱');
  const meta = JSON.parse(await readFile(join(base, '문서/.worksheet-grab/meta.json'), 'utf8'));
  assert.equal(meta.revision, 2);
});

test('generate --doc: 워크스페이스 산출 + 재생성 충돌 실패(doc open 안내)', { skip: !HAS_CSV }, async () => {
  const base = await tmpBase();
  const g1 = logger();
  const code = await run(['generate', '중2과학', '광합성', '--doc', '광합성문서', '--workspaces-dir', base], { root: ROOT, log: g1.log, err: g1.err });
  assert.equal(code, 0);
  const dir = join(base, '광합성문서');
  assert.ok(existsSync(join(dir, 'worksheet-student.html')));
  assert.ok(!existsSync(join(dir, 'worksheet.html')), 'SaveDocument 경유(통합본 부재)');
  assert.ok(!existsSync(join(ROOT, 'out', 'science-광합성문서.html')), 'out/ 미사용');

  const g2 = logger();
  await assert.rejects(
    () => run(['generate', '중2과학', '광합성', '--doc', '광합성문서', '--workspaces-dir', base], { root: ROOT, log: g2.log, err: g2.err }),
    /이미 있습니다.*doc open 광합성문서/,
  );
});
