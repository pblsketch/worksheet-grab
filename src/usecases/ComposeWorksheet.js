import { resolveSubject, parseGrade } from './GenerateWorksheet.js';
import { ArchetypeLibrary } from './ArchetypeLibrary.js';

// ComposeWorksheet — 동적 조립 배선(Phase 4). 교사의 한 문장 요청을 "저작 대기 스캐폴드"로 만든다.
//   요청(학년교과+주제) + 성취기준(조회) + 아키타입(선택/추천) + 어휘 → 스캐폴드 매니페스트 + 저작 브리프.
// 무API 원칙: 엔진은 결정적이다 — 구조(아키타입)·제목·성취기준만 채우고, 교육적 콘텐츠는 저작하지 않는다.
//   콘텐츠 저작은 designer AI(사용자 구독)/교사의 몫. compose 는 "무엇을 어디에 쓸지"를 브리프로 안내한다.
// 산출 스캐폴드는 인라인 html 매니페스트라 곧바로 렌더 가능(자리표시)하고, 저작은 인라인 html 을 대체하면 된다.
export class ComposeWorksheet {
  /** @param {{blockRepository, curriculum}} deps */
  constructor({ blockRepository, curriculum }) {
    if (!blockRepository) throw new TypeError('ComposeWorksheet 는 BlockRepository 가 필요합니다.');
    if (!curriculum || typeof curriculum.resolve !== 'function') {
      throw new TypeError('ComposeWorksheet 는 CurriculumProvider 가 필요합니다.');
    }
    this.repo = blockRepository;
    this.curriculum = curriculum;
  }

