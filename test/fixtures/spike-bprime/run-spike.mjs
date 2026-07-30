// B′ 스파이크 계측 러너 — 고정 corpus 를 ValidateAiFragment 에 통과시켜 임계 지표를 산출한다.
// 실행: node test/fixtures/spike-bprime/run-spike.mjs
// 산출: test/fixtures/spike-bprime/spike-metrics.json + 콘솔 요약. ADR 의 데이터 근거.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateAiFragment, compileFragmentToInsertSection, isFragmentStale, validateObjectShape,
} from '../../../src/domain/schema/index.js';
import { validateResponse, AI_SCHEMA_VERSION } from '../../../src/usecases/aiBridge.js';
import { CORPUS, SPIKE_ANCHOR, SPIKE_PAGE_VERSIONS } from './corpus.js';

const here = dirname(fileURLToPath(import.meta.url));
let _id = 0;
const genId = () => `frag-${(_id++).toString(36)}`;

const counts = {
  valid: { total: 0, structuralPass: 0, orderOk: 0, driftFree: 0, v4Ok: 0, shapeOk: 0 },
  attack: { total: 0, rejected: 0, byClass: {} },
  policyAllow: { total: 0, allowed: 0 },
  policyReject: { total: 0, rejected: 0 },
};
const details = [];

for (const c of CORPUS) {
  const res = validateAiFragment(c.fragment, c.ctx || {});
  const row = { id: c.id, kind: c.kind, label: c.label, ok: res.ok, rules: res.ok ? [] : [...new Set(res.findings.map((f) => f.rule))] };

  if (c.kind === 'valid') {
    counts.valid.total += 1;
    if (res.ok) {
      counts.valid.structuralPass += 1;
      // 드리프트: 승인 개체 == 입력(정제가 곧 원문 — preview==apply).
      if (JSON.stringify(res.objects) === JSON.stringify(c.fragment)) counts.valid.driftFree += 1;
      // 컴파일 → 순서 보존 + v4 정합 + 개체 구조 정합.
      const { op } = compileFragmentToInsertSection(res.objects, { anchor: SPIKE_ANCHOR, pageVersions: SPIKE_PAGE_VERSIONS, genId });
      const orderOk = op.objects.map((o) => o.type).join(',') === c.fragment.map((o) => o.type).join(',');
      if (orderOk) counts.valid.orderOk += 1;
      if (validateResponse({ id: 'req', schemaVersion: AI_SCHEMA_VERSION, ops: [op] })) counts.valid.v4Ok += 1;
      if (op.objects.every((o) => validateObjectShape(o).ok)) counts.valid.shapeOk += 1;
      row.compiled = { count: op.objects.length, orderOk };
    } else {
      row.error = 'EXPECTED VALID BUT REJECTED';
    }
  } else if (c.kind === 'attack') {
    counts.attack.total += 1;
    const cls = c.attackClass || 'unclassified';
    counts.attack.byClass[cls] ??= { total: 0, rejected: 0 };
    counts.attack.byClass[cls].total += 1;
    if (!res.ok) { counts.attack.rejected += 1; counts.attack.byClass[cls].rejected += 1; }
    else row.error = 'ATTACK NOT REJECTED';
  } else if (c.kind === 'policy-allow') {
    counts.policyAllow.total += 1;
    if (res.ok) counts.policyAllow.allowed += 1; else row.error = 'POLICY-ALLOW REJECTED';
  } else if (c.kind === 'policy-reject') {
    counts.policyReject.total += 1;
    if (!res.ok) counts.policyReject.rejected += 1; else row.error = 'POLICY-REJECT ALLOWED';
  }
  details.push(row);
}

// stale 계측: 정상 프래그먼트를 요청시점 버전으로 컴파일 → 현재 버전이 바뀌면 stale 로 잡히는가.
const staleSample = validateAiFragment(CORPUS.find((c) => c.id === 'valid-full-section').fragment);
const staleCompiled = compileFragmentToInsertSection(staleSample.objects, { anchor: SPIKE_ANCHOR, pageVersions: { 'page-1': 'v1' }, genId });
const staleDetection = {
  sameVersion_notStale: isFragmentStale(staleCompiled.requestPageVersions, { 'page-1': 'v1' }) === false,
  changedVersion_stale: isFragmentStale(staleCompiled.requestPageVersions, { 'page-1': 'v2' }) === true,
  missingPage_stale: isFragmentStale(staleCompiled.requestPageVersions, {}) === true,
};

