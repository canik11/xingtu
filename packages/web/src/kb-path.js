// 知识库路径：默认指向仓库里的 knowledge/seed.json。
// 用户可以在「知识库路径」里改成自己的 JSON（http(s) 地址或相对路径）。
import { normalizeData } from '@starmap/core';

export const KB_PATH_KEY = 'starmap.kb-path.v1';
export const DEFAULT_KB_PATH = 'knowledge/seed.json';

export function getKbPath() {
  try {
    return localStorage.getItem(KB_PATH_KEY) || DEFAULT_KB_PATH;
  } catch (e) {
    return DEFAULT_KB_PATH;
  }
}

/** 保存路径；传空或默认值时清除自定义设置。返回实际生效的路径。 */
export function setKbPath(value) {
  const path = String(value || '').trim();
  try {
    if (!path || path === DEFAULT_KB_PATH) localStorage.removeItem(KB_PATH_KEY);
    else localStorage.setItem(KB_PATH_KEY, path);
  } catch (e) {
    /* 本地存储不可用时只影响「记住路径」，不影响本次导入。 */
  }
  return path || DEFAULT_KB_PATH;
}

export function isDefaultKbPath(path = getKbPath()) {
  return path === DEFAULT_KB_PATH;
}

/**
 * 浏览器只能 fetch http(s) 与相对路径；file:// 直接打开时读不了任意本地路径，
 * 需要改用「选择本地 JSON」。
 */
export function canFetchKbPath(path) {
  if (!path) return false;
  if (typeof location === 'undefined') return false;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  return /^https?:/i.test(path) || path.includes('/');
}

/** 从路径读取知识库 JSON，返回 normalizeData 后的数据；失败抛错。 */
export async function fetchKnowledge(path = getKbPath()) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalizeData(await res.json());
}