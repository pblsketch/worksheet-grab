#!/usr/bin/env node
// extract-blocks.js — poc/*.html 에서 재조립 명세 manifests/*.json 을 생성한다.
// poc 원본은 읽기만 한다(훼손 금지).
//
// 방식: 각 .sheet 의 최상위 요소를 블록으로 분해 → 크롬(run-head/foot/mode-badge) 제거 →
//       나머지를 manifest 에 인라인 html 엔트리로 담는다(동적 조립 모델). std-box(성취기준)는
//       verbatim 대신 CSV 조회로 재생성하도록 gen 엔트리로 표기(성취기준 원문 창작 금지 준수).
// 안전장치: 추출 블록 합이 원본 콘텐츠와 일치하는지 round-trip 검증(불일치 시 throw).
//
// Phase 2 이후: 위치기반 blocks/{ko,sci}/*.html 조각은 더 이상 만들지 않는다. 타입 어휘는
//   blocks/vocabulary.json + blocks/{core,pack-*}/*.html(재사용 exemplar)이 담당하고,
//   실제 콘텐츠는 manifest 인라인 html 에 저작한다(assemble 은 html/file/gen 모두 지원).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizeHtml, extractClasses, normalizeText } from '../src/usecases/html-scan.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIGS = [
  { src: 'poc/worksheet.html', manifest: 'ko', subject: 'korean', dataSubject: 'ko', theme: 'ko', dir: 'ko' },
  { src: 'poc/science.html', manifest: 'sci', subject: 'science', dataSubject: 'science', theme: 'sci', dir: 'sci' },
];

const FIRST_CLASS_TYPE = {
  'wsheet-title-wrap': 'header', 'title-wrap': 'header',
  'std-box': 'standard-label',
  'direct': 'directive', 'subq': 'subq',
  'lv-table': 'label-value', 'dash-box': 'emphasis-box', 'strip': 'example-strip',
  'cmp': 'comparison-table', 'passage': 'passage', 'q': 'question', 'ans-line': 'answer-line',
  'princ': 'reflection-principles', 'pc': 'pro-con', 'memo': 'memo-table', 'rubric': 'rubric',
  'note-under': 'note', 'qbox': 'resource-box', 'hbox': 'hypothesis-box',
  'vartable': 'variable-table', 'data': 'data-table', 'graphwrap': 'svg-graph',
  'formula': 'formula', 'sec': 'section-heading',
};

/** body 내부 HTML 추출. */
function bodyInner(html) {
  const open = /<body[^>]*>/i.exec(html);
  const start = open ? open.index + open[0].length : 0;
  const end = html.toLowerCase().lastIndexOf('</body>');
  return html.slice(start, end === -1 ? html.length : end);
}

/** 최상위 요소들을 순서대로 분해(공백·주석 텍스트 무시). */
function splitTopLevel(html) {
  const toks = tokenizeHtml(html);
  const blocks = [];
  let depth = 0;
  let buf = '';
  let capturing = false;
  for (const t of toks) {
    if (!capturing) {
      if (t.type === 'text') continue;
      if (t.kind === 'comment' || t.kind === 'doctype' || t.kind === 'close') continue;
      if (t.kind === 'open') { capturing = true; depth = 1; buf = t.raw; continue; }
      if (t.kind === 'void' || t.kind === 'selfclose') { blocks.push(t.raw); continue; }
      continue;
    }
    buf += t.raw;
    if (t.type === 'tag') {
      if (t.kind === 'open') depth++;
      else if (t.kind === 'close') {
        depth--;
        if (depth === 0) { blocks.push(buf); buf = ''; capturing = false; }
      }
    }
  }
  return blocks;
}

function firstClass(raw) {
  const cls = extractClasses(raw.slice(0, raw.indexOf('>') + 1));
  return cls[0] || null;
}

function typeOf(raw) {
  return FIRST_CLASS_TYPE[firstClass(raw)] || 'content';
}

function innerText(raw) {
  const inner = raw.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>\s*$/, '');
  return normalizeText(inner.replace(/<[^>]+>/g, ' '));
}

/** run-foot 의 좌/우 span 텍스트. */
function footParts(raw) {
  const spans = [...raw.matchAll(/<span>([\s\S]*?)<\/span>/gi)].map((m) => normalizeText(m[1]));
  const left = spans[0] || '';
  const rightRaw = spans[1] || '';
  const rightPrefix = rightRaw.replace(/[\s　]*\d+\s*$/, '').trim();
  return { left, rightPrefix };
}

