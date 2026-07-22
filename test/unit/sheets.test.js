import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSheets, renumberRunFoot, rewriteAssetUrls, SECTION_OPEN, SECTION_CLOSE } from '../../src/usecases/sheets.js';

// sheets — 슬라이서·재번호·자산 재작성 순수 헬퍼 단위 테스트.
// 합의 계획 C1(수술 봉쇄)·C2(자산 커버리지+카운트)·C5(재합성 바이트 동일)을 게이트한다.

const IS = '　'; // U+3000 전각 공백(run-foot 쪽번호 구분자)

// AssembleWorksheet.js:143-150 산출을 모사한 섹션 빌더.
function mkSection({ runHead = '머리글', left = '왼쪽', rightPrefix = '활동지', pageNo = 1, body = '<p>본문</p>' } = {}) {
  return `${SECTION_OPEN}
  <span class="mode-badge"></span>
  <div class="run-head">${runHead}</div>

  ${body}

  <div class="run-foot"><span>${left}</span><span>${rightPrefix}${IS}${pageNo}</span></div>
${SECTION_CLOSE}`;
}

// AssembleWorksheet.js:153-176 문서 셸을 모사(섹션 사이 '\n\n' 갭).
function mkDoc(sections) {
  return `<!DOCTYPE html>\n<html lang="ko" data-mode="student">\n<head><title>t</title></head>\n<body data-mode="student" data-subject="과학">\n\n${sections.join('\n\n')}\n\n</body>\n</html>\n`;
}

// ── splitSheets: 슬라이스 경계 (0·1·N 섹션) ──────────────────────────────

test('splitSheets: 섹션 0개 — head 가 전체, sections 빈 배열, tail 빈 문자열', () => {
  const html = '<body><p>섹션이 없는 문서</p></body>';
  const { head, sections, tail } = splitSheets(html);
  assert.equal(head, html);
  assert.deepEqual(sections, []);
  assert.equal(tail, '');
});

test('splitSheets: 섹션 1개 — 재합성 바이트 동일(C5)', () => {
  const doc = mkDoc([mkSection({ pageNo: 1 })]);
  const { head, sections, tail } = splitSheets(doc);
  assert.equal(sections.length, 1);
  assert.equal(head + sections.join('') + tail, doc);
  // 유일 섹션은 순수(꼬리 없음) — `</section>` 로 끝난다.
  assert.ok(sections[0].startsWith(SECTION_OPEN));
  assert.ok(sections[0].endsWith(SECTION_CLOSE));
});

test('splitSheets: 섹션 N개 — 재합성 바이트 동일 + 섹션간 갭 보존(C5)', () => {
  const doc = mkDoc([mkSection({ pageNo: 1 }), mkSection({ pageNo: 2 }), mkSection({ pageNo: 3 })]);
  const { head, sections, tail } = splitSheets(doc);
  assert.equal(sections.length, 3);
  assert.equal(head + sections.join('') + tail, doc, '재합성이 원본과 바이트 동일해야 한다');
  // 비마지막 섹션은 섹션간 바이트('\n\n')를 꼬리로 흡수, 마지막은 순수.
  assert.ok(sections[0].endsWith('\n\n'), '비마지막 섹션은 섹션간 갭을 꼬리로 흡수');
  assert.ok(sections[1].endsWith('\n\n'));
  assert.ok(sections[2].endsWith(SECTION_CLOSE), '마지막 섹션은 순수(꼬리 없음)');
  // head 는 첫 섹션 앞 전부, tail 은 마지막 `</section>` 뒤 전부.
  assert.ok(head.endsWith('\n\n'));
  assert.ok(tail.startsWith('\n\n</body>'));
  // 각 섹션은 SECTION_OPEN 으로 시작.
  for (const s of sections) assert.ok(s.startsWith(SECTION_OPEN));
});

test('splitSheets: 닫힘 태그 없는 섹션(방어) — 끝까지 소비, tail 없음, 재합성 동일', () => {
  const html = `<body>\n${SECTION_OPEN}\n<p>닫히지 않은 섹션</p>`;
  const { head, sections, tail } = splitSheets(html);
  assert.equal(sections.length, 1);
  assert.equal(tail, '');
  assert.equal(head + sections.join('') + tail, html);
});

