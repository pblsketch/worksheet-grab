# PRD: Worksheet Editor 2.1 — 페이지 기반 편집 + 복수 개체 AI 수정

> **2026-07-26 결정:** 이 초안의 `contentHtml + runtime DOM selection` 모델은 채택하지
> 않았다. 현재 Editor v4의 영구 개체 트리를 유지하는 실행 정본은
> [`PRD-worksheet-editor-v2-page-object-canvas.md`](./PRD-worksheet-editor-v2-page-object-canvas.md)다.

## 0. 문서 정보

- **프로젝트:** worksheet-grab
- **대상 저장소:** `pblsketch/worksheet-grab`
- **문서 상태:** Implementation Draft
- **우선순위:** P0
- **대상 버전:** Editor 2.1
- **대체 문서:** 기존 페이지 기반 편집기 PRD 및 멀티 공급자 AI PRD의 수정 범위 관련 설계
- **핵심 결정:**
  1. 저장·상태 관리·Undo의 최소 단위는 페이지다.
  2. AI 수정 범위는 텍스트, 단일 개체, 복수 개체, 현재 페이지 전체다.
  3. bbox 기반 자유 선택 영역은 지원하지 않는다.
  4. 영구 블록 manifest는 도입하지 않는다.
  5. AI 결과의 레이아웃 어긋남은 경고 후 사용자 판단으로 적용할 수 있다.
  6. Gemini·Antigravity, Codex, Claude Code를 기본 공급자로 지원한다.

---

## 1. 요약

Worksheet Editor 2.1은 기존 문서 전체 `contenteditable` 편집 구조를 제거하고, 페이지를 안정적인 저장·상태 관리 단위로 사용하는 편집기로 리팩토링한다.

AI 수정은 페이지 전체 재생성에만 제한하지 않는다. 사용자는 다음 네 가지 범위로 AI 수정 요청을 보낼 수 있다.

```text
1. 선택한 텍스트
2. 선택한 단일 개체
3. 선택한 복수 개체
4. 현재 페이지 전체
```

개체는 영구적인 block schema가 아니라 현재 페이지 DOM에서 선택 가능한 의미 단위다.

예:

- 제목
- 문단
- 목록
- 문항 상자
- 표
- 이미지
- 이미지 설명
- 답란
- 강조 상자
- 인용문
- 구분선

문서 저장 모델은 계속 단순하게 유지한다.

```text
Document
 ├─ metadata
 ├─ paper
 └─ pages[]
      ├─ id
      ├─ role
      └─ contentHtml
```

AI는 선택 대상을 수정한 후보를 생성하며 원본 manifest나 저장 파일을 직접 수정하지 않는다.

```text
사용자 선택
→ AI 수정 요청
→ 후보 생성
→ 응답 계약 검사
→ HTML 정제
→ 정답 누출 검사
→ 레이아웃 검사
→ 변경 전·후 비교
→ 사용자 적용 또는 폐기
→ 페이지 HTML command 기록
```

보안, 정답 누출, Page Shell 손상은 적용을 차단한다. 넘침이나 시각적 어긋남은 경고하되 사용자가 적용할 수 있다.

---

## 2. 배경과 문제 정의

### 2.1 기존 편집 구조의 문제

현재 편집기는 teacher iframe의 문서 전체를 `contenteditable`로 열고, 저장 시 `.sheet`, `.wg-block` 등의 DOM을 다시 탐색해 manifest를 복원한다.

이 구조는 다음 문제를 만든다.

- 페이지 래퍼 삭제·병합 가능성
- DOM이 manifest 대신 실제 상태 원본이 됨
- 저장 시 역직렬화와 복구 로직 필요
- 브라우저별 HTML 결과 차이
- AI·이미지·표·정답 기능 간 상태 충돌
- 편집기 코드의 God Object화
- undo/redo 불안정
- 페이지 구조와 개체 구조의 혼재

### 2.2 페이지 전체 AI 수정만으로는 부족함

페이지 전체 재생성은 다음 요청에 적합하다.

- 페이지 전체를 더 간결하게 재구성
- 문항 수 조정
- 전체 여백·밀도 조정
- 전체 디자인 재구성

하지만 다음 요청에는 수정 범위가 지나치게 크다.

- 문장 하나 쉽게 바꾸기
- 표 하나 단순화하기
- 이미지와 캡션만 함께 수정하기
- 특정 문항 세 개만 서술형으로 바꾸기
- 선택한 답란만 늘리기

따라서 페이지 기반 편집 구조를 유지하면서 AI 수정 범위만 더 세분화해야 한다.

### 2.3 bbox 선택 영역을 사용하지 않는 이유

자유 드래그 영역 방식은 다음 복잡성을 만든다.

