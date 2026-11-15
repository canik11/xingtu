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

const PALETTE = ['255,255,255', '206,229,255', '255,224,184', '160,194,255'];

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
  for (let i = 0; i < 340; i++) {
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
      max: 620 + Math.random() * 700,
      size: 0.7 + Math.pow(Math.random(), 2) * 2.1,
      rgb: PALETTE[Math.random() < 0.58 ? 1 : Math.random() < 0.5 ? 0 : Math.random() < 0.62 ? 3 : 2]
    });
  }
}

/** 爆心亮核：最热的一瞬是白的，随后迅速转金，0.62 秒内衰减干净。 */
function drawCore(age) {
  if (age > 620) return;
  const k = 1 - Math.min(1, age / 620);
  const a = Math.pow(k, 1.6) * 0.98;
  if (a <= 0.01) return;
  // 白热（255,252,244）→ 金（255,178,110）。
  const warm = Math.min(1, age / 420);
  const cr = 255;
  const cg = Math.round(252 - 74 * warm);
  const cb = Math.round(244 - 134 * warm);
  const cx = w / 2;
  const cy = h / 2;
  const r = 64 + (1 - k) * 260;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
  g.addColorStop(0.22, `rgba(${cr},${cg},${cb},${a * 0.55})`);
  g.addColorStop(0.62, `rgba(236,236,255,${a * 0.15})`);
  g.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

/* ------------------------- 超新星：多层气壳 ------------------------- */

// 三层气壳：内层白热转金、中层金转橙红、外层蓝白转深蓝，依次撑开。
const SHELLS = [
  { delay: 20, dur: 1400, r0: 14, k: 0.5, w: 30, hot: [255, 248, 236], cool: [255, 176, 72] },
  { delay: 130, dur: 1700, r0: 4, k: 0.78, w: 40, hot: [255, 206, 132], cool: [255, 116, 72] },
  { delay: 260, dur: 2100, r0: 0, k: 1.05, w: 54, hot: [214, 232, 255], cool: [96, 140, 250] }
];

/** 气壳：半径随 age 向外撑开、越走越薄，颜色从热到冷。 */
function drawShells(age, maxR) {
  const cx = w / 2;
  const cy = h / 2;
  for (const s of SHELLS) {
    const t = (age - s.delay) / s.dur;
    if (t <= 0 || t >= 1) continue;
    const ease = 1 - Math.pow(1 - t, 3);
    const r = s.r0 + ease * (maxR * s.k);
    const width = s.w * (1 - t * 0.62) + 6;
    const alpha = Math.pow(1 - t, 1.4) * 0.78;
    if (alpha <= 0.01) continue;
    const cr = Math.round(s.hot[0] + (s.cool[0] - s.hot[0]) * t);
    const cg = Math.round(s.hot[1] + (s.cool[1] - s.hot[1]) * t);
    const cb = Math.round(s.hot[2] + (s.cool[2] - s.hot[2]) * t);
    const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - width), cx, cy, r + width);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
    g.addColorStop(0.42, `rgba(${cr},${cg},${cb},${alpha * 0.55})`);
    g.addColorStop(0.62, `rgba(${cr},${cg},${cb},${alpha})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r + width, 0, TAU);
    ctx.fill();
  }
}

/** 三圈冲击波：白、金、蓝三种温度，依次从爆心扩到屏幕外。 */
const SHOCK_RGB = ['226,240,255', '255,206,150', '152,182,255'];

function drawShock(age) {
  const cx = w / 2;
  const cy = h / 2;
  const max = Math.max(w, h);
  for (let i = 0; i < 3; i++) {
    const t = (age - i * 80) / (780 + i * 260);
    if (t < 0 || t > 1) continue;
    const r = 34 + Math.pow(t, 0.5) * (max * 0.72);
    const alpha = (1 - t) * (0.34 - i * 0.08);
    if (alpha <= 0.008) continue;
    const rgb = SHOCK_RGB[i];
    const glow = ctx.createRadialGradient(cx, cy, r * 0.84, cx, cy, r);
    glow.addColorStop(0, `rgba(${rgb},0)`);
    glow.addColorStop(0.72, `rgba(${rgb},${alpha * 0.5})`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 1.8 * (1 - t) + 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
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
      rgb: Math.random() < 0.45 ? '255,186,118' : Math.random() < 0.6 ? '255,128,86' : '214,96,92'
    });
  }
}

/** 余烬：飞散得比星尘慢，边飘边冷，2.3~2.9 秒之间整体淡尽。 */
function drawEmbers(dt, age) {
  if (age < 380 || !embers.length) return;
  const fade = 1 - smoothstep(2600, 3200, age);
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
  const fade = 1 - smoothstep(1080, 1480, age);
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
        // 黑幕先整体压着，再被爆心从中心推开，最后随爆炸余波退场。
        const veil = 1 - smoothstep(180, 760, age);
        drawCurtain(veil);
        const maxR = Math.hypot(cx, cy);
        const open = Math.min(1, age / 900);
        if (open > 0 && open < 1) openCurtain(cx, cy, maxR * Math.pow(open, 1.2) + 4);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawCore(age);
        drawShells(age, maxR);
        drawShock(age);
        drawParticles(dt, age);
        drawEmbers(dt, age);
        ctx.restore();
        // 余烬在 3.2 秒前淡尽、3.4 秒收场：星海露出后不留任何光点。
        if (age > 3400) finish();
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