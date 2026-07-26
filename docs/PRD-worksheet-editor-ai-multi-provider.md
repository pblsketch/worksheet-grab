# PRD: Worksheet Editor AI — Antigravity·Codex·Claude Code 멀티 공급자 지원

## 0. 문서 정보

- **프로젝트:** worksheet-grab
- **대상 저장소:** `pblsketch/worksheet-grab`
- **문서 상태:** Implementation Draft
- **우선순위:** P0
- **대상 버전:** Editor AI 1.0
- **선행 조건:** `PRD-worksheet-editor-v2-page-based.md`의 Definition of Done 완료
- **핵심 기능:** 웹 편집기에서 현재 페이지에 대한 AI 수정안을 요청하고, 검수된 후보를 비교한 뒤 적용
- **필수 공급자:** Google Antigravity, OpenAI Codex, Anthropic Claude Code
- **Google 연동 경로:** Antigravity 2.0 GUI 자동화가 아니라 공식 Antigravity CLI의 `agy` 실행 파일
- **보존 원칙:** 사용자가 이미 각 도구에 로그인한 로컬 인증을 재사용하며 worksheet-grab이 API 키나 인증 토큰을 수집하지 않는다.

---

## 1. 요약

Editor AI 1.0은 교사가 worksheet-grab 웹 편집기에서 현재 페이지를 선택하고 자연어로 수정 요청을 보낼 수 있게 한다.

예시:

- “문항을 5개에서 3개로 줄여줘.”
- “중학교 1학년이 이해하기 쉽게 표현을 바꿔줘.”
- “각 문항에 문장 시작 힌트를 추가해줘.”
- “표가 너무 복잡하니 비교 기준을 세 가지로 단순화해줘.”
- “페이지가 답답해 보이니 내용은 유지하면서 여백을 확보해줘.”

사용자는 AI 실행 공급자로 다음 중 하나를 선택할 수 있다.

1. **Gemini · Antigravity**
2. **Codex**
3. **Claude Code**
4. **자동 선택**

브라우저는 AI 서비스에 직접 접속하지 않는다. 로컬 Editor 서버가 설치되고 로그인된 공급자 CLI를 하위 프로세스로 실행한다.

```text
Browser Editor
  → Editor HTTP Server
  → Provider Adapter
  → agy | codex | claude
  → Candidate Page
  → Validation
  → Before/After Review
  → User Apply
  → EditorSession
  → SaveDocument
```

AI는 원본 manifest나 저장된 활동지 파일을 직접 수정하지 않는다. 격리된 실행 디렉터리 안에서 **페이지 교체 후보**만 생성한다.

후보는 다음 절차를 통과해야 한다.

1. 응답 계약 검사
2. HTML 정제
3. 금지 요소 검사
4. 정답 누출 검사
5. 인쇄 안전 검사
6. 단일 페이지 렌더 검사
7. 변경 전·후 비교
8. 사용자 승인

사용자가 `적용`을 누르기 전에는 현재 활동지를 변경하지 않는다.

---

## 2. 배경

worksheet-grab의 주요 사용자는 별도의 LLM API를 개발자가 직접 연결하기보다, 자신이 이미 사용 중인 AI 코딩 도구의 구독과 로컬 로그인을 활용할 가능성이 높다.

예상되는 대표 환경은 다음과 같다.

- Google Antigravity 2.0 또는 Antigravity CLI를 사용하는 교사
- ChatGPT 계정으로 로그인한 Codex CLI를 사용하는 교사
- Anthropic 계정으로 로그인한 Claude Code를 사용하는 교사

따라서 worksheet-grab이 자체적으로 특정 AI API를 호출하고 사용량을 과금하는 구조보다, 사용자의 로컬 에이전트 실행 환경을 연결하는 구조가 적합하다.

기존 worksheet-grab에는 `.ai-bridge` 파일 큐를 이용하여 별도 AI 세션과 요청·응답을 주고받는 방식이 있다. Editor AI 1.0에서는 이를 유지하면서 웹 편집기에서 공급자 CLI를 직접 실행하는 경로를 추가한다.

---

## 3. 제품 결정

### 3.1 세 공급자를 1급 기능으로 지원한다

다음 provider ID를 고정한다.

```text
google-antigravity
openai-codex
anthropic-claude
```

UI 표시명은 다음과 같다.

```text
Gemini · Antigravity
Codex
Claude Code
```

내부 코드, API, 설정 파일에서는 회사명과 제품명을 포함한 안정적인 provider ID를 사용한다.

### 3.2 Antigravity 2.0 GUI를 직접 자동화하지 않는다

Google 공급자 지원은 Antigravity 2.0 데스크톱 앱의 UI를 조작하는 방식으로 구현하지 않는다.

다음 이유 때문이다.

- GUI 자동화는 운영체제와 앱 버전에 따라 불안정하다.
- 포커스와 창 상태에 의존한다.
- 실행 완료와 결과 파일을 결정적으로 감지하기 어렵다.
- 권한 요청과 사용자 상호작용을 자동화하기 어렵다.
- 테스트 자동화가 불가능에 가깝다.

Google 공급자는 Antigravity 2.0과 같은 에이전트 하네스 및 설정을 사용하는 **Antigravity CLI의 `agy` 실행 파일**을 통해 연결한다.

Antigravity 2.0만 설치되어 있고 `agy`가 없다면 웹 편집기에서 다음과 같이 안내한다.

