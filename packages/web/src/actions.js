// 业务动作：保存编辑、删除、添加知识点、导入导出、重布局、复位、外观。
// 这里是唯一会“写数据”的地方，UI 层只调用这些函数。
import {
  BUILTIN_CATEGORY_IDS,
  buildNode,
  ensureAnchors,
  getOrCreateCategory,
  makeNoteBlock,
  nameTaken,
  pickNewNodePosition,
  pruneEmptyCategories,
  removeNode,
  replaceNodeEdges,
  sanitizeRelations,
  warmup,
  toNumber,
  uid
} from '@starmap/core';
import { el, esc } from './lib/dom.js';
import { ui, view } from './state.js';
import { data, index, replaceData, reindex, saveNow, snapshot, storageAvailable } from './store.js';
import { fitView, zoomAt, zoomCenter, center3DScene, zoom3DCenter } from './camera.js';
import { heat } from './layout.js';
import { enterLocal, enterSphere } from './navigation.js';
import { openAppearance } from './ui/appearance.js';
import { bindKbDialog, openKbDialog, syncKbUi } from './ui/kb-dialog.js';
import { getKbFileName, kbFileSupported, pickKbFile, unbindKbFile } from './kb-file.js';
import { hostKbSupported, pickHostKb } from './kb-host.js';
import { bindRewardDialog, openRewardDialog } from './ui/reward-dialog.js';
import { openGlobalDoc } from './ui/global-doc.js';
import { fitFocus, rebuildFocus } from './focus.js';
import { getEntity, refreshOutline } from './outline.js';
import {
  openPanel,
  closePanel,
  selectNode,
  renderPanelView,
  updateDock,
  isPanelOpen as isPanelOpenImpl,
  panelNode
} from './ui/panel.js';
import { editState } from './ui/edit-form.js';
import { renderRelations, wireRelEditor } from './ui/relation-editor.js';
import { refreshCategoryDatalist } from './ui/datalist.js';
import { openAdd, closeModal } from './ui/add-modal.js';
import { bindDocImport, openDocImport } from './ui/doc-import.js';
import { bindSearch } from './ui/search.js';
import { toast } from './ui/feedback.js';
import { askConfirm } from './ui/confirm.js';
import { canFetchKbPath, fetchKnowledge, getKbPath, isDefaultKbPath, setKbPath } from './kb-path.js';
import { updateStats } from './stats.js';

export { refreshCategoryDatalist, updateStats };

/** 重建索引并同步派生数据。 */
function reindexAll() {
  ensureAnchors(data);
  reindex();
}

/* ------------------------- 编辑 / 删除 ------------------------- */

/** 保存编辑表单。 */
export function saveEdit() {
  const n = panelNode();
  if (!n) return;
  const name = el.panelBody.querySelector('#editName').value.trim().replace(/\s+/g, ' ');
  const catName = el.panelBody.querySelector('#editCat').value.trim();
  const desc = el.panelBody.querySelector('#editDesc').value.trim().slice(0, 200);
  if (!name) {
    toast('名称不能为空');
    return;
  }
  if (nameTaken(data.nodes, name, n.id)) {
    toast('已存在同名知识点');
    return;
  }

  const cat = getOrCreateCategory(data.categories, catName, [n.x, n.y]);
  n.name = name.slice(0, 40);
  n.desc = desc;
  n.cat = cat.id;

  const validIds = new Set(data.nodes.map((x) => x.id));
  const relations = sanitizeRelations(editState.relations, n.id, validIds);
  data.edges = replaceNodeEdges(data.edges, n.id, relations);

  data.categories = pruneEmptyCategories(data.categories, data.nodes, BUILTIN_CATEGORY_IDS).categories;
  reindexAll();
  refreshOutline();
  if (ui.level === 'local') rebuildFocus();
  heat(0.7);
  renderPanelView(n);
  updateStats();
  updateDock();
  refreshCategoryDatalist();
  saveNow();
  toast('已保存修改');
}

