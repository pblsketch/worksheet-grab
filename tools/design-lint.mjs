#!/usr/bin/env node
/*
 * worksheet-grab · design-lint — 저장소-네이티브 디자인 계약 검출기 (무의존)
 * ------------------------------------------------------------------------
 * 계약 문서:  docs/design-system/PAPER.impeccable.md
 * 토큰/allowlist: docs/design-system/design-tokens.json
 *
 * 철학: 디자인 리터럴(폰트 크기 pt · 색 hex)은 **토큰 정의부(`--*: value`)** 와
 *       **var() 폴백** 안에만 존재해야 한다. blocks.css·blocks/core 등 소비부에서
 *       raw 로 쓰인 리터럴은 계약 이탈이다. 또한 url()·`.sheet` 셀렉터·신규 float/
 *       position:absolute|fixed 는 프린트 안전·불변식(.sheet 기하) 보호를 위해 금지한다.
 *
 * baseline(test/design/baseline.json)은 현행 잔존 리터럴을 **count 기준으로 유예**한다
 *       (기존은 통과, 신규 추가분만 차단). 이렇게 해야 성숙한 코드베이스를 마비시키지 않고
 *       "새 요소는 자동으로 온-시스템"을 강제할 수 있다.
 *
 * 사용:
 *   node tools/design-lint.mjs                 # 검사(신규 이탈 있으면 exit 1)
 *   node tools/design-lint.mjs --update-baseline   # 현행 상태를 baseline 으로 고정
 *   import { lint } from './tools/design-lint.mjs'  # 테스트에서 프로그램적으로 호출
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
const BASELINE_PATH = join(ROOT, 'test', 'design', 'baseline.json');

function loadTokens() {
  return JSON.parse(readFileSync(join(ROOT, 'docs', 'design-system', 'design-tokens.json'), 'utf8'));
}

function buildAllowSet(tokens) {
  const out = new Set();
  const sc = tokens.semanticColors || {};
  for (const k of Object.keys(sc)) if (Array.isArray(sc[k])) for (const h of sc[k]) out.add(h.toLowerCase());
  for (const h of (tokens.inkScale && tokens.inkScale.values) || []) out.add(h.toLowerCase());
  for (const h of (tokens.surfaceScale && tokens.surfaceScale.values) || []) out.add(h.toLowerCase());
  return out;
}

// ── 스캔 대상 수집: assets/*.css + themes/**/*.css + blocks/**/*.html ──
function walk(absDir, exts, acc) {
  let entries;
  try { entries = readdirSync(absDir); } catch { return; }
  for (const name of entries) {
    const abs = join(absDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(abs);
  }
}
export function targetFiles() {
  const abs = [];
  for (const f of ['assets/blocks.css', 'assets/paper.css']) abs.push(join(ROOT, ...f.split('/')));
  walk(join(ROOT, 'themes'), ['.css'], abs);
  walk(join(ROOT, 'blocks'), ['.html'], abs);
  // 중복 제거 + repo-상대 posix 경로
  const rels = [...new Set(abs)].map((a) => relative(ROOT, a).split(sep).join('/'));
  return rels.sort();
}

// ── 파싱 헬퍼 ──
function stripComments(text, isHtml) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (isHtml) text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  return text;
}
function stripVar(value) {
  // 중첩 var() 까지 안쪽부터 반복 제거 → var() 폴백 안의 리터럴은 계약상 정당하므로 검사 대상에서 뺀다.
  let prev;
  do { prev = value; value = value.replace(/var\([^()]*\)/g, ' '); } while (value !== prev);
  return value;
}
function* declarations(cssText) {
  const re = /([-a-zA-Z]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = re.exec(cssText))) yield [m[1].toLowerCase(), m[2].trim()];
}

