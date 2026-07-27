import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EDITOR_DIR = resolve(ROOT, 'src/editor');

// canvasInline.js 는 브라우저 모듈이라 node 가 직접 import 할 수 없다 — 자신은 상대 경로로
// objectFactory.js 를 부르고, 그 objectFactory 는 다시 '/src/…' 절대 경로(편집기 서버가 매핑해
// 서빙하는 규약)를 부른다. nudge-float.test.js 의 기법을 한 단계 확장해서, 안쪽 objectFactory 를
// 먼저 data:URL 모듈로 만든 뒤 canvasInline 의 상대 import 를 그 URL 로 치환한다. 복사본이 아니라
// **진짜 소스**의 순수 함수·상수를 그대로 단위 검증하기 위함이다.
async function loadCanvasInline() {
  const srcUrl = pathToFileURL(resolve(ROOT, 'src')).href;
  // encodeURIComponent 는 작은따옴표를 escape 하지 않는다 — 그대로 두면 이 URL 을 다시
  // `from '…'` 안에 넣을 때 바깥 문자열이 조기 종료되어 SyntaxError 가 난다.
  const toDataUrl = (code) => `data:text/javascript,${encodeURIComponent(code).replace(/'/g, '%27')}`;

  const objectFactorySrc = await readFile(resolve(EDITOR_DIR, 'objectFactory.js'), 'utf8');
  const objectFactoryUrl = toDataUrl(objectFactorySrc.replace(/from '\/src\//g, `from '${srcUrl}/`));

  const canvasInlineSrc = await readFile(resolve(EDITOR_DIR, 'canvasInline.js'), 'utf8');
  const rewritten = canvasInlineSrc
    .replace(/from '\.\/objectFactory\.js'/g, `from '${objectFactoryUrl}'`)
    .replace(/from '\/src\//g, `from '${srcUrl}/`);
  return import(toDataUrl(rewritten));
}

// ── shouldPromoteBodyDrag — 승격 판정(순수) ──────────────────────────────────
//
// 이 상호작용의 회귀 표면 대부분은 실마우스가 필요 없다. 임계·편집 가드·셀렉터 제외·float 양보를
// 여기서 고정해 두면, CDP 실입력이 정말 필요한 잔여분은 포인터 캡처 유지·교차 페이지
// insertBefore·드래그 후 click 삼키기 셋뿐이 된다.

test('shouldPromoteBodyDrag: 임계(5px) 양방향 — 4px 미승격 / 12px 승격', async () => {
  const { shouldPromoteBodyDrag, FLOW_DRAG_THRESHOLD_PX } = await loadCanvasInline();
  assert.equal(FLOW_DRAG_THRESHOLD_PX, 5, '임계는 leftPanel 썸네일 재정렬과 같은 리포 선례값이어야 한다');

  // 미달 — 클릭 선택·더블클릭 편집 진입이 살아 있어야 하는 구간
  assert.equal(shouldPromoteBodyDrag({ dx: 0, dy: 0 }), false);
  assert.equal(shouldPromoteBodyDrag({ dx: 4, dy: 4 }), false);
  assert.equal(shouldPromoteBodyDrag({ dx: -4, dy: 0 }), false);

  // 경계값 자체는 승격(>= 비교)
  assert.equal(shouldPromoteBodyDrag({ dx: 5, dy: 0 }), true);
  assert.equal(shouldPromoteBodyDrag({ dx: 0, dy: -5 }), true);

  // 의도적 끌기
  assert.equal(shouldPromoteBodyDrag({ dx: 0, dy: 12 }), true);
  assert.equal(shouldPromoteBodyDrag({ dx: -12, dy: 0 }), true);
});

test('shouldPromoteBodyDrag: 가드 — 거리를 아무리 크게 줘도 소유자가 있는 지점은 승격 안 함', async () => {
  const { shouldPromoteBodyDrag } = await loadCanvasInline();
  const far = { dx: 999, dy: 999 };

  assert.equal(shouldPromoteBodyDrag({ ...far, button: 2 }), false, '우클릭 = 컨텍스트 메뉴 소관');
  assert.equal(shouldPromoteBodyDrag({ ...far, button: 1 }), false, '가운데 클릭도 아님');
  assert.equal(shouldPromoteBodyDrag({ ...far, editingId: 'o1' }), false, '편집 중 = 캐럿·드래그 선택 우선');
  assert.equal(shouldPromoteBodyDrag({ ...far, blockedBySelector: true }), false, 'NO_BODY_DRAG 적중');
  assert.equal(shouldPromoteBodyDrag({ ...far, isFloat: true }), false, '자유 개체는 selection.js 소관');
  assert.equal(shouldPromoteBodyDrag({ ...far, hasObj: false }), false, '.wg-obj 밖 = 마퀴 소관');

  // 가드가 전부 풀리면 승격
  assert.equal(shouldPromoteBodyDrag({ ...far, button: 0, editingId: null }), true);
});

test('shouldPromoteBodyDrag: 순수 — 인자 없이/기본값만으로도 throw 하지 않고 DOM 을 만지지 않는다', async () => {
  const { shouldPromoteBodyDrag } = await loadCanvasInline();
  assert.equal(shouldPromoteBodyDrag(), false, '기본 dx/dy=0 이므로 미승격');
  assert.equal(shouldPromoteBodyDrag({}), false);
  // threshold 주입 가능(호출부가 임계를 바꿔도 판정 로직은 한 곳)
  assert.equal(shouldPromoteBodyDrag({ dx: 3, dy: 0, threshold: 2 }), true);
  assert.equal(shouldPromoteBodyDrag({ dx: 3, dy: 0, threshold: 10 }), false);
  // 소스에 DOM 전역 참조가 없다(순수성)
  assert.equal(/document|window|getComputedStyle/.test(shouldPromoteBodyDrag.toString()), false);
});

// ── NO_BODY_DRAG 초크포인트 가드 ─────────────────────────────────────────────
//
// `editorStyle.js` 는 iframe 안에서 `pointer-events: auto` 를 부여하는 **유일한 CSS 장소**다.
// 새 조작 UI 를 만들려면 거기에 규칙을 넣어야 하므로, 그 선택자 집합이 NO_BODY_DRAG ∪ 예외목록에
// 담겨 있음을 단정하면 "목록 갱신을 잊어 조용히 충돌"하는 드리프트가 테스트 실패로 드러난다.
// (browser-purity.test.js 가 그래프 규칙을 테스트로 강제하는 것과 같은 패턴.)

/**
 * 본체 드래그 가드가 **셀렉터 목록이 아닌 다른 방식으로** 이미 덮고 있는 선택자.
 * 하드코딩하지 않고 인자로 노출한다 — 예외가 생기면 이 목록에 근거와 함께 추가하고, 그 행위
 * 자체가 리뷰 대상이 되게 하기 위함이다.
 */
const COVERED_BY_OTHER_GUARD = Object.freeze([
  // `.wg-float` 조상 검사(shouldPromoteBodyDrag 의 isFloat)가 자유 개체 전체를 조기 반환시킨다.
  { selector: '.wg-float:not(.wg-selected) > *', reason: '.wg-float 조기 반환(isFloat 가드)' },
  { selector: '.wg-float.wg-selected, .wg-float.wg-editing', reason: '.wg-float 조기 반환(isFloat 가드)' },
]);

/** `pointer-events: auto` 를 선언하는 CSS 규칙의 선택자만 뽑는다(공백 정규화). */
function selectorsGrantingPointerEvents(css) {
  const out = [];
  // `선택자 { … pointer-events: auto … }` 블록 단위 스캔.
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    if (!/pointer-events\s*:\s*auto/.test(m[2])) continue;
    out.push(m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim());
  }
  return out;
}

test('초크포인트: editorStyle.js 의 pointer-events:auto 선택자가 전부 NO_BODY_DRAG 나 예외목록에 있다', async () => {
  const { NO_BODY_DRAG_SELECTORS } = await loadCanvasInline();
  const css = await readFile(resolve(EDITOR_DIR, 'editorStyle.js'), 'utf8');
  const granting = selectorsGrantingPointerEvents(css);

  assert.ok(granting.length > 0, 'pointer-events:auto 규칙을 하나도 못 찾았다면 파서가 깨진 것');

  const listed = new Set(NO_BODY_DRAG_SELECTORS);
  const excepted = new Set(COVERED_BY_OTHER_GUARD.map((e) => e.selector));
  const unregistered = granting.filter((sel) => !listed.has(sel) && !excepted.has(sel));

  assert.deepEqual(unregistered, [],
    `editorStyle.js 가 pointer-events:auto 를 주는 선택자가 본체 드래그 가드에 등록되지 않았다. ` +
    `NO_BODY_DRAG_SELECTORS 에 추가하거나, 다른 가드가 덮는다면 COVERED_BY_OTHER_GUARD 에 근거와 함께 넣어라: ${unregistered.join(' | ')}`);
});

test('초크포인트: src/editor/*.js 의 인라인 pointerEvents:"auto" 도 등록을 강제한다', async () => {
  // 마퀴(스냅 가이드·선택 박스)가 인라인 지정 선례를 만들었다 — 현재 값은 전부 'none' 이라
  // 무해하지만, 앞으로 인라인으로 'auto' 를 주는 조작 UI 가 하나만 들어와도 CSS 만 훑는
  // 가드는 초록인 채로 계약이 깨진다. 그래서 인라인도 함께 스캔한다.
  const files = (await readdir(EDITOR_DIR)).filter((f) => f.endsWith('.js') && f !== 'testSeed.js');
  const offenders = [];
  for (const f of files) {
    const raw = await readFile(resolve(EDITOR_DIR, f), 'utf8');
    // 주석은 계약이 아니라 설명이다 — 이 규칙을 서술하는 문장 자체가 오탐이 되면 안 된다.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const re = /pointerEvents\s*:\s*['"]auto['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      offenders.push(`${f}: ${src.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, ' ').trim()}`);
    }
  }
  assert.deepEqual(offenders, [],
    `인라인으로 pointer-events:'auto' 를 주는 지점이 생겼다. 본체 드래그 가드(NO_BODY_DRAG_SELECTORS)에 ` +
    `대응 선택자를 등록하고 이 테스트의 허용 목록을 함께 갱신하라: ${offenders.join(' | ')}`);
});

test('초크포인트: NO_BODY_DRAG_SELECTORS 는 편집 진입 전 요소를 과잉 차단하지 않는다', async () => {
  const { NO_BODY_DRAG_SELECTORS } = await loadCanvasInline();
  // .q-part[data-part] 와 td[data-r] 는 **편집 진입 시에만** contenteditable 을 얻는다.
  // 이들을 통째로 목록에 넣으면 question/table 개체 몸통 대부분이 드래그 사각지대가 된다 —
  // `[contenteditable="true"]` 하나로 정확히 편집 중일 때만 막는 것이 옳다.
  for (const bad of ['.q-part', '.q-part[data-part]', 'td[data-r]', 'th[data-r]', '.wg-obj']) {
    assert.equal(NO_BODY_DRAG_SELECTORS.includes(bad), false,
      `${bad} 를 목록에 넣으면 개체 몸통 대부분이 드래그 불가가 된다`);
  }
  assert.ok(NO_BODY_DRAG_SELECTORS.includes('[contenteditable="true"]'));
});
