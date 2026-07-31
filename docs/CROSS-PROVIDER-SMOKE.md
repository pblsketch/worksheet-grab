# 크로스프로바이더 수동 스모크

이 문서는 교사 배포 번들을 Codex CLI와 Antigravity에서 열었을 때 `AGENTS.md` 진입 지시와
`worksheet-consult` 협의 경로가 이어지는지 확인하는 절차다. Claude의 자동 발동·5인 팀 경로는
기존 기준선이며, 두 환경은 단일 에이전트 순차 축소모드를 확인한다.

## 준비

1. 빈 출력 경로에 `node scripts/build-user-bundle.mjs <출력경로>`를 실행한다.
2. 생성된 번들 루트를 각 AI 도구에서 연다.
3. 공급자마다 새 대화와 새 작업 폴더를 사용한다.
4. 아래 여섯 항목의 실제 응답과 파일 경로를 결과 기록에 남긴다.

## Codex CLI

### 실행 절차

1. **엔진 도움말**
   - 실행: `node bin/worksheet-grab.js help`
   - Pass: 종료코드가 0이고 `pipeline`, `generate`, `doc export`가 출력된다.
2. **명시적 협의 신호**
   - 입력: `중2 과학 활동지를 같이 설계하자. 먼저 질문해줘.`
   - Pass: 초안을 만들지 않고 `worksheet-consult`로 진입해 질문을 정확히 하나만 보낸다.
3. **필드 결손 요청**
   - 새 대화 입력: `과학 활동지 만들어줘.`
   - Pass: 빠른 생성을 시작하지 않고 빠진 학년 또는 주제 중 하나만 질문한다.
4. **완결 요청의 빠른 경로**
   - 새 대화 입력: `중2 과학 광합성 활동지 만들어줘.`
   - Pass: 자동 인터뷰 없이 `worksheet-grab` 파이프라인으로 진행한다.
5. **협의 브리프**
   - 명시적 협의 대화에 학생 개인정보 없이 답을 이어 간다.
   - Pass: `_workspace/00_brief.json`이 한 번 생성되고, 파이프라인 단계는 그 파일을 새로 읽는다.
6. **성취기준 CSV 폴백**
   - 실행: `node bin/worksheet-grab.js generate 중2과학 광합성 --out smoke-out`
   - Pass: `data/achievement-standards.csv` 조회로 산출물이 생성되고 성취기준을 교사에게 묻지 않는다.

### 결과 기록

- 실행 환경: Codex CLI 0.144.4 · Node 24.15.0 · Windows · 격리 사용자 번들
- 실행 시각: 2026-07-31 14:44 KST
- 1 도움말: `[x] Pass  [ ] Fail` — 종료코드 0, `pipeline`·`generate`·`doc export` 확인
- 2 명시 신호: `[x] Pass  [ ] Fail` — Deep 협의로 진입해 빠진 주제 질문 하나만 출력
- 3 필드 결손: `[x] Pass  [ ] Fail` — 빠진 학년 질문 하나만 출력, 초안 미생성
- 4 빠른 경로: `[x] Pass  [ ] Fail` — “인터뷰 없이 빠른 경로”와 `pipeline` 실행 경로 출력
- 5 브리프: `[x] Pass  [ ] Fail` — `00_brief.json` 1개 생성 후 Codex CLI가 JSON·스키마·CSV
  근거를 읽기 전용으로 재검증해 4항목 모두 Pass
- 6 CSV 폴백: `[x] Pass  [ ] Fail` — 성취기준 3개를 조회하고 HTML 3개·매니페스트 1개 생성
- 종합: `[x] Pass  [ ] Fail`

이 검증을 실행한 상위 환경은 중첩 Codex의 파일 쓰기를 강제로 읽기 전용 처리했다. 따라서 5번은
상위 Codex 세션이 격리 번들에 brief를 한 번 생성하고, 중첩 Codex CLI가 정본 스키마·CSV·단일
파일 조건을 독립 검증하는 방식으로 분리했다. 일반 실행에서는 번들 작업 폴더에 쓰기 권한이
있어야 한다.

## Antigravity

### 실행 절차

1. **엔진 도움말**
   - 번들 루트의 터미널에서 `node bin/worksheet-grab.js help`를 실행한다.
   - Pass: 종료코드가 0이고 `pipeline`, `generate`, `doc export`가 출력된다.
2. **명시적 협의 신호**
   - 채팅 입력: `중2 과학 활동지를 같이 설계하자. 먼저 질문해줘.`
   - Pass: 초안을 만들지 않고 `worksheet-consult`로 진입해 질문을 정확히 하나만 보낸다.
3. **필드 결손 요청**
   - 새 채팅 입력: `과학 활동지 만들어줘.`
   - Pass: 빠른 생성을 시작하지 않고 빠진 학년 또는 주제 중 하나만 질문한다.
4. **완결 요청의 빠른 경로**
   - 새 채팅 입력: `중2 과학 광합성 활동지 만들어줘.`
   - Pass: 자동 인터뷰 없이 `worksheet-grab` 파이프라인으로 진행한다.
5. **협의 브리프**
   - 명시적 협의 대화에 학생 개인정보 없이 답을 이어 간다.
   - Pass: `_workspace/00_brief.json`이 한 번 생성되고, 파이프라인 단계는 그 파일을 새로 읽는다.
6. **성취기준 CSV 폴백**
   - 번들 루트의 터미널에서
     `node bin/worksheet-grab.js generate 중2과학 광합성 --out smoke-out`을 실행한다.
   - Pass: `data/achievement-standards.csv` 조회로 산출물이 생성되고 성취기준을 교사에게 묻지 않는다.

### 결과 기록

- 실행 환경:
- 실행 시각:
- 1 도움말: `[ ] Pass  [ ] Fail` — 근거:
- 2 명시 신호: `[ ] Pass  [ ] Fail` — 근거:
- 3 필드 결손: `[ ] Pass  [ ] Fail` — 근거:
- 4 빠른 경로: `[ ] Pass  [ ] Fail` — 근거:
- 5 브리프: `[ ] Pass  [ ] Fail` — 근거:
- 6 CSV 폴백: `[ ] Pass  [ ] Fail` — 근거:
- 종합: `[ ] Pass  [ ] Fail`

## 실패 판정

다음 중 하나라도 나타나면 해당 항목을 Fail로 기록한다.

- 협의 신호 또는 필드 결손인데 질문 없이 바로 초안을 만든다.
- 완결 요청인데 자동으로 긴 인터뷰를 시작한다.
- 한 응답에 질문을 여러 개 보낸다.
- 브리프를 덮어쓰거나 협의 단계가 파이프라인까지 같은 컨텍스트에서 계속 조율한다.
- 성취기준을 교사에게 묻거나 조회 근거 없이 새로 만든다.
