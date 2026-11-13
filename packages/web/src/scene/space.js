// 星空背景：星云、星点、漂浮微粒、流星、暗角与噪点。
// 纯绘制模块：只读 state.view / state.cam，不改任何业务状态。
// 参数与首版单文件保持一致，保证视觉完全复刻。
import { randRange, TAU } from '@starmap/core';
import { cam, view, flags } from '../state.js';
import { quality2d } from '../quality.js';

const mod = (value, max) => ((value % max) + max) % max;

/** 星云：位置用屏幕比例 u/v，半径按 max(W,H) 计算。 */
const NEBULAS = [
  { u: 0.23, v: 0.22, r: 0.48, c: [62, 96, 190], a: 0.1, ph: 0.2, sp: 0.9 },
  { u: 0.78, v: 0.28, r: 0.42, c: [96, 68, 175], a: 0.09, ph: 2.1, sp: 0.7 },
  { u: 0.52, v: 0.84, r: 0.52, c: [34, 112, 140], a: 0.052, ph: 4.2, sp: 0.6 },
  { u: 0.92, v: 0.72, r: 0.34, c: [54, 88, 175], a: 0.07, ph: 1.3, sp: 1.1 },
  { u: 0.07, v: 0.78, r: 0.36, c: [82, 58, 150], a: 0.055, ph: 3.4, sp: 0.8 },
  { u: 0.36, v: 0.58, r: 0.62, c: [36, 76, 150], a: 0.035, ph: 5.1, sp: 0.5 },
  { u: 0.7, v: 0.12, r: 0.3, c: [78, 66, 168], a: 0.04, ph: 4.6, sp: 0.75 }
];

/** 星点聚集的几个区域（避免星星均匀得像噪点）。 */
const STAR_CLUSTERS = [
  { u: 0.2, v: 0.22 },
  { u: 0.78, v: 0.18 },
  { u: 0.62, v: 0.74 },
  { u: 0.13, v: 0.82 },
  { u: 0.88, v: 0.58 }
];

/** @type {{u:number,v:number,z:number,r:number,a:number,tw:number,ph:number,tint:boolean,big:boolean}[]} */
let stars = [];
/** @type {{u:number,v:number,z:number,r:number,a:number,sp:number,ph:number,tw:number,bokeh:boolean}[]} */
let motes = [];
/** @type {{x:number,y:number,len:number,a:number,t:number,life:number,vx:number,vy:number}|null} */
let meteor = null;
let nextMeteor = 0;
/** @type {HTMLCanvasElement|null} */
let grainTile = null;
/** @type {CanvasPattern|null} */
let grainPattern = null;
/** @type {CanvasGradient|null} */
let bgGrad = null;
/** @type {CanvasGradient|null} */
let vignetteGrad = null;

/** 初始化星空（窗口尺寸变化时重建星点与渐变）。 */
export function initSpace() {
  const count = view.w < 700 ? 520 : 900;
  stars = [];
  for (let i = 0; i < count; i++) {
    let u = Math.random();
    let v = Math.random();
    if (Math.random() < 0.42) {
      const c = STAR_CLUSTERS[i % STAR_CLUSTERS.length];
      u = c.u + (Math.random() + Math.random() + Math.random() - 1.5) * 0.12;
      v = c.v + (Math.random() + Math.random() + Math.random() - 1.5) * 0.12;
      u = mod(u, 1);
      v = mod(v, 1);
    }
    const z = 0.15 + Math.random() * 0.85;
    stars.push({
      u,
      v,
      z,
      r: 0.35 + Math.pow(Math.random(), 2.2) * 1.55,
      a: 0.22 + Math.random() * 0.72,
      tw: 0.5 + Math.random() * 1.9,
      ph: Math.random() * TAU,
      tint: Math.random() < 0.12,
      big: Math.random() < 0.075
    });
  }

  const moteCount = view.w < 700 ? 75 : 140;
  motes = [];
  for (let i = 0; i < moteCount; i++) {
    motes.push({
      u: Math.random(),
      v: Math.random(),
      z: 0.2 + Math.random() * 0.8,
      r: 0.5 + Math.pow(Math.random(), 2) * 2.3,
      a: 0.06 + Math.random() * 0.2,
      sp: 0.35 + Math.random() * 1.4,
      ph: Math.random() * TAU,
      tw: 0.4 + Math.random() * 1.2,
      bokeh: Math.random() < 0.18
    });
  }

  meteor = null;
  nextMeteor = performance.now() + randRange(3000, 8000);
  buildGrain();
}

