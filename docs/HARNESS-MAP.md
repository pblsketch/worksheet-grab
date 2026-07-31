# AI 하네스와 배포 경계

worksheet-grab은 실행 엔진과 교사용 AI 하네스를 함께 배포합니다. 개발자 개인 자동화나 테스트 기록은 사용자 번들에 포함하지 않습니다.

## 제품에 포함되는 항목

- 실행 엔진과 자산: `bin/`, `src/`, `assets/`, `blocks/`, `themes/`, `templates/`, `manifests/`, `schema/`, `data/`
- Claude Code 진입점: `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`
- Codex CLI·Antigravity 진입점: `AGENTS.md`
- 라이선스와 정제된 패키지 정보

`CLAUDE.md`와 `AGENTS.md`는 같은 제품 스킬을 가리킵니다. 활동지 내용 규칙은 진입 문서에 복제하지 않고 각 스킬과 스키마를 단일 진실 원천으로 사용합니다.

## 사용자 번들에서 제외되는 항목

- 테스트와 개발 문서
- 빌드·추출 도구
- 실험 파일과 작업 기록
- 개발자 개인용 AI 명령, 훅, 설정
- 버전 관리와 로컬 도구 상태

## 자동 검증

`scripts/build-user-bundle.mjs`는 허용 목록에 있는 제품 파일만 새 폴더로 복사합니다. 필수 파일이 없거나 출력 경로가 안전하지 않으면 기존 번들을 건드리지 않고 중단합니다.

`test/unit/harness-boundary.test.js`는 다음을 검사합니다.

1. 제품 하네스에 개발 경로, 내부 작업 코드, 로컬 절대경로가 노출되지 않는지
2. 실제 사용자 번들에 제품 진입 문서와 라이선스가 존재하는지
3. 테스트·문서·개발 설정이 사용자 번들에 섞이지 않는지
4. 번들 빌더가 저장소나 관리하지 않는 폴더를 지우지 않는지

로컬 확인:

```bash
npm run test:unit
node scripts/build-user-bundle.mjs dist/worksheet-grab-user
node dist/worksheet-grab-user/bin/worksheet-grab.js help
```

GitHub Actions도 변경마다 단위 테스트와 번들 경계를 다시 확인합니다.
