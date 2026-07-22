import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { assembleWorkbookHtml, WorkbookAssemble } from '../../src/usecases/WorkbookAssemble.js';
import { Theme } from '../../src/domain/index.js';
import { collectTextInside } from '../../src/usecases/html-scan.js';
import { ANSWER_CLASSES } from '../../src/usecases/BuildVariants.js';

// WorkbookAssemble — 슬라이스 하이브리드 합본 조립 단위 테스트(합의 계획 §2(a)·C6).

const IS = '　'; // U+3000

const SCI = new Theme({ name: 'sci', tokens: { '--c': '#00838f', '--c2': '#26a69a', '--clite': '#e0f2f1', '--cstrip': '#4db6ac', '--clabel': '#b2dfdb', '--cink': '#00695c' } });
const KO = new Theme({ name: 'ko', tokens: { '--c': '#7cb342', '--c2': '#8bc34a', '--clite': '#f6faf0', '--cstrip': '#9ccc65', '--clabel': '#dcedc8', '--cink': '#558b2e' } });

// AssembleWorksheet 저장본을 모사한 멤버 HTML(head+sections+tail).
function savedHtml({ mode = 'teacher', subject = 'science', pages }) {
  const sections = pages.map((p) => `<section class="sheet">
  <span class="mode-badge"></span>
  <div class="run-head">머리글</div>

  ${p.body}

  <div class="run-foot"><span>왼쪽</span><span>활동지${IS}${p.pageNo}</span></div>
</section>`).join('\n\n');
  return `<!DOCTYPE html>
<html lang="ko" data-mode="${mode}">
<head><title>doc</title><style>:root{--c:#000;}</style></head>
<body data-mode="${mode}" data-subject="${subject}">

${sections}

</body>
</html>
`;
}

function member(i, opts) {
  return {
    docName: opts.docName || `doc${i}`,
    tocTitle: opts.tocTitle,
    tocStandards: opts.tocStandards,
    katex: opts.katex || false,
    theme: opts.theme || SCI,
    html: savedHtml({ mode: opts.mode || 'teacher', subject: opts.subject || 'science', pages: opts.pages }),
    assetsBase: opts.assetsBase || 'file:///ws/doc/assets',
  };
}

const COMMON = { title: '통합 자료집', paperBaseCss: 'PAPERCSS', paperOverrideCss: '', blocksCss: 'BLOCKSCSS' };

// ── 슬라이스·재번호·시작쪽 ──────────────────────────────────────────────

test('run-foot 연속 재번호: 본문 쪽번호 시퀀스 == [1..ΣSections]', () => {
  const members = [
    member(0, { pages: [{ pageNo: 1, body: '<p>a</p>' }, { pageNo: 2, body: '<p>b</p>' }] }),      // 2 sections
    member(1, { theme: KO, pages: [{ pageNo: 1, body: '<p>c</p>' }, { pageNo: 2, body: '<p>d</p>' }, { pageNo: 3, body: '<p>e</p>' }] }), // 3 sections
  ];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.deepEqual(out.sectionCounts, [2, 3]);
  assert.deepEqual(out.startPages, [1, 3]); // 본문상대 시작쪽 = 1 + Σ앞 멤버 섹션 수
  const nums = [...out.html.matchAll(new RegExp(`${IS}(\\d+)</span></div>`, 'g'))].map((m) => Number(m[1]));
  assert.deepEqual(nums, [1, 2, 3, 4, 5]);
});

// ── 테마 스코프 정합(색 번짐 봉쇄) ──────────────────────────────────────

test('테마 스코프: 각 멤버 색 토큰이 자기 래퍼에만(색 번짐 없음)', () => {
  const members = [
    member(0, { theme: SCI, pages: [{ pageNo: 1, body: '<p>a</p>' }] }),
    member(1, { theme: KO, pages: [{ pageNo: 1, body: '<p>b</p>' }] }),
  ];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  // 스코프 블록이 멤버별로 존재.
  assert.match(out.html, /\[data-wb-member="0"\] \{[^}]*--c: #00838f;/);
  assert.match(out.html, /\[data-wb-member="1"\] \{[^}]*--c: #7cb342;/);
  // 멤버0 스코프 블록에 ko 색이 없고, 멤버1 스코프 블록에 sci 색이 없다.
  const block0 = /\[data-wb-member="0"\] \{[^}]*\}/.exec(out.html)[0];
  const block1 = /\[data-wb-member="1"\] \{[^}]*\}/.exec(out.html)[0];
  assert.ok(block0.includes('#00838f') && !block0.includes('#7cb342'));
  assert.ok(block1.includes('#7cb342') && !block1.includes('#00838f'));
  // 본문 섹션이 각자의 래퍼로 감싸졌다.
  assert.match(out.html, /<div data-wb-member="0">/);
  assert.match(out.html, /<div data-wb-member="1">/);
});

