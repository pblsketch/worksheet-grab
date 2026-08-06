# 교과 테마 토큰 (references/themes.md)


교과색은 **문서 메타의 `themeName` 필드로만 참조**한다. 디자이너/편집 스킬은 CSS를 직접 작성하지
않는다 — `03_worksheet.json` 최상위에 `themeName`(아래 표의 `theme` 열 값)을 실으면, 렌더 코어
(`RenderObjectTree`)가 `themes/${themeName}.css`를 로드해 `:root` CSS 변수를 주입한다. 국어색을
개체나 다른 필드에 하드코딩하면 범교과 게이트에서 반려된다.

렌더러가 실제로 참조하는 변수 이름(참고용 — 디자이너가 작성할 필요 없음):

```css
:root{
  --c:      /* primary (pill·강조) */;
  --c2:     /* border/title */;
  --clite:  /* 아주 옅은 배경 */;
  --cstrip: /* 표 헤더 스트립 */;
  --clabel: /* 라벨 셀 배경 */;
  --cink:   /* 진한 텍스트 강조 */;
}
```

## 팔레트 (색 축 — `themeName`, 교과와 **분리**)

색은 교과에 묶이지 않는다. **기본 팔레트는 `neutral`(차분한 slate)** 이며, 아래 교과 팔레트는 **선택형 프리셋**이다 — 교사/AI가 "색 있는 룩"을 원할 때만 `themeName` 으로 고른다(지정 안 하면 neutral). 아래 대괄호 교과 표기는 "이 색을 흔히 쓰는 맥락" 힌트일 뿐 강제가 아니다. `themeName` 값 = `themes/{name}.css` 파일명.

| 맥락 | theme | --c | --c2 | --clite | --cstrip | --clabel | --cink |
|---|---|---|---|---|---|---|---|
| (기본) | **neutral** | #475569 | #64748b | #f8fafc | #64748b | #e8edf3 | #334155 |
| 국어 | green | #7cb342 | #8bc34a | #f6faf0 | #9ccc65 | #dcedc8 | #558b2e |
| 과학 | teal | #00838f | #26a69a | #e0f2f1 | #4db6ac | #b2dfdb | #00695c |
| 사회 | amber | #b26a00 | #cc7a1a | #fbf1e2 | #dd9a4a | #f0d9b5 | #8a5200 |
| 영어 | indigo | #3949ab | #5c6bc0 | #e8eaf6 | #7986cb | #c5cae9 | #283593 |
| 수학 | blue | #1565c0 | #1e88e5 | #e8f1fb | #64b5f6 | #bbdefb | #0d47a1 |

- 정답 하이라이트 색(#1a5fb4)은 교과와 무관하게 고정(교사용 정답 일관성).
- ⚠ 위 팔레트 값은 `themes/{neutral,ko,sci,social,english}.css` 의 `:root` 가 **단일 진실원천**이다. 이 표는 그 값을 복제한 참조본이므로 CSS 변경 시 함께 갱신한다 — `test/design/design-contract.test.js` 의 드리프트 가드가 불일치를 실패로 강제한다. 수학(math) 행은 아직 `themes/math.css` 미구현(문서상 예약).
- 새 팔레트는 `themes/<name>.css` 를 추가하고 이 표에 행을 넣는다(교과와 무관한 이름 권장). 채도·명도는 흑백 인쇄에서도 대비가 남도록 중간 톤 유지. **교과는 색을 강제하지 않는다** — 색이 필요하면 팔레트를 명시 선택, 아니면 neutral.

## 무드 (디자인 축 — `mood`, P4)

무드는 교과색(`themeName`)과 **직교하는 별도의 디자인 축**이다. 같은 교과색이라도 타이포·행간·간격·
모서리·헤더 모티프를 바꿔 "한눈에 다른 디자인"을 낸다. **교과색이 "무엇을 배우는가"라면 무드는
"어떤 성격의 활동인가"** 를 표현한다.

- **AI 는 무드 이름만 고른다.** `themeName` 과 똑같은 규율이다 — 문서 메타 최상위 `mood` 필드에
  **닫힌 목록의 이름 하나**만 싣고, CSS·좌표·디자인 토큰(`--wg-*`)은 **절대 작성하지 않는다**. 렌더 코어가
  `themes/moods/${mood}.css`(`:root` 디자인 토큰 값 세트)를 로드해 주입한다.
- **닫힌 목록(단일 진실 원천 = `themes/moods/*.css` / 서버 `listMoods()`)** — 현재 5종:

  | mood | 성격 | 용도(교사 목적 매핑) |
  |---|---|---|
  | `calm` | 차분한 기본 | 일반 수업 |
  | `exam` | 시험지형(절제) | 시험·평가 |
  | `wide` | 넓은 필기 | 서술·탐구 |
  | `angular` | 각진 실무 | 발표·실무 |
  | `soft` | 둥근 파스텔 | 저학년·활동 |

- **목적→무드 자동 선택(P4)**: `worksheet-planner`가 교사의 자연어 목적에서 위 매핑으로 이름을 고르고
  근거(`moodRationale`)를 남긴다. `worksheet-designer`는 그 이름을 `document.mood` 단일 필드로 옮긴다.
- **단일 필드·fail-closed·optional**: 무드는 `manifest.mood`/`document.mood` **한 곳에서만** 흐른다(2차
  원천 금지). 목록 밖 이름은 렌더가 차단한다(fail-closed — `/mood` 라우트 400, 렌더 미지 무드 거부).
  `mood`를 비우면 무드 없음 = 현행 산출(무회귀) — 목적 근거가 약하면 억지로 고르지 않는다.
- 새 무드는 이 표가 아니라 `themes/moods/`에 CSS 파일을 추가하는 것으로 등록된다(카탈로그가 곧
  파일 목록이다). 이 문서는 그 닫힌 목록을 **참조**할 뿐 값을 정의하지 않는다.
