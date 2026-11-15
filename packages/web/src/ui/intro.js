// 开场动效：奇点呼吸 → 大爆炸 → 星空与星海从中心展开。
// 纯 DOM canvas 覆盖层，WebGL 场景在爆炸瞬间由 scene/transition.js 接管遮罩。
import { TAU } from '@starmap/core';

let layer = null;
let canvas = null;
let ctx = null;
let dpr = 1;
let w = 0;
let h = 0;
let raf = 0;
let last = 0;
let phase = 'idle'; // idle | blast | done
let blastAt = 0;
let fired = false;
let finished = false;
let onBlastCb = null;
let prompt = null;

let particles = [];
let burstReady = false;

const PALETTE = ['255,255,255', '236,244,255', '214,230,255', '255,250,244'];

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

function drawCurtain(alpha) {
  if (alpha <= 0.002) return;
  ctx.fillStyle = `rgba(2,3,8,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

/** 黑幕被爆心从中心推开：铺满黑之后，用 destination-out 挖一个柔边圆洞。 */
function openCurtain(cx, cy, radius) {
  if (radius <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const g = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.86)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawSingularity(now) {
  const cx = w / 2;
  const cy = h / 2;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.0024);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 被奇点吸入的星尘。
  for (let i = 0; i < 38; i++) {
    const t = ((now * 0.00014 + i / 38) % 1);
    const a = i * 0.618 * TAU + now * (0.00022 + (i % 5) * 0.00003);
    const r = 24 + (1 - t) * (150 + (i % 7) * 16);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.86;
    const alpha = Math.sin(t * Math.PI) * 0.5;
    ctx.fillStyle = `rgba(188,219,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + (1 - t) * 1.4, 0, TAU);
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 150);
  glow.addColorStop(0, `rgba(255,255,255,${0.95})`);
  glow.addColorStop(0.06, 'rgba(226,238,255,0.9)');
  glow.addColorStop(0.2, `rgba(146,192,255,${0.36 + pulse * 0.1})`);
  glow.addColorStop(0.55, 'rgba(66,116,205,0.08)');
  glow.addColorStop(1, 'rgba(30,60,140,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, 150, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2 + pulse * 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 一次爆炸的星尘：从爆心外一圈起步，快速四散，寿命不超过 1.35 秒。 */
function spawnBurst() {
  if (burstReady) return;
  burstReady = true;
  const cx = w / 2;
  const cy = h / 2;
  particles = [];
  for (let i = 0; i < 520; i++) {
    const a = Math.random() * TAU;
    // 速度 0.85~3.15 px/ms：爆开够快，中心不会被慢粒子堆成一团白点。
    const speed = 0.85 + Math.pow(Math.random(), 1.5) * 2.3;
    const flatten = 0.58 + Math.random() * 0.62;
    const r0 = 26 + Math.random() * 40;
    particles.push({
      x: cx + Math.cos(a) * r0,
      y: cy + Math.sin(a) * r0 * 0.9,
      vx: Math.cos(a) * speed * flatten,
      vy: Math.sin(a) * speed * 0.9,
      life: 0,
      max: 900 + Math.random() * 1100,
      size: 0.7 + Math.pow(Math.random(), 2) * 2.1,
      rgb: PALETTE[Math.random() < 0.58 ? 1 : Math.random() < 0.5 ? 0 : Math.random() < 0.62 ? 3 : 2]
    });
  }
}

/* ------------------------ 花哨但单色的爆炸 ------------------------ */
// 全身只用白与冷白：靠光核、放射光丝、星芒、多重光环、星尘、闪烁点堆细节。

const WHITE = '255,255,255';
const COOL = '226,238,255';

/** 爆心亮核：纯白，0.6 秒内衰减干净。 */
function drawCore(age) {
  if (age > 700) return;
  const k = 1 - Math.min(1, age / 700);
  const a = Math.pow(k, 1.5);
  if (a <= 0.01) return;
  const cx = w / 2;
  const cy = h / 2;
  const r = 90 + (1 - k) * 380;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.16, `rgba(255,255,255,${a * 0.82})`);
  g.addColorStop(0.42, `rgba(232,242,255,${a * 0.32})`);
  g.addColorStop(0.75, `rgba(200,220,255,${a * 0.08})`);
  g.addColorStop(1, 'rgba(190,215,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

/** 放射光丝：44 条细光线从爆心射出，随时间拉长、变淡并缓慢旋转。 */
function drawRays(age) {
  const t = Math.min(1, age / 1500);
  if (t >= 1) return;
  const alpha = Math.pow(1 - t, 1.3) * 0.5;
  if (alpha <= 0.01) return;
  const cx = w / 2;
  const cy = h / 2;
  const spin = age * 0.000045;
  const reach = Math.max(w, h);
  for (let i = 0; i < 88; i++) {
    const a = (i / 88) * TAU + spin;
    const vary = 0.55 + ((i * 37) % 100) / 160;
    const inner = 46 + (i % 6) * 14;
    const outer = inner + reach * 0.74 * Math.pow(t, 0.55) * vary;
    const g = ctx.createLinearGradient(
      cx + Math.cos(a) * inner,
      cy + Math.sin(a) * inner,
      cx + Math.cos(a) * outer,
      cy + Math.sin(a) * outer
    );
    g.addColorStop(0, `rgba(${WHITE},${alpha * 0.9})`);
    g.addColorStop(0.35, `rgba(${WHITE},${alpha * 0.45})`);
    g.addColorStop(1, `rgba(${WHITE},0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = i % 3 === 0 ? 1.6 : 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.stroke();
  }
}

/** 星芒：8 道长芒与 8 道错开 22.5° 的短芒，纯白细三角。 */
function drawStarBurst(age) {
  const t = Math.min(1, age / 1200);
  if (t >= 1) return;
  const alpha = Math.pow(1 - t, 1.6) * 0.9;
  if (alpha <= 0.01) return;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.max(w, h) * 0.72;
  const len = 200 + reach * Math.pow(t, 0.5);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU - Math.PI / 2;
    const long = i % 2 === 0;
    const sl = long ? len : len * 0.42;
    const spread = long ? 0.012 : 0.008;
    const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * sl, cy + Math.sin(a) * sl);
    g.addColorStop(0, `rgba(${WHITE},${alpha})`);
    g.addColorStop(0.7, `rgba(${WHITE},${alpha * 0.22})`);
    g.addColorStop(1, `rgba(${WHITE},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - spread) * 12, cy + Math.sin(a - spread) * 12);
    ctx.lineTo(cx + Math.cos(a + spread) * 12, cy + Math.sin(a + spread) * 12);
    ctx.lineTo(cx + Math.cos(a) * sl, cy + Math.sin(a) * sl);
    ctx.closePath();
    ctx.fill();
  }
}

/** 十字光带：爆炸瞬间横竖两道宽光，0.8 秒内扫开并淡出。 */
function drawBeams(age) {
  const t = Math.min(1, age / 800);
  if (t >= 1) return;
  const alpha = Math.pow(1 - t, 2) * 0.5;
  if (alpha <= 0.01) return;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.max(w, h) * 0.75 * Math.pow(t, 0.55);
  const width = 14 + 60 * t;
  const band = (horizontal) => {
    const g = horizontal
      ? ctx.createLinearGradient(cx - reach, cy, cx + reach, cy)
      : ctx.createLinearGradient(cx, cy - reach, cx, cy + reach);
    g.addColorStop(0, `rgba(${WHITE},0)`);
    g.addColorStop(0.42, `rgba(${WHITE},${alpha * 0.5})`);
    g.addColorStop(0.5, `rgba(${WHITE},${alpha})`);
    g.addColorStop(0.58, `rgba(${WHITE},${alpha * 0.5})`);
    g.addColorStop(1, `rgba(${WHITE},0)`);
    ctx.fillStyle = g;
    if (horizontal) ctx.fillRect(cx - reach, cy - width / 2, reach * 2, width);
    else ctx.fillRect(cx - width / 2, cy - reach, width, reach * 2);
  };
  band(true);
  band(false);
}

// 十道同心光环：不同延迟、速度、粗细与亮度，一层叠一层地涌出去。
const RINGS = [
  { delay: 0, dur: 800, w: 3.2, a: 0.95, k: 0.5 },
  { delay: 50, dur: 950, w: 1.4, a: 0.8, k: 0.62 },
  { delay: 110, dur: 1100, w: 2.2, a: 0.72, k: 0.72 },
  { delay: 180, dur: 1250, w: 4.2, a: 0.6, k: 0.82 },
  { delay: 270, dur: 1400, w: 1.2, a: 0.54, k: 0.92 },
  { delay: 380, dur: 1550, w: 5.4, a: 0.46, k: 1.02 },
  { delay: 520, dur: 1700, w: 1.6, a: 0.4, k: 1.12 },
  { delay: 680, dur: 1850, w: 3.6, a: 0.34, k: 1.22 },
  { delay: 880, dur: 2050, w: 1.1, a: 0.28, k: 1.32 },
  { delay: 1100, dur: 2300, w: 2.6, a: 0.22, k: 1.42 }
];

function drawRings(age, maxR) {
  const cx = w / 2;
  const cy = h / 2;
  for (const s of RINGS) {
    const t = (age - s.delay) / s.dur;
    if (t <= 0 || t >= 1) continue;
    const ease = 1 - Math.pow(1 - t, 3);
    const r = 30 + ease * maxR * s.k;
    const width = s.w * (1 - t * 0.5) + 0.6;
    const alpha = Math.pow(1 - t, 1.4) * s.a;
    if (alpha <= 0.01) continue;
    const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - width * 3), cx, cy, r + width * 3);
    g.addColorStop(0, `rgba(${WHITE},0)`);
    g.addColorStop(0.46, `rgba(${WHITE},${alpha * 0.35})`);
    g.addColorStop(0.6, `rgba(${WHITE},${alpha})`);
    g.addColorStop(1, `rgba(${COOL},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r + width * 3, 0, TAU);
    ctx.fill();
  }
}

/* --------------------------- 闪光点：缓慢明灭 --------------------------- */

let sparks = [];

function spawnSparks() {
  if (sparks.length) return;
  sparks = [];
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * TAU;
    const r = 60 + Math.pow(Math.random(), 0.6) * 520;
    sparks.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r * 0.9,
      size: 0.8 + Math.random() * 1.8,
      phase: Math.random() * TAU,
      speed: 0.012 + Math.random() * 0.02
    });
  }
}

function drawSparks(age) {
  if (age < 220 || !sparks.length) return;
  const fade = 1 - smoothstep(2100, 2600, age);
  if (fade <= 0) return;
  const cx = w / 2;
  const cy = h / 2;
  for (const s of sparks) {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(age * s.speed + s.phase));
    const a = tw * fade * 0.85;
    if (a <= 0.02) continue;
    ctx.fillStyle = `rgba(${WHITE},${a})`;
    ctx.beginPath();
    ctx.arc(cx + s.x, cy + s.y, s.size, 0, TAU);
    ctx.fill();
  }
}

/* --------------------------- 余烬：缓慢冷却 --------------------------- */

let embers = [];

function spawnEmbers() {
  if (embers.length) return;
  const cx = w / 2;
  const cy = h / 2;
  embers = [];
  for (let i = 0; i < 72; i++) {
    const a = Math.random() * TAU;
    const speed = 0.05 + Math.random() * 0.22;
    embers.push({
      x: cx + Math.cos(a) * (20 + Math.random() * 60),
      y: cy + Math.sin(a) * (20 + Math.random() * 60) * 0.9,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed * 0.9,
      age: 0,
      life: 1800 + Math.random() * 1400,
      size: 1.2 + Math.random() * 2.2,
      rgb: Math.random() < 0.6 ? '236,244,255' : '198,216,246'
    });
  }
}

/** 余烬：飞散得比星尘慢，边飘边冷，2.3~2.9 秒之间整体淡尽。 */
function drawEmbers(dt, age) {
  if (age < 380 || !embers.length) return;
  const fade = 1 - smoothstep(2200, 2600, age);
  if (fade <= 0) return;
  for (const e of embers) {
    if (e.age >= e.life) continue;
    e.age += dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const damp = Math.pow(0.998, dt / 16.67);
    e.vx *= damp;
    e.vy = e.vy * damp - 0.000012 * dt;
    const k = 1 - e.age / e.life;
    const a = Math.pow(k, 1.2) * 0.95 * fade;
    if (a <= 0.012) continue;
    ctx.fillStyle = `rgba(${e.rgb},${a})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size * (0.5 + 0.5 * k), 0, TAU);
    ctx.fill();
  }
}