- 줌·스크롤·페이지 비율에 따른 좌표 보정
- 영역에 일부만 걸친 요소의 포함 여부
- bbox와 DOM 구조의 불일치
- reflow 후 좌표 무효화
- 모바일·고해상도 화면 차이
- 선택 결과에 대한 사용자 예측 가능성 저하

활동지는 자유 캔버스보다 구조화된 문서에 가깝다. 따라서 좌표 영역보다 의미 있는 DOM 개체의 단일·복수 선택이 더 적합하다.

---

## 3. 제품 비전

교사는 활동지 페이지를 일반 문서처럼 직접 편집하고, 필요한 텍스트·개체·개체 묶음·페이지 전체를 AI로 수정할 수 있어야 한다.

편집기는 다음을 보장한다.

- 페이지 경계와 공통 셸은 일반 편집으로 손상되지 않는다.
- 사용자는 하나 또는 여러 개의 개체를 명시적으로 선택할 수 있다.
- AI가 수정할 대상이 화면에 명확히 표시된다.
- AI는 선택되지 않은 내용을 가능한 한 유지한다.
- AI 결과는 자동 적용되지 않는다.
- 구조적·보안상 위험은 차단한다.
- 레이아웃 변화는 경고하되 최종 판단은 사용자에게 맡긴다.
- 적용된 결과는 undo할 수 있다.
- 학생용에서는 정답이 물리적으로 제거된다.

핵심 원칙:

> 페이지는 문서의 안정성을 책임지고, 개체 선택은 AI 수정의 정밀도를 책임진다.

---

## 4. 목표

### 4.1 제품 목표

1. 교사가 페이지 내용을 직접 편집할 수 있다.
2. 하나의 개체를 선택해 AI에 수정 요청할 수 있다.
3. 여러 개의 개체를 함께 선택해 하나의 AI 요청으로 수정할 수 있다.
4. 선택한 텍스트만 AI로 수정할 수 있다.
5. 현재 페이지 전체를 AI로 재생성할 수 있다.
6. 선택 대상과 AI 수정 범위가 명확히 표시된다.
7. AI 수정 전·후를 비교할 수 있다.
8. 레이아웃 경고가 있어도 사용자가 적용 여부를 선택할 수 있다.
9. 구조·보안·정답 누출 문제가 있는 후보는 적용할 수 없다.
10. 적용 후 undo/redo할 수 있다.
11. 세 AI 공급자에서 동일한 사용자 흐름을 제공한다.

### 4.2 기술 목표

1. 페이지 기반 schema v2를 사용한다.
2. 모든 페이지에 안정적인 `pageId`를 부여한다.
3. 문서 전체 `contenteditable`을 제거한다.
4. 현재 페이지의 `.page-content`만 편집 가능하게 한다.
5. 선택 가능한 DOM 개체 모델을 정의한다.
6. 단일·복수 개체 선택 상태를 EditorSession에 포함한다.
7. AI 요청 대상을 임시 target ID로 식별한다.
8. 개체 선택은 영구 manifest 구조에 저장하지 않는다.
9. AI 응답 적용 후 페이지 전체 `contentHtml`을 하나의 command로 기록한다.
10. 공급자별 CLI 차이를 adapter 내부에 캡슐화한다.
11. 기존 `SaveDocument`, `BuildVariants`, `ValidateWorksheet`, `ChromeRenderer`를 유지한다.
12. 외부 UI 프레임워크 없이 기존 vanilla ESM 원칙을 유지한다.

---

## 5. 비목표

이번 버전에서는 다음을 구현하지 않는다.

- 영구 block manifest
- 문항별 영구 ID와 데이터 스키마
- 블록별 배점·난이도·성취기준 관리
- bbox 기반 자유 선택 영역
- 자유형 캔버스 편집
- 절대좌표 기반 요소 배치
- 여러 페이지를 동시에 AI 수정
- AI 결과 자동 적용
- AI 후보 자동 병합
- 실시간 공동 편집
- 클라우드 계정·인증
- 프론트엔드 프레임워크 도입
- ProseMirror, Tiptap, GrapesJS 등 대형 편집기 도입
- Antigravity GUI 자동화
- worksheet-grab 자체 API 키 관리
- AI가 원본 manifest를 직접 수정하는 구조

---

## 6. 문서 모델

### 6.1 manifest schema

```json
{
  "schemaVersion": 2,
  "docTitle": "복합양식 자료 평가하며 읽기",
  "subject": "ko",
  "theme": "ko",
  "paper": {
    "size": "A4",
    "orientation": "portrait",
    "margins": "12mm 15mm 10mm 15mm",
    "columns": 1
  },
  "pages": [
    {
      "id": "page-8e2419f1",
      "role": "cover",
      "contentHtml": "<div class=\"worksheet-title\">...</div>"
    },
    {
      "id": "page-6d03cfad",
      "role": "activity",
      "contentHtml": "<div class=\"section-title\">...</div>"
    }
  ]
}
```

