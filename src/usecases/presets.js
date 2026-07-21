// presets — 사용자 프리셋(재사용 블록, §3.2)의 순수 정책.
// 프리셋은 "개발자 정의 타입"이 아니라 교사가 아무 블록이나 저장해 재사용하는
// 상용구다. 기본 제공(발문·답란·표·루브릭)은 blocks/vocabulary.json + core exemplar
// 에서 런타임 파생한 읽기전용 빌트인이고, 사용자 변경(숨김·복원·동명 shadow)은
// 오버레이로 얹는다 — 자산 증식·시딩 부작용 0(§8: 동적 조립과 같은 substrate).

export const PRESET_SCHEMA_VERSION = 1;

/** §3.2 기본 제공 프리셋 매핑: 발문·답란·표·루브릭(전부 core·범교과). */
export const BUILTIN_TYPES = [
  { type: 'subq', name: '발문 — 소질문 머리' },
  { type: 'question', name: '발문 — 세부 문항' },
  { type: 'answer-line', name: '답란 — 서술 줄' },
  { type: 'memo-table', name: '표 — 메모/기록' },
  { type: 'comparison-table', name: '표 — 비교/분류' },
  { type: 'rubric', name: '루브릭 — 자기점검' },
];

export function normalizePresetName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new Error('프리셋 이름이 비어 있습니다.');
  return name;
}

/** 표시명 → 고유 id. 기존 id 와 충돌하면 -2, -3 … 접미. */
export function slugify(name, existingIds = []) {
  const base = String(name).trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'preset';
  const taken = new Set(existingIds);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * 빌트인 파생(순수 변환 — 파일 읽기는 호출자가 주입).
 * exemplar html 이 없거나 gen 타입이면 해당 빌트인만 스킵한다(전체 실패 금지).
 * @returns {{builtins:object[], skipped:string[]}}
 */
export function deriveBuiltins(vocabulary, exemplarHtmlByType) {
  const builtins = [];
  const skipped = [];
  for (const { type, name } of BUILTIN_TYPES) {
    const spec = vocabulary?.types?.[type];
    const html = exemplarHtmlByType?.[type];
    if (!spec || spec.gen || !spec.file || typeof html !== 'string' || !html.trim()) {
      skipped.push(type);
      continue;
    }
    builtins.push({
      id: `builtin-${type}`,
      name,
      type,
      html,
      desc: spec.desc || '',
      source: 'builtin',
      createdAt: null,
    });
  }
  return { builtins, skipped };
}

/** 표시 목록: 사용자(최근 상단) + (빌트인 − 숨김 − 동일 id 사용자 shadow). */
export function mergeLibrary({ builtins = [], userPresets = [], hiddenBuiltins = [] }) {
  const hidden = new Set(hiddenBuiltins);
  const userIds = new Set(userPresets.map((p) => p.id));
  return [...userPresets, ...builtins.filter((b) => !hidden.has(b.id) && !userIds.has(b.id))];
}

export function emptyIndex() {
  return { version: PRESET_SCHEMA_VERSION, userPresets: [], hiddenBuiltins: [] };
}

/** 인덱스 정합: 버전·필드 형태·id 유일성. 실패 시 저장소가 백업 폴백한다. */
export function validateIndex(index) {
  if (!index || typeof index !== 'object') return false;
  if (index.version !== PRESET_SCHEMA_VERSION) return false;
  if (!Array.isArray(index.userPresets) || !Array.isArray(index.hiddenBuiltins)) return false;
  const ids = index.userPresets.map((p) => p?.id);
  if (ids.some((id) => typeof id !== 'string' || !id)) return false;
  if (new Set(ids).size !== ids.length) return false;
  if (index.userPresets.some((p) => typeof p.html !== 'string' || typeof p.name !== 'string')) return false;
  if (index.hiddenBuiltins.some((id) => typeof id !== 'string')) return false;
  return true;
}
