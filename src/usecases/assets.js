// assets — 이미지 자산 처리의 순수 정책(IO 없음 → 목 없이 단위 테스트 가능).
// 파일명 정규화·경로탈출 차단·확장자 화이트리스트·크기 상한·동명 충돌 접미사만 담당한다.
// 실제 파일 쓰기/읽기는 EditorHttpServer 어댑터가 assetsDir 기준으로 수행한다.
//
// 자산 수명(§F1-6): 업로드된 이미지는 영구 파일이다 — GC·자동 삭제 없음. 삭제는 교사 수동.
// 히스토리 스냅샷(manifest)은 자산 파일을 버전하지 않는다(자산은 경로 참조만 저장).
// SVG 는 화이트리스트에서 제외한다(스크립트 내장 XSS 벡터 — 인쇄 자산엔 불필요).

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB 상한(로컬 편집 도구 안전선)
export const ALLOWED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/** 파일명에서 확장자(소문자) 추출. 선행 점 파일(.htaccess)은 확장자 없음으로 본다. */
function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * 업로드 바이트 앞부분의 매직 시그니처로 실제 이미지 형식을 판정한다(순수, IO 없음).
 * 확장자 위장 업로드(예: 실행파일을 .png 로) 차단용 심층 방어. 정규 표기('png'|'jpeg'|
 * 'gif'|'webp') 반환, 미지/부족이면 null.
 * @param {Uint8Array|Buffer} buf
 */
export function sniffImageFormat(buf) {
  if (!buf || buf.length < 12) return null; // 시그니처 판정 최소 길이(WebP 12B)
  const b = buf;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  // GIF: "GIF87a" | "GIF89a"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
    && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'gif';
  // WebP: "RIFF" .... "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/**
 * 업로드 파일명 정규화. 디렉토리 성분(경로 탈출·절대경로)을 제거하고 안전 문자만 남긴다.
 * 동명 충돌 시 접미사(-1, -2 …)를 붙인다(existing 목록 기준, 순수).
 * @param {string} raw 클라이언트가 준 파일명(쿼리/헤더)
 * @param {string[]} existing assetsDir 의 기존 파일명 목록(충돌 회피용). 기본 [].
 * @returns {string} 안전 파일명(확장자 포함) — assertAllowedImage 로 다시 검증할 것.
 */
export function sanitizeAssetName(raw, existing = []) {
  const s = String(raw ?? '');
  if (s.includes('\0')) throw new Error('파일명에 널 바이트가 포함될 수 없습니다.');
  // 마지막 / 또는 \ 뒤 성분만 취해 디렉토리·절대경로·상위경로(..)를 물리적으로 제거한다.
  let base = (s.split(/[\\/]/).pop() ?? '').trim();
  if (base === '' || base === '.' || base === '..') throw new Error(`유효하지 않은 파일명: "${raw}"`);

  const ext = extOf(base).replace(/[^a-z0-9]/g, '');
  const dot = base.lastIndexOf('.');
  let stem = dot > 0 ? base.slice(0, dot) : base;
  // 파일명 안전 문자: 유니코드 문자(한글 포함)·숫자·_·- 만. 나머지는 _ 로 접고 양끝 _ 제거.
  stem = stem.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
  if (!stem) stem = 'image';
  // Windows 예약 장치명(CON·PRN·AUX·NUL·COM1-9·LPT1-9)은 확장자가 붙어도 rename 이
  // 실패하거나 장치로 해석될 수 있다 — 접두사로 회피(플랫폼 무관 동일 동작).
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `img-${stem}`;

  const compose = (n) => (ext ? (n ? `${stem}-${n}.${ext}` : `${stem}.${ext}`) : (n ? `${stem}-${n}` : stem));
  let name = compose(0);
  if (existing && existing.length) {
    // case-fold 비교: Windows/mac 은 대소문자 무구분 FS 라 'A.png'·'a.png' 가 같은 파일이다.
    const set = new Set(existing.map((e) => String(e).toLowerCase()));
    let i = 0;
    while (set.has(name.toLowerCase())) name = compose(++i);
  }
  return name;
}

/**
 * 이미지 형식·크기 검증(fail-closed). 확장자 화이트리스트(SVG 제외)·5MB 상한.
 * bytes 를 주면 매직 시그니처를 확인해 확장자와 불일치 시 거부한다(위장 업로드 차단).
 * @param {string} name sanitizeAssetName 을 거친 파일명
 * @param {number} size 바이트 수
 * @param {Uint8Array|Buffer|null} [bytes] 업로드 본문(주면 매직바이트 대조)
 * @returns {{ext:string, mime:string}}
 */
export function assertAllowedImage(name, size, bytes = null) {
  const ext = extOf(String(name));
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
    throw new Error(`허용되지 않는 이미지 형식: "${ext || '(확장자 없음)'}". 허용: ${ALLOWED_IMAGE_EXTS.join(', ')} (SVG 제외).`);
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('이미지 크기가 유효하지 않습니다(0바이트/비수치).');
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`이미지가 너무 큽니다(${size} bytes > 상한 ${MAX_IMAGE_BYTES} bytes = 5MB).`);
  }
  if (bytes != null) {
    const sniffed = sniffImageFormat(bytes);
    const canonical = ext === 'jpg' ? 'jpeg' : ext; // jpg·jpeg 는 동일 형식으로 본다
    if (sniffed == null) {
      throw new Error(`이미지 매직 시그니처를 인식할 수 없습니다(확장자 ".${ext}"). 실제 PNG/JPEG/GIF/WebP 파일인지 확인하세요.`);
    }
    if (sniffed !== canonical) {
      throw new Error(`파일 내용(${sniffed})이 확장자(.${ext})와 일치하지 않습니다 — 위장 업로드가 차단되었습니다.`);
    }
  }
  return { ext, mime: MIME_BY_EXT[ext] };
}

/** 파일명 확장자로 image MIME 을 판정(GET 서빙용). 미지원이면 null. */
export function imageMimeFor(name) {
  return MIME_BY_EXT[extOf(String(name))] ?? null;
}
