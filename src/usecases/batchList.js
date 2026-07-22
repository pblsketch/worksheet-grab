// batchList — 자료집 배치 등록 입력 파서(순수, 의존성 0). 합의 계획 §2(c): 무API 원칙상
// "배치 생성"은 콘텐츠를 저작하는 CLI 명령이 될 수 없고, 하네스 반복 절차가 저작하는
// 동안 CLI 는 멱등 장부(batch-plan)만 관리한다. 이 모듈은 그 장부 등록의 입력 파일
// (JSON/JSONL/CSV)을 정규화된 행 배열로 파싱하는 순수 함수만 제공한다 — 콘텐츠 생성·
// 파일 IO 없음(Chrome·워크스페이스 무지 → 목 없이 단위 테스트).
//
// 지원 형식: JSON(최상위 배열) · JSONL(줄당 객체) 1차, CSV 2차 — CSV 이스케이프 규칙은
// GepaiCurriculum.parseCsv(어댑터, src/adapters/GepaiCurriculum.js)와 동일한 최소
// RFC4180 스타일(따옴표·이중따옴표 이스케이프·개행)을 이 모듈 안에 독립 재구현한다
// (usecases 는 adapters 에 의존하지 않는다 — Clean Architecture 방향 보존).
//
// 마크다운은 명시 거부한다: 0-dep 견고 마크다운 파서가 없어 표/리스트를 어설프게
// 파싱하면 행이 조용히 잘려나가는(fail-open) 위험이 있다 — 계획 기각 근거 그대로.
//
// 행 스키마: { subject(교과), grade(학년), topic(주제), standardCode?(성취기준 코드),
// title?(목차 표기) }. subject/grade/topic 은 필수 — 결손 행은 조용히 스킵하지 않고
// 행 번호와 함께 즉시 error(fail-closed). topic+standardCode 조합 중복 행도 동일하게
// 즉시 error(행 번호 지목).

const SUPPORTED_FORMATS = ['auto', 'json', 'jsonl', 'csv'];
const REQUIRED_FIELDS = ['subject', 'grade', 'topic'];

/**
 * @param {string} text 입력 파일 전체 내용(JSON/JSONL/CSV).
 * @param {'auto'|'json'|'jsonl'|'csv'} format 형식 힌트. 기본 'auto'(내용으로 자동 판별).
 * @returns {Array<{row:number, subject:string, grade:string, topic:string,
 *   standardCode:string|null, title:string|null}>} 정규화된 행 배열(문서 순서 보존).
 *   row 는 파싱된 데이터 행 기준 1-based 순번(형식 무관 일관 — batch-plan 의 NN 후보).
 */
export function parseBatchList(text, format = 'auto') {
  if (typeof text !== 'string') {
    throw new TypeError('batchList: 입력은 문자열이어야 합니다.');
  }
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`batchList: 지원하지 않는 형식 힌트입니다: "${format}"(auto|json|jsonl|csv).`);
  }

  // BOM 제거 + 개행 정규화(CRLF/CR → LF) — 모든 형식에 공통 적용.
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) {
    throw new Error('batchList: 입력이 비어 있습니다(등록할 행이 없습니다).');
  }
  if (looksLikeMarkdown(normalized)) {
    throw new Error('batchList: 마크다운은 지원하지 않습니다 — JSON/JSONL/CSV 를 사용하세요.');
  }

  const resolved = format === 'auto' ? detectFormat(normalized) : format;
  let raw;
  if (resolved === 'json') raw = parseJsonRows(normalized);
  else if (resolved === 'jsonl') raw = parseJsonlRows(normalized);
  else raw = parseCsvRows(normalized);

  return finalizeRows(raw);
}

