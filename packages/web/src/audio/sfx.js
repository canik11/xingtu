// 音效库：把「星海」的每个动作翻译成一层层合成出来的声音。
// 全部走 D 大调五声音阶（D E F# A B），任何两个音叠在一起都不会刺耳；
// 形状切换、层级下钻、点亮知识点各自有固定音型，听两次就能认出来。
import { audioReady, bell, noise, sparkle, sub, tick, tone, whoosh } from './engine.js';
import { isSoundOn } from './prefs.js';
import { setAmbientLevel, setAmbientShape } from './ambient.js';

const TAU = Math.PI * 2;

const N = {
  A1: 55.0,
  B1: 61.74,
  D2: 73.42,
  E2: 82.41,
  Fs2: 92.5,
  A2: 110.0,
  B2: 123.47,
  D3: 146.83,
  E3: 164.81,
  Fs3: 185.0,
  A3: 220.0,
  B3: 246.94,
  D4: 293.66,
  E4: 329.63,
  Fs4: 369.99,
  A4: 440.0,
  B4: 493.88,
  D5: 587.33,
  E5: 659.25,
  Fs5: 739.99,
  A5: 880.0,
  B5: 987.77,
  D6: 1174.66,
  Fs6: 1479.98,
  A6: 1760.0
};

function uiOn() {
  return audioReady() && isSoundOn('ui');
}

/* ------------------------------ 开场 ------------------------------ */

/** 等待页的氛围音：星海在呼吸，奇点在被一点点吸向中心。 */
export function introWait(dur = 2.4) {
  if (!uiOn()) return;
  // 两声很低的持续音，撑起整片黑暗的底。
  tone({ freq: N.D2, type: 'sine', dur: dur + 0.6, peak: 0.05, attack: 1.1, send: 0.5 });
  tone({ freq: N.A2, type: 'triangle', dur: dur + 0.4, peak: 0.026, attack: 1.4, send: 0.45, detune: 5 });
  // 稀疏的星铃，像远处偶尔闪一下的星。
  [0, 0.62, 1.28, 1.94].forEach((delay, i) => {
    bell(i % 2 ? N.A5 : N.D6, {
      dur: 1.9,
      peak: 0.016,
      delay,
      pan: i % 2 ? 0.32 : -0.32,
      send: 0.72,
      bright: 0.7
    });
  });
  // 气流被吸向中心：越来越亮的一层薄雾。
  noise({ dur: dur + 0.2, peak: 0.016, attack: dur * 0.8, type: 'lowpass', f0: 180, f1: 760, q: 0.7, send: 0.5 });
  // 很低的潜流，托住整个等待页。
  sub({ freq: 36, endFreq: 44, dur: dur + 0.4, peak: 0.04, attack: 1.0, send: 0.15 });
}

/** 奇点蓄力：星核在黑暗里收紧，气流被吸向中心（很短，只为给爆炸一个引信）。 */
export function introCharge(dur = 0.42) {
  if (!uiOn()) return;
  // 高频气流被吸过来：从宽到窄，像一根越拧越紧的弦。
  noise({
    dur: dur + 0.1,
    peak: 0.03,
    attack: dur * 0.85,
    type: 'bandpass',
    f0: 4800,
    f1: 1080,
    q: 0.9,
    send: 0.55
  });
  // 一小段上滑音，把注意力拉到中心。
  tone({ freq: N.A4, endFreq: N.E5, type: 'triangle', dur: dur, peak: 0.028, attack: dur * 0.8, send: 0.5 });
  // 低频潜流托底。
  sub({ freq: 42, endFreq: 58, dur: dur + 0.3, peak: 0.06, attack: dur * 0.9, send: 0.15 });
}

