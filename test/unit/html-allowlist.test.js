import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHtmlField, INLINE_TAGS, BLOCK_TAGS } from '../../src/domain/schema/index.js';

// B′ 스파이크 — 필드별 HTML 허용목록 검증기(htmlAllowlist.js). 순수 Node(DOMParser 없음).
// 계약: 금지 요소가 하나라도 있으면 조용히 지우지 않고 즉시 반려(reason). 승인 시 평문 동봉.

test('허용 인라인/블록 서식은 통과하고 평문을 낸다', () => {
  const inline = validateHtmlField('<strong>강조</strong> 그리고 <em>기울임</em>', 'inline');
  assert.equal(inline.ok, true);
  assert.equal(inline.plaintext, '강조 그리고 기울임');

  const block = validateHtmlField('<p>문단1</p><ul><li>가</li><li>나</li></ul>', 'block');
  assert.equal(block.ok, true);
  assert.equal(block.plaintext, '문단1 가 나');
});

test('블록 태그(p/ul/li)는 inline 프로파일에서 거부', () => {
  const r = validateHtmlField('<p>문단</p>', 'inline');
  assert.equal(r.ok, false);
  assert.equal(r.rule, 'disallowed-tag');
  assert.equal(r.detail, 'p');
});

test('script/iframe/object/embed/form/style/meta 태그 거부', () => {
  for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'style', 'meta', 'svg', 'img', 'div']) {
    const r = validateHtmlField(`<${tag}>x</${tag}>`, 'block');
    assert.equal(r.ok, false, `<${tag}> 는 거부되어야 함`);
    assert.equal(r.rule, 'disallowed-tag');
  }
});

test('모든 속성은 a.href 를 제외하고 거부(style/class/id/data-*/on*/contenteditable/srcdoc)', () => {
  const attrs = [
    '<p style="color:red">x</p>',
    '<span class="answer">x</span>',
    '<p id="foo">x</p>',
    '<span data-x="1">y</span>',
    '<p onclick="e()">x</p>',
    '<span contenteditable="true">x</span>',
    '<p srcdoc="x">y</p>',
  ];
  for (const html of attrs) {
    const r = validateHtmlField(html, 'block');
    assert.equal(r.ok, false, `${html} 는 거부되어야 함`);
    assert.equal(r.rule, 'disallowed-attr');
  }
});

test('a.href 는 http/https/mailto 만 허용, 그 외 스킴·상대·앵커는 거부', () => {
  assert.equal(validateHtmlField('<a href="https://ex.com">o</a>', 'inline').ok, true);
  assert.equal(validateHtmlField('<a href="http://ex.com">o</a>', 'inline').ok, true);
  assert.equal(validateHtmlField('<a href="mailto:a@b.com">o</a>', 'inline').ok, true);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', '#anchor', 'ftp://x']) {
    const r = validateHtmlField(`<a href="${bad}">x</a>`, 'inline');
    assert.equal(r.ok, false, `href=${bad} 는 거부되어야 함`);
    assert.equal(r.rule, 'disallowed-url');
  }
});

test('엔티티·공백 삽입으로 위장한 javascript: URL 도 거부', () => {
  for (const bad of ['java&#09;script:alert(1)', 'java&Tab;script:x', ' javascript:x', 'JAVA\tSCRIPT:x']) {
    const r = validateHtmlField(`<a href="${bad}">x</a>`, 'inline');
    assert.equal(r.ok, false, `href=${JSON.stringify(bad)} 거부되어야 함`);
  }
});

test('주석·doctype·처리명령 거부(조용한 삭제 금지)', () => {
  assert.equal(validateHtmlField('<!-- 주석 -->', 'block').rule, 'disallowed-markup');
  assert.equal(validateHtmlField('<!doctype html>', 'block').rule, 'disallowed-markup');
  assert.equal(validateHtmlField('<?php echo 1;?>', 'block').rule, 'disallowed-markup');
});

test('닫히지 않은/불일치 태그 거부(unbalanced)', () => {
  assert.equal(validateHtmlField('<p>미닫힘', 'block').rule, 'unbalanced-tag');
  assert.equal(validateHtmlField('<b>x</i>', 'inline').rule, 'unbalanced-tag');
  assert.equal(validateHtmlField('</p>', 'block').rule, 'unbalanced-tag');
});

test('void 요소(br/hr)는 자기닫힘/무닫힘 모두 허용, 닫는 태그는 거부', () => {
  assert.equal(validateHtmlField('가<br>나<br/>다', 'inline').ok, true);
  assert.equal(validateHtmlField('<hr>', 'block').ok, true);
  assert.equal(validateHtmlField('<br></br>', 'inline').rule, 'malformed-tag');
});

test("공백이 있는 '<' 는 리터럴 텍스트로 취급(3 < 5 오탐 방지)", () => {
  const r = validateHtmlField('정답은 3 < 5 이다', 'inline');
  assert.equal(r.ok, true);
  assert.equal(r.plaintext, '정답은 3 < 5 이다');
});

test('문자열이 아니면 거부', () => {
  assert.equal(validateHtmlField(42, 'block').rule, 'html-not-string');
  assert.equal(validateHtmlField(null, 'block').ok, false);
});

// ── B2: 시맨틱 저작 프로파일 확장(code/pre/dl·dt·dd/caption) — 속성/class 봉쇄는 그대로 ──

test('B2 확장: 시맨틱 저작 태그(code/pre/dl·dt·dd/caption)는 통과하고 평문을 낸다', () => {
  const codeInline = validateHtmlField('명령은 <code>git commit</code> 이다', 'inline');
  assert.equal(codeInline.ok, true);
  assert.equal(codeInline.plaintext, '명령은 git commit 이다');

  const defList = validateHtmlField('<dl><dt>분자</dt><dd>분수의 위쪽 수</dd></dl>', 'block');
  assert.equal(defList.ok, true);
  assert.equal(defList.plaintext, '분자 분수의 위쪽 수');

  assert.equal(validateHtmlField('<pre>line1\nline2</pre>', 'block').ok, true);
  assert.equal(validateHtmlField('<table><caption>표 1</caption><tr><td>a</td></tr></table>', 'block').ok, true);
});

test('B2 경계: code 는 inline 허용, 신규 블록 태그(pre/dl/dt/dd/caption)는 inline 프로파일에서 거부', () => {
  assert.equal(validateHtmlField('<code>x</code>', 'inline').ok, true);
  for (const tag of ['pre', 'dl', 'dt', 'dd', 'caption']) {
    const r = validateHtmlField(`<${tag}>x</${tag}>`, 'inline');
    assert.equal(r.ok, false, `<${tag}> 는 inline 에서 거부되어야 함`);
    assert.equal(r.rule, 'disallowed-tag');
  }
});

test('B2 보안 경계 유지: 신규 태그에도 속성은 전면 거부(class="answer" 정답 위장 포함)', () => {
  for (const html of ['<code class="answer">42</code>', '<dt id="x">y</dt>', '<pre style="color:red">z</pre>', '<caption class="answer">t</caption>']) {
    const r = validateHtmlField(html, 'block');
    assert.equal(r.ok, false, `${html} 는 속성 때문에 거부되어야 함`);
    assert.equal(r.rule, 'disallowed-attr');
  }
});

test('프로파일 상수 정합 — 인라인 ⊆ 블록', () => {
  assert.ok(INLINE_TAGS.every((t) => BLOCK_TAGS.includes(t)));
});
