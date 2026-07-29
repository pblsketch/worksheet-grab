import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// reviewChip.js 는 브라우저 절대 specifier('/src/…', '/editor/…')를 쓴다 — 그 규약을 어기면 편집기가
// 404 로 백지가 되므로 소스를 바꿀 수 없다(floatLayout.js 머리말 참조). float-layout.test.js 와 같은
// 기법으로 **진짜 소스**를 로드하되, 전이 의존인 floatLayout 도 같은 치환이 필요해 data:URL 을 중첩한다.
// ⚠ 중첩 data:URL 은 base64 로 싣는다. encodeURIComponent 는 작은따옴표를 인코딩하지 않아서
//    안쪽 URL 을 `from '…'` 안에 넣는 순간 문자열이 끊긴다(floatLayout 의 severity:'warning' 에서
//    SyntaxError 로 터졌다).
const dataUrl = (src) => `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;

async function loadReviewChip() {
  const srcUrl = `${pathToFileURL(resolve(ROOT, 'src')).href}/`;
  const floatSrc = (await readFile(resolve(ROOT, 'src/editor/floatLayout.js'), 'utf8'))
    .replace(/from '\/src\//g, `from '${srcUrl}`);
  const chipSrc = (await readFile(resolve(ROOT, 'src/editor/reviewChip.js'), 'utf8'))
    .replace(/from '\/src\//g, `from '${srcUrl}`)
    .replace(/from '\/editor\/floatLayout\.js'/g, `from '${dataUrl(floatSrc)}'`);
  return import(dataUrl(chipSrc));
}

// ── 무대 ────────────────────────────────────────────────────────────────────────
// 검수 칩의 측정 규칙(float-covers-flow)은 **모델 × DOM 쌍**으로 계산된다. 여기서 고정하는 것은
// 그 쌍이 어긋난 채 화면에 칠해지지 않는가다. rAF·fonts.ready 를 테스트가 직접 풀어 주므로
// 타이밍에 의존하지 않는다(⑥ 이 CDP 로 재현하지 못한 경합을 여기서는 결정적으로 재현한다).

const MM = 96 / 25.4;
const rect = (xMm, yMm, wMm, hMm) => ({
  left: xMm * MM, top: yMm * MM, width: wMm * MM, height: hMm * MM,
  right: (xMm + wMm) * MM, bottom: (yMm + hMm) * MM,
});

/** float F 가 본문 f0 를 넓게 덮는 문서(모델) — 측정하면 float-covers-flow 1건. */
const DOC_WITH_FLOAT = {
  pagination: 'paginated',
  docTitle: '검수칩 세대 시험',
  pages: [{
    id: 'p1',
    flow: [{ id: 'f0', type: 'title', placement: 'flow', text: '제목' }],
    float: [{ id: 'F', type: 'richtext', placement: 'float', html: '<p>덮개</p>', rect: { xMm: 20, yMm: 20, wMm: 60, hMm: 40 } }],
  }],
};
/** 같은 문서에서 float 을 치운 것 — 측정하면 0건(측정 함수가 DOM 접근 전에 조기 탈출한다). */
const DOC_NO_FLOAT = {
  pagination: 'paginated',
  docTitle: '검수칩 세대 시험',
  pages: [{ id: 'p1', flow: [{ id: 'f0', type: 'title', placement: 'flow', text: '제목' }], float: [] }],
};

/**
 * teacher iframe 문서 스텁. DOM 은 **언제나 겹치는 배치**를 돌려준다 — 그래야 "모델이 낡았는지"만이
 * 결과를 가른다(DOM 을 함께 바꾸면 무엇이 원인인지 구분할 수 없다).
 */
function makeTeacherDoc({ fontsStatus = 'loaded' } = {}) {
  const rafQueue = [];
  let releaseFonts = () => {};
  const newReady = () => new Promise((r) => { releaseFonts = r; });

  const floatEl = { dataset: { oid: 'F' }, classList: { contains: () => false }, getBoundingClientRect: () => rect(20, 20, 60, 40) };
  const flowEl = { dataset: { oid: 'f0' }, getBoundingClientRect: () => rect(20, 25, 100, 30) };
  const sheet = {
    offsetWidth: 210 * MM,
    getBoundingClientRect: () => rect(0, 0, 210, 297),
    querySelectorAll: (sel) => (sel.startsWith('.wg-float') ? [floatEl] : sel.startsWith('.wg-obj') ? [flowEl] : []),
  };
  const doc = {
    fonts: { status: fontsStatus, ready: newReady() },
    documentElement: { outerHTML: '<html><body></body></html>' },
    querySelectorAll: (sel) => (sel === '.sheet' ? [sheet] : []),
    defaultView: { requestAnimationFrame: (fn) => rafQueue.push(fn) },
  };
  return {
    doc,
    /** 예약된 rAF 를 전부 흘린다(중첩 rAF 포함). */
    drain() {
      for (let i = 0; i < 8 && rafQueue.length; i += 1) rafQueue.splice(0).forEach((fn) => fn());
    },
    /** 폰트 로딩 완료 — 대기 중인 fonts.ready 를 푼다. */
    async loadFonts() {
      doc.fonts.status = 'loaded';
      releaseFonts();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    },
    /** 새 폰트 로딩 시작 — 브라우저처럼 status 를 되돌리고 ready 를 새 약속으로 바꾼다. */
    startFontLoad() {
      doc.fonts.status = 'loading';
      doc.fonts.ready = newReady();
    },
  };
}

function makeChip() {
  return { dataset: {}, textContent: '', addEventListener: () => {} };
}

const coverCount = (chip) => chip.getFindings().filter((f) => f.rule === 'float-covers-flow').length;

// ── 시험 ────────────────────────────────────────────────────────────────────────

test('전제: 측정 배선이 살아 있다(덮으면 1건, 치우면 0건)', async () => {
  const { createReviewChip } = await loadReviewChip();
  const t = makeTeacherDoc();
  let live = DOC_WITH_FLOAT;
  const chip = createReviewChip({ chipEl: makeChip(), getDocument: () => live, getTeacherDoc: () => t.doc });

  chip.runReview({ measure: true });
  t.drain();
  assert.equal(coverCount(chip), 1, 'float 이 본문을 덮으면 측정 규칙이 1건을 낸다');
  assert.ok(!chip.getFindings().some((f) => f.rule === 'review-error'), `검수가 예외로 죽었다: ${JSON.stringify(chip.getFindings())}`);

  live = DOC_NO_FLOAT;
  chip.runReview({ measure: true });
  t.drain();
  assert.equal(coverCount(chip), 0, 'float 이 없으면 0건');
});

test('폰트 대기 중이던 낡은 측정이 그 뒤의 재렌더 결과를 덮어쓰지 않는다', async () => {
  const { createReviewChip } = await loadReviewChip();
  const t = makeTeacherDoc({ fontsStatus: 'loading' });
  let live = DOC_WITH_FLOAT;
  const chip = createReviewChip({ chipEl: makeChip(), getDocument: () => live, getTeacherDoc: () => t.doc });

  // 세대 1 — 폰트가 아직이라 측정을 못 하고 fonts.ready 대기에 걸린다.
  chip.runReview({ measure: true });
  t.drain();
  assert.equal(coverCount(chip), 0, '폰트 게이트가 걸린 동안엔 아직 측정 결과가 없다');

  // 그 사이 교사가 float 을 지웠다 — 재렌더 뒤의 검수가 올바른 값(0건)을 칠한다.
  live = DOC_NO_FLOAT;
  t.doc.fonts.status = 'loaded';
  chip.runReview({ measure: true });
  t.drain();
  assert.equal(coverCount(chip), 0, '최신 측정은 0건이어야 한다(전제)');

  // 이제 세대 1 이 걸어 둔 폰트 대기가 풀린다. 낡은 모델(float 이 있던 문서)로 다시 재면
  // 이미 지운 개체에 대한 경고가 되살아나 최신 결과를 덮는다.
  await t.loadFonts();
  t.drain();

  assert.equal(coverCount(chip), 0, '낡은 세대의 측정이 최신 결과를 덮어썼다(세대 가드가 없거나 트립하지 않는다)');
});

test('폰트가 다시 로딩 중이 되면 새 세대도 폰트 대기를 다시 건다', async () => {
  const { createReviewChip } = await loadReviewChip();
  const t = makeTeacherDoc({ fontsStatus: 'loading' });
  let live = DOC_NO_FLOAT;
  const chip = createReviewChip({ chipEl: makeChip(), getDocument: () => live, getTeacherDoc: () => t.doc });

  // 세대 1 — 폰트 대기에 걸렸다가 폰트가 붙어 정상 측정(0건).
  chip.runReview({ measure: true });
  t.drain();
  await t.loadFonts();
  t.drain();
  assert.equal(coverCount(chip), 0);

  // 새 글리프가 붙어 폰트가 다시 로딩 상태가 된 채로, float 이 생긴 문서가 재렌더됐다.
  t.startFontLoad();
  live = DOC_WITH_FLOAT;
  chip.runReview({ measure: true });
  t.drain();
  assert.equal(coverCount(chip), 0, '폰트 게이트 동안엔 측정하지 않는다(전제)');

  // 폰트가 붙으면 이 세대의 대기가 풀려 측정이 이어져야 한다.
  await t.loadFonts();
  t.drain();
  assert.equal(coverCount(chip), 1, '폰트 대기가 문서당 1회로 굳어 두 번째 이후 세대가 영영 측정되지 않는다');
});