```text
Antigravity는 설치되어 있지만 웹 편집기 연동에 필요한
Antigravity CLI(agy)를 찾을 수 없습니다.

[설치 안내 보기] [다른 AI 선택]
```

### 3.3 레거시 Gemini CLI는 필수 지원 대상이 아니다

신규 Google 연동은 `gemini` CLI가 아니라 `agy`를 기준으로 구현한다.

필요하다면 향후 `legacy-gemini-cli` 어댑터를 실험적 호환 기능으로 추가할 수 있으나, Editor AI 1.0의 필수 수용 기준에 포함하지 않는다.

### 3.4 파일 기반 결과 계약을 공급자 공통 표준으로 사용한다

세 CLI의 stdout 형식과 스트리밍 이벤트는 서로 다르며 버전에 따라 변경될 수 있다.

따라서 최종 AI 결과는 stdout을 파싱하여 얻지 않는다.

모든 공급자는 격리된 run 디렉터리에 다음 파일을 작성해야 한다.

```text
response.json
candidate.html
```

stdout과 stderr는 진행 로그와 오류 진단에만 사용한다.

### 3.5 공급자별 기능 차이를 UI 핵심 흐름에 노출하지 않는다

세 공급자는 동일한 사용자 경험을 제공해야 한다.

```text
페이지 선택
→ 수정 지시
→ 공급자 선택
→ 수정안 생성
→ 진행 상태
→ 변경 전·후 비교
→ 적용 또는 폐기
```

공급자별 명령행 인자, 로그인 저장 위치, 출력 형식, 샌드박스 방식은 adapter 내부에 감춘다.

---

## 4. 목표

### 4.1 제품 목표

1. 웹 편집기에서 현재 페이지에 AI 수정 요청을 보낼 수 있다.
2. Antigravity, Codex, Claude Code를 기본 선택지로 제공한다.
3. 설치 및 로그인 상태를 자동 감지한다.
4. 사용자가 특정 공급자를 선택하거나 자동 선택을 사용할 수 있다.
5. AI 실행 진행 상태와 실패 원인을 이해하기 쉽게 표시한다.
6. AI 수정안은 원본을 변경하지 않는 후보로 생성한다.
7. 후보 적용 전에 변경 전·후 페이지를 비교할 수 있다.
8. AI 실행 중 사용자가 페이지를 수정했으면 충돌을 감지한다.
9. 적용된 수정안은 EditorSession undo로 되돌릴 수 있다.
10. AI 공급자가 없어도 일반 편집 기능은 완전히 동작한다.

### 4.2 기술 목표

1. 공급자 공통 `AiProviderAdapter` 포트를 정의한다.
2. 세 공급자 adapter를 독립 모듈로 구현한다.
3. 공급자 감지, 실행, 취소, 로그 수집을 표준화한다.
4. AI 실행마다 격리된 run 디렉터리를 생성한다.
5. 공급자 CLI에 원본 worksheet 파일 쓰기 권한을 주지 않는다.
6. 긴 HTML을 명령행 인자로 넘기지 않는다.
7. 공급자 출력이 아닌 `response.json` 파일을 결과의 진실의 원천으로 삼는다.
8. 페이지 hash를 이용해 AI 응답 충돌을 감지한다.
9. 공급자 실패가 Editor 서버를 종료시키지 않게 한다.
10. 공급자별 버전 차이를 capability probe로 처리한다.
11. 기존 파일 큐 AI 브리지를 fallback으로 유지한다.
12. 공급자별 테스트 fixture와 fake executable을 제공한다.

---

## 5. 비목표

이번 기능에서는 다음을 구현하지 않는다.

- Antigravity 2.0 데스크톱 GUI 자동 조작
- worksheet-grab이 사용자 대신 공급자 계정에 로그인
- OAuth 토큰, API 키, 세션 쿠키 직접 저장
- 공급자 구독 및 사용량 결제 관리
- 클라우드 AI API 직접 호출
- AI 결과 자동 적용
- 여러 후보의 자동 병합
- 두 공급자를 동시에 실행하여 결과 경쟁
- 다중 페이지 일괄 재생성
- 문서 전체 AI 재생성
- AI가 원본 manifest를 직접 수정하는 기능
- AI가 worksheet 저장·PDF export를 직접 수행하는 기능
- AI가 인터넷에서 이미지를 다운로드하는 기능
- 공급자별 모델 전체 목록의 하드코딩
- 공급자 간 대화 세션 이전
- 원격 서버에서 사용자 로컬 CLI 실행

---

## 6. 선행 조건

다음 Editor 2.0 기능이 완료된 후 구현한다.

- 페이지 기반 manifest
- 안정적인 `pageId`
- `EditorSession`
- 페이지 단위 command
- `REPLACE_PAGE_HTML`
- 페이지 단위 undo/redo
- 현재 페이지 선택 상태
- Page Shell과 `page-content` 분리
- EditorSession manifest 직접 저장
- page hash 생성
- 후보 페이지 렌더링에 재사용 가능한 PageRenderer
- `ValidateWorksheet`, `BuildVariants`, `ChromeRenderer`의 재사용 경계

Editor AI 구현 과정에서 블록 기반 편집 또는 DOM 역동기화 구조를 다시 도입하지 않는다.

---

## 7. 핵심 사용자 흐름

### 7.1 최초 사용

