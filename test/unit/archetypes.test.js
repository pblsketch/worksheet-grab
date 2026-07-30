import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { ArchetypeLibrary } from '../../src/usecases/ArchetypeLibrary.js';

// Phase 3 — 아키타입(교과 초월 구조 패턴) 라이브러리 검증.
// 아키타입 = 어느 타입 블록을 어떤 순서로. packRole 은 교과가 바인딩에서 채운다(pack 은 해당 교과만).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = () => new FsBlockRepository({ root: ROOT });
const mockCurriculum = { async resolve(code) { return { code, text: `원문(${code})`, subject: 'test' }; } };

async function lib() {
  const r = repo();
  const [archetypes, vocabulary] = await Promise.all([r.readArchetypes(), r.readVocabulary()]);
  return new ArchetypeLibrary({ archetypes, vocabulary });
}

test('archetypes 로더: 6개 아키타입, 각 ≥1쪽', async () => {
  const l = await lib();
  const items = l.list();
  assert.ok(items.length >= 6, `≥6 아키타입(실제 ${items.length})`);
  for (const a of items) {
    assert.ok(a.pages >= 1 && a.blocks >= 1, `${a.id}: 페이지/블록 존재`);
    assert.ok(Array.isArray(a.subjects) && a.subjects.length >= 1, `${a.id}: subjects 존재`);
  }
});

test('계약: 모든 step 은 고정 type 또는 packRole 을 가지며, 참조가 vocabulary/packRoles 에 실재', async () => {
  const l = await lib();
  const vocab = await repo().readVocabulary();
  const arche = await repo().readArchetypes();
  for (const [id, a] of Object.entries(arche.archetypes)) {
    for (const pg of a.pages) {
      for (const step of pg) {
        const hasType = !!step.type, hasRole = !!step.packRole;
        assert.ok(hasType !== hasRole, `${id}/${step.role}: type XOR packRole`);
        if (hasType) {
          assert.ok(vocab.types[step.type], `${id}/${step.role}: 고정 타입 '${step.type}' 가 vocabulary 에 존재`);
        } else {
          assert.ok(arche.packRoles[step.packRole], `${id}/${step.role}: packRole '${step.packRole}' 정의 존재`);
        }
      }
    }
  }
});

test('packRole 바인딩: 기본값은 코어, 교과 바인딩은 그 교과 pack 전용(누출 0)', async () => {
  const l = await lib();
  const vocab = await repo().readVocabulary();
  const arche = await repo().readArchetypes();
  for (const [roleName, role] of Object.entries(arche.packRoles)) {
    const def = vocab.types[role.default];
    assert.ok(def, `packRole ${roleName}: 기본값 타입 '${role.default}' 존재`);
    assert.equal(def.category, 'core', `packRole ${roleName}: 기본값은 코어여야 함(범교과)`);
    for (const [subject, type] of Object.entries(role.bindings || {})) {
      const info = vocab.types[type];
      assert.ok(info, `packRole ${roleName}/${subject}: 타입 '${type}' 존재`);
      if (info.category === 'pack') {
        assert.ok(info.subjects.includes(subject), `packRole ${roleName}: '${type}' 는 ${subject} 전용 pack 이어야(누출 방지)`);
      }
    }
  }
});

test('교과 초월: 모든 아키타입이 선언된 각 교과에서 누출 없이 해석된다', async () => {
  const l = await lib();
  for (const a of l.list()) {
    for (const subject of l.subjectsFor(a.id)) {
      // resolve 는 교과 누출 시 throw — 예외 없이 통과하면 성립.
      const r = l.resolve(a.id, subject);
      assert.equal(r.pages.length, a.pages, `${a.id}/${subject}: 페이지 수 유지`);
      for (const pg of r.pages) {
        for (const b of pg) {
          if (b.category === 'pack') {
            const info = (await repo().readVocabulary()).types[b.type];
            assert.ok(info.subjects.includes(subject), `${a.id}/${subject}: pack '${b.type}' 누출 없음`);
          }
        }
      }
    }
  }
});

test('수용: 실험탐구가 ≥2교과에서 성립하고, 교과별로 구조는 같되 packRole 블록이 달라진다', async () => {
  const l = await lib();
  const subjects = l.subjectsFor('experimental-inquiry');
  assert.ok(subjects.length >= 2, `실험탐구는 ≥2교과(실제 ${subjects.join(',')})`);

  const sci = l.resolve('experimental-inquiry', 'science');
  const soc = l.resolve('experimental-inquiry', 'social');
  // 구조(페이지 수·블록 수·역할 순서)는 동일
  assert.equal(sci.pages.length, soc.pages.length, '페이지 수 동일');
  const roles = (r) => r.pages.flat().map((b) => b.role).join(',');
  assert.equal(roles(sci), roles(soc), '역할 시퀀스 동일(같은 아키타입)');
  // packRole 로 바인딩된 자리는 교과별로 달라진다(다른 주제 적합)
  const packTypes = (r) => r.pages.flat().filter((b) => b.packRole).map((b) => b.type).join(',');
  assert.notEqual(packTypes(sci), packTypes(soc), 'packRole 블록은 교과별로 달라야 함');
  // 과학은 변인표·데이터표·SVG, 사회는 map 을 쓴다(대표 검증)
  assert.ok(packTypes(sci).includes('variable-table') && packTypes(sci).includes('svg-graph'), '과학: 변인표+SVG');
  assert.ok(packTypes(soc).includes('map'), '사회: 지도');
});

test('스켈레톤 매니페스트가 과학·사회에서 렌더 가능한 A4 로 조립된다', async () => {
  const l = await lib();
  for (const subject of ['science', 'social']) {
    const manifest = l.toSkeletonManifest('experimental-inquiry', subject, { docTitle: `실험탐구 — ${subject}` });
    const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
    const { html, worksheet } = await asm.execute(manifest);
    assert.equal(worksheet.pageCount(), 3, `${subject}: 3쪽`);
    // 공통 코어 컴포넌트
    for (const cls of ['title-wrap', 'direct', 'rubric']) {
      assert.match(html, new RegExp(`class="[^"]*\\b${cls}\\b`), `${subject}: 코어 .${cls}`);
    }
    assert.match(html, /data-mode="MODE_TOKEN"/, `${subject}: 2벌 분기 전 토큰 유지`);
  }
});

test('자동 추천: 조직자 전용 키워드는 조직자 구성 틀을, 기존 주제는 기존 아키타입을(회귀 0)', async () => {
  const l = await lib();
  // 조직자 전용 키워드 → 조직자 구성 틀
  assert.equal(l.suggestArchetype('science', '개념 시각화').id, 'concept-visual');
  assert.equal(l.suggestArchetype('science', 'KWL 도입 활동').id, 'kwl-inquiry');
  assert.equal(l.suggestArchetype('korean', '글쓰기 계획').id, 'writing-plan');
  assert.equal(l.suggestArchetype('korean', '독서 감상문').id, 'literary-response');
  assert.equal(l.suggestArchetype('science', '소화 절차 순서도').id, 'process-structure');
  // 기존 매핑 불변(회귀 방지)
  assert.equal(l.suggestArchetype('science', '광합성 실험 탐구').id, 'experimental-inquiry');
  assert.equal(l.suggestArchetype('science', '생물 분류').id, 'concept-structuring');
  assert.equal(l.suggestArchetype('korean', '읽기').id, 'reading-comprehension');
});
