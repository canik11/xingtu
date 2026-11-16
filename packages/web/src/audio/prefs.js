// 本机声音偏好：只写 localStorage，不随知识库导出。
// 键名风格与 quality.js / motion.js 保持一致。
const STORE_KEY = 'starmap.sound.v1';
// v2 把默认音量从 0.62 提到 0.87（整体响度 +40%）；旧偏好读取时同步放大一次。
// v3 起改为「逐项音效开关」，旧的 ui / edit / intro 三个粗分类会展开成具体音效。
const STORE_VERSION = 3;

/**
 * 每一项音效一个开关。顺序就是设置面板里的顺序。
 * 键既是偏好字段名，也是 sfx.js 里 sfxOn(...) 的参数。
 */
export const SOUND_GROUPS = Object.freeze([
  {
    title: '开场',
    items: [
      ['introWait', '等待页氛围'],
      ['introBlast', '爆炸']
    ]
  },
  {
    title: '星海',
    items: [
      ['shape', '3D 形状切换'],
      ['navigate', '层级进入 / 返回'],
      ['select', '选中与取消'],
      ['motion', '静默效果'],
      ['reset', '重置图形'],
      ['zoom', '适应视野']
    ]
  },
  {
    title: '界面',
    items: [
      ['panel', '侧栏开合'],
      ['modal', '弹窗'],
      ['tab', '切换标签'],
      ['menu', '菜单'],
      ['search', '搜索'],
      ['nudge', '轻提示']
    ]
  },
  {
    title: '编辑',
    items: [
      ['typing', '打字 / 删字'],
      ['save', '保存'],
      ['undo', '撤销 / 重做']
    ]
  },
  {
    title: '内容',
    items: [
      ['add', '新增知识点'],
      ['delete', '删除（黑洞）'],
      ['mastery', '掌握标记'],
      ['transfer', '导入 / 导出']
    ]
  },
  {
    title: '长卷',
    items: [
      ['docFold', '折叠 / 展开'],
      ['docMove', '拖动条目'],
      ['docEdit', '增删条目']
    ]
  }
]);

const CHANNEL_KEYS = SOUND_GROUPS.flatMap((group) => group.items.map(([key]) => key));

function defaultChannels() {
  const channels = {};
  for (const key of CHANNEL_KEYS) channels[key] = true;
  return channels;
}

export const SOUND_DEFAULTS = Object.freeze({
  enabled: true,
  volume: 0.87,
  channels: Object.freeze(defaultChannels())
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

/** 旧版把开关分成 ui / edit / intro 三类，这里展开成具体项。 */
function channelsFromLegacy(raw) {
  const channels = defaultChannels();
  const legacy = {
    ui: ['shape', 'navigate', 'select', 'motion', 'reset', 'zoom', 'panel', 'modal', 'tab', 'menu', 'search', 'nudge', 'add', 'delete', 'mastery', 'transfer', 'docFold', 'docMove', 'docEdit'],
    edit: ['typing', 'save', 'undo'],
    intro: ['introWait', 'introBlast']
  };
  for (const [group, keys] of Object.entries(legacy)) {
    if (typeof raw[group] !== 'boolean') continue;
    for (const key of keys) channels[key] = raw[group];
  }
  return channels;
}

function normalize(raw) {
  const next = {
    enabled: true,
    volume: SOUND_DEFAULTS.volume,
    channels: defaultChannels()
  };
  if (raw && typeof raw === 'object') {
    if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled;
    const value = Number(raw.volume);
    if (Number.isFinite(value)) {
      // v2 之前的默认音量是 0.62，读旧值时放大一次，避免升级后突然变小。
      const boost = Number(raw.v) >= 2 ? 1 : 1.4;
      next.volume = clamp(value * boost, RANGES.volume[0], RANGES.volume[1]);
    }
    if (raw.channels && typeof raw.channels === 'object') {
      for (const key of CHANNEL_KEYS) {
        if (typeof raw.channels[key] === 'boolean') next.channels[key] = raw.channels[key];
      }
    } else {
      next.channels = channelsFromLegacy(raw);
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

/** 某一项音效现在是否应该出声（总开关关闭时全部为 false）。 */
export function isSoundOn(channel) {
  if (!state.enabled) return false;
  return state.channels[channel] !== false;
}

/** 某一组里是否至少有一项是开着的（用于组标题的亮/暗）。 */
export function isGroupOn(group) {
  return group.items.some(([key]) => isSoundOn(key));
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

/**
 * 设置单项偏好。
 * 支持 'enabled' / 'volume' / 'channel:<key>'。
 */
export function setSoundPref(key, value) {
  if (key === 'volume') {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    const next = clamp(num, RANGES.volume[0], RANGES.volume[1]);
    if (state.volume === next) return;
    state = { ...state, volume: next };
  } else if (key === 'enabled') {
    const next = !!value;
    if (state.enabled === next) return;
    state = { ...state, enabled: next };
  } else if (typeof key === 'string' && key.startsWith('channel:')) {
    const channel = key.slice('channel:'.length);
    if (!CHANNEL_KEYS.includes(channel)) return;
    const next = !!value;
    if (state.channels[channel] === next) return;
    state = { ...state, channels: { ...state.channels, [channel]: next } };
  } else {
    return;
  }
  persist();
  notify();
}

/** 切换布尔项。 */
export function toggleSoundPref(key) {
  if (key === 'enabled') {
    setSoundPref('enabled', !state.enabled);
    return;
  }
  if (typeof key === 'string' && key.startsWith('channel:')) {
    const channel = key.slice('channel:'.length);
    if (!CHANNEL_KEYS.includes(channel)) return;
    setSoundPref(key, state.channels[channel] === false);
  }
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