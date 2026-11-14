// 放映模式：把整座星盘当着星空放一遍。
// 落星（不亮）→ 一级大节点齐落（咚 + 心跳 + 涟漪）→ 随机点亮 → 未掌握转掌握 → 汇聚成 3D 星球。
// 全程零文字：入口在工具条，退出用 Esc，静音用 M。
import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { TAU, clamp, hashStr, mod, randRange } from '@starmap/core';
import { chaptersOf, getOutline, pointsOf } from './outline.js';
import { appearanceColors, masteryFor } from './mastery.js';
import { quality3d } from './quality.js';
import { pauseLoop, resumeLoop } from './loop.js';
import * as sound from './show-audio.js';
import {
  bgTexture,
  coreTexture,
  crossTexture,
  glowTexture,
  grainTexture,
  nodeStarTexture,
  pulseRingTexture,
  sparkTexture,
  starTexture,
  vignetteTexture
} from './scene/gl-textures.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ===== 小工具 =====
const clamp01 = (v) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const mix = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOutCubic = (x) => {
  const k = clamp01(x);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};
const smoothstep = (x) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const rgbHex = (r, g, b) =>
  ((clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)) >>> 0;
const phaseOf = (id) => (((hashStr(id) >>> 0) % 4096) / 4096) * TAU;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== 时间轴（秒）=====
const PH = {
  veilIn: 0.9,
  firstSpawn: 1.15,
  firstFall: 1.65,
  pull: 3.1,
  pullDur: 12.5,
  rainStart: 3.1,
  rainSpan: 30,
  chapSpan: 7.2,
  breath: 1.35,
  courseFall: 1.55,
  quiet: 5.6,
  igniteSpan: 9.6,
  igniteHold: 0.6,
  turnSpan: 9,
  gatherLead: 1.4,
  gather: 11,
  hold: 8,
  fadeOut: 1.7
};
const rainEnd = PH.rainStart + PH.rainSpan;
const chapStart = rainEnd;
const chapEnd = chapStart + PH.chapSpan;
const courseSpawn = chapEnd + PH.breath;
const boomAt = courseSpawn + PH.courseFall;
const igniteStart = boomAt + PH.quiet;
const igniteEnd = igniteStart + PH.igniteSpan;
const turnStart = igniteEnd + PH.igniteHold;
const turnEnd = turnStart + PH.turnSpan;
const gatherStart = turnEnd + PH.gatherLead;
const gatherEnd = gatherStart + PH.gather;
const holdEnd = gatherEnd + PH.hold;
const endAt = holdEnd + PH.fadeOut;

const RIP_LIFE = 2.4;

// 落星节奏：前松后紧（同一段时间里越往后落得越急）。
function rainCum(u) {
  return 0.12 * u + (2.2 / 2.6) * Math.pow(u, 2.6);
}
const RAIN_TOTAL = rainCum(1);
function rainCurve(frac) {
  const target = clamp01(frac) * RAIN_TOTAL;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (rainCum(mid) < target) lo = mid;
    else hi = mid;
  }
  return lo;
}

function rainIntensity(t) {
  if (t < PH.rainStart) return 0;
  if (t < rainEnd) {
    const u = (t - PH.rainStart) / PH.rainSpan;
    return 0.12 + 0.88 * Math.pow(u, 1.6);
  }
  if (t < chapEnd) return 0.3;
  if (t < chapEnd + 1) return 0.3 * (1 - (t - chapEnd));
  return 0;
}

// ===== 纹理 / 常量 =====
let streakCache = null;
function streakTexture() {
  if (streakCache) return streakCache;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.86, 'rgba(255,255,255,0.78)');
  grd.addColorStop(1, 'rgba(255,255,255,0.96)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(0.42, 'rgba(0,0,0,0.85)');
  side.addColorStop(0.5, 'rgba(0,0,0,1)');
  side.addColorStop(0.58, 'rgba(0,0,0,0.85)');
  side.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 256);
  streakCache = Texture.from(c);
  streakCache.source.scaleMode = 'linear';
  return streakCache;
}
let waterCache = null;
function waterRingTexture() {
  if (waterCache) return waterCache;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0)');
  grd.addColorStop(0.72, 'rgba(196,226,255,0.09)');
  grd.addColorStop(0.855, 'rgba(255,255,255,0.32)');
  grd.addColorStop(0.905, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.943, 'rgba(198,228,255,0.26)');
  grd.addColorStop(0.975, 'rgba(255,255,255,0.05)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  waterCache = Texture.from(c);
  waterCache.source.scaleMode = 'linear';
  return waterCache;
}
const TEX = {
  glow: glowTexture(),
  core: coreTexture(),
  star: nodeStarTexture(),
  spark: sparkTexture(),
  dot: starTexture(),
  cross: crossTexture(),
  bg: bgTexture(),
  vignette: vignetteTexture(),
  grain: grainTexture(),
  streak: streakTexture(),
  water: waterRingTexture(),
  ring: pulseRingTexture()
};
const K_GLOW = 1 / TEX.glow.width;
const K_CORE = 1 / TEX.core.width;
const K_STAR = 1 / TEX.star.width;

const NEBULAS = [
  { u: 0.23, v: 0.22, r: 0.48, c: 0x3e60be, a: 0.1, ph: 0.2, sp: 0.9 },
  { u: 0.78, v: 0.28, r: 0.42, c: 0x6044af, a: 0.09, ph: 2.1, sp: 0.7 },
  { u: 0.52, v: 0.84, r: 0.52, c: 0x22708c, a: 0.052, ph: 4.2, sp: 0.6 },
  { u: 0.92, v: 0.72, r: 0.34, c: 0x3658af, a: 0.07, ph: 1.3, sp: 1.1 },
  { u: 0.07, v: 0.78, r: 0.36, c: 0x523a96, a: 0.055, ph: 3.4, sp: 0.8 },
  { u: 0.36, v: 0.58, r: 0.62, c: 0x244c96, a: 0.035, ph: 5.1, sp: 0.5 },
  { u: 0.7, v: 0.12, r: 0.3, c: 0x4e42a8, a: 0.04, ph: 4.6, sp: 0.75 }
];
const STAR_CLUSTERS = [
  { u: 0.2, v: 0.22 },
  { u: 0.78, v: 0.18 },
  { u: 0.62, v: 0.74 },
  { u: 0.13, v: 0.82 },
  { u: 0.88, v: 0.58 }
];
// 银河带：三段被拉长的柔光，斜着压在天空上。
const BANDS = [
  { w: 1.9, h: 0.62, rot: -0.34, tint: 0x2b3f86, a: 0.13, x: 0.5, y: 0.44 },
  { w: 1.62, h: 0.34, rot: -0.3, tint: 0x5f7fd8, a: 0.14, x: 0.47, y: 0.4 },
  { w: 1.24, h: 0.12, rot: -0.27, tint: 0xa9c4ff, a: 0.09, x: 0.44, y: 0.37 }
];