function collectFromCss(cssText, rel, add) {
  for (const [prop, rawval] of declarations(cssText)) {
    if (prop.startsWith('--')) continue; // 토큰 정의부: 리터럴의 정당한 거처
    const v = stripVar(rawval);
    if (prop === 'font-size') {
      const m = v.match(/(\d*\.?\d+)(pt|px)\b/);
      if (m) add(rel, 'font-size', m[0]);
    }
    if (prop === 'float') {
      const t = v.trim();
      if (t && t !== 'none') add(rel, 'float', t);
    }
    if (prop === 'position') {
      const m = v.match(/absolute|fixed/);
      if (m) add(rel, 'position', m[0]);
    }
    if (/url\(/.test(v)) add(rel, 'url', 'url()');
    for (const hx of v.match(/#[0-9a-fA-F]{3,8}\b/g) || []) add(rel, 'hex', hx.toLowerCase());
  }
}

function collectFromHtml(htmlText, rel, add) {
  for (const m of htmlText.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) collectFromCss(stripComments(m[1], false), rel, add);
  for (const m of htmlText.matchAll(/style\s*=\s*"([^"]*)"/gi)) collectFromCss(m[1], rel, add);
  for (const m of htmlText.matchAll(/style\s*=\s*'([^']*)'/gi)) collectFromCss(m[1], rel, add);
  for (const m of htmlText.matchAll(/(?:fill|stroke)\s*=\s*"(#[0-9a-fA-F]{3,8})"/gi)) add(rel, 'hex', m[1].toLowerCase());
}

function collectSheetSelector(noCommentText, rel, add) {
  if (rel === 'assets/paper.css') return; // paper.css 가 .sheet 의 유일 소유자
  if (/\.sheet[\s.,#:>{]/.test(noCommentText)) add(rel, 'sheet-selector', '.sheet');
}

/**
 * @param {{updateBaseline?: boolean}} opts
 * @returns {{violations: Array, current: object, baseline: object, allow: string[]}}
 */
export function lint(opts = {}) {
  const tokens = loadTokens();
  const allow = buildAllowSet(tokens);
  const counts = new Map();
  const add = (rel, kind, val) => {
    if (kind === 'hex' && allow.has(val.toLowerCase())) return; // allowlist 색은 재사용 자유
    const sig = `${rel}::${kind}::${String(val).toLowerCase()}`;
    counts.set(sig, (counts.get(sig) || 0) + 1);
  };

  for (const rel of targetFiles()) {
    const text = readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
    const isHtml = rel.endsWith('.html');
    const noc = stripComments(text, isHtml);
    if (isHtml) collectFromHtml(text, rel, add);
    else collectFromCss(noc, rel, add);
    collectSheetSelector(noc, rel, add);
  }

  const current = Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  if (opts.updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
    return { violations: [], current, baseline: current, allow: [...allow] };
  }

  let baseline = {};
  try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { /* baseline 없으면 전량 신규 */ }

  const violations = [];
  for (const [sig, cnt] of counts) {
    const allowed = baseline[sig] || 0;
    if (cnt > allowed) {
      const [rel, kind, val] = sig.split('::');
      violations.push({ rel, kind, val, count: cnt, allowed, newCount: cnt - allowed });
    }
  }
  violations.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { violations, current, baseline, allow: [...allow] };
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const update = process.argv.includes('--update-baseline');
  const res = lint({ updateBaseline: update });
  if (update) {
    console.log(`design-lint: baseline 갱신 — ${Object.keys(res.current).length} 시그니처`);
    process.exit(0);
  }
  if (res.violations.length) {
    console.error(`design-lint: 신규 계약 이탈 ${res.violations.length}건 (토큰/allowlist 사용 필요):`);
    for (const v of res.violations) console.error(`  ${v.rel}  [${v.kind}] ${v.val}  (+${v.newCount})`);
    console.error('\n해결: --wg-*/--c* 토큰 또는 var() 폴백을 쓰고, 색은 design-tokens.json 의 allowlist 를 참조하세요.');
    console.error('정당한 신규 토큰/색이면 계약(design-tokens.json) 갱신 후 `node tools/design-lint.mjs --update-baseline` 로 baseline 을 고정하세요.');
    process.exit(1);
  }
  console.log('design-lint: clean — 신규 계약 이탈 0');
}
