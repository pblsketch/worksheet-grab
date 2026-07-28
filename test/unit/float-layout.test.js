import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// floatLayout.js 는 src/editor 에 살지만 paper.js 는 브라우저 절대경로('/src/…')로 부른다 —
// 그 규약을 어기면 편집기가 404 로 백지가 되므로 소스를 바꿀 수 없다. nudge-float.test.js 와 같은
// 기법으로 절대경로만 file URL 로 치환해 **진짜 소스**를 로드한다.
async function loadFloatLayout() {
  const src = await readFile(resolve(ROOT, 'src/editor/floatLayout.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

// A4 세로 기본: 210×297, 여백 12/15/10/15 → 안전영역 x[15,195] y[12,287]
const flt = (id, rect, extra = {}) => ({ id, type: 'richtext', placement: 'float', html: '<p>x</p>', rect, ...extra });
const doc = (float, paper = null) => ({
  pagination: 'paginated',
  paper,
  pages: [{ id: 'p1', flow: [{ id: 'f0', type: 'title', placement: 'flow', text: 'T' }], float }],
});

test('checkFloatGeometry: 겹치지 않는 float 만 있으면 0건', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const out = checkFloatGeometry(doc([
    flt('a', { xMm: 20, yMm: 20, wMm: 40, hMm: 20 }),
    flt('b', { xMm: 80, yMm: 20, wMm: 40, hMm: 20 }),
  ]));
  assert.deepEqual(out, []);
});

test('checkFloatGeometry: 겹침 허용치 — 0.5mm 는 무시, 5mm 는 1건', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();

  const graze = checkFloatGeometry(doc([
    flt('a', { xMm: 20, yMm: 20, wMm: 40, hMm: 20 }),
    flt('b', { xMm: 59.5, yMm: 20, wMm: 40, hMm: 20 }), // x 로 0.5mm 만 겹침
  ]));
  assert.equal(graze.length, 0, '스침(0.5mm)은 겹침이 아니다');

  const real = checkFloatGeometry(doc([
    flt('a', { xMm: 20, yMm: 20, wMm: 40, hMm: 20 }),
    flt('b', { xMm: 55, yMm: 25, wMm: 40, hMm: 20 }), // x 5mm · y 15mm 겹침
  ]));
  assert.equal(real.length, 1);
  assert.equal(real[0].rule, 'float-overlap');
  assert.equal(real[0].objectId, 'a');
  assert.equal(real[0].otherId, 'b');
  assert.match(real[0].evidence, /5mm/);
});

test('checkFloatGeometry: 모서리만 닿으면(한 축 교집합 0) 0건', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const out = checkFloatGeometry(doc([
    flt('a', { xMm: 20, yMm: 20, wMm: 40, hMm: 20 }),
    flt('b', { xMm: 60, yMm: 40, wMm: 40, hMm: 20 }), // 정확히 꼭짓점에서 만남
  ]));
  assert.deepEqual(out, []);
});

test('checkFloatGeometry: 3개가 서로 겹치면 쌍 기준 3건 · 중복 쌍 없음', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const out = checkFloatGeometry(doc([
    flt('a', { xMm: 20, yMm: 20, wMm: 60, hMm: 40 }),
    flt('b', { xMm: 30, yMm: 30, wMm: 60, hMm: 40 }),
    flt('c', { xMm: 40, yMm: 25, wMm: 60, hMm: 40 }),
  ])).filter((f) => f.rule === 'float-overlap');
  assert.equal(out.length, 3);
  const pairs = out.map((f) => [f.objectId, f.otherId].sort().join('-')).sort();
  assert.deepEqual(pairs, ['a-b', 'a-c', 'b-c']);
});

test('checkFloatGeometry: 이탈 허용치 — 여백선 1mm 침범은 무시, 5mm 는 1건', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  // 안전영역 왼쪽 = 15mm
  const tiny = checkFloatGeometry(doc([flt('a', { xMm: 14, yMm: 20, wMm: 40, hMm: 20 })]));
  assert.equal(tiny.length, 0);

  const real = checkFloatGeometry(doc([flt('a', { xMm: 10, yMm: 20, wMm: 40, hMm: 20 })]));
  assert.equal(real.length, 1);
  assert.equal(real[0].rule, 'float-out-of-bounds');
  assert.match(real[0].message, /여백선/);
  assert.match(real[0].message, /보기▸여백 표시/);
  assert.equal(/용지 밖/.test(real[0].message), false, '용지 안이면 그렇게 말하면 안 된다');
});