// ── KaTeX 1회 ───────────────────────────────────────────────────────────

test('KaTeX head: 멤버 중 하나라도 katex 면 정확히 1회', () => {
  const members = [
    member(0, { katex: true, pages: [{ pageNo: 1, body: '<p>a</p>' }] }),
    member(1, { theme: KO, katex: false, pages: [{ pageNo: 1, body: '<p>b</p>' }] }),
  ];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.equal((out.html.match(/auto-render\.min\.js/g) || []).length, 1);
});

test('KaTeX head: 아무 멤버도 katex 아니면 0회', () => {
  const members = [member(0, { katex: false, pages: [{ pageNo: 1, body: '<p>a</p>' }] })];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.equal((out.html.match(/auto-render\.min\.js/g) || []).length, 0);
});

// ── 표지·목차 ───────────────────────────────────────────────────────────

test('표지·목차: 제목·목차 항목·본문상대 시작쪽 표기', () => {
  const members = [
    member(0, { tocTitle: '광합성 탐구', tocStandards: ['9과14-02'], pages: [{ pageNo: 1, body: '<p>a</p>' }, { pageNo: 2, body: '<p>b</p>' }] }),
    member(1, { theme: KO, tocTitle: '세포 분열', pages: [{ pageNo: 1, body: '<p>c</p>' }] }),
  ];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.match(out.html, /<h1>통합 자료집<\/h1>/);   // 표지
  assert.match(out.html, /<h1>목차<\/h1>/);           // 목차
  assert.match(out.html, /광합성 탐구/);
  assert.match(out.html, /\[9과14-02\]/);              // 성취기준 대괄호 표기
  assert.match(out.html, /세포 분열/);
  // 시작쪽: member0 →1, member1 →3.
  assert.match(out.html, /광합성 탐구<\/span>[^<]*<span class="wb-toc-std">[^<]*<\/span> <span class="wb-toc-page">1<\/span>/);
  assert.match(out.html, /세포 분열<\/span> <span class="wb-toc-page">3<\/span>/);
});

test('표지·목차 섹션에는 run-foot(쪽번호)가 없다', () => {
  const members = [member(0, { pages: [{ pageNo: 1, body: '<p>a</p>' }] })];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  // 표지·목차·본문 = 3 섹션, run-foot 는 본문 1개뿐.
  assert.equal((out.html.match(/<section class="sheet">/g) || []).length, 3);
  assert.equal((out.html.match(/class="run-foot"/g) || []).length, 1);
});

// ── 자산 재작성 count 불변식(C2 재사용) ─────────────────────────────────

test('자산 재작성: 멤버 assetsBase 로 치환 + count 집계', () => {
  const body = '<img src="assets/a.png"><div style="background:url(assets/b.png)"></div><p>텍스트 assets/notrewrite</p>';
  const members = [member(0, { assetsBase: 'file:///ws/doc0/assets', pages: [{ pageNo: 1, body }] })];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.equal(out.assetRewriteCount, 2); // src + url() (텍스트 assets/ 는 제외)
  assert.match(out.html, /src="file:\/\/\/ws\/doc0\/assets\/a\.png"/);
  assert.match(out.html, /url\(file:\/\/\/ws\/doc0\/assets\/b\.png\)/);
  assert.match(out.html, /텍스트 assets\/notrewrite/); // 텍스트 무변경
});

// ── C6: student 합본 정답 부재(answer·plot-ans 전체) ────────────────────

