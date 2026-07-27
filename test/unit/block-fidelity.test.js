import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { fingerprint, fidelityLosses, compareHtml } from '../helpers/fidelity.js';

// 0단계 안전망 — 편집기 이식(TipTap) 전에 "지금 내용"을 재는 자를 먼저 세운다.
//
// 이 파일이 하는 일은 둘이다:
//  (1) 손실 측정기가 실제로 손실을 잡는지 픽스처로 증명한다(가드가 허수아비면 무의미).
//  (2) 블록 라이브러리 전체의 지문을 뜬다 — 이식 후 같은 자로 재서 줄어들면 실패.
// browser-purity 가드가 "가드 실효성"을 픽스처로 증명하는 것과 같은 규약을 따른다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = new FsBlockRepository({ root: ROOT });

test('가드 실효성: 텍스트·태그·클래스·속성 소실을 각각 검출한다(픽스처 증명)', () => {
  const base = '<div class="qbox"><p>탐구 문제를 쓰자</p><img src="a.png" alt="그림"></div>';

  assert.deepEqual(compareHtml(base, base), [], '동일 입력은 무손실');

  const textLost = compareHtml(base, '<div class="qbox"><p>탐구 문제를</p><img src="a.png" alt="그림"></div>');
  assert.ok(textLost.some((l) => l.startsWith('텍스트 소실')), `텍스트 소실 검출: ${JSON.stringify(textLost)}`);

  const tagLost = compareHtml(base, '<div class="qbox"><p>탐구 문제를 쓰자</p></div>');
  assert.ok(tagLost.some((l) => l.includes('태그 소실: img')), `태그 소실 검출: ${JSON.stringify(tagLost)}`);

  const classLost = compareHtml(base, '<div><p>탐구 문제를 쓰자</p><img src="a.png" alt="그림"></div>');
  assert.ok(classLost.some((l) => l.includes('클래스 소실: qbox')), `클래스 소실 검출: ${JSON.stringify(classLost)}`);

  const attrLost = compareHtml(base, '<div class="qbox"><p>탐구 문제를 쓰자</p><img src="a.png"></div>');
  assert.ok(attrLost.some((l) => l.includes('속성 소실: alt=그림')), `속성 소실 검출: ${JSON.stringify(attrLost)}`);
});

test('가드 관용성: 래퍼 추가·공백 정규화는 손실이 아니다', () => {
  const base = '<div class="qbox"><p>탐구  문제를\n쓰자</p></div>';
  // 이식이 바깥에 래퍼를 하나 더 두르는 것은 정상 — 막아야 하는 건 소실뿐이다.
  const wrapped = '<section><div class="qbox"><p>탐구 문제를 쓰자</p></div></section>';
  assert.deepEqual(compareHtml(base, wrapped), [], '래퍼 추가·공백 차이는 통과');
});

test('가드 관용성: 태그 사이 들여쓰기 제거는 손실이 아니다 (실측 오탐 고정)', () => {
  // 원본은 사람이 읽기 좋게 들여쓴 HTML, 왕복본은 그 서식이 빠지고 셀 안이 <p> 로 감싸진다.
  // 실제 ProseMirror 왕복에서 나온 모습 그대로 — 이걸 소실로 세면 13개 블록이 헛되이 빨간불이었다.
  const pretty = '<table class="lv-table">\n    <tr><td class="label">항목 1</td><td class="blank"></td></tr>\n'
    + '    <tr><td class="label gray">항목 2</td><td class="blank"></td></tr>\n  </table>';
  const roundtripped = '<table class="lv-table"><tbody><tr><td class="label"><p>항목 1</p></td>'
    + '<td class="blank"></td></tr><tr><td class="label gray"><p>항목 2</p></td><td class="blank"></td></tr></tbody></table>';
  assert.deepEqual(compareHtml(pretty, roundtripped), [], '들여쓰기 제거 + <p> 래핑은 통과');
});

test('가드 엄격성: 텍스트 노드 안의 공백이 사라지면 잡는다', () => {
  // 위 관용성이 "모든 공백을 봐준다"는 뜻이 되면 가드가 무력해진다 — 내용 공백은 지킨다.
  const base = '<div class="unit"><b>단원</b>　단원명</div>';
  const spaceLost = '<div class="unit"><b>단원</b>단원명</div>';
  const losses = compareHtml(base, spaceLost);
  assert.ok(losses.some((l) => l.startsWith('텍스트 소실')), `내용 공백 소실 검출: ${JSON.stringify(losses)}`);
});

test('블록 라이브러리 전체의 지문을 뜬다(이식 후 비교 기준선)', async () => {
  const files = await repo.listBlocks();
  assert.ok(files.length >= 20, `블록 파일 ${files.length}개 — 라이브러리가 비어 있지 않다`);

  const empty = [];
  let totalTags = 0;
  for (const file of files) {
    const html = await repo.loadBlockHtml(file);
    const fp = fingerprint(html);
    // 자기 자신과의 비교는 언제나 무손실이어야 한다(측정기 안정성).
    assert.deepEqual(fidelityLosses(fp, fp), [], `${file}: 자기 비교 무손실`);
    if (!fp.text && Object.keys(fp.tags).length === 0) empty.push(file);
    totalTags += Object.values(fp.tags).reduce((a, b) => a + b, 0);
  }
  assert.deepEqual(empty, [], '내용이 비어 지문을 뜰 수 없는 블록은 없다');
  assert.ok(totalTags > 100, `전체 태그 ${totalTags}개 — 기준선이 유의미한 규모`);
});

test('SVG 를 쓰는 블록이 있다 — 이식 시 스키마가 아니라 원문 보존이 필요한 지점', async () => {
  const files = await repo.listBlocks();
  const svgFiles = [];
  for (const file of files) {
    const fp = fingerprint(await repo.loadBlockHtml(file));
    if (fp.tags.svg) svgFiles.push(file);
  }
  // ProseMirror 에 SVG 개념이 없으므로, 이 블록들은 atom NodeView 로 원문을 지켜야 한다.
  // 목록이 늘어나면(새 SVG 블록 추가) 이식 스키마도 같이 손봐야 한다는 신호.
  assert.ok(svgFiles.length > 0, `SVG 블록이 존재: ${svgFiles.join(', ')}`);
});
