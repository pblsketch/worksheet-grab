import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkbookExport, renderBudget } from '../../src/usecases/WorkbookExport.js';

// WorkbookExport — 렌더 예산 + C4 실측 fail-closed 게이트 단위 테스트.
// 실 Chrome 은 T6 render 테스트가 담당 — 여기선 목 renderPdf/countPdfPages 로 계약만 검증.

// ── renderBudget 경계(clamp) ────────────────────────────────────────────

test('renderBudget: 0쪽·소형·대형 clamp 경계', () => {
  assert.deepEqual(renderBudget(0), { virtualTimeBudget: 15000, timeoutMs: 60000 });
  // 소형: 20쪽 → vtb=15000+5000=20000, timeout=60000+20000=80000
  assert.deepEqual(renderBudget(20), { virtualTimeBudget: 20000, timeoutMs: 80000 });
  // vtb 상한 경계: 180쪽 → 15000+45000=60000(상한), timeout=60000+180000=240000
  assert.deepEqual(renderBudget(180), { virtualTimeBudget: 60000, timeoutMs: 240000 });
  // 대형: 1000쪽 → 둘 다 상한 clamp(60000, 300000)
  assert.deepEqual(renderBudget(1000), { virtualTimeBudget: 60000, timeoutMs: 300000 });
  // 음수·NaN → 0 취급.
  assert.deepEqual(renderBudget(-5), { virtualTimeBudget: 15000, timeoutMs: 60000 });
  assert.deepEqual(renderBudget(NaN), { virtualTimeBudget: 15000, timeoutMs: 60000 });
});

test('생성자: renderPdf 함수 없으면 TypeError', () => {
  assert.throws(() => new WorkbookExport({}), /renderPdf/);
});

// ── 목 assembled + renderPdf/countPdfPages 헬퍼 ─────────────────────────

function builtVariant({ sectionCounts, probes = [] }) {
  return {
    html: 'FULLHTML',
    prefixHtml: 'PREFIXHTML',
    sectionCounts,
    memberProbes: probes,
  };
}

// renderPdf 는 label(프리픽스·프로브) 또는 outputPath(본렌더)를 경로로 반환.
// countMap: 반환 경로 → 물리 쪽수.
function makeExport(countMap, { progress } = {}) {
  const renderCalls = [];
  const renderPdf = async ({ outputPath, label }) => {
    const path = outputPath || label;
    renderCalls.push({ path, label });
    return path;
  };
  const countPdfPages = async (path) => {
    if (!(path in countMap)) throw new Error(`countMap 미정의: ${path}`);
    return countMap[path];
  };
  const exporter = new WorkbookExport({ renderPdf, countPdfPages, onProgress: progress });
  return { exporter, renderCalls };
}

// ── 게이트 통과(happy) ──────────────────────────────────────────────────

test('게이트 통과: 실측 == 표지목차 + ΣmemberSections → PDF 2벌', async () => {
  const assembled = {
    teacher: builtVariant({ sectionCounts: [2, 3] }), // Σ=5
    student: builtVariant({ sectionCounts: [2, 3] }),
    unsafeMembers: [],
  };
  const countMap = {
    'teacher-prefix': 1, '/out/teacher.pdf': 6, // 1+5=6 ✓
    'student-prefix': 1, '/out/student.pdf': 6,
  };
  const { exporter } = makeExport(countMap);
  const r = await exporter.execute({ assembled, outputs: { teacherPdfPath: '/out/teacher.pdf', studentPdfPath: '/out/student.pdf' } });
  assert.equal(r.rendered.length, 2);
  assert.deepEqual(r.rendered.map((x) => x.variant), ['teacher', 'student']);
  assert.equal(r.rendered[0].pages, 6);
  assert.equal(r.rendered[0].coverToc, 1);
  assert.equal(r.rendered[0].sigma, 5);
});

test('게이트: 목차 다쪽(coverToc=3)도 실측 반영', async () => {
  const assembled = { teacher: builtVariant({ sectionCounts: [4] }), student: null, unsafeMembers: [] };
  const countMap = { 'teacher-prefix': 3, '/out/teacher.pdf': 7 }; // 3+4=7 ✓
  const { exporter } = makeExport(countMap);
  const r = await exporter.execute({ assembled, outputs: { teacherPdfPath: '/out/teacher.pdf', studentPdfPath: '/out/student.pdf' } });
  assert.equal(r.rendered[0].pages, 7);
  assert.equal(r.rendered[0].coverToc, 3);
});

// ── unsafe: student 미산출 ──────────────────────────────────────────────

test('unsafe: assembled.student null → teacher 만 렌더', async () => {
  const assembled = { teacher: builtVariant({ sectionCounts: [2] }), student: null, unsafeMembers: ['doc2'] };
  const countMap = { 'teacher-prefix': 1, '/out/teacher.pdf': 3 };
  const { exporter, renderCalls } = makeExport(countMap);
  const r = await exporter.execute({ assembled, outputs: { teacherPdfPath: '/out/teacher.pdf', studentPdfPath: '/out/student.pdf' } });
  assert.equal(r.rendered.length, 1);
  assert.equal(r.rendered[0].variant, 'teacher');
  assert.deepEqual(r.unsafeMembers, ['doc2']);
  assert.ok(!renderCalls.some((c) => c.label === 'student' || c.path === '/out/student.pdf'));
});

// ── 게이트 실패 + 멤버 지목(pinpoint) ───────────────────────────────────

test('게이트 실패: 실측 초과 → fail-closed + 넘친 멤버 지목', async () => {
  const probes = [
    { docName: 'doc1', sectionCount: 2, html: 'P1' },
    { docName: 'doc2', sectionCount: 3, html: 'P2' },
  ];
  const assembled = { teacher: builtVariant({ sectionCounts: [2, 3], probes }), student: null, unsafeMembers: [] };
  const countMap = {
    'teacher-prefix': 1,
    '/out/teacher.pdf': 7,               // 기대 6(1+5), 실측 7 → 불일치
    'teacher-probe-doc1': 2,             // doc1 정상
    'teacher-probe-doc2': 4,             // doc2 넘침(기대 3·실측 4)
  };
  const { exporter } = makeExport(countMap);
  await assert.rejects(
    () => exporter.execute({ assembled, outputs: { teacherPdfPath: '/out/teacher.pdf', studentPdfPath: '/out/student.pdf' } }),
    (e) => {
      assert.match(e.message, /쪽수 불일치/);
      assert.match(e.message, /기대 6.*실측 7/s);
      assert.match(e.message, /doc2\(기대 3·실측 4\)/);
      assert.ok(!/doc1\(/.test(e.message), 'doc1 은 정상이라 지목 목록에서 제외');
      return true;
    },
  );
});

// ── 진행 로그 콜백 ──────────────────────────────────────────────────────

test('onProgress: render/done 이벤트 방출(예산·쪽수 포함)', async () => {
  const events = [];
  const assembled = { teacher: builtVariant({ sectionCounts: [2] }), student: null, unsafeMembers: [] };
  const countMap = { 'teacher-prefix': 1, '/out/teacher.pdf': 3 };
  const { exporter } = makeExport(countMap, { progress: (ev) => events.push(ev) });
  await exporter.execute({ assembled, outputs: { teacherPdfPath: '/out/teacher.pdf', studentPdfPath: '/out/student.pdf' } });
  const render = events.find((e) => e.phase === 'render');
  assert.ok(render);
  assert.equal(render.totalPages, 3);
  assert.equal(render.budget.virtualTimeBudget, renderBudget(3).virtualTimeBudget);
  assert.ok(events.some((e) => e.phase === 'done' && e.pages === 3));
});