1. 교사가 `edit-ui`로 문서를 연다.
2. Editor 서버가 세 공급자의 capability를 검사한다.
3. UI에 사용 가능한 공급자를 표시한다.
4. 설치되었지만 인증되지 않은 공급자는 `로그인 필요`로 표시한다.
5. 설치되지 않은 공급자는 비활성화하고 설치 안내를 제공한다.
6. 사용 가능한 공급자가 하나라면 자동 선택의 기본 공급자로 사용한다.
7. 사용 가능한 공급자가 없더라도 편집기는 정상적으로 열린다.

### 7.2 AI 수정안 생성

1. 교사가 페이지를 선택한다.
2. `AI로 이 페이지 수정` 버튼을 누른다.
3. 수정 요청을 입력한다.
4. 공급자를 선택한다.
5. `수정안 생성`을 누른다.
6. 서버가 현재 페이지를 run 디렉터리에 복사한다.
7. 공급자 CLI가 격리된 디렉터리에서 실행된다.
8. UI는 진행 상태와 최근 로그를 보여준다.
9. 공급자가 후보를 작성한다.
10. 서버가 후보를 검수하고 렌더링한다.
11. UI가 변경 전·후 비교 화면을 표시한다.
12. 사용자가 적용, 다시 생성, 폐기 중 하나를 선택한다.

### 7.3 충돌

1. AI 실행 중 교사가 현재 페이지를 직접 수정한다.
2. AI 응답이 도착한다.
3. 요청 당시 page hash와 현재 page hash가 다르다.
4. UI는 `AI 요청 후 페이지가 변경되었습니다`라고 표시한다.
5. 자동 적용을 금지한다.
6. 사용자는 현재본과 후보를 비교한 뒤 강제 교체하거나 폐기한다.

### 7.4 취소

1. 사용자가 실행 중 `취소`를 누른다.
2. 서버가 AbortController를 중단한다.
3. 하위 프로세스에 정상 종료 신호를 보낸다.
4. 일정 시간 후 종료되지 않으면 강제 종료한다.
5. run 상태를 `cancelled`로 변경한다.
6. 현재 페이지와 문서는 변경하지 않는다.

---

## 8. UX 요구사항

### 8.1 공급자 선택

AI 패널의 공급자 선택지는 다음 순서로 표시한다.

```text
자동 선택
Gemini · Antigravity
Codex
Claude Code
```

각 항목에 상태를 표시한다.

```text
Gemini · Antigravity   사용 가능
Codex                  로그인 필요
Claude Code            설치되지 않음
```

### 8.2 자동 선택

자동 선택은 다음 우선순위를 하드코딩하지 않는다.

사용자가 마지막으로 성공한 공급자가 현재 사용 가능하면 우선 사용한다. 그렇지 않으면 capability 결과에서 사용 가능한 첫 공급자를 사용한다.

초기 기본 순서는 설정으로 제공한다.

```json
{
  "ai": {
    "providerOrder": [
      "google-antigravity",
      "openai-codex",
      "anthropic-claude"
    ]
  }
}
```

### 8.3 모델 선택

기본 UI에서는 모델 이름을 선택하지 않는다. 각 CLI에 설정된 기본 모델을 사용한다.

고급 설정에서 공급자별 모델 문자열을 선택적으로 지정할 수 있다.

```json
{
  "ai": {
    "providers": {
      "google-antigravity": {
        "model": null
      },
      "openai-codex": {
        "model": null
      },
      "anthropic-claude": {
        "model": "sonnet"
      }
    }
  }
}
```

모델명이 빠르게 변할 수 있으므로 worksheet-grab 코드에 전체 모델 목록을 고정하지 않는다.

### 8.4 진행 상태

표준 상태 문구:

```text
요청 준비 중
현재 페이지 렌더링 중
Gemini · Antigravity 실행 중
응답 확인 중
정답 누출 검사 중
인쇄 결과 확인 중
수정안 준비 완료
```

### 8.5 비교 화면

비교 화면은 다음을 포함한다.

- 기존 페이지 렌더
- AI 후보 페이지 렌더
- 공급자 이름
- 실행 시간
- AI가 작성한 변경 요약
- 검수 오류·경고
- 적용
- 다시 생성
- 폐기
- 실행 로그 보기

---

## 9. 공통 공급자 포트

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

### 9.1 capability

```ts
type ProviderCapability = {
  providerId: string;
  installed: boolean;
  executablePath: string | null;
  version: string | null;
  authenticated: boolean | "unknown";
  nonInteractive: boolean;
  cancellable: boolean;
  supportsModelOverride: boolean;
  supportsStreamingLogs: boolean;
  reason: string | null;
};
```

### 9.2 공통 실행 입력

```ts
type ProviderInvocationInput = {
  runId: string;
  runDir: string;
  promptPath: string;
  responsePath: string;
  candidatePath: string;
  model: string | null;
  timeoutMs: number;
};
```

### 9.3 공통 프로세스 이벤트

```ts
type ProviderProcessHandlers = {
  signal: AbortSignal;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onSpawn: (pid: number) => void;
};
```

---

## 10. 공급자별 어댑터

## 10.1 Google Antigravity

### 실행 파일

```text
agy
```

### 원칙

- Antigravity 2.0 GUI가 아닌 Antigravity CLI를 실행한다.
- one-shot 비대화형 prompt 모드를 사용한다.
- 실행 디렉터리는 run 디렉터리로 제한한다.
- workspace 내부 읽기·쓰기로 작업을 완결하도록 한다.
- 원본 worksheet workspace는 쓰기 가능한 작업 디렉터리로 제공하지 않는다.
- Antigravity 설정과 인증 파일을 worksheet-grab이 직접 읽거나 복사하지 않는다.

