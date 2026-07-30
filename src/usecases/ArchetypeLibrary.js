import { normalizeObjectives } from './AssembleWorksheet.js';

// ArchetypeLibrary — 아키타입(교과 초월 구조 패턴)을 교과에 바인딩해 구체 블록 시퀀스와
// 렌더 가능한 스켈레톤 매니페스트로 해석한다.
// 순수(포트 무관): 로드된 vocabulary + archetypes 레지스트리만 받는다.
// 콘텐츠는 저작하지 않는다 — 스켈레톤은 exemplar 자리표시이며, 실제 콘텐츠 저작은 Phase 4 compose 의 몫.

export class ArchetypeLibrary {
  /** @param {{archetypes:object, vocabulary:object}} deps */
  constructor({ archetypes, vocabulary }) {
    if (!archetypes || !archetypes.archetypes) throw new TypeError('ArchetypeLibrary: archetypes 레지스트리가 필요합니다.');
    if (!vocabulary || !vocabulary.types) throw new TypeError('ArchetypeLibrary: vocabulary 레지스트리가 필요합니다.');
    this.reg = archetypes;
    this.vocab = vocabulary;
    this.subjectTheme = archetypes.subjectTheme || {};
    this.packRoles = archetypes.packRoles || {};
  }

  /** 아키타입 요약 목록. */
  list() {
    return Object.entries(this.reg.archetypes).map(([id, a]) => ({
      id, name: a.name, desc: a.desc, subjects: a.subjects,
      pages: a.pages.length,
      blocks: a.pages.reduce((n, pg) => n + pg.length, 0),
    }));
  }

  get(id) {
    const a = this.reg.archetypes[id];
    if (!a) throw new Error(`알 수 없는 아키타입: ${id}. 사용 가능: ${Object.keys(this.reg.archetypes).join(', ')}`);
    return a;
  }

  /** subjects=['*'] 는 알려진 모든 교과로 확장. */
  subjectsFor(id) {
    const a = this.get(id);
    return a.subjects.includes('*') ? Object.keys(this.subjectTheme) : a.subjects;
  }

  themeFor(subject) {
    return this.subjectTheme[subject] || subject;
  }

  /**
   * 주제 키워드 → 아키타입 추천(결정적 휴리스틱). 교사/AI 가 --archetype 로 언제든 덮어쓴다.
   * 반환 아키타입은 항상 해당 교과에 적용 가능한 것으로 보장한다.
   * @returns {{id:string, reason:string}}
   */
  suggestArchetype(subject, topic = '') {
    const t = String(topic);
    const hit = (words) => words.some((w) => t.includes(w));
    // 키워드 → 아키타입 우선순위(위에서부터 검사).
    const rules = [
      // 조직자 전용 키워드 → 시각 조직자 구성 틀(교사가 명시 요청 시). 기존 주제 키워드와 겹치지 않는
      // 고유어만 써서 기존 추천을 바꾸지 않는다(조직자 아키타입은 범교과라 항상 적용 가능).
      ['concept-visual', ['시각화', '다이어그램', '개념도', '마인드맵', '생각그물', '벤다이어그램']],
      ['kwl-inquiry', ['KWL', 'K-W-L', '배경지식', '사전지식', '사전 지식']],
      ['writing-plan', ['글쓰기', '작문', '논술', '쓰기 계획']],
      ['literary-response', ['독서', '독후', '서평', '감상문', '책 소개']],
      ['process-structure', ['절차', '순서도', '흐름도', '위계', '체계도']],
      ['experimental-inquiry', ['실험', '탐구', '측정', '관찰', '변인', '반응', '검증']],
      ['discussion-decision',  ['토론', '찬반', '쟁점', '의사결정', '논쟁', '딜레마', '토의']],
      ['reading-comprehension',['읽기', '독해', '지문', '글', '문학', '시', '소설', '설명문', '어휘']],
      ['data-interpretation',  ['자료', '통계', '그래프', '분포', '인구', '자원', '기후', '데이터', '지도']],
      ['project-making',       ['프로젝트', '제작', '만들기', '설계', '발표', '포스터', '캠페인']],
      ['concept-structuring',  ['분류', '비교', '개념', '구조', '체계', '종류', '특징', '원리', '관계']],
    ];
    const applies = (id) => this.subjectsFor(id).includes(subject);
    for (const [id, words] of rules) {
      if (hit(words) && applies(id)) return { id, reason: `주제 키워드 매칭 → ${this.get(id).name}` };
    }
    // 키워드 미스: 교과 기본값(적용 가능 보장).
    const bySubject = {
      science: 'experimental-inquiry', social: 'data-interpretation',
      korean: 'reading-comprehension', english: 'reading-comprehension',
    };
    const fallback = bySubject[subject];
    if (fallback && applies(fallback)) return { id: fallback, reason: `${subject} 기본 아키타입 → ${this.get(fallback).name}` };
    // 최후: 이 교과에 적용 가능한 아무 아키타입(항상 project-making 은 전교과).
    const any = this.list().find((a) => applies(a.id));
    return { id: any.id, reason: `적용 가능한 기본값 → ${any.name}` };
  }

