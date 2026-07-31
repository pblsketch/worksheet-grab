// B′ 스파이크 고정 corpus — ValidateAiFragment 의 실증 데이터셋. run-spike.mjs 가 소비한다.
//
// 각 케이스: { id, kind, label, fragment, ctx?, attackClass? }
//   kind 'valid'        — 승인되어야 하는 정상 scaffold(flow-only). 구조 유효율·순서·드리프트 계측 대상.
//   kind 'attack'       — 반드시 거부되어야 하는 공격(좌표/HTML/답안/조판/타입…). attackClass 로 묶어 계측.
//   kind 'policy-allow' — 정책 권한이 있으면 승인(예: allowPassageContent).
//   kind 'policy-reject'— 정책상 반려(권한 없음·평문 불일치 등 — 위험이 아니라 규칙 위반).

export const CORPUS = [
  // ── 정상 scaffold(승인 기대) ────────────────────────────────────────────────
  {
    id: 'valid-full-section', kind: 'valid',
    label: '제목+학습박스 대체(callout)+객관식+서술 답란 — 한 섹션',
    fragment: [
      { type: 'title', text: '분수의 덧셈과 뺄셈', level: 2 },
      { type: 'callout', variant: 'summary', body: '<p>분모가 <strong>같을 때</strong>는 분자끼리 더하거나 뺀다.</p>' },
      { type: 'question', qtype: 'multiple-choice', prompt: '1/5 + 2/5 의 값은?', choices: [{ id: 'a', text: '3/5' }, { id: 'b', text: '3/10' }, { id: 'c', text: '1/5' }] },
      { type: 'question', qtype: 'essay', prompt: '분모가 다른 분수를 더하는 방법을 설명하시오.', lines: 4 },
      { type: 'answer-area', style: 'line', lines: 3, label: '풀이' },
    ],
  },
  {
    id: 'valid-matching-ordering', kind: 'valid',
    label: '짝짓기+순서 문항(중첩 id 정상)',
    fragment: [
      { type: 'question', qtype: 'matching', prompt: '용어와 뜻을 짝지으시오.', left: [{ id: 'L1', text: '분자' }, { id: 'L2', text: '분모' }], right: [{ id: 'R1', text: '위의 수' }, { id: 'R2', text: '아래 수' }] },
      { type: 'question', qtype: 'ordering', prompt: '계산 순서대로 배열하시오.', items: [{ id: 'o1', text: '통분' }, { id: 'o2', text: '더하기' }, { id: 'o3', text: '약분' }] },
    ],
  },
  {
    id: 'valid-fill-blank-table', kind: 'valid',
    label: '빈칸+표(셀 header/colspan 정상)',
    fragment: [
      { type: 'question', qtype: 'fill-blank', prompt: '가분수를 대분수로 바꾸면 {{b1}} 이다.', blanks: [{ id: 'b1' }] },
      { type: 'table', splittable: false, headerRows: 1, rows: [[{ text: '분수', header: true }, { text: '값', header: true }], [{ text: '3/2' }, { text: '1과 1/2' }]] },
      { type: 'divider' },
    ],
  },
  {
    id: 'valid-richtext-inline', kind: 'valid',
    label: 'richtext 블록 + 제목 인라인 서식(평문 정합)',
    fragment: [
      { type: 'title', text: '오늘의 활동', textHtml: '오늘의 <strong>활동</strong>' },
      { type: 'richtext', html: '<p>아래 순서를 따라 <em>천천히</em> 풀어 보자.</p><ul><li>첫째</li><li>둘째</li></ul>' },
    ],
  },
  {
    id: 'valid-image-scaffold', kind: 'valid',
    label: '이미지 슬롯(자산 미주입 — alt/caption 만)',
    fragment: [
      { type: 'image-slot', alt: '분수 막대 모형', caption: '그림 1. 1/2 을 나타낸 막대' },
      { type: 'passage-slot', slotLabel: '［지문 삽입 슬롯］' },
    ],
  },
  {
    id: 'valid-glossary-code-caption', kind: 'valid',
    label: 'B2 확장: 용어 정의목록(dl)+인라인 code(평문 정합)+표 캡션',
    fragment: [
      { type: 'richtext', html: '<dl><dt>분자</dt><dd>분수의 위쪽 수</dd><dt>분모</dt><dd>분수의 아래쪽 수</dd></dl>' },
      { type: 'question', qtype: 'short-answer', prompt: '명령 reduce 는 무엇을 하는가?', promptHtml: '명령 <code>reduce</code> 는 무엇을 하는가?' },
      { type: 'table', splittable: false, caption: '표 1. 분수 예시', rows: [[{ text: '분수', header: true }, { text: '값', header: true }], [{ text: '3/2' }, { text: '1과 1/2' }]] },
    ],
  },
  {
    id: 'valid-pre-callout', kind: 'valid',
    label: 'B2 확장: callout 본문에 pre 서식보존 블록',
    fragment: [
      { type: 'callout', variant: 'tip', body: '<p>다음 절차를 따르자.</p><pre>1) 통분\n2) 분자끼리 더하기\n3) 약분</pre>' },
    ],
  },

  // ── 좌표/조판 공격 ──────────────────────────────────────────────────────────
  { id: 'atk-rect', kind: 'attack', attackClass: 'coordinate', label: 'rect 좌표 주입', fragment: [{ type: 'title', text: 'x', rect: { xMm: 10, yMm: 20, wMm: 50, hMm: 30 } }] },
  { id: 'atk-xmm', kind: 'attack', attackClass: 'coordinate', label: '개별 좌표 필드', fragment: [{ type: 'question', qtype: 'essay', prompt: 'q', xMm: 5, yMm: 5 }] },
  { id: 'atk-placement-float', kind: 'attack', attackClass: 'coordinate', label: 'placement:float 저작', fragment: [{ type: 'question', qtype: 'essay', prompt: 'q', placement: 'float' }] },
  { id: 'atk-size', kind: 'attack', attackClass: 'layout', label: 'SIZE 필드(widthPct/align)', fragment: [{ type: 'callout', variant: 'tip', body: '<p>x</p>', widthPct: 60, align: 'center' }] },
  { id: 'atk-transform', kind: 'attack', attackClass: 'layout', label: 'opacity/angle', fragment: [{ type: 'title', text: 'x', opacity: 0.3, angle: 15 }] },
  { id: 'atk-page-authoring', kind: 'attack', attackClass: 'page', label: 'pageId/pagination 저작', fragment: [{ type: 'title', text: 'x', pageId: 'p2', pagination: 'paginated' }] },
  { id: 'atk-page-keys', kind: 'attack', attackClass: 'page', label: 'pages/flow/float/role', fragment: [{ type: 'title', text: 'x', role: 'cover', flow: [] }] },
  { id: 'atk-topid', kind: 'attack', attackClass: 'identity', label: '최상위 id 발급 시도', fragment: [{ type: 'title', id: 'my-id', text: 'x' }] },

  // ── 답안(미마킹/직접) 공격 ───────────────────────────────────────────────────
  { id: 'atk-answer-flag', kind: 'attack', attackClass: 'answer', label: 'answer:true 개체', fragment: [{ type: 'question', qtype: 'short-answer', prompt: '정답은?', answer: true }] },
  { id: 'atk-answerkey', kind: 'attack', attackClass: 'answer', label: 'answerKey 주입', fragment: [{ type: 'question', qtype: 'short-answer', prompt: 'q', answerKey: { text: '42' } }] },
  { id: 'atk-answerkey-html', kind: 'attack', attackClass: 'answer', label: 'answerKey.html 주입', fragment: [{ type: 'question', qtype: 'essay', prompt: 'q', answerKey: { html: '<p>모범답안</p>' } }] },

  // ── HTML 공격 ────────────────────────────────────────────────────────────────
  { id: 'atk-html-script', kind: 'attack', attackClass: 'html', label: 'script 태그', fragment: [{ type: 'richtext', html: '<p>x</p><script>steal()</script>' }] },
  { id: 'atk-html-iframe', kind: 'attack', attackClass: 'html', label: 'iframe', fragment: [{ type: 'callout', variant: 'note', body: '<iframe src="https://evil"></iframe>' }] },
  { id: 'atk-html-onload', kind: 'attack', attackClass: 'html', label: 'on* 핸들러', fragment: [{ type: 'richtext', html: '<p onmouseover="x()">hover</p>' }] },
  { id: 'atk-html-style', kind: 'attack', attackClass: 'html', label: 'style 속성(CSS url())', fragment: [{ type: 'richtext', html: '<p style="background:url(javascript:1)">x</p>' }] },
  { id: 'atk-html-jsurl', kind: 'attack', attackClass: 'html', label: 'javascript: 링크', fragment: [{ type: 'richtext', html: '<a href="javascript:steal()">click</a>' }] },
  { id: 'atk-html-dataurl', kind: 'attack', attackClass: 'html', label: 'data: URL 링크', fragment: [{ type: 'richtext', html: '<a href="data:text/html,<script>x</script>">x</a>' }] },
  { id: 'atk-html-entity-js', kind: 'attack', attackClass: 'html', label: '엔티티 위장 javascript:', fragment: [{ type: 'richtext', html: '<a href="java&#09;script:alert(1)">x</a>' }] },
  { id: 'atk-html-classattr', kind: 'attack', attackClass: 'html', label: 'class="answer" 주입(정답 위장)', fragment: [{ type: 'richtext', html: '<span class="answer">42</span>' }] },
  { id: 'atk-html-img', kind: 'attack', attackClass: 'html', label: 'img 원격 이미지', fragment: [{ type: 'callout', variant: 'note', body: '<img src="https://evil/x.png">' }] },
  { id: 'atk-html-callout-titleHtml', kind: 'attack', attackClass: 'html', label: 'callout.titleHtml(허용 위치 밖)', fragment: [{ type: 'callout', variant: 'tip', body: '<p>x</p>', titleHtml: '<b>제목</b>' }] },

  // ── 타입/구조 공격 ───────────────────────────────────────────────────────────
  { id: 'atk-type-stdbox', kind: 'attack', attackClass: 'type', label: 'std-box(성취기준 원문 불변) 저작', fragment: [{ type: 'std-box', codes: ['[6수03-01]'], objectives: ['조작'] }] },
  { id: 'atk-type-shape', kind: 'attack', attackClass: 'type', label: 'shape(float 전용) 저작', fragment: [{ type: 'shape', shapeKind: 'rect' }] },
  { id: 'atk-type-spacer', kind: 'attack', attackClass: 'type', label: 'spacer(조판 어휘) 저작', fragment: [{ type: 'spacer', heightMm: 20 }] },
  { id: 'atk-type-pagebreak', kind: 'attack', attackClass: 'type', label: 'page-break(조판 어휘) 저작', fragment: [{ type: 'page-break' }] },
  { id: 'atk-type-unknown', kind: 'attack', attackClass: 'type', label: '카탈로그 밖 타입', fragment: [{ type: 'sidebar', text: 'x' }] },
  { id: 'atk-presentation', kind: 'attack', attackClass: 'presentation', label: '표현필드(borderColor/bgColor)', fragment: [{ type: 'passage-slot', slotLabel: 'x', borderColor: '#f00', bgColor: '#eee' }] },
  { id: 'atk-image-src', kind: 'attack', attackClass: 'image', label: 'image-slot.src(구운 정답/원격/경로탈출)', fragment: [{ type: 'image-slot', src: '../../../etc/answer.png' }] },
  { id: 'atk-bad-variant', kind: 'attack', attackClass: 'enum', label: 'callout.variant enum 밖', fragment: [{ type: 'callout', variant: 'danger', body: '<p>x</p>' }] },
  { id: 'atk-bad-qtype', kind: 'attack', attackClass: 'enum', label: 'question.qtype enum 밖', fragment: [{ type: 'question', qtype: 'drag-drop', prompt: 'q' }] },
  { id: 'atk-splittable-true', kind: 'attack', attackClass: 'enum', label: 'table.splittable=true', fragment: [{ type: 'table', splittable: true, rows: [[{ text: 'a' }]] }] },
  { id: 'atk-nested-additional', kind: 'attack', attackClass: 'nested', label: '중첩 추가필드(choices.score)', fragment: [{ type: 'question', qtype: 'multiple-choice', prompt: 'q', choices: [{ id: 'a', text: 'x', score: 10 }] }] },
  { id: 'atk-cell-additional', kind: 'attack', attackClass: 'nested', label: '표 셀 추가필드(colspanX)', fragment: [{ type: 'table', splittable: false, rows: [[{ text: 'a', colspanX: 2 }]] }] },
  { id: 'atk-unknown-field', kind: 'attack', attackClass: 'nested', label: '최상위 미상 필드', fragment: [{ type: 'title', text: 'x', evilPayload: { nested: true } }] },

  // ── 정책(권한/정합) ──────────────────────────────────────────────────────────
  { id: 'pol-passage-noperm', kind: 'policy-reject', attackClass: 'policy', label: 'passage bodyHtml 무권한', fragment: [{ type: 'passage-slot', slotLabel: 'x', bodyHtml: '<p>본문</p>' }] },
  { id: 'pol-passage-perm', kind: 'policy-allow', label: 'passage bodyHtml + allowPassageContent', ctx: { allowPassageContent: true }, fragment: [{ type: 'passage-slot', slotLabel: '［지문］', bodyHtml: '<p>교사가 넣은 지문 본문.</p>', source: '교과서 p.24' }] },
  { id: 'pol-plaintext-mismatch', kind: 'policy-reject', attackClass: 'policy', label: '평문 불일치(textHtml≠text)', fragment: [{ type: 'title', text: '제목 A', textHtml: '<strong>제목 B</strong>' }] },
];

/** 순서 정확도·드리프트 계측을 위한 컴파일 anchor(고정). */
export const SPIKE_ANCHOR = { afterId: 'section-anchor-1' };
export const SPIKE_PAGE_VERSIONS = { 'page-1': 'v-req-1' };
