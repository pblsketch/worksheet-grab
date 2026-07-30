import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SIZE_FIELDS } from '../../src/domain/schema/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// aiLayoutGuard — AI 산출 개체의 레이아웃 필드 불변식(원칙 3 의 연장: AI 는 내용만, 조판은 교사).
// 이 가드가 새면 AI 가 교사의 폭·정렬·불투명도·회전을 지어내거나(신규) 덮어쓴다(치환).
//
// 로딩은 resize-flow.test.js 와 동형 — 모듈이 브라우저 절대경로('/src/…')로 SIZE_FIELDS 를 import
// 하므로 절대경로만 file URL 로 치환해 **진짜 소스**를 검증한다(복사본 아님).
async function loadGuard() {
  const src = await readFile(resolve(ROOT, 'src/editor/aiLayoutGuard.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

const callout = (extra = {}) => ({ id: 'c1', type: 'callout', placement: 'flow', variant: 'tip', body: '<p>x</p>', ...extra });

test('AI_LAYOUT_FIELDS 는 SIZE_FIELDS 전부 + opacity/angle(SSOT 동기화)', async () => {
  const { AI_LAYOUT_FIELDS } = await loadGuard();
  for (const f of SIZE_FIELDS) assert.ok(AI_LAYOUT_FIELDS.includes(f), `SIZE_FIELDS.${f} 누락 — 카탈로그가 늘면 가드도 따라야 함`);
  assert.ok(AI_LAYOUT_FIELDS.includes('opacity'), 'opacity(자유배치 표현) 포함');
  assert.ok(AI_LAYOUT_FIELDS.includes('angle'), 'angle(자유배치 표현) 포함');
});

test('신규 생성(before 없음): AI 가 실은 레이아웃 필드를 전부 버린다', async () => {
  const { enforceAiLayout } = await loadGuard();
  const dirty = callout({ widthPct: 60, minHeightMm: 30, align: 'center', opacity: 0.5, angle: 15 });
  const out = enforceAiLayout(dirty);
  assert.deepEqual(out, callout(), 'AI 가 조판을 낳지 못한다 — 내용 필드만 남아야 함');
});

test('치환(before 있음): AI 값은 무시하고 교사 값만 되살린다', async () => {
  const { enforceAiLayout } = await loadGuard();
  // 교사가 폭 60·가운데 정렬을 잡아 둔 개체를, AI 가 문구를 고치며 폭 100·왼쪽으로 되돌려 보냈다.
  const before = callout({ widthPct: 60, align: 'center' });
  const aiReturned = callout({ body: '<p>고친 내용</p>', widthPct: 100, align: 'left', opacity: 0.3 });
  const out = enforceAiLayout(aiReturned, before);
  assert.equal(out.body, '<p>고친 내용</p>', '내용 변경은 반영');
  assert.equal(out.widthPct, 60, '교사 폭이 지켜져야 함(AI 100 무시)');
  assert.equal(out.align, 'center', '교사 정렬이 지켜져야 함(AI left 무시)');
  assert.equal(out.opacity, undefined, '교사가 안 준 opacity 를 AI 가 끼워 넣지 못함');
});

test('치환: 교사가 크기를 안 잡았으면 AI 가 새로 끼워 넣지 못한다', async () => {
  const { enforceAiLayout } = await loadGuard();
  const before = callout();                       // 교사가 크기 미지정
  const aiReturned = callout({ widthPct: 40, angle: 90 });
  const out = enforceAiLayout(aiReturned, before);
  assert.equal(out.widthPct, undefined, '없던 폭이 생기면 안 됨');
  assert.equal(out.angle, undefined, '없던 각도가 생기면 안 됨');
  assert.deepEqual(out, callout(), '결과는 크기 없는 원 개체와 같아야 함');
});

test('레이아웃 외 필드는 손대지 않는다', async () => {
  const { enforceAiLayout } = await loadGuard();
  const obj = callout({ variant: 'warning', title: '주의', titleHtml: '<b>주의</b>' });
  const out = enforceAiLayout(obj);
  assert.equal(out.variant, 'warning');
  assert.equal(out.title, '주의');
  assert.equal(out.titleHtml, '<b>주의</b>');
});

test('순수: 입력 개체와 before 를 변형하지 않는다', async () => {
  const { enforceAiLayout } = await loadGuard();
  const obj = callout({ widthPct: 100 });
  const before = callout({ widthPct: 60 });
  const objSnap = JSON.parse(JSON.stringify(obj));
  const beforeSnap = JSON.parse(JSON.stringify(before));
  enforceAiLayout(obj, before);
  assert.deepEqual(obj, objSnap, 'AI 개체가 변형되면 미리보기 diff 가 오염된다');
  assert.deepEqual(before, beforeSnap, 'before(교사 개체)가 변형되면 undo 스냅샷이 오염된다');
});

test('전 타입 공통(callout 만이 아님): 표·리치텍스트도 동일하게 막는다', async () => {
  const { enforceAiLayout } = await loadGuard();
  const table = { id: 't1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a' }]], widthPct: 70, align: 'right' };
  const out = enforceAiLayout(table);
  assert.equal(out.widthPct, undefined);
  assert.equal(out.align, undefined);
  assert.equal(out.splittable, false, '내용 구조는 보존');
});
