// Web Audio 合成引擎：所有声音都由振荡器 / 噪声实时合成，不加载任何音频文件。
// 这样音效可以直接内嵌进离线单文件 HTML，体积几乎为零。
// 注意：浏览器的自动播放策略要求先有用户手势，unlock 由 cues.js 负责触发。

const MAX_VOICES = 40;

let ctx = null;
let master = null;
let dryBus = null;
let wetBus = null;
let reverbIn = null;
let noiseBuffer = null;
let built = false;
let unlocked = false;
let volume = 0.6;
let voices = 0;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/** 当前 AudioContext（未创建时为 null）。 */
export function audioContext() {
  return ctx;
}

/** 是否真的能出声：已解锁且上下文在运行。 */
export function audioReady() {
  return !!ctx && ctx.state === 'running' && unlocked;
}

/** 已经拿到过用户手势。 */
export function isAudioUnlocked() {
  return unlocked;
}

/** 当前主音量（0–1）。 */
export function audioVolume() {
  return volume;
}

/** 生成一段柔和的星尘混响脉冲响应。 */
function makeImpulse(seconds, decay) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const white = Math.random() * 2 - 1;
      // 轻微低通：让尾音像远处星尘，而不是一堵白噪声墙。
      low = low * 0.58 + white * 0.42;
      data[i] = low * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}

/** 白噪声缓冲：循环播放，配合包络与滤波器做风声 / 爆发 / 摩擦。 */
function makeNoise(seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function build() {
  if (built) return ctx;
  built = true;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch (err) {
    try {
      ctx = new Ctor();
    } catch (e) {
      return null;
    }
  }

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 22;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.26;

  master = ctx.createGain();
  master.gain.value = volume;

  dryBus = ctx.createGain();
  dryBus.gain.value = 1;

  wetBus = ctx.createGain();
  wetBus.gain.value = 0.52;

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(2.9, 2.5);

  reverbIn = ctx.createGain();
  reverbIn.gain.value = 1;

  dryBus.connect(master);
  reverbIn.connect(reverb);
  reverb.connect(wetBus);
  wetBus.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.destination);

  noiseBuffer = makeNoise(2.4);
  return ctx;
}

/**
 * 在用户手势里调用：创建上下文并恢复运行。
 * @returns {Promise<boolean>} 是否已经可以发声
 */
export async function unlockAudio() {
  if (!ctx) build();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch (err) {
    /* 某些环境不允许恢复：保持静音即可。 */
  }
  unlocked = ctx.state === 'running';
  return unlocked;
}

/** 主音量（0–1），变化平滑过渡。 */
export function setMasterVolume(value) {
  volume = clamp(Number(value) || 0, 0, 1);
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  try {
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(volume, t, 0.04);
  } catch (err) {
    master.gain.value = volume;
  }
}

/** 立即静音（保留图，恢复时无爆音）。 */
export function muteAudio() {
  setMasterVolume(0);
}

function canPlay() {
  return audioReady() && voices < MAX_VOICES;
}

function takeVoice() {
  voices += 1;
}

function releaseVoice() {
  voices = Math.max(0, voices - 1);
}

/** 把一路声音接到干声总线与混响；返回尾节点以便统一断开。 */
function busOut(head, pan, send) {
  let tail = head;
  const nodes = [head];
  if (pan && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    tail.connect(panner);
    tail = panner;
    nodes.push(panner);
  }
  tail.connect(dryBus);
  if (send > 0) {
    const s = ctx.createGain();
    s.gain.value = clamp(send, 0, 1);
    tail.connect(s);
    s.connect(reverbIn);
    nodes.push(s);
  }
  return nodes;
}

/**
 * 把一条常驻声音链接入主混音（环境声这类长音用）。
 * @returns {AudioNode[]} 需要统一断开的节点
 */
export function connectMix(node, { pan = 0, send = 0.5 } = {}) {
  if (!ctx || !dryBus) return [];
  return busOut(node, pan, send);
}

function stopNodes(source, nodes, at) {
  source.onended = () => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch (err) {
        /* 已断开 */
      }
    }
    releaseVoice();
  };
  try {
    source.stop(at);
  } catch (err) {
    releaseVoice();
  }
}

/** 音高滑音 / 固定音的单个振荡器（最常用的一层）。 */
export function tone(opts = {}) {
  if (!canPlay()) return null;
  const {
    freq = 440,
    endFreq = 0,
    type = 'sine',
    dur = 0.6,
    peak = 0.08,
    attack = 0.008,
    pan = 0,
    send = 0.22,
    detune = 0,
    delay = 0,
    filter = 0,
    filterEnd = 0,
    q = 0.8,
    glide = 'exp'
  } = opts;
  const length = Math.max(0.02, dur);
  const t0 = ctx.currentTime + Math.max(0, delay);
  const tEnd = t0 + length;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), t0);
  if (endFreq) {
    if (glide === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), tEnd);
    else osc.frequency.linearRampToValueAtTime(Math.max(1, endFreq), tEnd);
  }
  if (detune) osc.detune.value = detune;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.max(0.003, attack));
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  const nodes = [gain];
  let head = osc;
  nodes.push(osc);
  if (filter) {
    const biquad = ctx.createBiquadFilter();
    biquad.type = 'lowpass';
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(filter, t0);
    if (filterEnd) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, filterEnd), tEnd);
    head.connect(biquad);
    head = biquad;
    nodes.push(biquad);
  }
  head.connect(gain);
  nodes.push(...busOut(gain, pan, send));

  takeVoice();
  osc.start(t0);
  stopNodes(osc, nodes, tEnd + 0.06);
  return osc;
}