### 개념적 실행 형태

```text
agy -p "<짧은 실행 지시>" --cwd <runDir>
```

실제 인자는 설치된 버전의 `agy --help` capability probe 결과를 기반으로 조립한다.

### 인증 상태

`agy` 실행 파일이 존재하더라도 인증 여부를 완전히 비파괴적으로 판단할 수 없을 수 있다.

probe 결과는 다음 중 하나다.

```text
authenticated: true
authenticated: false
authenticated: unknown
```

`unknown`이면 첫 실행을 허용하고, 인증 오류가 발생하면 UI를 `로그인 필요` 상태로 갱신한다.

### Google provider 수용 기준

- `agy`가 설치된 환경에서 페이지 후보를 생성한다.
- 실행 디렉터리 밖 원본 파일을 수정하지 않는다.
- 인증 오류를 일반 실행 실패와 구분한다.
- 실행 취소가 가능하다.
- Antigravity 2.0만 있고 CLI가 없을 때 설치 안내를 제공한다.

---

## 10.2 OpenAI Codex

### 실행 파일

```text
codex
```

### 원칙

- non-interactive `codex exec` 경로를 사용한다.
- 가능하면 ephemeral 실행을 사용한다.
- run 디렉터리만 쓰기 가능한 workspace로 제공한다.
- ChatGPT 로그인 또는 사용자가 설정한 Codex 인증을 그대로 사용한다.
- worksheet-grab은 Codex 인증 파일을 직접 읽지 않는다.
- stdout JSON 스키마에 최종 결과 계약을 의존하지 않는다.
- 지원 버전에서 output schema 기능을 추가 검증 수단으로 사용할 수 있지만 `response.json`이 최종 결과다.

### 개념적 실행 형태

```text
codex exec <flags> "<짧은 실행 지시>"
```

정확한 flag는 `codex exec --help` 결과로 capability를 확인한 뒤 선택한다.

### Codex provider 수용 기준

- ChatGPT 로그인 상태의 Codex CLI로 실행할 수 있다.
- API 키 기반 Codex 환경에서도 기존 CLI 설정을 존중한다.
- JSONL stdout의 버전 변화가 후보 생성 결과를 깨뜨리지 않는다.
- session history를 저장하지 않는 실행이 지원되면 사용한다.
- 실행 취소와 timeout이 동작한다.

---

## 10.3 Anthropic Claude Code

### 실행 파일

```text
claude
```

### 원칙

- print/non-interactive 모드를 사용한다.
- run 디렉터리만 편집 대상으로 제공한다.
- 기본적으로 권한을 완전히 우회하는 위험한 옵션을 사용하지 않는다.
- 실행 환경에서 `CLAUDECODE` 변수를 제거하여 중첩 실행 감지 충돌을 방지한다.
- Claude가 파일을 수정할 수 있는 범위를 run 디렉터리로 제한한다.
- stdout JSON은 진행 로그에 사용할 수 있지만 최종 결과는 `response.json`이다.

### 개념적 실행 형태

```text
claude -p <permission flags> --max-turns <N> "<짧은 실행 지시>"
```

### Claude provider 수용 기준

- Claude Code 로그인 환경에서 실행할 수 있다.
- Claude Code 안에서 worksheet-grab을 개발·실행한 경우에도 중첩 환경 오류를 처리한다.
- 권한 요청 때문에 비대화형 실행이 영구 대기하지 않는다.
- 실행 취소와 timeout이 동작한다.
- 출력 형식 변경이 후보 결과 계약에 영향을 주지 않는다.

---

## 11. Capability 감지

### 11.1 API

```http
GET /api/ai/providers
```

응답:

```json
{
  "providers": [
    {
      "id": "google-antigravity",
      "displayName": "Gemini · Antigravity",
      "installed": true,
      "version": "2.x",
      "authenticated": "unknown",
      "available": true,
      "reason": null
    },
    {
      "id": "openai-codex",
      "displayName": "Codex",
      "installed": true,
      "version": "0.x",
      "authenticated": true,
      "available": true,
      "reason": null
    },
    {
      "id": "anthropic-claude",
      "displayName": "Claude Code",
      "installed": false,
      "version": null,
      "authenticated": "unknown",
      "available": false,
      "reason": "executable-not-found"
    }
  ],
  "defaultProvider": "openai-codex"
}
```

### 11.2 감지 방법

공급자 감지는 짧은 timeout으로 다음을 수행한다.

1. PATH에서 실행 파일 탐색
2. `--version` 또는 동등한 버전 명령 실행
3. non-interactive 지원 flag 확인
4. 필요한 경우 최소 dry probe
5. 결과 캐시

### 11.3 감지 캐시

- Editor 서버 시작 시 검사
- 5분 캐시
- 사용자가 `다시 확인`을 누르면 강제 갱신
- 실제 실행 중 인증 오류가 발생하면 캐시 즉시 갱신

### 11.4 환경변수 override

```text
WORKSHEET_GRAB_AGY_BIN
WORKSHEET_GRAB_CODEX_BIN
WORKSHEET_GRAB_CLAUDE_BIN
```

사용자가 PATH에 없는 실행 파일을 지정할 수 있다.

---

## 12. Run 디렉터리

모든 AI 실행은 문서별 격리 디렉터리에서 수행한다.

