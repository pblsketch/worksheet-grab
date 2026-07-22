import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/cli/index.js';

// T6 — workbook CLI(합의 계획 §4 Phase 2). create/add/remove/order/list/show 는 순수
// FS(Chrome 불필요) — export 만 Chrome 을 쓰는데, 여기서는 run({renderer}) 주입점으로
// 목 렌더러를 넣어 실 Chrome 없이 unsafe 종료코드·PDF 개수 플러밍을 검증한다(진짜 Chrome
// 실측은 test/render/workbook.render.test.js 소관).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

function logger() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
}

async function tmpBase(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

/** 목 렌더러: 입력 HTML 의 <section class="sheet"> 개수만큼 /Type /Page 를 담은 가짜
 *  PDF 를 쓴다 — WorkbookExport 의 C4 게이트(coverToc+Σsections==실측)가 "1섹션=1쪽"
 *  전제와 동일한 계산으로 결정적으로 통과하게 한다(정상 픽스처에 한함, 오버플로 미시뮬). */
function fakeRenderer() {
  return {
    async renderToPdf(inputPath, outputPath) {
      const html = await readFile(inputPath, 'utf8');
      const sections = (html.match(/<section class="sheet">/g) || []).length;
      const fake = `%PDF-1.4\n${'/Type /Page\n'.repeat(sections)}%%EOF`;
      await writeFile(outputPath, fake, 'utf8');
      return { outputPath };
    },
  };
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

/** 두 워크스페이스 문서(sci.json 기반) + 빈 자료집 장부를 준비한 공용 픽스처. */
async function docsAndWorkbookFixture() {
  const wsBase = await tmpBase('wsg-wbcli-ws-');
  const wbBase = await tmpBase('wsg-wbcli-wb-');
  const q = logger();
  await run(['doc', 'save', '문서A', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['doc', 'save', '문서B', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  return { wsBase, wbBase };
}

// ── create ──────────────────────────────────────────────────────────────

test('workbook create: workbook.json 생성(--title 생략 시 <명>이 제목) + 중복 생성 거부', async () => {
  const wbBase = await tmpBase('wsg-wbcli-create-');
  const { lines, log, err } = logger();
  const code = await run(['workbook', 'create', '자료집1', '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  assert.ok(existsSync(join(wbBase, '자료집1', 'workbook.json')));
  const wbJson = JSON.parse(await readFile(join(wbBase, '자료집1', 'workbook.json'), 'utf8'));
  assert.equal(wbJson.title, '자료집1');
  assert.equal(wbJson.paper, 'a4');
  assert.deepEqual(wbJson.members, []);
  assert.ok(lines.some((l) => /workbook create: 자료집1/.test(l)));

  await assert.rejects(
    () => run(['workbook', 'create', '자료집1', '--workbooks-dir', wbBase], { root: ROOT, log, err }),
    /이미 있습니다/,
  );
});

test('workbook create: --title/--paper 반영', async () => {
  const wbBase = await tmpBase('wsg-wbcli-create2-');
  const code = await run(['workbook', 'create', '자료집2', '--title', '과학 자료집', '--paper', 'b4', '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} });
  assert.equal(code, 0);
  const wbJson = JSON.parse(await readFile(join(wbBase, '자료집2', 'workbook.json'), 'utf8'));
  assert.equal(wbJson.title, '과학 자료집');
  assert.equal(wbJson.paper, 'b4');
});

test('workbook create: <명> 누락은 명확한 오류', async () => {
  await assert.rejects(() => run(['workbook', 'create'], { root: ROOT, log: () => {}, err: () => {} }), /<명>/);
});

// ── add / remove ────────────────────────────────────────────────────────

test('workbook add: 장부 반영(order 자동 증가) + 존재하지 않는 문서 거부 + 중복 add 거부', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });

  const { log, err } = logger();
  const code = await run(['workbook', 'add', '집', '문서A', '--toc-title', '가나다', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  let wbJson = JSON.parse(await readFile(join(wbBase, '집', 'workbook.json'), 'utf8'));
  assert.equal(wbJson.members.length, 1);
  assert.equal(wbJson.members[0].docName, '문서A');
  assert.equal(wbJson.members[0].order, 0);
  assert.equal(wbJson.members[0].tocTitle, '가나다');
  assert.equal(wbJson.members[0].status, 'pending');

  await run(['workbook', 'add', '집', '문서B', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  wbJson = JSON.parse(await readFile(join(wbBase, '집', 'workbook.json'), 'utf8'));
  assert.equal(wbJson.members.length, 2);
  assert.equal(wbJson.members[1].order, 1, 'order 자동 증가');

  await assert.rejects(
    () => run(['workbook', 'add', '집', '없는문서', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err }),
    /문서가 없습니다/,
  );
  await assert.rejects(
    () => run(['workbook', 'add', '집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err }),
    /이미 등록된 문서입니다/,
  );
  // 거부된 시도들이 장부를 오염시키지 않았는지 확인.
  wbJson = JSON.parse(await readFile(join(wbBase, '집', 'workbook.json'), 'utf8'));
  assert.equal(wbJson.members.length, 2);
});

test('workbook add: 존재하지 않는 자료집에 add 시도는 명확한 오류', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  await assert.rejects(
    () => run(['workbook', 'add', '없는집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: () => {}, err: () => {} }),
    /자료집이 없습니다/,
  );
});

test('workbook add: <자료집명> <문서명> 인자 검증', async () => {
  const wbBase = await tmpBase('wsg-wbcli-addargs-');
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} });
  await assert.rejects(() => run(['workbook', 'add', '집'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명> <문서명>/);
  await assert.rejects(() => run(['workbook', 'add'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명> <문서명>/);
});

test('workbook remove: 멤버 제거 + 미등록 문서 제거 시도 거부', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서B', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  const { log, err } = logger();
  const code = await run(['workbook', 'remove', '집', '문서A', '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  const wbJson = JSON.parse(await readFile(join(wbBase, '집', 'workbook.json'), 'utf8'));
  assert.equal(wbJson.members.length, 1);
  assert.equal(wbJson.members[0].docName, '문서B');

  await assert.rejects(
    () => run(['workbook', 'remove', '집', '문서A', '--workbooks-dir', wbBase], { root: ROOT, log, err }),
    /등록되지 않은 문서입니다/,
  );
});

// ── order ───────────────────────────────────────────────────────────────

test('workbook order: 전체 멤버를 지정 순서로 재배열', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서B', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  const code = await run(['workbook', 'order', '집', '문서B', '문서A', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  assert.equal(code, 0);
  const wbJson = JSON.parse(await readFile(join(wbBase, '집', 'workbook.json'), 'utf8'));
  const byName = Object.fromEntries(wbJson.members.map((m) => [m.docName, m.order]));
  assert.equal(byName['문서B'], 0);
  assert.equal(byName['문서A'], 1);
});

test('workbook order: 부분 지정·중복·미등록 문서 포함은 거부(전체 멤버 무결성)', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서B', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  await assert.rejects( // 부분 지정(1개만)
    () => run(['workbook', 'order', '집', '문서A', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err }),
    /전체 멤버를 중복 없이 모두 지정/,
  );
  await assert.rejects( // 중복
    () => run(['workbook', 'order', '집', '문서A', '문서A', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err }),
    /전체 멤버를 중복 없이 모두 지정/,
  );
  await assert.rejects( // 미등록 문서 포함
    () => run(['workbook', 'order', '집', '문서A', '문서C', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err }),
    /전체 멤버를 중복 없이 모두 지정/,
  );
});

// ── list / show ─────────────────────────────────────────────────────────

test('workbook list: 자료집 목록(제목·멤버 수·용지)', async () => {
  const wbBase = await tmpBase('wsg-wbcli-list-');
  const q = logger();
  await run(['workbook', 'create', 'b집', '--title', 'B', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'create', 'a집', '--title', 'A', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  const code = await run(['workbook', 'list', '--workbooks-dir', wbBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => /a집 — A/.test(l)));
  assert.ok(lines.some((l) => /b집 — B/.test(l)));
});

test('workbook show: 멤버·status·본문상대 시작쪽 요약', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서B', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  const code = await run(['workbook', 'show', '집', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log, err });
  assert.equal(code, 0);
  // manifests/sci.json 은 3쪽 — 문서A 시작쪽 1, 문서B 시작쪽 1+3=4.
  assert.ok(lines.some((l) => /\[1\] 문서A.*status pending.*시작쪽 1(?!\d)/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /\[2\] 문서B.*status pending.*시작쪽 4/.test(l)), lines.join('\n'));
});

test('workbook show: <자료집명> 누락 오류, 존재하지 않는 자료집 오류', async () => {
  const wbBase = await tmpBase('wsg-wbcli-showargs-');
  await assert.rejects(() => run(['workbook', 'show'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명>/);
  await assert.rejects(
    () => run(['workbook', 'show', '없는집', '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} }),
    /자료집이 없습니다/,
  );
});

// ── export(목 렌더러 — Chrome 미사용) ──────────────────────────────────

test('workbook export: 정상 2멤버 → PDF 2벌 산출 + exit 0(목 렌더러)', async () => {
  const { wsBase, wbBase } = await docsAndWorkbookFixture();
  const q = logger();
  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서A', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '문서B', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  const code = await run(
    ['workbook', 'export', '집', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase],
    { root: ROOT, log, err, renderer: fakeRenderer() },
  );
  assert.equal(code, 0);
  const teacherPdf = join(wbBase, '집', 'workbook-teacher.pdf');
  const studentPdf = join(wbBase, '집', 'workbook-student.pdf');
  assert.ok(existsSync(teacherPdf));
  assert.ok(existsSync(studentPdf));
  assert.ok(lines.some((l) => /teacher PDF/.test(l)));
  assert.ok(lines.some((l) => /student PDF/.test(l)));
});

test('workbook export: unsafe 멤버 있으면 student 미산출 + 멤버 지목 + exit 1(teacher 는 산출)', async () => {
  const wsBase = await tmpBase('wsg-wbcli-export-unsafe-ws-');
  const wbBase = await tmpBase('wsg-wbcli-export-unsafe-wb-');
  const q = logger();
  await run(['doc', 'save', '안전문서', '--from', join(ROOT, 'manifests/sci.json'), '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  const leakyPath = join(wsBase, 'leaky.manifest.json');
  await writeFile(leakyPath, JSON.stringify(LEAKY_MANIFEST, null, 2), 'utf8');
  await run(['doc', 'save', '누출문서', '--from', leakyPath, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '안전문서', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });
  await run(['workbook', 'add', '집', '누출문서', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: q.log, err: q.err });

  const { lines, log, err } = logger();
  const code = await run(
    ['workbook', 'export', '집', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase],
    { root: ROOT, log, err, renderer: fakeRenderer() },
  );
  assert.equal(code, 1);
  assert.ok(existsSync(join(wbBase, '집', 'workbook-teacher.pdf')), 'teacher 는 unsafe 여도 산출');
  assert.ok(!existsSync(join(wbBase, '집', 'workbook-student.pdf')), 'student 는 미산출');
  assert.ok(lines.some((l) => /누출문서/.test(l) && /(정답 누출|미산출)/.test(l)), '멤버 지목 메시지');
});

test('workbook export: <자료집명> 누락 오류, 존재하지 않는 자료집 오류', async () => {
  const wbBase = await tmpBase('wsg-wbcli-exportargs-');
  await assert.rejects(() => run(['workbook', 'export'], { root: ROOT, log: () => {}, err: () => {} }), /<자료집명>/);
  await assert.rejects(
    () => run(['workbook', 'export', '없는집', '--workbooks-dir', wbBase], { root: ROOT, log: () => {}, err: () => {} }),
    /자료집이 없습니다/,
  );
});

// ── 알 수 없는 서브명령 ─────────────────────────────────────────────────

test('workbook: 알 수 없는 서브명령은 종료코드 2 + 지원 목록 안내', async () => {
  const { err, log, lines } = logger();
  const code = await run(['workbook', 'frobnicate'], { root: ROOT, log, err });
  assert.equal(code, 2);
  assert.ok(lines.some((l) => /알 수 없는 서브명령/.test(l)));
});