/** 删除当前选中节点。 */
export function deleteSelected() {
  const n = index.getNode(ui.selection);
  if (!n) return;
  const count = index.edgesOf(n.id).length;
  askConfirm({
    title: '删除知识点',
    message: `确定删除「${n.name}」及其 ${count} 条关联吗？删除后无法撤销。`,
    confirmText: '删除',
    onConfirm: () => {
      const wasLocal = ui.level === 'local';
      const result = removeNode(data, n.id);
      data.nodes = result.nodes;
      data.edges = result.edges;
      ui.selection = null;
      closePanel();
      data.categories = pruneEmptyCategories(data.categories, data.nodes, BUILTIN_CATEGORY_IDS).categories;
      reindexAll();
      refreshOutline();
      if (wasLocal) enterSphere(false);
      else {
        rebuildFocus();
        heat(0.5);
      }
      updateStats();
      updateDock();
      saveNow();
      if (el.menuDelete) el.menuDelete.hidden = true;
      toast('节点已删除');
    }
  });
}

/** 打开 ⋯ 菜单前同步“删除当前节点”项。 */
export function syncMenuState() {
  if (!el.menuDelete) return;
  const n = index.getNode(ui.selection);
  el.menuDelete.hidden = !n;
  if (n) el.menuDelete.textContent = `删除「${n.name}」`;
}

/* ------------------------- 添加知识点 ------------------------- */

const addState = { relations: [] };

function renderAddRels() {
  renderRelations(el.addRels, addState.relations, null);
  wireRelEditor(el.addRels, addState, renderAddRels);
}

/** 根据落点推断最近的分类名。 */
function nearestCategoryName(pos) {
  let best = null;
  let bd = Infinity;
  for (const n of data.nodes) {
    const d = Math.hypot(n.x - pos[0], n.y - pos[1]);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best ? (index.getCategory(best.cat) || {}).name || '' : '';
}

/**
 * 打开“添加知识点”弹窗。
 * @param {[number,number]|null} [pos] 世界坐标（双击空白处传入）
 */
export function openAddNode(pos) {
  if (isPanelOpenImpl()) closePanel();
  addState.pendingPos = pos || null;
  addState.relations = [];
  el.addForm.reset();
  el.addCat.value = pos
    ? nearestCategoryName(pos)
    : ui.selection && index.getNode(ui.selection)
      ? (index.getCategory(index.getNode(ui.selection).cat) || {}).name || ''
      : '';
  refreshCategoryDatalist();
  renderAddRels();
  openAdd();
  setTimeout(() => el.addName.focus(), 90);
}

/** 关闭弹窗。 */
export function closeAddModal() {
  closeModal();
  addState.pendingPos = null;
}

/** 保存新知识点。 */
export function saveNewNode() {
  const name = el.addName.value.trim().replace(/\s+/g, ' ');
  if (!name) {
    toast('请先填写知识点名称');
    el.addName.focus();
    return;
  }
  if (nameTaken(data.nodes, name, null)) {
    toast('已存在同名知识点');
    el.addName.focus();
    return;
  }
  const desc = el.addDesc.value.trim();
  const catName = el.addCat.value.trim();
  const cat = getOrCreateCategory(data.categories, catName, null);
  const validIds = new Set(data.nodes.map((x) => x.id));
  const rels = sanitizeRelations(addState.relations, '', validIds);

  const nodeId = uid('n');
  const [x, y] = pickNewNodePosition({
    pendingPos: addState.pendingPos || null,
    relations: rels,
    nodeMap: index.nodeMap,
    anchor: cat.anchor || null
  });
  if (!cat.anchor) cat.anchor = [x, y];

  const node = buildNode({ name, catId: cat.id, desc, x, y, now: performance.now() });
  node.id = nodeId;
  data.nodes.push(node);
  const seen = new Set();
  for (const r of rels) {
    if (seen.has(r.other)) continue;
    seen.add(r.other);
    data.edges.push({ a: nodeId, b: r.other, label: r.label });
  }
  reindexAll();
  ensureAnchors(data);
  refreshOutline();
  heat(0.95);
  closeAddModal();
  selectNode(nodeId);
  updateStats();
  refreshCategoryDatalist();
  updateDock();
  saveNow();
  enterLocal(nodeId, { from3D: ui.level === 'sphere', openSidebar: true });
  toast(`已点亮「${node.name}」，开始记录笔记吧`);
}

/* ------------------------- 导入 / 导出 / 重布局 ------------------------- */

/** 导出 JSON 文件。 */
export async function exportData() {
  const payload = JSON.stringify(snapshot(), null, 2);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const suggested = `知识星图-${stamp}.json`;

  // Chromium 支持原生保存对话框：用户可同时选择位置和文件名。
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: '知识星图 JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([payload], { type: 'application/json' }));
      await writable.close();
      toast(`已保存：${handle.name}`);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // 用户拒绝授权或浏览器实现不完整时退回普通下载。
    }
  }

  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已下载数据（当前浏览器不支持选择保存位置）');
}