### 6.2 Page Shell

```html
<section class="sheet" data-page-id="page-6d03cfad">
  <header class="run-head">...</header>

  <main class="page-content">
    <!-- 직접 편집 및 AI 수정 대상 -->
  </main>

  <footer class="run-foot">
    <span class="page-number"></span>
  </footer>
</section>
```

다음은 보호 영역이다.

- `.sheet`
- `.run-head`
- `.run-foot`
- 페이지 번호
- paper size
- margin
- print CSS
- student/teacher mode attribute
- editor overlay

### 6.3 개체는 저장 모델이 아니다

개체 선택 상태는 현재 페이지 DOM에서 계산한다.

```text
Manifest
└─ contentHtml

Runtime DOM
├─ h1
├─ p
├─ div.question-box
├─ table
├─ figure
├─ img
├─ figcaption
└─ div.answer-space
```

개체 선택 정보는 EditorSession의 일시 상태이며 manifest에 영구 저장하지 않는다.

---

## 7. 선택 가능한 개체 모델

### 7.1 기본 선택 대상

```text
h1, h2, h3, h4, h5, h6
p
ul, ol
table
figure
img
blockquote
hr
.question
.question-box
.answer-space
.passage-box
.callout
.example-box
.rubric
[data-edit-object]
```

### 7.2 선택 대상에서 제외

```text
span
strong
em
u
a
td
th
tr
tbody
thead
br
.page-content
.sheet
.run-head
.run-foot
```

표 내부 편집은 기존 표 도구로 처리한다.

### 7.3 가장 가까운 선택 개체

사용자가 내부 요소를 클릭했을 때 가장 가까운 상위 selectable object를 찾는다.

```html
<div class="question-box">
  <p><strong>1.</strong> 다음 글을 읽으세요.</p>
</div>
```

`strong`이나 `p`를 클릭하더라도 기본 선택 대상은 `.question-box`가 된다.

### 7.4 선택 안정성

선택 중 DOM에는 임시 속성을 넣을 수 있다.

```html
<div
  class="question-box"
  data-editor-target-id="target-7f29"
  data-editor-selected="true"
>
```

다음 속성은 저장 전 제거한다.

- `data-editor-target-id`
- `data-editor-selected`
- `data-editor-hover`
- 기타 runtime-only attribute

---

## 8. 선택 UX

### 8.1 편집 모드

```text
텍스트 편집 모드
개체 선택 모드
```

권장 단축키:

```text
V: 개체 선택 모드
T 또는 Enter: 텍스트 편집 모드
Escape: 현재 선택 해제
```

### 8.2 단일 선택

- 개체 클릭
- 기존 선택 해제
- 클릭한 개체만 선택
- 선택 outline 표시
- 개체 문맥 툴바 표시

### 8.3 복수 선택

지원 방식:

- Shift+클릭
- Ctrl+클릭
- Cmd+클릭
- 개체 선택 핸들 클릭
- 선택 목록 패널의 체크박스

복수 선택 시 선택된 개체에 1, 2, 3 순번 badge를 표시한다.

### 8.4 선택 순서

AI 요청에는 DOM 문서 순서와 사용자 선택 순서를 모두 제공한다.

```json
{
  "selectionOrder": 2,
  "documentOrder": 5
}
```

기본 AI 처리 순서는 문서 순서다. 사용자 선택 순서는 UI 설명과 특수 요청에 사용한다.

### 8.5 비연속 선택

서로 떨어진 개체도 함께 선택할 수 있다.

```text
문항 1
문항 4
하단 표
```

AI 요청에는 선택되지 않은 중간 개체가 있음을 명시한다.

### 8.6 선택 개체 툴바

```text
[AI 수정] [복제] [위로] [아래로] [프리셋 저장] [삭제]
```

복수 선택에서 위로·아래로는 선택 묶음의 상대 순서를 유지한다.

---

## 9. EditorSession

```js
{
  manifest,
  revision,
  mode: "teacher",

  activePageId: null,
  editingPageId: null,

  selection: {
    mode: "none" | "text" | "objects",
    textRange: null,
    objectTargets: []
  },

  dirty: false,
  dirtyPageIds: new Set(),

  history: {
    undo: [],
    redo: []
  },

  ai: {
    activeRunId: null,
    candidate: null
  }
}
```

### 9.1 object target

```ts
type ObjectTarget = {
  targetId: string;
  pageId: string;
  tagName: string;
  type: string;
  classNames: string[];
  selectorHint: string;
  documentOrder: number;
  selectionOrder: number;
  outerHtml: string;
  textContent: string;
  beforeSiblingHint?: string;
  afterSiblingHint?: string;
};
```

### 9.2 선택 상태 정책