/** 宇宙爆炸：低频轰鸣 + 扫过的气浪 + 三声钟的余韵 + 四散的星尘。 */
export function introBlast() {
  if (!uiOn()) return;
  // 主轰鸣：从高往低砸下去，是整个爆炸的骨架。
  sub({ freq: 96, endFreq: 24, dur: 1.4, peak: 0.24, attack: 0.004, send: 0.25 });
  // 气浪：从很高扫到很低，铺满整个爆炸的宽度。
  noise({
    dur: 1.2,
    peak: 0.13,
    attack: 0.008,
    type: 'bandpass',
    f0: 7200,
    f1: 160,
    q: 0.9,
    send: 0.75
  });
  whoosh({ from: 6800, to: 180, dur: 1.1, peak: 0.06, attack: 0.006, send: 0.65, q: 1.2 });
  // 三声钟的余韵，错开几十毫秒，像爆炸后从光里浮出来的声音。
  [N.D3, N.A3, N.D4].forEach((freq, i) => {
    bell(freq, {
      dur: 3.2,
      peak: 0.085,
      attack: 0.004,
      delay: i * 0.025,
      send: 0.8,
      bright: 1.0,
      spread: 0.7
    });
  });
  // 星尘：爆炸后向四周散开的高音。
  sparkle({ count: 24, base: N.D6, spread: 2600, dur: 0.9, peak: 0.026, delay: 0.04, send: 0.7 });
  // 余震：爆炸过后低沉的一层回响。
  sub({ freq: 48, endFreq: 22, dur: 1.6, peak: 0.07, attack: 0.02, delay: 0.42, send: 0.2 });
}

/** 没能赶上自动播放时的柔和替代：星海苏醒。 */
export function awaken() {
  if (!uiOn()) return;
  sub({ freq: 36, endFreq: 44, dur: 2.4, peak: 0.045, attack: 1.2, send: 0.25 });
  bell(N.D4, { dur: 3.2, peak: 0.026, send: 0.7, bright: 0.6 });
  bell(N.A4, { dur: 3.4, peak: 0.022, send: 0.75, bright: 0.5, delay: 0.26 });
  bell(N.D5, { dur: 3.0, peak: 0.018, send: 0.8, bright: 0.45, delay: 0.52 });
  sparkle({ count: 6, base: 1800, spread: 2000, dur: 2.2, peak: 0.007, delay: 0.3, send: 0.7 });
}

/* --------------------------- 切换 3D 样式 --------------------------- */

const SHAPE_SOUND = {
  sphere: { chord: [N.D4, N.Fs4, N.A4], style: 'round' },
  galaxy: { chord: [N.D4, N.A4, N.E4, N.B4], style: 'swirl' },
  helix: { chord: [N.D4, N.A4, N.Fs4, N.D5], style: 'helix' },
  torus: { chord: [N.D3, N.A3, N.E4, N.B4], style: 'ring' },
  lattice: { chord: [N.Fs5, N.A5, N.D6], style: 'crystal' },
  wave: { chord: [N.D4, N.E4, N.A4], style: 'wave' },
  binary: { chord: [N.D3, N.A3, N.D4], style: 'binary' }
};

/**
 * 切换星海形状：先有一声「形态重排」的沙沙 + 低频收束，再落下该形状专属和弦。
 * @param {string} id sphere | galaxy | helix | torus | lattice | wave | binary
 */