/** 用一份已规范化的数据替换当前知识库，并刷新依赖它的界面。 */
function applyLoadedData(norm) {
  if (isPanelOpen()) closePanel();
  ui.selection = null;
  replaceData(norm);
  refreshOutline();
  enterSphere(false);
  heat(0.3);
  updateStats();
  updateDock();
  refreshCategoryDatalist();
  saveNow();
}

/**
 * 「知识库路径」里的统一入口：浏览器支持文件读写时打开选择器，绑定或切换知识文件；
 * 不支持时按输入框里的路径载入（只读）。
 */
export async function openKnowledge() {
  // 桌面壳：原生文件对话框 + 完整路径，读写由壳负责。
  if (hostKbSupported()) {
    try {
      const res = await pickHostKb();
      if (!res || res.status !== 'picked' || !res.content) return;
      applyLoadedData(JSON.parse(res.content));
      syncKbUi();
      toast(`已绑定知识文件：${res.path}`);
    } catch (err) {
      toast('选择文件失败或文件格式不正确');
    }
    return;
  }
  if (!kbFileSupported()) {
    await loadKnowledgeFromPath();
    return;
  }
  try {
    const norm = await pickKbFile();
    setKbPath('');
    syncKbUi();
    applyLoadedData(norm);
    toast(`已绑定知识文件：${getKbFileName()}`);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    toast('选择文件失败或文件格式不正确');
  }
}

/** 从输入框里的路径读取并载入（只读，会解除已有的文件绑定）。 */
export async function loadKnowledgeFromPath(pathOverride) {
  const path = String(pathOverride || (el.kbPathInput && el.kbPathInput.value) || getKbPath()).trim();
  if (!path) {
    toast('请先填写知识路径');
    return false;
  }
  if (!canFetchKbPath(path)) {
    toast('浏览器无法直接读取该路径，请填写 http(s) 地址或相对路径');
    return false;
  }
  try {
    const norm = await fetchKnowledge(path);
    if (!norm) throw new Error('invalid');
    if (getKbFileName()) await unbindKbFile();
    setKbPath(isDefaultKbPath(path) ? '' : path);
    syncKbUi();
    applyLoadedData(norm);
    toast(`已载入知识库：${path}`);
    return true;
  } catch (e) {
    toast('载入失败：路径无效或文件格式不正确');
    return false;
  }
}

/* ------------------------- Markdown / PDF 内容导入 ------------------------- */