/** 滤波噪声：风声、爆发、纸页、穿越感。 */
export function noise(opts = {}) {
  if (!canPlay()) return null;
  const {
    dur = 0.4,
    peak = 0.06,
    attack = 0.01,
    type = 'bandpass',
    f0 = 900,
    f1 = 0,
    q = 0.9,
    pan = 0,
    send = 0.16,
    delay = 0
  } = opts;
  const length = Math.max(0.02, dur);
  const t0 = ctx.currentTime + Math.max(0, delay);
  const tEnd = t0 + length;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = Math.max(0.1, q);
  filter.frequency.setValueAtTime(Math.max(30, f0), t0);
  if (f1) {
    try {
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), tEnd);
    } catch (err) {
      filter.frequency.linearRampToValueAtTime(Math.max(30, f1), tEnd);
    }
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.max(0.003, attack));
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  src.connect(filter);
  filter.connect(gain);
  const nodes = [src, filter, gain, ...busOut(gain, pan, send)];

  takeVoice();
  try {
    src.start(t0, Math.random() * 1.6);
  } catch (err) {
    src.start(t0);
  }
  stopNodes(src, nodes, tEnd + 0.06);
  return src;
}

/** 玻璃钟声：一组不成整数倍的正弦泛音，快速起音、长尾。 */
export function bell(freq, opts = {}) {
  if (!canPlay()) return null;
  const {
    dur = 1.6,
    peak = 0.07,
    pan = 0,
    send = 0.45,
    attack = 0.005,
    bright = 1,
    delay = 0,
    spread = 0
  } = opts;
  const ratios = [1, 2.002, 2.999, 4.01, 5.43];
  const levels = [1, 0.44 * bright, 0.26 * bright, 0.13 * bright, 0.075 * bright];
  for (let i = 0; i < ratios.length; i++) {
    const level = levels[i];
    if (level < 0.01) continue;
    tone({
      freq: freq * ratios[i],
      type: 'sine',
      dur: dur * (1 - i * 0.13),
      peak: peak * level,
      attack,
      pan: spread ? pan + (i % 2 ? spread : -spread) : pan,
      send,
      detune: (Math.random() * 2 - 1) * 3,
      delay
    });
  }
  return null;
}

/** 极短的木质 / 水晶点击，用于界面刻度。 */
export function tick(freq = 760, opts = {}) {
  if (!canPlay()) return null;
  const { peak = 0.035, pan = 0, send = 0.08, delay = 0, dur = 0.1 } = opts;
  tone({ freq, type: 'triangle', dur, peak, attack: 0.002, pan, send, delay });
  noise({ dur: 0.024, peak: peak * 0.35, attack: 0.001, type: 'highpass', f0: 2600, pan, send: 0.04, delay });
  return null;
}

/** 随机高频星尘：给“点亮”“爆炸”收尾。 */
export function sparkle(opts = {}) {
  if (!canPlay()) return null;
  const {
    count = 5,
    base = 1700,
    spread = 2600,
    dur = 1.2,
    peak = 0.012,
    delay = 0,
    send = 0.65
  } = opts;
  for (let i = 0; i < count; i++) {
    const f = base + Math.random() * spread;
    tone({
      freq: f,
      type: 'sine',
      dur: dur * (0.5 + Math.random() * 0.6),
      peak: peak * (0.5 + Math.random() * 0.8),
      attack: 0.004,
      pan: Math.random() * 1.6 - 0.8,
      send,
      delay: delay + Math.random() * 0.5
    });
  }
  return null;
}

/** 穿越声：带通噪声扫频。 */
export function whoosh(opts = {}) {
  if (!canPlay()) return null;
  const {
    from = 220,
    to = 2600,
    dur = 0.55,
    peak = 0.06,
    attack = 0.2,
    pan = 0,
    send = 0.3,
    delay = 0,
    q = 0.8
  } = opts;
  noise({ dur, peak, attack, type: 'bandpass', f0: from, f1: to, q, pan, send, delay });
  return null;
}

/** 低频心跳 / 呼吸感。 */
export function sub(opts = {}) {
  if (!canPlay()) return null;
  const { freq = 70, endFreq = 0, dur = 0.5, peak = 0.1, pan = 0, send = 0.1, delay = 0, attack = 0.006 } = opts;
  tone({
    freq,
    endFreq,
    type: 'sine',
    dur,
    peak,
    attack,
    pan,
    send,
    delay,
    filter: Math.max(120, freq * 4),
    q: 0.7
  });
  return null;
}

/** 供调试：当前同时发声的声源数。 */
export function voiceCount() {
  return voices;
}