export function shape(id) {
  if (!uiOn()) return;
  setAmbientShape(id);
  const preset = SHAPE_SOUND[id] || SHAPE_SOUND.sphere;
  noise({ dur: 0.4, peak: 0.042, attack: 0.16, type: 'bandpass', f0: 380, f1: 2600, q: 0.9, send: 0.2 });
  sub({ freq: 112, endFreq: 66, dur: 0.4, peak: 0.032, attack: 0.02, send: 0.12 });

  const chord = preset.chord;
  if (preset.style === 'round') {
    // 球形：最干净的大三和弦，长混响，像一颗星在正中央亮起。
    chord.forEach((f, i) =>
      bell(f, { dur: 2.2, peak: 0.052 - i * 0.006, send: 0.5, delay: 0.04 + i * 0.075, bright: 0.9 })
    );
  } else if (preset.style === 'swirl') {
    // 旋涡：和弦音左右交替，叠一层高八度三角波，像旋臂绕过耳朵。
    chord.forEach((f, i) => {
      bell(f, {
        dur: 2.6,
        peak: 0.042,
        pan: i % 2 ? 0.5 : -0.5,
        send: 0.6,
        delay: 0.04 + i * 0.085,
        spread: 0.12
      });
      tone({
        freq: f * 2,
        type: 'triangle',
        dur: 0.7,
        peak: 0.008,
        pan: i % 2 ? 0.7 : -0.7,
        send: 0.5,
        delay: 0.04 + i * 0.085
      });
    });
  } else if (preset.style === 'helix') {
    // 双螺旋：两条链接替上行，左右声道各一条，带轻微拍频。
    chord.forEach((f, i) => {
      const pan = i % 2 ? 0.35 : -0.35;
      bell(f, { dur: 1.9, peak: 0.038, pan, send: 0.5, delay: 0.05 + i * 0.11, spread: 0.06 });
      tone({
        freq: f * 0.5,
        type: 'triangle',
        dur: 0.5,
        peak: 0.016,
        pan: -pan,
        send: 0.4,
        delay: 0.05 + i * 0.11
      });
    });
  } else if (preset.style === 'ring') {
    // 星环：四个音绕一圈落点，再加极轻的高音绕场。
    const pans = [-0.55, -0.1, 0.25, 0.6];
    chord.forEach((f, i) =>
      bell(f, { dur: 2.8, peak: 0.04, pan: pans[i % 4], send: 0.65, delay: 0.04 + i * 0.09, bright: 0.8 })
    );
    for (let i = 0; i < 6; i++) {
      tone({
        freq: N.A5 * 2,
        type: 'sine',
        dur: 0.5,
        peak: 0.0035,
        pan: Math.cos((i / 6) * TAU) * 0.8,
        send: 0.7,
        delay: 0.2 + i * 0.18
      });
    }
  } else if (preset.style === 'crystal') {
    // 晶格：短促、清脆的刻面音，余下一把快速衰减的星尘。
    chord.forEach((f, i) => tick(f, { peak: 0.048, send: 0.6, delay: 0.03 + i * 0.04, dur: 0.2 }));
    sparkle({ count: 7, base: 2600, spread: 3000, dur: 1.2, peak: 0.009, delay: 0.1, send: 0.6 });
  } else if (preset.style === 'wave') {
    // 星波：每个音都带轻微上滑与滤波闭合，像涟漪一层层推开。
    chord.forEach((f, i) => {
      tone({
        freq: f * 0.98,
        endFreq: f * 1.06,
        type: 'sine',
        dur: 1.6,
        peak: 0.034,
        attack: 0.16,
        pan: Math.sin(i * 1.7) * 0.5,
        send: 0.55,
        delay: 0.04 + i * 0.13,
        filter: f * 6,
        filterEnd: f * 2,
        q: 1.2
      });
    });
  } else {
    // 双星：两颗星交替眨眼，最后合并成一个八度。
    const a = chord[0];
    const b = chord[1];
    const c = chord[2];
    for (let i = 0; i < 5; i++) {
      tone({
        freq: i % 2 ? b : a,
        type: 'triangle',
        dur: 0.42,
        peak: 0.032,
        attack: 0.004,
        pan: i % 2 ? 0.5 : -0.5,
        send: 0.3,
        delay: 0.03 + i * 0.085,
        filter: 1800
      });
    }
    bell(c, { dur: 2.4, peak: 0.048, send: 0.6, delay: 0.5 });
  }
}

/* ---------------------------- 层级导航 ---------------------------- */

/** 一级 / 二级 / 三级 / 全部：四格音阶，越往上升越高。 */
export function level(scope) {
  if (!uiOn()) return;
  const notes = [N.D3, N.A3, N.D4, N.D5];
  const index = Math.max(0, Math.min(3, (Number(scope) || 1) - 1));
  const f = notes[index];
  tick(f, { peak: 0.042, send: 0.2, dur: 0.16 });
  tone({ freq: f * 2, type: 'sine', dur: 0.7, peak: 0.018, attack: 0.004, send: 0.5 });
  sub({ freq: f / 2, dur: 0.36, peak: 0.022, attack: 0.008, send: 0.14 });
}

/** 星海 → 局部图：向下的穿越感，落点音高由层级决定。 */
export function enter(levelId) {
  if (!uiOn()) return;
  setAmbientLevel('local');
  whoosh({ from: 240, to: 2800, dur: 0.6, peak: 0.05, attack: 0.32, send: 0.35, q: 0.7 });
  sub({ freq: 78, endFreq: 40, dur: 0.7, peak: 0.052, attack: 0.02, send: 0.2 });
  const note = levelId === 3 ? N.D5 : levelId === 2 ? N.A4 : N.D4;
  bell(note, { dur: 2.0, peak: 0.042, send: 0.55, delay: 0.34, bright: 0.85 });
  bell(note * 1.5, { dur: 1.6, peak: 0.018, send: 0.6, delay: 0.42, bright: 0.6 });
  sparkle({ count: 4, base: 2200, spread: 2400, dur: 1.1, peak: 0.006, delay: 0.42, send: 0.65 });
}

