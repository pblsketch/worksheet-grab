import { normalizePageIdentity } from '../domain/schema/PageIdentity.js';
import { ORGANIZER_KINDS } from '../domain/schema/ObjectCatalog.js';
import { normalizeObjectives } from './AssembleWorksheet.js';

// MigrateManifestToObjectTree — S1.3(M1) 마이그레이션 + 무손실·개체화율 게이트 산출물.
// 결정 A1(06_plan_final.md 40~46행): 온-오픈 지연 마이그레이션 + richtext 폴백.
//
// 주의(Architect SOUND, 06_plan_final.md 45행 / docs/HANDOFF-object-schema.md §10):
// entry.file 은 BlockRepository 에서 HTML 을 로드해 분류해야 하므로 이 함수는 **순수 함수가 아니다**
// — deps.blockRepository 비동기 의존을 명시한다(async). ko.json/sci.json/워크스페이스 4문서는 전량
// entry.html 인라인이라 이번 감사 범위에서는 blockRepository 가 호출되지 않지만, 계약 자체는
// entry.file 이 있는 미래 매니페스트를 위해 유지한다(호출 시 미주입이면 명시적으로 던진다).
//
// 입력 manifest 는 절대 변형하지 않는다 — structuredClone 으로 깊은 복사 후 작업(읽기 전용 계약).
//
// 승격 전략: 블록 HTML 을 entry.type(구조 라벨) + 클래스/구조 인식(정규식 기반, DOM 없음 — Node 무빌드
// 원칙)으로 닫힌 카탈로그 10종에 매핑한다. 인식 실패분 또는 텍스트 일부라도 새 개체에 담기지 못하는
// 경우(#applyLosslessSafetyNet)는 richtext 로 원본 HTML 을 그대로 흡수해 무손실을 보증한다.
//
// question + 인접 정답 content 병합(스파이크 REPORT.md §4-1): `question` 바로 다음 엔트리가
// `content`(class="answer")면 별도 richtext 개체로 분리하지 않고 question.answerKey 로 합친다.

// ── 텍스트 유틸(태그 제거·공백 정규화) — 무손실 검증(#applyLosslessSafetyNet)과 answerKey 추출에 공용 사용 ──

/** @param {string} html @returns {string} 태그 제거 + 흔한 엔티티 언이스케이프 + 공백 정규화된 평문. */
export function stripTags(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** class 속성 어디에든(다중 클래스 포함) "answer" 토큰이 있는지(정답 표시 — 기존 BuildVariants `.answer` 관례). */
function hasAnswerClass(html) {
  if (!html) return false;
  const re = /class\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].split(/\s+/).includes('answer')) return true;
  }
  return false;
}

function extractSpanText(html, className) {
  const re = new RegExp(`<span class="${className}"[^>]*>([\\s\\S]*?)<\\/span>`);
  const m = re.exec(html);
  return m ? stripTags(m[1]) : null;
}

function extractTagText(html, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
  const m = re.exec(html);
  return m ? stripTags(m[1]) : null;
}

// ── 타입별 구조 인식 빌더 ──

function buildTitle(id, html, level) {
  const text = stripTags(html);
  const obj = { id, type: 'title', placement: 'flow', text };
  if (level === 2) obj.level = 2;
  const pill = extractSpanText(html, 'pill');
  const page = extractSpanText(html, 'corner-ref');
  const meta = {};
  if (pill) meta.pill = pill;
  if (page) meta.page = page;
  if (Object.keys(meta).length > 0) obj.meta = meta;
  return obj;
}

/**
 * 2층 정책(2026-07-23) 이후 RenderObjectTree 는 bodyHtml 을 그대로(무손실 HTML) 렌더한다 — 옛
 * 관례(bodyHtml=원본 블록 html 통째)를 그대로 쓰면 title/slotLabel 로 이미 뽑아낸 제목·슬롯 안내
 * 문구가 본문 안에도 중복으로 남아 이중 렌더(제목 중복 표시)된다. 원본에서 제목(h3)·슬롯 안내
 * (.slot)를 잘라낸 나머지만 bodyHtml 에 남긴다(실제 지문 본문 후보).
 * 필드는 원문 등장 순서(제목→슬롯 안내→본문)대로 넣는다 — applyLosslessSafetyNet 이
 * collectText(필드 삽입 순서로 문자열을 이어붙임)로 원문 전체가 부분열로 남아있는지 판정하므로,
 * 순서가 어긋나면 무손실 검증에 걸려 richtext 로 강등된다(A1 무손실 계약).
 */
