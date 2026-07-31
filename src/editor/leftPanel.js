// leftPanel.js — editor-v4 S4.3 좌측 3탭(①페이지 썸네일 ②삽입 카탈로그 ③내 블록).
//
// 탭 콘텐츠는 이미 editor.html 에 있는 컨테이너(id 로 주입)를 채운다 — 이 모듈은 렌더+이벤트
// 배선만 담당하고 문서 변형은 전부 콜백(editor.js)에 위임한다(objectFactory.js 의 순수 연산을
// editor.js 가 core/history/reflow 와 묶어 호출).

import { icon } from './icons.js';
import { CATALOG_ITEMS, ORGANIZER_INSERTS, GRAPHIC_ORGANIZER_INSERTS, SPECIAL_ORGANIZER_INSERTS } from './objectFactory.js';
import { settlePageReorder } from './pageReorder.js';
import { collectStyles } from './thumbs.js';

const TABS = ['pages', 'layers', 'insert', 'myblocks'];
const PAGE_ROLES = [
  ['', '역할 없음'],
  ['cover', '표지'],
  ['instruction', '안내'],
  ['reading', '읽기'],
  ['activity', '활동'],
  ['practice', '연습'],
  ['reflection', '성찰'],
  ['rubric', '루브릭'],
  ['answer-key', '정답'],
  ['custom', '사용자 정의'],
];

/**
 * @param {{
 *   root: HTMLElement, // 좌측 패널 루트(탭 버튼 [data-tab] + 패널 [data-panel] 을 포함)
 *   onThumbSelect: (pageId:string)=>void,
 *   onPageAction: (action:'move-up'|'move-down'|'duplicate'|'delete'|'add-before'|'add-after', pageId:string|null)=>Promise<object|null>|void,
 *   onPageRoleChange: (pageId:string, role:string|null)=>Promise<object|null>|void,
 *   onPageReorder: (pageIds:string[], movedPageId:string)=>Promise<object|null>|void,
 *   onInsertItem: (item:object, opts:{float:boolean})=>void,
 *   fetchPresets: () => Promise<{presets:object[]}>,
 *   onPresetInsert: (preset:object)=>void,
 *   onPresetDelete: (id:string)=>void,
 * }} opts
 */
