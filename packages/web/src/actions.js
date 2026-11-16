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
import { data, index, isDirty, replaceData, reindex, saveNow, scheduleSave, snapshot, storageAvailable } from './store.js';
import { fitView, zoomAt, center3DScene, worldToScreen } from './camera.js';
import { heat } from './layout.js';
import { enterLocal, enterSphere } from './navigation.js';
import { openAppearance } from './ui/appearance.js';
import { bindKbDialog, openKbDialog, syncKbUi } from './ui/kb-dialog.js';
import { createKbFile, getKbFileName, kbFileSupported, pickKbFile, unbindKbFile } from './kb-file.js';
import { createHostKb, hostKbSupported, pickHostKb } from './kb-host.js';
import { bindRewardDialog, openRewardDialog } from './ui/reward-dialog.js';
import { openGlobalDoc } from './ui/global-doc.js';
import * as sfx from './audio/sfx.js';
import { fitFocus, rebuildFocus, projectFocusNode } from './focus.js';
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
import { openAdd, closeModal, isAddOpen } from './ui/add-modal.js';
import { bindDocImport, openDocImport } from './ui/doc-import.js';
import { bindSearch } from './ui/search.js';
import { toast } from './ui/feedback.js';
import { askConfirm } from './ui/confirm.js';
import { playBlackhole } from './ui/blackhole.js';
import { syncSoundPanel } from './ui/sound.js';
import { sceneVisuals } from './hierarchy.js';
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
  sfx.saved();
  toast('已保存修改');
}

/** 节点当前在屏幕上的位置：删除时黑洞就开在这里。 */
function nodeScreenSpot(n) {
  if (!n) return null;
  let x = NaN;
  let y = NaN;
  if (ui.level === 'local') {
    const p = projectFocusNode(n);
    if (p) {
      const s = worldToScreen(p.x, p.y);
      x = s.x;
      y = s.y;
    }
  } else {
    const v = sceneVisuals().find((item) => item.id === n.id);
    if (v) {
      const s = worldToScreen(v.x, v.y);
      x = s.x;
      y = s.y;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 实体当前在屏幕上的位置（课程走场景，章节/知识点走局部图）。 */
function entityScreenSpot(entity) {
  if (!entity) return null;
  if (ui.level === 'local' && ui.focusGraph) {
    const fg = ui.focusGraph.nodes.find((n) => n.id === entity.id);
    if (fg) {
      const p = projectFocusNode(fg);
      const s = worldToScreen(p.x, p.y);
      if (Number.isFinite(s.x) && Number.isFinite(s.y)) return { x: s.x, y: s.y };
    }
  }
  if (entity.level === 1) return nodeScreenSpot(entity.node);
  const v = sceneVisuals().find((item) => item.id === entity.id);
  if (v) {
    const s = worldToScreen(v.x, v.y);
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) return { x: s.x, y: s.y };
  }
  return null;
}

/** 实体自身 + 全部下级的笔记块 id。 */
function entityBlockIds(entity) {
  const out = [];
  const walk = (e) => {
    if (!e) return;
    if (e.blockId) out.push(e.blockId);
    for (const childId of e.children || []) walk(getEntity(childId));
  };
  walk(entity);
  return out;
}

/** 从笔记树里摘掉一块（连同它的整棵子树）。 */
function removeBlockFromTree(list, blockId) {
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i];
    if (!block) continue;
    if (block.id === blockId) {
      list.splice(i, 1);
      return true;
    }
    if (block.children && block.children.length && removeBlockFromTree(block.children, blockId)) {
      return true;
    }
  }
  return false;
}

/**
 * 删除当前选中的实体：课程、章节或知识点。
 * 选中课程时连同它下面所有章节与知识点一起删除；选中章节/知识点时连同它的下级一起删除。
 * 同时清掉所有直接连在这些块上的关系线。
 */
export function deleteSelected() {
  const entity = getEntity(ui.selection);
  if (!entity) return;

  const isCourse = entity.level === 1;
  const blockIds = isCourse ? [] : entityBlockIds(entity);
  // topicEdges 里存的是实体 id：笔记块是 `h:<blockId>`，课程是节点 id。
  const blockKeys = new Set(blockIds.map((id) => `h:${id}`));
  if (isCourse && entity.node) blockKeys.add(entity.node.id);
  const topicCount = (data.topicEdges || []).filter(
    (e) => e && (blockKeys.has(e.a) || blockKeys.has(e.b))
  ).length;
  const edgeCount = isCourse ? index.edgesOf(entity.node.id).length : 0;
  const total = edgeCount + topicCount;
  const kind = entity.level === 1 ? '课程' : entity.level === 2 ? '章节' : '知识点';
  const scope =
    entity.level === 1
      ? '及其下全部章节与知识点'
      : blockIds.length > 1
        ? `及其下 ${blockIds.length - 1} 个下级知识点`
        : '';

  askConfirm({
    title: `删除${kind}`,
    message: `确定删除「${entity.name}」${scope}，以及与之直接相连的 ${total} 条关系线吗？删除后无法撤销。`,
    confirmText: '删除',
    onConfirm: () => {
      const wasLocal = ui.level === 'local';
      const swallow = () => {
        if (isCourse) {
          const result = removeNode(data, entity.node.id);
          data.nodes = result.nodes;
          data.edges = result.edges;
        } else {
          const host = data.nodes.find((x) => x.id === entity.hostId);
          if (host && Array.isArray(host.note)) removeBlockFromTree(host.note, entity.blockId);
        }
        // 关系线：被删块（含子树）作为任一端的都清掉。
        data.topicEdges = (data.topicEdges || []).filter(
          (e) => !e || (!blockKeys.has(e.a) && !blockKeys.has(e.b))
        );
        ui.selection = null;
        ui.innerSelection = null;
        closePanel(true);
        data.categories = pruneEmptyCategories(data.categories, data.nodes, BUILTIN_CATEGORY_IDS).categories;
        reindexAll();
        refreshOutline();
        if (wasLocal) enterSphere(false);
        else {
          rebuildFocus();
          heat(0.5);
        }
      };
      const done = () => {
        updateStats();
        updateDock();
        // 删除也交给用户手动保存：只点亮月亮，按 Ctrl+S 才真正落盘。
        scheduleSave();
        if (el.menuDelete) el.menuDelete.hidden = true;
        toast('已删除 · 按 Ctrl+S 保存');
      };
      const spot = entityScreenSpot(entity);
      if (!spot) {
        swallow();
        done();
        return;
      }
      sfx.blackhole();
      playBlackhole({ x: spot.x, y: spot.y, onSwallow: swallow, onDone: done });
    }
  });
}

