// EditWorksheet — 매니페스트에 구조화된 편집 오퍼레이션을 적용하는 순수 유스케이스.
// 대화형 편집 루프(M4)의 코어: 교사 지시("3번 문항 빼고 성찰 추가")를 파서가 ops 로 바꾸고,
// 이 유스케이스가 매니페스트(pages×blocks)에 왕복 반영한다. Chrome/파일시스템 무관 → 목 없이 테스트.
//
// 지원 오퍼레이션:
//   { op:'removeItem', n:<번호> }      번호 문항(subq/section-heading) + 종속 블록(답란 등)을 제거
//   { op:'addSection', kind:'reflection' }  마지막 페이지에 성찰 섹션을 추가
//
// 번호 규칙: 블록 html 의 항목 마커에서 도출.
//   subq            → <span class="qnum">N</span>
//   section-heading → <h2 class="sec"><span class="n">N</span>
// 마커에 숫자가 없으면(예: 성찰 섹션의 '＊') 항목 경계로 보지 않아 removeItem 대상에서 제외된다.

const ITEM_TYPES = new Set(['subq', 'section-heading']);

/** 블록 html 에서 항목 번호를 도출(없으면 null). */
export function itemNumber(block) {
  if (!block || !ITEM_TYPES.has(block.type)) return null;
  const html = typeof block.html === 'string' ? block.html : '';
  const q = /class="qnum">\s*(\d+)/.exec(html);
  if (q) return Number(q[1]);
  const n = /class="n">\s*(\d+)/.exec(html);
  if (n) return Number(n[1]);
  return null;
}

/** 성찰 섹션 블록(범교과 코어 클래스만 사용: sec, note-under). */
function reflectionBlocks() {
  return [
    {
      type: 'section-heading',
      html: '<h2 class="sec"><span class="n">＊</span>오늘의 학습을 스스로 돌아보며 성찰해 보자.</h2>',
    },
    {
      type: 'note',
      html:
        '<p style="margin:4mm 0 0;font-size:9.5pt;font-weight:600;">▷ 새롭게 알게 된 점과 더 알고 싶은 점을 적어 보자.</p>\n' +
        '  <div class="note-under"></div><div class="note-under"></div><div class="note-under"></div>',
    },
  ];
}

export class EditWorksheet {
  /**
   * @param {object} manifest 파싱된 매니페스트(pages: Block[][])
   * @param {Array<{op:string,[k:string]:any}>} ops 편집 오퍼레이션
   * @returns {{manifest:object, applied:string[]}}
   */
  execute(manifest, ops) {
    if (!manifest || !Array.isArray(manifest.pages)) {
      throw new TypeError('EditWorksheet: pages 를 가진 매니페스트가 필요합니다.');
    }
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error('EditWorksheet: 적용할 편집 오퍼레이션이 없습니다.');
    }
    const next = structuredClone(manifest);
    const applied = [];
    let removed = false;
    for (const op of ops) {
      switch (op.op) {
        case 'removeItem': applied.push(this.#removeItem(next, op.n)); removed = true; break;
        case 'addSection': applied.push(this.#addSection(next, op.kind)); break;
        default: throw new Error(`EditWorksheet: 알 수 없는 오퍼레이션 "${op.op}"`);
      }
    }
    // 제거 후 번호 구멍(1,2,4…)이 인쇄물에 남지 않도록 일련번호를 재부여한다.
    // 모든 removeItem 은 원본 번호 기준으로 적용을 마친 뒤 한 번만 수행.
    if (removed) {
      const msg = this.#renumber(next);
      if (msg) applied.push(msg);
    }
    return { manifest: next, applied };
  }

  /**
   * 번호 있는 항목(subq/section-heading)을 문서 순서대로 1..N 재부여.
   * 원본 번호가 순증가 수열일 때만 수행 — 번호가 중복/재시작하는 다중 수열
   * 문서(예: PoC 국어 활동별 번호)는 의미가 다르므로 건드리지 않는다.
   * @returns {string|null} applied 메시지(재부여 시) 또는 null(건너뜀/변화 없음)
   */
  #renumber(manifest) {
    const items = [];
    for (const page of manifest.pages) {
      for (const block of page) {
        if (itemNumber(block) != null) items.push(block);
      }
    }
    const nums = items.map(itemNumber);
    const strictlyIncreasing = nums.every((n, i) => i === 0 || n > nums[i - 1]);
    if (!strictlyIncreasing) return null;
    let n = 0;
    let changed = 0;
    for (const block of items) {
      n++;
      if (itemNumber(block) === n) continue;
      const before = block.html;
      block.html = /class="qnum">\s*\d+/.test(before)
        ? before.replace(/(class="qnum">\s*)\d+/, `$1${n}`)
        : before.replace(/(class="n">\s*)\d+/, `$1${n}`);
      changed++;
    }
    return changed > 0 ? `renumber: 문항 번호 1..${n} 재부여(${changed}개 갱신)` : null;
  }

  /** 번호 N 문항 블록 + 다음 번호 문항 직전까지의 종속 블록을 제거. */
  #removeItem(manifest, n) {
    if (!Number.isInteger(n)) throw new Error('removeItem: 번호(n)는 정수여야 합니다.');
    // 페이지→블록을 평탄화하며 (pageIdx, blockIdx) 좌표를 기록.
    const flat = [];
    manifest.pages.forEach((page, p) => page.forEach((block, i) => flat.push({ p, i, block })));

