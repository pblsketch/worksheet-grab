# worksheet-grab

[한국어](README.md) · [English](README.en.md)

한국 초·중·고 교사가 **활동지를 설계하고, 브라우저에서 다듬고, 학생용·교사용으로 내보내는 로컬 도구**입니다.
Claude Code, Codex CLI 같은 AI 하네스가 교사의 요청을 해석하고, worksheet-grab의 Node CLI가 문서 구조·검수·인쇄를 담당합니다.

- 저장소 자체는 외부 AI API 키를 요구하지 않습니다. 사용 중인 AI 하네스의 로그인이나 구독은 별도입니다.
- 기본 성취기준 자료를 조회해 사용하며, 성취기준 원문을 새로 만들어 내지 않습니다.
- 학생용에서는 정답을 물리적으로 제거하고, 누출이 감지되면 학생용 출력을 중단합니다.
- HTML 초안은 Chrome 없이 만들 수 있습니다. PDF·PNG 출력에는 Google Chrome이 필요합니다.

> **현재 상태: 베타(Beta)**
>
> 주요 생성·편집·검수·내보내기 흐름은 구현되어 있고 자동 테스트로 검증합니다. 다만 안정 버전 전까지 명령 인터페이스와 출력 형식이 바뀔 수 있으므로, 실제 수업에 배포하기 전 교사가 결과물을 검토하고 원본을 보관하세요.

> 이 README는 GitHub에서 설치하고 기능을 파악하기 위한 문서입니다. 교사용 배포 번들에서는 `CLAUDE.md`와 `AGENTS.md`가 AI 하네스의 실제 진입 문서입니다.

## 가장 쉬운 설치: 교사용 베타 ZIP

