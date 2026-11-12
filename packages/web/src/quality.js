// 本机画质与视图偏好：只写入 localStorage，不随知识库导出。
// 数值统一存实际倍率，界面按百分比展示；视图模式放在同一份偏好里。
import { clamp } from '@starmap/core';

const STORE_KEY = 'starmap.quality.v1';

export const DEFAULT_QUALITY = Object.freeze({
  mode: '3d',
  three: Object.freeze({
    maxScale: 3.0,
    pixelBudget: 12,
    stars: 1.0,
    glow: 1.0,
    sparkle: 1.0,
    ambient: 1.0
  }),
  two: Object.freeze({
    dprCap: 2.0,
    glow: 1.0,
    stars: 1.0,
    spread: 1.0
  })
});

const RANGES = {
  three: {
    maxScale: [1.2, 3.0],
    pixelBudget: [6, 18],
    stars: [0.2, 1.6],
    glow: [0.4, 1.8],
    sparkle: [0.3, 1.8],
    ambient: [0.2, 1.6]
  },
  two: {
    dprCap: [1, 3],
    glow: [0.4, 1.8],
    stars: [0.2, 1.6],
    spread: [0.6, 1.6]
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
  const two = { ...DEFAULT_QUALITY.two };
  const pick = (group, defaults, target) => {
    const source = raw && raw[group];
    if (!source || typeof source !== 'object') return;
    for (const key of Object.keys(defaults)) {
      const range = RANGES[group][key];
      const value = Number(source[key]);
      if (Number.isFinite(value)) target[key] = clamp(value, range[0], range[1]);
    }
  };
  pick('three', DEFAULT_QUALITY.three, three);
  pick('two', DEFAULT_QUALITY.two, two);
  return {
    mode: raw && raw.mode === '2d' ? '2d' : '3d',
    three,
    two
  };
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

export function quality2d() {
  return state.two;
}

/** 当前视图模式：'3d' | '2d'。 */
export function viewMode() {
  return state.mode;
}

export function is2D() {
  return state.mode === '2d';
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

/** 切换 3D / 2D 视图。 */
export function setViewMode(mode) {
  const next = mode === '2d' ? '2d' : '3d';
  if (state.mode === next) return false;
  state = { ...state, mode: next };
  persist();
  notify();
  return true;
}

/**
 * 设置某一组画质参数。
 * @param {'three'|'two'} group
 * @param {string} key
 * @param {number} value 实际倍率
 */
export function setQuality(group, key, value) {
  const ranges = RANGES[group];
  if (!ranges || !ranges[key]) return;
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  const next = clamp(num, ranges[key][0], ranges[key][1]);
  if (state[group][key] === next) return;
  state = { ...state, [group]: { ...state[group], [key]: next } };
  persist();
  notify();
}

/** 恢复某一组（或全部）画质参数为默认值。 */
export function resetQuality(group) {
  if (group === 'three' || group === 'two') {
    state = { ...state, [group]: { ...DEFAULT_QUALITY[group] } };
  } else {
    state = normalize({ mode: state.mode });
  }
  persist();
  notify();
}

/** 供调试接口读取。 */
export function qualitySnapshot() {
  return JSON.parse(JSON.stringify(state));
}