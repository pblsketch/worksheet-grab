# PRD: Worksheet Editor 2.0A — 페이지 캔버스 + 개체 편집

## 0. 문서 정보

- 프로젝트: `worksheet-grab`
- 상태: Implementation Draft
- 우선순위: P0
- 결정일: 2026-07-26
- 검토 방식: GJC 검토 후 사용자 결정
- 실행 방식: Ralph
- 대체 범위: `PRD-worksheet-editor-v2-page-based.md`의 실행 지시

## 1. 최종 제품 결정

교사는 Canva와 Google Slides에서 익힌 방식으로 활동지를 편집한다.

```text
페이지 클릭
→ 개체 선택
→ 더블클릭 또는 Enter로 개체 내용 편집
→ 드래그·핸들·문맥 툴바로 개체 조작
→ 페이지 단위 저장·검수·인쇄
```

페이지는 보호된 캔버스이며 페이지 내부의 영구 개체 트리가 편집 상태의 원본이다.

```text
Document
├─ pagination
├─ metadata
├─ paper
└─ pages[]
   ├─ id
   ├─ role (선택)
   ├─ flow[]
   └─ float[]
```

`contentHtml`은 렌더 결과일 뿐 편집 manifest가 아니다.

## 2. 결정 근거

기존 페이지 HTML PRD는 현재 편집기가 문서 전체 `contenteditable`과 블록 역직렬화에
의존한다고 가정했다. 현재 브랜치는 이미 다음 구조를 사용한다.

- 개체 트리가 브라우저 편집 상태의 원본
- `applyDocOp()` 단일 변경 관문
- 개체 선택·더블클릭 편집·드래그·리사이즈
- `flow`와 `float` 배치
- 개체 트리 기반 undo/redo
- Chrome 측정 기반 페이지네이션
- 개체 단위 AI 수정
- 개체 트리 수준 학생용 정답 물리 제거

이 구조를 `contentHtml`로 교체하면 직접 편집이 쉬워지는 대신 Canva·Slides식 조작,
타입 안전성, 개체 단위 AI, 페이지네이션 계약을 다시 구현해야 한다.

따라서 다음을 채택한다.

> 페이지는 문서 경계와 정체성을 책임지고, 개체는 직접 편집과 조작을 책임진다.

## 3. 사용자 경험

### 3.1 페이지

- 페이지 목록에서 현재 페이지를 선택한다.
- 페이지는 영구 ID를 가진다.
- Page Shell은 일반 편집 대상이 아니다.
- 페이지 추가·복제·삭제 후에도 기존 페이지 ID는 유지된다.
- 페이지 복제와 신규 추가는 새 ID를 사용한다.
- 페이지 번호는 배열 위치에서 계산하며 저장 HTML에 고정하지 않는다.

### 3.2 개체

- 한 번 클릭하면 개체를 선택한다.
- 더블클릭 또는 Enter로 텍스트나 부분 요소를 직접 편집한다.
- Escape로 개체 편집에서 선택 상태로 돌아간다.
- `float` 개체는 드래그·리사이즈·미세 이동·앞뒤 순서를 지원한다.
- `flow` 개체는 문서 흐름과 Chrome 측정 페이지네이션을 따른다.
- 서식은 선택 개체의 문맥 툴바와 인스펙터에서 적용한다.

### 3.3 AI

- 기본 AI 수정 단위는 선택 개체다.
- 후속 단계에서 복수 개체와 현재 페이지 전체를 지원할 수 있다.
- AI는 페이지 ID와 개체 ID로 대상을 식별한다.
- AI 결과는 자동 적용하지 않는다.
- 적용 후 undo할 수 있어야 한다.
- `std-box` 등 보호 개체 정책을 유지한다.

## 4. 문서 모델

### 4.1 페이지

```json
{
  "id": "page-6d03cfad",
  "role": "activity",
  "flow": [],
  "float": []
}
```

#### `id`

- 문서 안에서 유일한 비어 있지 않은 문자열
- 배열 index를 ID로 사용하지 않음
- 열기·저장·재열기·리플로우 후 유지
- 신규 페이지와 복제 페이지는 새 ID 사용
- 기본 생성기는 `crypto.randomUUID()` 사용
- 테스트에서는 ID generator 주입 가능

#### `role`

