import { join } from 'node:path';
import { normalizeDocName } from './workspace.js';
import { resolvePaper } from './paper.js';

// workbook — 자료집(합본) 장부의 순수 정책(합의 계획 §2(b)). workbook.json 스키마 검증·멤버
// 정렬·본문상대 시작쪽 계산·용지 동치(C3)·status 전이·docName upsert(멱등)만 담당한다.
// 파일 IO 는 FsWorkbookRepository(adapter), 합본 조립·내보내기는 WorkbookAssemble/Export.
// Chrome·FS 무지 → 목 없이 단위 테스트 가능. workbook 은 문서를 참조만 하고 복제하지 않는다.

export const WORKBOOK_SCHEMA_VERSION = 1;
export const WORKBOOK_STATUSES = ['pending', 'saved', 'failed'];
export const DEFAULT_WORKBOOK_PAPER = 'a4';

// status 전이(aiBridge.js:19 TRANSITIONS 스타일). saved 는 terminal(재-plan 시 보존·스킵),
// failed 는 재시도 가능(→pending/saved/failed). 배치(T7)가 재사용한다.
const STATUS_TRANSITIONS = {
  pending: new Set(['saved', 'failed']),
  failed: new Set(['pending', 'saved', 'failed']),
  saved: new Set(),
};

export function canTransitionStatus(from, to) {
  return STATUS_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * §5 확정 레이아웃과 평행한 자료집 경로 파생. worksheets/<doc>/ 평행 workbooks/<명>/.
 * 합본 산출(PDF 2벌)은 여기에 쓰고, 멤버 문서(worksheets/)는 읽기만 한다(교차 저장 금지).
 */
export function workbookLayout(baseDir, name) {
  const dir = join(baseDir, name);
  return {
    dir,
    workbookPath: join(dir, 'workbook.json'),
    studentPdfPath: join(dir, 'workbook-student.pdf'),
    teacherPdfPath: join(dir, 'workbook-teacher.pdf'),
  };
}

/**
 * 자료집 멤버 docName 규칙: `<workbookSlug>-<NN>-<topicSlug>`. 각 조각을 normalizeDocName
 * (workspace.js:11)으로 정규화한다(한글 보존·비허용문자 _·`-` 보존). 결정적이므로 배치
 * 재실행 시 upsert 키로 쓴다. 빈 topic 등은 normalizeDocName 이 fail-closed 로 던진다.
 * @param {string} workbookName @param {number} index 1-based @param {string} topic
 */
export function buildDocName(workbookName, index, topic) {
  const slug = normalizeDocName(workbookName);
  const nn = String(index).padStart(2, '0');
  const topicSlug = normalizeDocName(topic);
  return `${slug}-${nn}-${topicSlug}`;
}

/**
 * workbook.paper 필드 → resolvePaper 입력 정규화. 문자열(사이즈 토큰 'a4'/'a3'/'b4') 또는
 * 객체 스펙({size,orientation,margins,columns})을 허용한다. 미지정은 기본 'a4'.
 */
function paperSpec(paper) {
  const p = paper ?? DEFAULT_WORKBOOK_PAPER;
  if (typeof p === 'string') return { size: p };
  if (typeof p === 'object') return p;
  throw new TypeError(`workbook.paper 는 문자열 또는 객체여야 합니다: ${JSON.stringify(paper)}`);
}

/** workbook/멤버 용지를 4필드 정규형으로 해석(항상 non-null). */
export function resolveWorkbookPaper(paper) {
  return resolvePaper(paperSpec(paper));
}

/**
 * 용지 동치(C3): resolvePaper() 결과 4필드(size·orientation·margins·columns)를 **직접**
 * 동치 비교한다. matchPreset(분류기)은 쓰지 않는다 — 분류기는 서로 다른 두 custom 용지를
 * 모두 'custom' 으로 묶어 fail-open 하기 때문(paper.js:118-130). null(미지정)은 기본 A4 로
 * 정규화해 명시 A4 와 동치로 본다.
 * @returns {boolean}
 */
export function samePaper(paperA, paperB) {
  const a = resolveWorkbookPaper(paperA);
  const b = resolveWorkbookPaper(paperB);
  return a.size === b.size && a.orientation === b.orientation
    && a.margins === b.margins && a.columns === b.columns;
}

/**
 * 멤버 용지들이 자료집 단일 용지와 균일한지 fail-closed 검사(C3). 불일치 멤버를 지목한다.
 * @param {object} workbook 검증된 workbook (paper 필드 보유)
 * @param {Array<{docName:string, paper?:*}>} memberPapers 멤버별 용지 스펙(meta.paper 등)
 * @returns {{ok:boolean, mismatches:Array<{docName:string, paper:*}>}}
 */
export function checkUniformPaper(workbook, memberPapers) {
  const target = workbook.paper ?? DEFAULT_WORKBOOK_PAPER;
  const mismatches = [];
  for (const m of memberPapers ?? []) {
    if (!samePaper(target, m.paper)) mismatches.push({ docName: m.docName, paper: m.paper ?? null });
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * 멤버별 본문상대 시작쪽. 본문은 1..ΣSections 연속이고 멤버 i 의 시작쪽 =
 * 1 + Σ(앞 멤버 섹션 수). 섹션 수는 인자로 받는 순수 계산(표지·목차 길이와 독립).
 * @param {number[]} sectionCounts 정렬된 멤버 순서의 섹션 수 배열
 * @returns {number[]} starts[i] = 멤버 i 의 본문상대 시작쪽(1-based)
 */
export function memberStartPages(sectionCounts) {
  const starts = [];
  let acc = 1;
  for (const n of sectionCounts ?? []) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`섹션 수는 0 이상의 정수여야 합니다: ${n}`);
    starts.push(acc);
    acc += n;
  }
  return starts;
}

/** 멤버를 order 오름차순(동률이면 docName)으로 정렬한 새 배열. */
export function orderedMembers(workbook) {
  return [...(workbook.members ?? [])].sort((a, b) => (a.order - b.order) || a.docName.localeCompare(b.docName));
}

/** 멤버 1건 정규화(스키마 검증). status 기본 'pending'. */
function normalizeMember(raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`멤버[${index}] 가 객체가 아닙니다.`);
  const docName = normalizeDocName(raw.docName);
  const order = raw.order ?? index;
  if (!Number.isInteger(order)) throw new Error(`멤버 "${docName}" 의 order 는 정수여야 합니다: ${raw.order}`);
  const status = raw.status ?? 'pending';
  if (!WORKBOOK_STATUSES.includes(status)) {
    throw new Error(`멤버 "${docName}" 의 status 가 유효하지 않습니다: "${status}" (허용: ${WORKBOOK_STATUSES.join(', ')})`);
  }
  const member = { docName, order, status };
  if (raw.tocTitle != null) member.tocTitle = String(raw.tocTitle);
  if (raw.tocStandards != null) {
    if (!Array.isArray(raw.tocStandards)) throw new Error(`멤버 "${docName}" 의 tocStandards 는 배열이어야 합니다.`);
    member.tocStandards = raw.tocStandards.map(String);
  }
  return member;
}