- 페이지 이동 시 현재 개체 선택 해제
- student mode 전환 시 선택 해제
- 페이지 재렌더링 시 target을 selector와 구조 hint로 재해결
- target 재해결 실패 시 선택에서 제거
- AI 실행 중에도 선택은 유지 가능
- AI 후보 적용 후 선택 해제

---

## 10. 페이지 Command 모델

```ts
type EditorCommand =
  | {
      type: "UPDATE_PAGE_HTML";
      pageId: string;
      beforeHtml: string;
      afterHtml: string;
      source: "manual" | "toolbar" | "image" | "table";
    }
  | {
      type: "APPLY_AI_PAGE_CHANGE";
      pageId: string;
      beforeHtml: string;
      afterHtml: string;
      scope: "text" | "objects" | "page";
      targetIds: string[];
      providerId: string;
      runId: string;
    }
  | {
      type: "INSERT_PAGE";
      index: number;
      page: Page;
    }
  | {
      type: "DELETE_PAGE";
      pageId: string;
      deletedPage: Page;
      previousIndex: number;
    }
  | {
      type: "DUPLICATE_PAGE";
      sourcePageId: string;
      newPage: Page;
      index: number;
    }
  | {
      type: "MOVE_PAGE";
      pageId: string;
      fromIndex: number;
      toIndex: number;
    }
  | {
      type: "SET_PAPER";
      before: Paper;
      after: Paper;
    };
```

AI가 개체만 수정하더라도 command에는 변경 전·후 페이지 HTML 전체를 저장한다.

이유:

- 단순한 undo/redo
- target 구조 변화 대응
- 다중 개체 추가·삭제·병합 대응
- manifest 단순성 유지

---

## 11. AI 수정 범위

### 11.1 텍스트 선택

사용자가 Range로 텍스트 일부를 선택한다.

```text
선택 텍스트
→ AI 요청
→ replacementHtml 또는 replacementText
→ Range 교체
→ 페이지 HTML command
```

제한:

- 하나의 페이지 내부 Range만 지원
- 여러 개의 분리된 Range는 지원하지 않음
- Page Shell을 가로지르는 선택 금지
- 선택이 표 셀 여러 개를 가로지르면 개체 선택 사용 안내

### 11.2 단일 개체

예:

- 문항 표현 변경
- 표 단순화
- 이미지 설명 수정
- 답란 크기와 구조 변경

### 11.3 복수 개체

여러 개체를 하나의 수정 맥락으로 전달한다.

```text
문항 1, 문항 2, 문항 3 선택
→ “세 문항을 하나의 단계형 활동으로 바꿔줘”
```

```text
이미지 + 캡션 + 질문 선택
→ “이미지를 중심으로 관찰 질문을 다시 구성해줘”
```

AI는 선택 개체 수와 다른 수의 결과 개체를 반환할 수 있다.

```text
3개 문항 → 1개 통합 활동
1개 표 → 표 + 설명문
2개 문단 → 3단계 안내문
```

따라서 응답은 target별 1:1 replacement를 강제하지 않는다.

### 11.4 현재 페이지 전체

선택된 개체가 없거나 사용자가 `현재 페이지 전체`를 명시하면 `.page-content` 전체 후보를 생성한다.

---

## 12. AI 요청 계약

```json
{
  "schemaVersion": 2,
  "runId": "run-...",
  "providerId": "openai-codex",
  "docName": "미디어활동지",
  "baseRevision": 12,
  "pageId": "page-6d03cfad",
  "pageVersion": "sha256:...",
  "scope": "objects",
  "instruction": "선택한 세 문항을 하나의 단계형 활동으로 바꿔줘.",
  "page": {
    "role": "activity",
    "contentHtmlFile": "current-page.html",
    "screenshotFile": "current-page.png"
  },
  "selection": {
    "targets": [
      {
        "targetId": "target-a",
        "type": "question-box",
        "tagName": "div",
        "classNames": ["question-box"],
        "documentOrder": 3,
        "selectionOrder": 1,
        "outerHtmlFile": "targets/target-a.html",
        "textContent": "..."
      },
      {
        "targetId": "target-b",
        "type": "question-box",
        "tagName": "div",
        "classNames": ["question-box"],
        "documentOrder": 4,
        "selectionOrder": 2,
        "outerHtmlFile": "targets/target-b.html",
        "textContent": "..."
      }
    ],
    "firstTargetId": "target-a",
    "lastTargetId": "target-b",
    "contiguous": true
  },
  "contextFile": "page-context.json",
  "styleFile": "style-context.css",
  "output": {
    "responseFile": "response.json",
    "candidateFile": "candidate.html"
  }
}
```

### 12.1 scope 값

```text
text
objects
page
```

단일 개체와 복수 개체는 모두 `objects`를 사용한다.

### 12.2 인접성

