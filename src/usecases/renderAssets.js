// renderAssets — 개체 트리 렌더에 필요한 "리포지토리에서 읽어 오는 입력"의 단일 파생 지점.
//
// Phase 5(중복 렌더 경로 제거)에서 모았다. RenderObjectTree 는 FS 무지(assets 문자열을 주입받는
// 순수 함수)라, 그 앞단에서 blockRepository 를 읽어 assets 를 만드는 똑같은 4줄이 SaveDocument.
// checkpoint 와 RenderEditorShell.executeObjectTree 에 각각 있었다. knownSubjectHexes 파생도
// 같은 한 줄이 5곳(SaveDocument×2·RunPipeline·EditorHttpServer·CLI)에 흩어져 있었다.
//
// 여기 모인 것은 전부 "같은 입력 → 같은 출력"인 진짜 중복이다. 반대로 SaveDocument 의
// execute(HTML manifest)와 checkpoint(개체 트리)는 입력 스키마가 달라 중복이 아니므로 합치지 않는다.

/** RenderObjectTree/BuildVariants.executeObjectTree 에 주입할 CSS 자산 3종을 읽는다. */
export async function loadRenderAssets(blockRepository, document) {
  return {
    paperCss: await blockRepository.readAsset('paper.css'),
    blocksCss: await blockRepository.readAsset('blocks.css'),
    themeCss: document?.themeName ? await blockRepository.loadThemeCss(document.themeName) : '',
  };
}

/** ValidateWorksheet 의 교과색 시드 — 등록된 테마 팔레트의 합집합(중복 제거). */
export async function loadKnownSubjectHexes(blockRepository) {
  const themes = await blockRepository.listThemes();
  return [...new Set(themes.flatMap((t) => [...t.paletteHexes()]))];
}
