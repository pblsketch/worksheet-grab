import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAssetName, assertAllowedImage, imageMimeFor, sniffImageFormat,
  MAX_IMAGE_BYTES, ALLOWED_IMAGE_EXTS,
} from '../../src/usecases/assets.js';

// F1 자산 정책(순수): 파일명 정규화·경로탈출 차단·확장자 화이트리스트·5MB·동명 충돌·매직바이트.

// 최소 유효 시그니처 샘플(≥12B).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0x80, 0])]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1')]);

test('sanitizeAssetName: 디렉토리 성분 제거(트래버설·절대경로·백슬래시)', () => {
  assert.equal(sanitizeAssetName('photo.png'), 'photo.png');
  assert.equal(sanitizeAssetName('../../etc/passwd.png'), 'passwd.png', '상위경로는 basename 만');
  assert.equal(sanitizeAssetName('/abs/path/x.png'), 'x.png', '절대경로 제거');
  assert.equal(sanitizeAssetName('C:\\Windows\\y.jpg'), 'y.jpg', '백슬래시 경로 제거');
  assert.equal(sanitizeAssetName('a/b/c/d.webp'), 'd.webp');
});

test('sanitizeAssetName: 널바이트·빈이름·상위경로 토큰 거부(fail-closed)', () => {
  assert.throws(() => sanitizeAssetName('x\0.png'), /널 바이트/);
  assert.throws(() => sanitizeAssetName('..'), /유효하지 않은/);
  assert.throws(() => sanitizeAssetName('.'), /유효하지 않은/);
  assert.throws(() => sanitizeAssetName('   '), /유효하지 않은/, '공백만 → 빈이름');
  assert.throws(() => sanitizeAssetName('foo/..'), /유효하지 않은/, 'basename 이 .. 면 거부');
});

test('sanitizeAssetName: 안전문자 정규화(한글 보존·특수문자 _·대문자 확장자 소문자화)', () => {
  assert.equal(sanitizeAssetName('내 사진.png'), '내_사진.png', '한글 보존·공백 _');
  assert.equal(sanitizeAssetName('a b*c?.jpg'), 'a_b_c.jpg', '특수문자 접기·양끝 _ 제거');
  assert.equal(sanitizeAssetName('IMG.PNG'), 'IMG.png', '확장자 소문자화');
  assert.equal(sanitizeAssetName('a.b.png'), 'a_b.png', '중간 점은 stem 의 특수문자');
});

test('sanitizeAssetName: Windows 예약 장치명은 접두사로 회피(Codex 교차 QA)', () => {
  assert.equal(sanitizeAssetName('CON.png'), 'img-CON.png');
  assert.equal(sanitizeAssetName('nul.jpg'), 'img-nul.jpg');
  assert.equal(sanitizeAssetName('COM1.webp'), 'img-COM1.webp');
  assert.equal(sanitizeAssetName('console.png'), 'console.png', '예약명을 포함만 하면 무관');
});

test('sanitizeAssetName: 동명 충돌 시 접미사(-1, -2 …)', () => {
  assert.equal(sanitizeAssetName('a.png', ['a.png']), 'a-1.png');
  assert.equal(sanitizeAssetName('a.png', ['a.png', 'a-1.png']), 'a-2.png');
  assert.equal(sanitizeAssetName('a.png', ['b.png']), 'a.png', '충돌 없으면 원명');
});

test('assertAllowedImage: 화이트리스트 확장자만 허용(SVG·미지·무확장자 거부)', () => {
  for (const ext of ALLOWED_IMAGE_EXTS) {
    const r = assertAllowedImage(`x.${ext}`, 1000);
    assert.ok(r.mime.startsWith('image/'), `${ext} → ${r.mime}`);
  }
  assert.throws(() => assertAllowedImage('x.svg', 1000), /허용되지 않는/, 'SVG 제외');
  assert.throws(() => assertAllowedImage('x.png.svg', 1000), /허용되지 않는/, '실확장자=svg');
  assert.throws(() => assertAllowedImage('noext', 1000), /허용되지 않는/);
  assert.throws(() => assertAllowedImage('x.exe', 1000), /허용되지 않는/);
});