```json
{
  "contiguous": false,
  "unselectedObjectCountBetweenTargets": 2
}
```

AI는 비연속 선택일 때 선택되지 않은 중간 내용을 임의로 변경하면 안 된다.

---

## 13. AI 응답 계약

### 13.1 통합 candidate 방식

AI는 선택 개체 수와 무관하게 수정 후 페이지 전체의 `contentHtml` 후보를 생성한다.

`candidate.html`:

```html
<!-- 수정이 반영된 전체 page-content HTML -->
```

`response.json`:

```json
{
  "schemaVersion": 2,
  "runId": "run-...",
  "providerId": "openai-codex",
  "pageId": "page-6d03cfad",
  "basePageVersion": "sha256:...",
  "scope": "objects",
  "targetIds": ["target-a", "target-b"],
  "candidateFile": "candidate.html",
  "summary": "세 문항을 하나의 단계형 활동으로 통합했습니다.",
  "changedTargetSummary": [
    "문항 1~3을 한 활동으로 통합",
    "단계 번호와 답란 재구성"
  ],
  "warnings": []
}
```

### 13.2 전체 page-content 후보를 쓰는 이유

- 여러 개체를 하나로 병합
- 한 개체를 여러 개체로 분리
- 선택 개체 사이 구조 재배치
- 목록과 표의 조합 변경
- 인접 형제 요소의 wrapper 조정

AI는 선택되지 않은 내용을 가능한 한 그대로 유지해야 한다.

### 13.3 선택되지 않은 내용 보호

서버는 요청 전후 DOM을 비교해 선택 범위 밖 변경을 탐지한다.

```text
선택 밖 변경 없음
→ 정상

선택 밖 사소한 정규화
→ 경고

선택 밖 의미 있는 변경
→ 강한 경고 또는 차단
```

MVP 정책:

- Page Shell 변경: 차단
- 다른 페이지 변경: 차단
- 선택 밖 의미 있는 텍스트 삭제: 차단
- 선택 밖 class/style 조정: 경고
- 선택 주변 wrapper 변경: 경고
- 선택 개체 재배치에 필요한 인접 구조 변경: 경고

---

## 14. AI 공급자

필수 provider:

```text
google-antigravity
openai-codex
anthropic-claude
```

UI 표시:

```text
Gemini · Antigravity
Codex
Claude Code
```

### 14.1 공통 포트

```ts
interface AiProviderAdapter {
  readonly id: string;
  readonly displayName: string;

  probe(): Promise<ProviderCapability>;
  buildInvocation(input: ProviderInvocationInput): Promise<ProviderInvocation>;
  spawn(
    invocation: ProviderInvocation,
    handlers: ProviderProcessHandlers
  ): Promise<ProviderProcess>;
  normalizeExit(result: ProviderProcessResult): Promise<ProviderExitResult>;
}
```

### 14.2 Antigravity

- `agy` CLI 사용
- Antigravity GUI 자동화 금지
- one-shot 비대화형 모드
- run directory 안에서만 작업
- 인증 정보 직접 읽기 금지

### 14.3 Codex

- `codex exec` 사용
- 기존 ChatGPT/Codex 인증 재사용
- stdout을 최종 결과로 파싱하지 않음
- `response.json`, `candidate.html`을 결과로 사용

### 14.4 Claude Code

- `claude -p` 사용
- 비대화형 실행
- `CLAUDECODE` 환경변수 제거
- run directory에 작업 범위 제한
- 위험한 permission bypass를 기본값으로 사용하지 않음

### 14.5 fallback

기존 `.ai-bridge` 파일 큐를 fallback provider로 유지한다.

---

## 15. AI Run 디렉터리

```text
worksheets/<docName>/.worksheet-grab/ai-runs/<runId>/
├─ request.json
├─ prompt.md
├─ current-page.html
├─ current-page.png
├─ page-context.json
├─ style-context.css
├─ targets/
│  ├─ target-a.html
│  ├─ target-b.html
│  └─ target-c.html
├─ assets/
├─ response.schema.json
├─ response.json
├─ candidate.html
├─ candidate-page.html
├─ candidate-page.png
├─ candidate-page.pdf
└─ run.log
```

AI 프로세스는 원본 manifest와 저장된 teacher/student HTML에 쓰기 권한을 갖지 않는다.

---

## 16. 후보 검수 정책

### 16.1 적용 차단

- script, iframe, object, embed
- event handler
- javascript URL
- Page Shell 손상
- 다른 페이지 수정
- 정답 누출
- 허용되지 않은 원격 이미지
- run 디렉터리 밖 asset 경로
- candidate HTML 파싱 실패
- 응답 schema 불일치
- 선택 밖 의미 있는 내용 삭제
- 빈 페이지 생성

### 16.2 경고 후 적용 가능