const rate = (a, b) => (b === 0 ? 1 : a / b);
const CRITICAL = ['coordinate', 'html', 'answer'];
const criticalRejection = {};
for (const cls of CRITICAL) {
  const c = counts.attack.byClass[cls] || { total: 0, rejected: 0 };
  criticalRejection[cls] = rate(c.rejected, c.total);
}

const metrics = {
  generatedAt: new Date().toISOString(),
  corpusSize: CORPUS.length,
  thresholds: {
    structural_validity_rate: 1.0, attack_rejection_rate: 1.0,
    critical_class_rejection: 1.0, order_accuracy: 1.0,
    preview_apply_consistency: 1.0, compiled_v4_valid: 1.0, compiled_shape_valid: 1.0,
    policy_correctness: 1.0,
  },
  results: {
    structural_validity_rate: rate(counts.valid.structuralPass, counts.valid.total),
    attack_rejection_rate: rate(counts.attack.rejected, counts.attack.total),
    critical_class_rejection: criticalRejection,
    attack_rejection_by_class: Object.fromEntries(Object.entries(counts.attack.byClass).map(([k, v]) => [k, rate(v.rejected, v.total)])),
    order_accuracy: rate(counts.valid.orderOk, counts.valid.structuralPass),
    preview_apply_consistency: rate(counts.valid.driftFree, counts.valid.structuralPass),
    compiled_v4_valid: rate(counts.valid.v4Ok, counts.valid.structuralPass),
    compiled_shape_valid: rate(counts.valid.shapeOk, counts.valid.structuralPass),
    policy_allow_rate: rate(counts.policyAllow.allowed, counts.policyAllow.total),
    policy_reject_rate: rate(counts.policyReject.rejected, counts.policyReject.total),
    stale_detection: staleDetection,
  },
  counts,
  details,
};

// 임계 판정.
const R = metrics.results;
const gates = [
  ['structural_validity_rate', R.structural_validity_rate === 1],
  ['attack_rejection_rate', R.attack_rejection_rate === 1],
  ['critical(coordinate)', R.critical_class_rejection.coordinate === 1],
  ['critical(html)', R.critical_class_rejection.html === 1],
  ['critical(answer)', R.critical_class_rejection.answer === 1],
  ['order_accuracy', R.order_accuracy === 1],
  ['preview_apply_consistency', R.preview_apply_consistency === 1],
  ['compiled_v4_valid', R.compiled_v4_valid === 1],
  ['compiled_shape_valid', R.compiled_shape_valid === 1],
  ['policy_allow', R.policy_allow_rate === 1],
  ['policy_reject', R.policy_reject_rate === 1],
  ['stale_detection', Object.values(staleDetection).every(Boolean)],
];
metrics.verdict = gates.every(([, ok]) => ok) ? 'ALL-GATES-PASS' : 'GATE-FAIL';

const outPath = join(here, 'spike-metrics.json');
writeFileSync(outPath, JSON.stringify(metrics, null, 2));

// ── 콘솔 요약 ──
console.log('=== B′ 스파이크 계측 =========================================');
console.log(`corpus: ${CORPUS.length} 케이스 (valid ${counts.valid.total} · attack ${counts.attack.total} · policy ${counts.policyAllow.total + counts.policyReject.total})`);
console.log('');
for (const [name, ok] of gates) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
console.log('');
console.log('공격 거부율(클래스별):');
for (const [cls, r] of Object.entries(metrics.results.attack_rejection_by_class)) {
  console.log(`  ${(r * 100).toFixed(0).padStart(3)}%  ${cls}`);
}
const failures = details.filter((d) => d.error);
if (failures.length) { console.log('\n⚠ 기대 위반:'); for (const f of failures) console.log('  ', f.id, f.error); }
console.log(`\nVERDICT: ${metrics.verdict}`);
console.log(`metrics → ${outPath}`);

if (metrics.verdict !== 'ALL-GATES-PASS') process.exit(1);