```text
worksheets/<docName>/.worksheet-grab/ai-runs/<runId>/
├─ request.json
├─ prompt.md
├─ current-page.html
├─ current-page.png
├─ page-context.json
├─ style-context.css
├─ assets/
├─ response.schema.json
├─ response.json
├─ candidate.html
├─ candidate-page.html
├─ candidate-page.png
├─ candidate-page.pdf
└─ run.log
```

### 12.1 원본 보호

- 원본 manifest를 run 디렉터리에 쓰기 가능한 형태로 제공하지 않는다.
- 필요한 현재 페이지 HTML만 복사한다.
- 참조 이미지도 필요한 파일만 `assets/`에 복사한다.
- 상대경로를 유지한다.
- 후보는 run 디렉터리 안에만 작성한다.
- 성공 여부와 관계없이 원본 문서 파일은 AI 프로세스가 변경할 수 없어야 한다.

### 12.2 정리 정책

- 최근 20개 run 보존
- 적용 또는 폐기된 run은 7일 후 정리 가능
- 실패 run은 진단을 위해 로그 보존
- 인증 토큰과 환경변수 값은 로그에 기록하지 않는다.

---

## 13. 요청 계약

`request.json`:

```json
{
  "schemaVersion": 1,
  "runId": "run-...",
  "providerId": "openai-codex",
  "docName": "미디어활동지",
  "baseRevision": 12,
  "pageId": "page-6d03cfad",
  "pageVersion": "sha256:...",
  "instruction": "문항을 3개로 줄이고 문장 시작 힌트를 추가해줘.",
  "page": {
    "role": "activity",
    "contentHtmlFile": "current-page.html",
    "screenshotFile": "current-page.png"
  },
  "contextFile": "page-context.json",
  "styleFile": "style-context.css",
  "output": {
    "responseFile": "response.json",
    "candidateFile": "candidate.html"
  }
}
```

`page-context.json`에는 다음을 포함한다.

- 문서 제목
- 교과
- 학년
- 성취기준
- 용지 크기
- 방향
- 여백
- 단 수
- 현재 페이지 번호
- 전체 페이지 수
- 이전 페이지 요약
- 다음 페이지 요약
- 허용된 자산 목록
- 보호 규칙

학생 이름, 연락처 등 불필요한 개인정보는 포함하지 않는다.

---

## 14. 공급자 공통 Prompt 계약

`prompt.md`는 공급자와 무관하게 같은 핵심 지시를 사용한다.

```text
You are generating one replacement page-content candidate
for a printable Korean K-12 worksheet.

Read:
- request.json
- current-page.html
- current-page.png
- page-context.json
- style-context.css

Primary objective:
Follow the teacher's instruction in request.json.

Write:
- response.json
- candidate.html

Do not modify any input file.
Do not write outside this run directory.
Do not modify the original worksheet workspace.

candidate.html must contain only HTML that belongs inside .page-content.
Do not include html, head, body, section.sheet, header, footer,
page number, script, iframe, object, or embed elements.

Preserve the existing visual language and reuse existing CSS classes
and CSS variables whenever possible.

Teacher answers must appear only inside .answer or .plot-ans.
Do not invent achievement-standard wording.
Do not use remote image URLs.
Use only assets/... paths listed in page-context.json.
Every image must include alt text.
Keep the content printable within the supplied paper dimensions.

response.json must follow response.schema.json exactly.
```

워크시트 HTML과 사용자 입력은 신뢰할 수 없는 데이터로 경계를 표시한다. 문서 내부 텍스트가 시스템 규칙을 덮어쓰지 못하게 한다.

---

## 15. 응답 계약

`response.json`:

```json
{
  "schemaVersion": 1,
  "runId": "run-...",
  "providerId": "openai-codex",
  "pageId": "page-6d03cfad",
  "basePageVersion": "sha256:...",
  "candidateFile": "candidate.html",
  "summary": "문항을 5개에서 3개로 줄이고 문장 시작 힌트를 추가했습니다.",
  "warnings": []
}
```

### 필수 조건

- 파일이 존재해야 한다.
- UTF-8이어야 한다.
- JSON schema를 통과해야 한다.
- runId, providerId, pageId가 요청과 일치해야 한다.
- `candidateFile`은 run 디렉터리 내부의 안전한 상대경로여야 한다.
- `candidate.html`이 존재해야 한다.
- 빈 HTML을 허용하지 않는다.

공급자 프로세스가 exit code 0이어도 응답 계약을 통과하지 못하면 실패다.

---

## 16. Run 상태 모델

```text
queued
preparing
running
validating
rendering
ready
ready-with-warnings
failed
cancelled
stale
applied
discarded
```

### 상태 전이

```text
queued
→ preparing
→ running
→ validating
→ rendering
→ ready | ready-with-warnings

어느 단계에서든
→ failed | cancelled

ready 이후 현재 page hash 불일치
→ stale

ready | ready-with-warnings | stale
→ applied | discarded
```

한 문서에서 동시에 실행 가능한 AI run은 MVP에서 하나로 제한한다.

동시 요청은 `409 ai-run-busy`를 반환한다.

---

## 17. HTTP API

### 공급자 조회

```http
GET /api/ai/providers
```

### run 생성

```http
POST /api/ai/page-runs
```

요청:

```json
{
  "providerId": "google-antigravity",
  "pageId": "page-...",
  "instruction": "표를 단순화해줘.",
  "baseRevision": 12,
  "pageVersion": "sha256:...",
  "model": null
}
```

응답:

```json
{
  "runId": "run-...",
  "status": "queued"
}
```

### run 상태

```http
GET /api/ai/page-runs/:runId
```

### 로그