function buildPassageSlot(id, html) {
  const titleText = extractTagText(html, 'h3');
  const slotMatch = /<div class="slot"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  const slotLabel = slotMatch ? stripTags(slotMatch[1]) : (stripTags(html) || '［지문 삽입 슬롯］');
  const obj = { id, type: 'passage-slot', placement: 'flow' };
  if (titleText) obj.title = titleText;
  obj.slotLabel = slotLabel;
  let remainder = html;
  if (slotMatch) remainder = remainder.replace(slotMatch[0], '');
  const h3Match = /<h3[^>]*>[\s\S]*?<\/h3>/.exec(html);
  if (h3Match) remainder = remainder.replace(h3Match[0], '');
  if (stripTags(remainder)) obj.bodyHtml = remainder;
  return obj;
}

function buildQuestion(id, html) {
  // lines:0 = essay 내장 답란을 끈다. 원본 활동지에서 답란은 문항과 별도 블록으로 저작돼 마이그레이션이
  // 별도 answer-area 개체로 분리하므로, essay 가 답란을 또 그리면 답 공간이 이중이 되어 인쇄 페이지가
  // 넘친다(하드 동치 붕괴 — 서술형 렌더링 도입 회귀). 신규 저작 essay(lines 미지정)는 기본 4줄 유지.
  return { id, type: 'question', placement: 'flow', qtype: 'essay', prompt: stripTags(html), lines: 0 };
}

/** 원본 HTML 안의 첫 <table>...</table> 을 rows(2차원 셀 배열)로 구조 파싱(DOM 없이 정규식).
 *  조직자 삽입(objectFactory)·삽입-parity 테스트가 블록 <table> 을 table 개체 rows 로 파생할 때
 *  재사용한다(단일 파서 — 마이그레이션·삽입이 같은 규칙을 공유해 드리프트를 없앤다). */
export function parseTableRows(html) {
  const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableMatch) return null;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rm;
  while ((rm = rowRe.exec(tableMatch[1]))) {
    const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const tag = cm[1].toLowerCase();
      const cell = { text: stripTags(cm[3]) };
      if (tag === 'th') cell.header = true;
      const colspanMatch = /colspan\s*=\s*"(\d+)"/i.exec(cm[2] || '');
      if (colspanMatch) cell.colspan = Number(colspanMatch[1]);
      cells.push(cell);
    }
    rows.push(cells);
  }
  return rows.length > 0 ? rows : null;
}

function buildTable(id, html) {
  const rows = parseTableRows(html);
  if (!rows) return null; // 인식 실패 -> 호출부가 richtext 로 폴백
  const obj = { id, type: 'table', placement: 'flow', splittable: false };
  // <caption>(예: 프레이어 "개념:")을 table.caption 으로 승격 — 없으면 미방출(기존 표 마이그레이션 불변).
  // caption 은 원문에서 rows 앞에 오므로 rows 보다 먼저 넣는다(#applyLosslessSafetyNet 이 필드 삽입
  // 순서대로 원문 부분열을 판정 — 순서가 어긋나면 무손실 검증에 걸려 richtext 로 강등된다).
  const capMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(html);
  if (capMatch) {
    const caption = stripTags(capMatch[1]);
    if (caption) obj.caption = caption;
  }
  obj.rows = rows;
  return obj;
}

/** resource-box(`.qbox`) 구조 인식 — `.lab` 라벨 + 인접 값 div 를 1행 2열 table 로 승격(REPORT.md §4-4 후속). */
function buildResourceBoxTable(id, html) {
  const labelMatch = /<span class="lab"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  if (!labelMatch) return null;
  const label = stripTags(labelMatch[1]);
  const rest = html.slice(labelMatch.index + labelMatch[0].length);
  const valueMatch = /<div[^>]*>([\s\S]*?)<\/div>/.exec(rest);
  if (!valueMatch) return null;
  const value = stripTags(valueMatch[1]);
  return {
    id, type: 'table', placement: 'flow', splittable: false,
    rows: [[{ text: label, header: true }, { text: value }]],
  };
}