let state = null;
let starting = false;

export function isShowing() {
  return !!state;
}

// ===== 布局：星盘（扁平）与星球（3D）=====
function buildModel(W, H) {
  const outline = getOutline();
  const nodes = [];
  const lines = [];
  const RX = W * 0.42;
  const RY = H * 0.36;
  const S = clamp(Math.min(W, H) / 820, 0.72, 1.5);
  const R3 = Math.min(W, H) * 0.355;
  const FOCAL = R3 * 3.2;
  const model = { nodes, lines, RX, RY, R3, FOCAL, first: null, points: [], chapters: [], courses: [], meta: {} };
  const courses = outline.courses || [];
  if (!courses.length) return model;
  const K = Math.max(1, courses.length);
  const meta = courses.map((c) => {
    const chapters = chaptersOf(c.id).map((ch) => ({ ch, pts: pointsOf(ch.id) }));
    const points = chapters.reduce((sum, item) => sum + item.pts.length, 0);
    return { c, chapters, points, weight: 1 + 1.9 * chapters.length + 0.55 * points };
  });
  const totalW = meta.reduce((sum, m) => sum + m.weight, 0) || 1;

  const mk = (level, entity, x, y, r) => {
    const pal = appearanceColors(entity);
    const seed = ((hashStr(entity.id) >>> 0) % 8192) / 8192;
    const n = {
      id: entity.id,
      level,
      entity,
      x,
      y,
      r: r * (0.78 + 0.44 * seed),
      rgb: pal.defaultRgb,
      rgbM: pal.masteredRgb,
      ratio: masteryFor(entity),
      at: 0,
      dur: 1,
      landAt: 0,
      y0: y,
      landed: false,
      igniteAt: 0,
      litFired: false,
      turnAt: 0,
      tdir: [0, 1, 0],
      trb: R3,
      ax: 1,
      ay: 0,
      ra: 0,
      bx: 0,
      by: 1,
      bz: 0,
      rb: R3,
      om: 0,
      som: 1,
      swirl: 0.6,
      seed,
      ph: Math.random() * TAU,
      tw: 0.8 + Math.random() * 1.3,
      vis: false,
      lastTint: -1,
      halo: null,
      core: null,
      flare: null,
      host: null
    };
    nodes.push(n);
    return n;
  };

  // 球面基准方向：课程均匀铺在球壳上。
  const dirs = [];
  for (let k = 0; k < K; k += 1) {
    const yy = 1 - (2 * (k + 0.5)) / K;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const a = k * GOLDEN;
    dirs.push([Math.cos(a) * rr, yy, Math.sin(a) * rr]);
  }

  meta.forEach((m, k) => {
    const frac = Math.sqrt((k + 0.55) / K) * 0.86;
    const ang = k * GOLDEN + 0.7;
    const cx = Math.cos(ang) * frac * RX;
    const cy = Math.sin(ang) * frac * RY;
    const clusterR = Math.sqrt((0.85 * RX * RY * m.weight) / totalW);
    const cr = (4 + Math.min(m.chapters.length, 10) * 0.28 + Math.min(m.points, 60) * 0.02) * S;
    const cn = mk(1, m.c, cx, cy, cr);
    cn.tdir = dirs[k];
    cn.trb = R3 * (0.95 + 0.07 * cn.seed);
    model.courses.push(cn);

    m.chapters.forEach(({ ch, pts }, i) => {
      const C = Math.max(1, m.chapters.length);
      const rr = clusterR * 0.92 * Math.sqrt((i + 0.5) / C);
      const a = i * GOLDEN + k * 1.7 + 1.1;
      const chx = cx + Math.cos(a) * rr;
      const chy = cy + Math.sin(a) * rr;
      const chr = (2.3 + Math.min(pts.length, 12) * 0.045) * S;
      const chn = mk(2, ch, chx, chy, chr);
      chn.host = cn;
      chn.tdir = offsetDir(dirs[k], 0.3 + 0.2 * chn.seed, i * GOLDEN + k * 1.31);
      chn.trb = R3 * (0.92 + 0.12 * chn.seed);
      model.chapters.push(chn);
      lines.push({ a: cn, b: chn, ph: Math.random() * TAU });

      const P = Math.max(1, pts.length);
      const cloud = clusterR * clamp(0.1 + 0.055 * Math.sqrt(P), 0.1, 0.34);
      pts.forEach((pt, j) => {
        const pr = cloud * Math.sqrt((j + 0.5) / P);
        const pa = j * GOLDEN + phaseOf(pt.id);
        const pn = mk(3, pt, chx + Math.cos(pa) * pr, chy + Math.sin(pa) * pr, 1.3 * S);
        pn.host = chn;
        pn.tdir = offsetDir(chn.tdir, 0.12 + 0.2 * pn.seed, j * GOLDEN + chn.seed * TAU);
        pn.trb = R3 * (0.8 + 0.24 * pn.seed);
        model.points.push(pn);
      });
    });
  });

  // 扁平 → 球：存起点方向、目标方向、夹角。
  for (const n of nodes) {
    const ra = Math.hypot(n.x, n.y);
    n.ra = ra;
    if (ra > 0.5) {
      n.ax = n.x / ra;
      n.ay = n.y / ra;
    } else {
      const a = n.seed * TAU;
      n.ax = Math.cos(a);
      n.ay = Math.sin(a);
    }
    n.bx = n.tdir[0];
    n.by = n.tdir[1];
    n.bz = n.tdir[2];
    n.rb = n.trb;
    n.om = Math.acos(clamp(n.ax * n.bx + n.ay * n.by, -1, 1));
    n.som = Math.sin(n.om);
    n.swirl = 0.55 + 0.5 * n.seed;
  }
  model.meta = { K, S, courses: courses.length };
  return model;
}

