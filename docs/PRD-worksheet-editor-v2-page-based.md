# 폐기된 대안 B 기록: Worksheet Editor 2.0 HTML 페이지 모델

> **상태: REJECTED / 구현 금지.** 2026-07-26 GJC 검토 결과, 이 문서는
> `pages[{id, role, contentHtml}]`을 채택하는 B 대안의 과거 설계 기록으로만 보존한다.
> 현재 Editor v4와 실제 교사 사용 맥락에는 Canva·Google Slides식 개체 캔버스가 더
> 적합하므로 유일한 실행 정본은
> [`PRD-worksheet-editor-v2-page-object-canvas.md`](./PRD-worksheet-editor-v2-page-object-canvas.md)다.
> 아래의 `contentHtml` 저장 모델, `EditorSession` 전환, 영구 개체 모델 폐기 및 단계 계획은
> 어떤 구현·검수 기준으로도 사용하지 않는다.

## 0. 문서 정보

- **프로젝트:** worksheet-grab
- **대상 저장소:** `pblsketch/worksheet-grab`
- **문서 상태:** Rejected Alternative B
- **우선순위:** P0
- **대상 버전:** Editor 2.0
- **핵심 결정:** 블록이 아니라 **페이지를 편집·저장·AI 재생성의 최소 단위**로 사용한다.
- **주요 대상:** `src/editor/`, `EditorHttpServer`, 편집용 manifest 정규화 경계
- **보존 대상:** 생성 엔진, 학생용·교사용 분기, 정답 누출 게이트, 워크스페이스, Chrome 렌더링, PDF 내보내기

---

## 1. 요약

현재 `worksheet-grab` 편집기는 teacher iframe의 문서 전체를 `contenteditable`로 열고, 저장할 때 `.sheet`와 `.wg-block`을 다시 순회하여 manifest를 복원한다. 이 방식은 빠르게 기능을 구현하는 데에는 효과적이었지만, 브라우저가 DOM 구조를 임의로 변경할 수 있어 페이지·블록 경계 손상, 저장 불일치, 기능 간 상태 충돌이 발생하기 쉽다.

Editor 2.0에서는 블록을 편집기의 핵심 모델로 사용하지 않는다. 각 활동지 페이지를 다음과 같은 독립 편집 단위로 관리한다.

```text
Document
 ├─ metadata
 ├─ paper
 └─ pages[]
      ├─ id
      ├─ role (선택)
      └─ contentHtml
```

페이지의 용지 구조, 머리말, 꼬리말, 페이지 번호는 편집할 수 없는 공통 **Page Shell**로 렌더링한다. 교사와 AI가 수정하는 대상은 각 페이지의 `page-content` 영역이다.

AI 수정은 작은 블록을 찾아 바꾸는 방식이 아니라, 사용자가 선택한 페이지의 현재 내용과 수정 지시를 전달하고 **해당 페이지의 본문 전체를 다시 생성**하는 방식으로 구현한다. 결과는 자동 적용하지 않고 변경 전·후 미리보기를 거쳐 사용자가 승인할 때만 반영한다.

---

## 2. 배경과 문제 정의

### 2.1 현재 구조

현재 편집 흐름은 다음과 같다.

```text
manifest
  → 활동지 HTML 조립
  → teacher iframe 로드
  → body 전체 contenteditable
  → 사용자가 DOM 직접 수정
  → .sheet / .wg-block 재탐색
  → manifest.pages 역동기화
  → SaveDocument 저장
```

현재 구현에는 다음 문제가 있다.

1. `body.contentEditable = true`로 인해 페이지 및 블록 래퍼가 삭제되거나 병합될 수 있다.
2. 편집 세션의 실제 원본이 manifest가 아니라 iframe DOM이 된다.
3. 저장 시 DOM 구조를 다시 해석해야 하므로 구조 손실 복구 로직이 필요하다.
4. AI, 이미지, 프리셋, 정답 마크, 용지 변경이 서로 다른 방식으로 DOM과 상태를 변경한다.
5. `editor.js`가 캔버스, 저장, 검수, 이미지, 프리셋, AI, 미리보기, export를 모두 조정한다.
6. `execCommand`가 생성하는 HTML이 브라우저마다 달라질 수 있다.
7. 작은 기능 추가가 저장, 선택, 미리보기, 학생용 파생에 연쇄 영향을 줄 수 있다.

### 2.2 블록 모델을 채택하지 않는 이유

Editor 2.0의 핵심 사용자 경험은 다음과 같다.

```text
AI가 활동지 생성
→ 교사가 페이지 안의 내용을 직접 수정
→ 문제가 있는 페이지 선택
→ AI에 페이지 수정 요청
→ 페이지 전체 재생성 결과 비교
→ 적용 또는 취소
```

이 경험에서는 문항별 영구 ID, 블록별 이동, 블록별 AI 재작성, 블록별 성취기준 관리가 필수적이지 않다. 완전한 블록 모델을 도입하면 다음 복잡성이 증가한다.

- 블록 스키마 설계
- 블록 ID와 위치 관리
- 임의 HTML을 블록으로 분해하고 복원
- 블록별 AI 응답 재부착
- 블록 경계 손상 복구
- 블록 기반 undo 및 선택 상태
- 생성 엔진과 편집기의 블록 계약 유지

따라서 Editor 2.0 MVP에서는 페이지를 유일한 구조 단위로 사용한다. 페이지 내부 HTML은 정규화와 보안 검사를 거치는 **불투명한 자유 HTML**로 취급한다.

---

## 3. 제품 비전

교사는 AI가 생성한 활동지를 페이지 단위로 열어 자연스럽게 수정하고, 마음에 들지 않는 페이지는 AI에게 다시 디자인하도록 요청할 수 있어야 한다.

편집기는 자유로운 수정 경험을 제공하되 다음 불변식을 자동으로 지켜야 한다.

- 용지 구조와 페이지 경계가 일반 편집으로 삭제되지 않는다.
- 머리말, 꼬리말, 페이지 번호는 AI와 일반 편집의 영향을 받지 않는다.
- 학생용 문서에서는 정답이 물리적으로 제거된다.
- 저장 후 다시 열어도 페이지 순서와 내용이 동일하다.
- AI가 다시 생성한 페이지는 사용자가 승인하기 전까지 원본을 변경하지 않는다.
- 인쇄 결과가 페이지별로 검증 가능하다.
- 잘못된 AI 응답이나 저장 실패로 기존 활동지가 손상되지 않는다.

