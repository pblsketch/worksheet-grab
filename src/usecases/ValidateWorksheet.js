import { collectTextInside, textOutside, stripRootBlocks } from './html-scan.js';
import { ANSWER_CLASSES } from './BuildVariants.js';
import { resolvePaper, paperMargins, paperMarginMinMm } from './paper.js';
import { ValidateObjectTree } from './ValidateObjectTree.js';

// ValidateWorksheet — 활동지 검수(순수). Chrome 불필요. 두 입력 경로를 지원한다(S2.3).
//  A) HTML 경로(기존, 동작 불변) — execute(html:string). manifest 파이프라인이 여전히 이 경로를 쓴다.
//     1) 정답 누출: .answer/.plot-ans 밖으로 정답 텍스트가 새면 error(FAIL). (수용기준 3)
//     2) 하드코딩 교과색: 교과 팔레트 hex 가 :root 밖에서 쓰이면 warning. (수용기준 4)
//     3) 인쇄 안전(권고, M5): 최소 글자 크기·최소 여백·keep-together 미지원이면 warning. (HANDOFF 3.2)
//     4) 미기입 슬롯: ［…슬롯］ 마커가 남아 있으면 warning(스캐폴드 상태 — 인쇄 전 저작 필요).
//  B) 개체 트리 경로(신설, S2.3) — execute(document:object, renderedHtml?:string). editor-v4 개체
//     트리 문서가 입력이면 1층(구조 검증)을 ValidateObjectTree 에 위임해 error 로 승격하고, 렌더된
//     HTML 이 함께 주어지면(선택) 2층(누출 grep·인쇄 안전 등 렌더 실측 검사)을 같은 배터리로 수행한다.
//     구조 검증은 error(게이트 차단), 렌더 실측 인쇄 안전 룰은 기존과 동일하게 warning 층을 유지한다.
//
// 결과: { ok, findings:[{rule, severity, message, evidence}] }. ok = error 없음.

// SaveDocument 의 마크 소멸 감지가 같은 임계로 판정하도록 export(규칙 단일 정의).
export const MIN_ANSWER_LEN = 8;   // 짧은 숫자("0.5") 오탐 방지
export const SLICE_LEN = 20;       // 긴 정답의 앞부분열 매칭(부분수정 잔존 포착)

export class ValidateWorksheet {
  /**
   * @param {{knownSubjectHexes?:string[], minFontPt?:number, minMarginMm?:number,
   *          paper?:{size?:string,orientation?:string,margins?:string,columns?:number}|null}} opts
   *   paper: manifest.paper — 지정 시 여백 판정을 선택 용지 기준(paperMarginMinMm)으로 한다.
   */
  constructor({ knownSubjectHexes = [], minFontPt = 8, minMarginMm = 8, paper = null } = {}) {
    this.knownSubjectHexes = new Set(knownSubjectHexes.map((h) => h.toLowerCase()));
    this.minFontPt = minFontPt;
    this.minMarginMm = minMarginMm;
    this.paper = resolvePaper(paper);
  }

