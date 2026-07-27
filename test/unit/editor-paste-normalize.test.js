import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeNode,
  normalizePastedHtml,
  normalizePastedText,
} from '../../src/editor/pasteNormalize.js';

// normalizeNode 는 최소 노드 인터페이스만 소비하므로 가짜 트리로 진짜 단위 검증이 된다
// (프로젝트 의존성 0 — jsdom 을 들이지 않는다. DOMParser 경로는 render 스위트가 실브라우저로 덮는다).
const txt = (nodeValue) => ({ nodeType: 3, nodeValue });
const el = (tagName, children = [], attributes = {}) => ({
  nodeType: 1, tagName, childNodes: children, attributes, // attributes 는 의도적으로 무시돼야 한다
});
const root = (...children) => ({ childNodes: children });

test('Word 스타일 span 은 속성이 사라지고 텍스트만 남는다', () => {
  const tree = root(el('SPAN', [txt('광합성 실험')], { style: 'font-family:굴림; font-size:14pt', class: 'MsoNormal' }));
  const out = normalizeNode(tree);
  assert.equal(out, '광합성 실험');
  assert.ok(!/style=/.test(out) && !/class=/.test(out), '표현 속성이 남으면 안 된다');
});

test('허용 인라인 서식은 보존되고 속성만 벗겨진다', () => {
  const tree = root(
    el('B', [txt('굵게')], { style: 'color:#f00' }),
    txt(' 그리고 '),
    el('EM', [txt('기울임')]),
  );
  assert.equal(normalizeNode(tree), '<b>굵게</b> 그리고 <em>기울임</em>');
});

test('중첩 div/p 는 <br> 로 평탄화된다', () => {
  const tree = root(
    el('DIV', [txt('첫 줄')]),
    el('DIV', [el('P', [txt('둘째 줄')])]),
  );
  assert.equal(normalizeNode(tree), '첫 줄<br>둘째 줄');
});

test('script/style 은 내용까지 통째로 버린다', () => {
  const tree = root(
    txt('앞'),
    el('SCRIPT', [txt('alert(1)')]),
    el('STYLE', [txt('body{color:red}')]),
    txt('뒤'),
  );
  assert.equal(normalizeNode(tree), '앞뒤');
});

test('img 는 버리고 a 는 텍스트만 남긴다', () => {
  const tree = root(
    el('IMG', [], { src: 'http://evil.example/x.png' }),
    el('A', [txt('링크 문구')], { href: 'javascript:alert(1)' }),
  );
  const out = normalizeNode(tree);
  assert.equal(out, '링크 문구');
  assert.ok(!/href/.test(out) && !/javascript:/.test(out));
});

test('허용 목록 밖 태그는 언랩되어 텍스트가 보존된다', () => {
  const tree = root(el('FONT', [el('CENTER', [txt('가운데')])], { color: 'red' }));
  assert.equal(normalizeNode(tree), '가운데');
});

test('빈 서식 태그는 남기지 않는다', () => {
  assert.equal(normalizeNode(root(el('B', []), txt('내용'))), '내용');
});

test('표는 셀 텍스트를 줄바꿈으로 평탄화한다', () => {
  const tree = root(el('TABLE', [
    el('TR', [el('TD', [txt('A')]), el('TD', [txt('B')])]),
    el('TR', [el('TD', [txt('C')])]),
  ]));
  assert.equal(normalizeNode(tree), 'AB<br>C');
});

test('텍스트의 &, <, > 는 이스케이프된다(태그로 재해석되지 않는다)', () => {
  assert.equal(normalizeNode(root(txt('a < b & c > d'))), 'a &lt; b &amp; c &gt; d');
  assert.equal(normalizeNode(root(txt('<script>alert(1)</script>'))), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('주석 노드는 버린다', () => {
  assert.equal(normalizeNode(root(txt('앞'), { nodeType: 8, nodeValue: ' 주석 ' }, txt('뒤'))), '앞뒤');
});

test('br 은 보존되고 연속 br·앞뒤 br 은 정리된다', () => {
  assert.equal(normalizeNode(root(txt('가'), el('BR'), el('BR'), txt('나'))), '가<br>나');
  // 블록 평탄화가 만든 선행·후행 줄바꿈은 남지 않는다.
  assert.equal(normalizeNode(root(el('DIV', [txt('본문')]))), '본문');
});

test('빈 입력·평문 입력은 무해하게 처리된다', () => {
  assert.equal(normalizeNode(root()), '');
  assert.equal(normalizeNode({ }), '');
  assert.equal(normalizeNode(root(txt('그냥 평문'))), '그냥 평문');
});

test('normalizePastedText 는 줄바꿈만 br 로 바꾸고 나머지는 이스케이프한다', () => {
  assert.equal(normalizePastedText('첫 줄\n둘째 <b>줄</b>'), '첫 줄<br>둘째 &lt;b&gt;줄&lt;/b&gt;');
  assert.equal(normalizePastedText(''), '');
});

test('normalizePastedHtml 은 주입 파서를 통해 같은 정규화를 적용한다', () => {
  const parsed = { body: root(el('SPAN', [txt('주입 경로')], { style: 'color:red' })) };
  assert.equal(normalizePastedHtml('<span style="color:red">주입 경로</span>', () => parsed), '주입 경로');
});

test('중첩 서식과 한글이 함께 있어도 구조가 보존된다', () => {
  const tree = root(el('B', [txt('굵고 '), el('EM', [txt('기울인')]), txt(' 한글')]));
  assert.equal(normalizeNode(tree), '<b>굵고 <em>기울인</em> 한글</b>');
});
