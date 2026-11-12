// 力导向模拟的“温度”控制：编辑后升温、随时间自动冷却。
// 与原版 saveEdit/拖动后重新加热的行为一致。
export const temperature = {
  alpha: 0,
  /** 每秒衰减到底的速率：alpha *= Math.pow(0.0005, dt/1000) */
  decay: 0.0005
};

/**
 * 升温：开始模拟。
 * @param {number} [value] 初始温度，默认 0.6
 */
export function heat(value = 0.6) {
  temperature.alpha = Math.max(temperature.alpha, Math.min(1, value));
}

/**
 * 每帧调用：按 dt 衰减温度。
 * @param {number} dt 毫秒
 */
export function cool(dt) {
  if (temperature.alpha <= 0) return;
  temperature.alpha *= Math.pow(temperature.decay, dt / 1000);
  if (temperature.alpha < 0.0005) temperature.alpha = 0;
}

/** 立刻停止模拟。 */
export function coolDown() {
  temperature.alpha = 0;
}