/** 深空底色 + 暗角（随窗口尺寸重建）。 */
export function buildBackdrop(ctx) {
  const W = Math.max(1, view.w);
  const H = Math.max(1, view.h);
  const target = ctx || null;
  if (!target) return;

  bgGrad = target.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.52, Math.max(W, H) * 0.82);
  bgGrad.addColorStop(0, '#091023');
  bgGrad.addColorStop(0.42, '#050a17');
  bgGrad.addColorStop(0.78, '#03060e');
  bgGrad.addColorStop(1, '#020308');

  vignetteGrad = target.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.18, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
  vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vignetteGrad.addColorStop(0.62, 'rgba(0,0,0,0.10)');
  vignetteGrad.addColorStop(0.85, 'rgba(0,0,0,0.34)');
  vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.74)');
}

/** 噪点贴图（避免大面积色带）。 */
function buildGrain() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 120;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  grainPattern = null;
}

/**
 * 绘制背景层：底色渐变 + 星云 + 星点 + 微粒。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} t 毫秒
 * @param {number} dt 毫秒
 */
export function drawSpace(ctx, t, dt) {
  const W = view.w;
  const H = view.h;
  if (!bgGrad) buildBackdrop(ctx);
  if (bgGrad) {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
  }

  drawNebula(ctx, t);
  drawStars(ctx, t);

  // 漂浮微粒 / 散景：与单文件旧版保持同一套分布与漂移
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const wrap = (v, max) => ((v % max) + max) % max;
  const mq = quality2d();
  const moteBright = Math.max(0.2, Math.min(3, mq.glow || 1));
  const moteSize = Math.max(0.3, Math.min(3, mq.starSize || 1));
  const moteLimit = Math.max(1, Math.round(motes.length * Math.min(1, mq.stars || 1)));
  for (let i = 0; i < moteLimit; i++) {
    const m = motes[i];
    const drift = t * 0.000012 * m.sp;
    const sx = wrap(m.u * W + drift * W * 0.2 - cam.x * 0.05, W);
    const sy = wrap(m.v * H - drift * H * 0.28 - cam.y * 0.05, H);
    const a = Math.min(1, m.a * (0.55 + 0.45 * Math.sin(t * 0.001 * m.tw + m.ph)) * moteBright);
    if (a <= 0.008) continue;
    if (m.bokeh) {
      const rr = m.r * 6 * moteSize;
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
      grd.addColorStop(0, `rgba(200,225,255,${a * 0.5})`);
      grd.addColorStop(0.5, `rgba(150,190,255,${a * 0.14})`);
      grd.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    } else {
      ctx.fillStyle = `rgba(205,228,255,${a})`;
      ctx.beginPath();
      ctx.arc(sx, sy, m.r * moteSize, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  // 流星
  drawMeteors(ctx, t, dt);
}

function drawNebula(ctx, now) {
  const W = view.w;
  const H = view.h;
  const t = now * 0.00002;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of NEBULAS) {
    const x = b.u * W + Math.sin(t * b.sp + b.ph) * W * 0.018 + cam.x * 0.012;
    const y = b.v * H + Math.cos(t * b.sp * 0.8 + b.ph) * H * 0.018 + cam.y * 0.012;
    const r = b.r * Math.max(W, H) * (1 + 0.035 * Math.sin(t * 2 + b.ph));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a})`);
    g.addColorStop(0.45, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a * 0.38})`);
    g.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function drawStars(ctx, now) {
  const W = view.w;
  const H = view.h;
  const t = now * 0.001;
  const q = quality2d();
  const sizeScale = Math.max(0.3, Math.min(3, q.starSize || 1));
  const bright = Math.max(0.2, Math.min(3, q.glow || 1));
  const limit = Math.max(1, Math.round(stars.length * Math.min(1, q.stars || 1)));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < limit; i++) {
    const s = stars[i];
    const par = 0.05 + s.z * 0.12;
    const sx = mod(s.u * W - cam.x * par, W);
    const sy = mod(s.v * H - cam.y * par * 0.7, H);
    const twinkle = 0.72 + 0.28 * Math.sin(t * s.tw + s.ph);
    const alpha = Math.min(1, s.a * twinkle * bright);
    if (alpha < 0.035) continue;
    const sr = s.r * sizeScale;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.tint ? '#fff2dc' : '#e8f2ff';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TAU);
    ctx.fill();
    if (s.big) {
      ctx.globalCompositeOperation = 'lighter';
      const rr = sr * 9;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
      g.addColorStop(0, `rgba(235,245,255,${alpha * 0.34})`);
      g.addColorStop(0.35, `rgba(170,205,255,${alpha * 0.1})`);
      g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
      ctx.strokeStyle = `rgba(225,241,255,${alpha * 0.46})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(sx - rr * 0.98, sy);
      ctx.lineTo(sx + rr * 0.98, sy);
      ctx.moveTo(sx, sy - rr * 0.82);
      ctx.lineTo(sx, sy + rr * 0.82);
      ctx.stroke();
      ctx.strokeStyle = `rgba(196,222,255,${alpha * 0.22})`;
      ctx.lineWidth = 0.5;
      const diag = rr * 0.48;
      ctx.beginPath();
      ctx.moveTo(sx - diag, sy - diag);
      ctx.lineTo(sx + diag, sy + diag);
      ctx.moveTo(sx + diag, sy - diag);
      ctx.lineTo(sx - diag, sy + diag);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = Math.min(1, alpha * 1.2);
      ctx.beginPath();
      ctx.arc(sx, sy, s.r * 0.72, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMeteors(ctx, t, dt) {
  if (!flags.reducedMotion && !meteor && t > nextMeteor) {
    const fromLeft = Math.random() > 0.45;
    meteor = {
      x: fromLeft ? randRange(-0.1, 0.5) * view.w : randRange(0.6, 1.1) * view.w,
      y: randRange(-0.05, 0.3) * view.h,
      len: randRange(90, 210),
      a: randRange(0.35, 0.8),
      t: 0,
      life: randRange(700, 1300),
      vx: fromLeft ? randRange(420, 760) : randRange(-760, -420),
      vy: randRange(160, 380)
    };
    nextMeteor = t + randRange(6000, 14000);
  }
  if (!meteor) return;
  meteor.t += dt;
  if (meteor.t > meteor.life) {
    meteor = null;
    return;
  }
  const p = meteor.t / meteor.life;
  const fade = Math.sin(Math.PI * p);
  const x = meteor.x + (meteor.vx * meteor.t) / 1000;
  const y = meteor.y + (meteor.vy * meteor.t) / 1000;
  const norm = Math.hypot(meteor.vx, meteor.vy) || 1;
  const nx = meteor.vx / norm;
  const ny = meteor.vy / norm;
  const tx = x - nx * meteor.len;
  const ty = y - ny * meteor.len;
  const grd = ctx.createLinearGradient(tx, ty, x, y);
  grd.addColorStop(0, 'rgba(200,220,255,0)');
  grd.addColorStop(1, `rgba(236,244,255,${meteor.a * fade})`);
  ctx.strokeStyle = grd;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(x, y);
  ctx.stroke();
}

/** 暗角：让画面四角沉入深空。 */
export function drawVignette(ctx) {
  if (!vignetteGrad) return;
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, view.w, view.h);
}

/** 噪点叠加。 */
export function drawGrain(ctx) {
  if (!grainTile) return;
  if (!grainPattern) grainPattern = ctx.createPattern(grainTile, 'repeat');
  if (!grainPattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.restore();
}

/** 重置噪点（窗口尺寸变化时可丢弃旧 pattern）。 */
export function resetGrainPattern() {
  grainPattern = null;
}