/** std-box 에서 [코드]와 원문 추출(폴백/코드용). */
function parseStandards(raw) {
  const codes = [];
  const text = {};
  const liRe = /<li>\s*<b>\s*\[([^\]]+)\]\s*<\/b>\s*([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(raw)) !== null) {
    const code = `[${m[1].trim()}]`;
    codes.push(code);
    text[code] = normalizeText(m[2]);
  }
  return { codes, text };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function extractOne(cfg) {
  const src = readFileSync(join(ROOT, cfg.src), 'utf8');
  const docTitle = (/<title>([\s\S]*?)<\/title>/i.exec(src)?.[1] || '').trim();
  const katex = /katex/i.test(src);
  const lang = /<html[^>]*lang="([^"]+)"/i.exec(src)?.[1] || 'ko';

  const sections = splitTopLevel(bodyInner(src)).filter((r) => /^<section/i.test(r));
  if (sections.length === 0) throw new Error(`${cfg.src}: .sheet 섹션을 찾지 못했습니다.`);

  let runHead = '';
  let runFoot = { left: '', rightPrefix: '' };
  let standards = [];
  let standardsText = {};
  const pages = [];

  sections.forEach((section, si) => {
    const pageNo = si + 1;
    const inner = section.replace(/^<section[^>]*>/i, '').replace(/<\/section>\s*$/i, '');
    const rawBlocks = splitTopLevel(inner);

    const contentBlocks = [];
    for (const raw of rawBlocks) {
      const fc = firstClass(raw);
      if (fc === 'mode-badge') continue;
      if (fc === 'run-head') { runHead = innerText(raw); continue; }
      if (fc === 'run-foot') { runFoot = footParts(raw); continue; }
      contentBlocks.push(raw);
    }

    // round-trip: 콘텐츠 블록 합 == (inner - chrome). 블록 사이 공백 차이를 무시하려
    // 모든 공백을 제거한 구조적 동등성으로 비교(콘텐츠 문자 손실만 검출).
    const squash = (s) => normalizeText(s).replace(/\s+/g, '');
    const rebuilt = squash(contentBlocks.join(''));
    const chromeStripped = squash(
      inner
        .replace(/<span class="mode-badge"><\/span>/i, '')
        .replace(/<div class="run-head">[\s\S]*?<\/div>/i, '')
        .replace(/<div class="run-foot">[\s\S]*?<\/div>\s*$/i, ''),
    );
    if (rebuilt !== chromeStripped) {
      throw new Error(`${cfg.src} p${pageNo}: round-trip 불일치(블록 추출 손실).`);
    }

    const pageEntries = [];
    contentBlocks.forEach((raw, bi) => {
      const type = typeOf(raw);
      if (type === 'standard-label') {
        const parsed = parseStandards(raw);
        standards = parsed.codes;
        standardsText = { ...standardsText, ...parsed.text };
        pageEntries.push({ type: 'standard-label', gen: 'standard-label' });
        return;
      }
      // 인라인 html 로 담는다(동적 조립 모델). 위치기반 블록 파일은 만들지 않는다.
      pageEntries.push({ type, html: raw.trim() + '\n' });
    });
    pages.push(pageEntries);
  });

  const manifest = {
    id: cfg.manifest,
    subject: cfg.subject,
    dataSubject: cfg.dataSubject,
    theme: cfg.theme,
    lang,
    docTitle,
    head: { katex },
    runHead,
    runFoot,
    standards,
    standardsText,
    pages,
  };

  mkdirSync(join(ROOT, 'manifests'), { recursive: true });
  writeFileSync(
    join(ROOT, 'manifests', `${cfg.manifest}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  const blockCount = pages.flat().filter((e) => e.html).length;
  return { manifest: cfg.manifest, pages: pages.length, blocks: blockCount, standards };
}

function main() {
  for (const cfg of CONFIGS) {
    const r = extractOne(cfg);
    console.log(`✔ ${r.manifest}: ${r.pages}쪽, 인라인 블록 ${r.blocks}개, 성취기준 ${r.standards.join(', ')}`);
  }
}

main();