핵심 원칙은 다음과 같다.

> 페이지의 틀은 시스템이 보호하고, 페이지 본문은 교사와 AI가 자유롭게 편집한다.

---

## 4. 목표

### 4.1 제품 목표

1. 교사가 페이지별 내용을 손실 없이 수정할 수 있다.
2. 선택한 페이지만 AI로 다시 생성할 수 있다.
3. AI 결과를 적용하기 전에 변경 전·후를 비교할 수 있다.
4. 저장 후 다시 열었을 때 페이지 내용과 순서가 동일하다.
5. 학생용 미리보기와 실제 학생용 산출물이 동일한 규칙으로 만들어진다.
6. 페이지 추가, 삭제, 복제, 순서 변경이 안정적으로 동작한다.
7. 편집기의 기능을 독립적인 모듈로 수정하고 테스트할 수 있다.

### 4.2 기술 목표

1. 모든 페이지에 영구 `pageId`를 부여한다.
2. 문서 전체 `contenteditable`을 제거한다.
3. 현재 페이지의 `page-content`만 편집 가능하게 한다.
4. 저장 시 블록 구조를 복원하지 않고 페이지별 `contentHtml`을 저장한다.
5. 브라우저의 `EditorSession`이 현재 편집 상태의 원본이 되게 한다.
6. 문서 변경을 페이지 단위 command로 통일한다.
7. 페이지 단위 undo/redo를 제공한다.
8. AI 요청과 응답을 `pageId` 기준으로 처리한다.
9. `editor.js`와 `EditorHttpServer`의 책임을 기능 단위로 분리한다.
10. 기존 `SaveDocument`, `BuildVariants`, `ValidateWorksheet`, `ExportDocument`를 유지한다.
11. 의존성 0, 빌드 0, 무API 원칙을 유지한다.

---

## 5. 비목표

이번 리팩토링에서는 다음을 구현하지 않는다.

- 문항·블록별 영구 데이터 모델
- 문항 은행
- 블록별 드래그 앤 드롭
- 블록별 난이도·배점·성취기준 관리
- 블록별 AI 재작성
- React, Vue, Svelte 등 프레임워크 도입
- Tiptap, ProseMirror, Lexical, GrapesJS 도입
- 실시간 다중 사용자 공동 편집
- 클라우드 계정과 인증
- 모바일 편집 최적화
- HWP 수준의 고급 표 편집
- 페이지 요소의 자유로운 절대좌표 배치
- LLM API 키를 사용하는 직접 호출
- 활동지 생성 파이프라인 전체 재작성

향후 문항 단위 기능이 필요해지면 페이지 내부에 선택적 `data-section-id`를 추가할 수 있으나, Editor 2.0 MVP의 필수 모델로 사용하지 않는다.

---

## 6. 기존 기능 보존 요구사항

다음 기능은 리팩토링 후에도 유지되어야 한다.

- teacher 편집 모드
- student 읽기 전용 미리보기
- 텍스트 수정
- 굵게, 기울임, 밑줄
- 글자 크기, 글자색, 글꼴, 정렬
- 목록
- 표 삽입
- 정답 표시 및 해제
- 답란 삽입
- 이미지 업로드, 붙여넣기, 드래그 앤 드롭
- 이미지 mm 단위 크기 조절
- 프리셋 저장, 삽입, 숨기기, 복원
- AI 페이지 재생성
- AI 결과 미리보기, 적용, 폐기, 되돌리기
- 페이지 넘침 경고
- 최소 글자 크기 검수
- 학생용 정답 누출 검수
- 용지 프리셋과 고급 용지 설정
- 페이지별 정밀 미리보기
- PDF 내보내기
- revision 및 history 저장
- `meta.unsafe` fail-closed 정책
- Canva 산출 경로
- CLI와 편집기의 동일한 저장·내보내기 코어 사용

---

## 7. 핵심 사용자 시나리오

### 7.1 페이지 내용 직접 수정

1. 교사가 활동지를 연다.
2. 수정할 페이지를 선택한다.
3. 페이지의 `page-content` 영역을 클릭한다.
4. 해당 페이지 본문만 편집 모드가 된다.
5. 교사가 텍스트, 표, 이미지, 정답 마크를 수정한다.
6. 입력은 현재 페이지의 draft HTML에 반영된다.
7. 일정 시간 동안 입력이 없으면 하나의 `UPDATE_PAGE_HTML` command로 확정된다.
8. 저장 시 현재 `EditorSession`의 페이지 manifest가 저장된다.

### 7.2 AI로 페이지 다시 생성

1. 교사가 문제가 있는 페이지를 선택한다.
2. `AI로 이 페이지 수정`을 누른다.
3. 수정 지시를 입력한다.
4. 시스템은 현재 페이지 본문, 페이지 역할, 문서 정보, 앞뒤 페이지의 제한된 맥락을 AI 요청으로 만든다.
5. AI는 `page-content`에 들어갈 HTML만 반환한다.
6. 시스템은 응답을 정제하고 후보 페이지를 별도 sandbox iframe에 렌더링한다.
7. 사용자는 변경 전·후를 비교한다.
8. `적용`을 누르면 현재 페이지의 `contentHtml`이 교체된다.
9. `취소`를 누르면 기존 페이지를 유지한다.
10. 적용 후에도 undo로 이전 페이지를 복원할 수 있다.

### 7.3 페이지 추가·복제·삭제·이동

- 새 페이지 추가 시 새 `pageId`를 생성한다.
- 페이지 복제 시 HTML은 복사하지만 `pageId`는 새로 생성한다.
- 페이지 삭제는 확인 후 수행한다.
- 마지막 페이지 삭제 시 빈 페이지를 하나 유지한다.
- 페이지 순서 변경은 `MOVE_PAGE` command로 수행한다.
- 페이지 번호는 저장된 HTML이 아니라 Page Shell에서 자동 계산한다.

