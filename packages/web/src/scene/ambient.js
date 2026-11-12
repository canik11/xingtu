// 空间里的白色发光微粒：慢速漂浮，对悬停 / 拖动 / 点击做纯装饰性响应。
// 只读 view / flags，不参与任何业务数据或命中判定。
import { TAU, clamp } from '@starmap/core';
import { el } from '../lib/dom.js';
import { view, flags } from '../state.js';

const MAX_SPARKS = 220;

/** @type {{x:number,y:number,vx:number,vy:number,r:number,a:number,ph:number,tw:number,heat:number}[]} */
let particles = [];
/** @type {{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,r:number}[]} */
let sparks = [];
/** @type {{x:number,y:number,life:number,maxLife:number,r:number}[]} */
let ripples = [];

const pointer = {
  active: false,
  down: false,
  x: 0,
  y: 0,
  downX: 0,
  downY: 0,
  lastTrailX: 0,
  lastTrailY: 0,
  downAt: 0
};

let bound = false;
let lastTime = 0;
let whiteSprite = null;

function makeSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.045)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function sprite() {
  if (!whiteSprite) whiteSprite = makeSprite();
  return whiteSprite;
}

const rand = (a, b) => a + Math.random() * (b - a);

/** 初始化/重建环境粒子（窗口尺寸变化时也可调用）。 */
export function initAmbient() {
  const count = view.w < 700 ? 130 : 240;
  particles = [];
  for (let i = 0; i < count; i++) {
    const big = Math.random() < 0.14;
    const speed = rand(18, 46);
    const angle = Math.random() * TAU;
    particles.push({
      x: Math.random() * Math.max(1, view.w),
      y: Math.random() * Math.max(1, view.h),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.8,
      r: big ? rand(1.15, 2.35) : rand(0.3, 1.05),
      a: big ? rand(0.5, 0.78) : rand(0.24, 0.58),
      ph: Math.random() * TAU,
      tw: 0.65 + Math.random() * 1.8,
      heat: 0
    });
  }
  sparks = [];
  ripples = [];
  lastTime = 0;
}

function addSpark(x, y, vx, vy, r, life) {
  if (sparks.length >= MAX_SPARKS) sparks.shift();
  sparks.push({ x, y, vx, vy, life, maxLife: life, r });
}

function burst(x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + Math.random() * 0.5;
    const speed = rand(42, 190);
    addSpark(
      x + Math.cos(a) * rand(1, 8),
      y + Math.sin(a) * rand(1, 8),
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      rand(0.7, 1.8),
      rand(420, 900)
    );
  }
  ripples.push({ x, y, life: 560, maxLife: 560, r: 0 });
}

function trailSpark(x, y, dx, dy) {
  const norm = Math.hypot(dx, dy) || 1;
  const side = Math.random() < 0.5 ? -1 : 1;
  const nx = (-dy / norm) * side;
  const ny = (dx / norm) * side;
  const speed = rand(12, 48);
  addSpark(
    x + nx * rand(2, 8),
    y + ny * rand(2, 8),
    nx * speed + rand(-8, 8),
    ny * speed + rand(-8, 8),
    rand(0.55, 1.5),
    rand(360, 760)
  );
}

