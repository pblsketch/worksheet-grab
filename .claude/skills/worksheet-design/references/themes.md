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

## 교과별 팔레트 (`themeName` 값 — 기본값, 조정은 렌더러/테마 CSS 쪽에서)

| 교과 | theme | --c | --c2 | --clite | --cstrip | --clabel | --cink |
|---|---|---|---|---|---|---|---|
| 국어 | green | #7cb342 | #8bc34a | #f6faf0 | #9ccc65 | #dcedc8 | #558b2e |
| 과학 | teal | #00838f | #26a69a | #e0f2f1 | #4db6ac | #b2dfdb | #00695c |
| 사회 | amber | #b8860b | #d4a017 | #fbf6e9 | #e0b84c | #f2e4bf | #8a6d0b |
| 영어 | indigo | #3949ab | #5c6bc0 | #eef0fb | #7986cb | #c5cae9 | #283593 |
| 수학 | blue | #1565c0 | #1e88e5 | #e8f1fb | #64b5f6 | #bbdefb | #0d47a1 |

- 정답 하이라이트 색(#1a5fb4)은 교과와 무관하게 고정(교사용 정답 일관성).
- 새 교과는 이 표에 행을 추가한다. 채도·명도는 흑백 인쇄에서도 대비가 남도록 중간 톤 유지.