/** 局部图 → 星海：反向穿越，最后展开一个开阔的三音。 */
export function sphere() {
  if (!uiOn()) return;
  setAmbientLevel('sphere');
  whoosh({ from: 3200, to: 220, dur: 0.7, peak: 0.046, attack: 0.3, send: 0.3, q: 0.75 });
  sub({ freq: 38, endFreq: 68, dur: 0.8, peak: 0.05, attack: 0.04, send: 0.2 });
  bell(N.D3, { dur: 2.6, peak: 0.046, send: 0.6, delay: 0.36, bright: 0.8 });
  bell(N.A3, { dur: 2.2, peak: 0.026, send: 0.65, delay: 0.44, bright: 0.6 });
  bell(N.D4, { dur: 2.0, peak: 0.018, send: 0.7, delay: 0.52, bright: 0.5 });
  sparkle({ count: 5, base: 1600, spread: 2200, dur: 1.4, peak: 0.006, delay: 0.4, send: 0.65 });
}

/* ---------------------------- 选中 / 面板 ---------------------------- */

let lastSelectAt = 0;

/**
 * 选中一颗星：音高按层级，声像跟着屏幕位置走。
 * @param {number} levelId 1 / 2 / 3
 * @param {number} pan -1..1
 */
export function select(levelId, pan = 0) {
  if (!uiOn()) return;
  const now = performance.now();
  if (now - lastSelectAt < 70) return;
  lastSelectAt = now;
  const note = levelId === 3 ? N.A5 : levelId === 2 ? N.A4 : N.D4;
  tone({ freq: note, type: 'sine', dur: 0.4, peak: 0.028, attack: 0.003, pan, send: 0.35 });
  tone({ freq: note * 2, type: 'sine', dur: 0.28, peak: 0.011, attack: 0.002, pan, send: 0.4, delay: 0.01 });
  tick(note * 0.5, { peak: 0.01, pan, send: 0.1, dur: 0.06 });
}

/** 取消选中：同音高的轻声收尾。 */
export function deselect() {
  if (!uiOn()) return;
  tone({ freq: N.D4, type: 'sine', dur: 0.3, peak: 0.016, attack: 0.004, send: 0.3 });
}

/** 侧栏展开：一下纸页摩擦 + 很轻的铃。 */
export function panelOpen() {
  if (!uiOn()) return;
  noise({
    dur: 0.22,
    peak: 0.028,
    attack: 0.05,
    type: 'highpass',
    f0: 700,
    f1: 2600,
    q: 0.6,
    pan: 0.25,
    send: 0.2
  });
  bell(N.A5, { dur: 1.1, peak: 0.016, send: 0.5, delay: 0.04, bright: 0.7, pan: 0.2 });
  sub({ freq: 70, dur: 0.2, peak: 0.018, attack: 0.01, send: 0.08 });
}

/** 侧栏收起：纸页回收，音高落回。 */
export function panelClose() {
  if (!uiOn()) return;
  noise({
    dur: 0.2,
    peak: 0.022,
    attack: 0.06,
    type: 'highpass',
    f0: 2400,
    f1: 700,
    q: 0.6,
    pan: 0.2,
    send: 0.18
  });
  bell(N.D5, { dur: 0.8, peak: 0.013, send: 0.45, bright: 0.55, pan: 0.15 });
}

/* --------------------------- 掌握 / 增删 --------------------------- */

/** 标记掌握（金色琶音）或取消（收回成暗色两音）。 */
export function mastery(on) {
  if (!uiOn()) return;
  if (on) {
    [N.D5, N.Fs5, N.A5, N.D6].forEach((f, i) =>
      bell(f, {
        dur: 1.8,
        peak: 0.03,
        send: 0.55,
        delay: i * 0.055,
        bright: 1.05,
        pan: -0.25 + i * 0.17
      })
    );
    sparkle({ count: 9, base: 2400, spread: 3200, dur: 1.6, peak: 0.011, delay: 0.08, send: 0.7 });
    sub({ freq: 146, dur: 0.5, peak: 0.018, attack: 0.01, send: 0.2 });
  } else {
    [N.A5, N.D5].forEach((f, i) =>
      bell(f, { dur: 1.0, peak: 0.018, send: 0.4, delay: i * 0.09, bright: 0.5 })
    );
    tone({ freq: N.Fs4, type: 'triangle', dur: 0.7, peak: 0.014, attack: 0.01, send: 0.3, delay: 0.12 });
  }
}