### 7.4 학생용 확인

1. 교사가 정답을 표시한다.
2. student 모드로 전환한다.
3. 현재 EditorSession의 teacher 문서에서 기존 `BuildVariants` 규칙으로 학생용을 파생한다.
4. `.answer`와 `.plot-ans`가 물리적으로 제거된다.
5. student 모드에서는 편집 툴바와 contenteditable이 비활성화된다.

---

## 8. 페이지 기반 문서 모델

### 8.1 권장 manifest 스키마

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

### 8.2 필드 정의

#### `id`

- 문서 내에서 유일한 영구 페이지 식별자
- 페이지 이동, 직접 편집, AI 재생성 후에도 유지
- 페이지 복제 시 새 ID 생성
- 기본 구현은 `crypto.randomUUID()` 사용
- 테스트에서는 ID generator 주입 가능

#### `role`

선택 필드다. AI와 UI가 페이지의 용도를 이해하기 위한 가벼운 메타데이터로 사용한다.

예시:

- `cover`
- `instruction`
- `reading`
- `activity`
- `practice`
- `reflection`
- `rubric`
- `answer-key`
- `custom`

`role`은 페이지 구조를 강제하는 블록 타입이 아니다.

#### `contentHtml`

- Page Shell 내부의 `.page-content`에 삽입되는 HTML
- 페이지 머리말, 꼬리말, 번호, `.sheet` 래퍼를 포함하지 않음
- 정답 마크와 활동지 클래스 포함 가능
- 저장 전 정규화 및 보안 검사 수행

### 8.3 Page Shell

페이지 공통 구조는 manifest에 반복 저장하지 않고 렌더러가 생성한다.

```html
<section class="sheet" data-page-id="page-6d03cfad">
  <header class="run-head">...</header>
  <main class="page-content">...</main>
  <footer class="run-foot">
    <span class="page-number"></span>
  </footer>
</section>
```

다음 요소는 일반 편집과 AI 재생성 대상에서 제외한다.

- `.sheet`
- `.run-head`
- `.run-foot`
- 페이지 번호
- 용지 크기와 여백
- 공통 CSS
- `data-mode`
- 편집기 전용 overlay

---

## 9. 기존 manifest 호환과 마이그레이션

현재 manifest의 페이지는 블록 배열일 수 있다. Editor 2.0은 기존 문서를 읽을 수 있어야 한다.

### 9.1 읽기 정규화

`normalizeEditableManifest()`는 다음 두 형태를 모두 허용한다.

```json
{
  "pages": [
    [
      { "type": "question", "html": "..." },
      { "type": "answer-space", "html": "..." }
    ]
  ]
}
```

```json
{
  "pages": [
    {
      "id": "page-...",
      "role": "activity",
      "contentHtml": "..."
    }
  ]
}
```

레거시 블록 배열은 기존 조립 규칙을 이용해 한 페이지의 `contentHtml`로 컴파일한다. 편집기 내부에서는 페이지 객체만 사용한다.

### 9.2 저장 마이그레이션

- 레거시 문서를 열기만 해서는 원본을 변경하지 않는다.
- 최초 저장 시 schemaVersion 2 페이지 manifest로 저장한다.
- 저장 직전에 기존 manifest를 history snapshot으로 보존한다.
- 마이그레이션 후에는 편집 경로가 블록 배열로 되돌아가지 않는다.

### 9.3 생성 엔진 호환

기존 생성·compose 엔진은 내부적으로 블록을 사용할 수 있다. 다만 워크스페이스에 문서를 저장할 때 편집 가능한 페이지 manifest로 컴파일한다.

원칙:

```text
생성 단계의 내부 블록 구조 ≠ 편집기의 공개 문서 모델
```

블록은 생성기의 구현 세부사항으로 남을 수 있지만, Editor 2.0은 블록을 식별·편집·저장 단위로 사용하지 않는다.

---

## 10. EditorSession

브라우저 편집기는 iframe DOM이 아니라 `EditorSession`을 편집 상태의 원본으로 사용한다.

```js
{
  manifest,
  revision,
  mode: "teacher",
  activePageId: null,
  editingPageId: null,
  dirty: false,
  dirtyPageIds: new Set(),
  history: {
    undo: [],
    redo: []
  },
  ai: {
    activeRequest: null,
    candidate: null
  },
  preview: {
    status: "idle",
    pageId: null
  }
}
```

### 10.1 EditorSession 책임

- 정규화된 manifest 보관
- revision 보관
- 현재 페이지 선택 상태
- command 실행
- undo/redo 관리
- dirty 상태 관리
- 저장 성공 후 baseline 갱신
- 변경 이벤트 발행
- AI 후보 페이지의 임시 상태 보관

### 10.2 EditorSession 비책임

- HTTP 요청 세부 구현
- 파일 시스템 접근
- Chrome 실행
- AI 파일 큐 읽기·쓰기
- iframe의 세부 DOM 렌더링
- UI 패널 생성

---

## 11. 페이지 Command 모델

모든 의미 있는 문서 변경은 페이지 단위 command로 처리한다.

```ts
type EditorCommand =
  | {
      type: "UPDATE_PAGE_HTML";
      pageId: string;
      beforeHtml: string;
      afterHtml: string;
    }
  | {
      type: "REPLACE_PAGE_HTML";
      pageId: string;
      beforeHtml: string;
      afterHtml: string;
      source: "ai" | "preset" | "manual";
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
      type: "UPDATE_PAGE_META";
      pageId: string;
      before: object;
      after: object;
    }
  | {
      type: "SET_PAPER";
      before: Paper;
      after: Paper;
    };
```

### 11.1 Command 정책

- reducer는 DOM 없이 테스트 가능해야 한다.
- command 실패 시 manifest를 변경하지 않는다.
- 같은 페이지에서 연속된 타이핑은 하나의 undo 단위로 병합한다.
- AI 페이지 교체는 하나의 undo 단위다.
- 이미지 리사이즈는 pointerup 시 하나의 페이지 HTML command로 기록한다.
- 페이지 이동과 삭제는 명시적 command로만 수행한다.

---

## 12. 캔버스와 편집 정책

### 12.1 문서 전체 편집 제거

