import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaper, paperCss } from '../../src/usecases/paper.js';

// 폴백-주입 등가성: A4 기본값의 단일 소스 강제.
// paper.css 의 var() 폴백 리터럴(현행 A4 인쇄틀)과 paperCss(resolvePaper({size:'A4'}))
// 가 주입하는 값이 갈라지면, paper:{size:"A4"} 만 붙어도 조용한 리플로우가 생긴다
// (레거시 문서를 에디터가 재저장하는 순간 발화하는 잠복 함정). 여기서 상시 차단한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** paper.css 에서 var(--NAME, FALLBACK) 폴백 전부 수집(변수당 여러 등장 허용). */
function collectFallbacks(css) {
  const out = {};
  for (const m of css.matchAll(/var\(\s*(--sheet-[\w-]+)\s*,\s*([^)]+)\)/g)) {
    const name = m[1];
    const val = m[2].trim();
    (out[name] ??= new Set()).add(val);
  }
  return out;
}

/** paperCss 스니펫에서 :root 변수 값 추출. */
function injectedVars(snippet) {
  const out = {};
  for (const m of snippet.matchAll(/(--sheet-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

test('paper.css 폴백 === paperCss(A4) 주입값 (변수별 정확 일치)', async () => {
  const css = await readFile(resolve(ROOT, 'assets/paper.css'), 'utf8');
  const fallbacks = collectFallbacks(css);
  const injected = injectedVars(paperCss(resolvePaper({ size: 'A4' })));

  for (const name of ['--sheet-w', '--sheet-h', '--sheet-pad', '--sheet-pad-l', '--sheet-pad-r']) {
    const fb = fallbacks[name];
    assert.ok(fb && fb.size >= 1, `paper.css 에 ${name} 폴백이 있어야 함`);
    assert.equal(fb.size, 1, `${name} 폴백이 파일 내에서 단일 값이어야 함(발견: ${[...(fb ?? [])].join(' | ')})`);
    assert.equal(injected[name], [...fb][0],
      `${name}: paperCss(A4) 주입값(${injected[name]}) === paper.css 폴백(${[...fb][0]})`);
  }
});

test('--sheet-pad shorthand 의 right/left 성분 === --sheet-pad-r/--sheet-pad-l (상호 일관성)', () => {
  for (const paper of [{ size: 'A4' }, { size: 'A3', orientation: 'landscape' }, { size: 'B4', margins: '8mm 12mm 9mm 14mm' }]) {
    const vars = injectedVars(paperCss(resolvePaper(paper)));
    const pad = vars['--sheet-pad'].split(/\s+/);
    assert.equal(pad.length, 4, '--sheet-pad 는 항상 4값으로 emit');
    assert.equal(pad[1], vars['--sheet-pad-r'], `right 성분 일치 (${JSON.stringify(paper)})`);
    assert.equal(pad[3], vars['--sheet-pad-l'], `left 성분 일치 (${JSON.stringify(paper)})`);
  }
});

test('@page 기본 리터럴은 A4 유지(paper-absent 캐스케이드 하단)', async () => {
  const css = await readFile(resolve(ROOT, 'assets/paper.css'), 'utf8');
  assert.ok(/@page\s*\{\s*size:\s*A4;\s*margin:\s*0;\s*\}/.test(css), '@page { size: A4; margin: 0; } 유지');
});