test('checkFloatGeometry: 용지 밖으로 나가면 메시지가 그렇게 말한다', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const out = checkFloatGeometry(doc([flt('a', { xMm: 180, yMm: 20, wMm: 60, hMm: 20 })])); // 210 초과
  assert.equal(out.length, 1);
  assert.match(out[0].message, /용지 밖/);
  assert.match(out[0].evidence, /용지 밖/);
});

test('checkFloatGeometry: 용지 3종(A4 기본·B4·landscape)이 각각 다른 안전영역을 쓴다', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const rect = { xMm: 150, yMm: 20, wMm: 55, hMm: 20 }; // 오른쪽 끝 205mm

  // A4 세로(210 폭, 안전영역 오른쪽 195) → 10mm 초과 → 보고
  assert.equal(checkFloatGeometry(doc([flt('a', rect)], null)).length, 1);
  // A4 가로(297 폭) → 여유 → 0건
  assert.equal(checkFloatGeometry(doc([flt('a', rect)], { size: 'A4', orientation: 'landscape' })).length, 0);
  // B4 세로(257 폭) → 여유 → 0건
  assert.equal(checkFloatGeometry(doc([flt('a', rect)], { size: 'B4' })).length, 0);
});

test('checkFloatGeometry: shape 은 겹침에서 빠지고 이탈은 받는다', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const shape = { id: 's', type: 'shape', placement: 'float', shapeKind: 'rect', rect: { xMm: 20, yMm: 20, wMm: 60, hMm: 40 } };

  // 도형 위에 텍스트를 얹는 배경 합성은 정상 사용 — 겹침 경고 없음
  const overlap = checkFloatGeometry(doc([shape, flt('t', { xMm: 25, yMm: 25, wMm: 40, hMm: 20 })]));
  assert.deepEqual(overlap.filter((f) => f.rule === 'float-overlap'), []);

  // 그러나 용지 밖으로 나간 도형은 실제로 잘린다 — 이탈은 보고한다
  const out = checkFloatGeometry(doc([{ ...shape, rect: { xMm: 190, yMm: 20, wMm: 60, hMm: 40 } }]));
  assert.equal(out.length, 1);
  assert.equal(out[0].rule, 'float-out-of-bounds');
});

// 2026-07-28: 종전 이 자리는 "회전 개체는 두 규칙 모두에서 제외된다"를 고정하고 있었다.
// 순수 규칙은 모델에 rect·angle 이 다 있어 꼭짓점을 직접 구할 수 있으므로 OBB 로 올렸다.
// (측정 규칙 measureFloatCoverage 는 브라우저 AABB 가 입력이라 여전히 제외 — 아래 별도 테스트.)
test('checkFloatGeometry: 회전 개체의 겹침을 꼭짓점(OBB)으로 판정한다 — AABB 오탐을 걸러낸다', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();

  // 45° 로 돌린 40mm 정사각형 둘을 대각선으로 떼어 놓는다. 회전 좌표계에서 두 중심의 거리는
  // (40,40) → 40√2 ≈ 56.6mm 라 변 길이 40mm 보다 멀다 = **안 겹친다**.
  // 그런데 각자의 외접 상자는 56.6mm 라 AABB 로 보면 x·y 모두 약 16.6mm 겹친 것처럼 보인다.
  const obbSeparated = [
    flt('a', { xMm: 60, yMm: 60, wMm: 40, hMm: 40 }, { angle: 45 }),   // 중심 (80,80)
    flt('b', { xMm: 100, yMm: 100, wMm: 40, hMm: 40 }, { angle: 45 }), // 중심 (120,120)
  ];
  assert.deepEqual(
    checkFloatGeometry(doc(obbSeparated)).filter((f) => f.rule === 'float-overlap'), [],
    'AABB 로는 겹쳐 보여도 실제 꼭짓점이 안 겹치면 경고하지 않는다',
  );

  // 같은 45° 인데 중심 거리가 (10,10) → 회전 좌표계에서 14.1mm 로 변 길이 40mm 안쪽 = 겹친다.
  const obbOverlapping = [
    flt('a', { xMm: 60, yMm: 60, wMm: 40, hMm: 40 }, { angle: 45 }),
    flt('b', { xMm: 70, yMm: 70, wMm: 40, hMm: 40 }, { angle: 45 }),
  ];
  const hits = checkFloatGeometry(doc(obbOverlapping)).filter((f) => f.rule === 'float-overlap');
  assert.equal(hits.length, 1, '실제로 겹치는 회전 개체는 경고한다');
  assert.match(hits[0].evidence, /회전 개체 — 꼭짓점 기준/, '회전 판정임이 근거에 드러난다');
  assert.equal(hits[0].severity, 'warning', 'advisory 유지 — export 게이트 무접촉');

  // angle:0 경로는 종전 그대로(문자열까지) — 회전 지원이 기존 산출을 건드리지 않았다는 증거.
  const zero = [
    flt('a', { xMm: 20, yMm: 20, wMm: 60, hMm: 40 }, { angle: 0 }),
    flt('b', { xMm: 30, yMm: 30, wMm: 60, hMm: 40 }, { angle: 0 }),
  ];
  const zeroHits = checkFloatGeometry(doc(zero)).filter((f) => f.rule === 'float-overlap');
  assert.equal(zeroHits.length, 1);
  assert.match(zeroHits[0].evidence, /^50mm × 30mm 겹침$/, '회전 0 은 종전 evidence 문자열 그대로');
});