다음 방식은 제거한다.

```js
doc.body.contentEditable = "true";
```

teacher iframe 전체 문서, `.sheet`, 머리말, 꼬리말은 편집 불가능해야 한다.

### 12.2 페이지 선택과 편집

- 페이지 클릭 시 `activePageId`를 설정한다.
- 선택된 페이지에 편집기 전용 outline을 표시한다.
- 더블 클릭 또는 Enter로 페이지 본문 편집 모드에 진입한다.
- 현재 페이지의 `.page-content`만 `contenteditable="true"`로 전환한다.
- 다른 페이지의 `.page-content`는 편집 불가 상태를 유지한다.
- Escape로 편집 모드를 종료한다.
- student 모드에서는 모든 `contenteditable`을 제거한다.

### 12.3 페이지 경계 보호

- Backspace와 Delete로 `.page-content` 자체를 삭제할 수 없다.
- 커서가 페이지 본문 첫 위치에 있을 때 Backspace를 눌러도 이전 페이지와 병합되지 않는다.
- 커서가 마지막 위치에 있을 때 Delete를 눌러도 다음 페이지와 병합되지 않는다.
- 페이지 사이로 드래그 선택이 넘어가지 않게 한다.
- 붙여넣기 결과가 Page Shell 바깥으로 삽입되지 않게 한다.

### 12.4 편집 확정

- 입력 중에는 해당 페이지 DOM만 갱신한다.
- 800ms 동안 추가 입력이 없거나 편집 모드를 종료하면 페이지 HTML을 정규화한다.
- 정규화 전·후 HTML이 다를 때만 `UPDATE_PAGE_HTML` command를 기록한다.
- 일반 타이핑 중 전체 문서를 다시 렌더링하지 않는다.

---

## 13. HTML 정규화와 보안

페이지의 `contentHtml`은 저장 및 AI 후보 적용 전에 정규화한다.

### 13.1 필수 정규화

- `<b>` → `<strong>`
- `<i>` → `<em>`
- `<font>` 제거 후 `<span style>` 변환
- 빈 `<span>` 제거
- 같은 스타일의 인접 span 병합
- 동일한 중첩 마크 병합
- 불필요한 `contenteditable` 제거
- 편집기 세션용 `data-*` 제거
- 빈 문단과 `<br>` 규칙 통일
- 정답 `.answer`, `.plot-ans` 보존
- `assets/` 상대경로 보존
- mm 단위 이미지 크기 보존
- 표 구조 보존

### 13.2 보안 정제

- `<script>` 제거
- `on*` 이벤트 속성 제거
- `javascript:` URL 제거
- 허용하지 않은 원격 이미지 URL 경고 또는 제거
- iframe, object, embed 등 실행 가능한 외부 콘텐츠 차단
- AI 응답과 외부 붙여넣기에 동일한 sanitizer 적용

### 13.3 금지

- 의미 있는 사용자 class 임의 삭제
- `.answer` class 자동 제거
- table을 일반 div로 변환
- 전체 페이지를 plain text로 변환
- 디자인에 필요한 CSS 변수를 인라인 값으로 임의 치환

---

## 14. 툴바

### 14.1 원칙

툴바는 현재 편집 중인 페이지의 Selection/Range에만 동작한다. manifest, 네트워크, 다른 페이지를 직접 변경하지 않는다.

### 14.2 지원 기능

- 굵게
- 기울임
- 밑줄
- 글자색
- 글자 크기
- 글꼴
- 왼쪽·가운데·오른쪽 정렬
- 순서 있는 목록·없는 목록
- 표 삽입
- 이미지 삽입
- 정답 표시
- 답란 삽입

### 14.3 `execCommand` 제거

신규 구현은 Selection/Range 기반 함수를 사용한다. 마이그레이션 기간 동안 일부 명령에 기존 구현을 임시 유지할 수 있으나 Editor 2.0 완료 시 `execCommand` 호출을 제거한다.

### 14.4 표 정책

Editor 2.0 MVP에서는 다음을 지원한다.

- 표 삽입
- 셀 텍스트 편집
- 행 추가·삭제
- 열 추가·삭제
- 표 전체 삭제
- 셀 정렬
- 셀 배경색

표 구조 변경은 현재 페이지 HTML을 변경한 뒤 하나의 `UPDATE_PAGE_HTML` command로 확정한다.

---

## 15. 이미지 편집

기존 자산 정책을 유지한다.

- PNG, JPEG, GIF, WebP 허용
- SVG 파일 업로드 제외
- 5MB 제한
- 매직바이트 검증
- `assets/` 상대경로
- 경로 이탈 차단
- 기존 파일 덮어쓰기 금지

### 15.1 이미지 선택과 리사이즈

- 이미지 클릭 시 선택 상태 표시
- 리사이즈 핸들은 iframe 외부 overlay 사용
- pointermove 중에는 미리보기만 갱신
- pointerup 시 현재 페이지의 `contentHtml`을 하나의 command로 기록
- 폭은 mm 단위 유지
- 기본 alt는 파일명 stem 사용
- alt가 없으면 검수 경고

---

## 16. 정답 표시와 학생용 파생

기존 `.answer` 및 `.plot-ans` 기반 학생용 물리 제거 정책을 변경하지 않는다.

### 16.1 요구사항

- 정답 표시는 현재 페이지 HTML 변경으로 기록한다.
- 기존 정답 마크 해제 시 확인 절차를 유지한다.
- student 미리보기는 현재 EditorSession manifest에서 teacher HTML을 조립한 뒤 기존 `BuildVariants`로 파생한다.
- 별도의 정규식 기반 학생용 변환을 새로 만들지 않는다.
- student 모드는 편집 불가다.
- 정답 누출 검수는 기존 `ValidateWorksheet`와 `SaveDocument` 정책을 유지한다.

---

## 17. AI 페이지 재생성

### 17.1 요청 흐름

```text
페이지 선택
→ 수정 지시 입력
→ 현재 페이지와 문서 맥락으로 요청 생성
→ 파일 큐에 저장
→ 구독 AI가 처리
→ 후보 페이지 응답
→ sanitizer 및 검수
→ 변경 전·후 미리보기
→ 사용자 적용 또는 폐기
```

