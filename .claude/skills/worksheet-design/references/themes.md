# 교과 테마 토큰 (references/themes.md)

교과색은 **CSS 변수로만** 주입한다. 국어색을 하드코딩하면 범교과 게이트에서 반려된다.
`:root`에 아래 변수를 넣고, 블록은 `var(--c)` 등만 참조한다.

```css
/* 공통 변수 이름 */
:root{
  --c:      /* primary (pill·강조) */;
  --c2:     /* border/title */;
  --clite:  /* 아주 옅은 배경 */;
  --cstrip: /* 표 헤더 스트립 */;
  --clabel: /* 라벨 셀 배경 */;
  --cink:   /* 진한 텍스트 강조 */;
}
```

## 교과별 팔레트 (기본값 — 조정 가능)

| 교과 | theme | --c | --c2 | --clite | --cstrip | --clabel | --cink |
|---|---|---|---|---|---|---|---|
| 국어 | green | #7cb342 | #8bc34a | #f6faf0 | #9ccc65 | #dcedc8 | #558b2e |
| 과학 | teal | #00838f | #26a69a | #e0f2f1 | #4db6ac | #b2dfdb | #00695c |
| 사회 | amber | #b8860b | #d4a017 | #fbf6e9 | #e0b84c | #f2e4bf | #8a6d0b |
| 영어 | indigo | #3949ab | #5c6bc0 | #eef0fb | #7986cb | #c5cae9 | #283593 |
| 수학 | blue | #1565c0 | #1e88e5 | #e8f1fb | #64b5f6 | #bbdefb | #0d47a1 |

- 정답 하이라이트 색(#1a5fb4)은 교과와 무관하게 고정(교사용 정답 일관성).
- 새 교과는 이 표에 행을 추가한다. 채도·명도는 흑백 인쇄에서도 대비가 남도록 중간 톤 유지.
