// 星海环境声：一层极轻的持续和弦垫，随星海形状换调、随层级换亮度。
// 默认关闭，避免长时间学习时被声音牵着走；在「声音」面板里可以单独打开。
import { audioContext, audioReady, bell, connectMix } from './engine.js';

const LEVELS = [0.58, 0.36, 0.27, 0.17, 0.1];

// 每种形状一组音程：根音 + 五度 / 八度等，和切换形状时的琶音同源。
const PADS = {
  sphere: { root: 73.42, ratios: [1, 1.5, 2, 3, 4] },
  galaxy: { root: 55.0, ratios: [1, 1.5, 2, 2.5, 3] },
  helix: { root: 92.5, ratios: [1, 1.25, 1.5, 2, 2.5] },
  torus: { root: 73.42, ratios: [1, 1.5, 2, 2.667, 3] },
  lattice: { root: 82.41, ratios: [1, 1.5, 2, 3.75, 4] },
  wave: { root: 61.74, ratios: [1, 1.125, 1.5, 2, 2.25] },
  binary: { root: 73.42, ratios: [1, 1.5, 2, 3, 4] }
};

const BRIGHT = { sphere: 760, local: 980, inner: 880 };

let pad = null;
let running = false;
let stopTimer = 0;
let currentShape = 'sphere';
let currentLevel = 'sphere';

function buildPad() {
  if (pad) return pad;
  const ctx = audioContext();
  if (!ctx || !audioReady()) return null;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = BRIGHT.sphere;
  filter.Q.value = 0.6;

  const out = ctx.createGain();
  out.gain.value = 0.0001;
  filter.connect(out);

  // 缓慢起伏的滤波 LFO，让和弦垫像远处星云在呼吸。
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.068;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  const nodes = [filter, out, lfo, lfoGain, ...connectMix(out, { pan: 0, send: 0.6 })];

  const cfg = PADS[currentShape] || PADS.sphere;
  const voices = [];
  for (let i = 0; i < 5; i++) {
    const osc = ctx.createOscillator();
    osc.type = i < 2 ? 'triangle' : 'sine';
    osc.frequency.value = cfg.root * (cfg.ratios[i] || 4);
    osc.detune.value = (i - 2) * 4 + Math.random() * 3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(filter);
    osc.start();
    voices.push({ osc, gain });
    nodes.push(osc, gain);
  }

  pad = { ctx, filter, out, voices, nodes };
  return pad;
}

/** 打开环境声（会从 0 缓慢淡入）。 */
export function startAmbient() {
  if (!audioReady()) return;
  clearTimeout(stopTimer);
  const built = buildPad();
  if (!built) return;
  running = true;
  const t = built.ctx.currentTime;
  built.out.gain.cancelScheduledValues(t);
  built.out.gain.setValueAtTime(Math.max(0.0001, built.out.gain.value), t);
  built.out.gain.exponentialRampToValueAtTime(0.05, t + 2.6);
  applyShape(currentShape, 0.8);
  applyLevel(currentLevel);
}

/** 关闭环境声：淡出后释放节点。 */
export function stopAmbient() {
  if (!pad) {
    running = false;
    return;
  }
  running = false;
  const built = pad;
  const t = built.ctx.currentTime;
  built.out.gain.cancelScheduledValues(t);
  built.out.gain.setValueAtTime(Math.max(0.0001, built.out.gain.value), t);
  built.out.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (running) return;
    for (const node of built.nodes) {
      try {
        if (typeof node.stop === 'function') node.stop();
      } catch (err) {
        /* 已停止 */
      }
      try {
        node.disconnect();
      } catch (err) {
        /* 已断开 */
      }
    }
    if (pad === built) pad = null;
  }, 1900);
}

function applyShape(id, glide = 0.55) {
  currentShape = PADS[id] ? id : 'sphere';
  if (!pad) return;
  const cfg = PADS[currentShape];
  const t = pad.ctx.currentTime + 0.04;
  for (let i = 0; i < pad.voices.length; i++) {
    const voice = pad.voices[i];
    const ratio = cfg.ratios[i];
    const freq = cfg.root * (ratio || cfg.ratios[cfg.ratios.length - 1] || 4);
    voice.osc.frequency.cancelScheduledValues(t);
    voice.osc.frequency.setTargetAtTime(freq, t, glide);
    const target = ratio ? LEVELS[i] : 0;
    voice.gain.gain.setTargetAtTime(target, t, glide + 0.2);
  }
}

function applyLevel(level) {
  currentLevel = level === 'local' || level === 'inner' ? level : 'sphere';
  if (!pad) return;
  const target = BRIGHT[currentLevel] || BRIGHT.sphere;
  const t = pad.ctx.currentTime + 0.04;
  pad.filter.frequency.cancelScheduledValues(t);
  pad.filter.frequency.setTargetAtTime(target, t, 1.1);
}

/** 切换形状：和弦垫滑到新调。 */
export function setAmbientShape(id) {
  applyShape(id);
}

/** 切换层级：局部图更亮一点，星海更沉。 */
export function setAmbientLevel(level) {
  applyLevel(level);
}

/** 供调试 / 面板显示。 */
export function ambientState() {
  return { running, shape: currentShape, level: currentLevel, pad: !!pad };
}
/* ---------------------- 等待页的循环背景音 ---------------------- */

let waitBus = null;
let waitTimer = 0;

// 钟琴音阶：D5 E5 F#5 A5 B5 D6 E6（D 大调五声）。
const WAIT_SCALE = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66, 1318.51];

/**
 * 点击进入之前，等待页下的一小段循环钟琴：只有一颗颗钟音，没有持续音。
 * 没有持续振荡器就没有嗡嗡声；乐句之间留白，靠长混响把尾音接起来。
 */
export function startWaitAmbience() {
  if (waitBus || !audioReady()) return null;
  const ctx = audioContext();
  if (!ctx) return null;
  waitBus = { ctx };

  // 一句 3~5 个音，走五声音阶；句与句之间停 2~3.5 秒。
  let idx = 3;
  const playPhrase = () => {
    if (!waitBus) return;
    const count = 3 + Math.floor(Math.random() * 3);
    let t = 0;
    for (let i = 0; i < count; i++) {
      const step = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
      idx = Math.max(0, Math.min(WAIT_SCALE.length - 1, idx + step));
      bell(WAIT_SCALE[idx], {
        dur: 2.4,
        peak: 0.05,
        attack: 0.004,
        delay: t,
        send: 0.9,
        bright: 1.0,
        spread: 0.55,
        pan: (Math.random() - 0.5) * 0.8
      });
      t += 0.42 + Math.random() * 0.22;
    }
    waitTimer = setTimeout(playPhrase, Math.round((t + 2.0 + Math.random() * 1.5) * 1000));
  };
  waitTimer = setTimeout(playPhrase, 500);
  return waitBus;
}

/** 收起等待页背景音：停掉后续乐句，已经在响的钟音自然衰减。 */
export function stopWaitAmbience() {
  if (!waitBus) return;
  waitBus = null;
  clearTimeout(waitTimer);
}

/** 供调试：等待页背景音是否在响。 */
export function waitAmbienceRunning() {
  return !!waitBus;
}
