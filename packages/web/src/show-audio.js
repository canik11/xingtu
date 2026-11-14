// 放映模式的声音：全部用 WebAudio 现场合成，不依赖任何外部音频文件（离线/打包后同样可用）。
// 只做几件事：极低频的“咚”、心跳、落星轻响、点亮微光、拉远与升涌的气流、结尾的微光。
// 所有接口的 delay 都是「相对现在多少秒」，由 show.js 的时间轴驱动。

let ac = null;
let master = null;
let wetIn = null;
let noiseBuf = null;
let muted = false;

/** 是否静音。 */
export function audioMuted() {
  return muted;
}

/** 设置静音（淡入淡出，避免爆音）。 */
export function setMuted(value) {
  muted = !!value;
  if (!ac || !master) return muted;
  const t = ac.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(muted ? 0 : 0.82, t, 0.09);
  return muted;
}

export function toggleMute() {
  return setMuted(!muted);
}

/** 在用户手势里调用：创建/唤醒 AudioContext。 */
export function wake() {
  const c = ensure();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume().catch(() => {});
  return c;
}

/** 放映结束后挂起，别让它在后台占着音频设备。 */
export function sleep() {
  if (ac && ac.state === 'running') void ac.suspend().catch(() => {});
}

export function dispose() {
  if (!ac) return;
  void ac.close().catch(() => {});
  ac = null;
  master = null;
  wetIn = null;
  noiseBuf = null;
}

function impulse(seconds = 2.6, decay = 2.2) {
  const rate = ac.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) {
      const k = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay) * Math.min(1, i / (rate * 0.006));
    }
  }
  return buf;
}

function ensure() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ac = new AC();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -15;
  comp.knee.value = 16;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.005;
  comp.release.value = 0.3;
  comp.connect(ac.destination);

  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.82;
  master.connect(comp);

  const conv = ac.createConvolver();
  conv.buffer = impulse();
  const wetOut = ac.createGain();
  wetOut.gain.value = 0.9;
  wetIn = ac.createGain();
  wetIn.gain.value = 1;
  wetIn.connect(conv);
  conv.connect(wetOut);
  wetOut.connect(master);

  const len = Math.floor(ac.sampleRate * 2);
  noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
  return ac;
}

function at(delay = 0) {
  return ac.currentTime + Math.max(0, delay) + 0.012;
}

function route(node, send = 0) {
  node.connect(master);
  if (send > 0 && wetIn) {
    const g = ac.createGain();
    g.gain.value = send;
    node.connect(g);
    g.connect(wetIn);
  }
}

/**
 * 一个带包络的振荡器。
 * @param {{type?:OscillatorType,f0:number,f1?:number,t:number,dur:number,gain:number,attack?:number,send?:number,detune?:number}} o
 */
function tone(o) {
  const osc = ac.createOscillator();
  osc.type = o.type || 'sine';
  const f0 = Math.max(8, o.f0);
  osc.frequency.setValueAtTime(f0, o.t);
  if (o.f1 && o.f1 !== f0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.f1), o.t + o.dur * 0.92);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, o.t);
  const g = ac.createGain();
  const attack = o.attack ?? 0.008;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  osc.connect(g);
  route(g, o.send || 0);
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.06);
}

/**
 * 一段噪声（可扫频的滤波器）。
 * @param {{t:number,dur:number,gain:number,type?:BiquadFilterType,f0:number,f1?:number,q?:number,send?:number,attack?:number}} o
 */
function noise(o) {
  if (!noiseBuf) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = o.type || 'lowpass';
  filter.frequency.setValueAtTime(Math.max(20, o.f0), o.t);
  if (o.f1 && o.f1 !== o.f0) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), o.t + o.dur);
  }
  if (o.q != null) filter.Q.value = o.q;
  const g = ac.createGain();
  const attack = o.attack ?? 0.02;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  src.connect(filter);
  filter.connect(g);
  route(g, o.send || 0);
  src.start(o.t);
  src.stop(o.t + o.dur + 0.06);
}

/**
 * 镇人心魄的「咚」：极低频下潜 + 拍频 + 冲击噪声 + 长混响。
 * @param {number} delay
 * @param {number} power 0..1.4
 */
