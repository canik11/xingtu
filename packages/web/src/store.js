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
    backend.save(snap);
    // 绑定了本地知识文件时同步写回（无权限/未绑定时静默跳过）。
    void writeBoundKbFile(JSON.stringify(snap, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

/** 防抖保存（320ms）。 */
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 320);
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