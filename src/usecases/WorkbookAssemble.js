import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { OpenDocument } from './OpenDocument.js';
import { KATEX_HEAD } from './AssembleWorksheet.js';
import { paperCss } from './paper.js';
import { splitSheets, renumberRunFoot, rewriteAssetUrls } from './sheets.js';
import { normalizeDocName } from './workspace.js';
import {
  validateWorkbook, orderedMembers, resolveWorkbookPaper, checkUniformPaper, memberStartPages,
} from './workbook.js';

// WorkbookAssemble — 자료집(합본) 조립(합의 계획 §2(a) 슬라이스 하이브리드). 멤버 저장본
// worksheet-{student,teacher}.html 을 sheets.splitSheets 로 절단해 단일 head 아래 재합성한다.
// **재조립·BuildVariants 재실행 없음** — student 합본은 정답이 이미 물리 제거된 student
// 저장본만 슬라이스한다(S1). 매니페스트는 메타(theme·head.katex·standards)만 읽는다(재해석 없음).
//
// 순수 조립 로직은 assembleWorkbookHtml(아래) 로 분리해 목 없이 단위 테스트한다. 클래스는
// IO 오케스트레이션(멤버 로드·용지 균일 검사·unsafe 정책·자산 처리)만 담당한다.

// ── 순수 조립(문자열) — Chrome·FS 무지 ──────────────────────────────────

/**
 * @param {object} opts
 * @param {'student'|'teacher'} opts.mode
 * @param {string} opts.title 자료집 제목
 * @param {string} opts.paperBaseCss paper.css 원문
 * @param {string} [opts.paperOverrideCss] paperCss(workbookPaper) 스니펫('' 가능)
 * @param {string} opts.blocksCss blocks.css 원문
 * @param {string} [opts.dataSubject] body[data-subject] 값(디렉티브 글리프용, 색은 스코프가 담당)
 * @param {object|null} [opts.coverMeta]
 * @param {Array<{docName:string, tocTitle?:string, tocStandards?:string[], katex?:boolean,
 *   theme:import('../domain/Theme.js').Theme|null, html:string, assetsBase:string}>} opts.members 정렬된 멤버
 * @returns {{html:string, prefixHtml:string, sectionCounts:number[], startPages:number[],
 *   assetRewriteCount:number, memberProbes:Array<{docName:string, sectionCount:number, html:string}>}}
 */
export function assembleWorkbookHtml({
  mode, title, paperBaseCss, paperOverrideCss = '', blocksCss, dataSubject = '', coverMeta = null, members,
}) {
  if (mode !== 'student' && mode !== 'teacher') throw new Error(`mode 는 student|teacher 여야 합니다: ${mode}`);
  if (!Array.isArray(members) || members.length === 0) throw new Error('assembleWorkbookHtml 는 최소 1개 멤버가 필요합니다.');

  const perMemberSections = members.map((m) => splitSheets(m.html).sections);
  const sectionCounts = perMemberSections.map((s) => s.length);
  const startPages = memberStartPages(sectionCounts); // 본문상대 시작쪽(1 + Σ앞 멤버 섹션 수)

  // 본문 섹션: 절대 쪽번호 재번호 + 자산 재작성 + 멤버별 유일 래퍼.
  let assetRewriteCount = 0;
  const memberWrappers = members.map((m, i) => {
    const start = startPages[i];
    const body = perMemberSections[i].map((sec, j) => {
      const numbered = renumberRunFoot(sec, start + j); // 1..ΣSections 연속
      const r = rewriteAssetUrls(numbered, m.assetsBase);
      assetRewriteCount += r.count;
      return r.html;
    }).join('');
    return `<div data-wb-member="${i}">\n${body}\n</div>`;
  });

  // 테마 스코프: 멤버별 유일 래퍼에만 색 토큰(색 번짐 봉쇄 — S2).
  const scoped = members
    .map((m, i) => (m.theme ? m.theme.toScopedCss(`[data-wb-member="${i}"]`) : ''))
    .filter(Boolean)
    .join('\n\n');

  const katex = members.some((m) => m.katex) ? `\n${KATEX_HEAD}` : ''; // 멤버 union 1회
  const head = buildHead({ mode, title, dataSubject, paperBaseCss, paperOverrideCss, blocksCss, scoped, katex });

  const cover = renderCover(title, coverMeta);       // 쪽번호 없음
  const toc = renderToc(members, startPages);         // 본문상대 시작쪽

  const html = `${head}

${cover}

${toc}

${memberWrappers.join('\n\n')}

</body>
</html>
`;

  // 표지+목차 프리픽스만(동일 head) — WorkbookExport 의 tocPages 실측(C4)용.
  const prefixHtml = `${head}

${cover}

${toc}

</body>
</html>
`;

  // 멤버별 단독 프로브(오버플로 지목용) — 자기 섹션만, 표지·목차 없음. 쪽번호 무관(쪽수만 셈).
  const memberProbes = members.map((m, i) => {
    const probeScoped = m.theme ? m.theme.toScopedCss('[data-wb-member="0"]') : '';
    const probeKatex = m.katex ? `\n${KATEX_HEAD}` : '';
    const probeHead = buildHead({ mode, title, dataSubject, paperBaseCss, paperOverrideCss, blocksCss, scoped: probeScoped, katex: probeKatex });
    const inner = perMemberSections[i].map((sec) => rewriteAssetUrls(sec, m.assetsBase).html).join('');
    const probeHtml = `${probeHead}

<div data-wb-member="0">
${inner}
</div>

</body>
</html>
`;
    return { docName: m.docName, sectionCount: sectionCounts[i], html: probeHtml };
  });

  return { html, prefixHtml, sectionCounts, startPages, assetRewriteCount, memberProbes };
}