선택 필드이며 페이지의 용도를 나타낸다.

- `cover`
- `instruction`
- `reading`
- `activity`
- `practice`
- `reflection`
- `rubric`
- `answer-key`
- `custom`

`role`은 개체 타입이나 레이아웃을 강제하지 않는다.

#### `flow`

- 문서 흐름에 참여하는 타입 있는 개체
- Chrome 측정으로 페이지 귀속을 다시 계산할 수 있음
- 개체 ID와 배열 순서를 유지

#### `float`

- 페이지 로컬 좌표를 가진 타입 있는 개체
- 페이지 간 자동 이동 대상이 아님
- 배열 순서는 페인트 순서와 일치

### 4.2 Page Shell

```html
<section class="sheet" data-page-id="page-6d03cfad">
  <span class="mode-badge"></span>
  <div class="run-head"></div>
  <!-- flow 및 float 개체 렌더 -->
  <div class="run-foot"></div>
</section>
```

보호 대상:

- `.sheet`
- `.run-head`
- `.run-foot`
- `.mode-badge`
- 페이지 번호
- paper CSS
- 편집기 overlay

개체 편집은 manifest 개체를 변경한 뒤 Page Shell을 다시 렌더한다. Page Shell DOM을
manifest로 역직렬화하지 않는다.

## 5. 불변식

- 개체 트리가 편집 상태의 단일 진실원천이다.
- 모든 편집기 진입 문서는 고유한 page ID를 가진다.
- 기존 page ID는 정상적인 저장과 리플로우에서 바뀌지 않는다.
- 기존 object ID는 페이지 이동만으로 바뀌지 않는다.
- 페이지와 개체 배열 index는 영구 식별자가 아니다.
- 학생용에서는 `answer:true` 개체와 정답 데이터가 물리적으로 제거된다.
- `SaveDocument`와 `ValidateWorksheet`를 우회하지 않는다.
- Chrome 측정 패스가 flow 페이지 귀속의 최종 권한이다.
- 저장 실패 시 현재 브라우저 편집 상태를 유지한다.
- Page Shell은 일반 개체 편집과 AI 수정으로 변경되지 않는다.

## 6. 기존 문서 정규화

### 6.1 레거시 블록 manifest

기존 `MigrateManifestToObjectTree` 경로를 유지한다.

```text
legacy pages[Block[]]
→ 타입 있는 flow/float 개체
→ page ID 부여
→ 메모리에서 편집
→ 최초 저장 시 개체 트리 manifest로 커밋
```

GET만으로 디스크 원본을 변경하지 않는다.

### 6.2 page ID가 없는 개체 트리

- 기존 `flow`와 `float`를 그대로 보존한다.
- ID가 없는 페이지에 새 ID를 부여한다.
- 중복 ID는 첫 페이지를 보존하고 이후 중복만 교체한다.
- 정규화는 입력 문서를 변형하지 않는다.
- 편집기 열기 응답에서 정규화된 문서를 클라이언트 상태로 사용한다.
- 저장 요청은 누락·공백·중복 ID를 조용히 수리하지 않고 검증 오류로 거부한다.
- 직접 체크포인트 호환 입력을 정규화한 경우 반환된 문서를 호출자가 다음 상태로 사용한다.

## 7. Phase 0 — 회귀 기준 고정

첫 Ralph 실행 전에 다음 기준선을 고정한다.

- 레거시 manifest 마이그레이션 무손실
- 개체 트리 검증
- 개체 트리 렌더 결정성
- 학생용 정답 제거
- SaveDocument revision·history
- EditorHttpServer shell/save 왕복
- 페이지 추가·복제·삭제
- 리플로우
- PDF 및 정밀 미리보기

검증은 구체적인 명령 출력으로 기록한다.

## 8. Phase 1 — 페이지 정체성

첫 Ralph 실행의 구현 범위다.

- `PageIdentity` 순수 모듈 추가
- 누락·중복 page ID 정규화
- 레거시 마이그레이션 결과에 page ID 부여
- 기존 개체 트리 shell 로드 시 page ID 보정
- 편집 진입 경계에서 page ID 보정, 저장 요청 경계에서 page ID 엄격 검증
- Page Shell에 `data-page-id` 방출
- 리플로우에서 기존 page ID와 role 보존
- 새 overflow 페이지에 새 ID 부여
- 페이지 추가·복제 시 새 ID 부여
- page ID와 role의 경계 검증