```http
GET /api/ai/page-runs/:runId/log
```

### 취소

```http
POST /api/ai/page-runs/:runId/cancel
```

### 폐기

```http
POST /api/ai/page-runs/:runId/discard
```

### 적용

후보 적용은 서버가 manifest를 직접 수정하지 않는다.

브라우저가 candidate를 읽고 EditorSession에 다음 command를 dispatch한다.

```ts
{
  type: "REPLACE_PAGE_HTML",
  pageId,
  beforeHtml,
  afterHtml,
  source: "ai",
  providerId,
  runId
}
```

서버에는 applied 상태 기록만 보낸다.

```http
POST /api/ai/page-runs/:runId/applied
```

---

## 18. 검수 파이프라인

공급자 실행 완료 후 서버는 다음 순서로 후보를 검사한다.

### 18.1 응답 검사

- response.json schema
- runId 일치
- providerId 일치
- pageId 일치
- basePageVersion 일치
- 안전한 candidate 경로

### 18.2 HTML 정제

- script 제거
- 이벤트 속성 제거
- javascript URL 제거
- iframe, object, embed 제거
- html, head, body 제거
- `.sheet`, 머리말, 꼬리말 금지
- 편집기 전용 속성 제거
- 외부 URL 이미지 차단
- 허용되지 않은 asset 경로 차단

### 18.3 도메인 검수

- `.answer` 밖 정답 누출
- 최소 글자 크기
- 하드코딩 교과색
- 이미지 alt
- table 구조
- 금지된 원격 자산
- 성취기준 보호

### 18.4 렌더 검수

후보를 기존 Page Shell에 넣어 단일 페이지 문서를 만든다.

- Chrome PNG 생성
- Chrome PDF 생성
- PDF 페이지 수 확인
- 1쪽 초과 여부 확인
- 폭·높이 overflow 검사

### 18.5 결과

오류가 있으면 `failed`다.

경고만 있으면 `ready-with-warnings`다.

경고 예시:

- 페이지가 2쪽으로 넘어감
- 이미지 alt 부족
- 8pt 미만 텍스트
- 여백에 가까운 요소

---

## 19. 보안과 권한

### 19.1 기본 원칙

- 공급자 CLI는 사용자 권한으로 실행된다.
- worksheet-grab은 공급자의 인증 저장소를 읽지 않는다.
- CLI 프로세스에 필요한 환경은 상속하되 로그에서 민감 값을 제거한다.
- 원본 workspace 쓰기 권한을 AI 프로세스에 제공하지 않는다.
- run 디렉터리를 최소 권한 workspace로 사용한다.
- 위험한 permission bypass 옵션은 기본 사용하지 않는다.

### 19.2 Prompt injection 방어

활동지 HTML과 페이지 텍스트는 신뢰할 수 없는 콘텐츠다.

- 시스템 규칙과 데이터 경계를 명확히 구분한다.
- `current-page.html` 내부 지시를 실행하지 말라고 명시한다.
- 공급자가 읽을 파일을 allowlist한다.
- 출력 경로를 두 파일로 제한한다.
- 후보를 반드시 sanitizer와 validator에 통과시킨다.

### 19.3 로그 정제

다음 패턴은 run.log 기록 전에 마스킹한다.

- API key 형태
- bearer token
- OAuth token
- Cookie header
- 공급자 인증 파일 내용
- 환경변수 값

---

## 20. 오류 처리

표준 오류 코드:

```text
provider-not-installed
provider-not-authenticated
provider-version-unsupported
provider-capability-unknown
provider-spawn-failed
provider-timeout
provider-cancelled
provider-exit-nonzero
response-missing
response-invalid-json
response-schema-invalid
candidate-missing
candidate-invalid-html
candidate-validation-failed
candidate-render-failed
candidate-overflow
page-version-conflict
ai-run-busy
```

UI는 공급자 원문 오류 전체를 기본 화면에 노출하지 않는다.

사용자용 메시지와 진단 세부정보를 분리한다.

```text
Claude Code 로그인이 필요합니다.
터미널에서 Claude Code를 실행해 로그인을 완료한 뒤 다시 확인하세요.

[다시 확인] [다른 AI 선택] [상세 로그]
```

---

## 21. 기존 파일 큐 fallback

기존 `.ai-bridge` 방식은 제거하지 않는다.

Provider adapter가 모두 사용 불가능하면 다음 선택지를 제공한다.

```text
직접 실행 가능한 AI 도구를 찾지 못했습니다.

별도의 AI 세션에서 처리하는 기존 연결 방식으로 요청할 수 있습니다.

[AI 세션 연결 방식 사용] [설정 확인]
```

파일 큐 fallback도 동일한 `request.json`, `response.json`, `candidate.html` 계약을 사용하도록 점진적으로 통합한다.

결과적으로 직접 CLI와 파일 큐가 같은 검수·비교·적용 흐름을 사용해야 한다.

---

## 22. 모듈 구조

```text
src/
  usecases/
    ai/
      AiPageRunService.js
      AiPageRunState.js
      PrepareAiPageRun.js
      ValidateAiCandidate.js
      ApplyAiCandidateRecord.js
      ProviderCapability.js

  adapters/
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

  editor/
    features/
      ai/
        AiPageController.js
        AiProviderSelector.js
        AiRunClient.js
        AiComparePanelView.js
        AiRunProgressView.js
```

EditorHttpServer route:

```text
src/adapters/editor-server/routes/ai-providers.js
src/adapters/editor-server/routes/ai-page-runs.js
```