  /**
   * 아키타입×교과의 저작 브리프 — designer AI/교사가 각 블록에 무엇을 저작할지.
   * 콘텐츠는 저작하지 않는다(무API): 지침만 낸다.
   */
  buildBrief(id, subject) {
    const r = this.resolve(id, subject);
    const pages = r.pages.map((pg) => pg.map((b) => {
      const info = this.vocab.types[b.type] || {};
      let authoring;
      if (b.gen) authoring = '성취기준 원문 자동 주입(저작 불필요).';
      else if (info.copyrightSlot) authoring = '저작권 지문은 ［…슬롯］ 유지 — 원문 저작 금지(교사가 원문 삽입).';
      else if (b.type === 'content' || b.type === 'hypothesis-box') authoring = '교사용 예시 답안(.answer) 저작 — 학생 빌드에서 물리 제거됨.';
      else if (b.type === 'answer-line') authoring = '학생 서술 칸(저작 불필요, 빈 줄 유지).';
      // 정답 있는 시각 조직자(프레이어·인물분석 등): 정답 칸엔 교사용 모범 예시를 .answer 로 저작해
      // 교사용에만 실리고 학생 빌드에서 물리 제거되게 한다(무API — 구조는 엔진, 예시 내용만 저작).
      // 나머지 안내·빈 칸은 여전히 학생이 채운다("학생이 채운다" 문구 유지 → 빈칸 조직자와 동일 안전).
      else if (info.studentFill && info.teacherExample) authoring = `정답 있는 시각 조직자 — 정답 칸(${info.teacherExample})엔 교사용 모범 예시를 <span class="answer">…</span> 로 저작(학생 빌드에서 물리 제거). 나머지 안내·빈 칸은 학생이 채운다(빈 칸 유지).`;
      else if (info.studentFill) authoring = '빈 시각 조직자 구조 — 학생이 채운다(저작 불필요, 빈 칸 유지). 주제 적합은 제목·안내문·성취기준으로 이룬다.';
      else authoring = `이 주제에 맞는 콘텐츠를 저작${info.slots?.length ? ` (슬롯: ${info.slots.join(', ')})` : ''}.`;
      return { role: b.role, type: b.type, category: b.category, packRole: b.packRole, slots: info.slots || [], desc: info.desc || '', authoring, ...(info.teacherExample ? { teacherExample: info.teacherExample } : {}) };
    }));
    return { archetype: id, name: r.name, subject, theme: r.theme, pages };
  }

  /** step(고정 type 또는 packRole)을 교과에 맞는 구체 타입으로 바인딩. */
  bindType(step, subject) {
    if (step.type) return { type: step.type, packRole: null };
    const role = this.packRoles[step.packRole];
    if (!role) throw new Error(`알 수 없는 packRole: ${step.packRole}`);
    const type = (role.bindings && role.bindings[subject]) || role.default;
    return { type, packRole: step.packRole };
  }

  /** 아키타입을 교과에 해석 → 페이지별 구체 블록 정보(타입·카테고리·exemplar 파일). */
  resolve(id, subject) {
    const a = this.get(id);
    const pages = a.pages.map((pg) => pg.map((step) => {
      const { type, packRole } = this.bindType(step, subject);
      const info = this.vocab.types[type];
      if (!info) throw new Error(`${id}/${subject}: 타입 '${type}'(role ${step.role})가 vocabulary 에 없습니다.`);
      // 교과 누출 방지: pack 타입은 현재 교과(또는 범용 '*') 전용이어야 한다.
      if (info.category === 'pack' && !info.subjects.includes(subject) && !info.subjects.includes('*')) {
        throw new Error(`${id}/${subject}: pack 타입 '${type}'(role ${step.role})는 ${info.subjects.join(',')} 전용 — 교과 누출.`);
      }
      return { role: step.role, type, packRole, category: info.category, gen: !!info.gen, file: info.file || null, ...(step.fit ? { fit: step.fit } : {}) };
    }));
    return { id, name: a.name, subject, theme: this.themeFor(subject), pill: a.pill || '', pages };
  }

  /**
   * 해석 결과 → 렌더 가능한 스켈레톤 매니페스트(exemplar 자리표시).
   * Phase 4 compose 가 요청·성취기준으로 콘텐츠를 저작해 이 자리표시를 대체한다.
   * @param {{docTitle?:string, standards?:string[], standardsText?:object, dataSubject?:string,
   *   objectives?:string[], objectivesHeading?:string|null, showStandards?:boolean}} opts
   *   objectives: 학습목표(저작 문장) — 있으면 standard-label 블록이 성취기준 기계 변환 대신 이 문장을
   *   싣는다(AssembleWorksheet#renderStandardLabel). 비어 있으면 키 자체를 만들지 않는다(하위호환).
   */
  toSkeletonManifest(id, subject, {
    docTitle = null, standards = [], standardsText = {}, dataSubject = null,
    objectives = [], objectivesHeading = null, showStandards = false,
  } = {}) {
    const r = this.resolve(id, subject);
    const arch = this.get(id);
    const katex = r.pages.some((pg) => pg.some((b) => this.vocab.types[b.type]?.requiresKatex));
    const pages = r.pages.map((pg) => pg.map((b) => (
      b.gen ? { type: b.type, gen: 'standard-label' } : { type: b.type, file: b.file, ...(b.fit ? { fit: b.fit } : {}) }
    )));
    return {
      id: `${id}-${subject}`,
      subject,
      ...(arch.paper ? { paper: arch.paper } : {}),
      dataSubject: dataSubject || subject,
      theme: r.theme,
      lang: 'ko',
      docTitle: docTitle || `${r.name} 스켈레톤 — ${subject}`,
      head: { katex },
      runHead: `아키타입 스켈레톤 · ${r.name}`,
      runFoot: { left: `${r.name} 구조 스켈레톤`, rightPrefix: subject },
      standards,
      standardsText,
      // 학습목표(저작 영역) — 미저작이면 키를 만들지 않아 스캐폴드 산출이 종전과 바이트 동일하다.
      ...(normalizeObjectives(objectives).length > 0
        ? {
          objectives: normalizeObjectives(objectives),
          ...(objectivesHeading ? { objectivesHeading } : {}),
          ...(showStandards === true ? { showStandards: true } : {}),
        }
        : {}),
      pages,
    };
  }
}
