# templates/ — 교과 프리셋 / few-shot 시드 (강등됨)

> **위상 변경(Phase 5):** 이 디렉토리의 `*.json` 은 더 이상 "생성의 유일한 구조 원천"이 아니다.
> 동적 조립(compose + 아키타입)이 1차 경로가 되면서, 템플릿은 **프리셋(빠른 경로)** 이자
> **few-shot 시드**(designer AI 가 참고하는 예시)로 강등되었다. **삭제하지 않는다** — 여전히
> `generate`/`pipeline` 의 표준 주제·1차시용 빠른 경로로 동작한다.

## 세 가지 구조 원천의 관계
| 원천 | 역할 | 명령 |
|---|---|---|
| **아키타입** (`blocks/archetypes.json`) | 교과 초월 구조 패턴(어느 타입을 어떤 순서로). **동적 조립의 1차 원천** | `compose`, `list-archetypes` |
| **어휘 + 계약** (`blocks/vocabulary.json`) | 타입별 재사용 부품·인쇄안전 계약. 아키타입/저작이 참조 | `list-vocab`, `list-blocks` |
| **템플릿(여기)** | "얼려둔 manifest" = 미리 고정한 조립 명세. 프리셋/시드 | `generate`, `pipeline` |

## 왜 남겨두나
- **빠른 경로**: 표준 주제는 `generate`/`pipeline` 이 템플릿 프리셋으로 즉시 산출(아키타입 선택·저작 불필요).
- **few-shot 시드**: designer AI 가 `compose` 스캐폴드를 저작할 때 슬롯 구조·문투의 예시로 참고.
- **회귀 기준**: 기존 교과별 산출의 시각/구조 회귀를 지키는 앵커.

## 원칙(변경 없음)
- 성취기준 원문은 조회만(gepai CSV 1차·MCP 옵션), 창작 금지.
- 저작권 지문은 `［지문 삽입 슬롯］` 유지(실제 텍스트 채우지 않음).
- 교과색은 `themes/*.css` 토큰만. 코어 블록은 `var(--*)` 만 참조.

자세한 배경은 [../docs/HANDOFF-dynamic-composition.md](../docs/HANDOFF-dynamic-composition.md) 참고.