---

## 23. 설정

전역 설정 예시:

```json
{
  "ai": {
    "enabled": true,
    "defaultProvider": "auto",
    "providerOrder": [
      "google-antigravity",
      "openai-codex",
      "anthropic-claude"
    ],
    "timeoutMs": 300000,
    "maxRunsPerDocument": 20,
    "providers": {
      "google-antigravity": {
        "executable": null,
        "model": null,
        "enabled": true
      },
      "openai-codex": {
        "executable": null,
        "model": null,
        "enabled": true
      },
      "anthropic-claude": {
        "executable": null,
        "model": null,
        "enabled": true
      }
    }
  }
}
```

설정 위치는 기존 worksheet-grab 전역 설정 정책과 맞춘다.

문서 manifest에 로컬 executable 경로나 로그인 정보를 기록하지 않는다.

---

## 24. 성능 요구사항

- 공급자 capability 검사: 공급자당 2초 이내
- AI run 준비: 3초 이내
- 일반 실행 timeout 기본값: 5분
- 취소 요청 후 정상 종료 대기: 5초
- 강제 종료 포함 전체 취소: 10초 이내
- run 로그 메모리 상한: 1MB
- 저장 로그 상한: 5MB
- 후보 렌더링은 기존 Chrome 단일-flight 정책 재사용
- 브라우저 새로고침 후에도 실행 상태 조회 가능

---

## 25. 테스트 전략

### 25.1 단위 테스트

- ProviderRegistry
- 공급자 선택 순서
- capability 캐시
- executable override
- run 상태 전이
- request schema
- response schema
- 안전한 경로 검사
- page hash 충돌
- 로그 마스킹
- timeout
- 취소
- provider 오류 정규화
- candidate sanitizer
- validator 결과 분류

### 25.2 Fake executable

세 공급자별 fake CLI를 테스트 fixture로 제공한다.

```text
test/fixtures/fake-providers/agy
test/fixtures/fake-providers/codex
test/fixtures/fake-providers/claude
```

지원 모드:

- 성공
- 느린 성공
- 인증 오류
- 비정상 종료
- response 누락
- 잘못된 JSON
- invalid candidate
- timeout
- cancel 무시
- stdout 대량 출력
- 민감정보 로그 출력

### 25.3 adapter contract test

세 adapter는 동일한 contract test suite를 통과해야 한다.

```text
probe detects executable
spawn starts process
logs are collected
cancel stops process
timeout stops process
response contract is read
original workspace remains unchanged
```

### 25.4 통합 테스트

- 각 공급자 fake CLI로 후보 생성
- 후보 검수
- before/after 비교 데이터
- 적용
- undo
- stale 충돌
- 폐기
- 서버 재시작 후 run 조회
- 파일 큐 fallback

### 25.5 실제 CLI smoke test

실제 CLI 테스트는 개발자 환경 의존으로 기본 CI에서는 skip한다.

환경변수가 있을 때만 실행한다.

```text
WG_TEST_REAL_AGY=1
WG_TEST_REAL_CODEX=1
WG_TEST_REAL_CLAUDE=1
```

실제 smoke test는 비용과 사용량이 발생할 수 있음을 명확히 표시한다.

---

## 26. 공급자별 수용 기준

### Antigravity

- `agy` 설치 감지
- 버전 감지
- one-shot 실행
- run 디렉터리 결과 생성
- 인증 실패 구분
- timeout
- cancel
- 원본 파일 불변

### Codex

- `codex` 설치 감지
- 버전 감지
- `codex exec` 실행
- ChatGPT 로그인 환경 재사용
- stdout 형식 변화와 무관한 결과 처리
- timeout
- cancel
- 원본 파일 불변

### Claude Code

- `claude` 설치 감지
- 버전 감지
- print mode 실행
- 기존 로그인 환경 재사용
- 중첩 환경변수 처리
- 권한 대기로 인한 hang 방지
- timeout
- cancel
- 원본 파일 불변

---

## 27. 전체 수용 기준

다음 조건을 모두 만족해야 한다.

1. Editor 2.0 페이지 기반 구조 위에서 동작한다.
2. Antigravity, Codex, Claude Code가 UI의 1급 공급자로 표시된다.
3. 세 공급자의 설치 상태를 감지한다.
4. 공급자별 인증 오류를 구분해 안내한다.
5. 브라우저에서 페이지 수정 요청을 보낼 수 있다.
6. AI가 원본 manifest를 직접 수정하지 않는다.
7. AI 프로세스는 격리된 run 디렉터리에서 실행된다.
8. 세 공급자가 같은 request/response 계약을 사용한다.
9. stdout 형식에 최종 결과를 의존하지 않는다.
10. 후보는 HTML 정제와 worksheet 검수를 통과한다.
11. 후보를 기존 Page Shell로 렌더링할 수 있다.
12. 변경 전·후 페이지를 비교할 수 있다.
13. 사용자 승인 전 현재 페이지가 변경되지 않는다.
14. 적용은 `REPLACE_PAGE_HTML` command로 수행된다.
15. 적용 후 undo할 수 있다.
16. page hash 충돌을 감지한다.
17. 실행을 취소할 수 있다.
18. timeout이 동작한다.
19. Editor 서버가 공급자 오류로 종료되지 않는다.
20. 일반 편집과 저장·PDF export는 AI 공급자 없이도 동작한다.
21. 기존 파일 큐 방식이 fallback으로 유지된다.
22. 세 adapter가 동일한 contract test를 통과한다.
23. 실제 대표 활동지에서 세 공급자별 종단 smoke test가 성공한다.