  /**
   * @param {string|object} input HTML 문자열(기존 경로) 또는 개체 트리 문서(신설 경로, {pagination, pages}).
   * @param {string} [renderedHtml] 개체 트리 경로에서만 사용 — 2층(렌더 실측) 검사 대상 HTML(선택).
   * @returns {{ok:boolean, findings:object[]}}
   */
  execute(input, renderedHtml) {
    if (typeof input === 'string') return this.#executeHtml(input);
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      return this.#executeObjectTree(input, renderedHtml);
    }
    throw new TypeError('ValidateWorksheet 는 HTML 문자열 또는 개체 트리 문서가 필요합니다.');
  }

  /** 경로 A(기존, 동작 불변) — HTML 정적 검사 배터리. */
  #executeHtml(html) {
    const findings = [];
    this.#runHtmlChecks(html, findings);
    const ok = !findings.some((f) => f.severity === 'error');
    return { ok, findings };
  }

  /**
   * 경로 B(신설, S2.3) — 1층: ValidateObjectTree 구조 검증을 위임받아 error 로 승격(게이트 차단).
   * 2층: renderedHtml 이 주어지면 기존 HTML 검사 배터리(누출 grep·인쇄 안전 warning 등)를 그대로 수행.
   */
  #executeObjectTree(document, renderedHtml) {
    const findings = [];

    const structural = new ValidateObjectTree().execute(document);
    for (const f of structural.findings) {
      // ValidateObjectTree 가 severity 를 명시한 finding(예: passage-source-missing advisory)은
      // 그대로 보존한다 — 명시하지 않은 구조 위반만 error(게이트 차단)로 승격한다.
      findings.push({ ...f, severity: f.severity || 'error' });
    }

    if (typeof renderedHtml === 'string') {
      this.#runHtmlChecks(renderedHtml, findings);
    }

    const ok = !findings.some((f) => f.severity === 'error');
    return { ok, findings };
  }

  /** HTML 정적 검사 배터리(경로 A·경로 B 2층이 공유). */
  #runHtmlChecks(html, findings) {
    if (typeof html !== 'string') throw new TypeError('ValidateWorksheet 는 HTML 문자열이 필요합니다.');
    this.#checkAnswerLeak(html, findings);
    this.#checkUnfilledSlots(html, findings);
    this.#checkHardcodedSubjectColor(html, findings);
    this.#checkMinFont(html, findings);
    this.#checkMargin(html, findings);
    this.#checkKeepTogether(html, findings);
    this.#checkRemoteImage(html, findings);
    this.#checkImageAlt(html, findings);
  }

  #checkAnswerLeak(html, findings) {
    const answers = collectTextInside(html, ANSWER_CLASSES);
    if (answers.length === 0) return;
    const outside = textOutside(html, ANSWER_CLASSES);
    for (const ans of answers) {
      if (ans.length < MIN_ANSWER_LEN) continue;
      let leaked = outside.includes(ans);
      if (!leaked && ans.length >= SLICE_LEN) {
        leaked = outside.includes(ans.slice(0, SLICE_LEN));
      }
      if (leaked) {
        findings.push({
          rule: 'answer-leak',
          severity: 'error',
          message: '정답 텍스트가 .answer/.plot-ans 밖으로 노출되었습니다(정답 누출).',
          evidence: ans.length > 60 ? ans.slice(0, 60) + '…' : ans,
        });
      }
    }
  }

  // 미기입 슬롯: 템플릿 슬롯 마커(전각 대괄호 ［…슬롯］)가 그대로 남아 있으면
  // 아직 콘텐츠가 저작되지 않은 스캐폴드다. 게이트 PASS 가 "완성본" 착각을 주지 않도록 경고.
  #checkUnfilledSlots(html, findings) {
    const slots = html.match(/［[^［］]*슬롯[^［］]*］/g) || [];
    if (slots.length === 0) return;
    const uniq = [...new Set(slots)];
    findings.push({
      rule: 'unfilled-slot',
      severity: 'warning',
      message: `미기입 슬롯 ${slots.length}개가 남아 있습니다. 인쇄 전에 교사/AI가 콘텐츠를 채워야 합니다.`,
      evidence: uniq.slice(0, 4).join(' ') + (uniq.length > 4 ? ` 외 ${uniq.length - 4}종` : ''),
    });
  }

  #checkHardcodedSubjectColor(html, findings) {
    if (this.knownSubjectHexes.size === 0) return;
    // 주석(문서/설명용 hex)은 실제 사용이 아니므로 제외 → 그다음 :root 테마 정의 제외.
    const noComments = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    const scanTarget = stripRootBlocks(noComments);
    const hexes = scanTarget.match(/#[0-9a-fA-F]{6}\b/g) || [];
    const seen = new Set();
    for (const raw of hexes) {
      const hex = raw.toLowerCase();
      if (this.knownSubjectHexes.has(hex) && !seen.has(hex)) {
        seen.add(hex);
        findings.push({
          rule: 'hardcoded-subject-color',
          severity: 'warning',
          message: `교과 팔레트색 ${hex} 가 :root 테마 밖에서 하드코딩되었습니다(범교과 위반). var(--*) + themes/*.css 로 옮기세요.`,
          evidence: hex,
        });
      }
    }
  }

  #checkMinFont(html, findings) {
    const styleText = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n')
      + '\n' + (html.match(/style\s*=\s*"[^"]*"/gi) || []).join('\n');
    const sizes = styleText.match(/font-size\s*:\s*([0-9.]+)pt/gi) || [];
    let minSeen = Infinity;
    for (const s of sizes) {
      const m = /([0-9.]+)pt/i.exec(s);
      if (m) minSeen = Math.min(minSeen, parseFloat(m[1]));
    }
    if (minSeen < this.minFontPt) {
      findings.push({
        rule: 'min-font',
        severity: 'warning',
        message: `최소 글자 크기 ${this.minFontPt}pt 미만(${minSeen}pt) 이 있습니다. 인쇄 가독성을 확인하세요.`,
        evidence: `${minSeen}pt`,
      });
    }
  }

  // 인쇄 여백: 선택 용지(manifest.paper)가 있으면 그 여백을 1차 기준으로 판정하고,
  // 없으면 .sheet 의 padding(mm) CSS 파싱으로 판정한다(현행 동작 유지).
  #checkMargin(html, findings) {
    let minMm = null;
    if (this.paper) {
      minMm = paperMarginMinMm(this.paper);
      const m = paperMargins(this.paper);
      if (m.left !== m.right) {
        // 좌·우 비대칭 여백: run-head(right)/mode-badge(left)/run-foot 오프셋이 양쪽에서
        // 달라진다. E0 은 지원하되 인쇄틀 확인을 요구한다(§3.3 고급 자유조합 대비).
        findings.push({
          rule: 'h-margin-asymmetry',
          severity: 'warning',
          message: `좌(${m.left}mm)·우(${m.right}mm) 여백이 다릅니다. 러닝헤더/푸터 오프셋과 제본 여백 의도를 확인하세요.`,
          evidence: `${m.left}mm != ${m.right}mm`,
        });
      }
    } else {
      const m = /\.sheet\s*\{[^}]*padding\s*:\s*([^;]+);/i.exec(html);
      if (!m) return;
      // var(--sheet-pad, 12mm 15mm 10mm 15mm) 표현에서도 mm 토큰이 그대로 추출된다.
      const mmVals = (m[1].match(/([0-9.]+)mm/g) || []).map((v) => parseFloat(v));
      if (mmVals.length === 0) return;
      minMm = Math.min(...mmVals);
    }
    if (minMm < this.minMarginMm) {
      findings.push({
        rule: 'print-margin',
        severity: 'warning',
        message: `인쇄 여백이 안전 최소치 ${this.minMarginMm}mm 미만(${minMm}mm)입니다. 프린터 잘림 위험을 확인하세요.`,
        evidence: `${minMm}mm`,
      });
    }
  }

  // keep-together: 분리 취약 블록(다행 표·지문)이 있는데 page-break-inside:avoid(.keep) 지원이 없으면 경고.
  #checkKeepTogether(html, findings) {
    const styles = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
    const hasKeepSupport = /page-break-inside\s*:\s*avoid/i.test(styles) || /class="[^"]*\bkeep\b/.test(html);
    if (hasKeepSupport) return;

    let breakProne = /class="[^"]*\bpassage\b/.test(html);
    if (!breakProne) {
      const tableRe = /<table[\s\S]*?<\/table>/gi;
      let t;
      while ((t = tableRe.exec(html)) !== null) {
        if ((t[0].match(/<tr\b/gi) || []).length >= 4) { breakProne = true; break; }
      }
    }
    if (breakProne) {
      findings.push({
        rule: 'keep-together',
        severity: 'warning',
        message: '분리 취약 블록(다행 표/지문)이 있으나 keep-together(page-break-inside:avoid / .keep) 지원이 없습니다. 블록이 페이지 경계에서 잘릴 수 있습니다.',
        evidence: 'no page-break-inside:avoid',
      });
    }
  }

  // 원격 이미지(F5): src 가 http(s):// 인 <img> 는 오프라인 인쇄에서 깨지거나 원격 서버에
  // 종속되고, 저작권 출처가 불투명해질 위험이 있다. 로컬 assets/ 상대경로·data: URI 는
  // 대상이 아니다(경고만 — fail-closed 아님, 기존 error 규칙에는 영향 없음).
  #checkRemoteImage(html, findings) {
    const imgRe = /<img\b[^>]*>/gi;
    const srcRe = /\bsrc\s*=\s*(["'])(.*?)\1/i;
    const seen = new Set();
    let m;
    while ((m = imgRe.exec(html)) !== null) {
      const srcMatch = srcRe.exec(m[0]);
      if (!srcMatch) continue;
      const src = srcMatch[2];
      if (/^https?:\/\//i.test(src) && !seen.has(src)) {
        seen.add(src);
        findings.push({
          rule: 'remote-image',
          severity: 'warning',
          message: `원격 이미지(${src})가 인라인되어 있습니다. 오프라인 인쇄·저작권 추적 위험을 피하려면 로컬 assets/ 상대경로로 옮기세요.`,
          evidence: src,
        });
      }
    }
  }

  // 이미지 alt(Codex 교차 QA): alt 부재/빈값 <img> 는 접근성·인쇄 캡션 손실이므로 warning.
  // alt 가 채워진 이미지(placeholder 포함)는 통과. error 아님(게이트 미차단).
  #checkImageAlt(html, findings) {
    const imgRe = /<img\b[^>]*>/gi;
    const altRe = /\balt\s*=\s*(["'])([\s\S]*?)\1/i;
    let missing = 0;
    let m;
    while ((m = imgRe.exec(html)) !== null) {
      const altMatch = altRe.exec(m[0]);
      if (!altMatch || altMatch[2].trim() === '') missing++;
    }
    if (missing > 0) {
      findings.push({
        rule: 'img-alt',
        severity: 'warning',
        message: `대체 텍스트(alt)가 없는 <img> 가 ${missing}개 있습니다. 접근성·인쇄 캡션을 위해 alt 를 채우세요.`,
        evidence: `${missing} img(s) without alt`,
      });
    }
  }
}