/** 点亮一颗新知识点：五声音阶快速上行 + 星尘。 */
export function lockLight() {
  if (!uiOn()) return;
  const notes = [N.D4, N.Fs4, N.A4, N.B4, N.D5];
  notes.forEach((f, i) => {
    bell(f, {
      dur: 1.5,
      peak: 0.032,
      send: 0.55,
      delay: i * 0.04,
      bright: 0.95,
      pan: -0.3 + i * 0.15
    });
    tone({ freq: f * 2, type: 'sine', dur: 0.5, peak: 0.006, send: 0.6, delay: i * 0.04 });
  });
  sparkle({ count: 8, base: 2200, spread: 3600, dur: 1.5, peak: 0.01, delay: 0.1, send: 0.7 });
  sub({ freq: 98, endFreq: 73, dur: 0.5, peak: 0.028, attack: 0.01, send: 0.15 });
}

/** 知识点消失：低频下坠 + 一点碎裂。 */
export function vanish() {
  if (!uiOn()) return;
  sub({ freq: 96, endFreq: 30, dur: 0.6, peak: 0.085, attack: 0.006, send: 0.25 });
  noise({
    dur: 0.5,
    peak: 0.04,
    attack: 0.004,
    type: 'lowpass',
    f0: 1600,
    f1: 120,
    q: 0.9,
    send: 0.3
  });
  for (let i = 0; i < 3; i++) {
    noise({
      dur: 0.07,
      peak: 0.011,
      attack: 0.002,
      type: 'bandpass',
      f0: 1400 + i * 600,
      q: 2,
      pan: 0.6 - i * 0.6,
      send: 0.25,
      delay: 0.04 + i * 0.04
    });
  }
}

/** 黑洞吞噬：张开时的低频下坠 + 吸积盘气声 + 碎片，0.84s 时一记闷响吞掉节点。 */
export function blackhole() {
  if (!uiOn()) return;

  // 张开：低频一路沉下去，气流从高处被卷进来。
  sub({ freq: 122, endFreq: 22, dur: 1.55, peak: 0.17, attack: 0.02, send: 0.25 });
  whoosh({ from: 5600, to: 110, dur: 1.5, peak: 0.095, attack: 0.06, q: 1.7, send: 0.5 });

  // 吸积盘：碎片被卷进去，音高越来越低、声像左右交替。
  const shards = [
    { f: N.A5, t: 0.16, p: -0.6 },
    { f: N.Fs5, t: 0.32, p: 0.55 },
    { f: N.E5, t: 0.48, p: -0.4 },
    { f: N.D5, t: 0.64, p: 0.42 },
    { f: N.A4, t: 0.78, p: -0.22 }
  ];
  shards.forEach((s) => {
    tick(s.f, { peak: 0.034, pan: s.p, send: 0.35, delay: s.t, dur: 0.12 });
  });

  // 盘面旋转的低语：左右来回的气声，让「转」听起来有实体。
  for (let i = 0; i < 4; i++) {
    noise({
      dur: 0.5,
      peak: 0.02,
      attack: 0.16,
      type: 'bandpass',
      f0: 900 + i * 260,
      f1: 480 + i * 120,
      q: 1.4,
      pan: i % 2 ? 0.5 : -0.5,
      send: 0.4,
      delay: 0.2 + i * 0.2
    });
  }

  // 吞没（约 0.84s，与动画 56% 对齐）：一记闷响 + 闭合的气流。
  sub({ freq: 78, endFreq: 21, dur: 0.7, peak: 0.19, attack: 0.004, send: 0.2, delay: 0.84 });
  noise({ dur: 0.34, peak: 0.07, attack: 0.003, type: 'lowpass', f0: 1100, f1: 80, q: 1.0, send: 0.45, delay: 0.86 });

  // 收尾：低沉余韵 + 几颗逃出来的星尘。
  bell(N.D2, { dur: 2.2, peak: 0.045, attack: 0.012, send: 0.6, delay: 1.02, bright: 0.3 });
  sparkle({ count: 4, base: N.A4, spread: 600, dur: 0.7, peak: 0.008, delay: 1.05, send: 0.6 });
}