  /**
   * @param {{grade:string, subject:string, topic:string, archetype?:string|null, codes?:string[]|null,
   *   limit?:number, objectives?:string[], objectivesHeading?:string|null, showStandards?:boolean}} args
   *   objectives: 학습목표(저작 문장, "~할 수 있다") — 성취기준 원문과 달리 **저작 영역**이라 엔진이
   *   조회하지 않고 호출부(교사·designer)가 준다. 주면 스캐폴드가 그 문장을 학습목표로 싣는다.
   * @returns {Promise<{manifest, brief, archetype, archetypeReason, standards, subjectLabel}>}
   */
  async execute({
    grade, subject, topic, archetype = null, codes = null, limit = 6,
    objectives = [], objectivesHeading = null, showStandards = false,
    organizers = [],
  }) {
    if (!topic) throw new Error('compose: 주제(topic)가 필요합니다.');
    const spec = resolveSubject(subject);
    const { school } = parseGrade(grade);

    const [archetypes, vocabulary] = await Promise.all([this.repo.readArchetypes(), this.repo.readVocabulary()]);
    if (!archetypes || !vocabulary) throw new Error('compose: blocks/archetypes.json 과 vocabulary.json 이 필요합니다.');
    const lib = new ArchetypeLibrary({ archetypes, vocabulary });

    // 아키타입 매핑용 교과 키(theme 이 아니라 archetypes 의 subject 키: science/korean/social/english).
    const subjectKey = archetypeSubjectKey(spec.template);

    // 1) 성취기준 조회(원문은 조회만, 창작 금지).
    const standards = await this.#resolveStandards({ school, spec, topic, codes, limit, subject });

    // 2) 아키타입 선택(명시 > 추천). 선택 아키타입은 교과에 적용 가능해야 한다.
    let archetypeId = archetype;
    let archetypeReason;
    if (archetypeId) {
      if (!lib.subjectsFor(archetypeId).includes(subjectKey)) {
        throw new Error(`아키타입 '${archetypeId}' 는 ${subjectKey} 에 적용되지 않습니다. 적용 가능: ${applicableArchetypes(lib, subjectKey)}`);
      }
      archetypeReason = '교사 지정';
    } else {
      const s = lib.suggestArchetype(subjectKey, topic);
      archetypeId = s.id;
      archetypeReason = s.reason;
    }

    // 3) 구조 스켈레톤 → 인라인 스캐폴드로 변환(exemplar 내용을 인라인 html 로, 헤더는 주제로 채움).
    const skeleton = lib.toSkeletonManifest(archetypeId, subjectKey, {
      docTitle: topic,
      standards: standards.map((s) => s.code),
      standardsText: Object.fromEntries(standards.map((s) => [s.code, s.text])),
      dataSubject: spec.dataSubject ?? spec.template,
      objectives, objectivesHeading, showStandards,
    });
    const manifest = await this.#inlineScaffold(skeleton, {
      pill: lib.get(archetypeId).pill || '활동',
      topic, subjectLabel: spec.label, school, grade,
    });

    // 3.5) 교사가 명시 요청한 파라메트릭 조직자를 페이지로 추가(자연어 → parseOrganizerSpec 파싱 결과 전달).
    //   엔진이 개수대로 결정적으로 그린다(params → 생성기, 없으면 정적 블록). 무API 유지.
    if (Array.isArray(organizers) && organizers.length > 0) {
      for (const o of organizers) {
        const def = vocabulary.types[o.type];
        if (!def) throw new Error(`알 수 없는 조직자 타입: ${o.type}`);
        manifest.pages.push([{ type: o.type, params: o.params || {}, ...(def.file ? { file: def.file } : {}) }]);
      }
    }

    // 4) 저작 브리프(designer AI/교사용).
    const brief = lib.buildBrief(archetypeId, subjectKey);
    brief.topic = topic;
    brief.standards = standards.map((s) => ({ code: s.code, text: s.text }));

    return { manifest, brief, archetype: archetypeId, archetypeReason, standards, subjectLabel: spec.label };
  }

  async #resolveStandards({ school, spec, topic, codes, limit, subject }) {
    let found;
    if (Array.isArray(codes) && codes.length > 0) {
      found = [];
      for (const code of codes) {
        const hit = await this.curriculum.resolve(code);
        if (!hit) throw new Error(`성취기준 코드를 찾지 못했습니다: ${code}. 원문 창작 금지.`);
        found.push(hit);
      }
    } else {
      found = await this.curriculum.search({ school, subject: spec.label, keyword: topic, limit });
    }
    if (!found || found.length === 0) {
      throw new Error(`성취기준을 찾지 못했습니다(${school ?? '전체'} · ${spec.label} · "${topic}"). 원문 창작 금지. --standards <코드,..> 로 직접 지정할 수 있습니다.`);
    }
    // 학교급 혼합 방지(단일 학교급 대상).
    const schools = [...new Set(found.map((s) => s.school).filter(Boolean))];
    if (schools.length > 1) {
      throw new Error(`학교급이 섞인 성취기준이 조회되었습니다(${schools.join(', ')}). 학년을 붙여 학교급을 지정하세요. 예: "중2${subject} ${topic}"`);
    }
    return found;
  }

  // 스켈레톤(exemplar file 참조) → 인라인 html 스캐폴드. 헤더는 주제로 결정적 치환.
  async #inlineScaffold(skeleton, ctx) {
    const pages = [];
    for (const page of skeleton.pages) {
      const out = [];
      for (const entry of page) {
        if (entry.gen === 'standard-label' || entry.type === 'standard-label') { out.push(entry); continue; }
        if (entry.type === 'header') { out.push({ type: 'header', html: headerHtml(ctx) }); continue; }
        const html = typeof entry.html === 'string' ? entry.html : await this.repo.loadBlockHtml(entry.file);
        out.push({ type: entry.type, html, ...(entry.fit ? { fit: entry.fit } : {}) });
      }
      pages.push(out);
    }
    return {
      ...skeleton,
      docTitle: ctx.topic,
      runHead: `2022 개정 교육과정 · ${ctx.subjectLabel} · 활동지`,
      runFoot: { left: `2022 개정 교육과정 연계 ${ctx.subjectLabel} 활동지`, rightPrefix: ctx.topic },
      pages,
    };
  }
}

// 교과 라벨(template 키) → archetypes.json 의 subject 키.
function archetypeSubjectKey(template) {
  return { science: 'science', korean: 'korean', social: 'social', english: 'english' }[template] || template;
}

function applicableArchetypes(lib, subjectKey) {
  return lib.list().filter((a) => lib.subjectsFor(a.id).includes(subjectKey)).map((a) => a.id).join(', ');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 헤더는 결정적으로 채운다(주제·교과·단원은 입력에서 기계적으로 도출 — 창작 아님).
function headerHtml({ pill, topic, subjectLabel, school }) {
  const ref = [school, subjectLabel].filter(Boolean).join(' ');
  return `<div class="title-wrap">
    <span class="pill">${esc(pill)}</span>
    <span class="corner-ref">${esc(ref)} · ${esc(topic)}</span>
    <div class="title-box"><h1>${esc(topic)}</h1></div>
    <div class="unit-line">
      <div class="unit"><b>단원</b>　${esc(topic)}</div>
      <div class="namefield">학년<span></span> 반<span></span> 이름<span></span></div>
    </div>
  </div>`;
}