    // 항목 경계(번호를 가진 subq/section-heading)의 평탄 인덱스.
    const boundaries = [];
    flat.forEach((e, idx) => { if (itemNumber(e.block) != null) boundaries.push(idx); });

    const startFlat = flat.findIndex((e) => itemNumber(e.block) === n);
    if (startFlat === -1) {
      const nums = boundaries.map((b) => itemNumber(flat[b].block)).join(', ');
      throw new Error(`removeItem: ${n}번 문항을 찾지 못했습니다(존재하는 번호: ${nums}).`);
    }
    const nextBoundary = boundaries.find((b) => b > startFlat);
    const endFlat = nextBoundary == null ? flat.length : nextBoundary;

    // 제거 대상 좌표 집합.
    const remove = new Set();
    for (let k = startFlat; k < endFlat; k++) remove.add(`${flat[k].p}:${flat[k].i}`);

    // 페이지 재구성(제거 반영), 빈 페이지 제거.
    manifest.pages = manifest.pages
      .map((page, p) => page.filter((_, i) => !remove.has(`${p}:${i}`)))
      .filter((page) => page.length > 0);

    return `removeItem(${n}): ${remove.size}개 블록 제거`;
  }

  /** 마지막 페이지에 성찰(또는 지정 kind) 섹션을 추가. */
  #addSection(manifest, kind = 'reflection') {
    if (kind !== 'reflection') {
      throw new Error(`addSection: 지원하지 않는 섹션 종류 "${kind}"(현재 reflection 만 지원).`);
    }
    const blocks = reflectionBlocks();
    if (manifest.pages.length === 0) manifest.pages.push([]);
    const last = manifest.pages[manifest.pages.length - 1];
    last.push(...blocks);
    return `addSection(${kind}): ${blocks.length}개 블록 추가`;
  }

  /**
   * 교사 지시문(한국어)을 편집 오퍼레이션으로 파싱.
   * 예: "3번 문항 빼고 성찰 추가" → [{op:'removeItem',n:3},{op:'addSection',kind:'reflection'}]
   *
   * 부분 적용 방지(fail-closed): 지시문을 왼쪽부터 스캔하며 숫자 토큰("N번",
   * "1, 2번"·"1번과 2번" 열거 포함)을 누적하고, 제거 동사가 나오면 누적분을 removeItem 으로,
   * 유지 동사("그대로 두고" 등)가 나오면 no-op 으로 소비한다. 어떤 동사에도 소비되지 않은
   * 숫자가 남으면 일부만 적용하는 대신 오류를 던진다(인쇄물 무결성 우선).
   * @param {string} text
   * @returns {Array<object>}
   */
  static parseInstruction(text) {
    const src = String(text || '');
    const ops = [];

    // 토큰: [1] 숫자 열거("1, 2번"/"1번") · [2] 유지 동사 · [3] 제거 동사.
    // 유지 동사에 참고/참조/보고를 포함 — "1번 참고, 2번 삭제"에서 1번이 뒤 제거
    // 동사로 흘러 함께 삭제되던 데이터 손실을 막는다(누적 pending 을 즉시 비운다).
    const tokenRe =
      /(\d+(?:\s*(?:,|·|하고|이랑|와|과|랑|및)\s*\d+)*)\s*번|(그대로\s*두|유지|남기|남겨|놔둬|놔두|참고|참조|보고)|(빼|제거|삭제|없애|지워|제외)/g;
    const pending = [];
    const removeSet = new Set();
    let m;
    while ((m = tokenRe.exec(src)) !== null) {
      if (m[1] != null) {
        for (const d of m[1].match(/\d+/g)) pending.push(Number(d));
      } else if (m[2] != null) {
        pending.length = 0; // 유지 지시: 해당 번호는 건드리지 않는다.
      } else if (m[3] != null) {
        for (const n of pending) removeSet.add(n);
        pending.length = 0;
      }
    }
    for (const n of removeSet) ops.push({ op: 'removeItem', n });

    // 추가: 성찰/되돌아보기/reflection … 추가/넣/더해/삽입
    if (/(성찰|되돌아|돌아보|reflection)/i.test(src) && /(추가|넣|더해|삽입|붙여|달아)/.test(src)) {
      ops.push({ op: 'addSection', kind: 'reflection' });
    }

    if (pending.length > 0) {
      throw new Error(
        `편집 지시 중 ${[...new Set(pending)].join(', ')}번에 적용할 동작을 이해하지 못했습니다` +
        `(부분 적용 방지를 위해 전체를 중단합니다): "${text}". ` +
        '지원: N번 문항 제거(예: "1번과 2번 문항 빼줘"), 성찰 섹션 추가.',
      );
    }
    if (ops.length === 0) {
      throw new Error(
        `편집 지시를 이해하지 못했습니다: "${text}". ` +
        '예: "3번 문항 빼고 성찰 추가" (지원: N번 문항 제거, 성찰 섹션 추가).',
      );
    }
    return ops;
  }
}
