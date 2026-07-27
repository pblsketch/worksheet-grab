import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TYPE_SPECS } from '../../src/domain/schema/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// partEdit.js 는 브라우저 모듈이지만 import 가 없어 그대로 data:URL 로 실을 수 있다
// (body-drag.test.js 의 기법과 동형 — 복사본이 아니라 진짜 소스를 검증한다).
async function loadPartEdit() {
  const src = await readFile(resolve(ROOT, 'src/editor/partEdit.js'), 'utf8');
  const url = `data:text/javascript,${encodeURIComponent(src).replace(/'/g, '%27')}`;
  return import(url);
}

// ── 편집 허용 목록이 카탈로그 밖 필드를 만들지 않는지(초크포인트) ──
//
// partEdit 은 개체 필드를 **직접 변이**하므로, 허용 목록에 카탈로그 밖 이름이 섞이면 저장 시점에야
// ValidateObjectTree 의 unknown-field 로 터진다(그때는 이미 교사가 글을 다 쓴 뒤다). 여기서 막는다.

test('EDITABLE_PARTS 의 모든 (타입, 필드) 가 닫힌 카탈로그 안에 있다', async () => {
  const { EDITABLE_PARTS } = await loadPartEdit();
  for (const [type, spec] of Object.entries(EDITABLE_PARTS)) {
    assert.ok(TYPE_SPECS[type], `카탈로그 밖 타입: ${type}`);
    const allowed = new Set([...TYPE_SPECS[type].required, ...TYPE_SPECS[type].optional]);
    for (const field of [...spec.array, ...spec.scalar]) {
      // 'meta.pill' 같은 중첩 경로는 최상위 필드(meta)가 카탈로그에 있으면 된다.
      const top = field.split('.')[0];
      assert.ok(allowed.has(top), `${type} 에 카탈로그 밖 편집 필드: ${field}`);
    }
  }
});

test('EDITABLE_PARTS: 이미지 캡션은 없다 — selection.js EDIT_FIELD 가 이미 소유한다', async () => {
  const { EDITABLE_PARTS } = await loadPartEdit();
  assert.equal(EDITABLE_PARTS['image-slot'], undefined,
    'figcaption 에 편집 주체가 둘이면 캡처 단계의 partEdit 이 조용히 이긴다');
  // 반대로 selection.js 는 여전히 그 필드를 소유해야 한다(둘 다 놓치면 캡션 편집이 사라진다).
  const selectionSrc = await readFile(resolve(ROOT, 'src/editor/selection.js'), 'utf8');
  assert.match(selectionSrc, /'image-slot': Object\.freeze\(\{ field: 'caption', selector: 'figcaption' \}\)/);
});

test('EDITABLE_PARTS: 배열/스칼라 분류가 렌더가 싣는 좌표 형태와 맞다', async () => {
  const { EDITABLE_PARTS } = await loadPartEdit();
  // 배열 필드는 data-i 와 함께 와야 하고(원소 하나를 지목), 스칼라는 data-i 가 없어야 한다.
  // 그 대응이 어긋나면 resolve() 가 null 을 돌려 편집이 조용히 무시된다.
  assert.deepEqual([...EDITABLE_PARTS['std-box'].array], ['objectives']);
  assert.deepEqual([...EDITABLE_PARTS['std-box'].scalar], ['heading']);
  assert.deepEqual([...EDITABLE_PARTS.title.scalar], ['meta.pill', 'meta.page', 'meta.source']);
  assert.deepEqual([...EDITABLE_PARTS.title.array], []);
  assert.deepEqual([...EDITABLE_PARTS.question.array], ['choices', 'left', 'right', 'items']);
});

// ── 렌더가 싣는 좌표 ↔ partEdit 이 받는 좌표의 정합(두 파일이 갈라지면 편집이 조용히 죽는다) ──

test('RenderObjectTree 가 싣는 data-part 좌표가 전부 EDITABLE_PARTS 에 등록돼 있다', async () => {
  const { EDITABLE_PARTS } = await loadPartEdit();
  const renderSrc = await readFile(resolve(ROOT, 'src/usecases/RenderObjectTree.js'), 'utf8');
  // partAttr(ctx, '<field>'[, i]) 호출에서 필드 이름만 뽑는다.
  const fields = [...renderSrc.matchAll(/partAttr\(ctx,\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(fields.length >= 7, `partAttr 호출을 못 찾았다면 파서가 깨진 것(찾음: ${fields.length})`);
  const registered = new Set(Object.values(EDITABLE_PARTS).flatMap((s) => [...s.array, ...s.scalar]));
  for (const f of new Set(fields)) {
    assert.ok(registered.has(f), `렌더가 싣는 좌표 '${f}' 가 EDITABLE_PARTS 에 없다 — 더블클릭해도 아무 일도 안 일어난다`);
  }
});

// ── Enter 처리: 한 줄짜리 조각에 줄바꿈이 섞이지 않도록 편집을 끝낸다 ──

test('Enter 는 줄바꿈 대신 편집 종료(조각 값에 개행이 섞이는 것을 막는다)', async () => {
  const src = await readFile(resolve(ROOT, 'src/editor/partEdit.js'), 'utf8');
  assert.match(src, /e\.key === 'Enter'[\s\S]{0,200}preventDefault\(\)[\s\S]{0,60}finish\(\)/,
    'Enter 기본 동작(<br>/<div> 삽입)을 막고 편집을 끝내야 한다');
  // Shift+Enter·IME 조합 중에는 개입하지 않는다(조합 확정 Enter 를 삼키면 한글 입력이 끊긴다).
  assert.match(src, /!e\.shiftKey/);
  assert.match(src, /!e\.isComposing/);
});
