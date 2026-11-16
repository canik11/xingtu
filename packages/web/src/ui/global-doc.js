// 全项目大纲：把所有知识点的笔记树放进一份可滚动的大文档。
// 左侧小圆点可拖动条目；拖到条目之间是移动，拖到条目中间是合并为子级，
// 拖到某个知识点标题/底部投放区是归入该节点。
import {
  appendRootBlock,
  countNote,
  findBlockOwner,
  indentBlock,
  isBlockDescendant,
  moveNoteBlock,
  outdentBlock,
  removeBlock,
  splitBlock,
  toggleBlock
} from '@starmap/core';
import { el, esc } from '../lib/dom.js';
import { ui } from '../state.js';
import { data, reindex, saveNow, scheduleSave } from '../store.js';
import { toast } from './feedback.js';
import { getEntity, refreshOutline } from '../outline.js';
import { rebuildFocus } from '../focus.js';
import { toggleMastery, blockMasteryRatio, isLeafBlock } from '../mastery.js';
import { enterLocal } from '../navigation.js';
import * as sfx from '../audio/sfx.js';

const NOTE_LIMIT = 2000;
let isOpen = false;
let dragState = null;
let dropTarget = null;
const collapsedNodes = new Set();

function categoryName(id) {
  return (data.categories || []).find((c) => c.id === id)?.name || '未分类';
}

function blockRow(block, nodeId, parentId, index, depth) {
  const kids = block.children || [];
  const hasKids = kids.length > 0;
  const children = hasKids
    ? `<div class="doc-children"${block.collapsed ? ' hidden' : ''}>${kids
        .map((child, i) => blockRow(child, nodeId, block.id, i, depth + 1))
        .join('')}</div>`
    : '';
  // 根条目是章节，掌握状态按下属知识点比例计算；只有最深层的叶子条目可以单独打勾。
  const leaf = depth > 0 && isLeafBlock(block);
  const mastered = leaf && !!(data.mastery && data.mastery[block.id]);
  const masteryButton = depth > 0
    ? (leaf
        ? `<button class="doc-mastery${mastered ? ' on' : ''}" type="button" data-mastery="${esc(block.id)}"
        aria-pressed="${mastered}" aria-label="${mastered ? '取消掌握' : '标记为已掌握'}"
        title="${mastered ? '取消掌握' : '标记为已掌握'}"><span class="doc-mastery-box" aria-hidden="true">${mastered ? '✓' : ''}</span></button>`
        : `<span class="doc-mastery-ratio" title="这一条包含子条目，掌握度按子级汇总">${Math.round(blockMasteryRatio(block) * 100)}%</span>`)
    : '';
  return `
    <div class="doc-row${depth === 0 ? ' is-root' : ''}" data-nid="${esc(block.id)}"
      data-node="${esc(nodeId)}" data-parent="${esc(parentId || '')}" data-index="${index}"
      data-depth="${depth}" style="--depth:${depth}">
      <button class="doc-handle" type="button" draggable="true" aria-label="拖动条目"></button>
      ${hasKids
        ? `<button class="doc-fold" type="button" data-fold="${esc(block.id)}" aria-label="${block.collapsed ? '展开' : '折叠'}">${block.collapsed ? '▸' : '▾'}</button>`
        : '<span class="doc-fold is-leaf"></span>'}
      <div class="doc-text" contenteditable="true" spellcheck="false" role="textbox"
        aria-label="大纲条目">${esc(block.text)}</div>
      ${masteryButton}
    </div>${children}`;
}