test('checkFloatGeometry: 회전 개체의 지면 이탈은 꼭짓점 외접 상자로 잰다', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();

  // A4 안전영역: 좌 15 · 상 12 · 우 195 · 하 287 (여백 12/15/10/15).
  // 100×20 을 아래쪽에 눕혀 두면 rect 로는 y 260~280 이라 안쪽이다. 45° 로 돌리면 외접 상자
  // 높이가 (100+20)·cos45 ≈ 84.9mm 로 커져 중심 270 기준 227.6~312.4 — 아래 여백선을 25mm 넘는다.
  const rotated = [flt('a', { xMm: 55, yMm: 260, wMm: 100, hMm: 20 }, { angle: 45 })];
  const rot = checkFloatGeometry(doc(rotated)).filter((f) => f.rule === 'float-out-of-bounds');
  assert.equal(rot.length, 1, '회전으로 실제 점유가 넓어진 이탈을 잡는다(종전엔 미탐)');

  // 같은 rect 를 안 돌리면 여백 안이라 조용하다 — 회전이 판정을 만든 것임을 못 박는다.
  const upright = [flt('a', { xMm: 55, yMm: 260, wMm: 100, hMm: 20 }, { angle: 0 })];
  assert.deepEqual(
    checkFloatGeometry(doc(upright)).filter((f) => f.rule === 'float-out-of-bounds'), [],
    '같은 rect 라도 회전이 없으면 이탈이 아니다',
  );
});

test('checkFloatGeometry: 모든 finding 의 severity 는 warning (예외 0)', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const out = checkFloatGeometry(doc([
    flt('a', { xMm: 10, yMm: 20, wMm: 60, hMm: 40 }),
    flt('b', { xMm: 20, yMm: 30, wMm: 60, hMm: 40 }),
    flt('c', { xMm: 190, yMm: 250, wMm: 60, hMm: 60 }),
  ]));
  assert.ok(out.length >= 3);
  for (const f of out) assert.equal(f.severity, 'warning', `${f.rule} 이 warning 이 아니다 — export 를 막으면 안 된다`);
});

test('checkFloatGeometry: 어떤 불량 입력에도 throw 하지 않고 [] 를 돌려준다', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  const bad = [
    undefined, null, {}, { pages: null }, { pages: [] },
    { pages: [{ id: 'p1', flow: [], float: null }] },
    { pages: [{ id: 'p1', float: [{ id: 'x', type: 'richtext', placement: 'float' }] }] },           // rect 없음
    { pages: [{ id: 'p1', float: [{ id: 'x', rect: { xMm: NaN, yMm: 0, wMm: 1, hMm: 1 } }] }] },      // NaN rect
    { paper: { size: '없는용지' }, pages: [{ id: 'p1', float: [] }] },                                 // resolvePaper throw
    { paper: { margins: '이상함' }, pages: [{ id: 'p1', float: [] }] },                                // 여백 파싱 throw
  ];
  for (const d of bad) {
    assert.deepEqual(checkFloatGeometry(d), [], `불량 입력에서 [] 가 아니다: ${JSON.stringify(d)}`);
  }
});

