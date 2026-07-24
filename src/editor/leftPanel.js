// leftPanel.js — editor-v4 S4.3 좌측 3탭(①페이지 썸네일 ②삽입 카탈로그 ③내 블록).
//
// 탭 콘텐츠는 이미 editor.html 에 있는 컨테이너(id 로 주입)를 채운다 — 이 모듈은 렌더+이벤트
// 배선만 담당하고 문서 변형은 전부 콜백(editor.js)에 위임한다(objectFactory.js 의 순수 연산을
// editor.js 가 core/history/reflow 와 묶어 호출).

import { icon } from './icons.js';
import { CATALOG_ITEMS } from './objectFactory.js';
import { collectStyles } from './thumbs.js';

const TABS = ['pages', 'insert', 'myblocks'];

/**
 * @param {{
 *   root: HTMLElement, // 좌측 패널 루트(탭 버튼 [data-tab] + 패널 [data-panel] 을 포함)
 *   onThumbSelect: (index:number)=>void,
 *   onPageAction: (action:'duplicate'|'delete'|'add-before'|'add-after', index:number)=>void,
 *   onInsertItem: (item:object, opts:{float:boolean})=>void,
 *   fetchPresets: () => Promise<{presets:object[]}>,
 *   onPresetInsert: (preset:object)=>void,
 *   onPresetDelete: (id:string)=>void,
 * }} opts
 */
export function createLeftPanel({ root, onThumbSelect, onPageAction, onInsertItem, fetchPresets, onPresetInsert, onPresetDelete }) {
  const tabBtns = [...root.querySelectorAll('[data-tab]')];
  const panels = Object.fromEntries(TABS.map((t) => [t, root.querySelector(`[data-panel="${t}"]`)]));
  const thumbList = root.querySelector('#thumb-list');
  const insertGrid = root.querySelector('#insert-grid');
  const floatToggle = root.querySelector('#insert-float-toggle');
  const presetList = root.querySelector('#preset-list');

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
  let thumbCache = [];
  function renderThumbs(doc) {
    if (!doc) return 0;
    const sheets = [...doc.querySelectorAll('.sheet')];
    const styles = collectStyles(doc);
    while (thumbList.children.length > sheets.length) thumbList.lastElementChild.remove();
    thumbCache.length = sheets.length;

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
        li.innerHTML = '<div class="thumb-frame"><iframe sandbox="" title="페이지 미리보기"></iframe></div>'
          + '<span class="thumb-no"></span>';
        li.addEventListener('click', () => onThumbSelect(Number(li.dataset.page)));
        li.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showPageMenu(e, Number(li.dataset.page));
        });
        thumbList.appendChild(li);
      }
      li.dataset.page = String(i);
      li.querySelector('.thumb-no').textContent = String(i + 1);
      const box = li.querySelector('.thumb-frame');
      box.style.width = `${width}px`;
      box.style.height = `${Math.round(sheetH * scale)}px`;
      const frame = box.querySelector('iframe');
      frame.style.width = `${sheetW}px`;
      frame.style.height = `${sheetH}px`;
      frame.style.transform = `scale(${scale})`;
      const html = srcdocFor(doc, sheet, styles);
      if (thumbCache[i] !== html) { frame.srcdoc = html; thumbCache[i] = html; }
    });
    return sheets.length;
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

  function setActiveThumb(i) {
    [...thumbList.children].forEach((li, idx) => li.classList.toggle('active', idx === i));
  }

  function invalidateThumbs() {
    thumbCache = [];
    thumbList.replaceChildren();
  }

  // 페이지 우클릭 메뉴(복제·삭제·앞/뒤 추가) — 캔버스 우클릭 메뉴(canvasInline.js)와 별개, 얕은 팝업.
  let pageMenuEl = null;
  function closePageMenu() { pageMenuEl?.remove(); pageMenuEl = null; }
  function showPageMenu(e, index) {
    closePageMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const items = [
      ['복제', 'duplicate'], ['삭제', 'delete'], ['앞에 페이지 추가', 'add-before'], ['뒤에 페이지 추가', 'add-after'],
    ];
    for (const [label, action] of items) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => { closePageMenu(); onPageAction(action, index); });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    pageMenuEl = menu;
    setTimeout(() => document.addEventListener('click', closePageMenu, { once: true }), 0);
  }

  root.querySelector('#btn-add-page')?.addEventListener('click', () => onPageAction('add-after', null));

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
      richtext: 'type', shape: 'square', divider: 'minus', 'passage-slot': 'file', 'std-box': 'files' }[type] || 'plus';
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

  setActiveTab('pages');

  return { setActiveTab, renderThumbs, setActiveThumb, invalidateThumbs, refreshPresets, getActiveTab: () => activeTab };
}