/** 打开 ⋯ 菜单前同步“删除当前节点”项与声音设置。 */
export function syncMenuState() {
  syncSoundPanel();
  if (!el.menuDelete) return;
  const entity = getEntity(ui.selection);
  el.menuDelete.hidden = !entity;
  if (entity) el.menuDelete.textContent = `删除「${entity.name}」`;
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
  if (isPanelOpenImpl()) closePanel(true);
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
export function closeAddModal(force = false) {
  if (!force && isAddOpen() && hasAddDraft()) {
    askConfirm({
      title: '放弃这个知识点？',
      message: '已经填写的内容还没添加，关闭后会丢失。',
      confirmText: '放弃并关闭',
      onConfirm: () => closeAddModal(true)
    });
    return;
  }
  closeModal();
  addState.pendingPos = null;
}

/** 添加弹窗里是否已经填了内容。 */
function hasAddDraft() {
  const name = el.addName && el.addName.value.trim();
  const desc = el.addDesc && el.addDesc.value.trim();
  return !!(name || desc);
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
  sfx.lockLight();
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
      sfx.exported();
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
  sfx.exported();
  toast('已下载数据（当前浏览器不支持选择保存位置）');
}

/** 用一份已规范化的数据替换当前知识库，并刷新依赖它的界面。 */
function applyLoadedData(norm) {
  if (isPanelOpen()) closePanel(true);
  ui.selection = null;
  replaceData(norm);
  refreshOutline();
  enterSphere(false);
  heat(0.3);
  updateStats();
  updateDock();
  refreshCategoryDatalist();
  saveNow();
  sfx.imported();
}

/** 一份空白知识库：没有课程、没有关系，用户从零开始画自己的星图。 */
export function blankKnowledge() {
  return {
    version: 3,
    contentVersion: 3,
    categories: [],
    nodes: [],
    edges: [],
    topicEdges: [],
    mastery: {},
    appearance: {},
    view: null
  };
}

/**
 * 「新建空白知识库」：让用户自己挑保存位置，写一份空白 JSON，并把它绑定成当前知识库。
 * 桌面版走壳的原生保存对话框；浏览器走文件系统 API；都不支持时退回下载。
 */
export async function createBlankKnowledge() {
  const text = JSON.stringify(blankKnowledge(), null, 2);
  // 桌面壳：保存对话框、写盘与绑定都由壳完成。
  if (hostKbSupported()) {
    try {
      const res = await createHostKb(text);
      if (!res) {
        toast('新建知识库失败');
        return;
      }
      if (res.status === 'cancel') return;
      if (res.status !== 'created' || !res.path) {
        toast('新建知识库失败');
        return;
      }
      applyLoadedData(blankKnowledge());
      syncKbUi();
      toast(`已新建知识库：${res.path}`);
    } catch (err) {
      toast('新建知识库失败');
    }
    return;
  }
  // 浏览器支持直接写文件：保存对话框 + 绑定。
  if (kbFileSupported() && typeof window.showSaveFilePicker === 'function') {
    try {
      const name = await createKbFile(text);
      setKbPath('');
      syncKbUi();
      applyLoadedData(blankKnowledge());
      toast(`已新建知识库：${name}`);
    } catch (err) {
      if (err && err.message === 'cancelled') return;
      toast('新建知识库失败，或这个浏览器不支持直接保存');
    }
    return;
  }
  // 退路：下载一份空白 JSON，同时把界面切到空白库。
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '我的知识库.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  applyLoadedData(blankKnowledge());
  toast('浏览器不支持直接写入文件，已下载空白知识库');
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

  el.zoomFit.addEventListener('click', fitCurrent);
  el.zoomFit.addEventListener('click', () => sfx.zoom());

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
      closePanel(true);
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
  if (el.kbCreateBtn) el.kbCreateBtn.addEventListener('click', () => void createBlankKnowledge());

  if (!storageAvailable()) {
    setTimeout(() => toast('本地存储不可用：本次改动不会自动保存'), 1000);
  }
  window.addEventListener('beforeunload', (event) => {
    // 不再自动保存：有未保存的修改时让浏览器拦一下，提醒用户先保存。
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
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