### 17.2 요청 스키마

```json
{
  "schemaVersion": 3,
  "id": "req-...",
  "docName": "미디어활동지",
  "baseRevision": 12,
  "pageId": "page-6d03cfad",
  "pageVersion": "sha256-current-page-html",
  "action": "regenerate-page",
  "instruction": "문항 수를 3개로 줄이고 문장 시작 힌트를 추가해줘.",
  "page": {
    "role": "activity",
    "contentHtml": "<div>...</div>"
  },
  "context": {
    "docTitle": "복합양식 자료 평가하며 읽기",
    "subject": "ko",
    "grade": "중학교 2학년",
    "standards": [],
    "paper": {
      "size": "A4",
      "orientation": "portrait"
    },
    "previousPageSummary": "...",
    "nextPageSummary": "...",
    "protectedRules": [
      "page-content 내부 HTML만 반환",
      "정답은 .answer 안에 표시",
      "원격 이미지 URL 사용 금지",
      "Page Shell과 페이지 번호 생성 금지"
    ]
  },
  "status": "pending"
}
```

### 17.3 응답 스키마

```json
{
  "pageId": "page-6d03cfad",
  "basePageVersion": "sha256-current-page-html",
  "contentHtml": "<div class=\"section-title\">...</div>",
  "notes": "문항을 3개로 줄이고 힌트를 추가했습니다."
}
```

### 17.4 AI 응답 규칙

- `page-content`에 들어갈 HTML만 반환한다.
- `<html>`, `<head>`, `<body>`, `.sheet`, 머리말, 꼬리말을 반환하지 않는다.
- 기존 테마 클래스와 CSS 변수를 사용한다.
- 정답은 `.answer` 또는 `.plot-ans` 안에 둔다.
- 원격 이미지 URL을 사용하지 않는다.
- 페이지 폭을 넘는 고정 px 너비를 피한다.
- 성취기준 원문과 보호된 저작권 슬롯을 임의로 수정하지 않는다.

### 17.5 적용 전 충돌 검사

AI 요청 후 사용자가 같은 페이지를 수정했을 수 있다.

- 요청 시 현재 페이지 HTML의 hash를 `pageVersion`으로 저장한다.
- 응답의 `basePageVersion`과 현재 페이지 hash를 비교한다.
- 동일하면 일반 적용 가능하다.
- 다르면 자동 적용하지 않고 “요청 후 페이지가 변경됨”을 표시한다.
- 사용자는 현재 페이지와 AI 후보를 비교해 강제 적용하거나 폐기할 수 있다.
- 자동 병합은 MVP에서 구현하지 않는다.

### 17.6 변경 전·후 비교

필수 UI:

- 기존 페이지 렌더
- AI 후보 페이지 렌더
- AI 메모
- 적용
- 폐기
- 가능하면 텍스트 변경 요약

미리보기 iframe은 sandbox로 실행한다. 후보 HTML은 적용 전에 sanitizer와 최소 검수를 통과해야 한다.

### 17.7 적용

AI 후보 적용은 다음 command 한 개로 처리한다.

```js
{
  type: "REPLACE_PAGE_HTML",
  pageId,
  beforeHtml,
  afterHtml,
  source: "ai"
}
```

적용 후 일반 undo로 이전 페이지를 복원할 수 있다.

---

## 18. 저장과 revision

### 18.1 저장 입력

저장 시 iframe 전체 DOM을 순회하거나 블록을 복원하지 않는다. 현재 `EditorSession.manifest`를 전송한다.

```json
{
  "baseRevision": 12,
  "manifest": {}
}
```

### 18.2 저장 게이트

모든 저장은 기존 `SaveDocument`를 경유한다.

- manifest 저장
- history snapshot
- teacher HTML 생성
- student HTML 조건부 생성
- 정답 누출 검사
- `meta.unsafe` 기록
- revision 증가

편집기 전용 우회 저장 경로를 만들지 않는다.

### 18.3 revision 충돌

외부 CLI가 같은 문서를 변경했을 수 있으므로 optimistic concurrency를 사용한다.

- 클라이언트는 `baseRevision`을 보낸다.
- 서버 revision과 다르면 `409 revision-conflict`를 반환한다.
- 자동 덮어쓰기를 금지한다.
- 사용자는 최신 문서를 다시 불러오거나 현재 편집본을 다른 이름으로 저장할 수 있다.
- 자동 병합은 MVP 범위가 아니다.

### 18.4 저장 실패

- 브라우저의 현재 EditorSession을 유지한다.
- dirty 상태를 해제하지 않는다.
- preview, export, paper 변경을 진행하지 않는다.
- 사용자에게 오류 원인과 재시도 경로를 표시한다.

---

## 19. Undo/Redo

### 19.1 요구사항

- 최대 100개 command 보관
- 같은 페이지에서 800ms 이내 연속 타이핑은 하나의 command로 병합
- AI 페이지 교체는 하나의 command
- 페이지 추가·삭제·복제·이동은 각각 하나의 command
- 이미지 리사이즈는 pointerup 시 하나의 command
- 저장 후에도 현재 브라우저 세션의 undo history는 유지 가능
- 새로고침 후 세밀한 command history는 초기화
- 저장 revision 복원은 기존 `doc restore`가 담당

### 19.2 구현 원칙

- 브라우저 `execCommand("undo")`를 최종 undo 시스템으로 사용하지 않는다.
- 매 키 입력마다 전체 문서 snapshot을 저장하지 않는다.
- page command는 필요한 페이지만 before/after HTML을 보관한다.

---

## 20. 프리셋

블록 프리셋 개념을 페이지 기반 모델에 맞게 단순화한다.

### 20.1 MVP 정책

기존 프리셋은 페이지 안에 삽입할 수 있는 HTML 조각으로 유지할 수 있다. 다만 프리셋은 편집기의 핵심 데이터 단위가 아니다.

- 현재 커서 위치에 HTML 조각 삽입
- 삽입 후 현재 페이지의 HTML command 생성
- 프리셋 저장 시 현재 선택 영역 또는 현재 페이지의 선택된 HTML을 정규화
- 정답 포함 프리셋 허용
- 프리셋 미리보기는 기본적으로 학생용 물리 제거본 사용