function offsetDir(d, ang, ph) {
  const up = Math.abs(d[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const t1 = normalize3(cross3(up, d));
  const t2 = normalize3(cross3(d, t1));
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const cp = Math.cos(ph);
  const sp = Math.sin(ph);
  return normalize3([
    d[0] * ca + (t1[0] * cp + t2[0] * sp) * sa,
    d[1] * ca + (t1[1] * cp + t2[1] * sp) * sa,
    d[2] * ca + (t1[2] * cp + t2[2] * sp) * sa
  ]);
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ===== 落星时刻表 =====
function prepareDrops(model, W, H) {
  const { nodes, points, chapters, courses } = model;
  if (!nodes.length) return;
  const first =
    points.reduce((best, n) => (!best || Math.hypot(n.x, n.y) < Math.hypot(best.x, best.y) ? n : best), null) || nodes[0];
  model.first = first;
  first.at = PH.firstSpawn;
  first.dur = PH.firstFall;

  const rest = points
    .filter((n) => n !== first)
    .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const N = Math.max(1, rest.length);
  rest.forEach((n, i) => {
    const u = rainCurve((i + 0.5) / N);
    const jitter = (Math.random() - 0.5) * 0.2;
    n.at = clamp(PH.rainStart + u * PH.rainSpan + jitter, PH.rainStart, rainEnd - 0.25);
  });

  const chapSorted = chapters.slice().sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const C = Math.max(1, chapSorted.length);
  chapSorted.forEach((n, i) => {
    n.at = chapStart + ((i + 0.5) / C) * PH.chapSpan;
  });

  for (const n of courses) n.at = courseSpawn;

  const viewH = H;
  for (const n of nodes) {
    const cam = cameraAt(n.at, model);
    const top = cam.ty - (viewH / (2 * Math.max(0.3, cam.zoom))) - 60;
    if (n === first) {
      // 首颗星：从落点正上方较远处坠落，长拖尾。
      n.y0 = n.y - H * 0.62;
    } else {
      n.y0 = Math.min(top, n.y - 90);
    }
    if (n.level === 1) n.dur = PH.courseFall;
    else if (n === first) n.dur = PH.firstFall;
    else n.dur = clamp((n.y - n.y0) / (470 + Math.random() * 280), 0.72, 1.5);
    n.landAt = n.at + n.dur;
  }

  // 点亮顺序：随机，但要可复现。
  const rng = mulberry32(0x5eed2026);
  const order = nodes.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  order.forEach((n, i) => {
    n.igniteAt = igniteStart + ((i + 0.5) / order.length) * PH.igniteSpan + (rng() - 0.5) * 0.16;
  });

  // 掌握变色：按左下→右上的斜向扫过。
  const mastered = nodes.filter((n) => n.ratio > 0.004);
  mastered.sort((a, b) => sweepOf(a, model) - sweepOf(b, model));
  mastered.forEach((n, i) => {
    const k = mastered.length > 1 ? i / (mastered.length - 1) : 0;
    n.turnAt = turnStart + k * (PH.turnSpan - 1.2) + (Math.random() - 0.5) * 0.25;
  });
}

function sweepOf(n, model) {
  return (n.x / model.RX) * 0.55 + (n.y / model.RY) * 0.75 + (n.seed - 0.5) * 0.2;
}

// ===== 镜头 =====
function cameraAt(t, model) {
  const first = model.first;
  let zoom = 1;
  let tx = 0;
  let ty = 0;
  if (first && t < PH.pull) {
    // 镜头锁住首颗星，用延迟量制造「下落」的位移感。
    const u = clamp01((t - PH.firstSpawn) / PH.firstFall);
    const p = Math.pow(u, 1.9);
    const starY = first.y0 + (first.y - first.y0) * p;
    zoom = mix(2.55, 2.4, easeInOutCubic(u));
    tx = first.x;
    ty = starY + 190 * (1 - u);
  } else if (first && t < PH.pull + PH.pullDur) {
    const k = easeInOutCubic((t - PH.pull) / PH.pullDur);
    zoom = mix(2.4, 1, k);
    tx = mix(first.x, 0, k);
    ty = mix(first.y, 0, k);
  } else if (t >= gatherEnd) {
    const hu = easeInOutCubic((t - gatherEnd) / PH.hold);
    zoom = mix(1, 1.07, hu);
  }
  return { zoom, tx, ty };
}

function spinAt(t) {
  const k = clamp01((t - gatherStart) / PH.gather);
  return easeInOutCubic(k) * 0.8 + Math.max(0, t - gatherStart) * 0.055;
}

function tiltAt(t) {
  const k = clamp01((t - gatherStart) / (PH.gather * 0.9));
  const base = -0.32 * easeInOutCubic(k);
  const era = Math.max(0, t - gatherEnd);
  return base + Math.sin(era * 0.42) * 0.028 * smoothstep(clamp01(era / 2.2));
}

const HB_OFFSETS = [0, 0.9, 1.06, 2.2, 2.36];
function heartbeatAt(t) {
  const base = t - boomAt;
  let v = 0;
  for (const o of HB_OFFSETS) {
    const d = base - o;
    if (d >= 0 && d < 1.3) v += Math.exp(-d * 7);
  }
  return Math.min(1, v);
}

function holdPulse(t) {
  if (t < gatherEnd) return 0;
  return 0.5 + 0.5 * Math.sin(((t - gatherEnd) / 4.8) * TAU);
}

// ===== 搭建图层 =====
function buildLayers(stage, W, H) {
  const board = new Container();
  const baseGlow = new Sprite(TEX.glow);
  baseGlow.anchor.set(0.5);
  baseGlow.blendMode = 'add';
  baseGlow.tint = 0x2f57a8;
  baseGlow.alpha = 0.1;

  const ballGlow = new Sprite(TEX.glow);
  ballGlow.anchor.set(0.5);
  ballGlow.blendMode = 'add';
  ballGlow.tint = 0x9dc0ff;
  ballGlow.alpha = 0;

  const ripple = new Container();
  ripple.scale.set(1, 0.74);
  const ripGlow = new Sprite(TEX.glow);
  ripGlow.anchor.set(0.5);
  ripGlow.blendMode = 'add';
  ripGlow.tint = 0xcfe4ff;
  ripGlow.visible = false;
  const ripRing = new Sprite(TEX.water);
  ripRing.anchor.set(0.5);
  ripRing.blendMode = 'add';
  ripRing.tint = 0xd8e9ff;
  ripRing.visible = false;
  const ripGfx = new Graphics();
  ripple.addChild(ripGlow, ripRing, ripGfx);

  const limb = new Sprite(TEX.ring);
  limb.anchor.set(0.5);
  limb.blendMode = 'add';
  limb.tint = 0x8fb6ff;
  limb.visible = false;

  const lineGfx = new Graphics();
  const trail = new Graphics();
  const comet = new Sprite(TEX.streak);
  comet.anchor.set(0.5, 1);
  comet.blendMode = 'add';
  comet.visible = false;
  const halo = new Container();
  const core = new Container();
  const flare = new Container();
  board.addChild(baseGlow, ballGlow, limb, ripple, lineGfx, trail, comet, halo, core, flare);
  stage.addChild(board);

  const flash = new Container();
  const flashGfx = new Graphics().rect(-W, -H, W * 3, H * 3).fill({ color: 0xffffff, alpha: 1 });
  flashGfx.alpha = 0;
  const burst = new Sprite(TEX.glow);
  burst.anchor.set(0.5);
  burst.blendMode = 'add';
  burst.tint = 0xeaf4ff;
  burst.visible = false;
  flash.addChild(flashGfx, burst);
  stage.addChild(flash);

  const overlay = new Container();
  const vignette = new Sprite(TEX.vignette);
  vignette.anchor.set(0);
  const grain = new TilingSprite({ texture: TEX.grain, width: W, height: H });
  grain.blendMode = 'overlay';
  grain.alpha = 0.1;
  overlay.addChild(vignette, grain);
  stage.addChild(overlay);

  return { board, baseGlow, ballGlow, limb, ripple, ripGlow, ripRing, ripGfx, lineGfx, trail, comet, halo, core, flare, flash, flashGfx, burst, overlay, vignette, grain };
}

function buildSprites(model, layers) {
  for (const n of model.nodes) {
    const halo = new Sprite(TEX.glow);
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    halo.visible = false;
    const core = new Sprite(TEX.core);
    core.anchor.set(0.5);
    core.blendMode = 'add';
    core.visible = false;
    const flare = new Sprite(TEX.star);
    flare.anchor.set(0.5);
    flare.blendMode = 'add';
    flare.visible = false;
    layers.halo.addChild(halo);
    layers.core.addChild(core);
    layers.flare.addChild(flare);
    n.halo = halo;
    n.core = core;
    n.flare = flare;
  }
}

// ===== 天空 =====
function buildSky(W, H) {
  const q = quality3d();
  const density = clamp(Number(q && q.stars) || 1, 0.25, 3);
  const areaK = clamp((W * H) / (1440 * 900), 0.45, 1.6);
  const starCount = Math.min(2600, Math.round(1000 * density * areaK));
  const moteCount = Math.min(700, Math.round(230 * density * areaK));

  const root = new Container();
  const bg = new Sprite(TEX.bg);
  bg.anchor.set(0.5);
  bg.width = W * 1.3;
  bg.height = H * 1.3;
  bg.position.set(W / 2, H / 2);
  root.addChild(bg);

  const bandLayer = new Container();
  root.addChild(bandLayer);
  const bands = BANDS.map((cfg) => {
    const s = new Sprite(TEX.glow);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = cfg.tint;
    s.alpha = cfg.a;
    s.rotation = cfg.rot;
    bandLayer.addChild(s);
    return { cfg, s };
  });

  const nebulaLayer = new Container();
  root.addChild(nebulaLayer);
  const nebulas = NEBULAS.map((cfg) => {
    const s = new Sprite(TEX.glow);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = cfg.c;
    s.alpha = cfg.a;
    nebulaLayer.addChild(s);
    return { cfg, s };
  });

  const starLayer = new Container();
  root.addChild(starLayer);
  const stars = [];
  for (let i = 0; i < starCount; i += 1) {
    let u = Math.random();
    let v = Math.random();
    if (Math.random() < 0.42) {
      const c = STAR_CLUSTERS[i % STAR_CLUSTERS.length];
      u = mod(c.u + (Math.random() + Math.random() + Math.random() - 1.5) * 0.12, 1);
      v = mod(c.v + (Math.random() + Math.random() + Math.random() - 1.5) * 0.12, 1);
    }
    const sprite = new Sprite(TEX.dot);
    sprite.anchor.set(0.5);
    sprite.blendMode = 'normal';
    starLayer.addChild(sprite);
    const big = Math.random() < 0.14;
    let cross = null;
    if (big) {
      cross = new Sprite(TEX.cross);
      cross.anchor.set(0.5);
      cross.blendMode = 'add';
      starLayer.addChild(cross);
    }
    stars.push({
      u,
      v,
      z: 0.15 + Math.random() * 0.85,
      r: 0.35 + Math.pow(Math.random(), 2.2) * 1.55,
      a: 0.22 + Math.random() * 0.72,
      tw: 0.5 + Math.random() * 1.9,
      ph: Math.random() * TAU,
      warm: Math.random() < 0.12,
      crossAngle: Math.random() < 0.65 ? 0 : Math.PI / 4,
      sprite,
      cross
    });
  }

  const meteorLayer = new Container();
  root.addChild(meteorLayer);
  const meteors = [];
  for (let i = 0; i < 3; i += 1) {
    const tail = new Sprite(TEX.glow);
    tail.anchor.set(0.5);
    tail.blendMode = 'add';
    tail.tint = 0xdfeaff;
    tail.visible = false;
    const head = new Sprite(TEX.spark);
    head.anchor.set(0.5);
    head.blendMode = 'add';
    head.tint = 0xffffff;
    head.visible = false;
    meteorLayer.addChild(tail, head);
    meteors.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, len: 0, born: 0, life: 1, tail, head });
  }

  const moteLayer = new Container();
  root.addChild(moteLayer);
  const motes = [];
  for (let i = 0; i < moteCount; i += 1) {
    const sprite = new Sprite(TEX.spark);
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    moteLayer.addChild(sprite);
    motes.push({
      u: Math.random(),
      v: Math.random(),
      z: 0.2 + Math.random() * 0.8,
      r: 0.5 + Math.random() * 1.1,
      a: 0.1 + Math.random() * 0.22,
      tw: 0.4 + Math.random() * 1.4,
      ph: Math.random() * TAU,
      sp: 0.4 + Math.random() * 1.6,
      sprite
    });
  }

  // 远景星雨：越下越急的时候，背景也跟着落。
  const drizzleLayer = new Container();
  root.addChild(drizzleLayer);
  const streaks = [];
  for (let i = 0; i < 26; i += 1) {
    const sprite = new Sprite(TEX.glow);
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    sprite.tint = 0xcfe2ff;
    sprite.visible = false;
    drizzleLayer.addChild(sprite);
    streaks.push({ active: false, x: 0, y: 0, len: 0, speed: 0, born: 0, alpha: 0, sprite });
  }

  return { root, W, H, bg, bands, nebulas, stars, motes, meteors, meteorsPool: meteors, meteorsNext: 2.6, streaks, streakAcc: 0, meteorCount: 0 };
}

function layoutSky(sky, W, H) {
  sky.W = W;
  sky.H = H;
  sky.bg.width = W * 1.3;
  sky.bg.height = H * 1.3;
  sky.bg.position.set(W / 2, H / 2);
}

// ===== 场景更新 =====
function updateSky(t, dt, cam, shx, shy) {
  const s = state;
  const sky = s.sky;
  const W = s.W;
  const H = s.H;
  const beat = heartbeatAt(t);
  const parX = -cam.tx * 0.9 + shx;
  const parY = -cam.ty * 0.9 + shy;
  const nt = t * 0.02;
  // 汇聚成球时，银河/星云退到后面，让球体成为主角。
  const gu = clamp01((t - gatherStart) / PH.gather);
  const skyDim = 1 - 0.54 * smoothstep(clamp01(gu * 1.6));
  const starDim = 0.55 + 0.45 * skyDim;

  sky.bands.forEach(({ cfg, s: sp }) => {
    const w = cfg.w * W * (1 + 0.012 * Math.sin(nt * 0.6 + cfg.rot * 3));
    sp.width = w;
    sp.height = cfg.h * H * (1 + 0.02 * Math.sin(nt * 0.5 + 1.4));
    sp.position.set(cfg.x * W + Math.sin(nt * 0.35 + 1.2) * W * 0.006, cfg.y * H + Math.cos(nt * 0.3 + 2.1) * H * 0.008);
    sp.alpha = cfg.a * (0.92 + 0.08 * Math.sin(nt * 0.8 + cfg.rot)) * skyDim;
  });

  for (const { cfg, s: sp } of sky.nebulas) {
    const x = cfg.u * W + Math.sin(nt * cfg.sp + cfg.ph) * W * 0.018 + parX * 0.012;
    const y = cfg.v * H + Math.cos(nt * cfg.sp * 0.8 + cfg.ph) * H * 0.018 + parY * 0.012;
    const r = cfg.r * Math.max(W, H) * (1 + 0.035 * Math.sin(nt * 2 + cfg.ph));
    sp.position.set(x, y);
    sp.width = r * 2;
    sp.height = r * 2;
    sp.alpha = cfg.a * (0.9 + 0.1 * Math.sin(nt * 1.3 + cfg.ph)) * (1 + beat * 0.35) * skyDim;
  }

  const rt = t - boomAt;
  const waveOn = rt > 0 && rt < RIP_LIFE;
  const front = waveOn ? s.model.RX * 1.5 * (1 - Math.pow(1 - clamp01(rt / 2.2), 2.0)) : -1;
  const waveAt = (x, y) => {
    if (!waveOn) return 0;
    const d = Math.hypot(x - W * 0.5, y - H * 0.5) - front;
    return Math.exp(-(d * d) / (2 * 120 * 120)) * Math.exp(-rt * 0.7);
  };

  const bright = 1 + beat * 0.12;
  for (const st of sky.stars) {
    const par = 0.05 + st.z * 0.12;
    const sx = mod(st.u * W - parX * par, W);
    const sy = mod(st.v * H - parY * par, H);
    const wave = waveAt(sx, sy);
    const twinkle = 0.72 + 0.28 * Math.sin(t * st.tw + st.ph);
    const alpha = Math.min(1, st.a * twinkle * bright * (1 + wave * 1.6) * starDim);
    const size = Math.max(0.7, st.r * 4.2 * (1 + wave * 0.9 + beat * 0.05));
    const tint = st.warm ? 0xfff2dc : 0xe8f2ff;
    st.sprite.position.set(sx, sy);
    st.sprite.width = size;
    st.sprite.height = size;
    st.sprite.alpha = alpha;
    st.sprite.tint = tint;
    if (st.cross) {
      const bigSize = Math.max(7, st.r * 13 * (1 + wave * 0.7));
      st.cross.position.set(sx, sy);
      st.cross.width = bigSize;
      st.cross.height = bigSize;
      st.cross.rotation = st.crossAngle;
      st.cross.alpha = Math.min(1, alpha * 0.92 * (1 + wave * 1.2));
      st.cross.tint = tint;
    }
  }

  for (const m of sky.motes) {
    const drift = t * 0.012 * m.sp;
    const sx = mod(m.u * W + drift * W * 0.06 - parX * 0.05, W);
    const sy = mod(m.v * H - drift * H * 0.09 - parY * 0.05, H);
    const wave = waveAt(sx, sy);
    m.sprite.position.set(sx, sy);
    const size = Math.max(1.1, m.r * 2.0 * (1 + wave * 0.5));
    m.sprite.width = size;
    m.sprite.height = size;
    m.sprite.alpha = Math.min(1, m.a * (0.55 + 0.45 * Math.sin(t * m.tw + m.ph)) * (1 + wave * 0.8));
    m.sprite.tint = 0xcde4ff;
  }

  // 流星
  if (t > sky.meteorsNext) {
    spawnMeteor(sky, t);
    sky.meteorsNext = t + randRange(2.2, 6.4);
  }
  for (const m of sky.meteors) {
    if (!m.active) continue;
    const age = t - m.born;
    if (age > m.life) {
      m.active = false;
      m.tail.visible = false;
      m.head.visible = false;
      continue;
    }
    const x = m.x + m.vx * age;
    const y = m.y + m.vy * age;
    const fade = Math.min(1, age / 0.07) * Math.max(0, 1 - age / m.life);
    const ang = Math.atan2(m.vy, m.vx);
    m.tail.position.set(x - Math.cos(ang) * m.len * 0.42, y - Math.sin(ang) * m.len * 0.42);
    m.tail.width = m.len;
    m.tail.height = 2.2;
    m.tail.rotation = ang;
    m.tail.alpha = 0.5 * fade;
    m.head.position.set(x, y);
    m.head.width = 3.6;
    m.head.height = 3.6;
    m.head.alpha = 0.85 * fade;
  }

  // 远景星雨
  const amt = rainIntensity(t);
  if (amt > 0.02 && dt > 0) {
    sky.streakAcc += amt * dt * 10;
    while (sky.streakAcc >= 1) {
      sky.streakAcc -= 1;
      spawnStreak(sky, t);
    }
  }
  for (const st of sky.streaks) {
    if (!st.active) continue;
    const age = t - st.born;
    const y = st.y + st.speed * age;
    const x = st.x;
    if (y - st.len > H) {
      st.active = false;
      st.sprite.visible = false;
      continue;
    }
    st.sprite.position.set(x, y);
    st.sprite.width = 1.5;
    st.sprite.height = st.len;
    st.sprite.alpha = st.alpha * Math.min(1, age / 0.35) * Math.min(1, (H + st.len - y) / 240 + 0.15);
  }
}

function spawnMeteor(sky, t) {
  const slot = sky.meteors.find((m) => !m.active);
  if (!slot) return;
  const fromLeft = Math.random() < 0.62;
  const x = fromLeft ? randRange(-0.05, 0.7) * sky.W : randRange(0.45, 1.05) * sky.W;
  const y = randRange(-0.06, 0.4) * sky.H;
  const ang = fromLeft ? randRange(0.34, 0.6) : Math.PI - randRange(0.34, 0.6);
  const speed = randRange(680, 1180);
  slot.active = true;
  slot.x = x;
  slot.y = y;
  slot.vx = Math.cos(ang) * speed;
  slot.vy = Math.sin(ang) * speed;
  slot.len = randRange(90, 210);
  slot.born = t;
  slot.life = randRange(0.5, 0.85);
  slot.tail.visible = true;
  slot.head.visible = true;
}

function spawnStreak(sky, t) {
  const slot = sky.streaks.find((s) => !s.active);
  if (!slot) return;
  slot.active = true;
  slot.x = Math.random() * sky.W;
  slot.y = randRange(-160, H * 0.92);
  slot.len = randRange(50, 130);
  slot.speed = randRange(620, 1150);
  slot.born = t;
  slot.alpha = randRange(0.03, 0.07);
  slot.sprite.visible = true;
}

function updateBoard(t) {
  const s = state;
  const m = s.model;
  const layers = s.layers;
  const gU = clamp01((t - gatherStart) / PH.gather);
  const gE = easeInOutCubic(gU);
  const sphereW = smoothstep(clamp01(gU * 1.5));
  const spin = spinAt(t);
  const tilt = tiltAt(t);
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const R3 = m.R3;
  const FOCAL = m.FOCAL;
  const ripRT = t - boomAt;
  const ripOn = ripRT >= 0 && ripRT < RIP_LIFE;
  const ripFade = ripOn ? Math.max(0, 1 - Math.pow(ripRT / RIP_LIFE, 1.6)) : 0;
  const ripBand = 34 + ripRT * 18;
  const RIP_R = Math.hypot(m.RX, m.RY) * 1.02;
  const ripFront = ripOn ? RIP_R * 1.18 * (1 - Math.pow(1 - clamp01(ripRT / 2.15), 2.2)) : -1;
  const boomFlash = t >= boomAt ? Math.exp(-(t - boomAt) * 4) : 0;
  const hb = heartbeatAt(t);
  const hp = holdPulse(t);

  // 平盘底光：成型后让位给星球光。
  layers.baseGlow.width = m.RX * 2.9;
  layers.baseGlow.height = m.RY * 2.9;
  layers.baseGlow.alpha = 0.06 * (1 - smoothstep(clamp01(gU * 1.8))) * (1 + hb * 0.4 + boomFlash * 0.8);
  layers.ballGlow.width = R3 * 3.1;
  layers.ballGlow.height = R3 * 3.1;
  layers.ballGlow.alpha = 0.2 * smoothstep(clamp01((gU - 0.45) / 0.5)) * (0.85 + 0.15 * hp);
  layers.limb.visible = sphereW > 0.2;
  if (layers.limb.visible) {
    const lw = R3 * 2.08 * (1 + 0.012 * hp);
    layers.limb.width = lw;
    layers.limb.height = lw;
    layers.limb.alpha = 0.13 * sphereW * (0.8 + 0.2 * hp);
  }

  // 涟漪
  if (ripOn) {
    layers.ripGlow.visible = true;
    layers.ripGlow.width = ripFront * 2.6;
    layers.ripGlow.height = ripFront * 2.6;
    layers.ripGlow.alpha = 0.1 * ripFade;
    layers.ripRing.visible = true;
    layers.ripRing.width = ripFront * 2.21;
    layers.ripRing.height = ripFront * 2.21;
    layers.ripRing.alpha = 0.62 * ripFade;
    layers.ripGfx.clear();
    const r2 = ripFront - 96;
    if (r2 > 8) {
      layers.ripGfx.circle(0, 0, r2).stroke({ width: 1.6, color: 0xd8e9ff, alpha: 0.1 * ripFade });
    }
  } else if (layers.ripGlow.visible) {
    layers.ripGlow.visible = false;
    layers.ripRing.visible = false;
    layers.ripGfx.clear();
  }

  // 拖尾
  layers.trail.clear();
  const trailAlpha = 0.16;

  let lineAlpha = 0;
  if (t >= boomAt) {
    const inK = clamp01((t - (boomAt + 0.9)) / 2.6);
    lineAlpha = 0.1 * inK + 0.16 * Math.exp(-(t - boomAt) * 3);
    if (gU > 0) lineAlpha *= 1 - clamp01(gU / 0.32);
  }
  const drawLines = lineAlpha > 0.005;
  if (drawLines && (Math.abs(lineAlpha - s.lineAlpha) > 0.004 || gU > 0)) {
    layers.lineGfx.clear();
    for (const ln of m.lines) {
      const a = ln.a;
      const b = ln.b;
      if (t < a.landAt || t < b.landAt) continue;
      if (!a.halo || !b.halo) continue;
      const flick = 0.82 + 0.18 * Math.sin(t * 0.7 + ln.ph);
      const cr = (a.rgb[0] + 150) / 2;
      const cg = (a.rgb[1] + 190) / 2;
      const cb = (a.rgb[2] + 255) / 2;
      layers.lineGfx
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 0.9, color: rgbHex(cr, cg, cb), alpha: lineAlpha * flick });
    }
    s.lineAlpha = lineAlpha;
  } else if (!drawLines && s.lineAlpha !== 0) {
    layers.lineGfx.clear();
    s.lineAlpha = 0;
  }

  for (const n of m.nodes) {
    if (t < n.at) {
      if (n.vis) {
        n.vis = false;
        n.halo.visible = false;
        n.core.visible = false;
        n.flare.visible = false;
      }
      continue;
    }
    n.vis = true;
    const firstFallTrack = n === m.first && t < n.landAt;

    let x = n.x;
    let y = n.y;
    let sizeK = 1;
    let depthA = 1;
    let depth = 1;
    let appear = 1;
    let trailLen = 0;

    if (t < n.landAt) {
      const u = (t - n.at) / n.dur;
      const p = Math.pow(u, 1.9);
      y = n.y0 + (n.y - n.y0) * p;
      appear = smoothstep(clamp01(u / 0.12));
      const speed = ((n.y - n.y0) * 1.9 * Math.pow(Math.max(0.02, u), 0.9)) / n.dur;
      trailLen = Math.min(n.r * 26, speed * 0.055);
    }

    if (gU > 0) {
      let dx;
      let dy;
      let dz;
      if (n.som > 0.06) {
        const s1 = Math.sin((1 - gE) * n.om) / n.som;
        const s2 = Math.sin(gE * n.om) / n.som;
        dx = n.ax * s1 + n.bx * s2;
        dy = n.ay * s1 + n.by * s2;
        dz = n.bz * s2;
      } else {
        dx = n.ax * (1 - gE) + n.bx * gE;
        dy = n.ay * (1 - gE) + n.by * gE;
        dz = n.bz * gE;
      }
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      const sw = Math.sin(gE * Math.PI) * n.swirl;
      const cw = Math.cos(sw);
      const sws = Math.sin(sw);
      const rdx = dx * cw + dz * sws;
      const rdz = -dx * sws + dz * cw;
      const rr = n.ra + (n.rb - n.ra) * gE;
      const px0 = rdx * rr;
      const py0 = dy * rr;
      const pz0 = rdz * rr;
      const x1 = px0 * cs + pz0 * sn;
      const z1 = -px0 * sn + pz0 * cs;
      const y2 = py0 * ct - z1 * st;
      const z2 = py0 * st + z1 * ct;
      const persp = FOCAL / Math.max(1, FOCAL - z2);
      depth = clamp01(0.5 + z2 / (2 * R3));
      x = x1 * persp;
      y = y2 * persp;
      sizeK = persp * (0.92 + 0.16 * depth);
      depthA = 1 + (0.52 + 0.48 * depth - 1) * sphereW;
    }

    n.lit = t >= n.igniteAt ? easeOutCubic(clamp01((t - n.igniteAt) / 0.5)) : 0;
    const lg = n.lit;
    const ig = (t - n.igniteAt) / 0.5;
    const bloom = ig > 0 && ig < 1.8 ? Math.exp(-ig * 3.6) : 0;
    const landF = t >= n.landAt ? Math.exp(-(t - n.landAt) * 5) : 0;

    let ripF = 0;
    if (ripOn) {
      const dd = Math.hypot(n.x, n.y) - ripFront;
      ripF = Math.exp(-(dd * dd) / (2 * ripBand * ripBand)) * ripFade;
    }

    let colorMix = 0;
    let gold = 0;
    if (n.ratio > 0.004 && t > n.turnAt) {
      const tk = clamp01((t - n.turnAt) / 1.1);
      colorMix = n.ratio * easeInOutCubic(tk);
      gold = Math.sin(Math.PI * tk);
    }

    const big = n.level === 1 ? 1.55 : n.level === 2 ? 1.12 : 1;
    const tw = 0.74 + 0.26 * Math.sin(t * n.tw * 1.35 + n.ph);
    const baseCore = mix(0.5, 0.95, lg);
    const baseHalo = mix(0.058, 0.2, lg);
    const baseFlare = mix(0.115, 0.42, lg);
    const packK = 1 - 0.35 * sphereW;
    let coreA = (baseCore + landF * 0.32 + bloom * 0.7 + ripF * 1.2 + gold * 0.2) * big * appear * depthA * packK;
    let haloA = (baseHalo + landF * 0.16 + bloom * 0.34 + ripF * 0.5 + gold * 0.32) * big * appear * depthA * packK;
    let flareA = (baseFlare + landF * 0.1 + bloom * 0.55 + ripF * 1.0 + gold * 0.16) * big * appear * depthA * packK;
    coreA *= 0.9 + 0.1 * tw;
    flareA *= 0.6 + 0.4 * tw;
    if (t < n.landAt) {
      coreA *= 1.32;
      haloA *= 1.5;
    }
    if (firstFallTrack) {
      coreA += 0.38;
      haloA += 0.34;
    }

    const whiteK = clamp01(ripF * 0.85 + bloom * 0.5 + landF * 0.12);
    let cr = mix(n.rgb[0] + (n.rgbM[0] - n.rgb[0]) * colorMix, 255, whiteK);
    let cg = mix(n.rgb[1] + (n.rgbM[1] - n.rgb[1]) * colorMix, 255, whiteK);
    let cb = mix(n.rgb[2] + (n.rgbM[2] - n.rgb[2]) * colorMix, 255, whiteK);
    if (sphereW > 0.02) {
      const back = (1 - depth) * sphereW * 0.5;
      cr = mix(cr, 96, back);
      cg = mix(cg, 132, back);
      cb = mix(cb, 210, back);
    }
    const tint = rgbHex(cr, cg, cb);

    const rad = n.r * sizeK;
    const haloW = rad * (12 - 4 * sphereW) * K_GLOW;
    const coreW = rad * 5.5 * K_CORE;
    const flareW = rad * (9 - 2.5 * sphereW) * K_STAR;

    n.halo.visible = haloA > 0.012;
    n.core.visible = coreA > 0.02;
    n.flare.visible = flareA > 0.012;
    n.halo.position.set(x, y);
    n.core.position.set(x, y);
    n.flare.position.set(x, y);
    n.halo.scale.set(haloW);
    n.core.scale.set(coreW);
    n.flare.scale.set(flareW);
    n.halo.alpha = Math.min(0.62, haloA);
    n.core.alpha = Math.min(1, coreA);
    n.flare.alpha = Math.min(0.86, flareA);
    if (tint !== n.lastTint) {
      n.halo.tint = tint;
      n.core.tint = tint;
      n.flare.tint = tint;
      n.lastTint = tint;
    }

    if (trailLen > 2) {
      layers.trail
        .moveTo(x, y - trailLen)
        .lineTo(x, y)
        .stroke({ width: Math.max(0.8, rad * 0.8), color: tint, alpha: trailAlpha * appear });
    }
    if (firstFallTrack) {
      const u = clamp01((t - n.at) / n.dur);
      layers.comet.visible = true;
      layers.comet.position.set(x, y + rad * 1.2);
      layers.comet.width = Math.max(9, rad * 6.5);
      layers.comet.height = 60 + 90 * u;
      layers.comet.alpha = 0.5 * appear;
      layers.comet.tint = tint;
    } else if (layers.comet.visible) {
      layers.comet.visible = false;
    }

    if (!n.landed && t >= n.landAt) {
      n.landed = true;
      pingLanding(t, n);
    }
    if (!n.litFired && t >= n.igniteAt) {
      n.litFired = true;
      pingIgnite(t, n);
    }
  }
}

