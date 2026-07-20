import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { CurriculumProvider } from '../usecases/ports.js';

// GepaiCurriculum — 성취기준 코드 → 원문. CurriculumProvider 포트 구현.
// R4 해소: gepai MCP 는 세션 중 끊길 수 있으므로 CSV 를 1차/동등 경로로 둔다.
//   - mcpClient 주입 시: MCP 먼저 시도 → 실패하면 CSV 폴백.
//   - 미주입(CLI 기본): CSV 만 사용.
// 성취기준 원문은 조회만 한다(창작 금지).

// HANDOFF 2장: gepai MCP 대체 폴백 CSV
export const DEFAULT_CSV_PATH = 'E:/github/gepai-mcp/data/source/achievement-standards.csv';

export class GepaiCurriculum extends CurriculumProvider {
  /** @param {{csvPath?:string, mcpClient?:object|null}} opts */
  constructor({ csvPath = DEFAULT_CSV_PATH, mcpClient = null } = {}) {
    super();
    this.csvPath = csvPath;
    this.mcpClient = mcpClient;
    this._map = null; // lazy code → {text, subject, school, grade}
  }

  async #ensureCsv() {
    if (this._map) return this._map;
    this._map = new Map();
    if (!existsSync(this.csvPath)) return this._map;
    const text = await readFile(this.csvPath, 'utf8');
    const rows = parseCsv(text);
    if (rows.length === 0) return this._map;
    // 헤더: 학교,과목,학년(학년군),성취기준 코드,성취기준 내용
    const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
    const idxCode = header.findIndex((h) => h.includes('코드'));
    const idxText = header.findIndex((h) => h.includes('내용'));
    const idxSubject = header.findIndex((h) => h.includes('과목'));
    const idxSchool = header.findIndex((h) => h.includes('학교'));
    const idxGrade = header.findIndex((h) => h.includes('학년'));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[idxCode]) continue;
      const code = normalizeCode(r[idxCode]);
      this._map.set(code, {
        text: (r[idxText] || '').trim(),
        subject: idxSubject >= 0 ? (r[idxSubject] || '').trim() : null,
        school: idxSchool >= 0 ? (r[idxSchool] || '').trim() : null,
        grade: idxGrade >= 0 ? (r[idxGrade] || '').trim() : null,
      });
    }
    return this._map;
  }

  /** @param {string} code 예: "[9과14-02]" 또는 "9과14-02" */
  async resolve(code) {
    const key = normalizeCode(code);

    if (this.mcpClient && typeof this.mcpClient.resolve === 'function') {
      try {
        const r = await this.mcpClient.resolve(key);
        if (r && r.text) return { code: key, text: r.text, subject: r.subject ?? null };
      } catch { /* MCP 끊김 → CSV 폴백 */ }
    }

    const map = await this.#ensureCsv();
    const hit = map.get(key);
    if (!hit) return null;
    return { code: key, text: hit.text, subject: hit.subject };
  }

  /**
   * 조건 검색: 학교급·과목·학년군·키워드로 성취기준을 조회한다(원문은 조회만, 창작 금지).
   * @param {{school?:string, subject?:string, grade?:string, keyword?:string, limit?:number}} query
   * @returns {Promise<Array<{code,text,subject,school,grade}>>}
   */
  async search(query = {}) {
    const { school, subject, grade, keyword, limit = 20 } = query;

    if (this.mcpClient && typeof this.mcpClient.search === 'function') {
      try {
        const r = await this.mcpClient.search(query);
        if (Array.isArray(r) && r.length > 0) return r.slice(0, limit);
      } catch { /* MCP 끊김 → CSV 폴백 */ }
    }

    const map = await this.#ensureCsv();
    const results = [];
    for (const [code, v] of map) {
      if (school && !contains(v.school, school)) continue;
      if (subject && !contains(v.subject, subject)) continue;
      if (grade && !contains(v.grade, grade)) continue;
      if (keyword && !contains(v.text, keyword)) continue;
      results.push({ code, text: v.text, subject: v.subject, school: v.school, grade: v.grade });
      if (results.length >= limit) break;
    }
    return results;
  }
}

function contains(haystack, needle) {
  if (!haystack) return false;
  return String(haystack).replace(/\s+/g, '').includes(String(needle).replace(/\s+/g, ''));
}

/** 코드 정규화: 대괄호 부착 형태 [코드]. */
export function normalizeCode(code) {
  const c = String(code).trim().replace(/^\[|\]$/g, '');
  return `[${c}]`;
}

/** 최소 RFC4180 CSV 파서(따옴표·개행·이스케이프 처리). */
export function parseCsv(text) {
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