/** 保存修改：两声很轻的确认。 */
export function saved() {
  if (!uiOn()) return;
  tone({ freq: N.A4, type: 'sine', dur: 0.55, peak: 0.024, attack: 0.004, send: 0.35 });
  bell(N.E5, { dur: 0.9, peak: 0.016, send: 0.45, delay: 0.07, bright: 0.6 });
}

/** 撤销：向下两音；重做：向上一路。 */
export function undo() {
  if (!uiOn()) return;
  bell(N.A4, { dur: 0.7, peak: 0.018, send: 0.35, bright: 0.5 });
  bell(N.Fs4, { dur: 0.9, peak: 0.016, send: 0.35, bright: 0.45, delay: 0.08 });
  noise({ dur: 0.16, peak: 0.007, attack: 0.05, type: 'bandpass', f0: 2000, f1: 700, q: 1.2, send: 0.2 });
}

export function redo() {
  if (!uiOn()) return;
  bell(N.Fs4, { dur: 0.7, peak: 0.018, send: 0.35, bright: 0.5 });
  bell(N.A4, { dur: 0.9, peak: 0.016, send: 0.35, bright: 0.45, delay: 0.08 });
  noise({ dur: 0.16, peak: 0.007, attack: 0.05, type: 'bandpass', f0: 700, f1: 2200, q: 1.2, send: 0.2 });
}

/** 导入 / 载入：一整片星图展开。 */
export function imported() {
  if (!uiOn()) return;
  [N.D4, N.A4, N.D5, N.Fs5, N.A5].forEach((f, i) =>
    bell(f, {
      dur: 2.0,
      peak: 0.024,
      send: 0.6,
      delay: i * 0.055,
      bright: 0.9,
      pan: -0.4 + i * 0.2
    })
  );
  sparkle({ count: 10, base: 1800, spread: 3400, dur: 2.2, peak: 0.009, delay: 0.15, send: 0.7 });
  sub({ freq: 73, endFreq: 110, dur: 0.8, peak: 0.028, attack: 0.2, send: 0.2 });
}

/** 导出：一颗短促的高音确认。 */
export function exported() {
  if (!uiOn()) return;
  bell(N.D6, { dur: 1.4, peak: 0.02, send: 0.5, bright: 0.8 });
  bell(N.A5, { dur: 1.6, peak: 0.016, send: 0.55, bright: 0.6, delay: 0.06 });
  sparkle({ count: 5, base: 3000, spread: 2000, dur: 1.0, peak: 0.007, delay: 0.05, send: 0.6 });
}

/* ---------------------------- 界面零件 ---------------------------- */

const MENU_NOTES = {
  export: N.A5,
  'import-doc': N.D5,
  delete: N.A3,
  kb: N.E5,
  appearance: N.Fs4,
  'global-doc': N.B5,
  reward: N.D6
};

/** ⋯ 菜单项：一声木鱼，每项音高不同。 */
export function menu(kind) {
  if (!uiOn()) return;
  tick(MENU_NOTES[kind] || N.A4, { peak: 0.028, send: 0.12, dur: 0.12 });
  if (kind === 'reward') {
    sparkle({ count: 5, base: 2400, spread: 2000, dur: 1.2, peak: 0.007, delay: 0.05, send: 0.6 });
  }
}

/** 弹窗开 / 关。 */
export function modal(open) {
  if (!uiOn()) return;
  if (open) {
    noise({
      dur: 0.26,
      peak: 0.02,
      attack: 0.08,
      type: 'highpass',
      f0: 500,
      f1: 1800,
      q: 0.5,
      send: 0.25
    });
    bell(N.D5, { dur: 1.0, peak: 0.014, send: 0.45, bright: 0.6 });
  } else {
    noise({
      dur: 0.2,
      peak: 0.016,
      attack: 0.06,
      type: 'highpass',
      f0: 1600,
      f1: 500,
      q: 0.5,
      send: 0.2
    });
    bell(N.A4, { dur: 0.7, peak: 0.011, send: 0.4, bright: 0.45 });
  }
}

