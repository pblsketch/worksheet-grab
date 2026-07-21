import {
  BUILTIN_TYPES, deriveBuiltins, mergeLibrary, normalizePresetName, slugify,
} from './presets.js';

// PresetLibrary — 프리셋 자산의 오케스트레이션. 프리셋은 문서가 아니라 자산이므로
// SaveDocument(리비전·히스토리·누출 게이트)를 경유하지 않는다(§3.2 "아무거나 저장").
// 정답 포함 프리셋도 저장 허용 — 문서 불변식은 삽입되어 문서로 저장될 때
// SaveDocument 게이트가 처리하고, 라이브러리 미리보기는 클라이언트가 물리 제거본으로
// 기본 렌더한다(§3.1 사각지대 봉합).
export class PresetLibrary {
  /** @param {{presetRepository, blockRepository}} deps */
  constructor({ presetRepository, blockRepository }) {
    if (!presetRepository) throw new TypeError('PresetLibrary 는 presetRepository 가 필요합니다.');
    if (!blockRepository) throw new TypeError('PresetLibrary 는 BlockRepository 가 필요합니다.');
    this.presetRepo = presetRepository;
    this.blockRepo = blockRepository;
  }

  /** @returns {Promise<{presets:object[], skipped:string[], hidden:string[], warning:string|null}>} */
  async list() {
    const { index, warning } = await this.presetRepo.readIndex();
    const vocabulary = await this.blockRepo.readVocabulary();
    const exemplarHtmlByType = {};
    for (const { type } of BUILTIN_TYPES) {
      const spec = vocabulary?.types?.[type];
      if (!spec?.file) continue;
      try {
        exemplarHtmlByType[type] = await this.blockRepo.loadBlockHtml(spec.file);
      } catch { /* exemplar 파일 부재 → deriveBuiltins 가 해당 빌트인만 스킵 */ }
    }
    const { builtins, skipped } = deriveBuiltins(vocabulary, exemplarHtmlByType);
    return {
      presets: mergeLibrary({ builtins, userPresets: index.userPresets, hiddenBuiltins: index.hiddenBuiltins }),
      skipped,
      hidden: [...index.hiddenBuiltins], // 복원 UI 용(비파괴 삭제의 반대급부)
      warning,
    };
  }

  /** @param {{name:string, type?:string, html:string, desc?:string, now?:Date}} args */
  async save({ name, type = 'content', html, desc = '', now = new Date() }) {
    const displayName = normalizePresetName(name);
    if (typeof html !== 'string' || !html.trim()) throw new Error('프리셋 html 이 비어 있습니다.');
    const { index } = await this.presetRepo.readIndex();
    const id = slugify(displayName, [
      ...index.userPresets.map((p) => p.id),
      ...BUILTIN_TYPES.map((b) => `builtin-${b.type}`),
    ]);
    const preset = {
      id,
      name: displayName,
      type: String(type || 'content'),
      html,
      desc: String(desc || ''),
      source: 'user',
      createdAt: now.toISOString(),
    };
    index.userPresets.unshift(preset); // 최근 저장 상단
    await this.presetRepo.writeIndex(index);
    return preset;
  }

  /** 사용자 프리셋 = 제거, 빌트인 = 숨김 툼스톤(비파괴). */
  async delete(id) {
    const { index } = await this.presetRepo.readIndex();
    const i = index.userPresets.findIndex((p) => p.id === id);
    if (i >= 0) {
      index.userPresets.splice(i, 1);
      await this.presetRepo.writeIndex(index);
      return { action: 'removed', id };
    }
    if (BUILTIN_TYPES.some((b) => `builtin-${b.type}` === id)) {
      if (!index.hiddenBuiltins.includes(id)) {
        index.hiddenBuiltins.push(id);
        await this.presetRepo.writeIndex(index);
      }
      return { action: 'hidden', id };
    }
    throw new Error(`프리셋을 찾을 수 없습니다: ${id}`);
  }

  /** 숨긴 빌트인 복원(교사 실수 복구 — §3.2 삭제 자유의 비파괴 반대급부). */
  async restore(id) {
    const { index } = await this.presetRepo.readIndex();
    const i = index.hiddenBuiltins.indexOf(id);
    if (i < 0) throw new Error(`숨겨진 빌트인이 아닙니다: ${id}`);
    index.hiddenBuiltins.splice(i, 1);
    await this.presetRepo.writeIndex(index);
    return { action: 'restored', id };
  }
}