function buildHead({ mode, title, dataSubject, paperBaseCss, paperOverrideCss, blocksCss, scoped, katex }) {
  const paper = paperOverrideCss ? `${paperBaseCss}\n${paperOverrideCss}` : paperBaseCss;
  return `<!DOCTYPE html>
<html lang="ko" data-mode="${mode}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">${katex}
<style>
${paper}

${blocksCss}

/* ===== 자료집 멤버별 테마 스코프 (data-wb-member) ===== */
${scoped}
</style>
</head>
<body data-mode="${mode}" data-subject="${escapeAttr(dataSubject)}">`;
}

function renderCover(title, coverMeta) {
  const sub = coverMeta && coverMeta.subtitle
    ? `\n    <p class="wb-cover-sub">${escapeHtml(coverMeta.subtitle)}</p>` : '';
  return `<section class="sheet">
  <div class="title-box">
    <h1>${escapeHtml(title)}</h1>${sub}
  </div>
</section>`;
}

function renderToc(members, startPages) {
  const items = members.map((m, i) => {
    const title = m.tocTitle || m.docName;
    const std = (m.tocStandards && m.tocStandards.length)
      ? ` <span class="wb-toc-std">${escapeHtml(m.tocStandards.map(bracket).join(', '))}</span>` : '';
    return `      <li><span class="wb-toc-title">${escapeHtml(title)}</span>${std} <span class="wb-toc-page">${startPages[i]}</span></li>`;
  }).join('\n');
  return `<section class="sheet">
  <div class="title-box"><h1>목차</h1></div>
  <ul class="wb-toc">
${items}
  </ul>
</section>`;
}

