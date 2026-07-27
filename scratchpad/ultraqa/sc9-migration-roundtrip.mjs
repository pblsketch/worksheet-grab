// 시나리오 9 — 마이그레이션 왕복: worksheets/ 4문서 + manifests/ 4종을 각각
// 열기(지연 마이그레이션)→실편집(CDP)→저장(새 스키마 커밋)→재열기(디스크 재독) 무손실 검증.
// 원본 무접촉: 전부 임시 워크스페이스 복사본. 실행: node scratchpad/ultraqa/sc9-migration-roundtrip.mjs
import { readFileSync, mkdirSync, writeFileSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchQa, assertLog, sleep, ROOT } from './harness.mjs';

const A = assertLog();

/** 구 manifest pages[].blocks[].html 등에서 보이는 텍스트 토큰 추출(무손실 판정 근거). */
function visibleTokens(manifest) {
  const htmls = [];
  for (const page of manifest.pages || []) {
    for (const b of page.blocks || []) if (typeof b.html === 'string') htmls.push(b.html);
  }
  if (typeof manifest.docTitle === 'string') htmls.push(`<p>${manifest.docTitle}</p>`);
  if (typeof manifest.standardsText === 'string') htmls.push(`<p>${manifest.standardsText}</p>`);
  const text = htmls.join(' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  const tokens = new Set();
  for (const raw of text.split(/\s+/)) {
    const t = raw.replace(/[^가-힣a-zA-Z0-9]/g, '');
    if (t.length >= 4) tokens.add(t);
  }
  return [...tokens];
}

async function roundTrip(label, prepare) {
  // prepare(dirPath) → 임시 워크스페이스의 <docName>/ 디렉터리를 구성한다.
  const staging = mkdtempSync(join(tmpdir(), 'wsg-uqa-mig-'));
  const docDir = join(staging, label);
  mkdirSync(docDir, { recursive: true });
  prepare(docDir);
  const manifest = JSON.parse(readFileSync(join(docDir, 'worksheet.manifest.json'), 'utf8'));
  const isLegacy = !('pagination' in manifest);
  const tokens = isLegacy ? visibleTokens(manifest) : [];

  const s = await launchQa({ copyFrom: docDir, docName: label });
  try {
    await s.navigate();
    const shell0 = await s.shellJson();
    if (isLegacy) A.check(shell0.migrated === true, `[${label}] 구 manifest 지연 마이그레이션(migrated:true)`);
    const rev0 = shell0.meta?.revision ?? 0;

    // 실편집: 첫 텍스트 개체 더블클릭 → 마커 타이핑
    const marker = `MIG${Date.now().toString(36).slice(-5)}`;
    const target = await s.evalExpr(`(() => {
      const f = document.querySelector('#stage iframe:not(.hidden)');
      const el = [...f.contentDocument.querySelectorAll('[data-oid]')].find((e) =>
        ['title','richtext','question'].includes(e.dataset.ot || '') || e.querySelector('.title-box, .q'));
      if (!el) return null;
      const fr = f.getBoundingClientRect(); const r = el.getBoundingClientRect();
      return { oid: el.dataset.oid, x: fr.left + r.left + r.width / 2, y: fr.top + r.top + Math.min(r.height / 2, 20) };
    })()`);
    A.check(!!target, `[${label}] 편집 가능한 텍스트 개체 존재`);
    if (target) {
      await s.dblclick(target.x, target.y);
      await s.insertText(marker);
      await s.pressKey('Escape');
      await sleep(600);
    }
    await s.pressKey('s', { modifiers: 2 });
    await sleep(2000);

    // 재열기(디스크 재독)
    const shell1 = await s.shellJson();
    A.check(shell1.migrated === false, `[${label}] 저장 후 재열기 migrated:false(새 스키마 커밋)`);
    A.check((shell1.meta?.revision ?? 0) === rev0 + 1, `[${label}] rev ${rev0}→${shell1.meta?.revision}(+1)`);
    A.check(shell1.document?.pagination === 'paginated', `[${label}] pagination=paginated 유지`);
    const docStr = JSON.stringify(shell1.document);
    // 토큰은 구두점 제거 정규화로 만들었으므로 대상도 동일 정규화(하이픈·가운뎃점 등 허위 양성 방지).
    const docNorm = docStr.replace(/[^가-힣a-zA-Z0-9]/g, '');
    if (target) A.check(docStr.includes(marker), `[${label}] 편집 마커 보존`);
    if (isLegacy) {
      const missing = tokens.filter((t) => !docNorm.includes(t));
      A.check(missing.length === 0,
        `[${label}] 구 문서 텍스트 무손실 (${tokens.length - missing.length}/${tokens.length}${missing.length ? ' 누락: ' + missing.slice(0, 5).join(',') : ''})`);
    }
    A.check(s.consoleErrors.length === 0, `[${label}] 콘솔 에러 0 (실측 ${s.consoleErrors.length})`);
    if (s.consoleErrors.length) console.log(`[${label} consoleErrors]`, s.consoleErrors.slice(0, 5));
  } finally {
    await s.close();
    try { rmSync(staging, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
  }
}

// ── worksheets/ 4문서(디렉터리 통째 복사) ──
for (const name of ['데모활동지', '문학의가치-UDL', '편집테스트', '개체편집테스트']) {
  await roundTrip(`ws-${name}`, (docDir) => {
    rmSync(docDir, { recursive: true, force: true });
    cpSync(join(ROOT, 'worksheets', name), docDir, { recursive: true });
  });
}

// ── manifests/ 4종(manifest 만으로 문서 디렉터리 합성) ──
for (const file of ['ko.json', 'sci.json', 'sci-bio-classification.json', 'sci-photosynthesis.json']) {
  await roundTrip(`mf-${file.replace('.json', '')}`, (docDir) => {
    const manifest = readFileSync(join(ROOT, 'manifests', file), 'utf8');
    writeFileSync(join(docDir, 'worksheet.manifest.json'), manifest, 'utf8');
    mkdirSync(join(docDir, 'history'), { recursive: true });
    mkdirSync(join(docDir, 'assets'), { recursive: true });
  });
}

process.exitCode = A.summary('sc9-migration-roundtrip') ? 0 : 1;