test('checkFloatGeometry: flow 전용 문서(float 0개)는 0건', async () => {
  const { checkFloatGeometry } = await loadFloatLayout();
  assert.deepEqual(checkFloatGeometry(doc([])), []);
});

test('measureFloatCoverage: DOM 없이/float 없이 호출해도 안전하고 조기 탈출한다', async () => {
  const { measureFloatCoverage } = await loadFloatLayout();
  // float 이 없으면 doc 을 아예 만지지 않는다 — 만졌다면 이 프록시가 throw 해서 [] 가 아닌 값이 나온다.
  const trap = new Proxy({}, { get() { throw new Error('float 0개인데 DOM 을 만졌다'); } });
  assert.deepEqual(measureFloatCoverage(trap, doc([])), []);
  assert.deepEqual(measureFloatCoverage(null, doc([flt('a', { xMm: 20, yMm: 20, wMm: 40, hMm: 20 })])), []);
  assert.deepEqual(measureFloatCoverage(undefined, undefined), []);
});

// ── measureFloatCoverage 규칙 검증(가짜 DOM) ────────────────────────────────
// 실브라우저 프로브(G3 스파이크)가 수치를 재고, 여기서는 **규칙 자체**를 고정한다.

/** floatLayout 이 실제로 쓰는 최소 DOM 표면만 흉내낸다. */
function fakeDoc({ floats = [], flows = [] } = {}) {
  const mk = (o, cls) => ({
    dataset: { oid: o.id },
    classList: { contains: (c) => (o.selected ? c === 'wg-selected' : false) },
    getBoundingClientRect: () => ({ left: o.x, top: o.y, width: o.w, height: o.h }),
    __cls: cls,
  });
  const floatEls = floats.map((o) => mk(o, 'float'));
  const flowEls = flows.map((o) => mk(o, 'flow'));
  const sheet = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    offsetWidth: 100,
    querySelectorAll: (sel) => (sel.includes('wg-float') ? floatEls : flowEls),
  };
  return {
    fonts: { status: 'loaded' },
    querySelectorAll: (sel) => (sel === '.sheet' ? [sheet] : []),
  };
}
// 1mm = MM_TO_PX(≈3.7795) px, scale=1 이므로 px 를 그 배수로 준다.
const MM = 96 / 25.4;
const box = (id, xMm, yMm, wMm, hMm, extra = {}) => ({ id, x: xMm * MM, y: yMm * MM, w: wMm * MM, h: hMm * MM, ...extra });

test('measureFloatCoverage: float 하나가 flow 여러 개를 덮어도 float 단위로 1건만 낸다', async () => {
  const { measureFloatCoverage } = await loadFloatLayout();
  const tree = doc([flt('F', { xMm: 0, yMm: 0, wMm: 100, hMm: 100 })]);
  const dom = fakeDoc({
    floats: [box('F', 0, 0, 100, 100)],
    flows: [box('n1', 0, 0, 50, 20), box('n2', 0, 30, 50, 20), box('n3', 0, 60, 50, 20)],
  });
  const out = measureFloatCoverage(dom, tree);
  assert.equal(out.length, 1, '쌍마다 세면 배지가 죽는다 — 교사의 할 일은 "그 개체를 옮긴다" 하나');
  assert.equal(out[0].rule, 'float-covers-flow');
  assert.equal(out[0].severity, 'warning');
  assert.equal(out[0].objectId, 'F');
  assert.deepEqual(out[0].coveredIds, ['n1', 'n2', 'n3']);
  assert.match(out[0].evidence, /본문 3개/);
});

test('measureFloatCoverage: 선택 상태(.wg-selected)인 float 은 억제된다 (결정 A-1)', async () => {
  const { measureFloatCoverage } = await loadFloatLayout();
  const tree = doc([flt('F', { xMm: 0, yMm: 0, wMm: 100, hMm: 100 })]);
  const flows = [box('n1', 0, 0, 50, 20)];
  // 승격 직후 = 선택 상태 → 조용해야 한다("방금 네가 한 조작"을 이상으로 보고하지 않는다)
  assert.deepEqual(measureFloatCoverage(fakeDoc({ floats: [box('F', 0, 0, 100, 100, { selected: true })], flows }), tree), []);
  // 선택을 풀면 통보한다
  assert.equal(measureFloatCoverage(fakeDoc({ floats: [box('F', 0, 0, 100, 100)], flows }), tree).length, 1);
});

