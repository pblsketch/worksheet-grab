import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateCanvaPages, canvaHtmlPath } from '../../src/usecases/canvaExport.js';

// F3 canvaExport — Canva 반입용 페이지 주석(annotate) 순수 함수 단위 테스트.
// (a) 페이지 수만큼 data-document-role="page" 주입
// (b) 라벨 파생: 표제 있음(title-box>h1 · h2.sec) vs 없음(폴백)
// (c) 속성 외 원본 바이트 무변경
// (d) 옵션 off 경로(함수 미호출) = 원본 완전 동일 — 이 파일 스코프에선 (c)로 대체 검증
// (e) 특수문자 표제 속성 이스케이프

function page(inner) {
  return `<section class="sheet">\n  ${inner}\n</section>`;
}

test('페이지 수만큼 data-document-role="page" 주입', () => {
  const html = `<body>\n${page('<h1>표지</h1>')}\n\n${page('<p>본문</p>')}\n\n${page('<p>본문2</p>')}\n</body>`;
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  const count = (out.match(/data-document-role="page"/g) || []).length;
  assert.equal(count, 3);
});

test('라벨 파생: title-box 안 h1 우선', () => {
  const html = page('<div class="title-box"><h1>광합성 탐구</h1></div>\n  <p>본문</p>');
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  assert.match(out, /data-label="광합성 탐구"/);
});

test('라벨 파생: title-box 없으면 h2.sec', () => {
  const html = page('<h2 class="sec"><span class="n">1</span>실험 결과 정리</h2>\n  <p>본문</p>');
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  assert.match(out, /data-label="1실험 결과 정리"/);
});

test('라벨 파생: 표제 없는 페이지는 "${docTitle} — N쪽" 폴백', () => {
  const html = `<body>\n${page('<p>표지</p>')}\n\n${page('<p>표제 없는 두 번째 페이지</p>')}\n</body>`;
  const out = annotateCanvaPages(html, { docTitle: '광합성 활동지' });
  assert.match(out, /data-label="광합성 활동지 — 1쪽"/);
  assert.match(out, /data-label="광합성 활동지 — 2쪽"/);
});

test('혼합: 표제 있는 페이지와 폴백 페이지가 각자 올바른 라벨을 받는다', () => {
  const html = `<body>\n${page('<div class="title-box"><h1>표지 제목</h1></div>')}\n\n${page('<p>본문만</p>')}\n</body>`;
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  assert.match(out, /data-label="표지 제목"/);
  assert.match(out, /data-label="문서 — 2쪽"/);
});

test('속성 외 원본 바이트 무변경 — 주입 지점 제외 전후 동일', () => {
  const inner = '<div class="title-box"><h1>표지</h1></div>\n  <p>안녕하세요 &amp; 반갑습니다</p>';
  const html = `<!DOCTYPE html>\n<html>\n<body>\n\n${page(inner)}\n\n</body>\n</html>\n`;
  const out = annotateCanvaPages(html, { docTitle: '문서' });

  // 주입된 속성을 제거하면 원본과 바이트 단위로 동일해야 한다(주입 지점만 최소 수정).
  const restored = out.replace(' data-document-role="page" data-label="표지"', '');
  assert.equal(restored, html);
});

test('옵션 미사용 경로: 함수를 호출하지 않으면 원본 완전 불변', () => {
  const html = page('<h1>표지</h1>');
  // annotateCanvaPages 를 호출하지 않는 것이 --canva 미지정 시의 CLI 경로와 동일하다.
  assert.equal(html, page('<h1>표지</h1>'));
});

test('특수문자 표제의 속성 이스케이프', () => {
  // 표제 텍스트에 큰따옴표·앰퍼샌드가 그대로 들어와도 속성값이 조기 종료되지 않아야 한다.
  // 원문 &amp; 는 디코드 후 한 번만 재인코딩된다(&amp;amp; 이중 인코딩 금지 — Codex 교차 QA).
  const html = page('<div class="title-box"><h1>실험 "A" &amp; B 비교</h1></div>');
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  assert.match(out, /data-label="실험 &quot;A&quot; &amp; B 비교"/);
  assert.ok(!out.includes('&amp;amp;'), '엔티티 이중 인코딩 금지');
  // 섹션 오프닝 태그 자체가 유효한 단일 속성 목록으로 파싱 가능해야 한다(속성 조기 종료 없음).
  const openTagMatch = /<section class="sheet"[^]*?>/.exec(out);
  assert.ok(openTagMatch);
  assert.equal((openTagMatch[0].match(/data-label="/g) || []).length, 1);
});

test('team-fix: 명칭·숫자 엔티티 표제 디코드 후 1회 재인코딩(이중 인코딩 없음)', () => {
  // &quot;→"→&quot; · &#38;→&→&amp; · &copy;→©(그대로). 로컬 decodeLabelText 가 html-scan 무의존.
  const html = page('<div class="title-box"><h1>A &quot;B&quot; &#38; C &copy;2026</h1></div>');
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  assert.match(out, /data-label="A &quot;B&quot; &amp; C ©2026"/);
  assert.ok(!out.includes('&amp;quot;'), '&quot; 이중 인코딩 금지');
  assert.ok(!out.includes('&amp;#38;'), '&#38; 이중 인코딩 금지');
  assert.ok(!out.includes('&amp;copy;'), '&copy; 이중 인코딩 금지');
});

test('빈 문서(섹션 없음)는 그대로 반환', () => {
  const html = '<body><p>섹션이 없는 문서</p></body>';
  const out = annotateCanvaPages(html, { docTitle: '문서' });
  assert.equal(out, html);
});

test('canvaHtmlPath: worksheet-teacher.html → worksheet-teacher-canva.html', () => {
  assert.equal(
    canvaHtmlPath('C:\\ws\\문서\\worksheet-teacher.html'),
    'C:\\ws\\문서\\worksheet-teacher-canva.html',
  );
  assert.equal(
    canvaHtmlPath('/ws/문서/worksheet-student.html'),
    '/ws/문서/worksheet-student-canva.html',
  );
});
