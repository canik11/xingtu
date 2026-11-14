// 本机画质偏好：只写入 localStorage，不随知识库导出。
// 数值统一存实际倍率，界面按百分比展示。
import { clamp } from '@starmap/core';

const STORE_KEY = 'starmap.quality.v1';

export const DEFAULT_QUALITY = Object.freeze({
  three: Object.freeze({
    maxScale: 3.0,
    pixelBudget: 12,
    stars: 1.0,
    starSize: 1.0,
    glow: 1.0,
    sparkle: 1.0,
    ambient: 1.0
  })
});

const RANGES = {
  three: {
    maxScale: [1.2, 3.0],
    pixelBudget: [6, 18],
    stars: [0.2, 3.0],
    starSize: [0.3, 3.0],
    glow: [0.2, 3.0],
    sparkle: [0.2, 3.0],
    ambient: [0.2, 3.0]
  }
};

function store() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (err) {
    return null;
  }
}

function normalize(raw) {
  const three = { ...DEFAULT_QUALITY.three };
  const source = raw && raw.three;
  if (source && typeof source === 'object') {
    for (const key of Object.keys(DEFAULT_QUALITY.three)) {
      const range = RANGES.three[key];
      const value = Number(source[key]);
      if (Number.isFinite(value)) three[key] = clamp(value, range[0], range[1]);
    }
  }
  return { three };
}

const backend = store();
let state = normalize(null);
try {
  state = normalize(backend ? JSON.parse(backend.getItem(STORE_KEY) || 'null') : null);
} catch (err) {
  state = normalize(null);
}

const listeners = new Set();

/** 当前偏好（只读引用；修改请走 setter）。 */
export function quality() {
  return state;
}

export function quality3d() {
  return state.three;
}

function persist() {
  if (!backend) return;
  try {
    backend.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    /* 存储不可用时仅本次生效 */
  }
}

function notify() {
  for (const fn of listeners) fn(state);
}

/** 订阅偏好变化（用于即时应用渲染参数）。 */
export function onQualityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 设置某一项画质参数。
 * @param {string} key
 * @param {number} value 实际倍率
 */
export function setQuality(key, value) {
  const range = RANGES.three[key];
  if (!range) return;
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  const next = clamp(num, range[0], range[1]);
  if (state.three[key] === next) return;
  state = { ...state, three: { ...state.three, [key]: next } };
  persist();
  notify();
}

/** 恢复全部画质参数为默认值。 */
export function resetQuality() {
  state = normalize(null);
  persist();
  notify();
}

/** 供调试接口读取。 */
export function qualitySnapshot() {
  return JSON.parse(JSON.stringify(state));
}