function bindStage() {
  if (bound) return;
  bound = true;
  const stage = el.stage;
  if (!stage) return;

  stage.addEventListener('pointerenter', (e) => {
    pointer.active = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });

  stage.addEventListener('pointermove', (e) => {
    pointer.active = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    if (!pointer.down) return;
    const dx = e.clientX - pointer.lastTrailX;
    const dy = e.clientY - pointer.lastTrailY;
    if (Math.hypot(dx, dy) < 7) return;
    trailSpark(e.clientX, e.clientY, dx, dy);
    pointer.lastTrailX = e.clientX;
    pointer.lastTrailY = e.clientY;
  });

  stage.addEventListener('pointerleave', () => {
    if (!pointer.down) pointer.active = false;
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointer.active = true;
    pointer.down = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.downX = e.clientX;
    pointer.downY = e.clientY;
    pointer.lastTrailX = e.clientX;
    pointer.lastTrailY = e.clientY;
    pointer.downAt = performance.now();
  });

  const end = (e) => {
    if (!pointer.down) return;
    const moved = Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY);
    const quick = performance.now() - pointer.downAt < 620;
    pointer.down = false;
    if (moved < 7 && quick) burst(e.clientX, e.clientY, 18);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

/** 绑定一次画布指针事件；重复调用安全。 */
export function bindAmbient() {
  bindStage();
}

/** 每帧推进：悬浮时靠近的粒子会亮起；拖拽时被推开并留下光点。 */
export function updateAmbient(dt, t) {
  if (!particles.length) initAmbient();
  const s = Math.min(50, Math.max(0, dt)) / 1000;
  const motion = flags.reducedMotion ? 0.25 : 1;
  const W = Math.max(1, view.w);
  const H = Math.max(1, view.h);

  for (const p of particles) {
    p.ph += s * p.tw * 0.8;
    // 直线漂移叠加轻微横向摆动，让运动更容易被看见。
    p.x += (p.vx + Math.cos(p.ph * 0.7) * 7) * s * motion;
    p.y += (p.vy + Math.sin(p.ph * 0.9) * 5) * s * motion;

    let targetHeat = 0;

    if (pointer.active) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < 200) {
        const f = 1 - d / 200;
        targetHeat = f * (pointer.down ? 1 : 0.85);
        const inv = 1 / Math.max(1, d);
        const push = (pointer.down ? 26 : 7) * f * s;
        p.x += dx * inv * (pointer.down ? push : -push * 0.55);
        p.y += dy * inv * (pointer.down ? push : -push * 0.55);
      }
    }

    p.heat += (targetHeat - p.heat) * Math.min(1, s * 9);

    if (p.x < -30) p.x = W + 30;
    else if (p.x > W + 30) p.x = -30;
    if (p.y < -30) p.y = H + 30;
    else if (p.y > H + 30) p.y = -30;
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const sp = sparks[i];
    sp.life -= dt;
    if (sp.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    const step = s * 60;
    sp.x += sp.vx * s;
    sp.y += sp.vy * s;
    const damp = Math.pow(0.94, step);
    sp.vx *= damp;
    sp.vy = sp.vy * damp + 4 * s;
  }

  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.life -= dt;
    if (r.life <= 0) {
      ripples.splice(i, 1);
      continue;
    }
    r.r = (1 - r.life / r.maxLife) * 86;
  }

  lastTime = t;
}

/** 画在星空之后、节点之前；纯装饰，不改变鼠标命中。 */
export function drawAmbient(ctx, t) {
  if (!particles.length) initAmbient();
  const W = view.w;
  const H = view.h;
  const spriteImage = sprite();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (pointer.active) {
    const pulse = flags.reducedMotion ? 0 : Math.sin(t * 0.0016) * 0.01;
    const radius = pointer.down ? 108 : 90;
    const halo = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
    halo.addColorStop(0, `rgba(255,255,255,${(pointer.down ? 0.10 : 0.055) + pulse})`);
    halo.addColorStop(0.5, 'rgba(255,255,255,0.018)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(pointer.x - radius, pointer.y - radius, radius * 2, radius * 2);
  }

  for (const p of particles) {
    const twinkle = 0.7 + 0.3 * Math.sin(t * 0.001 * p.tw + p.ph);
    const alpha = clamp(p.a * twinkle + p.heat * 0.55, 0, 1);
    if (alpha <= 0.025) continue;
    const size = p.r * (5.8 + p.heat * 8);
    if (p.x < -size || p.x > W + size || p.y < -size || p.y > H + size) continue;

    ctx.globalAlpha = alpha;
    ctx.drawImage(spriteImage, p.x - size / 2, p.y - size / 2, size, size);
    ctx.globalAlpha = Math.min(1, alpha * 1.25);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.35, p.r * 0.32), 0, TAU);
    ctx.fill();
  }

  for (const sp of sparks) {
    const life = clamp(sp.life / sp.maxLife, 0, 1);
    const size = sp.r * (7 + life * 6);
    ctx.globalAlpha = life * 0.8;
    ctx.drawImage(spriteImage, sp.x - size / 2, sp.y - size / 2, size, size);
    ctx.globalAlpha = life * 0.68;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, Math.max(0.32, sp.r * 0.34), 0, TAU);
    ctx.fill();
  }

  for (const r of ripples) {
    const p = r.life / r.maxLife;
    ctx.globalAlpha = p * 0.42;
    ctx.strokeStyle = 'rgba(245,250,255,0.95)';
    ctx.lineWidth = 1.15;
    ctx.shadowColor = 'rgba(230,242,255,0.7)';
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(1, r.r), 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** 调试/验收只读信息。 */
export function ambientStats() {
  return {
    particles: particles.length,
    sparks: sparks.length,
    ripples: ripples.length,
    pointer: { active: pointer.active, down: pointer.down, x: pointer.x, y: pointer.y },
    lastTime
  };
}