### 20.2 페이지 프리셋

선택적으로 전체 페이지를 프리셋으로 저장할 수 있다.

```json
{
  "kind": "page",
  "name": "읽기 자료 + 확인 문항",
  "role": "reading",
  "contentHtml": "..."
}
```

전체 페이지 프리셋 삽입은 `INSERT_PAGE`로 처리한다.

---

## 21. 페이지 관리 UI

### 필수 기능

- 페이지 썸네일 또는 페이지 목록
- 현재 페이지 선택 표시
- 페이지 추가
- 페이지 복제
- 페이지 삭제
- 페이지 순서 변경
- 페이지 역할 변경
- AI 페이지 재생성
- 페이지별 정밀 미리보기

### 정책

- 페이지 순서 변경 시 page ID 유지
- 페이지 번호는 자동 재계산
- 삭제 전 확인
- 마지막 페이지 삭제 시 빈 페이지 자동 생성
- 페이지 복제 시 새 ID 생성
- page role은 UI 필터와 AI 맥락에만 사용하며 레이아웃을 강제하지 않음

---

## 22. 검수와 인쇄 예고

기존 `ValidateWorksheet`와 Chrome 렌더러를 유지한다.

### 22.1 실시간 검수

- 입력 debounce: 300ms 이상
- EditorSession manifest로 teacher HTML 조립
- 필요할 때 student HTML 파생
- 정답 누출
- 최소 글자 크기
- 하드코딩 교과색
- 원격 이미지
- 이미지 alt 누락
- 페이지 넘침 예측
- 유효하지 않은 table 구조

### 22.2 화면 예고와 최종 판정

- 브라우저 화면은 고정밀 예측기
- Chrome PDF/PNG는 최종 판정
- 페이지별 exact preview 유지
- dirty 상태이면 preview 전에 저장
- 저장 실패 시 preview 중단
- AI 후보는 적용 전 빠른 브라우저 예고를 제공하고, 선택적으로 exact preview를 요청할 수 있음

---

## 23. 클라이언트 모듈 구조

```text
src/editor/
  main.js

  core/
    EditorSession.js
    CommandBus.js
    History.js
    EventEmitter.js

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
    PageSelection.js
    GuidesOverlay.js
    StudentPreview.js

  formatting/
    ToolbarController.js
    selection.js
    inlineMarks.js
    blockStyles.js
    normalizeHtml.js
    tables.js

  features/
    answers/AnswerController.js
    images/ImageController.js
    presets/PresetController.js
    ai/AiPageController.js
    validation/ValidationController.js
    preview/PreviewController.js
    export/ExportController.js
    paper/PaperController.js
    pages/PageManagerController.js

  api/
    EditorApi.js

  ui/
    BannerView.js
    StatusView.js
    ToolbarView.js
    PageNavigatorView.js
    AiComparePanelView.js
    PreviewPanelView.js
```

### `main.js` 책임

- 의존 객체 조립
- 초기 문서 로드
- controller mount
- 최상위 오류 처리

`main.js`에 도메인 로직, AI 폴링 세부 로직, 저장 직렬화 로직을 넣지 않는다.

---

## 24. 서버 모듈 구조

```text
src/adapters/editor-server/
  createEditorServer.js
  http.js

  routes/
    shell.js
    document.js
    assets.js
    presets.js
    ai.js
    paper.js
    preview.js
    export.js
```

### 요구사항

- Node 표준 `http` 유지
- 외부 라우터 패키지 도입 금지
- `createEditorServer`는 라우팅과 공유 의존성 조립만 담당
- 저장, AI, 이미지, 프리셋, 미리보기, export를 별도 route로 분리
- 기존 URL은 가능한 한 유지
- migration 기간에는 기존 `/save` 및 AI v1/v2 읽기 호환 유지
- 신규 AI 페이지 요청은 schemaVersion 3 사용

---

## 25. 마이그레이션 단계

### Phase 0 — 기능 동결과 회귀 테스트

새 기능 추가를 중단하고 현재 동작을 characterization test로 고정한다.

필수 테스트:

- 한글 조합 입력
- 페이지 텍스트 수정 후 저장·재열기
- 페이지 시작·끝에서 Backspace/Delete
- 여러 페이지를 가로지르는 선택 차단
- 표 셀 편집
- 외부 HTML 붙여넣기
- 정답 표시와 해제
- 이미지 삽입·리사이즈
- 프리셋 삽입
- 학생용 즉시 미리보기
- 용지 변경
- 페이지별 정밀 미리보기
- PDF 내보내기
- unsafe 저장
- revision 충돌

### Phase 1 — 페이지 manifest와 ID

- schemaVersion 2 도입
- `pageId`, `role`, `contentHtml` 도입
- 레거시 블록 페이지를 page content로 컴파일하는 정규화기 추가
- AssembleWorksheet가 두 manifest 형태를 읽도록 지원
- 최종 인쇄 결과 불변 테스트

### Phase 2 — EditorSession과 페이지 command

- `baseManifest`, revision, dirty 상태를 EditorSession으로 이동
- page reducer와 History 추가
- 저장 요청을 EditorSession manifest 기반으로 전환
- 기존 `serializeSheets`는 fallback으로만 유지

### Phase 3 — 페이지 단위 편집

- `body.contentEditable` 제거
- 현재 페이지의 `.page-content`만 편집
- 페이지 경계 보호
- 저장 시 `.page-content`의 HTML만 반영
- 정상 경로에서 `.wg-block` 탐색 및 leftover 복구 제거

### Phase 4 — AI 페이지 재생성

- schemaVersion 3 page 요청·응답 추가
- page hash 충돌 검사
- 변경 전·후 미리보기
- 적용·폐기·undo
- 기존 AI v1/v2 읽기 호환 유지

### Phase 5 — Range 툴바와 HTML 정규화

- `execCommand` 순차 제거
- sanitizer 및 normalizer 통합
- 표 구조 도구 추가
- 브라우저별 HTML 결과 테스트

### Phase 6 — 기능 모듈 분리

- 정답
- 이미지
- 프리셋
- AI
- 검수
- 페이지 관리
- 용지
- 미리보기
- export