- 페이지 넘침
- 표 너비 초과
- 최소 글자 크기 미달
- 선택 밖 style/class 조정
- 개체 간 간격 변화
- 이미지 크기 변화
- 선택 개체 주변 wrapper 변화
- 시각적 불균형
- 페이지 밀도 변화

### 16.3 사용자 메시지

```text
AI 수정안에 레이아웃 경고가 있습니다.

- 페이지 하단이 인쇄 영역을 12mm 초과합니다.
- 표 너비가 본문 영역을 벗어납니다.

[그래도 적용] [수정안 폐기] [다시 생성]
```

---

## 17. 비교 UI

### 17.1 전체 페이지 비교

개체 수정이라도 기존 페이지와 후보 페이지 전체를 나란히 보여준다.

```text
기존 페이지 | AI 수정안
```

### 17.2 변경 대상 강조

- 기존 선택 개체 outline
- 후보에서 변경된 개체 outline
- 선택 밖 변경 감지 badge
- 레이아웃 경고 badge

### 17.3 변경 요약

```text
선택한 개체: 3개

변경 요약
- 문항 1~3을 하나의 단계형 활동으로 통합
- 단계 번호 추가
- 답란 높이 재배치

선택 밖 변경
- 질문 박스 바깥 여백 4mm 증가
```

### 17.4 적용

```js
session.dispatch({
  type: "APPLY_AI_PAGE_CHANGE",
  pageId,
  beforeHtml,
  afterHtml: candidateHtml,
  scope: "objects",
  targetIds,
  providerId,
  runId
});
```

---

## 18. 편집 도구 요구사항

After 편집기는 기능을 축소하지 않는다.

### 18.1 상단 기본 툴바

- 글꼴
- 글자 크기
- 굵게
- 기울임
- 밑줄
- 글자색
- 배경색
- 왼쪽·가운데·오른쪽 정렬
- 줄 간격
- 순서 목록
- 비순서 목록
- 들여쓰기
- 링크
- 구분선
- 정답 표시
- 답란 삽입
- 표 삽입
- 이미지 삽입
- 실행 취소
- 다시 실행

### 18.2 문맥형 개체 툴바

표:

- 행 추가·삭제
- 열 추가·삭제
- 셀 배경
- 셀 정렬
- 표 너비
- AI 수정

이미지:

- 교체
- 크기
- 정렬
- alt
- 캡션
- AI 수정

복수 선택:

- AI 수정
- 묶음 복제
- 위로·아래로 이동
- 프리셋 저장
- 삭제

### 18.3 페이지 도구

- 페이지 추가
- 복제
- 삭제
- 이동
- 역할 변경
- AI로 페이지 전체 수정
- 학생용 미리보기
- 정밀 미리보기
- PDF 내보내기

---

## 19. HTML 정규화

저장 및 AI 후보 적용 전에 정규화한다.

- `<b>` → `<strong>`
- `<i>` → `<em>`
- `<font>` 제거
- 빈 span 제거
- 인접 동일 span 병합
- runtime data attribute 제거
- `.answer`, `.plot-ans` 보존
- 표 구조 보존
- asset 상대경로 보존
- 이미지 mm 크기 보존

`execCommand`는 최종 완료 시 제거하고 Selection/Range 기반 구현으로 전환한다.

---

## 20. 저장과 revision

저장 입력은 EditorSession manifest다.

```json
{
  "baseRevision": 12,
  "manifest": {}
}
```

모든 저장은 `SaveDocument`를 통과한다.

- history snapshot
- teacher HTML 생성
- student HTML 생성
- 정답 누출 검사
- `meta.unsafe`
- revision 증가

revision 충돌 시 `409`를 반환하고 자동 덮어쓰지 않는다.

---

## 21. Undo/Redo

- 최대 100 command
- 타이핑 800ms 병합
- AI 수정 1회 = command 1개
- 복수 개체 AI 수정도 페이지 command 1개
- 이미지 resize는 pointerup 시 command 1개
- 페이지 이동·삭제·복제 각각 command 1개

브라우저 native undo를 최종 시스템으로 사용하지 않는다.

---

## 22. 클라이언트 모듈 구조

```text
src/editor/
  main.js

  core/
    EditorSession.js
    CommandBus.js
    History.js
    EventEmitter.js
    SelectionState.js

  model/
    normalizeEditableManifest.js
    migrateManifest.js
    documentReducer.js
    pageIds.js
    pageHash.js
    selectors.js

  canvas/
    CanvasController.js
    PageRenderer.js
    PageEditor.js
    ObjectSelectionController.js
    ObjectResolver.js
    SelectionOverlay.js
    StudentPreview.js

  formatting/
    ToolbarController.js
    selection.js
    inlineMarks.js
    blockStyles.js
    normalizeHtml.js
    tables.js

  features/
    ai/
      AiPageController.js
      AiTargetBuilder.js
      AiProviderSelector.js
      AiRunClient.js
      AiComparePanelView.js
      AiRunProgressView.js
    answers/
    images/
    presets/
    validation/
    preview/
    export/
    paper/
    pages/

  api/
    EditorApi.js
```