/** emphasis-box 구조 분기(HANDOFF §3-2/§7) — `.db` 가 비면 answer-area, 텍스트가 있으면 richtext. */
function buildEmphasisBox(id, html) {
  const dbMatch = /<div class="db"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  const dbText = dbMatch ? stripTags(dbMatch[1]) : '';
  if (dbText.length > 0) {
    return { id, type: 'richtext', placement: 'flow', html, sourceType: 'emphasis-box' };
  }
  return { id, type: 'answer-area', placement: 'flow', style: 'box' };
}

/** content/hypothesis-box — class="answer" 포함이면 answer:true 리치텍스트(교사 모범답안). */
function buildAnswerRichtext(id, html, srcType) {
  const obj = { id, type: 'richtext', placement: 'flow', html, sourceType: srcType };
  if (hasAnswerClass(html)) obj.answer = true;
  return obj;
}

/**
 * entry.type(+구조 인식)으로 개체를 승격한다. 인식 실패(해당 case 없음) 또는 빌더가 null 을 반환하면
 * 호출부(#migratePage)가 richtext 폴백으로 무손실을 보증한다.
 * 추가 인식기(subq->title, resource-box->table)는 스파이크 REPORT.md §4 의 "richtext 로 남은 패턴"
 * 권고를 반영해 개체화율 게이트(≥70%)를 통과시키기 위해 S1.3 에서 신설했다(구조적 정당성: subq 는
 * 번호 배지+안내문의 소제목 구조, resource-box 는 label+value 1행 구조 — 둘 다 기존 카탈로그 타입의
 * 구조와 합치한다).
 */
// 깔끔한 표형 시각 조직자(#2 P1b) — 열 때 편집 가능한 table 개체로 승격하는 대상(objectFactory
// ORGANIZER_INSERTS 의 10종과 일치; migrate-organizers 테스트가 일치를 강제한다). 색이 의미인
// 신호등·쓰기줄 특수 레이아웃·그림형(SVG)·섹션 스택은 여기 없다 — 그들은 default→richtext 로 원본을
// 그대로 보존한다(색·구조 손실 방지). 정답(.answer) 있는 것도 아래에서 richtext 로 남긴다.
export const TABLE_ORGANIZER_TYPES = new Set([
  'kwl', 'frayer', 'w5h1', 'bme', 'prediction', 'glowgrow', 'perspectives', 'character', 'quotejournal', 'bookreview',
]);

function buildObjectForEntry(id, srcType, html, entry = {}) {
  // 표형 시각 조직자: 정답(.answer) 없는 것만 편집 가능한 table 개체로 승격한다. 정답 있는 것은 null 을
  // 돌려 호출부가 richtext 로 남기고(BuildVariants 가 학생 빌드에서 셀 .answer 를 물리 제거), 표 인식
  // 실패나 텍스트 손실(캡션 등)은 buildTable(null)·#applyLosslessSafetyNet 이 richtext 로 되돌린다.
  if (TABLE_ORGANIZER_TYPES.has(srcType)) {
    return hasAnswerClass(html) ? null : buildTable(id, html);
  }
  // 그림형 시각 조직자(#2 P3): **파라메트릭 엔진 조직자**(entry.params 있음)를 편집 가능한 organizer
  // 개체로 승격한다 — 엔진(OrganizerGen)이 kind·params 로 같은 SVG 를 재생성하므로 개수·라벨을
  // 에디터에서 편집할 수 있고 무손실이다(파라메트릭 엔트리는 저작 텍스트를 담지 않는다). 파라메트릭이
  // 아닌(정적 블록 file·렌더된 html) 그림형은 null 을 돌려 richtext 로 원본을 그대로 보존한다 —
  // 라벨 텍스트 손실 방지(P1b 표형 승격의 보수성과 동형). entry.html 이 함께 있으면 아래
  // applyLosslessSafetyNet 이 텍스트 불일치를 잡아 richtext 로 되돌린다(저작 라벨 보존).
  if (ORGANIZER_KINDS.includes(srcType)) {
    const params = (entry && entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params)) ? entry.params : null;
    if (!params) return null;
    const obj = { id, type: 'organizer', placement: 'flow', kind: srcType, params: { ...params } };
    if (entry.labels && typeof entry.labels === 'object' && !Array.isArray(entry.labels)) obj.labels = { ...entry.labels };
    return obj;
  }
  switch (srcType) {
    case 'header':
      return buildTitle(id, html, 1);
    case 'section-heading':
    case 'subq':
      return buildTitle(id, html, 2);
    case 'passage':
      return buildPassageSlot(id, html);
    case 'question':
      return buildQuestion(id, html);
    case 'label-value':
    case 'comparison-table':
    case 'pro-con':
    case 'memo-table':
    case 'rubric':
    case 'variable-table':
    case 'data-table':
      return buildTable(id, html);
    case 'resource-box':
      return buildResourceBoxTable(id, html);
    case 'answer-line':
    case 'note':
      return { id, type: 'answer-area', placement: 'flow', style: 'line' };
    case 'reflection-principles':
      return { id, type: 'answer-area', placement: 'flow', style: 'dots' };
    case 'emphasis-box':
      return buildEmphasisBox(id, html);
    case 'content':
    case 'hypothesis-box':
      return buildAnswerRichtext(id, html, srcType);
    default:
      return null;
  }
}