function pingLanding(t, n) {
  const s = state;
  if (!s || s.noAudio) return;
  if (t - s.lastTick < 0.075) return;
  s.lastTick = t;
  const pitch = n.level === 1 ? 1.4 : n.level === 2 ? 0.8 : Math.random() * 0.6;
  sound.tick(0, 0.5 + Math.random() * 0.4, pitch);
}

function pingIgnite(t, n) {
  const s = state;
  if (!s || s.noAudio) return;
  if (t - s.lastSpark < 0.06) return;
  s.lastSpark = t;
  sound.sparkle(0, 0.35 + Math.random() * 0.35, Math.random());
}

function updateFlash(t) {
  const s = state;
  const tau = t - boomAt;
  const layers = s.layers;
  if (tau < 0 || tau > 2.6) {
    if (layers.flashGfx.alpha !== 0) layers.flashGfx.alpha = 0;
    if (layers.burst.visible) layers.burst.visible = false;
    return;
  }
  const fl = Math.exp(-tau * 4.4);
  layers.flashGfx.alpha = fl * 0.26;
  layers.burst.visible = tau < 2.2;
  if (layers.burst.visible) {
    const size = Math.min(s.W, s.H) * (0.35 + Math.min(tau, 2.2) * 1.5);
    layers.burst.width = size;
    layers.burst.height = size;
    layers.burst.position.set(s.W / 2, s.H / 2);
    layers.burst.alpha = Math.exp(-tau * 2.6) * 0.55;
  }
}

