// 数据仓库：持有当前知识库、索引与存储后端，负责读写与防抖保存。
// 视图层只通过这里的函数改数据，方便将来替换为服务端/云同步。
import {
  KnowledgeIndex,
  LocalStorageBackend,
  ensureAnchors,
  ensurePositions,
  mergeSeedContent,
  needsSeedUpgrade,
  normalizeData,
  randRange,
  serializeData
} from '@starmap/core';
import { cam, ui } from './state.js';
import { writeBoundKbFile } from './kb-file.js';
import { hasHostKb, saveHostKb } from './kb-host.js';

/** @type {import('@starmap/core').KnowledgeData} */
export let data = null;

/** 索引：节点/分类/邻接查询。 */
export const index = new KnowledgeIndex();

/** 当前存储后端（默认 localStorage）。 */
export let backend = new LocalStorageBackend();

/** 最近一次加载结果。 */
export let lastLoad = null;

/** 切换存储后端（将来桌面端/服务端同步用）。 */
export function setBackend(next) {
  backend = next;
  return backend;
}

let cameraReader = null;
let saveTimer = 0;

/* ------------------------- 未保存状态 ------------------------- */
// 是否未保存按“内容指纹”判断：改了又改回去等于没改，不该继续亮月亮。
// 指纹只取可存盘的数据，不含相机视角（转视角不算修改）。
let savedFingerprint = '';
let dirty = false;
const saveListeners = new Set();

function contentFingerprint() {
  if (!data) return '';
  try {
    const snap = serializeData(data, cam);
    delete snap.view;
    return JSON.stringify(snap);
  } catch (e) {
    return '';
  }
}

/** 是否有未保存的修改（与最近一次落盘的内容不一致）。 */
export function isDirty() {
  if (!data) return false;
  return contentFingerprint() !== savedFingerprint;
}

/** 订阅保存状态变化（用于刷新月亮等提示）。 */
export function onSaveStateChange(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

/** 重新计算脏状态并通知界面（改了又改回去也会通知熄灭）。 */
function publishSaveState() {
  const next = isDirty();
  if (next === dirty) return;
  dirty = next;
  for (const fn of saveListeners) {
    try {
      fn(dirty);
    } catch (e) {
      /* 监听器异常不影响保存 */
    }
  }
}

/** 把当前内容记为“已落盘”。 */
function acceptSaved() {
  savedFingerprint = contentFingerprint();
  publishSaveState();
}

/* ------------------------- 撤销 / 重做 ------------------------- */
// 快照式撤销：每次保存前把上一份快照压栈，Ctrl+Z 恢复。只覆盖数据修改，
// 不记录旋转、缩放、展开层级这类视图操作。栈只存在于本次运行内。
const UNDO_LIMIT = 50;
const undoStack = [];
const redoStack = [];
let lastCommitted = null;
let restoring = false;
let restoreListener = null;

/** 绑定撤销/重做之后的界面刷新。 */
export function bindRestore(fn) {
  restoreListener = fn;
}

/** 把当前状态记为基线（加载完成后调用，避免把首次保存当成可撤销步骤）。 */
export function markBaseline() {
  undoStack.length = 0;
  redoStack.length = 0;
  lastCommitted = JSON.stringify(snapshot());
  acceptSaved();
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

function rememberForUndo(snap) {
  if (restoring) return;
  const text = JSON.stringify(snap);
  if (lastCommitted === null) {
    lastCommitted = text;
    return;
  }
  if (text === lastCommitted) return;
  undoStack.push(lastCommitted);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastCommitted = text;
}

function applySnapshot(text) {
  let norm = null;
  try {
    norm = normalizeData(JSON.parse(text));
  } catch (e) {
    return false;
  }
  if (!norm) return false;
  restoring = true;
  try {
    data = norm;
    rebuild();
    const snap = snapshot();
    lastCommitted = JSON.stringify(snap);
    backend.save(snap);
    const out = JSON.stringify(snap, null, 2);
    if (hasHostKb()) saveHostKb(out);
    else void writeBoundKbFile(out);
    acceptSaved();
    if (restoreListener) restoreListener();
  } finally {
    restoring = false;
  }
  return true;
}

/** 撤销一步数据修改。 */
export function undo() {
  if (!undoStack.length) return false;
  const current = JSON.stringify(snapshot());
  const prev = undoStack.pop();
  redoStack.push(current);
  return applySnapshot(prev);
}

/** 重做一步。 */
export function redo() {
  if (!redoStack.length) return false;
  const current = JSON.stringify(snapshot());
  const next = redoStack.pop();
  undoStack.push(current);
  return applySnapshot(next);
}

/** 初始化存储后端：网页版固定使用 localStorage。 */
export function initBackend() {
  backend = new LocalStorageBackend();
  return backend;
}

/** 从后端加载并返回 LoadResult。 */
export function load() {
  lastLoad = backend.load();
  data = lastLoad.data;
  rebuild();
  // 刚读进来的内容就是磁盘上的样子：记为已保存，避免一打开就亮月亮。
  acceptSaved();
  return lastLoad;
}

function rebuild() {
  ensureAnchors(data);
  ensurePositions(data, index.categoryMap, randRange);
  index.rebuild(data);
}

/** 重建索引（节点/边/笔记计数变更后调用）。 */
export function reindex() {
  index.rebuild(data);
}

/** 生成可持久化的快照，并带上当前相机。 */
export function snapshot() {
  if (cameraReader) cameraReader();
  return serializeData(data, cam);
}

/** 绑定相机读取函数，保存前调用。 */
export function bindCameraReader(fn) {
  cameraReader = fn;
}

/** 立即保存。 */
export function saveNow() {
  if (!data) return false;
  try {
    const snap = snapshot();
    rememberForUndo(snap);
    backend.save(snap);
    // 桌面壳：把快照交给壳写回绑定文件（完整路径、无需浏览器授权）。
    // 浏览器：无权限/未绑定时静默跳过。
    const text = JSON.stringify(snap, null, 2);
    if (hasHostKb()) saveHostKb(text);
    else void writeBoundKbFile(text);
    acceptSaved();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 标记数据有修改：只点亮「未保存」提示，不再自动落盘。
 * 保存交给用户：Ctrl+S / 点左上角月亮 / 面板的保存按钮。
 * @param {{ silent?: boolean }} [options] silent 时不亮提示（内部批量操作用）。
 */
export function scheduleSave(options = {}) {
  if (!options.silent) publishSaveState();
}

/** 存储是否可用（隐私模式/配额满时为 false）。 */
export function storageAvailable() {
  return !!(backend && backend.available);
}

/**
 * 用新数据替换当前库（导入/恢复初始库）。
 * @param {unknown} raw 任意来源数据
 * @returns {boolean} 是否成功
 */
export function replaceData(raw) {
  const norm = normalizeData(raw);
  if (!norm) return false;
  if (needsSeedUpgrade(norm)) mergeSeedContent(norm);
  data = norm;
  rebuild();
  cam.x = cam.tx = 0;
  cam.y = cam.ty = 0;
  cam.scale = cam.tscale = 1;
  ui.selection = null;
  scheduleSave();
  return true;
}