/** 마크다운 표/리스트 감지 — 표 구분선(|---|---|) 또는 과반의 리스트 불릿 줄. */
function looksLikeMarkdown(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const hasTableSeparator = lines.some((l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(l));
  if (hasTableSeparator) return true;
  const listLike = lines.filter((l) => /^([-*+]\s+|\d+\.\s+)/.test(l)).length;
  return listLike >= 2 && listLike >= Math.ceil(lines.length / 2);
}

/** 형식 자동 판별: '[' 로 시작 → JSON 배열, 첫 비어있지 않은 줄이 '{' JSON 객체 → JSONL, 그 외 CSV. */
function detectFormat(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return 'json';
  const firstLine = (trimmed.split('\n').find((l) => l.trim()) ?? '').trim();
  if (firstLine.startsWith('{')) {
    try { JSON.parse(firstLine); return 'jsonl'; } catch { /* JSON 객체가 아님 → CSV 로 폴백 */ }
  }
  return 'csv';
}

function parseJsonRows(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`batchList: JSON 파싱 실패 — ${e.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('batchList: JSON 형식은 최상위가 배열이어야 합니다(행 객체의 배열).');
  }
  return data.map((obj, i) => ({ row: i + 1, obj }));
}

function parseJsonlRows(text) {
  const lines = text.split('\n');
  const out = [];
  let rowNum = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // 빈 줄 무시
    rowNum++;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      throw new Error(`batchList: JSONL ${rowNum}행 파싱 실패(파일 ${i + 1}줄) — ${e.message}`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`batchList: JSONL ${rowNum}행은 객체여야 합니다(파일 ${i + 1}줄).`);
    }
    out.push({ row: rowNum, obj });
  }
  return out;
}

function parseCsvRows(text) {
  const table = parseCsvMinimal(text);
  if (table.length === 0) {
    throw new Error('batchList: CSV 에 헤더 행이 없습니다.');
  }
  const header = table[0].map((h) => String(h).trim().toLowerCase());
  const idx = {
    subject: header.findIndex((h) => h.includes('subject') || h.includes('교과') || h.includes('과목')),
    grade: header.findIndex((h) => h.includes('grade') || h.includes('학년')),
    topic: header.findIndex((h) => h.includes('topic') || h.includes('주제')),
    standardCode: header.findIndex((h) => h.includes('standard') || h.includes('성취기준') || h.includes('코드') || h.includes('code')),
    title: header.findIndex((h) => h.includes('title') || h.includes('제목') || h.includes('목차')),
  };
  for (const key of REQUIRED_FIELDS) {
    if (idx[key] === -1) {
      throw new Error(`batchList: CSV 헤더에 "${key}" 열이 없습니다(헤더: ${table[0].join(', ')}).`);
    }
  }
  const out = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    out.push({
      row: out.length + 1,
      obj: {
        subject: r[idx.subject],
        grade: r[idx.grade],
        topic: r[idx.topic],
        standardCode: idx.standardCode >= 0 ? r[idx.standardCode] : undefined,
        title: idx.title >= 0 ? r[idx.title] : undefined,
      },
    });
  }
  return out;
}

/**
 * 최소 RFC4180 CSV 파서 — GepaiCurriculum.parseCsv(src/adapters/GepaiCurriculum.js) 와
 * 동일한 이스케이프 규칙(따옴표·이중따옴표·개행)의 독립 재구현(usecases → adapters
 * 역의존 방지). 완전히 빈 행(모든 셀이 빈 문자열)은 제외한다.
 */
function parseCsvMinimal(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

function trimOrEmpty(v) {
  return v == null ? '' : String(v).trim();
}

/** 필수 필드 검증(행 번호 지목 fail-closed) + topic·standardCode 중복 검사. */
function finalizeRows(raw) {
  const out = [];
  for (const { row, obj } of raw) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`batchList: ${row}행이 올바른 행 객체가 아닙니다.`);
    }
    const subject = trimOrEmpty(obj.subject);
    const grade = trimOrEmpty(obj.grade);
    const topic = trimOrEmpty(obj.topic);
    const missing = [];
    if (!subject) missing.push('subject');
    if (!grade) missing.push('grade');
    if (!topic) missing.push('topic');
    if (missing.length > 0) {
      throw new Error(`batchList: ${row}행에 필수 필드가 없습니다(${missing.join(', ')}).`);
    }
    out.push({
      row,
      subject,
      grade,
      topic,
      standardCode: trimOrEmpty(obj.standardCode) || null,
      title: trimOrEmpty(obj.title) || null,
    });
  }

  const seen = new Map(); // JSON.stringify([topic, standardCode]) → 최초 등장 행 번호
  for (const r of out) {
    const key = JSON.stringify([r.topic, r.standardCode]);
    if (seen.has(key)) {
      throw new Error(
        `batchList: 중복 행 — ${seen.get(key)}행과 ${r.row}행이 동일한 topic("${r.topic}")` +
        `${r.standardCode ? ` + standardCode("${r.standardCode}")` : ''} 조합입니다.`,
      );
    }
    seen.set(key, r.row);
  }
  return out;
}
