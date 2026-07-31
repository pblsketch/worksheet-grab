import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { validateAiFragment } from '../../src/domain/schema/index.js';

// B5(i) — "답안 포함 섹션 저작"의 2단계 계약(HANDOFF-bprime-followups §1 B5, 결정 (i)).
//
// B′ 프래그먼트는 답안을 저작하지 않는다(결정 (a), ADR §7 — 누출 100% 구조 차단). 그래서 "연습문제
// 섹션을 정답까지 한 번에"는 **2단계**로 이룬다: (1) 프래그먼트로 답 없는 scaffold 섹션을 저작하고,
// (2) 적용된 새 question 개체에 **기존 rewrite/--ops 경로**로 question.answerKey 를 부착한다.
// answerKey 는 ObjectCatalog 의 question optional 필드라 스키마상 유효하고, sanitizeObject 가 보존하며
// (ai.js — answerKey.html 은 정제만), RenderObjectTree 가 .answer 로 방출하고, BuildVariants 가 학생 벌에서
// 물리 제거한다(누출 방어 상존). 이 파일은 그 2단계가 기존 부품만으로 **끝에서 끝까지 성립**함을 고정한다.

// objectFactory 는 브라우저 절대경로('/src/…')를 import 하므로 node 가 직접 import 못 한다 —
// editor-ai-ops.test.js 관례대로 절대경로만 file URL 로 치환해 진짜 소스를 로드한다.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let cached = null;
async function applyOps(...args) {
  if (!cached) {
    const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
    const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
    cached = await import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
  }
  return cached.applyAiOps(...args);
}

const ASSETS = { paperCss: '/* paper */', blocksCss: '/* blocks */', themeCss: '/* theme */' };

// 1단계 산출을 모사: 답 없는 scaffold 섹션이 이미 적용돼 새 question 이 문서 흐름에 있다.
const authoredDoc = () => ({
  pagination: 'paginated',
  pages: [{
    id: 'page-1',
    flow: [{ id: 'q-new', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '2+2 는?' }],
    float: [],
  }],
});

const attachAnswerOp = () => ([{
  op: 'replace',
  id: 'q-new',
  object: {
    id: 'q-new', type: 'question', placement: 'flow', qtype: 'short-answer', prompt: '2+2 는?',
    answerKey: { text: '4', html: '<p>정답: 4</p>' },
  },
}]);

test('B5(i) 경계: 프래그먼트(B′)는 answerKey 를 거부한다 — 답안 미생성 결정 (a) 유지', () => {
  const r = validateAiFragment([
    { type: 'question', qtype: 'short-answer', prompt: '2+2 는?', answerKey: { text: '4' } },
  ]);
  assert.equal(r.ok, false, '프래그먼트에 answerKey 가 있으면 반려되어야 한다');
  assert.ok(r.findings.some((f) => f.rule === 'forbidden-answer'), 'answerKey 는 forbidden-answer 로 거부');
});

test('B5(i) 2단계: rewrite --ops replace 로 새 question 에 answerKey 를 부착·적용한다', async () => {
  const { document: after } = await applyOps(authoredDoc(), attachAnswerOp());
  const q = after.pages[0].flow.find((o) => o.id === 'q-new');
  assert.ok(q && q.answerKey, 'replace 로 answerKey 가 부착되어야 한다');
  assert.equal(q.answerKey.text, '4');
  assert.equal(q.answerKey.html, '<p>정답: 4</p>');
  assert.equal(q.type, 'question', '개체 타입/식별자는 그대로(부착만)');
});

test('B5(i) 누출 안전: answerKey 는 .answer 로 렌더돼 교사 벌엔 보이고 학생 벌엔 물리 제거된다', async () => {
  const { document: after } = await applyOps(authoredDoc(), attachAnswerOp());
  const { html } = new RenderObjectTree().execute(after, ASSETS, {});
  assert.match(html, /class="answer"/, 'answerKey 는 .answer 래퍼로 방출된다');
  assert.match(html, /정답: 4/, '렌더 원본(MODE_TOKEN)에는 정답이 있다');

  const { student, teacher } = new BuildVariants().execute(html);
  assert.match(teacher, /정답: 4/, '교사 벌: 정답 노출');
  assert.ok(!student.includes('정답: 4'), '학생 벌: 정답 물리 제거(누출 방어)');
  assert.match(student, /data-mode="student"/);
  assert.match(teacher, /data-mode="teacher"/);
});