// ── 무손실 안전망 — 구조 인식이 원본 텍스트 일부를 못 담으면 자동으로 richtext 폴백(A1 무손실 보증을
// 테스트 단정에만 맡기지 않고 프로덕션 코드 자체가 구조적으로 보증한다). ──

const TEXT_COLLECT_BLACKLIST = new Set(['id', 'type', 'placement', 'qtype', 'style', 'shapeKind', 'sourceType']);

function collectText(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push(stripTags(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectText(v, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (TEXT_COLLECT_BLACKLIST.has(k)) continue;
      collectText(v, out);
    }
  }
  return out;
}

function applyLosslessSafetyNet(produced, html, id, srcType) {
  if (produced.type === 'richtext') return produced; // 원본 html 원문 그대로 보존
  const sourceText = normalizeText(stripTags(html));
  if (!sourceText) return produced; // 잃을 텍스트 자체가 없음(예: answer-line)
  const producedText = normalizeText(collectText(produced).join(' '));
  if (producedText.includes(sourceText)) return produced;
  // 구조 인식이 텍스트 일부를 놓쳤다 -> richtext 로 무손실 폴백(A1 결정 — 인식 실패분 무손실 흡수).
  return { id, type: 'richtext', placement: 'flow', html, sourceType: srcType };
}

// ── entry.html/entry.gen/entry.file 3분기 HTML 해석(AssembleWorksheet#entryHtml 과 동형, std-box 는 예외) ──

async function resolveEntryHtml(entry, blockRepository) {
  if (typeof entry.html === 'string') return entry.html; // 인라인 블록
  if (entry.file) {
    if (!blockRepository) {
      throw new Error(`엔트리에 file(${entry.file})이 있으나 deps.blockRepository 가 주입되지 않았습니다(비순수 의존 — S1.3 계약).`);
    }
    return blockRepository.loadBlockHtml(entry.file);
  }
  return '';
}

// ── question + 인접 정답 content 병합(REPORT.md §4-1) ──

function mergeAnswerKeys(items) {
  const result = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const next = items[i + 1];
    if (cur.obj.type === 'question' && next && next.srcType === 'content' && hasAnswerClass(next.html)) {
      cur.obj.answerKey = { text: stripTags(next.html), html: next.html };
      result.push(cur.obj);
      i++; // next(정답 content)는 흡수되어 별도 개체로 추가되지 않음(무손실 — html 원문까지 보존)
      continue;
    }
    result.push(cur.obj);
  }
  return result;
}

