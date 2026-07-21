import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserGraph } from '../../src/editor/browserGraph.js';

// E2 순수성 가드(Chrome 무관): 검수 체인이 브라우저 ESM 으로 로드 가능함을 상시 단정.
// domain 등에 node: 한 줄이 섞이면 153 유닛이 green 이어도 에디터만 조용히 깨진다 —
// 그 회귀를 유닛 그물에서 포착한다(Architect 신테시스).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('그래프: 검수 체인 전이 순회가 domain 재수출 6개를 실제 포함(export-from 배럴 추적)', () => {
  const { files } = resolveBrowserGraph(ROOT);
  const expected = [
    'src/usecases/ValidateWorksheet.js',
    'src/usecases/html-scan.js',
    'src/usecases/BuildVariants.js',
    'src/usecases/paper.js',
    'src/domain/index.js',
    // domain/index.js 는 import 문 0, 전부 `export … from` — 이 6개가 그래프에 있어야
    // 브라우저 배럴 파싱 시 fetch 가 404 나지 않는다(화이트리스트 원천).
    'src/domain/BlockContent.js',
    'src/domain/Block.js',
    'src/domain/Standard.js',
    'src/domain/Theme.js',
    'src/domain/Variant.js',
    'src/domain/Worksheet.js',
  ];
  for (const f of expected) assert.ok(files.includes(f), `그래프에 ${f} 포함`);
});

test('순수성: 그래프 내 전 파일에 node:/require/process/__dirname 부재', () => {
  const { violations } = resolveBrowserGraph(ROOT);
  assert.deepEqual(violations, [], `브라우저 안전 위반: ${JSON.stringify(violations)}`);
});

test('가드 실효성: export-from 배럴 뒤의 node: 오염을 검출한다(픽스처 증명)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-purity-'));
  // entry → (export-from 배럴) → leaf 에 node:fs — import 전용 추출이라면 leaf 에 도달 못 한다.
  await writeFile(join(dir, 'entry.js'), `export { x } from './barrel.js';\n`, 'utf8');
  await writeFile(join(dir, 'barrel.js'), `export { x } from './leaf.js';\nexport * from './star.js';\n`, 'utf8');
  await writeFile(join(dir, 'leaf.js'), `import { readFile } from 'node:fs';\nexport const x = 1;\n`, 'utf8');
  await writeFile(join(dir, 'star.js'), `export const y = process.env.HOME;\n`, 'utf8');
  const { files, violations } = resolveBrowserGraph(dir, 'entry.js');
  assert.ok(files.includes('leaf.js'), 'export-from 경유 도달');
  assert.ok(files.includes('star.js'), 'export * from 경유 도달');
  assert.ok(violations.some((v) => v.file === 'leaf.js' && v.token === 'node:'), 'node: 검출');
  assert.ok(violations.some((v) => v.file === 'star.js' && v.token === 'process.'), 'process. 검출');
});

test('주석 내 위반 표기는 오탐하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wsg-purity-c-'));
  await writeFile(join(dir, 'entry.js'),
    `// import { readFile } from 'node:fs' — 주석\n/* process.env 도 주석 */\nexport const ok = 'https://cdn.example/x'; // URL 보존\n`, 'utf8');
  const { violations } = resolveBrowserGraph(dir, 'entry.js');
  assert.deepEqual(violations, []);
});