function nodeSection(node) {
  const note = node.note || [];
  const collapsed = collapsedNodes.has(node.id);
  const rows = note.map((block, i) => blockRow(block, node.id, null, i, 0)).join('');
  return `
    <section class="doc-node${collapsed ? ' is-collapsed' : ''}" data-node-id="${esc(node.id)}">
      <header class="doc-node-head" data-drop-section="${esc(node.id)}">
        <button class="doc-node-fold" type="button" data-fold-node="${esc(node.id)}"
          aria-label="${collapsed ? '展开' : '折叠'}「${esc(node.name)}」" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>
        <div class="doc-node-copy">
          <span class="doc-node-cat">${esc(categoryName(node.cat))}</span>
          <h3>${esc(node.name)}</h3>
          <span class="doc-node-count">${countNote(note)} 条</span>
        </div>
        <button class="link-btn doc-node-add" type="button" data-add-node="${esc(node.id)}">＋ 添加条目</button>
      </header>
      <div class="doc-node-drop" data-drop-section="${esc(node.id)}">拖到这里，归入「${esc(node.name)}」</div>
      ${rows ? `<div class="doc-tree">${rows}</div>` : '<p class="doc-empty">这个知识点还没有笔记条目。</p>'}
      <div class="doc-node-tail" data-drop-section="${esc(node.id)}"></div>
    </section>`;
}

function render(focusId = null, caret = 'end') {
  if (!el.docBody) return;
  const scroll = el.docBody.scrollTop;
  el.docBody.innerHTML = (data.nodes || []).map(nodeSection).join('');
  el.docBody.scrollTop = scroll;
  if (focusId) requestAnimationFrame(() => focusBlock(focusId, caret));
}