test('C6: student 합본에 answer·plot-ans 내용이 전무(collectTextInside 공집합)', () => {
  // student 저장본 = 정답 물리 제거분(빈 래퍼만 유지). teacher 저장본엔 정답 텍스트.
  const studentBody = '<span class="answer"></span><g class="plot-ans"></g><div class="q">질문</div>';
  const teacherBody = '<span class="answer">비밀정답노출</span><g class="plot-ans"><circle/></g><div class="q">질문</div>';
  const stu = [member(0, { mode: 'student', pages: [{ pageNo: 1, body: studentBody }] })];
  const tea = [member(0, { mode: 'teacher', pages: [{ pageNo: 1, body: teacherBody }] })];
  const outS = assembleWorkbookHtml({ mode: 'student', ...COMMON, members: stu });
  const outT = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members: tea });
  // student: 정답 마크 안 텍스트가 하나도 없다(answer + plot-ans 모두).
  assert.deepEqual(collectTextInside(outS.html, ANSWER_CLASSES), []);
  assert.ok(!outS.html.includes('비밀정답노출'));
  // teacher: 정답 텍스트 유지(교사용은 정상).
  assert.ok(outT.html.includes('비밀정답노출'));
});

// ── memberProbes(오버플로 지목용) ───────────────────────────────────────

test('memberProbes: 멤버별 단독 HTML + sectionCount 제공', () => {
  const members = [
    member(0, { pages: [{ pageNo: 1, body: '<p>a</p>' }, { pageNo: 2, body: '<p>b</p>' }] }),
    member(1, { theme: KO, pages: [{ pageNo: 1, body: '<p>c</p>' }] }),
  ];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.equal(out.memberProbes.length, 2);
  assert.deepEqual(out.memberProbes.map((p) => p.sectionCount), [2, 1]);
  assert.match(out.memberProbes[0].html, /<div data-wb-member="0">/);
  assert.ok(!out.memberProbes[0].html.includes('<h1>목차</h1>')); // 프로브엔 목차 없음
});

test('prefixHtml: 표지+목차만(멤버 섹션 없음), 동일 head', () => {
  const members = [member(0, { katex: true, pages: [{ pageNo: 1, body: '<p>a</p>' }] })];
  const out = assembleWorkbookHtml({ mode: 'teacher', ...COMMON, members });
  assert.match(out.prefixHtml, /<h1>통합 자료집<\/h1>/);
  assert.match(out.prefixHtml, /<h1>목차<\/h1>/);
  // 멤버 래퍼(엘리먼트)는 없다 — 단, head 의 스코프 CSS 셀렉터 [data-wb-member] 는 동일 head 라 존재.
  assert.ok(!out.prefixHtml.includes('<div data-wb-member='));
  assert.equal((out.prefixHtml.match(/auto-render\.min\.js/g) || []).length, 1); // 동일 head(katex 포함)
});

// ══════════════ 클래스(IO 오케스트레이션) — 페이크로 정책 분기 검증 ══════════════

function fakeWorkspace(docs) {
  return {
    layout: (name) => ({
      name,
      dir: `/ws/${name}`,
      teacherPath: `/ws/${name}/worksheet-teacher.html`,
      studentPath: `/ws/${name}/worksheet-student.html`,
      assetsDir: `/ws/${name}/assets`,
    }),
    docExists: (name) => name in docs,
    readManifest: async (name) => docs[name].manifest,
    readMeta: async (name) => docs[name].meta,
    listSnapshots: async () => [],
  };
}

function fakeDeps(docs, { copyCalls } = {}) {
  const files = {};
  for (const [name, d] of Object.entries(docs)) {
    files[`/ws/${name}/worksheet-teacher.html`] = d.teacherHtml;
    if (d.studentHtml != null) files[`/ws/${name}/worksheet-student.html`] = d.studentHtml;
  }
  return {
    workspace: fakeWorkspace(docs),
    blockRepository: {
      listThemes: async () => [SCI, KO],
      readAsset: async (n) => (n === 'paper.css' ? 'PAPERCSS' : n === 'blocks.css' ? 'BLOCKSCSS' : ''),
    },
    readTextFile: async (p) => { if (!(p in files)) throw new Error(`no file ${p}`); return files[p]; },
    fileExists: (p) => p in files,
    copyDir: copyCalls ? async (from, to) => { copyCalls.push({ from, to }); } : null,
  };
}