const EVENTS = [
  { at: PH.pull, run: () => sound.whoosh(0, 2.6, 0.9) },
  { at: boomAt - 3, run: () => sound.riser(0, 3.1, 1) },
  {
    at: boomAt,
    run: () => {
      sound.boom(0, 1);
      sound.heartbeat(0.9, 0.6);
      sound.heartbeat(2.2, 0.45);
    }
  },
  { at: igniteStart, run: () => sound.shimmer(0, 6, 0.35) },
  { at: turnStart, run: () => sound.shimmer(0, 8, 0.5) },
  {
    at: gatherStart,
    run: () => {
      sound.shimmer(0, 10, 0.85);
      sound.whoosh(0, 2.2, 0.5);
    }
  },
  {
    at: gatherEnd,
    run: () => {
      sound.heartbeat(0, 0.5);
      sound.heartbeat(4.2, 0.4);
    }
  }
];

function fireEvents(t) {
  const s = state;
  while (s.evIndex < EVENTS.length && EVENTS[s.evIndex].at <= t) {
    const ev = EVENTS[s.evIndex];
    s.evIndex += 1;
    if (!s.noAudio) {
      try {
        ev.run();
      } catch {
        /* 音频失败不影响画面 */
      }
    }
  }
}

// ===== 主循环 =====
function update(t, dt) {
  const s = state;
  const cam = cameraAt(t, s.model);
  const hb = heartbeatAt(t);
  const fit = Math.min(s.W / s.baseW, s.H / s.baseH);

  const tau = t - boomAt;
  let shx = 0;
  let shy = 0;
  if (tau > 0 && tau < 1.4) {
    const amp = 10 * Math.exp(-tau * 6.5);
    if (amp > 0.08) {
      shx = Math.sin(tau * 96) * amp;
      shy = Math.cos(tau * 74) * amp * 0.72;
    }
  }

  const sc = cam.zoom * fit * (1 + 0.016 * hb + 0.006 * holdPulse(t));
  s.layers.board.scale.set(sc);
  s.layers.board.position.set(s.W / 2 - cam.tx * sc + shx, s.H / 2 - cam.ty * sc + shy);

  fireEvents(t);
  updateSky(t, dt, cam, shx * 0.35, shy * 0.35);
  updateBoard(t);
  updateFlash(t);

  let veilA = 0;
  if (t < PH.veilIn) veilA = 1 - smoothstep(t / PH.veilIn);
  veilA = Math.max(veilA, smoothstep((t - (endAt - PH.fadeOut)) / PH.fadeOut));
  if (s.quitting) veilA = Math.max(veilA, smoothstep((t - s.quitStart) / 0.6));
  if (Math.abs(veilA - s.veilA) > 0.002) {
    s.veilA = veilA;
    s.veil.style.opacity = veilA.toFixed(3);
  }
}

