import { SaveDocument } from './SaveDocument.js';
import { itemNumber } from './EditWorksheet.js';

// RegeneratePage — 저장된 문서의 특정 페이지(1-based)만 신규 블록 배열로 교체하는
// 유스케이스(합의 계획 §2(d)). pages[N-1] 만 스플라이스하고 타 페이지는 참조 그대로
// 보존한 뒤 SaveDocument.execute 에 저장을 위임한다 — 정답 누출 재검증·히스토리
// 스냅샷·meta 커밋은 SaveDocument 단일 게이트가 대칭 처리한다(§7 fail-closed).
//
// C7·C9 대칭 가드: vocabulary 를 반드시 로드해 aiBridge.excludedTypes(vocabulary) 로
// 제외-타입(성취기준 gen·저작권 슬롯) 집합을 구하고, 기존 페이지의 제외-타입 블록이
// 신규 페이지에 삭제·변조 없이 동일 보존되는지, 신규 제외-타입 블록이 위조되지
// 않았는지를 저장 전에 검사한다. vocabulary 부재(null)는 저작권 슬롯 미보호를
// 뜻하므로 fail-closed 로 거부한다(BuildVariants/AI 브리지와 달리 관용하지 않는다).
export class RegeneratePage {
  /** @param {{workspace, blockRepository, curriculum}} deps */
  constructor({ workspace, blockRepository, curriculum }) {
    if (!workspace) throw new TypeError('RegeneratePage 는 workspace 리포지토리가 필요합니다.');
    if (!blockRepository) throw new TypeError('RegeneratePage 는 BlockRepository 가 필요합니다.');
    this.workspace = workspace;
    this.repo = blockRepository;
    this.curriculum = curriculum ?? null;
  }

  /**
   * @param {{docName:string, page:number, newPageBlocks:object[], now?:Date}} args
   *   page 는 1-based 페이지 번호, newPageBlocks 는 manifest.pages[N-1] 을 대체할 블록 배열.
   * @returns {Promise<{name:string, paths:object, meta:object, unsafe:boolean,
   *   leakFindings:object[], continuityWarning:string|null}>}
   */
  async execute({ docName, page, newPageBlocks, now = new Date() }) {
    const layout = this.workspace.layout(docName);
    if (!this.workspace.docExists(layout.name)) {
      throw new Error(`문서가 없습니다: ${layout.name}. "doc list" 로 문서 목록을 확인하세요.`);
    }
    if (!Array.isArray(newPageBlocks)) {
      throw new Error('regenerate-page: newPageBlocks 는 블록 배열이어야 합니다.');
    }

    const manifest = await this.workspace.readManifest(layout.name);
    const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
    if (!Number.isInteger(page) || page < 1 || page > pages.length) {
      throw new Error(`regenerate-page: 페이지 번호(${page})가 범위를 벗어났습니다(1..${pages.length}).`);
    }
    const idx = page - 1;

    // C7: vocabulary 필수 로드 — 부재(null)면 copyrightSlot 이 미보호이므로 fail-closed.
    const vocabulary = await this.repo.readVocabulary();
    if (!vocabulary) {
      throw new Error(
        'regenerate-page: blocks/vocabulary.json 을 불러오지 못했습니다 — 성취기준·저작권 슬롯 보호를 ' +
        '보장할 수 없어 재생성을 거부합니다(fail-closed).',
      );
    }
    const excluded = legacyExcludedTypes(vocabulary);

    // C9: 제외-타입(standard-label·gen 타입) 블록은 선언 타입 기준으로 신규 페이지에 동일 보존되어야
    // 한다 — 삭제·변조·위조(신규 추가) 모두 거부(원칙 3). 저작권 지문 슬롯(copyrightSlot)은 3층 정책
    // (2026-07-23)으로 교사·AI 편집이 허용돼 보존 대상에서 제외한다.
    const oldExcluded = pages[idx].filter((b) => excluded.has(String(b?.type ?? 'content')));
    const newExcluded = newPageBlocks.filter((b) => excluded.has(String(b?.type ?? 'content')));
    assertExcludedPreserved(oldExcluded, newExcluded);

    // pages[idx] 만 신규 배열로 교체 — 타 페이지는 동일 참조라 바이트(직렬화) 불변.
    const nextManifest = { ...manifest, pages: pages.map((p, i) => (i === idx ? newPageBlocks : p)) };

    const saver = new SaveDocument({ workspace: this.workspace, blockRepository: this.repo, curriculum: this.curriculum });
    const result = await saver.execute({ name: layout.name, manifest: nextManifest, now });

    return { ...result, continuityWarning: checkNumberContinuity(nextManifest) };
  }
}

/** 재생성 보존 대상(제외-타입) 레거시 블록 집합 — 성취기준(standard-label)·gen 블록은 삭제·변조·위조를
 *  거부한다(원칙 3). 저작권 지문 슬롯(copyrightSlot, 예: passage)은 3층 저작권 정책(2026-07-23)으로
 *  교사·AI 편집이 허용돼 보존 대상에서 제외한다. aiBridge.excludedTypes 가 개체 트리(std-box) 전용으로
 *  바뀌어, 레거시 manifest 블록 타입 집합은 여기서 직접 계산한다. */
function legacyExcludedTypes(vocabulary) {
  const out = new Set(['standard-label']);
  for (const [type, spec] of Object.entries(vocabulary?.types ?? {})) {
    if (spec?.gen) out.add(type); // gen 타입만 보존, copyrightSlot(지문)은 3층으로 편집 가능 → 제외
  }
  return out;
}

/** 제외-타입 블록 다중집합 동치 검사(순서 무관, 내용 완전 일치). */
function assertExcludedPreserved(oldExcluded, newExcluded) {
  const oldKeys = oldExcluded.map((b) => JSON.stringify(b)).sort();
  const newKeys = newExcluded.map((b) => JSON.stringify(b)).sort();
  const same = oldKeys.length === newKeys.length && oldKeys.every((k, i) => k === newKeys[i]);
  if (same) return;
  throw new Error(
    `regenerate-page: 성취기준·저작권 슬롯(제외-타입) 블록이 보존되지 않았습니다(삭제·변조·위조 금지, §7·§10) — ` +
    `기존 ${oldKeys.length}개 → 신규 ${newKeys.length}개.`,
  );
}

/**
 * 문항 번호 연속성 간이 검사(HTML 문자열 — EditWorksheet.itemNumber 재사용).
 * 전체 문서(모든 페이지)를 순서대로 훑어 subq/section-heading 번호가 1..N 연속인지만
 * 본다. 불연속이어도 에러가 아니라 경고 문자열을 반환한다(저작자 판단 존중).
 * @returns {string|null}
 */
function checkNumberContinuity(manifest) {
  const nums = [];
  for (const page of manifest.pages) {
    for (const block of page) {
      const n = itemNumber(block);
      if (n != null) nums.push(n);
    }
  }
  if (nums.length === 0) return null;
  const continuous = nums.every((v, i) => v === i + 1);
  if (continuous) return null;
  return `문항 번호 연속성 경고 — 저장 후 번호가 1..${nums.length} 연속이 아닙니다(실제 순서: ${nums.join(', ')}). 필요하면 edit 명령으로 재부여하세요.`;
}