/** 성취기준 코드 대괄호 표기(이미 대괄호면 그대로). */
function bracket(code) {
  const c = String(code);
  return /^\[.*\]$/.test(c) ? c : `[${c}]`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// ── IO 오케스트레이션 클래스 ────────────────────────────────────────────

export class WorkbookAssemble {
  /**
   * @param {{workspace, blockRepository, readTextFile:(path:string)=>Promise<string>,
   *   fileExists:(path:string)=>boolean, copyDir?:(from:string,to:string)=>Promise<void>}} deps
   */
  constructor({ workspace, blockRepository, readTextFile, fileExists, copyDir = null }) {
    if (!workspace) throw new TypeError('WorkbookAssemble 는 workspace 리포지토리가 필요합니다.');
    if (!blockRepository) throw new TypeError('WorkbookAssemble 는 BlockRepository 가 필요합니다.');
    if (typeof readTextFile !== 'function') throw new TypeError('WorkbookAssemble 는 readTextFile 함수가 필요합니다.');
    if (typeof fileExists !== 'function') throw new TypeError('WorkbookAssemble 는 fileExists 함수가 필요합니다.');
    this.openDocument = new OpenDocument({ workspace });
    this.blockRepository = blockRepository;
    this.readTextFile = readTextFile;
    this.fileExists = fileExists;
    this.copyDir = copyDir;
  }

  /**
   * @param {{workbook:object, portable?:boolean, portableAssetsDir?:string|null,
   *   onProgress?:(ev:object)=>void}} args
   * @returns {Promise<{title:string, teacher:object, student:object|null,
   *   unsafeMembers:string[], sectionCounts:number[], paper:*}>}
   */
  async execute({ workbook, portable = false, portableAssetsDir = null, onProgress = () => {} }) {
    const wb = validateWorkbook(workbook);
    const ordered = orderedMembers(wb);
    if (ordered.length === 0) throw new Error('자료집에 멤버가 없습니다 — 먼저 멤버를 등록하세요.');

    const loaded = [];
    for (let i = 0; i < ordered.length; i++) {
      onProgress({ phase: 'collect', index: i + 1, total: ordered.length, docName: ordered[i].docName });
      loaded.push(await this.#loadMember(ordered[i]));
    }

    // 용지 균일(C3) — 불일치 멤버 지목 후 fail-closed.
    const memberPapers = loaded.map((x) => ({ docName: x.member.docName, paper: x.meta?.paper ?? x.manifest?.paper ?? null }));
    const uniform = checkUniformPaper(wb, memberPapers);
    if (!uniform.ok) {
      throw new Error(`자료집 용지 불일치(fail-closed): [${uniform.mismatches.map((m) => m.docName).join(', ')}] 가 자료집 용지(${JSON.stringify(wb.paper)})와 다릅니다 — 멤버 용지를 통일하세요.`);
    }

    const themes = await this.blockRepository.listThemes();
    const themeMap = new Map(themes.map((t) => [t.name, t]));
    const paperBaseCss = await this.blockRepository.readAsset('paper.css');
    const blocksCss = await this.blockRepository.readAsset('blocks.css');
    const paperOverrideCss = paperCss(resolveWorkbookPaper(wb.paper));

    // 자산 베이스: 기본 = 멤버 assets 절대 file:// URL, portable = 복사 + 상대.
    const assetBases = [];
    for (const x of loaded) {
      if (portable) {
        const slug = normalizeDocName(x.member.docName);
        if (this.copyDir) await this.copyDir(x.paths.assetsDir, join(portableAssetsDir, slug));
        assetBases.push(`assets/${slug}`);
      } else {
        assetBases.push(pathToFileURL(x.paths.assetsDir).href);
      }
    }

    const common = {
      title: wb.title,
      paperBaseCss,
      paperOverrideCss,
      blocksCss,
      dataSubject: loaded[0]?.manifest?.subject || '',
      coverMeta: wb.coverMeta ?? null,
    };
    const buildFor = (mode) => assembleWorkbookHtml({
      mode,
      ...common,
      members: loaded.map((x, i) => memberEntry(x, themeMap, mode, assetBases[i])),
    });

    // teacher 는 항상 산출(§7: student 차단이 핵심).
    const teacher = buildFor('teacher');

    // unsafe(meta.unsafe·student 저장본 부재) 멤버가 하나라도 있으면 student 합본 자체를 거부.
    const unsafeMembers = loaded.filter((x) => x.unsafe).map((x) => x.member.docName);
    const student = unsafeMembers.length === 0 ? buildFor('student') : null;

    return { title: wb.title, teacher, student, unsafeMembers, sectionCounts: teacher.sectionCounts, paper: wb.paper };
  }

  async #loadMember(member) {
    const { manifest, meta, paths } = await this.openDocument.execute({ name: member.docName });
    const teacherHtml = await this.readTextFile(paths.teacherPath);
    const studentExists = this.fileExists(paths.studentPath);
    const studentHtml = studentExists ? await this.readTextFile(paths.studentPath) : null;
    // OpenDocument meta 재확인: meta 부재/unsafe/student 저장본 부재 = unsafe.
    const unsafe = meta == null || meta.unsafe === true || !studentExists;
    return { member, manifest, meta, paths, teacherHtml, studentHtml, unsafe };
  }
}

/** 로드된 멤버 + 테마맵 → assembleWorkbookHtml 멤버 엔트리(mode 별 html 선택). */
function memberEntry(x, themeMap, mode, assetsBase) {
  const manifest = x.manifest || {};
  return {
    docName: x.member.docName,
    tocTitle: x.member.tocTitle || manifest.docTitle || (x.meta && x.meta.title) || x.member.docName,
    tocStandards: x.member.tocStandards || manifest.standards || [],
    katex: !!(manifest.head && manifest.head.katex),
    theme: themeMap.get(manifest.theme) || null,
    html: mode === 'teacher' ? x.teacherHtml : x.studentHtml,
    assetsBase,
  };
}
