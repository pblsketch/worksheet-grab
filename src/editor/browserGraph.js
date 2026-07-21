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

/**
 * entry 에서 시작해 상대경로 import/export 간선을 전이 순회한다.
 * @param {string} root 레포 루트(절대경로)
 * @param {string} entry 루트 기준 상대 엔트리(기본: 검수 체인)
 * @returns {{files:string[], violations:{file:string, token:string}[]}}
 *   files: 루트 기준 forward-slash 상대경로(브라우저 fetch 경로와 1:1), 정렬됨.
 */
export function resolveBrowserGraph(root, entry = 'src/usecases/ValidateWorksheet.js') {
  const absRoot = resolve(root);
  const seen = new Set();
  const violations = [];
  const queue = [resolve(absRoot, entry)];

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
