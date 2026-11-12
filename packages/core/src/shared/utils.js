// 通用小工具。保持无 DOM 依赖，供 core 内部与各平台复用。

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const mod = (v, m) => ((v % m) + m) % m;

export const randRange = (a, b) => a + Math.random() * (b - a);

/**
 * 生成形如 `nb_lx3k9a1f2c` 的短 id。
 * @param {string} prefix
 * @returns {string}
 */
export const uid = (prefix) =>
  prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * 转义 HTML 特殊字符，用于拼接 innerHTML。
 * @param {unknown} s
 * @returns {string}
 */
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

/**
 * FNV-1a 32 位哈希，用于给边/粒子生成稳定的随机种子。
 * @param {string} s
 * @returns {number}
 */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 无向边的稳定键：a、b 顺序无关。
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function edgeKey(a, b) {
  return a < b ? a + '|' + b : b + '|' + a;
}

/**
 * 宽松地把值转成有限数字，失败返回 null。
 * @param {unknown} v
 * @returns {number|null}
 */
export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}