/** 侧栏页签切换：一声短拨弦。 */
export function tab() {
  if (!uiOn()) return;
  tick(N.E5, { peak: 0.02, send: 0.15, dur: 0.08 });
  tone({ freq: N.B4, type: 'triangle', dur: 0.35, peak: 0.011, attack: 0.003, send: 0.3, delay: 0.01 });
}

/** 静默效果开关：旋转 / 心跳 / 膨胀 / 静止各有自己的声音。 */
export function motion(mode, on) {
  if (!uiOn()) return;
  if (mode === 'breathe') {
    if (on) {
      sub({ freq: 52, dur: 0.5, peak: 0.065, attack: 0.008, send: 0.2 });
      sub({ freq: 46, dur: 0.4, peak: 0.042, attack: 0.008, delay: 0.24, send: 0.2 });
    } else {
      sub({ freq: 46, endFreq: 36, dur: 0.5, peak: 0.04, attack: 0.02, send: 0.15 });
    }
  } else if (mode === 'puff') {
    if (on) {
      whoosh({ from: 300, to: 1600, dur: 1.6, peak: 0.032, attack: 0.8, send: 0.3, q: 0.5 });
    } else {
      whoosh({ from: 1600, to: 240, dur: 1.2, peak: 0.024, attack: 0.5, send: 0.25, q: 0.5 });
    }
  } else if (mode === 'rotate') {
    tone({
      freq: on ? N.D4 : N.A3,
      type: 'triangle',
      dur: 0.5,
      peak: 0.018,
      attack: 0.01,
      send: 0.25
    });
    tick(on ? N.A5 : N.E4, { peak: 0.013, send: 0.1 });
  } else if (mode === 'still') {
    sub({ freq: 70, endFreq: 44, dur: 0.7, peak: 0.038, attack: 0.02, send: 0.2 });
    bell(N.D4, { dur: 1.4, peak: 0.013, send: 0.5, bright: 0.4 });
  }
}

/** 重置图形 / 重置视图。 */
export function reset() {
  if (!uiOn()) return;
  whoosh({ from: 1800, to: 260, dur: 0.5, peak: 0.032, attack: 0.2, send: 0.25 });
  bell(N.D4, { dur: 1.6, peak: 0.026, send: 0.5, delay: 0.12, bright: 0.7 });
  sub({ freq: 60, endFreq: 80, dur: 0.4, peak: 0.028, attack: 0.05, send: 0.1 });
}

export function zoom() {
  if (!uiOn()) return;
  whoosh({ from: 400, to: 2200, dur: 0.35, peak: 0.023, attack: 0.12, send: 0.2, q: 1.1 });
  tick(N.A4, { peak: 0.016, send: 0.1 });
}

/** 搜索结果被打开：轻快的两音。 */
export function searchPick() {
  if (!uiOn()) return;
  bell(N.D5, { dur: 1.2, peak: 0.02, send: 0.45, bright: 0.75 });
  bell(N.A5, { dur: 1.0, peak: 0.014, send: 0.5, bright: 0.7, delay: 0.06 });
}

/** 提示 / 失败：低而短的两音，不刺耳。 */
export function nudge(ok = true) {
  if (!uiOn()) return;
  if (ok) {
    tone({ freq: N.A4, type: 'sine', dur: 0.3, peak: 0.014, attack: 0.005, send: 0.25 });
  } else {
    tone({ freq: N.A3, type: 'triangle', dur: 0.4, peak: 0.018, attack: 0.01, send: 0.2 });
    tone({ freq: N.Fs3, type: 'triangle', dur: 0.5, peak: 0.014, attack: 0.01, send: 0.2, delay: 0.08 });
  }
}

/* ---------------------------- 心跳应和 ---------------------------- */

/**
 * 心跳应和：与星海脉搏同拍的一声极低频 lub-dub。
 * 只在「心跳应和」分类打开时发声。
 */
export function heartbeat(strength = 1) {
  if (!audioReady() || !isSoundOn('pulse')) return;
  const s = Math.max(0.35, Math.min(1, Number(strength) || 1));
  sub({ freq: 50, endFreq: 44, dur: 0.38, peak: 0.05 * s, attack: 0.008, send: 0.15 });
  sub({ freq: 44, dur: 0.3, peak: 0.028 * s, attack: 0.01, delay: 0.22, send: 0.15 });
}