export function createLeftPanel({
  root,
  onThumbSelect,
  onPageAction,
  onPageRoleChange,
  onPageReorder,
  onInsertItem,
  onInsertOrganizer = () => {},
  fetchPresets,
  onPresetInsert,
  onPresetDelete,
  onLayerSelect = () => {},
  onLayerReorder = () => {},
  onPagesSelect = () => {},
}) {
  const tabBtns = [...root.querySelectorAll('[data-tab]')];
  const panels = Object.fromEntries(TABS.map((t) => [t, root.querySelector(`[data-panel="${t}"]`)]));
  const thumbList = root.querySelector('#thumb-list');
  const insertGrid = root.querySelector('#insert-grid');
  const organizerGrid = root.querySelector('#organizer-grid');
  const floatToggle = root.querySelector('#insert-float-toggle');
  const presetList = root.querySelector('#preset-list');
  const layerList = root.querySelector('#layer-list');

  let activeTab = 'pages';
  function setActiveTab(tab) {
    activeTab = TABS.includes(tab) ? tab : 'pages';
    root.dataset.leftTab = activeTab;
    for (const btn of tabBtns) btn.classList.toggle('active', btn.dataset.tab === activeTab);
    for (const t of TABS) panels[t].classList.toggle('hidden', t !== activeTab);
    if (activeTab === 'myblocks') refreshPresets();
  }
  for (const btn of tabBtns) btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));

  // ── ① 페이지 썸네일 ──
  let thumbCache = new Map();
  let dragState = null;
  let suppressClick = false;
  // M2(여러 페이지 grab): Ctrl/Cmd-클릭으로 페이지를 다중선택한다. 이 집합이 비면 단일 활성 페이지
  // 흐름(onThumbSelect)만 쓰이고, 2개 이상이면 AI 패널이 그 페이지들 전체를 대상으로 연다(editor.js).
  const selectedPageIds = new Set();
  function refreshMultiSelVisual() {
    for (const li of thumbList.children) {
      const on = selectedPageIds.has(li.dataset.pageId);
      li.classList.toggle('multi-selected', on);
      if (on) li.setAttribute('aria-selected', 'true'); else li.removeAttribute('aria-selected');
    }
  }

  function renderThumbs(doc, pages = []) {
    if (!doc) return 0;
    const sheets = [...doc.querySelectorAll('.sheet')];
    const pageById = new Map(pages.map((page) => [page.id, page]));
    const styles = collectStyles(doc);
    while (thumbList.children.length > sheets.length) thumbList.lastElementChild.remove();
    const livePageIds = new Set(sheets.map((sheet) => sheet.dataset.pageId).filter(Boolean));
    for (const pageId of thumbCache.keys()) {
      if (!livePageIds.has(pageId)) thumbCache.delete(pageId);
    }
    for (const pid of [...selectedPageIds]) {
      if (!livePageIds.has(pid)) selectedPageIds.delete(pid); // 삭제된 페이지는 다중선택에서도 빠진다(M2)
    }

    const view = doc.defaultView;
    sheets.forEach((sheet, i) => {
      // 치수 산출(#4): 최초 렌더는 teacher iframe 이 아직 hidden 이라 getBoundingClientRect 가 0 을 줘
      // 썸네일이 가로줄로 납작해졌다. rect 가 0 이면 computed style(줌 무관 레이아웃 폭)로, 그마저
      // 0 이면 A4 96dpi(794×1123) 로 폴백한다 — 프레임이 보이게 되면 editor.js 가 한 번 더 그린다.
      const rect = sheet.getBoundingClientRect();
      let sheetW = rect.width;
      let sheetH = rect.height;
      if (!sheetW || !sheetH) {
        const cs = view ? view.getComputedStyle(sheet) : null;
        sheetW = (cs && parseFloat(cs.width)) || sheetW;
        sheetH = (cs && parseFloat(cs.height)) || sheetH;
      }
      if (!sheetW || !sheetH) { sheetW = 794; sheetH = 1123; }
      const width = 148;
      const scale = width / sheetW;
      let li = thumbList.children[i];
      if (!li) {
        li = document.createElement('li');
        li.className = 'thumb';
        li.tabIndex = 0;
        li.innerHTML = '<div class="thumb-frame"><iframe sandbox="" title="페이지 미리보기"></iframe></div>'
          + '<div class="thumb-meta"><span class="thumb-no"></span>'
          + '<select class="thumb-role"></select><button type="button" class="thumb-menu" aria-label="페이지 명령">⋯</button></div>';
        li.addEventListener('click', (event) => {
          if (suppressClick || event.target.closest('button,select')) return;
          const pageId = li.dataset.pageId;
          if (event.metaKey || event.ctrlKey) {
            // Ctrl/Cmd-클릭 = 다중선택 토글(M2). 단일 선택(onThumbSelect) 흐름은 건드리지 않는다.
            if (selectedPageIds.has(pageId)) selectedPageIds.delete(pageId);
            else selectedPageIds.add(pageId);
            refreshMultiSelVisual();
            onPagesSelect([...selectedPageIds]);
            return;
          }
          // 평범한 클릭 = 다중선택을 풀고(있었다면) 기존 단일 선택으로 돌아간다.
          if (selectedPageIds.size) { selectedPageIds.clear(); refreshMultiSelVisual(); onPagesSelect([]); }
          onThumbSelect(pageId);
        });
        li.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showPageMenu(e, li.dataset.pageId);
        });
        li.addEventListener('pointerdown', (event) => startThumbDrag(event, li));
        li.addEventListener('keydown', (event) => onThumbKeydown(event, li));
        li.querySelector('.thumb-menu').addEventListener('click', (event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          showPageMenu({ clientX: rect.left, clientY: rect.bottom, preventDefault() {} }, li.dataset.pageId);
        });
        li.querySelector('.thumb-role').addEventListener('click', (event) => event.stopPropagation());
        li.querySelector('.thumb-role').addEventListener('change', (event) => {
          const role = event.currentTarget.value || null;
          Promise.resolve(onPageRoleChange(li.dataset.pageId, role)).then(() => focusPage(li.dataset.pageId));
        });
        thumbList.appendChild(li);
      }
      const pageId = sheet.dataset.pageId || pages[i]?.id || '';
      li.dataset.page = String(i);
      li.dataset.pageId = pageId;
      li.classList.toggle('multi-selected', selectedPageIds.has(pageId)); // M2 다중선택 시각 상태 유지
      li.setAttribute('aria-label', `${i + 1}페이지`);
      li.querySelector('.thumb-no').textContent = String(i + 1);
      renderRoleOptions(li.querySelector('.thumb-role'), pageById.get(pageId)?.role);
      const box = li.querySelector('.thumb-frame');
      box.style.width = `${width}px`;
      box.style.height = `${Math.round(sheetH * scale)}px`;
      const frame = box.querySelector('iframe');
      frame.style.width = `${sheetW}px`;
      frame.style.height = `${sheetH}px`;
      frame.style.transform = `scale(${scale})`;
      const html = srcdocFor(doc, sheet, styles);
      if (thumbCache.get(pageId) !== html) { frame.srcdoc = html; thumbCache.set(pageId, html); }
    });
    return sheets.length;
  }

  function renderRoleOptions(select, currentRole) {
    const roles = [...PAGE_ROLES];
    if (currentRole && !PAGE_ROLES.some(([value]) => value === currentRole)) {
      roles.splice(1, 0, [currentRole, `기존 역할: ${currentRole}`]);
    }
    select.replaceChildren(...roles.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = (currentRole || '') === value;
      return option;
    }));
    const pageNumber = Number(select.closest('.thumb')?.dataset.page || 0) + 1;
    select.setAttribute('aria-label', `${pageNumber}페이지 역할`);
  }

  function srcdocFor(doc, sheet, styles) {
    const attrs = [...doc.body.attributes]
      .filter((a) => a.name.startsWith('data-'))
      .map((a) => `${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`)
      .join(' ');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style>
<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}.sheet{margin:0 !important;box-shadow:none !important}</style></head>
<body ${attrs}>${sheet.outerHTML}</body></html>`;
  }

  function setActivePage(pageId) {
    for (const li of thumbList.children) {
      const active = !!pageId && li.dataset.pageId === pageId;
      li.classList.toggle('active', active);
      if (active) li.setAttribute('aria-current', 'page');
      else li.removeAttribute('aria-current');
    }
  }

  function focusPage(pageId) {
    thumbList.querySelector(`[data-page-id="${escapeSelector(pageId)}"]`)?.focus();
  }

  function revealPage(result, fallbackPageId, focusPageId = null) {
    const pageId = result?.activePageId || fallbackPageId;
    if (!pageId) return;
    onThumbSelect(pageId);
    focusPage(focusPageId || pageId);
  }

  function invalidateThumbs() {
    thumbCache = new Map();
    thumbList.replaceChildren();
  }

  function escapeSelector(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
  }

  function startThumbDrag(event, li) {
    if (event.button !== 0 || event.target.closest('button,select,input,textarea')) return;
    event.preventDefault();
    dragState = {
      li,
      pageId: li.dataset.pageId,
      pointerId: event.pointerId,
      startY: event.clientY,
      initialOrder: [...thumbList.children].map((item) => item.dataset.pageId),
      moved: false,
    };
    try { thumbList.setPointerCapture(event.pointerId); } catch {}
  }

  function clearDropState() {
    for (const li of thumbList.children) li.classList.remove('drop-target');
  }

  function restoreThumbOrder(pageIds) {
    for (const pageId of pageIds) {
      const item = thumbList.querySelector(`[data-page-id="${escapeSelector(pageId)}"]`);
      if (item) thumbList.appendChild(item);
    }
  }

  function moveDraggedThumb(clientY) {
    const { li } = dragState;
    const siblings = [...thumbList.children].filter((item) => item !== li);
    const before = siblings.find((item) => clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
    thumbList.insertBefore(li, before || null);
    clearDropState();
    li.classList.add('drop-target');
  }

  function finishThumbDrag(event) {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) return;
    const state = dragState;
    dragState = null;
    clearDropState();
    state.li.classList.remove('dragging');
    if (!state.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const pageIds = [...thumbList.children].map((li) => li.dataset.pageId);
    if (pageIds.some((id, index) => id !== state.initialOrder[index])) {
      settlePageReorder(
        () => onPageReorder(pageIds, state.pageId),
        {
          onSuccess: (result) => revealPage(result, state.pageId, state.pageId),
          onRollback: () => {
            restoreThumbOrder(state.initialOrder);
            focusPage(state.pageId);
          },
          onError: (error) => {
            console.error('페이지 순서 변경 실패:', error);
          },
        },
      );
    }
  }

  function cancelThumbDrag(event) {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) return;
    const state = dragState;
    dragState = null;
    restoreThumbOrder(state.initialOrder);
    clearDropState();
    state.li.classList.remove('dragging');
  }

  thumbList.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (!dragState.moved && Math.abs(event.clientY - dragState.startY) < 5) return;
    dragState.moved = true;
    dragState.li.classList.add('dragging');
    moveDraggedThumb(event.clientY);
    event.preventDefault();
  });
  thumbList.addEventListener('pointerup', finishThumbDrag);
  thumbList.addEventListener('pointercancel', cancelThumbDrag);
  thumbList.addEventListener('lostpointercapture', cancelThumbDrag);

  function onThumbKeydown(event, li) {
    if (event.target !== li) return;
    const items = [...thumbList.children];
    const index = items.indexOf(li);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (!items[to]) return;
      const pageIds = items.map((item) => item.dataset.pageId);
      const [movedId] = pageIds.splice(index, 1);
      pageIds.splice(to, 0, movedId);
      settlePageReorder(
        () => onPageReorder(pageIds, movedId),
        {
          onSuccess: (result) => revealPage(result, movedId, movedId),
          onRollback: () => focusPage(movedId),
          onError: (error) => {
            console.error('페이지 순서 변경 실패:', error);
          },
        },
      );
      return;
    }
    let target = null;
    if (event.key === 'ArrowUp') target = items[index - 1];
    else if (event.key === 'ArrowDown') target = items[index + 1];
    else if (event.key === 'Home') target = items[0];
    else if (event.key === 'End') target = items.at(-1);
    else if (event.key === 'Enter' || event.key === ' ') target = li;
    else if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      const rect = li.getBoundingClientRect();
      showPageMenu({ clientX: rect.left, clientY: rect.top, preventDefault() {} }, li.dataset.pageId);
      return;
    }
    if (!target) return;
    event.preventDefault();
    target.focus();
    onThumbSelect(target.dataset.pageId);
  }

  // 페이지 우클릭 메뉴(복제·삭제·앞/뒤 추가) — 캔버스 우클릭 메뉴(canvasInline.js)와 별개, 얕은 팝업.
  let pageMenuEl = null;
  function closePageMenu() { pageMenuEl?.remove(); pageMenuEl = null; }
  function showPageMenu(e, pageId) {
    closePageMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const items = [
      ['앞으로 이동', 'move-up'], ['뒤로 이동', 'move-down'], ['복제', 'duplicate'], ['삭제', 'delete'],
      ['앞에 페이지 추가', 'add-before'], ['뒤에 페이지 추가', 'add-after'],
    ];
    for (const [label, action] of items) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', () => {
        closePageMenu();
        Promise.resolve(onPageAction(action, pageId)).then((result) => revealPage(result, pageId));
      });
      menu.appendChild(btn);
    }
    menu.addEventListener('keydown', (event) => {
      const buttons = [...menu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      let target = null;
      if (event.key === 'ArrowDown') target = buttons[(index + 1) % buttons.length];
      else if (event.key === 'ArrowUp') target = buttons[(index - 1 + buttons.length) % buttons.length];
      else if (event.key === 'Home') target = buttons[0];
      else if (event.key === 'End') target = buttons.at(-1);
      else if (event.key === 'Escape') {
        event.preventDefault();
        closePageMenu();
        focusPage(pageId);
        return;
      } else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
        event.preventDefault();
        buttons[index].click();
        return;
      }
      if (!target) return;
      event.preventDefault();
      target.focus();
    });
    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    const viewportGap = 8;
    menu.style.left = `${Math.min(Math.max(e.clientX, viewportGap), window.innerWidth - menuRect.width - viewportGap)}px`;
    menu.style.top = `${Math.min(Math.max(e.clientY, viewportGap), window.innerHeight - menuRect.height - viewportGap)}px`;
    pageMenuEl = menu;
    menu.querySelector('button')?.focus();
    setTimeout(() => document.addEventListener('click', closePageMenu, { once: true }), 0);
  }

  root.querySelector('#btn-add-page')?.addEventListener('click', () => {
    Promise.resolve(onPageAction('add-after', null)).then((result) => revealPage(result, null));
  });

  // ── ② 삽입 카탈로그(10종 + qtype 7종, 닫힌 목록) ──
  for (const item of CATALOG_ITEMS) {
    const btn = document.createElement('button');
    btn.className = 'insert-card';
    btn.type = 'button';
    btn.dataset.insertKey = item.key;
    btn.innerHTML = `${icon(iconFor(item.type))}<span>${item.label}</span>`;
    btn.title = item.floatOnly ? `${item.label}(자유 배치 전용)` : item.label;
    btn.addEventListener('click', () => {
      const float = item.floatOnly || (item.floatable && !!floatToggle?.checked);
      onInsertItem(item, { float });
    });
    insertGrid.appendChild(btn);
  }
  function iconFor(type) {
    return { title: 'type', question: 'list', table: 'table', 'image-slot': 'image', 'answer-area': 'square',
      richtext: 'type', shape: 'square', divider: 'minus', 'passage-slot': 'file', 'std-box': 'files', callout: 'highlighter' }[type] || 'plus';
  }

  // ── ②' 시각 조직자 삽입 — 표형은 미리 채운 table 개체(P1a), 그림형(SVG)은 richtext 잠금 삽입(P2).
  //      새 개체 타입 없이·스키마 무변경. 클릭 → onInsertOrganizer(key) → 엔진이 개체를 구성한다. ──
  if (organizerGrid) {
    const renderOrg = (desc, iconName) => {
      const btn = document.createElement('button');
      btn.className = 'insert-card';
      btn.type = 'button';
      btn.dataset.organizerKey = desc.key;
      btn.innerHTML = `${icon(iconName)}<span>${desc.label}</span>`;
      btn.title = desc.label;
      btn.addEventListener('click', () => onInsertOrganizer(desc.key));
      organizerGrid.appendChild(btn);
    };
    for (const desc of ORGANIZER_INSERTS) renderOrg(desc, 'table');
    for (const desc of GRAPHIC_ORGANIZER_INSERTS) renderOrg(desc, 'image');
    for (const desc of SPECIAL_ORGANIZER_INSERTS) renderOrg(desc, 'square');
  }

  // ── ③ 내 블록(/presets 재배선) ──
  async function refreshPresets() {
    presetList.replaceChildren();
    let data;
    try { data = await fetchPresets(); } catch { data = { presets: [] }; }
    for (const preset of data.presets || []) {
      const li = document.createElement('li');
      li.className = 'preset-item';
      li.dataset.presetId = preset.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.textContent = preset.name || preset.id;
      btn.addEventListener('click', () => onPresetInsert(preset));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPresetMenu(e, preset);
      });
      li.appendChild(btn);
      presetList.appendChild(li);
    }
    root.dataset.presetCount = String((data.presets || []).length);
  }

  let presetMenuEl = null;
  function closePresetMenu() { presetMenuEl?.remove(); presetMenuEl = null; }
  function showPresetMenu(e, preset) {
    closePresetMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const btn = document.createElement('button');
    btn.textContent = '삭제';
    btn.addEventListener('click', () => { closePresetMenu(); onPresetDelete(preset.id).then(refreshPresets); });
    menu.appendChild(btn);
    document.body.appendChild(menu);
    presetMenuEl = menu;
    setTimeout(() => document.addEventListener('click', closePresetMenu, { once: true }), 0);
  }

  // ── ④ 레이어(현재 페이지 개체 목록) ──
  // 파생 뷰: editor.js 가 활성 페이지 개체를 items 로 넘겨 렌더만 한다(선택·z-순서 조작은 콜백).
  // items: {id, type, label, placement}[]. selectedIds: Set. front(배열 뒤 float)일수록 위에 온다.
  function renderLayers(items = [], selectedIds = new Set()) {
    layerList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'layer-empty';
      empty.textContent = '이 페이지에 개체가 없습니다.';
      layerList.appendChild(empty);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'layer-item';
      li.dataset.oid = item.id;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      if (selectedIds.has(item.id)) li.classList.add('active');
      li.innerHTML = icon(iconFor(item.type));
      const label = document.createElement('span');
      label.className = 'layer-label';
      label.textContent = item.label || item.type;
      li.appendChild(label);
      if (item.placement === 'float') {
        const badge = document.createElement('span');
        badge.className = 'layer-badge';
        badge.textContent = '자유';
        li.appendChild(badge);
        const z = document.createElement('div');
        z.className = 'layer-z';
        const up = document.createElement('button');
        up.type = 'button'; up.title = '한 단계 앞으로'; up.textContent = '▲';
        up.addEventListener('click', (event) => { event.stopPropagation(); onLayerReorder(item.id, 'forward'); });
        const down = document.createElement('button');
        down.type = 'button'; down.title = '한 단계 뒤로'; down.textContent = '▼';
        down.addEventListener('click', (event) => { event.stopPropagation(); onLayerReorder(item.id, 'backward'); });
        z.appendChild(up); z.appendChild(down);
        li.appendChild(z);
      }
      li.addEventListener('click', () => onLayerSelect(item.id));
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onLayerSelect(item.id); }
      });
      layerList.appendChild(li);
    }
  }

  setActiveTab('pages');

  return {
    setActiveTab,
    renderThumbs,
    renderLayers,
    setActivePage,
    focusPage,
    invalidateThumbs,
    refreshPresets,
    getActiveTab: () => activeTab,
  };
}
