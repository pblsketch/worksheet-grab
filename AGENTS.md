# worksheet-grab 에이전트 진입 지침

## 활동지 초안 전 첫 판정

활동지 초안을 쓰기 전에 항상 가장 먼저 다음 두 조건을 판정하세요.

1. 사용자가 같이 설계하거나 먼저 질문해 달라는 명시적 협의 신호를 보냈는가
2. 요청에 `{교과, 학년, 주제}` 중 하나 이상이 빠졌는가

하나라도 해당하면 `.claude/skills/worksheet-consult/SKILL.md`와 그 파일이 가리키는
`references/` 자료를 그대로 따라 한 번에 한 질문씩 인터뷰하세요. 협의 결과는
`_workspace/00_brief.json`에 한 번만 쓰고 협의를 종료한 뒤, 파이프라인이 그 파일을 새로 읽어
계속하게 하세요. 성취기준은 교사에게 묻지 말고 `data/achievement-standards.csv`에서 조회해
진술하세요.

두 조건 모두 해당하지 않는 완결 요청은 인터뷰 없이 빠른 경로로 진행하세요.

Claude는 스킬 자동 발동과 5인 팀 풀모드를 사용합니다. Codex와 Antigravity는 자동 트리거가
아니며, 이 파일의 지시에 따라 단일 에이전트 순차 축소모드로 실행합니다.

## 먼저 읽을 정본

활동지를 만들거나 고치기 전에 다음 파일을 순서대로 읽고 그대로 따르세요.

1. `.claude/skills/worksheet-consult/SKILL.md`와 그 파일이 안내하는 `references/` 자료
2. `.claude/skills/worksheet-grab/SKILL.md`

행동과 산출물의 정본은 위 스킬, 스킬이 가리키는 자료, `schema/`, 엔진 도움말입니다. 이 문서는
그 내용을 다시 정의하지 않습니다.

## 다른 하네스에서의 유일한 각색

현재 하네스에 스킬이 요구하는 `TeamCreate`와 5인 팀 제어가 없으면, 팀 명령만 단일 에이전트의
순차 실행으로 번역하세요. 같은 Phase와 역할을 curriculum → plan → design → review → export
순서로 수행하고, 각 단계는 앞 단계 산출물을 새로 읽어 시작합니다. 그 밖의 지시는 각색하지 않습니다.

## 엔진 진입

```text
node bin/worksheet-grab.js <command>
node bin/worksheet-grab.js help
node bin/worksheet-grab.js list-archetypes
node bin/worksheet-grab.js pipeline <학년교과> <주제>
node bin/worksheet-grab.js generate <학년교과> <주제>
node bin/worksheet-grab.js edit <manifest> "<지시>"
node bin/worksheet-grab.js doc export <문서명>
```

gepai MCP를 쓸 수 없으면 번들된 `data/achievement-standards.csv`를 사용하세요. 다른 CSV는
`--csv` 또는 `GEPAI_CSV`로 지정합니다.

## 안전 바닥 요약

아래는 최소 안전 요약이며, 상세 정본은 위 스킬과 스키마입니다.

- 학생용 산출물에는 정답을 넣지 않습니다.
- 성취기준은 조회만 하며 새로 만들거나 바꾸지 않습니다.
- 학생 실명이나 민감한 개인정보를 요구하지 않습니다.