Phase 1에서는 개체 모델, AI 공급자, 서버 라우팅 구조를 변경하지 않는다.

## 9. 후속 단계

### Phase 2 — 페이지 관리 UX

- 페이지 역할 변경
- 드래그 기반 페이지 순서 변경과 키보드 접근성 보강
- 현재 페이지 선택을 index가 아니라 ID로 관리
- 추가·복제·삭제 command와 undo 보강

### Phase 3 — 직접 편집 마찰 감소

- 텍스트 개체 더블클릭 편집 일관화
- 문맥 툴바 포커스 유지
- 한글 조합 입력 회귀
- 표·이미지 부분 편집
- 붙여넣기 정제

### Phase 4 — 페이지 범위 AI

- 단일 개체 AI 유지
- 복수 개체 target contract
- 페이지 전체 target contract
- page ID와 page version 충돌 검사
- 변경 전·후 비교
- 적용·폐기·undo

### Phase 5 — 모듈 경계 정리

- 편집기 controller 분리
- 서버 route 분리
- 중복 렌더·저장 경로 제거

각 단계는 이전 단계의 unit·render·수동 QA가 통과한 뒤 시작한다.

## 10. Phase 1 수용 기준

- 편집기로 연 모든 페이지에 고유 ID가 있다.
- page ID가 없는 기존 개체 트리를 열 수 있다.
- 레거시 블록 manifest의 페이지 수와 내용이 유지된다.
- 열기만 해서는 레거시 디스크 원본이 바뀌지 않는다.
- 최초 저장 후 page ID가 manifest에 기록된다.
- 저장·재열기 후 page ID가 동일하다.
- 리플로우 후 기존 page ID와 role이 유지된다.
- 새 페이지와 복제 페이지는 기존 ID를 재사용하지 않는다.
- Page Shell에 올바르게 이스케이프된 `data-page-id`가 있다.
- 학생용·교사용 분기와 정답 누출 게이트가 유지된다.
- 기존 개체 편집 동작이 유지된다.

## 11. 테스트 전략

### 단위

- 누락 page ID 생성
- 중복 page ID 교체
- 기존 ID와 role 보존
- 입력 불변
- 신규·복제 페이지 ID
- 리플로우 page ID
- Page Shell 속성 이스케이프
- page ID·role 검증

### 통합

- 레거시 열기 → page ID 생성 → 최초 저장 → 재열기
- 개체 트리 열기 → 수정 → 저장 → 재열기
- 저장 실패 시 편집 상태 보존
- student/teacher 파생

### 렌더

- 대표 5페이지 이상 활동지
- 페이지 수와 MediaBox
- 개체 귀속
- Page Shell `data-page-id`
- PDF export

### 수동 QA

```text
열기
→ 페이지 선택
→ 개체 선택
→ 텍스트 직접 편집
→ float 개체 이동
→ 페이지 복제
→ 저장
→ 재열기
→ 페이지 ID와 개체 내용 확인
→ 학생용 미리보기
→ PDF 내보내기
```

## 12. 구현 금지사항

- `flow`/`float` 개체를 `contentHtml`로 교체
- 영구 개체 ID 제거
- DOM에서 manifest 역직렬화
- Page Shell을 contenteditable로 변경
- 배열 index를 page ID로 사용
- 정답 누출 검사 약화
- `SaveDocument` 우회 저장
- Chrome 페이지네이션 권한 이중화
- AI 결과 자동 적용
- 현재 dirty worktree의 사용자 변경 되돌리기
- 테스트 삭제 또는 기대값 완화로 회귀 숨기기

## 13. 첫 Ralph 실행 완료 조건

- Phase 0 기준선이 기록되어 있다.
- Phase 1 구현과 테스트가 완료됐다.
- 관련 LSP 진단에 오류가 없다.
- 전체 unit 테스트가 통과한다.
- 관련 render 테스트가 직렬로 통과한다.
- 실제 편집기에서 저장·재열기 후 page ID가 유지된다.
- 기존 사용자 변경이 보존됐다.
- 독립 검토자가 구조적 회귀가 없다고 승인했다.

Phase 2 이후는 첫 Ralph 실행의 증거와 발견 사항을 검토한 뒤 진행한다.