각 기능을 controller로 이동한다.

### Phase 7 — 서버 라우트 분리

- EditorHttpServer를 route 모듈로 분리
- API 회귀 테스트
- 기존 URL 호환 확인

### Phase 8 — 레거시 제거

- `body.contentEditable`
- 정상 저장 경로의 `serializeSheets`
- 블록 기반 AI 신규 요청
- slot 기반 신규 응답 적용
- `execCommand`
- 브라우저 undo/redo 의존

레거시 문서와 진행 중 요청을 위한 읽기 호환만 유지한다.

---

## 26. 수용 기준

### 26.1 구조 안정성

- 일반 편집으로 `.sheet`, 머리말, 꼬리말이 삭제되지 않는다.
- 페이지 첫 위치에서 Backspace를 눌러도 이전 페이지와 합쳐지지 않는다.
- 페이지 마지막 위치에서 Delete를 눌러도 다음 페이지와 합쳐지지 않는다.
- 저장 전후 페이지 수와 순서가 의도하지 않게 변하지 않는다.
- 저장·재열기 후 모든 page ID가 유지된다.
- 정상 편집 과정에서 block wrapper 복구 경고가 발생하지 않는다.

### 26.2 저장 정확성

- 저장이 블록 탐색과 manifest 역산에 의존하지 않는다.
- 현재 EditorSession manifest가 저장 입력이다.
- revision 충돌 시 자동 덮어쓰지 않는다.
- 모든 저장은 `SaveDocument`를 통과한다.
- unsafe 문서는 teacher 저장을 보존하고 student 산출을 차단한다.
- 저장 실패 시 브라우저 편집 내용이 유지된다.

### 26.3 AI 페이지 재생성

- 선택한 page ID에만 후보가 연결된다.
- AI 결과가 자동 적용되지 않는다.
- 변경 전·후 페이지를 비교할 수 있다.
- 요청 후 페이지가 변경되면 충돌 경고가 표시된다.
- AI 후보 HTML이 Page Shell을 변경할 수 없다.
- 적용 후 undo로 이전 페이지를 복원할 수 있다.
- 대상 페이지가 삭제되면 응답을 적용하지 않는다.

### 26.4 편집 기능

- 한글 입력이 정상 동작한다.
- 굵기, 기울임, 밑줄, 색상, 크기, 정렬이 안정적으로 저장된다.
- 표 셀 편집과 행·열 추가가 동작한다.
- 이미지 삽입 및 mm 리사이즈가 동작한다.
- 정답 표시가 학생용에서 물리 제거된다.
- 페이지 추가·복제·삭제·이동이 undo 가능하다.

### 26.5 인쇄와 검수

- 기존 A4, A3, B4 MediaBox 테스트 통과
- 기존 문서의 페이지 수 불변
- 다단 문서 렌더링 회귀 없음
- 페이지별 정밀 미리보기 유지
- PDF export 유지
- 정답 누출과 최소 글자 크기 검수 유지

### 26.6 코드 품질

- `main.js` 200줄 이하 목표
- 단일 기능 모듈 300줄 이하 목표
- page reducer와 migration은 DOM 없이 테스트 가능
- Chrome 없이 editor model 단위 테스트 실행 가능
- 기존 unit/render 테스트와 신규 Editor 2.0 테스트 모두 통과

---

## 27. 성능 요구사항

- 10페이지, 총 HTML 2MB 문서를 2초 이내에 편집 화면에 표시
- 타이핑 중 전체 문서 재조립 금지
- 현재 페이지 외 다른 페이지 DOM 재렌더 최소화
- 실시간 검수 300ms 이상 debounce
- 타이핑 command 병합 800ms 기준
- student 미리보기 지연 생성
- AI 요청은 문서 전체가 아니라 선택 페이지 중심으로 구성
- Chrome render 요청은 서버에서 동시에 하나만 실행

---

## 28. 테스트 전략

### 28.1 단위 테스트

- 레거시 manifest → 페이지 manifest 마이그레이션
- page ID 생성과 충돌 방지
- page reducer의 모든 command
- undo/redo
- command 병합
- page hash
- AI 응답 충돌 판정
- HTML normalize 및 sanitize
- revision conflict
- EditorSession dirty state

### 28.2 브라우저 테스트

- 페이지 선택
- 편집 진입·종료
- 한글 조합 입력
- 페이지 경계 Backspace/Delete
- Range 서식
- 정답 마크
- 이미지 삽입·리사이즈
- 표 편집
- student mode
- 페이지 관리
- AI 비교 패널
- overflow guide

### 28.3 통합 테스트

- 레거시 문서 로드 → 편집 → schema v2 저장 → 재열기
- 생성 → 워크스페이스 저장 → 편집기 오픈
- 저장 → teacher/student 파생
- unsafe 저장
- revision conflict
- AI 요청 → 응답 → 비교 → 적용 → undo
- 용지 변경
- 정밀 미리보기
- PDF export
- history restore

### 28.4 시각·렌더 회귀

대표 활동지 fixture를 고정한다.

- 국어 5페이지
- 과학 3페이지
- 표가 많은 평가지
- 이미지가 있는 활동지
- B4 2단 시험지

각 fixture에서 다음을 비교한다.

- PDF 페이지 수
- MediaBox
- 주요 텍스트 존재
- 정답 학생용 제거
- 스크린샷 또는 pixel tolerance 기반 시각 회귀

---

## 29. 위험과 대응

### 위험 1: 레거시 블록 manifest의 의미 손실

**대응:** 기존 AssembleWorksheet를 이용해 페이지 HTML로 컴파일하고, 최초 저장 전 history에 원본 manifest를 보존한다.

### 위험 2: 페이지 전체 AI 재생성으로 수동 수정 손실

**대응:** 자동 적용 금지, 변경 전·후 비교, page hash 충돌 검사, undo 제공.

### 위험 3: AI가 디자인을 과도하게 변경

**대응:** Page Shell 보호, 기존 페이지 HTML과 테마 컨텍스트 제공, 허용 CSS 규칙 명시, candidate preview 제공.

### 위험 4: 페이지 HTML snapshot 기반 undo 메모리 증가

