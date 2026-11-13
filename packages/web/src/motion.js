// 3D 静默效果：旋转 / 心跳 / 膨胀，三项可以单独开关并叠加。
// 键名仍保留 breathe，兼容旧版保存的偏好；界面与效果已改为心跳。
// “静止”是三项都关闭时的状态；偏好独立保存在 localStorage，不影响知识库数据。
import { ui } from './state.js';

const KEY = 'starmap.motion.v1';
const MODES = ['rotate', 'breathe', 'puff'];
const LABELS = { rotate: '旋转', breathe: '心跳', puff: '膨胀' };

export function activeIdleModes() {
  return MODES.filter((mode) => !!ui.idleModes[mode]);
}

export function isStill() {
  return activeIdleModes().length === 0;
}

export function idleLabel() {
  const active = activeIdleModes();
  return active.length ? active.map((mode) => LABELS[mode]).join(' + ') : '静止';
}

export function isIdleMode(mode) {
  return MODES.includes(mode);
}

function initPuff() {
  // 从半膨胀相位开始，打开开关时马上能看到散开，而不是先等十几秒。
  ui.idlePhase = Math.PI / 2;
  ui.spherePuff = Math.max(ui.spherePuff, 0.04);
  ui.spherePuffDepth = 0.56 + Math.random() * 0.3;
  ui.spherePuffTarget = 0.03 + ui.spherePuffDepth * 0.5;
  ui.spherePuffPrevSeed = ui.spherePuffSeed;
  ui.spherePuffSeed = (Math.random() * 1e9) | 0;
  ui.spherePuffSeedMix = 0;
}

/** 开关某一项效果；切换另一项不会关掉已经打开的效果。 */
export function toggleIdleMode(mode) {
  if (mode === 'still') {
    for (const key of MODES) ui.idleModes[key] = false;
    ui.idleBreath = 1;
    ui.spherePuffTarget = 0;
    saveMotionPrefs();
    return;
  }
  if (!isIdleMode(mode)) return;
  const next = !ui.idleModes[mode];
  ui.idleModes[mode] = next;
  if (mode === 'breathe') {
    if (next) ui.breathPhase = 0;
    else ui.idleBreath = 1;
  }
  if (mode === 'puff') {
    if (next) initPuff();
    else ui.spherePuffTarget = 0;
  }
  saveMotionPrefs();
}

/** 整体设置三个开关；用于“重置球形”这类明确回到旋转状态的操作。 */
export function setIdleModes(next) {
  for (const mode of MODES) {
    const value = !!next[mode];
    if (ui.idleModes[mode] === value) continue;
    ui.idleModes[mode] = value;
    if (mode === 'breathe') {
      if (value) ui.breathPhase = 0;
      else ui.idleBreath = 1;
    }
    if (mode === 'puff') {
      if (value) initPuff();
      else ui.spherePuffTarget = 0;
    }
  }
  saveMotionPrefs();
}

export function setIdleSpeed(speed) {
  const value = Number(speed);
  if (!Number.isFinite(value)) return;
  ui.idleSpeed = Math.max(1, Math.min(6, Math.round(value * 4) / 4));
  saveMotionPrefs();
}

export function loadMotionPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return;
    // 新格式是 modes 对象；旧版本是单个 mode 字符串，继续兼容。
    const saved = raw.modes && typeof raw.modes === 'object'
      ? raw.modes
      : raw.mode && isIdleMode(raw.mode)
        ? { [raw.mode]: true }
        : null;
    if (saved) {
      for (const mode of MODES) ui.idleModes[mode] = !!saved[mode];
      if (ui.idleModes.puff) initPuff();
      if (ui.idleModes.breathe) ui.breathPhase = 0;
    } else if (raw.mode === 'still') {
      for (const mode of MODES) ui.idleModes[mode] = false;
    }
    const speed = Number(raw.speed);
    if (Number.isFinite(speed)) ui.idleSpeed = Math.max(1, Math.min(6, Math.round(speed * 4) / 4));
  } catch {
    // 隐私模式 / 禁用存储时保持默认值。
  }
}

export function saveMotionPrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      modes: { ...ui.idleModes },
      speed: ui.idleSpeed
    }));
  } catch {
    // 存储不可用时仅本次会话生效。
  }
}