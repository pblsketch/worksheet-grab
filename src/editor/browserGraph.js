import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';

// browserGraph — 브라우저로 서빙되는 검수 체인의 정적 import 그래프(서버 사이드 유틸).
// 두 가지 목적을 한 그래프로 해결한다(§3.4 "같은 규칙, 두 런타임"의 회귀 안전장치):
//  1) 순수성 가드: 그래프 내 모든 파일에 node:/require/process/__dirname 이 없음을
//     유닛 테스트가 상시 단정 → domain 등에 Node 전용 코드가 섞이면 Chrome 없이 즉시 포착.
//  2) /src 서빙 화이트리스트: EditorHttpServer 는 이 그래프 산출 집합만 서빙(최소권한).
//
// 간선 추출은 정적 구문만 다룬다: `import … from '…'` · `export … from '…'`(re-export
// 배럴 — domain/index.js 는 import 문 0, 전부 export-from) · `export * from '…'` ·
// side-effect `import '…'`. 동적 `import()` 는 현 체인에 부재하며 이 정적 추출로는
// 탐지되지 않는다 — 도입 시 이 가드를 함께 확장할 것.

const EDGE_RES = [
  /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g, // import/export … from, export * from
  /import\s*['"]([^'"]+)['"]/g,                        // side-effect import
];

const FORBIDDEN = [
  { token: 'node:', re: /['"]node:|(?:^|[^\w'"])node:/ },
  { token: 'require(', re: /\brequire\s*\(/ },
  { token: 'process.', re: /\bprocess\./ },
  { token: '__dirname', re: /__dirname/ },
];

/** 라인·블록 주석 제거(오탐 방지). 문자열 내 `//` 는 URL(`https://…`)만 보호하는 휴리스틱. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 기본 엔트리 집합 — 검수 체인(ValidateWorksheet) + 개체 트리 검증 체인(ValidateObjectTree, S1.2)
// + 개체 트리 순수 render-core(RenderObjectTree, S2.1/C-5) + 페이지네이션 순수 계산부
// (PaginateObjectTree, S2.5 — assignFlowToPages/computeAvailableHeightPx 만 순수, Chrome 측정
// 어댑터(src/adapters/PaginationMeasurer.js)는 정적 import 되지 않으므로(생성자 duck-typed 주입)
// 이 그래프에 등장하지 않는다 — 절대 화이트리스트에 등재하지 않는다). EditorHttpServer 는 entry
// 인자 없이 호출하므로 이 배열이 실제 /src 서빙 화이트리스트의 시작점이다.
const DEFAULT_ENTRIES = Object.freeze([
  'src/usecases/ValidateWorksheet.js',
  'src/usecases/ValidateObjectTree.js',
  'src/usecases/RenderObjectTree.js',
  'src/usecases/PaginateObjectTree.js',
  // 에디터 AI 프래그먼트 저작 경로(B′, ADR-bspike-ai-fragment.md). editor/ai.js 가 /src/ 라우트로
  // import 하는데 검수 체인에서 도달하지 않아 화이트리스트에 안 들어온다 — 명시 엔트리로 등재하지
  // 않으면 404 → ai.js 모듈 로드 실패 → AI 패널 백지(apply-ai-fragment.test.js 가 상시 단정).
  // 순수(domain/schema 만 import)라 purity 가드도 통과한다.
  'src/usecases/applyAiFragment.js',
]);

/**
 * entry 에서 시작해 상대경로 import/export 간선을 전이 순회한다.
 * @param {string} root 레포 루트(절대경로)
 * @param {string|string[]} entry 루트 기준 상대 엔트리(기본: DEFAULT_ENTRIES — 검수 체인 + 개체 트리 검증 체인).
 *   배열을 주면 각 엔트리에서 시작한 그래프를 하나로 합쳐 순회한다(화이트리스트 합집합).
 * @returns {{files:string[], violations:{file:string, token:string}[]}}
 *   files: 루트 기준 forward-slash 상대경로(브라우저 fetch 경로와 1:1), 정렬됨.
 */
export function resolveBrowserGraph(root, entry = DEFAULT_ENTRIES) {
  const absRoot = resolve(root);
  const seen = new Set();
  const violations = [];
  const entries = Array.isArray(entry) ? entry : [entry];
  const queue = entries.map((e) => resolve(absRoot, e));

  while (queue.length > 0) {
    const abs = queue.pop();
    const rel = relative(absRoot, abs).split(sep).join('/');
    if (seen.has(rel)) continue;
    seen.add(rel);

    const stripped = stripComments(readFileSync(abs, 'utf8'));
    for (const { token, re } of FORBIDDEN) {
      if (re.test(stripped)) violations.push({ file: rel, token });
    }
    for (const re of EDGE_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(stripped)) !== null) {
        const spec = m[1];
        if (!spec.startsWith('./') && !spec.startsWith('../')) continue; // bare/URL/node: 는 간선 아님(위반 검사가 별도 포착)
        queue.push(resolve(dirname(abs), spec));
      }
    }
  }
  return { files: [...seen].sort(), violations };
}