function focusBlock(id, position = 'end') {
  const row = el.docBody.querySelector(`.doc-row[data-nid="${cssEscape(id)}"]`);
  const text = row?.querySelector('.doc-text');
  if (!text) return;
  text.focus({ preventScroll: false });
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(text);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function ownerOf(id) {
  return findBlockOwner(data.nodes, id);
}

function refreshAfterStructure() {
  reindex();
  refreshOutline();
  if (ui.focusGraph && ui.focusId) rebuildFocus();
  scheduleSave();
}

function setStatus(message) {
  if (el.docStatus) el.docStatus.textContent = message || '';
}

function clearDropMarks() {
  el.docBody.querySelectorAll('.drop-before,.drop-after,.drop-into,.drop-section').forEach((row) => {
    row.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-section');
  });
  dropTarget = null;
}

function currentText(textEl) {
  return String(textEl.textContent || '').replace(/\u00a0/g, ' ');
}

function caretOffset(textEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return currentText(textEl).length;
  const range = sel.getRangeAt(0).cloneRange();
  const pre = range.cloneRange();
  pre.selectNodeContents(textEl);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function toggleFold(id) {
  const owner = ownerOf(id);
  if (!owner) return;
  const block = toggleBlock(owner.node.note, id);
  if (!block) return;
  sfx.docFold(!block.collapsed);
  // 折叠只是视图状态，不点亮「未保存」提示。
  scheduleSave({ silent: true });
  render();
}

function addBlock(nodeId) {
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const block = appendRootBlock(node.note || (node.note = []));
  collapsedNodes.delete(nodeId);
  refreshAfterStructure();
  render(block.id, 'end');
  sfx.docAdd();
  setStatus('已添加条目');
}

function toggleNodeFold(nodeId) {
  const wasCollapsed = collapsedNodes.has(nodeId);
  if (wasCollapsed) collapsedNodes.delete(nodeId);
  else collapsedNodes.add(nodeId);
  sfx.docFold(wasCollapsed);
  render();
}

function collapseAll(value) {
  collapsedNodes.clear();
  if (value) for (const node of data.nodes || []) collapsedNodes.add(node.id);
  const walk = (list) => {
    for (const block of list || []) {
      if (block.children && block.children.length) {
        block.collapsed = value;
        walk(block.children);
      }
    }
  };
  for (const node of data.nodes) walk(node.note || []);
  scheduleSave({ silent: true });
  sfx.docFold(!value);
  render();
}

function startDrag(event) {
  const handle = event.target.closest('.doc-handle');
  if (!handle) return;
  const row = handle.closest('.doc-row');
  if (!row) return;
  const owner = ownerOf(row.dataset.nid);
  if (!owner) return;
  dragState = { id: row.dataset.nid, nodeId: row.dataset.node, block: owner.block };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.nid);
  el.docLayer.classList.add('is-dragging');
  requestAnimationFrame(() => row.classList.add('is-dragging'));
  sfx.docPick();
  setStatus('拖动到目标位置');
}

function endDrag() {
  dragState = null;
  clearDropMarks();
  el.docLayer.classList.remove('is-dragging');
  el.docBody.querySelectorAll('.is-dragging').forEach((row) => row.classList.remove('is-dragging'));
  setStatus('');
}

function targetFromRow(row, event) {
  const rect = row.getBoundingClientRect();
  const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
  const nodeId = row.dataset.node;
  const parentId = row.dataset.parent || null;
  const index = Number(row.dataset.index || 0);
  if (ratio < 0.3) return { nodeId, parentId, index, mode: 'before', row };
  if (ratio > 0.7) return { nodeId, parentId, index: index + 1, mode: 'after', row };
  const owner = ownerOf(row.dataset.nid);
  return {
    nodeId,
    parentId: row.dataset.nid,
    index: owner?.block.children?.length || 0,
    mode: 'inside',
    row
  };
}

function onDragOver(event) {
  if (!dragState) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearDropMarks();

  const row = event.target.closest('.doc-row');
  if (row) {
    const nodeId = row.dataset.node;
    const targetBlockId = row.dataset.nid;
    const sourceOwner = ownerOf(dragState.id);
    if (
      dragState.id === targetBlockId ||
      (sourceOwner && isBlockDescendant(sourceOwner.block, targetBlockId))
    ) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    const target = targetFromRow(row, event);
    if (!target) return;
    dropTarget = target;
    row.classList.add(`drop-${target.mode}`);
    return;
  }

  const section = event.target.closest('[data-drop-section]');
  if (section) {
    const nodeId = section.dataset.dropSection;
    const node = data.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    dropTarget = {
      nodeId,
      parentId: null,
      index: (node.note || []).length,
      mode: 'section',
      section
    };
    section.classList.add('drop-section');
  }
}

function onDrop(event) {
  if (!dragState || !dropTarget) return;
  event.preventDefault();
  const source = dragState;
  const target = dropTarget;
  const result = moveNoteBlock(
    data.nodes,
    source.id,
    target.nodeId,
    target.parentId,
    target.index
  );
  if (!result.ok) {
    sfx.docBlocked();
    setStatus(result.reason === 'descendant' ? '不能把条目拖进自己的子级' : '这里不能放置');
    endDrag();
    return;
  }
  collapsedNodes.delete(target.nodeId);
  refreshAfterStructure();
  const movedText = result.block.text || '未命名条目';
  endDrag();
  render();
  sfx.docDrop();
  setStatus(`已移动「${movedText.slice(0, 24)}」`);
}

function onDocInput(event) {
  const text = event.target.closest('.doc-text');
  if (!text) return;
  const row = text.closest('.doc-row');
  const owner = ownerOf(row?.dataset.nid);
  if (!owner) return;
  owner.block.text = currentText(text).slice(0, NOTE_LIMIT);
  scheduleSave();
  setStatus('未保存 · 按 Ctrl+S 保存');
}

function onDocKeydown(event) {
  const text = event.target.closest('.doc-text');
  if (!text) return;
  const row = text.closest('.doc-row');
  const owner = ownerOf(row?.dataset.nid);
  if (!owner) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    const offset = caretOffset(text);
    const next = splitBlock(owner.node.note, owner.block.id, offset, currentText(text));
    refreshAfterStructure();
    render(next?.id || null, 'end');
    sfx.docAdd();
    setStatus('已新增条目');
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    const result = event.shiftKey
      ? outdentBlock(owner.node.note, owner.block.id)
      : indentBlock(owner.node.note, owner.block.id);
    if (result.ok) {
      refreshAfterStructure();
      render(owner.block.id, 'end');
      sfx.docIndent(!event.shiftKey);
    }
    return;
  }
  if (event.key === 'Backspace' && !currentText(text).length && !owner.block.children?.length) {
    event.preventDefault();
    const result = removeBlock(owner.node.note, owner.block.id);
    refreshAfterStructure();
    render(result.focusId || null, 'end');
    sfx.docRemove();
    setStatus('已删除空条目');
  }
}