---

## 23. 서버 모듈 구조

```text
src/adapters/
  editor-server/
    createEditorServer.js
    routes/
      shell.js
      document.js
      assets.js
      presets.js
      ai-providers.js
      ai-page-runs.js
      paper.js
      preview.js
      export.js

  ai/
    AiProviderAdapter.js
    ProviderRegistry.js
    ProviderProbeCache.js
    RunDirectory.js
    RunStore.js
    SubprocessRunner.js
    LogRedactor.js

    antigravity/
      AntigravityAdapter.js
      AntigravityProbe.js

    codex/
      CodexAdapter.js
      CodexProbe.js

    claude/
      ClaudeCodeAdapter.js
      ClaudeCodeProbe.js

    queue/
      QueueAiAdapter.js
```

---

## 24. 마이그레이션 단계

### Phase 0 — 회귀 테스트

- 기존 직접 편집
- 저장·재열기
- 정답 표시
- 이미지
- 표
- 프리셋
- AI bridge
- student preview
- PDF export

### Phase 1 — 페이지 schema와 EditorSession

- schema v2
- stable page ID
- legacy block page → contentHtml migration
- page command
- direct session save

### Phase 2 — 페이지 편집 경계

- body contenteditable 제거
- 현재 `.page-content`만 편집
- Page Shell 보호
- page boundary keyboard guard

### Phase 3 — 개체 선택

- selectable object 규칙
- hover outline
- 단일 선택
- Shift/Ctrl/Cmd 복수 선택
- 선택 순번
- SelectionState
- 개체 문맥 툴바

### Phase 4 — 텍스트·개체 AI 요청 계약

- scope: text / objects / page
- target builder
- target files
- page candidate response
- 선택 밖 변경 탐지

### Phase 5 — 공통 AI 실행 기반

- provider adapter
- run directory
- run state
- timeout
- cancel
- log redaction
- capability UI

### Phase 6 — 공급자 구현

1. Claude Code
2. Codex
3. Antigravity
4. Queue fallback

순서는 개발 환경에 따라 바꿀 수 있다.

### Phase 7 — 비교·검수·적용

- 전체 페이지 비교
- 변경 대상 강조
- 차단 오류
- 경고 후 적용
- `APPLY_AI_PAGE_CHANGE`
- undo

### Phase 8 — 편집 도구 리팩토링

- Range toolbar
- 표 도구
- 이미지 도구
- answer tool
- execCommand 제거

### Phase 9 — 서버 분리와 레거시 제거

- route 분리
- God Object 제거
- block resync 제거
- slot/index AI 신규 경로 제거
- bbox selection 미도입 확인

---

## 25. 수용 기준

### 페이지 기반 구조

- 모든 페이지에 안정적인 ID가 있다.
- body 전체가 contenteditable이 아니다.
- `.page-content`만 편집할 수 있다.
- Page Shell은 편집으로 손상되지 않는다.
- 저장이 block 역직렬화에 의존하지 않는다.

### 개체 선택

- 단일 개체 선택이 가능하다.
- Shift/Ctrl/Cmd로 복수 선택이 가능하다.
- 비연속 개체를 선택할 수 있다.
- 선택 순번과 개체 수가 UI에 표시된다.
- 선택 상태는 저장 HTML에 남지 않는다.
- 페이지 이동 시 선택이 정리된다.

### AI 수정

- 텍스트 선택 AI 수정이 가능하다.
- 단일 개체 AI 수정이 가능하다.
- 복수 개체 AI 수정이 가능하다.
- 페이지 전체 AI 수정이 가능하다.
- bbox 기반 자유 영역 선택은 존재하지 않는다.
- AI는 전체 page-content 후보를 반환한다.
- 선택되지 않은 내용의 의미 있는 변경을 탐지한다.
- 적용 전 전체 페이지 비교가 가능하다.
- 적용 후 undo가 가능하다.

### 검수 정책

- 보안 오류는 적용 차단
- 정답 누출은 적용 차단
- Page Shell 손상은 적용 차단
- 다른 페이지 수정은 적용 차단
- 레이아웃 넘침은 경고 후 적용 가능
- 디자인 어긋남은 사용자 판단
- 경고 메시지가 구체적이다.

### 공급자

- Gemini·Antigravity
- Codex
- Claude Code

세 공급자가 UI의 1급 선택지다.

- 설치 상태 감지
- 로그인 오류 구분
- timeout
- 취소
- fake CLI contract test
- 원본 workspace 불변

### 편집 도구

