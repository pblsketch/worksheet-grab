import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GenerateWorksheet } from '../../src/usecases/GenerateWorksheet.js';
import { EditWorksheet } from '../../src/usecases/EditWorksheet.js';
import { ValidateWorksheet } from '../../src/usecases/ValidateWorksheet.js';

// E0 단계 4·6 통합: generate 의 paper 전파 / validate 의 용지 기준화 / edit 의 paper 보존.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function mockCurriculum(standards) {
  return {
    async search() { return standards; },
    async resolve() { return null; },
  };
}

const STD = [{ code: '[9과12-01]', text: '광합성 과정을 이해하고 관계를 탐구한다.', subject: '과학' }];

// ── ValidateWorksheet 용지 기준화 (US-E0-6) ──────────────────────────────

test('validate: paper 여백이 최소치 미만이면 print-margin warning', () => {
  const v = new ValidateWorksheet({ paper: { size: 'A4', margins: '5mm' } });
  const { findings } = v.execute('<div>본문</div>');
  const f = findings.find((x) => x.rule === 'print-margin');
  assert.ok(f, 'warning 존재');
  assert.equal(f.evidence, '5mm');
});

test('validate: paper 여백이 충분하면 print-margin 없음(기본 A4 비대칭 포함)', () => {
  for (const paper of [{ size: 'A4' }, { size: 'B4', margins: '20mm' }]) {
    const { findings } = new ValidateWorksheet({ paper }).execute('<div>본문</div>');
    assert.ok(!findings.some((x) => x.rule === 'print-margin'), JSON.stringify(paper));
  }
});

test('validate: 좌·우 비대칭 여백은 h-margin-asymmetry warning', () => {
  const v = new ValidateWorksheet({ paper: { size: 'A4', margins: '12mm 20mm 10mm 15mm' } });
  const { ok, findings } = v.execute('<div>본문</div>');
  const f = findings.find((x) => x.rule === 'h-margin-asymmetry');
  assert.ok(f, 'warning 존재');
  assert.equal(f.severity, 'warning');
  assert.equal(ok, true, '경고는 게이트를 막지 않는다');
});

test('validate: 상·하 비대칭(현행 기본)은 h-margin-asymmetry 아님', () => {
  const { findings } = new ValidateWorksheet({ paper: { size: 'A4' } }).execute('<div>본문</div>');
  assert.ok(!findings.some((x) => x.rule === 'h-margin-asymmetry'), '12/15/10/15 는 좌=우');
});

test('validate: paper 미지정 시 CSS 폴백이 var() 표현에서도 mm 토큰 추출(R5)', () => {
  const narrow = '<style>.sheet { padding: var(--sheet-pad, 5mm 15mm 10mm 15mm); }</style>';
  const { findings } = new ValidateWorksheet().execute(narrow);
  const f = findings.find((x) => x.rule === 'print-margin');
  assert.ok(f, 'var() 폴백 안의 5mm 를 탐지');
  assert.equal(f.evidence, '5mm');

  const safe = '<style>.sheet { padding: var(--sheet-pad, 12mm 15mm 10mm 15mm); }</style>';
  const { findings: f2 } = new ValidateWorksheet().execute(safe);
  assert.ok(!f2.some((x) => x.rule === 'print-margin'));
});

// ── GenerateWorksheet paper 전파 (US-E0-4) ──────────────────────────────

test('generate: 템플릿에 paper 가 있으면 manifest 로 전파', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  // private 필드(#) 때문에 메서드는 원본 인스턴스에 바인딩해 위임하고 readTemplate 만 덮는다.
  const proxy = new Proxy(repo, {
    get(target, prop) {
      if (prop === 'readTemplate') {
        return async (name) => ({ ...(await target.readTemplate(name)), paper: { size: 'B4' } });
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const gen = new GenerateWorksheet({ blockRepository: proxy, curriculum: mockCurriculum(STD) });
  const { manifest, html } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });
  assert.deepEqual(manifest.paper, { size: 'B4' });
  assert.ok(html.includes('@page { size: 257mm 364mm; margin: 0; }'), '전파된 paper 가 조립까지 관통');
});

test('generate: 템플릿에 paper 가 없으면 manifest 에 paper 키 미생성(하위호환)', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum: mockCurriculum(STD) });
  const { manifest } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });
  assert.ok(!('paper' in manifest), 'paper 키 자체가 없어야 함');
});

// ── EditWorksheet paper 보존 (US-E0-6) ──────────────────────────────────

test('edit: 편집 후 paper 보존(structuredClone 왕복)', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const manifest = await repo.readManifest('sci');
  manifest.paper = { size: 'A3', orientation: 'landscape', margins: '15mm' };
  const { manifest: edited } = new EditWorksheet().execute(manifest, [{ op: 'addSection', kind: 'reflection' }]);
  assert.deepEqual(edited.paper, { size: 'A3', orientation: 'landscape', margins: '15mm' });
});
