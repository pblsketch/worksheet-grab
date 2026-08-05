// renderAssets — 개체 트리 렌더에 필요한 "리포지토리에서 읽어 오는 입력"의 단일 파생 지점.
//
// Phase 5(중복 렌더 경로 제거)에서 모았다. RenderObjectTree 는 FS 무지(assets 문자열을 주입받는
// 순수 함수)라, 그 앞단에서 blockRepository 를 읽어 assets 를 만드는 똑같은 4줄이 SaveDocument.
// checkpoint 와 RenderEditorShell.executeObjectTree 에 각각 있었다. knownSubjectHexes 파생도
// 같은 한 줄이 5곳(SaveDocument×2·RunPipeline·EditorHttpServer·CLI)에 흩어져 있었다.
//
// 여기 모인 것은 전부 "같은 입력 → 같은 출력"인 진짜 중복이다. 반대로 SaveDocument 의
// execute(HTML manifest)와 checkpoint(개체 트리)는 입력 스키마가 달라 중복이 아니므로 합치지 않는다.

/**
 * RenderObjectTree/BuildVariants.executeObjectTree 에 주입할 CSS 자산을 읽는다.
 *
 * **무드(P2-b)**: 개체 트리 문서의 optional `document.mood` 를 themeCss 와 동형으로 해석해 `moodCss`/
 * `moodName` 을 함께 반환한다(RenderObjectTree 가 theme 레이어 뒤에 한 겹 주입). 미지정이면 repo 무드
 * 메서드를 **호출조차 하지 않고** `moodCss=''` → 미주입 → 현행 산출 그대로(무회귀). 미지 무드는 조용히
 * 무시하지 않고 닫힌 카탈로그(listMoods)로 fail-closed 차단한다 — manifest 경로(AssembleWorksheet)와 동형.
 */
export async function loadRenderAssets(blockRepository, document) {
  const assets = {
    paperCss: await blockRepository.readAsset('paper.css'),
    blocksCss: await blockRepository.readAsset('blocks.css'),
    themeCss: document?.themeName ? await blockRepository.loadThemeCss(document.themeName) : '',
    moodCss: '',
    moodName: '',
  };
  const mood = document?.mood;
  if (mood != null && mood !== '') {
    const moodName = String(mood);
    const known = await blockRepository.listMoods();
    if (!known.includes(moodName)) {
      throw new Error(`알 수 없는 무드 '${moodName}' 입니다(등록된 무드: ${known.join(', ') || '없음'}). 무드는 닫힌 목록에서만 선택합니다(fail-closed).`);
    }
    assets.moodCss = await blockRepository.loadMoodCss(moodName);
    assets.moodName = moodName;
  }
  return assets;
}

/** ValidateWorksheet 의 교과색 시드 — 등록된 테마 팔레트의 합집합(중복 제거). */
export async function loadKnownSubjectHexes(blockRepository) {
  const themes = await blockRepository.listThemes();
  return [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
}