- 기존 주요 편집 도구가 유지된다.
- 표·이미지·정답 문맥 툴바가 제공된다.
- 복수 선택 개체 툴바가 제공된다.
- 학생용 미리보기와 PDF export가 유지된다.

---

## 26. 구현 금지사항

- block manifest 재도입
- 문항별 영구 ID 강제
- bbox 자유 영역 선택
- Antigravity GUI 자동화
- AI 원본 manifest 직접 수정
- stdout 자연어 정규식 파싱
- AI 결과 자동 적용
- 레이아웃 경고를 모두 오류로 차단
- 선택 밖 의미 있는 내용 삭제 허용
- provider 로직을 editor.js에 직접 작성
- 공급자별 거대한 switch 문
- API key 입력 UI
- 위험한 permission bypass 기본 활성화
- 매 타이핑마다 전체 문서 재렌더링
- 브라우저 native undo 의존
- 테스트 완화로 회귀 숨기기

---

## 27. 권장 커밋 단위

1. `test(editor): lock current editing and ai bridge behavior`
2. `feat(manifest): add page-based editable schema`
3. `feat(editor-core): add EditorSession and page commands`
4. `refactor(editor-canvas): protect page shell and page-content`
5. `feat(editor-selection): add selectable object resolver`
6. `feat(editor-selection): add multi-object selection`
7. `feat(ai-contract): add text objects and page scopes`
8. `feat(ai-core): add isolated run and provider adapter`
9. `feat(ai-claude): add Claude Code adapter`
10. `feat(ai-codex): add Codex adapter`
11. `feat(ai-antigravity): add Antigravity adapter`
12. `feat(ai-review): add page candidate compare and guard`
13. `feat(ai-review): detect out-of-selection changes`
14. `feat(ai): add queue fallback adapter`
15. `refactor(toolbar): replace execCommand`
16. `refactor(editor-server): split editor routes`
17. `chore(editor): remove block resync and legacy ai target paths`
18. `test(editor): complete Editor 2.1 regression gates`
19. `docs(editor): document page and multi-object ai architecture`

---

## 28. Definition of Done

다음 종단 흐름이 성공해야 한다.

```text
활동지 열기
→ 페이지 선택
→ 텍스트 직접 수정
→ 표 편집
→ 이미지 편집
→ 단일 개체 선택
→ AI 수정안 생성
→ 비교
→ 적용
→ undo

→ 복수 개체 선택
→ AI 수정안 생성
→ 선택 밖 변경 확인
→ 레이아웃 경고 확인
→ 그래도 적용
→ undo

→ 페이지 전체 AI 수정
→ 비교
→ 적용

→ 저장
→ 재열기
→ 학생용 미리보기
→ 정밀 미리보기
→ PDF 내보내기
```

세 공급자 각각에서 다음이 확인되어야 한다.

```text
Gemini · Antigravity
Codex
Claude Code
```

추가 조건:

- 적용 전 원본 workspace hash 불변
- runtime selection attribute 저장 안 됨
- Page Shell 불변
- 정답 누출 없음
- AI 적용 후 페이지 command 1개 생성
- 레이아웃 경고 후보 적용 가능
- 보안·정답·구조 오류 후보 적용 불가
- provider가 없어도 모든 비AI 기능 정상 동작

---

## 29. 최종 제품 결정

```text
문서 상태 단위
= 페이지

저장 단위
= 페이지 contentHtml

직접 편집 단위
= 현재 페이지의 page-content

AI 수정 단위
= 텍스트 / 단일 개체 / 복수 개체 / 현재 페이지

AI 결과 적용 단위
= 페이지 HTML command

개체 모델
= runtime DOM selection

영구 block schema
= 사용하지 않음

bbox 선택 영역
= 사용하지 않음
```

가장 중요한 설계 문장:

> 페이지는 저장과 상태 관리의 최소 단위로 유지하되, AI 수정 요청은 선택한 텍스트, 단일 개체, 복수 개체 또는 현재 페이지 전체를 대상으로 할 수 있다.

---

## 30. Claude Code 첫 실행 지시

첫 작업에서는 Phase 0부터 Phase 3까지만 수행한다.

공급자 실행과 AI 응답 적용은 아직 구현하지 않는다.

코드 수정 전 다음을 보고한다.

1. 현재 편집기에서 페이지와 block이 결합된 지점
2. 페이지 schema migration 경로
3. EditorSession과 page command 설계
4. selectable object 판정 규칙
5. 복수 선택 키보드·마우스 UX
6. 선택 상태가 저장 HTML에 남지 않게 하는 방식
7. 기존 편집 기능 회귀 테스트 계획
8. Phase 4 이후 AI target contract와 연결될 지점

Phase 0~3의 테스트가 통과한 뒤에만 AI request contract와 provider adapter 구현을 시작한다.