/** 把标题收敛到指定长度，并在同级里做可读的去重。 */
function uniqueLabel(base, used, max = 40) {
  const clean = String(base || '未命名')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || '未命名';
  let label = clean;
  let n = 2;
  while (used.has(label)) {
    const suffix = ` (${n++})`;
    label = clean.slice(0, Math.max(1, max - suffix.length)).trim() + suffix;
  }
  used.add(label);
  return label;
}

function firstBlockText(blocks) {
  for (const block of blocks || []) {
    if (!block) continue;
    if (block.text) return block.text;
    const nested = firstBlockText(block.children);
    if (nested) return nested;
  }
  return '';
}

function courseNoteFromImport(item) {
  const content = Array.isArray(item.content) ? item.content : [];
  if (!content.length) return [];
  if (item.structured) return content;
  return [makeNoteBlock('正文', content, false)];
}

/**
 * 把向导条目写入知识库。只创建节点/笔记块，不创建任何关系。
 * @param {Array<object>} items
 */
export async function applyDocImport(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { ok: false, error: '没有要导入的文件' };

  const cat = getOrCreateCategory(data.categories, '导入', null);
  const usedNodeNames = new Set(data.nodes.map((node) => node.name));
  let addedNodes = 0;
  let addedBlocks = 0;
  let skipped = 0;

  for (const item of list) {
    const title = String(item.title || '').trim().slice(0, 40);
    const content = Array.isArray(item.content) ? item.content : [];
    const level = Number(item.level);
    if (!title) {
      skipped++;
      continue;
    }

    if (level === 1) {
      const name = uniqueLabel(title, usedNodeNames, 40);
      const total = data.nodes.length;
      const angle = total * 2.399963229728653;
      const radius = 90 + Math.sqrt(total) * 58;
      const anchor = cat.anchor || [0, 0];
      const x = anchor[0] + Math.cos(angle) * radius;
      const y = anchor[1] + Math.sin(angle) * radius * 0.78;
      if (!cat.anchor) cat.anchor = [x, y];

      const node = buildNode({
        name,
        catId: cat.id,
        desc: firstBlockText(content).slice(0, 200) || `从 ${item.filename || '文档'} 导入`,
        x,
        y,
        now: performance.now()
      });
      node.note = courseNoteFromImport(item);
      data.nodes.push(node);
      addedNodes++;
      continue;
    }

    if (level === 2) {
      const course = index.getNode(item.parentId) || data.nodes.find((node) => node.id === item.parentId);
      if (!course) {
        skipped++;
        continue;
      }
      course.note = Array.isArray(course.note) ? course.note : [];
      const used = new Set(course.note.map((block) => block.text));
      const block = makeNoteBlock(uniqueLabel(title, used, 40), content, false);
      course.note.push(block);
      addedBlocks++;
      continue;
    }

    if (level === 3) {
      const chapter = getEntity(item.parentId);
      if (!chapter || chapter.level !== 2 || !chapter.block) {
        skipped++;
        continue;
      }
      const block = chapter.block;
      block.children = Array.isArray(block.children) ? block.children : [];
      const used = new Set(block.children.map((child) => child.text));
      block.children.push(makeNoteBlock(uniqueLabel(title, used, 40), content, false));
      block.collapsed = false;
      addedBlocks++;
      continue;
    }

    skipped++;
  }

  const added = addedNodes + addedBlocks;
  if (!added) {
    return { ok: false, error: skipped ? '没有可写入的内容，请检查标题和上级' : '没有可导入的内容' };
  }

  reindexAll();
  refreshOutline();
  if (ui.level === 'local') rebuildFocus();
  heat(0.85);
  updateStats();
  updateDock();
  refreshCategoryDatalist();
  saveNow();

  const suffix = skipped ? `，跳过 ${skipped} 个无效条目` : '';
  return {
    ok: true,
    message: `已导入 ${list.length} 个文档，新增 ${added} 条内容${suffix}`
  };
}

/* ------------------------- 绑定 ------------------------- */