function onDocClick(event) {
  const mastery = event.target.closest('[data-mastery]');
  if (mastery) {
    event.preventDefault();
    const blockId = mastery.dataset.mastery;
    let entity = getEntity(`h:${blockId}`);
    if (!entity) {
      refreshOutline();
      entity = getEntity(`h:${blockId}`);
    }
    if (!entity) return;
    const next = toggleMastery(entity);
    mastery.classList.toggle('on', next);
    mastery.setAttribute('aria-pressed', String(next));
    mastery.setAttribute('aria-label', next ? '取消掌握' : '标记为已掌握');
    mastery.title = next ? '取消掌握' : '标记为已掌握';
    const box = mastery.querySelector('.doc-mastery-box');
    if (box) box.textContent = next ? '✓' : '';
    sfx.mastery(next);
    setStatus(next ? `已标记掌握「${entity.name}」` : `已取消掌握「${entity.name}」`);
    return;
  }
  const nodeFold = event.target.closest('[data-fold-node]');
  if (nodeFold) {
    toggleNodeFold(nodeFold.dataset.foldNode);
    return;
  }
  const fold = event.target.closest('[data-fold]');
  if (fold) {
    toggleFold(fold.dataset.fold);
    return;
  }
  const add = event.target.closest('[data-add-node]');
  if (add) {
    addBlock(add.dataset.addNode);
  }
}

function onDocDoubleClick(event) {
  const handle = event.target.closest('.doc-handle');
  if (!handle) return;
  const row = handle.closest('.doc-row');
  const blockId = row && row.dataset.nid;
  if (!blockId) return;
  const owner = ownerOf(blockId);
  if (!owner) return;
  const entity = getEntity(`h:${owner.block.id}`);
  if (!entity) return;
  event.preventDefault();
  event.stopPropagation();
  closeGlobalDoc();
  enterLocal(entity.id, { from3D: false, openSidebar: true });
}

function onKeydownCapture(event) {
  if (!isOpen || event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeGlobalDoc();
}

export function isGlobalDocOpen() {
  return isOpen;
}

export function openGlobalDoc() {
  if (isOpen) return;
  isOpen = true;
  setStatus('');
  render();
  el.docLayer.hidden = false;
  document.body.classList.add('doc-open');
  void el.docLayer.offsetWidth;
  el.docLayer.classList.add('open');
  el.docBody.scrollTop = 0;
  sfx.modal(true);
}

export function closeGlobalDoc() {
  if (!isOpen) return;
  isOpen = false;
  endDrag();
  el.docLayer.classList.remove('open');
  el.docLayer.hidden = true;
  document.body.classList.remove('doc-open');
  sfx.modal(false);
}

export function bindGlobalDoc() {
  if (!el.docLayer) return;
  el.docClose.addEventListener('click', closeGlobalDoc);
  if (el.docSaveOrb) {
    el.docSaveOrb.addEventListener('click', () => {
      saveNow();
      setStatus('已保存');
      toast('已保存修改');
    });
  }
  el.docCollapseAll.addEventListener('click', () => collapseAll(true));
  el.docExpandAll.addEventListener('click', () => collapseAll(false));
  el.docBody.addEventListener('input', onDocInput);
  el.docBody.addEventListener('keydown', onDocKeydown);
  el.docBody.addEventListener('click', onDocClick);
  el.docBody.addEventListener('dblclick', onDocDoubleClick);
  el.docBody.addEventListener('dragstart', startDrag);
  el.docBody.addEventListener('dragover', onDragOver);
  el.docBody.addEventListener('drop', onDrop);
  el.docBody.addEventListener('dragend', endDrag);
  el.docLayer.addEventListener('dragleave', (event) => {
    if (!el.docLayer.contains(event.relatedTarget)) clearDropMarks();
  });
  document.addEventListener('keydown', onKeydownCapture, true);
}