async function migratePage(pageEntries, pageIdx, manifest, blockRepository) {
  const items = [];
  for (let i = 0; i < pageEntries.length; i++) {
    const entry = pageEntries[i];
    const id = `mig-${pageIdx}-${i}`;
    const isStdLabel = entry.gen === 'standard-label' || entry.type === 'standard-label';
    const srcType = isStdLabel ? 'standard-label' : (entry.type || 'unknown');
    // gen 전용 마커(html 없음)가 일반적이나, 이미 저장된 워크스페이스 문서는 표준 라벨이 렌더된 리터럴
    // html 을 그대로 담고 있는 경우가 있다(감사 대상 4문서 실측). std-box 는 원문을 저장하지 않으므로
    // (원칙 3 — codes 참조만) 그 경우 아래 #applyLosslessSafetyNet 이 손실을 감지해 richtext 로 되돌린다.
    const html = await resolveEntryHtml(entry, blockRepository);

    let obj;
    if (isStdLabel) {
      // std-box 는 원문을 저장하지 않고 codes 참조만 저장(원칙 3 — 창작 금지, 슬롯 불변).
      obj = { id, type: 'std-box', placement: 'flow', codes: (manifest.standards || []).slice() };
      // 학습목표(2026-07-28)는 성취기준 원문과 달리 **저작 문장**이라 개체가 직접 들고 간다 —
      // 여기서 옮기지 않으면 레거시 문서를 편집기에서 여는 순간 교사가 쓴 목표가 사라진다.
      // 표시 설정(제목·근거 성취기준 노출)도 같은 이유로 함께 승계한다.
      const objectives = normalizeObjectives(manifest.objectives);
      if (objectives.length > 0) {
        obj.objectives = objectives;
        const heading = typeof manifest.objectivesHeading === 'string' ? manifest.objectivesHeading.trim() : '';
        if (heading) obj.heading = heading;
        if (manifest.showStandards === true) obj.showStandards = true;
      }
      obj = applyLosslessSafetyNet(obj, html, id, srcType);
    } else {
      obj = buildObjectForEntry(id, srcType, html, entry) ?? { id, type: 'richtext', placement: 'flow', html, sourceType: srcType };
      obj = applyLosslessSafetyNet(obj, html, id, srcType);
    }
    items.push({ srcType, html, obj });
  }
  return { flow: mergeAnswerKeys(items), float: [] };
}

/**
 * migrateManifestToObjectTree — 구 manifest(블록 배열, 예: manifests/ko.json)를 editor-v4 개체 트리로
 * 승격한다(S1.3, 결정 A1). **비순수 함수** — entry.file 블록은 deps.blockRepository 를 통해 비동기로
 * 로드해 분류해야 한다(위 파일 상단 주의 참조). 입력 manifest 는 깊은 복사 후 작업하므로 절대 변형되지
 * 않는다.
 *
 * @param {object} manifest 파싱된 구 manifest
 * @param {{blockRepository?: import('./ports.js').BlockRepository}} [deps]
 * @returns {Promise<{pagination:'paginated', pages: Array<{flow:object[], float:object[]}>}>}
 *   구 manifest.pages[] 의 페이지 경계를 그대로 승계한다(R2-4 — pagination:'paginated'로 export 허용
 *   계약을 명시. 실제 Chrome 측정 패스에 의한 경계 재계산은 M2/S2.5 소관이며 이 마이그레이션은 구
 *   manifest 가 이미 확정해 둔 페이지 경계를 그대로 옮겨 담을 뿐이다).
 */
export async function migrateManifestToObjectTree(manifest, deps = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('migrateManifestToObjectTree 는 manifest(object) 가 필요합니다.');
  }
  const cloned = structuredClone(manifest); // 읽기 전용 계약 — 입력 절대 변형 금지(깊은 복사 후 작업)
  const blockRepository = deps.blockRepository ?? null;
  const sourcePages = Array.isArray(cloned.pages) ? cloned.pages : [];

  const pages = [];
  for (let pIdx = 0; pIdx < sourcePages.length; pIdx++) {
    pages.push(await migratePage(sourcePages[pIdx], pIdx, cloned, blockRepository));
  }
  return normalizePageIdentity(
    { pagination: 'paginated', pages },
    deps.pageIdGenerator ? { idGenerator: deps.pageIdGenerator } : undefined,
  );
}

/** 개체화율(비-richtext 비율) 계량 — 개체화율 게이트(S1.3, 목표 ≥70%·하드 플로어 50%)의 분모/분자 집계. */
export function computeObjectizationStats(document) {
  let total = 0;
  let nonRichtext = 0;
  for (const page of document.pages) {
    for (const obj of [...page.flow, ...page.float]) {
      total++;
      if (obj.type !== 'richtext') nonRichtext++;
    }
  }
  return { total, nonRichtext, richtext: total - nonRichtext, rate: total ? nonRichtext / total : 0 };
}