export function boom(delay = 0, power = 1) {
  if (!ensure()) return;
  const t = at(delay);
  const p = clamp01(power);
  tone({ type: 'sine', f0: 46, f1: 25, t, dur: 4.2, gain: 1.0 * p, attack: 0.014, send: 0.72 });
  tone({ type: 'sine', f0: 63, f1: 37, t, dur: 2.9, gain: 0.7 * p, attack: 0.01, send: 0.6, detune: 7 });
  tone({ type: 'sine', f0: 63.6, f1: 37.4, t, dur: 2.4, gain: 0.4 * p, attack: 0.012, send: 0.55, detune: -9 });
  tone({ type: 'triangle', f0: 150, f1: 42, t, dur: 0.42, gain: 0.5 * p, attack: 0.004, send: 0.35 });
  tone({ type: 'triangle', f0: 98, f1: 55, t, dur: 1.5, gain: 0.24 * p, attack: 0.01, send: 0.5 });
  noise({ t, dur: 0.26, gain: 0.55 * p, f0: 1500, f1: 140, q: 0.6, send: 0.5, attack: 0.004 });
  noise({ t, dur: 1.1, gain: 0.16 * p, f0: 320, f1: 90, q: 0.8, send: 0.4, attack: 0.02 });
}

/**
 * 心跳：一声主拍、间隔 0.16s 一声弱拍。
 * @param {number} delay
 * @param {number} power
 */
export function heartbeat(delay = 0, power = 1) {
  if (!ensure()) return;
  const p = clamp01(power);
  const t = at(delay);
  tone({ type: 'sine', f0: 54, f1: 33, t, dur: 0.62, gain: 0.52 * p, attack: 0.012, send: 0.28 });
  tone({ type: 'sine', f0: 54, f1: 33, t: t + 0.16, dur: 0.5, gain: 0.34 * p, attack: 0.012, send: 0.24 });
}

/** 落星轻响：很轻的一点高频，不会抢戏。 */
export function tick(delay = 0, gain = 1, pitch = 1) {
  if (!ensure()) return;
  const t = at(delay);
  const f = 980 + pitch * 620;
  tone({ type: 'triangle', f0: f, f1: f * 0.94, t, dur: 0.055, gain: 0.022 * clamp01(gain), attack: 0.003, send: 0.06 });
}

/** 点亮时的微光。 */
export function sparkle(delay = 0, gain = 1, pitch = 0.4) {
  if (!ensure()) return;
  const t = at(delay);
  const f = 2300 + pitch * 1500;
  tone({ type: 'sine', f0: f, f1: f * 1.05, t, dur: 0.16, gain: 0.016 * clamp01(gain), attack: 0.004, send: 0.4 });
  tone({ type: 'sine', f0: f * 1.5, f1: f * 1.5, t: t + 0.012, dur: 0.11, gain: 0.008 * clamp01(gain), attack: 0.004, send: 0.4 });
}

/** 镜头拉远的气流声。 */
export function whoosh(delay = 0, dur = 1.4, gain = 1) {
  if (!ensure()) return;
  const t = at(delay);
  noise({ t, dur, gain: 0.055 * clamp01(gain), type: 'bandpass', f0: 1500, f1: 180, q: 0.9, send: 0.35, attack: dur * 0.16 });
}

/** 咚之前 3 秒的升涌。 */
export function riser(delay = 0, dur = 3.2, gain = 1) {
  if (!ensure()) return;
  const t = at(delay);
  noise({ t, dur, gain: 0.085 * clamp01(gain), type: 'bandpass', f0: 160, f1: 2400, q: 1.4, send: 0.3, attack: dur * 0.82 });
  tone({ type: 'sine', f0: 38, f1: 58, t, dur, gain: 0.1 * clamp01(gain), attack: dur * 0.9, send: 0.2 });
}

/** 结尾汇聚的微光：三个高音轻轻叠在一起。 */
export function shimmer(delay = 0, dur = 6, gain = 1) {
  if (!ensure()) return;
  const t = at(delay);
  const g = 0.014 * clamp01(gain);
  [660, 990, 1320, 1980].forEach((f, i) => {
    tone({ type: 'sine', f0: f, t: t + i * 0.05, dur: dur * (0.8 + i * 0.05), gain: g / (1 + i * 0.5), attack: dur * 0.42, send: 0.75 });
  });
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}