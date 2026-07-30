# worksheet-grab — 개발 하네스

한국 K-12 교사용 활동지(활동지) 제작 서비스. **이 파일은 코드를 고치는 개발자·AI를 위한 개발(3층) 하네스다.** 사용자 구독 AI가 엔진(무API).

- **제품(2층, 교사 배포) 하네스** — 활동지 생성·편집·내보내기 파이프라인은 `.claude/skills/` · `.claude/agents/` 에 자기완결로 있다. 트리거·팀·제품 규칙은 거기서 선언된다.
- **하네스 3층 구조·경계·배포 설계** — `docs/HARNESS-MAP.md`.
- **아키텍처(Clean Architecture)** — `docs/PLAN.md`. **개발 변경 이력** — `docs/CHANGELOG.md`.

## ⚠ 병행 세션 — 착수 전 30초 확인

이 저장소는 **여러 AI 세션이 한 작업 트리를 동시에 쓰는 일이 실제로 있다**(2026-07-28 관측). 착수 전에:

```bash
git status --porcelain   # 내가 안 건드린 파일이 M 이면 = 다른 세션이 살아 있다
```

비어 있지 않다면 **그 상태에서 잰 테스트 숫자는 기준선이 아니다** — 실제로 남의 미완성 저장 때문에 단위 스위트가 빨간불이었고, 렌더 스위트는 파일을 쓰는 도중 읽어 허위 실패(`normalizeObjectives is not defined`)를 냈다. 내가 고칠 파일이 이미 남의 손에 있으면 **멈추고 사용자에게 알린다.**

절대 금지 3가지(남의 커밋 안 된 작업이 말없이 사라진다): **`git add -A`/`commit -a`**(경로를 명시해 스테이징) · **브랜치 생성·전환**(HEAD 는 트리 전체에 하나라 남의 커밋을 끌어간다) · **`stash`/`reset --hard`/`checkout --`/`clean`**.

전문·근거·worktree 격리 방법은 **`docs/CONCURRENT-SESSIONS.md`**.

## 개발 불변식 헌장 — 어떤 변경도 이걸 깨지 않는다

1. **편집 == 인쇄 (R2-1)** — 편집 화면의 페이지가 인쇄 산출과 기계로 동치. 편집 보조 UI는 오버레이·`editMode` 속성으로만 싣고, 인쇄 HTML 을 직접 단정해 검증한다.
2. **의존성 0 · 빌드 0** — 표준 라이브러리(Node ≥24)만. 외부 라이브러리 도입은 기능이 아니라 **정책 결정 사안**이다.
3. **단일 진실 원천** — 문서 상태(manifest/개체 트리)는 한 곳뿐. UI는 두 번째 원천이 될 수 없다. 문서 변경은 `applyDocOp` 단일 관문으로만.
4. **fail-closed** — 정답 누출·검증 실패 시 산출을 막는다. 통과 위장 금지(못 잡았으면 "미검증"이라 밝힌다).
5. **test-first · 변이 실험** — 가능하면 red→green. 수정을 하나씩 되돌려 대응 테스트가 빨간불이 되는지(변이)로 검출력을 증명한다. 렌더 스위트는 직렬(`--test-concurrency=1`). 개발 중에는 관련 editor 렌더에 집중하고 **병합 전 전체 렌더를 1회** 돌린다(다른 렌더 세션과 겹치지 않게).
6. **병행 세션 안전** — 위 §병행 세션 + `docs/CONCURRENT-SESSIONS.md`.

## 제품(2층) 불변식은 제품 하네스 소관

**원칙 3**(성취기준 원문은 조회만 — 창작·변형 금지) · **저작권 3층 정책** · **정답 누출 fail-closed** 같은 *제품 규칙*은 `.claude/agents/` · `.claude/skills/` 안에서 자기완결로 선언·집행된다. 이 파일에 중복 기술하지 않는다(HARD 경계 — `docs/HARNESS-MAP.md`).

## 팀 / 파이프라인 (요약)

`curriculum-mapper → worksheet-planner → worksheet-designer → worksheet-reviewer(검수 게이트) → worksheet-exporter` — 에이전트 팀(Pipeline + Producer-Reviewer). 상세·트리거·엔진 배선은 `.claude/skills/worksheet-grab/SKILL.md`.
