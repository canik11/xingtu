// 放映模式的声音：全部实时合成，不依赖任何音频资源。
// 低音铺底（pad）+ 五声音阶星铃 + 课程降临的低频“咚” + 混响，随放映进程淡入淡出。
const BASE_FREQ = 146.83; // D3
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

function freq(semitone) {
  return BASE_FREQ * Math.pow(2, semitone / 12);
}

function gainNode(ctx, value = 0.0001) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function filterNode(ctx, type, frequency, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

export class PresentationAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.pad = null;
    this.ready = false;
    this.timers = [];
  }

  /** 必须在用户手势（点击放映按钮）同步调用，浏览器的自动播放策略才放行。 */
  start() {
    if (this.ready) return true;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = gainNode(ctx, 0.0001);
      this.master.connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(3.2, 2.6);
      const wet = gainNode(ctx, 0.55);
      this.reverb.connect(wet);
      wet.connect(this.master);

      this.buildPad();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      this.master.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 3.2);
      this.ready = true;
      return true;
    } catch (error) {
      console.warn('[starmap] 放映音效不可用', error);
      this.ready = false;
      return false;
    }
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const channel = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  buildPad() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pad = gainNode(ctx, 0.0001);
    const filter = filterNode(ctx, 'lowpass', 780, 0.6);
    pad.connect(filter);
    filter.connect(this.master);
    const send = gainNode(ctx, 0.45);
    filter.connect(send);
    send.connect(this.reverb);
    pad.gain.setValueAtTime(0.0001, now);
    pad.gain.exponentialRampToValueAtTime(0.05, now + 4);

    // 极缓的滤波呼吸，避免长音听起来是死的。
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoGain = gainNode(ctx, 320);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);

    const voices = [
      { st: -12, type: 'sine', gain: 0.5, detune: -3 },
      { st: 0, type: 'triangle', gain: 0.26, detune: 2 },
      { st: 7, type: 'triangle', gain: 0.2, detune: -4 },
      { st: 12, type: 'sine', gain: 0.16, detune: 5 },
      { st: 16, type: 'sine', gain: 0.1, detune: -6 }
    ];
    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.frequency.value = freq(voice.st);
      osc.detune.value = voice.detune;
      const gain = gainNode(ctx, voice.gain);
      osc.connect(gain);
      gain.connect(pad);
      osc.start(now);
    }
    this.pad = pad;
  }

  /** 星铃：三角波 + 一个八度泛音，快速起音、长衰减，送进混响。 */
  chime(semitone = 0, level = 0.12, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const gain = gainNode(ctx, 0.0001);
    gain.connect(this.master);
    const send = gainNode(ctx, 0.5);
    gain.connect(send);
    send.connect(this.reverb);

    const main = ctx.createOscillator();
    main.type = 'triangle';
    main.frequency.value = freq(semitone);
    main.connect(gain);
    main.start(t);

    const overtone = ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.value = freq(semitone + 12);
    const og = gainNode(ctx, 0.24);
    overtone.connect(og);
    og.connect(gain);
    overtone.start(t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.02, level), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    main.stop(t + 2);
    overtone.stop(t + 1.4);
  }

  /** 镇人心魄的“咚”：低频下坠 + 一层闷住的冲击噪声。 */
  thud() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.85);
    const gain = gainNode(ctx, 0.0001);
    osc.connect(gain);
    gain.connect(this.master);
    const send = gainNode(ctx, 0.7);
    gain.connect(send);
    send.connect(this.reverb);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.95, t + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    osc.start(t);
    osc.stop(t + 2.8);

    const noise = ctx.createBufferSource();
    noise.buffer = this.makeImpulse(0.6, 1.6);
    const low = filterNode(ctx, 'lowpass', 480, 0.8);
    const ng = gainNode(ctx, 0.0001);
    noise.connect(low);
    low.connect(ng);
    ng.connect(this.master);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.34, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    noise.start(t);
    noise.stop(t + 0.7);

    // 上方的气声，让“咚”不只是一团低音。
    const air = ctx.createBufferSource();
    air.buffer = this.makeImpulse(1.2, 2.4);
    const band = filterNode(ctx, 'bandpass', 2600, 0.9);
    const ag = gainNode(ctx, 0.0001);
    air.connect(band);
    band.connect(ag);
    ag.connect(this.reverb);
    band.frequency.setValueAtTime(2600, t);
    band.frequency.exponentialRampToValueAtTime(700, t + 1.1);
    ag.gain.setValueAtTime(0.0001, t);
    ag.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
    ag.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    air.start(t);
    air.stop(t + 1.3);
  }

  /** 星雨：稀疏的轻铃，密度由放映节奏控制。 */
  rain(level = 0.07) {
    const index = Math.floor(Math.random() * 7);
    this.chime(PENTATONIC[index], level, Math.random() * 0.05);
  }

  /** 变色扫过：一段极轻的上行气声。 */
  sweep(duration = 2.4, level = 0.1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.makeImpulse(duration * 0.8, 1.1);
    const band = filterNode(ctx, 'bandpass', 420, 1.6);
    const gain = gainNode(ctx, 0.0001);
    src.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    const send = gainNode(ctx, 0.7);
    gain.connect(send);
    send.connect(this.reverb);
    band.frequency.setValueAtTime(420, t);
    band.frequency.exponentialRampToValueAtTime(2800, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  /** 汇聚成球：一串上行的和声。 */
  finale() {
    if (!this.ready) return;
    const chord = [12, 16, 19, 24, 28];
    chord.forEach((semitone, i) => this.chime(semitone, 0.1 + i * 0.012, i * 0.16));
  }

  /** 定时星铃：按 interval 毫秒反复触发，用于长镜头的呼吸感。 */
  scheduleRain(interval = 620, level = 0.06) {
    if (!this.ready) return;
    this.timers.push(
      window.setInterval(() => {
        if (this.ready) this.rain(level);
      }, interval)
    );
  }

  stop() {
    const ctx = this.ctx;
    this.ready = false;
    for (const id of this.timers) window.clearInterval(id);
    this.timers = [];
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.master) {
      try {
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
        this.master.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      } catch (error) {
        /* 忽略：上下文可能已经关闭。 */
      }
    }
    window.setTimeout(() => {
      try {
        ctx.close();
      } catch (error) {
        /* 忽略重复关闭。 */
      }
    }, 1500);
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.pad = null;
  }
}

export const presentationAudio = new PresentationAudio();