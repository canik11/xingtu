// 全局宽松搜索：顶栏输入，结果按标题/正文/分类命中，用户点选后进入对应局部图。
// 搜索只读数据，不创建节点、不修改关系。
import { noteToText } from '@starmap/core';
import { el, esc } from '../lib/dom.js';
import { getOutline, pathOf } from '../outline.js';
import { enterLocal } from '../navigation.js';
import { index } from '../store.js';

const RESULT_LIMIT = 80;
const TYPE_NAMES = { 1: '课程', 2: '章节', 3: '知识点' };
const state = {
  query: '',
  whole: '',
  tokens: [],
  results: [],
  total: 0,
  loose: false,
  active: -1,
  bound: false
};

let indexCache = null;

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryName(id) {
  const category = id ? index.getCategory(id) : null;
  return category ? category.name : '';
}

function highlight(text, tokens) {
  const raw = String(text || '');
  if (!raw) return '';
  const words = [...new Set(tokens.map((t) => t.toLowerCase()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (!words.length) return esc(raw);
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  let out = '';
  let last = 0;
  let match;
  while ((match = pattern.exec(raw))) {
    if (match.index > last) out += esc(raw.slice(last, match.index));
    out += `<mark>${esc(match[0])}</mark>`;
    last = match.index + match[0].length;
    if (!match[0]) pattern.lastIndex += 1;
  }
  return out + esc(raw.slice(last));
}

function makeSnippet(entry, tokens, whole) {
  const source = cleanText(entry.content || entry.meta);
  if (!source) return '';
  const lower = source.toLowerCase();
  let at = -1;
  if (whole && lower.includes(whole)) at = lower.indexOf(whole);
  if (at < 0) {
    for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
      const found = lower.indexOf(token);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - 34);
  const end = Math.min(source.length, at + 110);
  let out = source.slice(start, end);
  if (start > 0) out = `…${out}`;
  if (end < source.length) out = `${out}…`;
  return out;
}

function collectEntries() {
  const outline = getOutline();
  if (indexCache && indexCache.outline === outline) return indexCache.entries;

  const entries = outline.all.map((entity) => {
    const title = entity.name || '未命名';
    const isCourse = entity.level === 1;
    const content = noteToText(isCourse ? entity.node?.note : entity.block?.children);
    const meta = [
      cleanText(isCourse ? entity.desc || entity.node?.desc : ''),
      categoryName(entity.cat)
    ].filter(Boolean).join(' ');
    const titleNorm = normalize(title);
    const contentNorm = normalize(content);
    const metaNorm = normalize(meta);
    return {
      entity,
      title,
      desc: meta,
      titleNorm,
      contentNorm,
      metaNorm,
      hayNorm: normalize(`${title} ${content} ${meta}`)
    };
  });

  indexCache = { outline, entries };
  return entries;
}

function scoreEntry(entry, tokens, whole, loose) {
  const allHay = tokens.every((token) => entry.hayNorm.includes(token));
  const anyHay = tokens.some((token) => entry.hayNorm.includes(token));
  if (!(loose ? anyHay : allHay)) return null;

  const titleAll = tokens.every((token) => entry.titleNorm.includes(token));
  const contentAll = tokens.every((token) => entry.contentNorm.includes(token));
  const metaAll = tokens.every((token) => entry.metaNorm.includes(token));
  const titleWhole = Boolean(whole) && entry.titleNorm.includes(whole);
  const contentWhole = Boolean(whole) && entry.contentNorm.includes(whole);

  let score = 60;
  if (titleAll) {
    if (titleWhole && entry.titleNorm === whole) score = 310;
    else if (titleWhole && entry.titleNorm.startsWith(whole)) score = 280;
    else if (titleWhole) score = 250;
    else score = 210;
  } else if (contentAll) {
    score = contentWhole ? 130 : 100;
  } else if (metaAll) {
    score = 55;
  } else if (!allHay) {
    score = 15;
  }

  return {
    ...entry,
    score,
    loose,
    snippet: makeSnippet(entry, tokens, whole)
  };
}

function rankEntries(entries) {
  return entries.sort((a, b) => (
    b.score - a.score
    || a.title.length - b.title.length
    || a.entity.level - b.entity.level
    || a.title.localeCompare(b.title, 'zh-CN')
  ));
}

function runSearch(whole, tokens) {
  const entries = collectEntries();
  let hits = [];
  for (const entry of entries) {
    const hit = scoreEntry(entry, tokens, whole, false);
    if (hit) hits.push(hit);
  }
  let loose = false;
  if (!hits.length && tokens.length > 1) {
    loose = true;
    for (const entry of entries) {
      const hit = scoreEntry(entry, tokens, whole, true);
      if (hit) hits.push(hit);
    }
  }
  rankEntries(hits);
  return { hits, loose };
}

function breadcrumb(entity) {
  const path = pathOf(entity.id).slice(0, -1).map((item) => item.name).filter(Boolean);
  if (path.length) return path.join(' / ');
  return categoryName(entity.cat) || TYPE_NAMES[entity.level] || '';
}

function resultHtml(hit, index) {
  const level = hit.entity.level;
  const crumb = breadcrumb(hit.entity);
  return `<button
    type="button"
    class="search-hit is-level-${level}${index === state.active ? ' is-active' : ''}"
    data-index="${index}"
    role="option"
    aria-selected="${index === state.active ? 'true' : 'false'}"
    id="searchHit${index}"
  >
    <span class="search-hit-type">${TYPE_NAMES[level] || '知识'}</span>
    <span class="search-hit-main">
      <span class="search-hit-title">${highlight(hit.title, state.tokens)}</span>
      ${crumb ? `<span class="search-hit-crumb">${esc(crumb)}</span>` : ''}
      ${hit.snippet ? `<span class="search-hit-snippet">${highlight(hit.snippet, state.tokens)}</span>` : ''}
    </span>
  </button>`;
}

function renderEmpty(text, title = '') {
  el.searchResults.innerHTML = `<div class="search-empty">${title ? `<b>${esc(title)}</b>` : ''}${esc(text)}</div>`;
  el.searchInput.removeAttribute('aria-activedescendant');
  state.active = -1;
}

function setActive(index) {
  const items = [...el.searchResults.querySelectorAll('.search-hit')];
  if (!items.length) {
    state.active = -1;
    el.searchInput.removeAttribute('aria-activedescendant');
    return;
  }
  const next = Math.max(0, Math.min(index, items.length - 1));
  state.active = next;
  items.forEach((item, i) => {
    const active = i === next;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  el.searchInput.setAttribute('aria-activedescendant', items[next].id);
  items[next].scrollIntoView({ block: 'nearest' });
}

function renderResults() {
  const hasQuery = Boolean(state.query.trim());
  el.searchBox.classList.toggle('has', hasQuery);
  el.searchClear.hidden = !state.query;
  el.searchCount.hidden = !hasQuery;

  if (!hasQuery) {
    el.searchSummary.textContent = '输入标题或正文中的任意片段';
    renderEmpty('不需要完整匹配；空格分隔多个关键词，命中任意一个即可显示。');
    return;
  }

  el.searchCount.textContent = state.total > 99 ? '99+' : String(state.total);
  el.searchCount.classList.toggle('zero', state.total === 0);

  if (!state.results.length) {
    el.searchSummary.textContent = state.loose ? '没有匹配的结果' : '没有找到匹配内容';
    renderEmpty('试试更短的关键词，或者只输入标题/正文里的几个字。', '没有找到匹配内容');
    return;
  }

  const truncated = state.total > RESULT_LIMIT;
  el.searchSummary.textContent = [
    `共 ${state.total} 个结果`,
    state.loose ? '已放宽为任一关键词' : '',
    truncated ? `显示前 ${RESULT_LIMIT} 个` : ''
  ].filter(Boolean).join(' · ');
  el.searchResults.innerHTML = state.results.map(resultHtml).join('');
  setActive(state.active >= 0 ? state.active : 0);
}

function updateSearch() {
  state.query = el.searchInput.value;
  state.whole = normalize(state.query).replace(/\s+/g, ' ').trim();
  state.tokens = state.whole ? state.whole.split(' ').filter(Boolean) : [];
  state.total = 0;
  state.results = [];
  state.loose = false;

  if (!state.tokens.length) {
    renderResults();
    return;
  }

  const { hits, loose } = runSearch(state.whole, state.tokens);
  state.total = hits.length;
  state.results = hits.slice(0, RESULT_LIMIT);
  state.loose = loose;
  renderResults();
}

function positionPopup() {
  if (!el.searchPop || el.searchPop.hidden) return;
  const rect = el.searchBox.getBoundingClientRect();
  const width = Math.max(280, Math.min(560, window.innerWidth - 24));
  const maxLeft = Math.max(12, window.innerWidth - width - 12);
  const left = Math.max(12, Math.min(Math.round(rect.right - width), maxLeft));
  el.searchPop.style.width = `${width}px`;
  el.searchPop.style.left = `${left}px`;
  el.searchPop.style.top = `${Math.round(rect.bottom + 10)}px`;
}

function openPop() {
  if (!el.searchPop) return;
  document.body.classList.add('searching');
  el.searchPop.hidden = false;
  positionPopup();
  el.searchInput.setAttribute('aria-expanded', 'true');
}

function closePop() {
  if (!el.searchPop || el.searchPop.hidden) return;
  el.searchPop.hidden = true;
  el.searchInput.setAttribute('aria-expanded', 'false');
  el.searchInput.removeAttribute('aria-activedescendant');
  document.body.classList.remove('searching');
}

function choose(index) {
  const hit = state.results[index];
  if (!hit) return;
  closePop();
  el.searchInput.blur();
  enterLocal(hit.entity.id, { openSidebar: true, from3D: true });
}

function anotherModalOpen() {
  return Boolean(document.querySelector(
    '#modalLayer.open, #appearanceLayer:not([hidden]), #kbLayer:not([hidden]), #rewardLayer:not([hidden]), #importLayer:not([hidden]), #docLayer:not([hidden]), #confirmLayer:not([hidden])'
  ));
}

/** 聚焦搜索框（菜单/快捷键也可调用）。 */
export function focusSearch() {
  if (anotherModalOpen()) return false;
  const rect = el.searchBox.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (document.activeElement !== el.searchInput) {
    el.searchInput.focus();
  }
  openPop();
  updateSearch();
  el.searchInput.select();
  return true;
}

export function bindSearch() {
  if (state.bound) return;
  state.bound = true;

  el.searchBox.addEventListener('click', (event) => {
    if (event.target.closest('#searchClear')) return;
    if (document.activeElement !== el.searchInput) el.searchInput.focus();
    else {
      openPop();
      updateSearch();
    }
  });

  el.searchInput.addEventListener('focus', () => {
    if (anotherModalOpen()) return;
    openPop();
    updateSearch();
  });

  el.searchInput.addEventListener('input', () => {
    openPop();
    updateSearch();
  });

  el.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (el.searchPop.hidden) openPop();
      if (!state.results.length) updateSearch();
      if (!state.results.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(state.active < 0 ? 0 : state.active + step);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (el.searchPop.hidden) openPop();
      updateSearch();
      if (state.results.length) choose(state.active >= 0 ? state.active : 0);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closePop();
      el.searchInput.blur();
    }
  });

  el.searchClear.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    el.searchInput.value = '';
    updateSearch();
    el.searchInput.focus();
  });

  el.searchResults.addEventListener('pointerover', (event) => {
    const hit = event.target.closest('.search-hit');
    if (hit) setActive(Number(hit.dataset.index));
  });

  el.searchResults.addEventListener('click', (event) => {
    const hit = event.target.closest('.search-hit');
    if (!hit) return;
    choose(Number(hit.dataset.index));
  });

  document.addEventListener('pointerdown', (event) => {
    if (el.searchPop.hidden) return;
    if (el.searchBox.contains(event.target) || el.searchPop.contains(event.target)) return;
    closePop();
  }, true);

  document.addEventListener('focusin', (event) => {
    if (el.searchPop.hidden) return;
    if (el.searchBox.contains(event.target) || el.searchPop.contains(event.target)) return;
    closePop();
  }, true);

  window.addEventListener('resize', () => {
    if (!el.searchPop.hidden) positionPopup();
  });

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      if (anotherModalOpen()) return;
      if (focusSearch()) event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && !el.searchPop.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closePop();
      el.searchInput.blur();
    }
  }, true);
}