test('splitSheets: 비문자열 입력은 TypeError', () => {
  assert.throws(() => splitSheets(null), TypeError);
  assert.throws(() => splitSheets(123), TypeError);
});

// ── renumberRunFoot: 재번호 정확성 ──────────────────────────────────────

test('renumberRunFoot: run-foot 쪽번호를 절대 번호로 치환', () => {
  const s = mkSection({ pageNo: 1, rightPrefix: '활동지' });
  const out = renumberRunFoot(s, 5);
  assert.match(out, new RegExp(`활동지${IS}5</span></div>`));
  assert.ok(!out.includes(`활동지${IS}1</span>`), '기존 쪽번호는 사라져야 한다');
});

test('renumberRunFoot: 여러 자리 쪽번호(1→12)도 치환', () => {
  const s = mkSection({ pageNo: 1 });
  const out = renumberRunFoot(s, 12);
  assert.match(out, new RegExp(`${IS}12</span></div>`));
});

test('renumberRunFoot: rightPrefix 에 U+3000 이 있어도 마지막 U+3000 뒤 숫자만 치환', () => {
  const s = mkSection({ pageNo: 1, rightPrefix: `2단원${IS}정리` });
  const out = renumberRunFoot(s, 7);
  assert.match(out, new RegExp(`2단원${IS}정리${IS}7</span>`));
  assert.ok(out.includes(`2단원${IS}정리`), 'rightPrefix 내부 U+3000 은 보존');
  assert.ok(!out.includes(`정리${IS}1</span>`));
});

test('renumberRunFoot: run-foot 없는 섹션(표지·목차)은 무변경', () => {
  const cover = `${SECTION_OPEN}\n  <div class="title-box"><h1>자료집 표지</h1></div>\n${SECTION_CLOSE}`;
  assert.equal(renumberRunFoot(cover, 3), cover);
});

test('renumberRunFoot: 비문자열 입력은 TypeError', () => {
  assert.throws(() => renumberRunFoot(null, 1), TypeError);
});

// ── renumberRunFoot: 적대적 케이스 + 봉쇄 불변식(C1) ────────────────────

test('C1: 본문에 가짜 run-foot 패턴이 있어도 마지막(진짜) run-foot 만 재번호', () => {
  const fake = `<div class="run-foot"><span>가짜</span><span>본문${IS}99</span></div>`;
  const s = mkSection({ pageNo: 1, body: `<p>참고</p>\n  ${fake}` });
  const out = renumberRunFoot(s, 3);
  // 진짜(말미) run-foot 만 3 으로, 가짜(본문)의 99 는 무변경.
  assert.ok(out.includes(`본문${IS}99</span>`), '본문 속 가짜 run-foot 은 무변경(C1)');
  assert.match(out, new RegExp(`활동지${IS}3</span></div>`));
  assert.ok(!out.includes(`활동지${IS}1</span>`));
});

test('C1: 본문 텍스트의 쪽번호 유사 패턴(U+3000+숫자)은 무변경', () => {
  const s = mkSection({ pageNo: 1, body: `<p>선택지${IS}1 을 고르시오. 정답은 42.</p>` });
  const out = renumberRunFoot(s, 8);
  assert.ok(out.includes(`선택지${IS}1 을 고르시오. 정답은 42.`), '본문 바이트는 무변경(C1)');
  assert.match(out, new RegExp(`활동지${IS}8</span></div>`));
});

test('C1: run-foot 밖 바이트 무변경 — prefix/suffix 봉쇄 단언(자리수 변동 포함)', () => {
  // 본문에도 `　1` 를 심어 전역 치환이면 오염될 위치를 만든다.
  const original = mkSection({ pageNo: 1, body: `<p>보기${IS}1 참고</p>` });
  for (const n of [5, 10, 100]) {
    const out = renumberRunFoot(original, n);
    const RF_OPEN = '<div class="run-foot">';
    const oOpen = original.lastIndexOf(RF_OPEN);
    const oEnd = original.indexOf('</div>', oOpen) + '</div>'.length;
    const uOpen = out.lastIndexOf(RF_OPEN);
    const uEnd = out.indexOf('</div>', uOpen) + '</div>'.length;
    // run-foot 앞·뒤 바이트가 완전히 동일해야 한다(그 안 숫자만 변함).
    assert.equal(out.slice(0, uOpen), original.slice(0, oOpen), 'run-foot 앞 바이트 무변경');
    assert.equal(out.slice(uEnd), original.slice(oEnd), 'run-foot 뒤 바이트 무변경');
    assert.ok(out.slice(uOpen, uEnd).includes(`${IS}${n}</span>`));
  }
});

