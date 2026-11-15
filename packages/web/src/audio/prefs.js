// 本机声音偏好：只写 localStorage，不随知识库导出。
// 键名风格与 quality.js / motion.js 保持一致。
const STORE_KEY = 'starmap.sound.v1';
// v2 把默认音量从 0.62 提到 0.87（整体响度 +40%）；旧偏好读取时同步放大一次。
const STORE_VERSION = 2;

export const SOUND_DEFAULTS = Object.freeze({
  enabled: true,
  volume: 0.87,
  ui: true,
  ambient: false,
  pulse: false
});

const RANGES = {
  volume: [0, 1]
};

function store() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (err) {
    return null;
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function normalize(raw) {
  const next = { ...SOUND_DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of ['enabled', 'ui', 'ambient', 'pulse']) {
      if (typeof raw[key] === 'boolean') next[key] = raw[key];
    }
    const value = Number(raw.volume);
    if (Number.isFinite(value)) {
      const boost = Number(raw.v) === STORE_VERSION ? 1 : 1.4;
      next.volume = clamp(value * boost, RANGES.volume[0], RANGES.volume[1]);
    }
  }
  return next;
}

const backend = store();
let state = normalize(null);
try {
  state = normalize(backend ? JSON.parse(backend.getItem(STORE_KEY) || 'null') : null);
} catch (err) {
  state = normalize(null);
}

const listeners = new Set();

/** 当前声音偏好（只读引用；修改请走 setter）。 */
export function soundPrefs() {
  return state;
}

/** 某一分类现在是否应该出声（总开关关闭时全部为 false）。 */
export function isSoundOn(category) {
  if (!state.enabled) return false;
  if (category === 'ambient') return !!state.ambient;
  if (category === 'pulse') return !!state.pulse;
  return !!state.ui;
}

function persist() {
  if (!backend) return;
  try {
    backend.setItem(STORE_KEY, JSON.stringify({ ...state, v: STORE_VERSION }));
  } catch (err) {
    /* 存储不可用时仅本次生效 */
  }
}

function notify() {
  for (const fn of listeners) fn(state);
}

/** 订阅偏好变化（用于即时应用音量、环境声开关等）。 */
export function onSoundChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 设置单项偏好。 */
export function setSoundPref(key, value) {
  if (!(key in SOUND_DEFAULTS)) return;
  if (key === 'volume') {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    const next = clamp(num, RANGES.volume[0], RANGES.volume[1]);
    if (state.volume === next) return;
    state = { ...state, volume: next };
  } else {
    const next = !!value;
    if (state[key] === next) return;
    state = { ...state, [key]: next };
  }
  persist();
  notify();
}

/** 切换布尔项。 */
export function toggleSoundPref(key) {
  if (key === 'volume' || !(key in SOUND_DEFAULTS)) return;
  setSoundPref(key, !state[key]);
}

/** 恢复默认声音设置。 */
export function resetSound() {
  state = normalize(null);
  persist();
  notify();
}

/** 供调试接口读取。 */
export function soundSnapshot() {
  return JSON.parse(JSON.stringify(state));
}