test('assertAllowedImage: 5MB 초과·0바이트·음수 거부(경계 5MB 허용)', () => {
  assert.throws(() => assertAllowedImage('x.png', MAX_IMAGE_BYTES + 1), /너무 큽니다/);
  assert.doesNotThrow(() => assertAllowedImage('x.png', MAX_IMAGE_BYTES), '정확히 5MB 는 허용');
  assert.throws(() => assertAllowedImage('x.png', 0), /유효하지 않/);
  assert.throws(() => assertAllowedImage('x.png', -5), /유효하지 않/);
});

test('assertAllowedImage: jpg·jpeg 는 동일 image/jpeg', () => {
  assert.equal(assertAllowedImage('a.jpg', 10).mime, 'image/jpeg');
  assert.equal(assertAllowedImage('a.jpeg', 10).mime, 'image/jpeg');
});

test('sniffImageFormat: 시그니처별 형식 판정·부족/미지 null (Codex 교차 QA)', () => {
  assert.equal(sniffImageFormat(PNG), 'png');
  assert.equal(sniffImageFormat(JPEG), 'jpeg');
  assert.equal(sniffImageFormat(GIF), 'gif');
  assert.equal(sniffImageFormat(WEBP), 'webp');
  assert.equal(sniffImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null, '4바이트(길이 부족)는 미지');
  assert.equal(sniffImageFormat(Buffer.from('plain text not an image', 'latin1')), null);
  assert.equal(sniffImageFormat(null), null);
});

test('assertAllowedImage: bytes 주면 매직바이트 대조(위장 업로드 차단)', () => {
  assert.deepEqual(assertAllowedImage('a.png', PNG.length, PNG), { ext: 'png', mime: 'image/png' });
  assert.equal(assertAllowedImage('a.jpg', JPEG.length, JPEG).mime, 'image/jpeg', 'jpg 확장자에 jpeg 시그니처 허용');
  assert.equal(assertAllowedImage('a.jpeg', JPEG.length, JPEG).mime, 'image/jpeg');
  assert.doesNotThrow(() => assertAllowedImage('a.gif', GIF.length, GIF));
  assert.doesNotThrow(() => assertAllowedImage('a.webp', WEBP.length, WEBP));
  // 4바이트 가짜 png → 시그니처 미인식 거부
  const fake = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.throws(() => assertAllowedImage('a.png', fake.length, fake), /매직 시그니처/);
  // 확장자·내용 불일치(png 바이트인데 .gif) → 거부
  assert.throws(() => assertAllowedImage('a.gif', PNG.length, PNG), /일치하지 않습니다/);
  // bytes 미제공(기존 호출부) → 매직 검사 생략(하위호환)
  assert.doesNotThrow(() => assertAllowedImage('a.png', 1000));
});

test('sanitizeAssetName: 동명 충돌 case-fold(대소문자 무구분 FS — Codex 교차 QA)', () => {
  assert.equal(sanitizeAssetName('a.png', ['A.png']), 'a-1.png', 'A.png 존재 → a.png 충돌로 접미사');
  assert.equal(sanitizeAssetName('A.png', ['a.png']), 'A-1.png');
  assert.equal(sanitizeAssetName('Photo.PNG', ['photo.png']), 'Photo-1.png', '확장자 대소문자 무관 충돌');
});

test('imageMimeFor: 확장자별 MIME·대소문자 무관·미지원 null', () => {
  assert.equal(imageMimeFor('a.png'), 'image/png');
  assert.equal(imageMimeFor('a.WEBP'), 'image/webp');
  assert.equal(imageMimeFor('a.gif'), 'image/gif');
  assert.equal(imageMimeFor('a.svg'), null, 'SVG 는 서빙 대상 아님');
  assert.equal(imageMimeFor('a'), null);
});
