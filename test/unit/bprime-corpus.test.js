import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAiFragment, compileFragmentToInsertSection, validateObjectShape } from '../../src/domain/schema/index.js';
import { validateResponse, AI_SCHEMA_VERSION } from '../../src/usecases/aiBridge.js';
import { CORPUS, SPIKE_ANCHOR } from '../fixtures/spike-bprime/corpus.js';

// B′ 스파이크 corpus 를 회귀 가드로 고정(run-spike.mjs 의 임계를 test:unit 에도 상주시킨다).
// corpus 가 늘거나 검증기가 바뀌어도 "공격 100% 거부 · 정상 100% 승인·컴파일 정합"이 깨지면 즉시 fail.

let _n = 0;
const genId = () => `frag-${_n++}`;

test('corpus: 모든 valid 케이스는 승인되고, 순서·드리프트·v4·구조 정합', () => {
  for (const c of CORPUS.filter((x) => x.kind === 'valid')) {
    const r = validateAiFragment(c.fragment, c.ctx || {});
    assert.equal(r.ok, true, `${c.id} 승인 실패: ${JSON.stringify(r.findings)}`);
    assert.equal(JSON.stringify(r.objects), JSON.stringify(c.fragment), `${c.id} 드리프트`);
    const { op } = compileFragmentToInsertSection(r.objects, { anchor: SPIKE_ANCHOR, genId });
    assert.deepEqual(op.objects.map((o) => o.type), c.fragment.map((o) => o.type), `${c.id} 순서`);
    assert.equal(validateResponse({ id: 'r', schemaVersion: AI_SCHEMA_VERSION, ops: [op] }), true, `${c.id} v4`);
    for (const o of op.objects) assert.equal(validateObjectShape(o).ok, true, `${c.id}/${o.type} shape`);
  }
});

test('corpus: 모든 attack 케이스는 100% 거부(특히 coordinate/html/answer)', () => {
  for (const c of CORPUS.filter((x) => x.kind === 'attack')) {
    const r = validateAiFragment(c.fragment, c.ctx || {});
    assert.equal(r.ok, false, `${c.id}(${c.attackClass}) 가 거부되지 않음`);
  }
});

test('corpus: 정책 케이스(권한 유무·평문 정합)가 규칙대로 판정', () => {
  for (const c of CORPUS.filter((x) => x.kind === 'policy-allow')) {
    assert.equal(validateAiFragment(c.fragment, c.ctx || {}).ok, true, `${c.id} 권한 승인 실패`);
  }
  for (const c of CORPUS.filter((x) => x.kind === 'policy-reject')) {
    assert.equal(validateAiFragment(c.fragment, c.ctx || {}).ok, false, `${c.id} 정책 반려 실패`);
  }
});