// ── rewriteAssetUrls: 변형 커버리지 + 카운트 불변식(C2) ────────────────

const MEMBER_URL = 'file:///E:/ws/m1/assets';

test('C2: src/url 5+변형 전부 치환 + count 가 독립 스캔과 일치', () => {
  const html = [
    '<img src="assets/img/a.png">',
    "<img src='assets/img/b.png'>",
    '<div style="background:url(assets/bg.png)"></div>',
    '<div style=\'background:url("assets/bg2.png")\'></div>',
    '<div style="background:url(\'assets/bg3.png\')"></div>',
    '<div style="background:url( assets/bg4.png )"></div>',
    '<p>파일은 assets/ 폴더에 있습니다</p>',
  ].join('\n');

  const { html: out, count } = rewriteAssetUrls(html, MEMBER_URL);

  // 독립 스캔: src=/url() 문맥의 assets/ 참조 수.
  const independent = (html.match(/(?:src\s*=\s*["']|url\(\s*["']?)assets\//g) || []).length;
  assert.equal(count, independent, '치환 수 == 독립 스캔 자산 ref 수(C2)');
  assert.equal(count, 6);

  // 각 변형이 절대 URL 로 치환됐는지.
  assert.ok(out.includes('src="file:///E:/ws/m1/assets/img/a.png"'));
  assert.ok(out.includes("src='file:///E:/ws/m1/assets/img/b.png'"));
  assert.ok(out.includes('url(file:///E:/ws/m1/assets/bg.png)'));
  assert.ok(out.includes('url("file:///E:/ws/m1/assets/bg2.png")'));
  assert.ok(out.includes("url('file:///E:/ws/m1/assets/bg3.png')"));
  assert.ok(out.includes('url( file:///E:/ws/m1/assets/bg4.png )'));
});

test('C1: 일반 텍스트 속 assets/ 는 무변경(카운트에도 미포함)', () => {
  const html = '<p>assets/ 폴더를 열고 assets/readme 를 보세요</p>';
  const { html: out, count } = rewriteAssetUrls(html, MEMBER_URL);
  assert.equal(count, 0);
  assert.equal(out, html, '속성 문맥 밖 assets/ 는 바이트 무변경(C1)');
});

test('rewriteAssetUrls: memberAssetsAbsUrl 후행 슬래시 정규화(이중 슬래시 방지)', () => {
  const html = '<img src="assets/a.png">';
  const { html: out } = rewriteAssetUrls(html, 'file:///E:/ws/m1/assets/');
  assert.ok(out.includes('src="file:///E:/ws/m1/assets/a.png"'));
  assert.ok(!out.includes('assets//a.png'));
});

test('rewriteAssetUrls: 자산 참조 없으면 count 0, html 불변', () => {
  const html = '<section class="sheet"><p>이미지 없음</p></section>';
  const { html: out, count } = rewriteAssetUrls(html, MEMBER_URL);
  assert.equal(count, 0);
  assert.equal(out, html);
});

test('rewriteAssetUrls: 비문자열 입력은 TypeError', () => {
  assert.throws(() => rewriteAssetUrls(null, MEMBER_URL), TypeError);
});

// ── 통합: splitSheets → renumberRunFoot 재번호 시퀀스 == [1..N] ─────────

test('통합: 저장본 슬라이스 후 각 섹션 재번호 → run-foot 숫자 시퀀스가 [1..N]', () => {
  // 원본은 pageNo 가 각 문서 기준(1,2)인 두 섹션. 절대 번호 3,4 로 재번호.
  const doc = mkDoc([mkSection({ pageNo: 1 }), mkSection({ pageNo: 2 })]);
  const { head, sections, tail } = splitSheets(doc);
  const renumbered = sections.map((s, i) => renumberRunFoot(s, i + 3));
  const out = head + renumbered.join('') + tail;
  const nums = (out.match(new RegExp(`${IS}(\\d+)</span></div>`, 'g')) || [])
    .map((m) => Number(m.replace(new RegExp(`${IS}|</span></div>`, 'g'), '')));
  assert.deepEqual(nums, [3, 4]);
});