**대응:** 최대 100개, 타이핑 병합, 변경된 페이지만 저장, 필요 시 압축 또는 history 크기 상한 도입.

### 위험 5: 브라우저 편집 HTML의 비결정성

**대응:** Range 기반 툴바, normalizeHtml, browser test fixture, Page Shell 경계 보호.

### 위험 6: 생성기와 편집기 manifest 형태가 달라짐

**대응:** 정규화·컴파일 경계를 명시하고 AssembleWorksheet가 양쪽 스키마를 지원하는 과도기 운영.

---

## 30. 구현 금지사항

Claude Code는 다음 방식으로 문제를 우회해서는 안 된다.

- 프론트엔드 프레임워크 도입
- 대규모 외부 에디터 라이브러리 도입
- HTML 파일을 manifest 대신 유일한 진실의 원천으로 변경
- 페이지 내부를 다시 필수 블록 스키마로 강제
- 배열 index를 영구 page ID로 사용
- AI 결과 자동 적용
- AI가 `.sheet`, 머리말, 꼬리말을 생성하도록 허용
- 저장 실패 후 preview 또는 export 진행
- 정답 누출 검수를 약화
- SaveDocument를 우회하는 편집기 전용 저장
- 모든 타이핑마다 전체 문서 재조립
- 테스트 삭제 또는 기대값 완화로 통과
- `execCommand("undo")`를 최종 undo 시스템으로 사용
- 레거시 block/slot 기반 AI 요청을 신규 기본 경로로 유지

---

## 31. Claude Code 실행 원칙

전체 리팩토링을 한 번에 구현하지 않는다.

각 Phase마다 다음 순서를 따른다.

1. 관련 코드와 테스트를 읽는다.
2. 변경 전 characterization test를 추가한다.
3. 작은 구조 변경을 구현한다.
4. unit test를 실행한다.
5. 관련 browser/render test를 실행한다.
6. 기존 산출물과 차이를 확인한다.
7. 다음 Phase 전 커밋 가능한 상태를 만든다.

각 Phase 완료 보고에는 다음을 포함한다.

- 변경 파일
- 새로 확정한 불변식
- 제거한 레거시 경로
- 임시 호환 경로
- 실행한 테스트와 결과
- 알려진 한계
- 다음 Phase의 위험 요소

첫 실행에서는 **Phase 0과 Phase 1만 수행**한다. Phase 2 이후는 테스트 결과와 migration 발견 사항을 보고한 뒤 진행한다.

---

## 32. 권장 커밋 단위

1. `test(editor): lock current page editing behavior`
2. `feat(manifest): add page-based editable schema`
3. `feat(manifest): migrate legacy block pages to page html`
4. `feat(editor-core): introduce EditorSession and page command bus`
5. `refactor(editor-save): save session page manifest directly`
6. `refactor(editor-canvas): replace body editing with page-content editing`
7. `feat(editor-history): add page-based undo and redo`
8. `feat(ai): add page regeneration request and response v3`
9. `feat(ai): add page candidate compare and conflict guard`
10. `refactor(toolbar): replace execCommand formatting`
11. `refactor(editor-features): split page image answer preset controllers`
12. `refactor(editor-server): split editor routes`
13. `chore(editor): remove legacy block resync path`
14. `test(editor): complete editor v2 regression gates`
15. `docs(editor): document page-based editor architecture`

---

## 33. Definition of Done

다음 조건을 모두 만족할 때 Editor 2.0을 완료한 것으로 본다.

- 편집 manifest가 `pages[{id, role, contentHtml}]`를 지원한다.
- 레거시 블록 페이지 manifest가 자동으로 페이지 manifest로 마이그레이션된다.
- 모든 페이지에 안정적인 ID가 있다.
- iframe `body`가 더 이상 contenteditable이 아니다.
- 현재 페이지의 `page-content`만 편집할 수 있다.
- 저장이 블록 탐색 및 역동기화에 의존하지 않는다.
- EditorSession manifest가 저장 입력이다.
- 페이지 단위 command와 undo/redo가 동작한다.
- AI가 선택 페이지 전체의 후보 HTML을 생성한다.
- AI 후보는 변경 전·후 비교 후에만 적용된다.
- 요청 후 페이지 수정 충돌을 감지한다.
- Page Shell은 AI와 일반 편집으로 변경되지 않는다.
- 학생용·교사용 분기와 정답 누출 게이트가 유지된다.
- 페이지 추가·복제·삭제·이동이 안정적으로 동작한다.
- `execCommand` 사용이 제거된다.
- `editor.js` 기능이 controller 단위로 분리된다.
- EditorHttpServer가 route 단위로 분리된다.
- 기존 unit/render 테스트가 모두 통과한다.
- 신규 Editor 2.0 테스트가 모두 통과한다.
- 실제 5페이지 이상 활동지에서 다음 종단 흐름이 성공한다.

```text
열기
→ 페이지 직접 수정
→ 정답 표시
→ 이미지 크기 변경
→ AI로 특정 페이지 재생성
→ 변경 전·후 비교
→ 적용
→ undo
→ 다시 적용
→ 저장
→ 재열기
→ 학생용 확인
→ 페이지별 정밀 미리보기
→ PDF 내보내기
```

---

## 34. 최종 의사결정

Editor 2.0은 블록 편집기가 아니다.

- **문서의 구조 단위:** 페이지
- **직접 편집 단위:** 현재 페이지의 `page-content`
- **저장 단위:** 페이지별 `contentHtml`
- **AI 수정 단위:** 선택한 페이지 전체
- **undo 단위:** 페이지 변경 command
- **보호 단위:** Page Shell과 문서 공통 규칙

가장 먼저 해결할 세 가지는 다음과 같다.

1. 레거시 블록 페이지를 안정적인 페이지 manifest로 정규화한다.
2. 문서 전체 편집을 제거하고 현재 페이지 본문만 편집한다.
3. iframe DOM에서 구조를 복원하지 않고 EditorSession의 페이지 manifest를 직접 저장한다.

이 세 가지가 완료된 뒤 AI 페이지 재생성, 툴바, 표, 이미지, 프리셋, 페이지 관리 기능을 새 구조 위에 다시 연결한다.
