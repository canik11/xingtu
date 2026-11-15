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
let waitChordTimer = 0;
let waitNoteTimer = 0;

// 等待页音乐：D 大调的四个和弦，每个停 7 秒，pad 长音 + 轻低音 + 稀疏旋律。
const WAIT_PROGRESSION = [
  { pad: [146.83, 220.0, 293.66, 369.99], bass: 73.42 }, // Dmaj7
  { pad: [123.47, 185.0, 246.94, 311.13], bass: 61.74 }, // Bm7
  { pad: [196.0, 246.94, 293.66, 392.0], bass: 49.0 }, // Gmaj7
  { pad: [110.0, 164.81, 220.0, 277.18], bass: 55.0 } // A7
];
// 旋律音阶：D5 E5 F#5 A5 B5 D6（D 大调五声）。
const WAIT_MELODY = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];

/**
 * 点击进入之前铺在等待页下的一段循环音乐：和弦进行 + 轻低音 + 稀疏钟琴旋律。
 * 全部是持续振荡器与定时音符，没有采样循环，天然首尾无缝。
 */
export function startWaitAmbience() {
  if (waitBus || !audioReady()) return null;
  const ctx = audioContext();
  if (!ctx) return null;
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.0001;
  const nodes = [out, ...connectMix(out, { pan: 0, send: 0.7 })];
  const voices = [];

  // 四声部 pad：每个声部一条振荡器，各自慢呼吸、左右分开。
  const pads = [];
  const chord = WAIT_PROGRESSION[0];
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'triangle' : 'sine';
    osc.frequency.value = chord.pad[i];
    const gain = ctx.createGain();
    gain.gain.value = 0.022 - i * 0.0035;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05 + i * 0.017;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.006;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (i - 1.5) * 0.3;
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(out);
    osc.start();
    lfo.start();
    pads.push(osc);
    voices.push(osc, lfo, gain, lfoGain, pan);
  }

  // 低音：每小节一个根音，很轻，只给和声一个底。
  const bass = ctx.createOscillator();
  bass.type = 'sine';
  bass.frequency.value = chord.bass;
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.012;
  bass.connect(bassGain);
  bassGain.connect(out);
  bass.start();
  voices.push(bass, bassGain);

  out.gain.setTargetAtTime(0.9, now + 0.04, 1.2);
  waitBus = { ctx, out, nodes, voices };

  // 和弦：每 7 秒滑到下一个。
  let step = 0;
  const nextChord = () => {
    if (!waitBus) return;
    step = (step + 1) % WAIT_PROGRESSION.length;
    const c = WAIT_PROGRESSION[step];
    const t = ctx.currentTime + 0.05;
    for (let i = 0; i < pads.length; i++) {
      try {
        pads[i].frequency.setTargetAtTime(c.pad[i], t, 1.6);
      } catch (err) {
        /* 已断开 */
      }
    }
    try {
      bass.frequency.setTargetAtTime(c.bass, t, 1.6);
    } catch (err) {
      /* 已断开 */
    }
    waitChordTimer = setTimeout(nextChord, 7000);
  };
  waitChordTimer = setTimeout(nextChord, 7000);

  // 旋律：每 0.62~0.98 秒一颗钟琴音，在五声音阶里游走，不连着重复。
  let last = -1;
  const nextNote = () => {
    if (!waitBus) return;
    let idx = Math.floor(Math.random() * WAIT_MELODY.length);
    if (idx === last) idx = (idx + 1) % WAIT_MELODY.length;
    last = idx;
    bell(WAIT_MELODY[idx], {
      dur: 2.0,
      peak: 0.03,
      attack: 0.005,
      send: 0.85,
      bright: 1.0,
      spread: 0.4,
      pan: (Math.random() - 0.5) * 0.9
    });
    waitNoteTimer = setTimeout(nextNote, 620 + Math.random() * 360);
  };
  waitNoteTimer = setTimeout(nextNote, 700);
  return waitBus;
}
/** 收起等待页背景音：淡出后释放。 */
export function stopWaitAmbience(fade = 0.7) {
  if (!waitBus) return;
  const bus = waitBus;
  waitBus = null;
  clearTimeout(waitChordTimer);
  clearTimeout(waitNoteTimer);
  const now = bus.ctx.currentTime;
  bus.out.gain.cancelScheduledValues(now);
  bus.out.gain.setValueAtTime(Math.max(0.0001, bus.out.gain.value), now);
  bus.out.gain.setTargetAtTime(0.0001, now, Math.max(0.05, fade / 3));
  setTimeout(() => {
    for (const node of [...bus.voices, ...bus.nodes]) {
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
  }, Math.round(fade * 1000) + 120);
}

/** 供调试：等待页背景音是否在响。 */
export function waitAmbienceRunning() {
  return !!waitBus;
}