---

## 28. 구현 단계

### Phase 0 — 설계 고정과 테스트 기반

- AiProviderAdapter contract
- run 상태 모델
- request/response schema
- fake provider fixture
- security boundary test
- 기존 AI bridge characterization test

### Phase 1 — 공통 실행 기반

- RunDirectory
- RunStore
- SubprocessRunner
- timeout/cancel
- log redaction
- capability API
- provider selector UI

### Phase 2 — Claude Code adapter

- 현재 slides-grab과 worksheet-grab 경험을 활용해 첫 adapter 구현
- 후보 파일 계약
- progress UI
- 검수·비교·적용

### Phase 3 — Codex adapter

- `codex exec`
- capability probe
- 인증 오류 정규화
- adapter contract parity

### Phase 4 — Antigravity adapter

- `agy -p`
- Antigravity 2.0 사용자를 위한 CLI 안내
- 인증·권한 오류 정규화
- adapter contract parity

### Phase 5 — 자동 선택과 fallback

- 마지막 성공 공급자
- provider order
- queue fallback
- 공급자 설정 UI

### Phase 6 — 안정화

- 실제 CLI smoke test
- Windows 프로세스 종료
- 대용량 로그
- 서버 재시작 복구
- 보안 감사
- 문서화

구현 순서는 환경에 따라 Antigravity와 Codex를 바꿀 수 있으나, 공통 실행 기반을 만들기 전에 공급자별 코드를 직접 EditorHttpServer에 넣지 않는다.

---

## 29. 구현 금지사항

Claude Code는 다음 방식으로 구현해서는 안 된다.

- Antigravity 2.0 GUI를 마우스·키보드 자동화
- 공급자별 로직을 `editor.js`에 직접 작성
- 공급자별 로직을 하나의 거대한 switch 문으로 구현
- AI에게 원본 manifest 경로와 쓰기 권한 제공
- AI가 저장된 teacher/student HTML을 직접 덮어쓰기
- stdout의 자연어 응답을 정규식으로 파싱해 candidate 추출
- 인증 파일 직접 읽기
- API 키 입력창 추가
- 위험한 권한 우회 옵션을 기본 활성화
- 공급자 model 이름을 대규모 하드코딩
- AI 응답 자동 적용
- 검수 실패 후보를 정상 후보로 표시
- timeout 없이 하위 프로세스 실행
- Windows에서 프로세스 트리 종료를 고려하지 않음
- 테스트를 실제 유료 CLI 호출에 의존
- 공급자 하나의 실패가 Editor 서버 전체를 종료하게 함
- 레거시 Gemini CLI를 Google 기본 구현으로 사용

---

## 30. 권장 커밋 단위

1. `test(ai): lock existing ai bridge behavior`
2. `feat(ai-core): define provider adapter contract and run states`
3. `feat(ai-core): add isolated run directory and response contract`
4. `feat(ai-core): add subprocess timeout cancel and log redaction`
5. `feat(ai-ui): add provider capability and selector`
6. `feat(ai-claude): add Claude Code page candidate adapter`
7. `feat(ai-review): add candidate validation compare and apply`
8. `feat(ai-codex): add Codex page candidate adapter`
9. `feat(ai-antigravity): add Antigravity CLI page candidate adapter`
10. `feat(ai): add automatic provider selection`
11. `feat(ai): unify queue bridge as fallback adapter`
12. `test(ai): add cross-provider contract suite`
13. `test(ai): add Windows process and cancellation coverage`
14. `docs(ai): document provider setup and troubleshooting`

---

## 31. Definition of Done

Editor AI 1.0은 다음 종단 흐름이 세 공급자에서 각각 성공할 때 완료된다.

```text
페이지 기반 활동지 열기
→ 페이지 선택
→ AI 수정 지시 입력
→ 공급자 선택
→ 후보 생성 시작
→ 진행 상태 확인
→ 후보 응답 계약 검사
→ 정답 누출 및 인쇄 안전 검사
→ 후보 페이지 렌더링
→ 기존/후보 비교
→ 적용
→ undo
→ 다시 적용
→ 저장
→ 학생용 미리보기
→ PDF 내보내기
```

추가로 다음이 확인되어야 한다.

- AI 실행 전후 원본 workspace 파일 hash가 적용 전까지 동일하다.
- 세 공급자의 adapter 코드가 공통 contract test를 통과한다.
- 공급자 미설치·미인증·timeout·취소·잘못된 응답이 각각 올바르게 처리된다.
- Antigravity 2.0 사용자에게 `agy` 연동 요구사항이 명확히 안내된다.
- AI 공급자가 전혀 없는 환경에서도 worksheet-grab 편집기의 모든 비AI 기능이 정상 동작한다.

---

## 32. Claude Code 첫 실행 지시

이 PRD를 구현할 때 첫 작업에서는 **Phase 0과 Phase 1만 수행한다.**

코드 수정 전 다음을 보고한다.

1. 기존 AI bridge와 Editor 서버의 관련 파일
2. Editor 2.0 이후 예상되는 연결 지점
3. 새로 만들 파일
4. 기존 파일에서 이동할 책임
5. 세 공급자 adapter가 공유할 contract
6. 보안 경계
7. 테스트 계획

Phase 0과 Phase 1의 모든 테스트가 통과한 뒤에만 첫 공급자 adapter 구현을 시작한다.