function timeAt(s) {
  return s.frozen ? s.frozenT : (performance.now() - s.t0) / 1000 + s.offset;
}

function frame(now) {
  const s = state;
  if (!s) return;
  const t = timeAt(s);
  const dt = Math.min(0.12, Math.max(0, t - s.lastT));
  s.lastT = t;
  update(t, dt);
  s.app.renderer.render(s.app.stage);
  if (t >= endAt || (s.quitting && t >= s.quitAt)) {
    finish();
    return;
  }
  s.raf = requestAnimationFrame(frame);
}

// ===== 生命周期 =====
export async function startShow() {
  if (state || starting) return;
  starting = true;
  sound.wake();
  const host = document.createElement('div');
  host.id = 'showRoot';
  const canvas = document.createElement('canvas');
  canvas.id = 'showCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  const veil = document.createElement('div');
  veil.id = 'showVeil';
  veil.style.opacity = '1';
  host.appendChild(canvas);
  host.appendChild(veil);
  document.body.appendChild(host);
  document.body.classList.add('show-mode');

  const W = Math.max(320, window.innerWidth);
  const H = Math.max(320, window.innerHeight);
  const app = new Application();
  try {
    await app.init({
      canvas,
      width: W,
      height: H,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: 'webgl',
      powerPreference: 'high-performance'
    });
  } catch (err) {
    host.remove();
    document.body.classList.remove('show-mode');
    starting = false;
    throw err;
  }
  app.ticker.stop();
  pauseLoop();

  const model = buildModel(W, H);
  prepareDrops(model, W, H);
  const sky = buildSky(W, H);
  app.stage.addChild(sky.root);
  const layers = buildLayers(app.stage, W, H);
  buildSprites(model, layers);
  layoutSky(sky, W, H);
  // 遮罩 / 暗角 / 颗粒
  layers.vignette.width = W;
  layers.vignette.height = H;
  layers.grain.width = W;
  layers.grain.height = H;

  const s = {
    app,
    host,
    veil,
    model,
    sky,
    layers,
    W,
    H,
    baseW: W,
    baseH: H,
    t0: performance.now(),
    offset: 0,
    raf: 0,
    lastT: 0,
    evIndex: 0,
    lastTick: -9,
    lastSpark: -9,
    lineAlpha: 0,
    quitting: false,
    quitStart: 0,
    quitAt: 0,
    veilA: 1,
    noAudio: false
  };
  state = s;
  starting = false;
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  if (location.search.includes('debug')) {
    window.__show = {
      seek(sec) {
        const target = clamp(Number(sec) || 0, 0, endAt + 1);
        s.noAudio = true;
        s.frozen = true;
        s.frozenT = target;
        s.offset = target - (performance.now() - s.t0) / 1000;
        s.lastT = target;
        s.evIndex = EVENTS.findIndex((ev) => ev.at > target);
        if (s.evIndex < 0) s.evIndex = EVENTS.length;
        for (const n of s.model.nodes) {
          n.landed = n.landAt <= target;
          n.litFired = n.igniteAt <= target;
        }
      },
      end: () => quit(),
      state: s,
      timeline: { boomAt, igniteStart, turnStart, gatherStart, gatherEnd, endAt }
    };
  }
  s.raf = requestAnimationFrame(frame);
}