test('measureFloatCoverage: shape 과 회전 개체는 제외된다', async () => {
  const { measureFloatCoverage } = await loadFloatLayout();
  const flows = [box('n1', 0, 0, 50, 20)];
  const floats = [box('F', 0, 0, 100, 100)];

  // shape — 본문 위에 까는 것이 설계된 용도(G3 실측: 실문서에서 도형 8개가 본문을 전체로 덮고 있었다)
  const shapeTree = doc([{ id: 'F', type: 'shape', placement: 'float', shapeKind: 'rect', rect: { xMm: 0, yMm: 0, wMm: 100, hMm: 100 } }]);
  assert.deepEqual(measureFloatCoverage(fakeDoc({ floats, flows }), shapeTree), []);

  // 회전 — rect 가 실제 점유 영역이 아니다
  const rotTree = doc([flt('F', { xMm: 0, yMm: 0, wMm: 100, hMm: 100 }, { angle: 20 })]);
  assert.deepEqual(measureFloatCoverage(fakeDoc({ floats, flows }), rotTree), []);

  // 대조군: 평범한 richtext float 은 보고된다
  assert.equal(measureFloatCoverage(fakeDoc({ floats, flows }), doc([flt('F', { xMm: 0, yMm: 0, wMm: 100, hMm: 100 })])).length, 1);
});

test('measureFloatCoverage: 1mm 미만 스침은 무시한다', async () => {
  const { measureFloatCoverage } = await loadFloatLayout();
  const tree = doc([flt('F', { xMm: 0, yMm: 0, wMm: 50, hMm: 50 })]);
  // y 로 0.5mm 만 걸침
  const graze = fakeDoc({ floats: [box('F', 0, 0, 50, 50)], flows: [box('n1', 0, 49.5, 50, 20)] });
  assert.deepEqual(measureFloatCoverage(graze, tree), []);
  const real = fakeDoc({ floats: [box('F', 0, 0, 50, 50)], flows: [box('n1', 0, 45, 50, 20)] });
  assert.equal(measureFloatCoverage(real, tree).length, 1);
});

test('floatLayout 의존(paper.js)이 브라우저 화이트리스트 안에 있다 — 이탈하면 편집기가 백지가 된다', async () => {
  // floatLayout.js 자신은 /editor/* 라우트라 화이트리스트 밖이어도 서빙되지만, 그 안의
  // '/src/usecases/paper.js' 는 /src/* 라우트라 browserGraph 밖이면 404 → 정적 ESM import 실패
  // → 모듈 그래프 전체 사망. paper.js 는 검수 체인의 전이 import 로 **우연히** 들어와 있으므로,
  // 그 체인이 paper.js 를 떼는 조용한 이탈을 여기서 잡는다.
  const { resolveBrowserGraph } = await import(`file://${resolve(ROOT, 'src/editor/browserGraph.js').replace(/\\/g, '/')}`);
  const { files } = resolveBrowserGraph(ROOT);
  assert.ok(files.includes('src/usecases/paper.js'),
    `floatLayout 이 import 하는 src/usecases/paper.js 가 브라우저 그래프에서 빠졌다. ` +
    `browserGraph.js 의 DEFAULT_ENTRIES 에 추가하거나 floatLayout 의 용지 의존을 끊어라. 현재 그래프: ${files.join(', ')}`);
});

test('measureFloatCoverage: 폰트가 안 붙었으면 측정을 건너뛴다(flow rect 가 폰트 의존적)', async () => {
  const { measureFloatCoverage } = await loadFloatLayout();
  let queried = false;
  const fakeDoc = {
    fonts: { status: 'loading' },
    querySelectorAll() { queried = true; return []; },
  };
  const out = measureFloatCoverage(fakeDoc, doc([flt('a', { xMm: 20, yMm: 20, wMm: 40, hMm: 20 })]));
  assert.deepEqual(out, []);
  assert.equal(queried, false, '폰트 게이트가 열리기 전에 DOM 을 재면 판정이 뒤집힌다');
});