1. [Releases](https://github.com/pblsketch/worksheet-grab/releases)에서 최신 **Beta** 릴리스를 엽니다.
2. 자산 목록에서 `worksheet-grab-user-v0.6.0-beta.1.zip`을 내려받아 압축을 풉니다.
3. 압축을 푼 폴더를 AI 하네스에서 열거나, 그 폴더에서 다음 명령으로 설치를 확인합니다.

```bash
node bin/worksheet-grab.js help
```

이 ZIP에는 실행 엔진, 성취기준 자료, 교사용 AI 스킬만 들어 있으며 테스트와 개발 기록은 포함하지 않습니다.

### 저장소를 클론하는 방법

소스 코드를 확인하거나 수정하려면 저장소를 클론하세요. 현재 저장소 루트의 `CLAUDE.md`와 `AGENTS.md`도 교사용 진입 문서이므로 클론한 상태에서 바로 사용할 수 있습니다.

```bash
git clone https://github.com/pblsketch/worksheet-grab worksheet-grab
cd worksheet-grab
node bin/worksheet-grab.js help
```

개발 파일이 빠진 폴더가 필요하면 다음 명령으로 교사용 번들을 만들 수 있습니다.

```bash
node scripts/build-user-bundle.mjs dist/worksheet-grab-user
```

## 준비물

1. **AI 하네스 하나** — 자연어로 제작할 때 필요하며, CLI만 직접 쓸 때는 선택 사항
   - Claude Code
   - Codex CLI
   - Antigravity
2. **Node.js 24 이상**
3. **Google Chrome** — PDF·PNG 출력 때만 필요

확인:

```bash
node --version
```

별도의 `npm install`이나 빌드 과정은 필요하지 않습니다.

## 교사용 3분 시작

### 1. 내려받거나 클론한 폴더를 AI 하네스에서 열기

- Claude Code는 `CLAUDE.md`와 `.claude/skills/`를 읽습니다.
- Codex CLI와 Antigravity는 `AGENTS.md`를 시작점으로 사용합니다.

### 2. 평소 말로 요청하기

```text
중2 과학 광합성 활동지를 만들어줘.
```

초안을 만들기 전에 수업 의도와 학생 맥락을 함께 정하고 싶다면:

```text
중2 과학 광합성 활동지를 같이 설계하자. 먼저 질문해줘.
```

교과·학년·주제 중 일부가 빠지면 AI가 필요한 항목만 짧게 확인합니다. 요청이 충분히 구체적이면 인터뷰를 강제하지 않고 바로 제작합니다.

## 무엇을 만들 수 있나요?

- **학생용·교사용 활동지 2벌**
- **HTML, PDF, 첫 페이지 PNG 미리보기**
- **차분한 중립 기본 팔레트** + 선택형 교과 팔레트(국어·과학·사회·영어)
- **13개 활동 구조**: 실험 탐구, 자료 해석, 읽기·독해, 토론, 개념 구조화, 프로젝트, 글쓰기·성찰 등
- **23개 시각 조직자**: KWL, 프레이어, 5W1H, 벤다이어그램, 개념지도, 피시본, 흐름도 등
- **브라우저 편집기**: 문항·표·이미지·답란·정답 표시, 실행 취소/다시 실행, 자동 페이지 리플로우
- **문서 히스토리와 복원**
- **여러 활동지를 묶은 학생용·교사용 자료집**

활동지 본문은 AI와 교사가 작성하고, 엔진은 허용된 문서 구조와 인쇄 규칙 안에서 조립합니다. 최종 배포 전에는 교사가 내용과 난이도를 검토해야 합니다.

## 실제 생성 예시

아래 이미지는 목업이 아니라 현재 베타 엔진으로 **성취기준 조회 → 활동지 조립 → 학생용·교사용 분리 → 정답 누출 검수 → Chrome 렌더**를 실행해 만든 학생용 첫 페이지입니다. 과학 탐구형은 3쪽, 사회 자료 분석형과 시각 조직자형은 각각 2쪽으로 이어집니다.

| 과학 탐구형 · 광합성 (3쪽) | 사회 자료 분석형 · 인구 변화 (2쪽) |
|---|---|
| ![광합성 실험을 설계하는 과학 탐구 활동지](docs/images/readme/science-inquiry.png) | ![인구 변화를 지도에 표시하는 사회 자료 분석 활동지](docs/images/readme/social-data-map.png) |

- 과학: 탐구 문제 → 가설 → 변인 설계 → 측정표·그래프 → 결과 해석
- 사회: 실제 세계지도와 공개 인구 자료 → 변화율 계산 → 지도 범례 → 원인 피시본

### 시각 조직자형 · 물질의 상태 (2쪽)

![고체 액체 기체를 3원 벤다이어그램으로 비교하는 시각 조직자 활동지](docs/images/readme/visual-organizer-states.png)

첫 페이지의 3원 벤다이어그램에 이어 둘째 페이지에서 6갈래 개념지도와 4단계 흐름도로 상태 변화를 구조화합니다. 조직자의 도형과 좌표는 엔진이 만들고, 주제 라벨과 활동 지시는 교사 또는 AI 하네스가 채웁니다.

## AI 하네스 지원 상태

| 환경 | 진입 방식 | 현재 확인 범위 |
|---|---|---|
| Claude Code | `CLAUDE.md` + `.claude/skills/` | 기본 하네스 |
| Codex CLI | `AGENTS.md` + 번들 스킬 | 협의 라우팅과 생성 경로 스모크 테스트 기록 |
| Antigravity | `AGENTS.md` + 번들 스킬 | 동일 이식 계약 제공, 환경별 스모크 절차 제공 |

Codex와 Antigravity에서는 Claude 전용 팀 지시를 한 에이전트가 단계별로 순서대로 수행합니다. 환경별 확인 절차와 현재 기록은 [`docs/CROSS-PROVIDER-SMOKE.md`](docs/CROSS-PROVIDER-SMOKE.md)에 있습니다.

## 명령줄로 직접 사용하기

AI 하네스 없이도 결정적인 생성·검수·편집·내보내기 명령을 직접 실행할 수 있습니다.

### 한 번에 생성

```bash
# 성취기준 조회 → 조립 → 학생/교사용 생성 → 검수 → PDF
node bin/worksheet-grab.js pipeline 중2과학 광합성 --out out/

# Chrome 없이 HTML 초안까지만
node bin/worksheet-grab.js pipeline 중2사회 인구 --out out/ --no-render

# 첫 페이지 PNG 미리보기 포함
node bin/worksheet-grab.js generate 중2영어 감정 --out out/ --png
```

### 문서로 저장하고 브라우저에서 편집

```bash
node bin/worksheet-grab.js generate 중2과학 광합성 --doc 광합성탐구
node bin/worksheet-grab.js edit-ui 광합성탐구
node bin/worksheet-grab.js doc export 광합성탐구
```

`edit-ui`는 로컬 주소에서만 열립니다. 저장할 때마다 문서 구조와 정답 누출을 다시 검사하고 히스토리를 남깁니다.

### 기존 초안 수정

```bash
node bin/worksheet-grab.js edit out/science-광합성.manifest.json \
  "3번 문항 빼고 성찰 추가" --out out/
```

기본 동작은 원본을 보존하고 `-v2`, `-v3`처럼 새 버전을 만드는 것입니다. `--in-place`를 지정한 경우에만 원본을 덮어씁니다.

### 전체 명령 확인

```bash
node bin/worksheet-grab.js help
node bin/worksheet-grab.js list-archetypes
node bin/worksheet-grab.js list-vocab
```

## 성취기준과 교과 범위

- 기본 CSV: `data/achievement-standards.csv`
- 다른 CSV 사용: `--csv <경로>` 또는 `GEPAI_CSV`
- 성취기준은 조회 전용입니다.
- 활동지에는 기본적으로 학생 친화적인 **학습 목표**를 표시합니다.
- 근거 성취기준을 교사용에 함께 표시하려면 `--show-standards`를 사용합니다.

색(팔레트)은 교과에 묶이지 않습니다. 기본은 어느 교과에도 어울리는 **차분한 중립 팔레트**이며, 원하면 교과 팔레트(국어·과학·사회·영어)를 선택할 수 있습니다. 블록과 시각 조직자도 특정 교과 전용이 아니라 **활동(무엇을 하게 할지)에 맞춰** 고르며, 교과는 주로 콘텐츠와 성취기준 맥락을 정합니다. 다른 교과에도 쓸 수 있지만 해당 맥락에 맞는 교사 검토와 조정이 필요합니다.

## 정답과 개인정보 안전

- 정답은 학생용 문서에서 구조 수준으로 제거됩니다.
- 정답 누출이 감지되면 학생용 HTML·PDF 생성을 중단하고 교사용만 보존합니다.
- 기본 CSV와 로컬 CLI 경로는 학생 데이터를 외부 서버로 전송하지 않습니다.
- AI 하네스나 선택형 MCP에 입력한 내용은 해당 제공자의 정책에 따라 처리될 수 있으므로 학생 실명이나 민감정보를 입력하지 마세요.

## 알려진 범위

- 완전한 웹 서비스나 단독 데스크톱 앱이 아니라 **로컬 CLI + AI 하네스 + 브라우저 편집기** 구성입니다.
- PDF·PNG의 실제 인쇄 렌더에는 Chrome이 필요합니다.
- AI가 작성한 교육 내용의 사실성·수준·저작권 적합성은 교사가 최종 확인해야 합니다.
- Antigravity용 진입 계약은 포함되어 있지만, 실제 동작은 설치 환경별 스모크 절차로 확인해야 합니다.

## 개발과 검증

```bash
npm run test:unit
npm run test:render
npm run design:lint
node scripts/build-user-bundle.mjs dist/worksheet-grab-user
```

- `npm run test:unit`: Chrome이 필요 없는 엔진·문서 계약 테스트
- `npm run test:render`: 실제 Chrome을 사용하는 인쇄·편집 일치 테스트
- `npm run design:lint`: 종이 출력 디자인 계약(토큰·색 allowlist·프린트 안전) 검출기 — 새 블록이 디자인 시스템을 벗어나지 않게 강제
- 사용자 번들: 엔진과 교사용 하네스만 포함하고 테스트·개발 문서는 제외

하네스 경계는 [`docs/HARNESS-MAP.md`](docs/HARNESS-MAP.md), 크로스프로바이더 확인 절차는 [`docs/CROSS-PROVIDER-SMOKE.md`](docs/CROSS-PROVIDER-SMOKE.md)를 참고하세요. 종이 출력 디자인 시스템(계약 `PAPER.impeccable.md`·토큰 `design-tokens.json`·검출기·전수 감사)은 [`docs/design-system/`](docs/design-system/)에 정리돼 있습니다.

## 라이선스와 영감

[MIT License](LICENSE).

이 프로젝트는 [slides-grab](https://github.com/NomaDamas/slides-grab)의 계획→디자인→편집→내보내기 흐름과 무API 철학에서 영감을 받았습니다. 활동지는 고정 슬라이드가 아니라 인쇄용 다중 페이지 리플로우 문서이므로 코드를 포크하지 않고 별도 엔진으로 구현했습니다.