function quit() {
  const s = state;
  if (!s || s.quitting) return;
  const now = timeAt(s);
  // 调试里 seek() 会冻结时间，退出时要把时钟接回去，否则淡出永远不会结束。
  s.frozen = false;
  s.offset = now - (performance.now() - s.t0) / 1000;
  s.lastT = now;
  s.quitting = true;
  s.quitStart = now;
  s.quitAt = now + 0.66;
}

function onKey(e) {
  if (!state) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    quit();
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    e.stopPropagation();
    sound.setMuted(!sound.audioMuted());
  } else {
    e.stopPropagation();
  }
}

function onResize() {
  const s = state;
  if (!s) return;
  s.W = Math.max(320, window.innerWidth);
  s.H = Math.max(320, window.innerHeight);
  s.app.renderer.resize(s.W, s.H);
  layoutSky(s.sky, s.W, s.H);
  s.layers.vignette.width = s.W;
  s.layers.vignette.height = s.H;
  s.layers.grain.width = s.W;
  s.layers.grain.height = s.H;
}

function finish() {
  const s = state;
  if (!s) return;
  state = null;
  if (s.raf) cancelAnimationFrame(s.raf);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  try {
    s.app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true, texture: false, textureSource: false });
  } catch {
    /* 已经销毁 */
  }
  s.host.remove();
  document.body.classList.remove('show-mode');
  if (window.__show) delete window.__show;
  resumeLoop();
  sound.sleep();
}

/** Esc 之外的入口：动作栏按钮只负责开始，结束一律走内部状态。 */
export function closeShow() {
  quit();
}