/**
 * workbook.json 스키마 검증 + 정규화. { title, paper(기본 'a4'), coverMeta?,
 * members:[{docName, order, tocTitle?, tocStandards?, status}] }. docName 중복은 거부한다.
 * @returns 정규화된 workbook(입력을 변형하지 않는 새 객체)
 */
export function validateWorkbook(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('workbook 은 객체여야 합니다.');
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('workbook.title 은 비어있지 않은 문자열이어야 합니다.');

  const paper = raw.paper ?? DEFAULT_WORKBOOK_PAPER;
  resolveWorkbookPaper(paper); // fail-closed: 잘못된 용지는 즉시 던진다.

  const rawMembers = raw.members ?? [];
  if (!Array.isArray(rawMembers)) throw new Error('workbook.members 는 배열이어야 합니다.');
  const members = rawMembers.map((m, i) => normalizeMember(m, i));

  const seen = new Set();
  for (const m of members) {
    if (seen.has(m.docName)) throw new Error(`멤버 docName 중복: "${m.docName}"`);
    seen.add(m.docName);
  }

  const out = {
    schemaVersion: raw.schemaVersion ?? WORKBOOK_SCHEMA_VERSION,
    title: raw.title,
    paper,
    members,
  };
  if (raw.coverMeta != null) out.coverMeta = raw.coverMeta;
  return out;
}

/**
 * docName 기준 멱등 upsert(합의 계획 §2(c) — 배치 재개용). 기존 멤버가 있으면 status·필드를
 * **보존**하고 스킵(변경 없음), 없으면 새 멤버로 추가한다. 두 입력 행이 같은 docName 을
 * 만들면(행-충돌) 이는 caller 가 assertNoRowCollisions 로 잡는다.
 * @param {Array} members 기존 멤버 배열
 * @param {object} incoming 추가할 멤버(정규화 전)
 * @returns {{members:Array, added:boolean}}
 */
export function upsertMember(members, incoming) {
  const normalized = normalizeMember(incoming, members.length);
  const idx = members.findIndex((m) => m.docName === normalized.docName);
  if (idx !== -1) return { members, added: false }; // 기존 보존·스킵(멱등)
  return { members: [...members, normalized], added: true };
}

/**
 * 배치 행 목록에서 docName 충돌(서로 다른 행이 같은 docName 산출)을 fail-closed 로 검출한다.
 * @param {Array<{docName:string}>} rows
 */
export function assertNoRowCollisions(rows) {
  const seen = new Map();
  for (const r of rows ?? []) {
    const key = normalizeDocName(r.docName);
    if (seen.has(key)) {
      throw new Error(`행-충돌: docName "${key}" 가 여러 행에서 중복됩니다(행 ${seen.get(key)} vs ${r.__row ?? '?'}).`);
    }
    seen.set(key, r.__row ?? key);
  }
}
