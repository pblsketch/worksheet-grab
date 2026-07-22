---
name: worksheet-export
description: 검수 통과한 활동지 HTML을 학생용/교사용 2벌로 분기하고 Chrome 헤드리스로 A4 PDF(및 옵션 PNG)를 산출한다. "PDF 내보내기/출력/뽑아줘", 활동지 최종 산출 시 사용. 정답 누출 최종 grep 게이트 포함.
---

# worksheet-export (활동지 내보내기)

검수 통과(`04_review.json`의 `verdict:PASS`)를 먼저 확인한다. PASS가 아니면 내보내지 않는다.

## 엔진 배선 (권장 경로 — worksheet-grab CLI)
M1/M2 코어 엔진이 2벌 분기·정답 제거·렌더를 결정적으로 처리한다. 루트: `E:/github/worksheet-grab`.
```bash
# 1) 2벌 분기 — MODE_TOKEN 치환 + student 정답 물리 제거(display:none 아님, 원천 비노출)
node bin/worksheet-grab.js build-variants 03_worksheet.html --out out/
#    → out/03_worksheet-student.html, out/03_worksheet-teacher.html
# 2) A4 PDF 렌더 (Chrome 경로·플래그·virtual-time-budget 내장)
node bin/worksheet-grab.js render out/03_worksheet-student.html --out out/{제목}_{subject}_student.pdf
node bin/worksheet-grab.js render out/03_worksheet-teacher.html --out out/{제목}_{subject}_teacher.pdf
```
- 한 문장에서 종단으로 뽑을 때: `node bin/worksheet-grab.js pipeline <학년교과> <주제> --out out/`
  (조회→조립→2벌→검수 게이트→렌더. 게이트 실패 시 렌더 중단=fail-closed.)

## Canva 반입 (선택 — `doc export --canva`, F3)
문서 워크스페이스(`doc`)로 산출한 활동지를 Canva에서 다시 편집하고 싶을 때:
```bash
node bin/worksheet-grab.js doc export <문서명> --canva
#   → worksheets/<문서명>/worksheet-{teacher,student}-canva.html
#     (각 <section class="sheet"> 에 data-document-role="page"·data-label="…" 주석만 추가,
#      그 외 바이트는 저장본과 동일. student 는 meta.unsafe/부재 시 fail-closed 로 미생성)
```
- **반입 경로**: 위 `-canva.html`을 공개 HTTPS URL로 호스팅한 뒤 Canva 연동(`import-design-from-url`)으로
  가져온다. **사적 문서를 공개 호스팅에 올려 이 경로를 우회하지 말 것** — 정답이 담긴 교사용은 특히 주의.
- **공개 URL이 없으면**: 주석(자동 페이지 매핑)은 활용하지 못하더라도, 정직하게 PDF를 Canva UI에
  직접 업로드해 편집한다(주석 우회 없음 — 없는 기능을 있는 척 안내하지 않는다).

아래는 CLI 부재 시의 **저수준 대체(수동)** 로만 남긴다.

## 2벌 분기 (저수준 대체)
HTML은 `data-mode="MODE_TOKEN"` 토큰을 갖는다. 이를 치환해 2벌 생성:
```bash
sed 's/MODE_TOKEN/student/g' 03_worksheet.html > out-student.html
sed 's/MODE_TOKEN/teacher/g' 03_worksheet.html > out-teacher.html
```
※ 수동 sed 는 정답을 숨기기만 한다. 엔진 `build-variants` 는 student 정답을 물리 제거하므로 권장.

## 정답 누출 최종 게이트 (저수준 대체)
export 직전, student 빌드에 정답이 없는지 재확인(엔진은 `validate` 가 자동 수행):
```bash
grep -o 'class="answer"[^>]*>[^<]*' out-student.html && echo "LEAK"
```
정답 문자열이 잡히면 export 중단하고 designer/reviewer에 반려.

## PDF 렌더 (저수준 대체 — Chrome 헤드리스)
```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
for M in student teacher; do
  "$CHROME" --headless=new --disable-gpu --no-sandbox \
    --print-to-pdf="$OUT/{제목}_{subject}_${M}.pdf" \
    --print-to-pdf-no-header --virtual-time-budget=15000 \
    "file:///$OUT/out-${M}.html"
done
```
- `--virtual-time-budget=15000`: Pretendard 웹폰트·KaTeX·SVG 로딩 대기(짧으면 수식/폰트 깨짐).
- PNG 필요 시: 페이지별 `--screenshot` 또는 pdf→png 변환.

## 원칙
- 내보내기 단계에서 콘텐츠 수정 금지(사용자 지시 없는 한).
- 렌더 실패(빈 페이지·수식 누락)는 HTML을 몰래 고치지 말고 원인과 함께 designer에 반려.
- Chrome 부재 시 Playwright 대체 시도, 불가하면 정직 보고.

## 검증
렌더 후 실제 PDF를 열어(페이지 수·폰트·수식·정답 토글) 눈으로 확인한 뒤 완료로 보고한다.