/** 推进并绘制飞散的星尘；1.08~1.48 秒之间整体淡尽。 */
function drawParticles(dt, age) {
  const fade = 1 - smoothstep(1600, 2100, age);
  if (fade <= 0) return;
  for (const p of particles) {
    p.life += dt;
    if (p.life > p.max) continue;
    const damp = Math.pow(0.995, dt / 16.67);
    p.vx *= damp;
    p.vy *= damp;
    const px = p.x;
    const py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = 1 - p.life / p.max;
    const alpha = Math.min(1, k * 1.8) * 0.9 * fade;
    if (alpha <= 0.012) continue;
    ctx.strokeStyle = `rgba(${p.rgb},${alpha * 0.42})`;
    ctx.lineWidth = p.size * 0.8;
    ctx.beginPath();
    ctx.moveTo(px - p.vx * 4.6, py - p.vy * 4.6);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = `rgba(${p.rgb},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.55 + k * 0.65), 0, TAU);
    ctx.fill();
  }
}

function fire() {
  if (fired) return;
  fired = true;
  // 爆炸瞬间让 CSS 黑幕退场，改由 canvas 的 curtain 控制：
  // curtain 淡出时，下面的 WebGL 星图会从爆炸中心一点点显露出来。
  if (layer) layer.style.background = 'transparent';
  if (onBlastCb) {
    const cb = onBlastCb;
    onBlastCb = null;
    try {
      cb();
    } catch (err) {
      // 回调里的异常不能阻断收尾，否则开场层会永久盖在星海上。
      console.error('[intro] blast callback failed', err);
    }
  }
}

function finish() {
  if (finished) return;
  finished = true;
  fire();
  cancelAnimationFrame(raf);
  unbindSkip();
  if (!layer) return;
  layer.style.transition = 'opacity .42s ease';
  layer.style.opacity = '0';
  layer.style.pointerEvents = 'none';
  const node = layer;
  layer = null;
  canvas = null;
  ctx = null;
  prompt = null;
  window.removeEventListener('resize', resize);
  setTimeout(() => node.remove(), 460);
}

function skip() {
  if (finished) return;
  if (phase === 'idle') {
    phase = 'blast';
    blastAt = performance.now() - 40;
  } else if (phase === 'blast' && performance.now() < blastAt) {
    blastAt = performance.now() - 40;
  } else {
    finish();
  }
}

function unbindSkip() {
  window.removeEventListener('pointerdown', skip, true);
  window.removeEventListener('keydown', skip, true);
}

function frame(now) {
  if (!ctx) return;
  try {
    const dt = Math.min(48, Math.max(0, now - last));
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    if (phase !== 'blast') {
      drawCurtain(1);
      drawSingularity(now);
    } else {
      const age = now - blastAt;
      if (age < 0) {
        drawCurtain(1);
        drawSingularity(now);
      } else {
        fire();
        spawnBurst();
        spawnEmbers();
        spawnSparks();
        // 黑幕先整体压着，再被爆心从中心推开，最后随爆炸余波退场。
        const veil = 1 - smoothstep(180, 760, age);
        drawCurtain(veil);
        const maxR = Math.hypot(cx, cy);
        const open = Math.min(1, age / 900);
        if (open > 0 && open < 1) openCurtain(cx, cy, maxR * Math.pow(open, 1.2) + 4);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawCore(age);
        drawRays(age);
        drawStarBurst(age);
        drawBeams(age);
        drawRings(age, maxR);
        drawParticles(dt, age);
        drawEmbers(dt, age);
        drawSparks(age);
        ctx.restore();
        // 最外侧光环与闪光点在 2.6 秒前淡尽、2.7 秒收场：星海露出后不留任何光点。
        if (age > 2800) finish();
      }
    }
  } catch (err) {
    // 某一帧画崩了也要把黑幕收掉，不能让开场层永久挡在星海前面。
    console.error('[intro] frame failed', err);
    try {
      finish();
    } catch {}
    return;
  }
  if (!finished) raf = requestAnimationFrame(frame);
}

/** 立即挂上黑幕并开始奇点呼吸；此时还没爆炸，boot 可以继续进行。 */
export function mountIntro() {
  if (layer || finished) return;
  layer = document.createElement('div');
  layer.id = 'introLayer';
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '200',
    background: '#020308',
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    touchAction: 'none',
    cursor: 'default'
  });
  layer.setAttribute('aria-hidden', 'true');
  canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  layer.appendChild(canvas);
  document.body.appendChild(layer);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  phase = 'idle';
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

/**
 * 开始爆炸；boot 完成、首帧场景就绪后调用。
 * onBlast 在爆炸瞬间触发一次（用于展开 WebGL 遮罩）。
 */
export function playIntro({ onBlast, reduced = false } = {}) {
  if (!layer) mountIntro();
  if (finished) {
    if (onBlast) onBlast();
    return;
  }
  onBlastCb = onBlast || null;
  if (reduced) {
    finish();
    return;
  }
  if (phase === 'idle') {
    phase = 'blast';
    // 点击后先让奇点收紧 180ms 蓄力，再炸开。
    blastAt = performance.now() + 180;
  }
  window.addEventListener('pointerdown', skip, true);
  window.addEventListener('keydown', skip, true);
}

/** 黑幕上的「点击任意处」提示：浏览器要一次手势才允许出声。 */
export function showIntroPrompt() {
  if (!layer || prompt) return;
  prompt = document.createElement('div');
  prompt.className = 'intro-prompt';
  prompt.innerHTML = '<span class="intro-prompt-main">点击任意处，进入星海</span>';
  layer.appendChild(prompt);
  void prompt.offsetWidth;
  prompt.classList.add('show');
}

/** 收起提示：点击后爆炸立刻开始，提示不能还留在画面上，直接移除。 */
export function hideIntroPrompt() {
  if (!prompt) return;
  const node = prompt;
  prompt = null;
  node.classList.remove('show');
  node.remove();
}

/** boot 失败或调试跳过时直接移除，不留黑屏。 */
export function destroyIntro() {
  finished = true;
  cancelAnimationFrame(raf);
  unbindSkip();
  window.removeEventListener('resize', resize);
  // 不只依赖闭包里的 layer：动画中途被收尾时 layer 可能已被置空，
  // 但节点还在 DOM 里，这里直接从文档里清掉，避免残留一层粒子画面。
  const node = layer || document.getElementById('introLayer');
  layer = null;
  canvas = null;
  ctx = null;
  prompt = null;
  if (node) node.remove();
}