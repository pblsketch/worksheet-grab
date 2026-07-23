// thumbs — 좌측 페이지 썸네일 패널(§3.1 항목 1).
//
// 각 썸네일은 sandbox iframe(srcdoc = 문서의 <style> 원문 + 해당 .sheet)을 CSS transform
// 으로 축소한 것이다. 프리셋 미리보기와 같은 방식이라 별도 렌더 엔진이 필요 없고(의존성 0),
// 실제 블록 CSS 로 그려지므로 캔버스와 어긋나지 않는다.
//
// 갱신은 시트 단위 diff 다 — 편집으로 바뀐 쪽만 srcdoc 을 다시 쓴다. 매 입력마다 전 쪽을
// 재생성하면 3쪽만 넘어가도 눈에 띄게 버벅인다.

/** 문서 <style> 원문 전부(에디터 주입분 포함) — 캔버스와 같은 그림이 나오도록. */
export function collectStyles(doc) {
  return [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
}

function srcdocFor(doc, sheet, styles) {
  // body 의 data-* (mode·subject·theme)는 CSS 변수·교과 분기의 근거라 반드시 옮긴다.
  const attrs = [...doc.body.attributes]
    .filter((a) => a.name.startsWith('data-'))
    .map((a) => `${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`)
    .join(' ');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style>
<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}
.sheet{margin:0 !important;box-shadow:none !important}</style></head>
<body ${attrs}>${sheet.outerHTML}</body></html>`;
}

/**
 * @param {{listEl: HTMLElement, onSelect: (index:number)=>void, width?: number}} opts
 */
export function createThumbs({ listEl, onSelect, width = 148 }) {
  let cache = []; // 시트별 마지막 srcdoc — 바뀐 것만 다시 그리기 위한 기준
  let activeIndex = -1;

  function render(doc) {
    if (!doc) return 0;
    const sheets = [...doc.querySelectorAll('.sheet')];
    const styles = collectStyles(doc);

    // 쪽 수가 줄면 초과분 제거(리플로우·용지 변경으로 페이지 수는 바뀔 수 있다).
    while (listEl.children.length > sheets.length) listEl.lastElementChild.remove();
    cache.length = sheets.length;

    sheets.forEach((sheet, i) => {
      const rect = sheet.getBoundingClientRect();
      const scale = rect.width ? width / rect.width : 0.19;
      let li = listEl.children[i];
      if (!li) {
        li = document.createElement('li');
        li.className = 'thumb';
        li.innerHTML = '<div class="thumb-frame"><iframe sandbox="" title="페이지 미리보기"></iframe></div>'
          + '<span class="thumb-no"></span>';
        li.addEventListener('click', () => onSelect(Number(li.dataset.page)));
        listEl.appendChild(li);
      }
      li.dataset.page = String(i);
      li.querySelector('.thumb-no').textContent = String(i + 1);

      const box = li.querySelector('.thumb-frame');
      box.style.width = `${width}px`;
      box.style.height = `${Math.round(rect.height * scale)}px`;
      const frame = box.querySelector('iframe');
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
      frame.style.transform = `scale(${scale})`;

      const html = srcdocFor(doc, sheet, styles);
      if (cache[i] !== html) { frame.srcdoc = html; cache[i] = html; }
    });
    return sheets.length;
  }

  function setActive(i) {
    if (i === activeIndex) return;
    activeIndex = i;
    [...listEl.children].forEach((li, idx) => li.classList.toggle('active', idx === i));
  }

  /** 문서가 통째로 바뀌었을 때(모드 전환·용지 변경) 캐시를 버린다. */
  function invalidate() {
    cache = [];
    listEl.replaceChildren();
    activeIndex = -1;
  }

  return { render, setActive, invalidate, activeIndex: () => activeIndex };
}
