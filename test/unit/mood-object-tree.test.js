import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { RenderObjectTree, deriveRenderMeta } from '../../src/usecases/RenderObjectTree.js';
import { loadRenderAssets } from '../../src/usecases/renderAssets.js';

// P2-b1 게이트 — 개체 트리 렌더 경로(loadRenderAssets → RenderObjectTree)가 문서 optional
// `document.mood` 를 존중하는지 검증한다. manifest 경로(mood-pack.test.js)와 같은 무회귀 계약:
//   미지정=무주입=바이트 그대로 · 지정=무드 레이어 한 겹만 더함 · 미지 무드=fail-closed.
// RenderObjectTree 는 FS 무지 순수 함수라 무드 파일 로드는 loadRenderAssets(repo 접근)가 맡고,
// 렌더러는 이미 해석된 assets.moodCss 문자열만 방출한다. Chrome 불필요(HTML 문자열 계약).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MOODS_DIR = resolve(ROOT, 'themes/moods');

// 최소 개체 트리 문서 — 빈 페이지 1장(개체 없음)이면 <style> 조립·무드 주입을 검증하기에 충분하다.
const BASE_DOC = Object.freeze({
  pagination: 'paginated',
  themeName: 'sci',
  docTitle: '개체트리 무드 테스트',
  pages: [{ flow: [], float: [] }],
});

function repo() { return new FsBlockRepository({ root: ROOT }); }

async function render(docExtra) {
  const document = { ...BASE_DOC, ...docExtra };
  const assets = await loadRenderAssets(repo(), document);
  const meta = deriveRenderMeta(document);
  return new RenderObjectTree().execute(document, assets, meta).html;
}

test('개체트리 무드: 미지정 문서는 무드 레이어가 전혀 없다(현행 산출 그대로)', async () => {
  const html = await render({});
  assert.ok(!html.includes('무드 오버라이드'), '무드 미지정인데 무드 레이어가 주입되었다');
  assert.ok(!html.includes('themes/moods/'), '무드 미지정인데 무드 파일 주석이 들어갔다');
});

test('개체트리 무드: mood 빈문자열/null 은 미지정과 바이트 동일(무주입)', async () => {
  const base = await render({});
  assert.equal(await render({ mood: '' }), base, "mood:'' 는 미지정과 바이트 동일해야 한다");
  assert.equal(await render({ mood: null }), base, 'mood:null 은 미지정과 바이트 동일해야 한다');
});

test('개체트리 무드: mood 지정 시 오직 무드 레이어 한 겹만 더해진다(그 외 전부 바이트 동일 — 무회귀)', async () => {
  const base = await render({});
  const moody = await render({ mood: 'exam' });

  const examCss = readFileSync(resolve(MOODS_DIR, 'exam.css'), 'utf8');
  const moodLayer = `\n\n/* ===== 무드 오버라이드 (themes/moods/exam.css) ===== */\n${examCss}`;

  assert.ok(moody.includes(moodLayer), '무드 지정 산출에 정확한 무드 레이어가 있어야 한다');
  assert.equal(moody.replace(moodLayer, ''), base, '무드 주입이 무드 레이어 외의 바이트를 바꾸면 안 된다(무회귀)');
  assert.match(moody, /--wg-fs-body:\s*9\.5pt/, 'exam 무드의 --wg-fs-body 값이 주입되어야 한다');
});

test('개체트리 무드: 미지 무드는 loadRenderAssets 에서 fail-closed 로 차단', async () => {
  await assert.rejects(
    () => loadRenderAssets(repo(), { ...BASE_DOC, mood: 'no-such-mood' }),
    /알 수 없는 무드|fail-closed/,
    '등록되지 않은 무드는 반드시 에러를 던져야 한다',
  );
});

test('개체트리 무드: manifest 경로와 동일한 무드 레이어를 방출(두 경로 일관성)', async () => {
  // 같은 무드(soft)를 개체트리 경로로 주입한 결과에 manifest 경로와 동형의 헤더·원문이 들어가는지.
  const moody = await render({ mood: 'soft' });
  const softCss = readFileSync(resolve(MOODS_DIR, 'soft.css'), 'utf8');
  assert.ok(moody.includes(`/* ===== 무드 오버라이드 (themes/moods/soft.css) ===== */\n${softCss}`),
    '개체트리 경로도 manifest 경로와 동일한 무드 레이어 문자열을 방출해야 한다');
});