/** 缩放按钮：局部图用相机缩放，星海用球心缩放。 */
function zoomBy(factor) {
  if (ui.level === 'local') zoomCenter(factor);
  else zoom3DCenter(factor);
}

/** 重置视图：局部视图恢复布局并适配画面，3D 视图回到球心。 */
function fitCurrent() {
  if (ui.level === 'local') {
    if (ui.focusGraph) {
      fitFocus(true);
      return;
    }
    data.nodes.forEach((n) => {
      n.fixed = false;
    });
    warmup(data, data.edges, index.categoryMap, 240);
    fitView(data.nodes, true);
    updateDock();
    saveNow();
    toast('已恢复布局');
    return;
  }
  const radius = ui.level === 'inner' ? 250 : ui.spherePuffTarget > 0.5 ? 430 : 300;
  center3DScene(true, radius);
}

/**
 * 绑定所有按钮与表单事件。
 */
export function bindActions() {
  bindDocImport({ onImport: applyDocImport });
  bindKbDialog();
  bindRewardDialog();
  bindSearch();
  el.btnAdd.addEventListener('click', () => openAddNode(null));
  el.dockOpen.addEventListener('click', () => {
    if (ui.selection) openPanel(ui.selection);
  });
  el.dockClose.addEventListener('click', () => selectNode(null));

  el.zoomIn.addEventListener('click', () => zoomBy(1.22));
  el.zoomOut.addEventListener('click', () => zoomBy(1 / 1.22));
  el.zoomFit.addEventListener('click', fitCurrent);

  el.addRelBtn.addEventListener('click', () => {
    addState.relations.push({ other: '', label: '' });
    renderAddRels();
    const rows = el.addRels.querySelectorAll('.rel-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('select').focus();
  });

  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveNewNode();
  });

  el.btnMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    syncMenuState();
    el.moreWrap.classList.toggle('open');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!el.moreWrap.contains(e.target)) el.moreWrap.classList.remove('open');
  });
  el.menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-menu]');
    if (!btn) return;
    el.moreWrap.classList.remove('open');
    const action = btn.dataset.menu;
    if (action === 'export') void exportData();
    else if (action === 'import-doc') openDocImport();
    else if (action === 'delete') deleteSelected();
    else if (action === 'kb') openKbDialog();
    else if (action === 'appearance') openAppearance();
    else if (action === 'global-doc') {
      closePanel();
      openGlobalDoc();
    }
    else if (action === 'reward') openRewardDialog();
  });

  el.kbPathInput.addEventListener('change', () => {
    const path = setKbPath(el.kbPathInput.value);
    el.kbPathInput.value = path;
    syncKbUi();
    toast('知识库路径已保存');
  });
  el.kbPickBtn.addEventListener('click', () => void openKnowledge());

  if (!storageAvailable()) {
    setTimeout(() => toast('本地存储不可用：本次改动不会自动保存'), 1000);
  }
  window.addEventListener('beforeunload', () => saveNow());
}

/** 全局动作分发（供其它模块调用，避免循环 import）。 */
const ACTIONS = {
  saveEdit,
  deleteSelected
};

/**
 * 按名字执行动作。
 * @param {string} name
 */
export function runAction(name) {
  const fn = ACTIONS[name];
  if (fn) fn();
}

/** 菜单是否打开。 */
export function isMenuOpen() {
  return el.moreWrap.classList.contains('open');
}

/** 关闭 ⋯ 菜单。 */
export function closeMenu() {
  el.moreWrap.classList.remove('open');
}

/** 弹窗是否打开（转发给 add-modal，避免 interaction 直接依赖 UI 模块）。 */
export function isAddOpenAction() {
  return el.modalLayer.classList.contains('open');
}

/** 面板是否打开（包装 ui/panel 的实现）。 */
export function isPanelOpen() {
  return isPanelOpenImpl();
}

/** 关闭面板（供 interaction 使用）。 */
export function closePanelAction() {
  closePanel();
}