function doc({ theme = 'sci', subject = 'science', paper = null, unsafe = false, katex = false, withStudent = true, body = '<p>본문</p>' }) {
  const pages = [{ pageNo: 1, body }];
  return {
    manifest: { theme, subject, docTitle: 't', standards: [], head: { katex }, paper },
    meta: { unsafe, paper, title: 't' },
    teacherHtml: savedHtml({ mode: 'teacher', subject, pages }),
    studentHtml: withStudent ? savedHtml({ mode: 'student', subject, pages }) : null,
  };
}

const WB = (members) => ({ title: '통합 자료집', paper: 'a4', members });

test('클래스: 안전한 2멤버 → teacher+student 산출', async () => {
  const docs = { doc1: doc({ theme: 'sci' }), doc2: doc({ theme: 'ko' }) };
  const asm = new WorkbookAssemble(fakeDeps(docs));
  const r = await asm.execute({ workbook: WB([{ docName: 'doc1', order: 0 }, { docName: 'doc2', order: 1 }]) });
  assert.ok(r.student, 'student 합본 산출');
  assert.ok(r.teacher.html.includes('data-wb-member="0"') && r.teacher.html.includes('data-wb-member="1"'));
  assert.deepEqual(r.unsafeMembers, []);
  assert.deepEqual(r.sectionCounts, [1, 1]);
});

test('클래스: unsafe 멤버(student 저장본 부재) → student 합본 거부+지목, teacher 산출', async () => {
  const docs = { doc1: doc({ theme: 'sci' }), doc2: doc({ theme: 'ko', withStudent: false }) };
  const asm = new WorkbookAssemble(fakeDeps(docs));
  const r = await asm.execute({ workbook: WB([{ docName: 'doc1', order: 0 }, { docName: 'doc2', order: 1 }]) });
  assert.equal(r.student, null, 'unsafe 멤버 있으면 student 합본 거부');
  assert.deepEqual(r.unsafeMembers, ['doc2']);
  assert.ok(r.teacher.html.includes('data-wb-member="1"'), 'teacher 는 항상 산출');
});

test('클래스: unsafe 멤버(meta.unsafe=true) → student 거부', async () => {
  const docs = { doc1: doc({ theme: 'sci', unsafe: true }) };
  const asm = new WorkbookAssemble(fakeDeps(docs));
  const r = await asm.execute({ workbook: WB([{ docName: 'doc1', order: 0 }]) });
  assert.equal(r.student, null);
  assert.deepEqual(r.unsafeMembers, ['doc1']);
});

test('클래스: 용지 불일치 → fail-closed(멤버 지목)', async () => {
  const docs = { doc1: doc({ theme: 'sci', paper: null }), doc2: doc({ theme: 'ko', paper: { size: 'B4' } }) };
  const asm = new WorkbookAssemble(fakeDeps(docs));
  await assert.rejects(
    () => asm.execute({ workbook: WB([{ docName: 'doc1', order: 0 }, { docName: 'doc2', order: 1 }]) }),
    /용지 불일치.*doc2/s,
  );
});

test('클래스: 기본 자산 = file:// 절대 URL', async () => {
  const docs = { doc1: doc({ theme: 'sci', body: '<img src="assets/a.png">' }) };
  const asm = new WorkbookAssemble(fakeDeps(docs));
  const r = await asm.execute({ workbook: WB([{ docName: 'doc1', order: 0 }]) });
  // 기본 자산 베이스는 pathToFileURL(assetsDir) — 플랫폼(Windows 드라이브 접두)에 맞춰 계산.
  const base = pathToFileURL('/ws/doc1/assets').href;
  assert.ok(r.teacher.html.includes(`src="${base}/a.png"`), `기대 base=${base}`);
});

test('클래스: portable → copyDir 호출 + 상대 자산 재작성', async () => {
  const copyCalls = [];
  const docs = { doc1: doc({ theme: 'sci', body: '<img src="assets/a.png">' }) };
  const asm = new WorkbookAssemble(fakeDeps(docs, { copyCalls }));
  const r = await asm.execute({
    workbook: WB([{ docName: 'doc1', order: 0 }]),
    portable: true,
    portableAssetsDir: '/wb/집/assets',
  });
  assert.equal(copyCalls.length, 1);
  assert.equal(copyCalls[0].from, '/ws/doc1/assets');
  assert.match(r.teacher.html, /src="assets\/doc1\/a\.png"/);
});
