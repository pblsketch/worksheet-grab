import { AssembleWorksheet } from './AssembleWorksheet.js';

// GenerateWorksheet — (학년+교과, 주제) → 성취기준 검색(CSV/MCP) + 교과 템플릿 조립 → 활동지 HTML.
// 콘텐츠는 슬롯 스캐폴드(교사/AI 저작). 성취기준 원문만 외부 조회(창작 금지).
// 포트(BlockRepository.readTemplate, CurriculumProvider.search)에만 의존. Chrome 무지.

// 교과어(입력) → 템플릿·성취기준 과목 라벨 매핑. 범교과: 국어 비특화.
const SUBJECT_REGISTRY = {
  '과학': { template: 'science', label: '과학' },
  '통합과학': { template: 'science', label: '통합과학' },
  '국어': { template: 'korean', label: '국어' },
  '독서와작문': { template: 'korean', label: '독서와 작문' },
  '독서와 작문': { template: 'korean', label: '독서와 작문' },
  '사회': { template: 'social', label: '사회' },
  '역사': { template: 'social', label: '역사' },
  '영어': { template: 'english', label: '영어' },
};

const SCHOOL_PREFIX = { '초': '초등학교', '중': '중학교', '고': '고등학교' };

/** "중2" → {school:'중학교', grade:'중2'} / "중학교" 도 허용. */
export function parseGrade(grade) {
  const s = String(grade || '').trim();
  const m = /^([초중고])/.exec(s);
  if (m) return { school: SCHOOL_PREFIX[m[1]], grade: s };
  for (const [prefix, school] of Object.entries(SCHOOL_PREFIX)) {
    if (s.includes(school)) return { school, grade: s };
  }
  return { school: null, grade: s };
}

/** "중2과학" 처럼 붙은 입력을 {grade, subject} 로 분리. */
export function parseGradeSubject(token) {
  const s = String(token || '').trim();
  const m = /^([초중고]\s*\d*)\s*(.+)$/.exec(s);
  if (m) return { grade: m[1].trim(), subject: m[2].trim() };
  return { grade: '', subject: s };
}

export function resolveSubject(subject) {
  const key = String(subject || '').trim();
  const spec = SUBJECT_REGISTRY[key];
  if (!spec) {
    throw new Error(`지원하지 않는 교과: "${subject}". 지원: ${Object.keys(SUBJECT_REGISTRY).join(', ')}`);
  }
  return spec;
}

export class GenerateWorksheet {
  /** @param {{blockRepository, curriculum}} deps */
  constructor({ blockRepository, curriculum }) {
    if (!blockRepository || typeof blockRepository.readTemplate !== 'function') {
      throw new TypeError('GenerateWorksheet 는 readTemplate 가능한 BlockRepository 가 필요합니다.');
    }
    if (!curriculum || typeof curriculum.search !== 'function') {
      throw new TypeError('GenerateWorksheet 는 search 가능한 CurriculumProvider 가 필요합니다.');
    }
    this.repo = blockRepository;
    this.curriculum = curriculum;
  }

  /**
   * @param {{grade:string, subject:string, topic:string, limit?:number}} args
   * @returns {Promise<{html:string, worksheet, standards, manifest}>}
   */
  async execute({ grade, subject, topic, limit = 6 }) {
    if (!topic) throw new Error('generate: 주제(topic)가 필요합니다.');
    const spec = resolveSubject(subject);
    const { school } = parseGrade(grade);

    const found = await this.curriculum.search({ school, subject: spec.label, keyword: topic, limit });
    if (!found || found.length === 0) {
      throw new Error(`성취기준을 찾지 못했습니다(${school ?? '전체'} · ${spec.label} · "${topic}"). 원문 창작 금지.`);
    }

    const template = await this.repo.readTemplate(spec.template);
    const manifest = buildManifest(template, { grade, school, topic, subjectLabel: spec.label, standards: found });

    const asm = new AssembleWorksheet({ blockRepository: this.repo, curriculum: this.curriculum });
    const { html, worksheet } = await asm.execute(manifest);
    return { html, worksheet, standards: found, manifest };
  }
}

function subVars(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function fillSlots(html, slots) {
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in slots ? slots[k] : ''));
}

function buildManifest(template, ctx) {
  const vars = { topic: ctx.topic, subjectLabel: ctx.subjectLabel, grade: ctx.grade, school: ctx.school || '' };

  const slots = {};
  for (const [k, v] of Object.entries(template.slots || {})) slots[k] = subVars(v, vars);
  slots.TITLE = slots.TITLE || ctx.topic;
  slots.PILL = slots.PILL || template.pillDefault || '';

  const pages = template.pages.map((page) => page.map((entry) => {
    if (entry.gen === 'standard-label' || entry.type === 'standard-label') {
      return { type: 'standard-label', gen: 'standard-label' };
    }
    return { type: entry.type || 'content', html: fillSlots(entry.html, slots) };
  }));

  const standardsText = {};
  for (const s of ctx.standards) standardsText[s.code] = s.text;
  const runFootT = template.runFootTemplate || { left: '', rightPrefix: '' };

  return {
    id: `${template.id}-${ctx.topic}`,
    subject: template.subject,
    dataSubject: template.dataSubject,
    theme: template.theme,
    lang: template.lang || 'ko',
    docTitle: ctx.topic,
    head: template.head || { katex: false },
    runHead: subVars(template.runHeadTemplate || '', vars),
    runFoot: { left: subVars(runFootT.left || '', vars), rightPrefix: subVars(runFootT.rightPrefix || '', vars) },
    standards: ctx.standards.map((s) => s.code),
    standardsText,
    pages,
  };
}
