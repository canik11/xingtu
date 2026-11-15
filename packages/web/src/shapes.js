// 星海形状：外层 3D 里课程节点的空间排布。只改“点分布”，不改层级与交互。
// 形状选择属于本机视觉偏好，存 localStorage，不写进知识数据。
//
// 每个形状同时提供两套几何：
//   shapePoint(shape, i, n) —— 骨架星尘的采样点，负责让轮廓一眼可辨；
//   shapePath(shape, t)     —— 一条连续骨架路径，节点按 t 铺在上面生长。
// 这样节点多的时候会沿骨架排开，而不是在中心糊成一团圆饼。
import { TAU } from '@starmap/core';
import { ui } from './state.js';

const STORE_KEY = 'starmap.shape.v1';

export const SHAPES = [
  { id: 'sphere', name: '球形', hint: '均匀铺满球面' },
  { id: 'galaxy', name: '旋涡星云', hint: '倾斜的星盘上，两条旋臂从明亮的核心荡开' },
  { id: 'helix', name: 'DNA 双螺旋', hint: '两条主链盘旋上升，碱基对横档相连' },
  { id: 'torus', name: '星环', hint: '起伏的环面上，节点沿管壁缠绕' },
  { id: 'lattice', name: '晶格', hint: '立方线框，节点沿棱生长' },
  { id: 'tree', name: '知识树', hint: '递归分叉的立体生命树' },
  { id: 'wave', name: '星波', hint: '四层错落的星环荡开涟漪' },
  { id: 'binary', name: '双星系统', hint: '两颗恒星拉起物质桥，节点沿三维 8 字轨道环绕' }
];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const LATTICE_EDGES = [
  [0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]
];

function fibonacci(i, count, phase = 0) {
  if (count <= 1) return { x: 0, y: 0, z: 1 };
  const y = 1 - (i / (count - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * i + phase;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

/** 稳定的“随机”抖动，不依赖数组下标之外的状态。 */
function jitter(i, salt) {
  let h = (i + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967296;
}

/** 绕 X 轴倾斜：让盘状/环状结构在初始镜头下也有纵深，而不是正对镜头。 */
function tiltX(p, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

function unitize(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** 二次贝塞尔取点：枝干弯曲靠它，直来直去会像扫帚。 */
function quadAt(a, c, b, t) {
  const it = 1 - t;
  const w0 = it * it;
  const w1 = 2 * it * t;
  const w2 = t * t;
  return {
    x: a.x * w0 + c.x * w1 + b.x * w2,
    y: a.y * w0 + c.y * w1 + b.y * w2,
    z: a.z * w0 + c.z * w1 + b.z * w2
  };
}

/** 绕 Y 轴旋转，给多层圆环错开方位。 */
function spinY(p, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

// ——— 旋涡星云 ———
// 一个倾斜的星系盘：盘面先绕 X 轴倾斜、再绕 Y 轴偏转，
// 中心隆起成球状核球。投影里是带前后进深的椭圆盘，而不是贴屏的旋臂。
const DISK_TILT = 1.02;
const DISK_YAW = 0.42;
const DISK_SPIN = 1.45;
const DISK_R = 0.92;

/** 盘面上的极坐标点：u 从 0（核心）到 1（外缘），arm 错开半圈成双臂。 */
function diskAt(u, arm) {
  const r = 0.12 + u * DISK_R;
  const phi = u * TAU * DISK_SPIN + arm * Math.PI;
  return spinY(
    tiltX({ x: Math.cos(phi) * r, y: -0.02, z: Math.sin(phi) * r }, DISK_TILT),
    DISK_YAW
  );
}

/** 核心：一个略微压扁的小球，从任何角度看都有体积。 */
function bulgeAt(i, count) {
  const p = fibonacci(i, Math.max(1, count), 0.7);
  const rad = 0.17;
  return tiltX({ x: p.x * rad, y: p.y * rad - 0.03, z: p.z * rad }, DISK_TILT * 0.55);
}

// ——— 星环 ———
// 真正的环面：主环半径上叠一圈起伏，节点沿管壁螺旋缠绕。
const RING_R = 0.64;
const RING_TUBE = 0.27;
const RING_TILT = 0.95;

function ringAt(u, v) {
  const wave = Math.sin(u * 2) * 0.18;
  const cr = RING_R + RING_TUBE * Math.cos(v);
  return tiltX(
    {
      x: cr * Math.cos(u),
      y: wave + RING_TUBE * Math.sin(v) * 0.92,
      z: cr * Math.sin(u)
    },
    RING_TILT
  );
}

// ——— 知识树 ———
// 主干竖直，树冠收成一个球：27 个枝端均匀长在球面上，
// 枝干分三层从主干向球面辐射。任何角度看都是一棵枝冠丰满的树，
// 而不是向上摊平的一把扇子。世界 y 轴向下，“向上”取负号。
const TREE_CROWN = { x: 0, y: -0.28, z: 0 };
const TREE_LAYERS = [
  { rad: 0.1, count: 3, phase: 0.4 },
  { rad: 0.4, count: 9, phase: 1.2 },
  { rad: 0.62, count: 27, phase: 2.0 }
];

let treeCache = null;

/** 第 i 个枝端：黄金角球面点，按层取不同半径与相位。 */
function crownPoint(i, layer) {
  const p = fibonacci(i, layer.count, layer.phase);
  const rad = layer.rad * (0.94 + jitter(i * 13 + layer.count, 29) * 0.12);
  return { x: TREE_CROWN.x + p.x * rad, y: TREE_CROWN.y + p.y * rad, z: TREE_CROWN.z + p.z * rad };
}

/** 按层（BFS）顺序返回主干与全部枝段，节点先铺主干、再铺满整圈树冠。 */
function treeBranches() {
  if (treeCache) return treeCache;
  const root = { x: 0, y: 0.9, z: 0 };
  const fork = { x: 0.02, y: 0.36, z: 0.02 };
  const trunk = { a: root, b: fork, c: { x: 0.05, y: 0.66, z: 0.03 }, level: 0, len: 0.54 };
  const layers = [[], [], []];

  const build = (base, depth, group) => {
    const layer = TREE_LAYERS[depth];
    for (let k = 0; k < 3; k++) {
      const idx = group * 3 + k;
      const tip = crownPoint(idx, layer);
      const len = Math.hypot(tip.x - base.x, tip.y - base.y, tip.z - base.z);
      // 控制点从树冠中心向外拱，枝条像从主干里长出来，而不是直连。
      const dx = tip.x - TREE_CROWN.x;
      const dy = tip.y - TREE_CROWN.y;
      const dz = tip.z - TREE_CROWN.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const bend = len * 0.2;
      const center = {
        x: (base.x + tip.x) / 2 + (dx / dl) * bend,
        y: (base.y + tip.y) / 2 + (dy / dl) * bend,
        z: (base.z + tip.z) / 2 + (dz / dl) * bend
      };
      layers[depth].push({ a: base, b: tip, c: center, level: depth + 1, len });
      if (depth < 2) build(tip, depth + 1, idx);
    }
  };
  build(fork, 0, 0);
  treeCache = [trunk, ...layers[0], ...layers[1], ...layers[2]];
  return treeCache;
}

/** 沿所有枝段按弧长取点，星尘才勾得出整棵树的轮廓。 */
function treeAlong(f) {
  const list = treeBranches();
  let total = 0;
  for (const br of list) total += br.len;
  let want = Math.min(1, Math.max(0, f)) * total;
  for (const br of list) {
    if (want <= br.len) return quadAt(br.a, br.c, br.b, want / br.len);
    want -= br.len;
  }
  const last = list[list.length - 1];
  return last.b;
}

// ——— 星波 ———
// 四层星环朝不同方向交织：近水平、近竖直、斜交、反竖直，
// 从任何角度看都有环穿过视线，不会退化成叠在一起的扁椭圆。
const RIPPLE_RINGS = [
  { r: 0.42, y: -0.26, pitch: 0.3, yaw: 0.0, alpha: 0.62 },
  { r: 0.66, y: -0.08, pitch: 1.28, yaw: 0.55, alpha: 0.55 },
  { r: 0.9, y: 0.12, pitch: 0.62, yaw: 1.9, alpha: 0.48 },
  { r: 1.14, y: 0.3, pitch: -1.16, yaw: 0.2, alpha: 0.42 }
];

function rippleAt(k, a) {
  const ring = RIPPLE_RINGS[k];
  const p = tiltX({ x: Math.cos(a) * ring.r, y: 0, z: Math.sin(a) * ring.r }, ring.pitch);
  const q = spinY(p, ring.yaw);
  return { x: q.x, y: q.y + ring.y + Math.sin(a * 3 + k) * 0.05, z: q.z };
}

// ——— 双星系统 ———
const BINARY_YAW = 0.42;
const BINARY_TILT = 0.5;

/** 三维 8 字轨道：x/y 决定 ∞ 形，z 的 cos 让两片叶瓣一前一后。 */
function binaryAt(t) {
  const x0 = 1.0 * Math.sin(t);
  const y0 = 0.76 * Math.sin(2 * t);
  const z0 = 0.5 * Math.cos(t);
  const c = Math.cos(BINARY_YAW);
  const sn = Math.sin(BINARY_YAW);
  return tiltX({ x: x0 * c - z0 * sn, y: y0, z: x0 * sn + z0 * c }, BINARY_TILT);
}

/**
 * 形状上第 i 个点的单位坐标（大致落在 [-1,1] 的立方体内）。
 * 所有形状都带 z 深度或立体骨架，不再是贴在屏幕上的平面图案。
 * @param {string} shape
 * @param {number} i
 * @param {number} count
 */
export function shapePoint(shape, i, count) {
  const n = Math.max(1, count);
  switch (shape) {
    case 'galaxy': {
      // 旋涡星云：大部分星尘沿两条螺旋臂铺开，其余聚成中心核球。
      const armCount = Math.max(4, Math.round(n * 0.75));
      if (i < armCount) {
        const per = Math.max(1, Math.ceil(armCount / 2));
        const u = (Math.floor(i / 2) + 0.5) / per;
        const p = diskAt(Math.min(1, u), i % 2);
        const spread = 0.015 + u * 0.04;
        return {
          x: p.x + (jitter(i, 7) - 0.5) * spread,
          y: p.y + (jitter(i, 9) - 0.5) * spread,
          z: p.z + (jitter(i, 11) - 0.5) * spread
        };
      }
      return bulgeAt(i - armCount, n - armCount);
    }
    case 'helix': {
      // DNA：两条主链（占 2/3 点）+ 碱基对横档（占 1/3 点）。
      const chainCount = Math.max(4, Math.round(n * 0.66));
      const rungCount = Math.max(2, n - chainCount);
      if (i < chainCount) {
        const chain = i % 2;
        const k = Math.floor(i / 2);
        const per = Math.max(1, Math.ceil(chainCount / 2));
        const t = per <= 1 ? 0.5 : (k + 0.5) / per;
        const theta = t * TAU * 2.2 + chain * Math.PI;
        return { x: Math.cos(theta) * 0.5, y: (t - 0.5) * 1.72, z: Math.sin(theta) * 0.5 };
      }
      // 横档：在同一高度上连接两条链，像 DNA 的碱基对阶梯。
      const j = i - chainCount;
      const perRung = 3;
      const rung = Math.floor(j / perRung);
      const u = ((j % perRung) + 0.5) / perRung;
      const totalRungs = Math.max(1, Math.ceil(rungCount / perRung));
      const t = (rung + 0.5) / totalRungs;
      const theta = t * TAU * 2.2;
      const ax = Math.cos(theta) * 0.5;
      const az = Math.sin(theta) * 0.5;
      const bx = Math.cos(theta + Math.PI) * 0.5;
      const bz = Math.sin(theta + Math.PI) * 0.5;
      return {
        x: ax + (bx - ax) * u,
        y: (t - 0.5) * 1.72,
        z: az + (bz - az) * u
      };
    }
    case 'torus': {
      // 星环：星尘铺满整个环面，绕主环与绕管壁各取一个黄金角相位。
      const u = ((i + 0.5) / n) * TAU;
      const v = (i * GOLDEN + 0.7) % TAU;
      return ringAt(u, v);
    }
    case 'lattice': {
      // 正方体线框：12 条棱上均匀采点，形成清晰的晶格骨架。
      const seg = i % LATTICE_EDGES.length;
      const step = Math.floor(i / LATTICE_EDGES.length);
      const steps = Math.max(1, Math.ceil(n / LATTICE_EDGES.length));
      const t = (step + 0.5) / steps;
      const [ax, ay, az, bx, by, bz] = LATTICE_EDGES[seg];
      return tiltX(
        {
          x: (ax + (bx - ax) * t - 0.5) * 0.9,
          y: (ay + (by - ay) * t - 0.5) * 0.9,
          z: (az + (bz - az) * t - 0.5) * 0.9
        },
        0.5
      );
    }
    case 'tree': {
      // 知识树：星尘沿主干与全部枝段按弧长铺开，整棵树的轮廓一目了然。
      const p = treeAlong((i + 0.5) / n);
      const k = 0.012;
      return {
        x: p.x + (jitter(i, 5) - 0.5) * k,
        y: p.y + (jitter(i, 7) - 0.5) * k,
        z: p.z + (jitter(i, 9) - 0.5) * k
      };
    }
    case 'wave': {
      // 星波：四层环平分星尘，每层再均匀铺一圈。
      const k = i % RIPPLE_RINGS.length;
      const per = Math.max(1, Math.ceil(n / RIPPLE_RINGS.length));
      const a = ((Math.floor(i / RIPPLE_RINGS.length) + 0.5) / per) * TAU;
      return rippleAt(k, a);
    }
    case 'binary': {
      // 双星系统：星尘沿三维 8 字轨道流动，两片叶瓣一前一后。
      return binaryAt(((i + 0.5) / n) * TAU);
    }
    case 'sphere':
    default:
      return fibonacci(i, n, 0.4);
  }
}

/**
 * 骨架路径：t ∈ [0,1] 映射到形状上的一点。
 * 节点沿这条路径生长，父子相邻、整棵树跟着形状走。
 */
export function shapePath(shape, t) {
  const u = Math.min(1, Math.max(0, t));
  switch (shape) {
    case 'galaxy': {
      // 前半程沿臂 A 从核心荡到外缘，后半程沿臂 B 荡回核心。
      const arm = u < 0.5 ? 0 : 1;
      const s = u < 0.5 ? u * 2 : (1 - u) * 2;
      return diskAt(s, arm);
    }
    case 'helix': {
      // 前半程走链 A 由下到上，后半程走链 B 由上到下，形成完整的双链环。
      const chain = u < 0.5 ? 0 : 1;
      const s = u < 0.5 ? u * 2 : (1 - u) * 2;
      const theta = s * TAU * 2.2 + chain * Math.PI;
      return { x: Math.cos(theta) * 0.5, y: (s - 0.5) * 1.72, z: Math.sin(theta) * 0.5 };
    }
    case 'torus': {
      // 节点沿主环走一圈，只在管壁上小幅起伏：环面清楚，又不会绕成毛线球。
      return ringAt(u * TAU, Math.sin(u * TAU * 2 + 0.6) * 0.55);
    }
    case 'lattice': {
      // 沿 12 条棱串行，走完整个立方线框。
      const seg = Math.min(LATTICE_EDGES.length - 1, Math.floor(u * LATTICE_EDGES.length));
      const s = u * LATTICE_EDGES.length - seg;
      const [ax, ay, az, bx, by, bz] = LATTICE_EDGES[seg];
      return tiltX(
        {
          x: (ax + (bx - ax) * s - 0.5) * 0.9,
          y: (ay + (by - ay) * s - 0.5) * 0.9,
          z: (az + (bz - az) * s - 0.5) * 0.9
        },
        0.5
      );
    }
    case 'tree': {
      // 按 DFS 顺序遍历主干与每一根枝段，节点依次落在枝条上。
      const list = treeBranches();
      const s = u * list.length;
      const k = Math.min(list.length - 1, Math.floor(s));
      const br = list[k];
      return quadAt(br.a, br.c, br.b, Math.min(1, s - k));
    }
    case 'wave': {
      // 每四分之一程绕完一层环，整条路径是一级级向外荡开的涟漪。
      const k = Math.min(RIPPLE_RINGS.length - 1, Math.floor(u * RIPPLE_RINGS.length));
      return rippleAt(k, (u * RIPPLE_RINGS.length - k) * TAU);
    }
    case 'binary':
      // 沿三维 8 字轨道走完整一圈，两片叶瓣各承载一部分节点。
      return binaryAt(u * TAU);
    case 'sphere':
    default:
      return fibonacci(Math.round(u * 63), 64, 0.4);
  }
}

/** 骨架路径在 t 处的单位切向，用于把节点云压到骨架附近。 */
export function shapeTangent(shape, t) {
  const d = 0.002;
  const a = shapePath(shape, Math.max(0, t - d));
  const b = shapePath(shape, Math.min(1, t + d));
  return unitize({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
}

/**
 * 骨架折线：返回一组单位坐标折线，WebGL 场景把它画成淡淡的星线。
 * 星尘点负责氛围，折线负责让形状轮廓一眼可辨，节点沿折线生长。
 * @param {string} shape
 * @param {number} detail 每条曲线的采样段数
 */
export function shapeSkeleton(shape, detail = 90) {
  const lines = [];
  const line = (fn, count = detail, alpha) => {
    const pts = [];
    for (let i = 0; i <= count; i++) pts.push(fn(i / count));
    lines.push(alpha == null ? pts : { pts, alpha });
  };
  switch (shape) {
    case 'galaxy': {
      // 两条螺旋臂，画亮一点，从关系线里也能看清
      for (let arm = 0; arm < 2; arm++) line((t) => diskAt(t, arm), 160, 0.9);
      // 盘外缘：星系的椭圆轮廓
      line(
        (t) =>
          spinY(
            tiltX({ x: Math.cos(t * TAU) * 1.04, y: -0.02, z: Math.sin(t * TAU) * 1.04 }, DISK_TILT),
            DISK_YAW
          ),
        80,
        0.4
      );
      // 核球：三个不同朝向的小环，中心有一团体积
      for (const ang of [0.4, 1.2, 2.0]) {
        line(
          (t) => {
            const a = t * TAU;
            const p = tiltX({ x: Math.cos(a) * 0.17, y: Math.sin(a) * 0.17, z: 0 }, ang);
            return { x: p.x, y: p.y - 0.03, z: p.z };
          },
          30,
          0.5
        );
      }
      break;
    }
    case 'helix': {
      // 两条主链
      for (let chain = 0; chain < 2; chain++) {
        line((t) => {
          const theta = t * TAU * 2.2 + chain * Math.PI;
          return { x: Math.cos(theta) * 0.5, y: (t - 0.5) * 1.72, z: Math.sin(theta) * 0.5 };
        });
      }
      // 碱基对横档
      const rungs = 6;
      for (let k = 0; k < rungs; k++) {
        const t = (k + 0.5) / rungs;
        const theta = t * TAU * 2.2;
        const y = (t - 0.5) * 1.72;
        lines.push({
          pts: [
            { x: Math.cos(theta) * 0.5, y, z: Math.sin(theta) * 0.5 },
            { x: Math.cos(theta + Math.PI) * 0.5, y, z: Math.sin(theta + Math.PI) * 0.5 }
          ],
          alpha: 0.55
        });
      }
      break;
    }
    case 'torus': {
      // 外缘与内缘两条主环，勾出甜甜圈的轮廓
      for (const v of [0, Math.PI]) line((t) => ringAt(t * TAU, v));
      // 六道经线：每道绕管壁一圈，环面的厚度与孔洞一眼可见
      for (let k = 0; k < 6; k++) {
        const u = ((k + 0.5) / 6) * TAU;
        line((t) => ringAt(u, t * TAU), 16, 0.42);
      }
      break;
    }
    case 'lattice':
      for (const [ax, ay, az, bx, by, bz] of LATTICE_EDGES) {
        lines.push([
          tiltX({ x: (ax - 0.5) * 0.9, y: (ay - 0.5) * 0.9, z: (az - 0.5) * 0.9 }, 0.5),
          tiltX({ x: (bx - 0.5) * 0.9, y: (by - 0.5) * 0.9, z: (bz - 0.5) * 0.9 }, 0.5)
        ]);
      }
      break;
    case 'tree': {
      const list = treeBranches();
      const trunk = list[0];
      // 主干画两条带锥度的并线：根粗梢细，树才站得住
      for (const sign of [-1, 1]) {
        line(
          (t) => {
            const p = quadAt(trunk.a, trunk.c, trunk.b, t);
            const off = sign * (0.048 - t * 0.032);
            return { x: p.x + off, y: p.y, z: p.z + off * 0.6 };
          },
          26
        );
      }
      // 全部枝段，逐层变细变淡；主枝画双线，枝干才显粗壮
      for (const br of list.slice(1)) {
        const alpha = br.level === 1 ? 1 : br.level === 2 ? 0.85 : 0.62;
        const count = br.level === 3 ? 8 : 12;
        if (br.level <= 2) {
          for (const off of [-0.014, 0.014]) {
            line(
              (t) => {
                const p = quadAt(br.a, br.c, br.b, t);
                return { x: p.x + off, y: p.y, z: p.z + off * 0.5 };
              },
              count,
              alpha
            );
          }
        } else {
          line((t) => quadAt(br.a, br.c, br.b, t), count, alpha);
        }
      }
      // 根系：四条向外下方伸的短弧
      const root = trunk.a;
      const tips = [
        { x: 0.17, y: root.y + 0.07, z: 0.04 },
        { x: -0.16, y: root.y + 0.09, z: 0.06 },
        { x: 0.05, y: root.y + 0.1, z: -0.14 },
        { x: -0.06, y: root.y + 0.08, z: 0.16 }
      ];
      for (const tip of tips) {
        const ctrl = { x: tip.x * 0.45, y: root.y + 0.02, z: tip.z * 0.45 };
        line((t) => quadAt(root, ctrl, tip, t), 10, 0.3);
      }
      break;
    }
    case 'wave': {
      // 四层倾斜的环，半径、高度、倾角、方位各自错开
      for (let k = 0; k < RIPPLE_RINGS.length; k++) {
        line((t) => rippleAt(k, t * TAU), 100, RIPPLE_RINGS[k].alpha);
      }
      // 波心：中心一点小小的涟漪环
      const core = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * TAU;
        core.push({ x: Math.cos(a) * 0.07, y: 0.02, z: Math.sin(a) * 0.07 });
      }
      lines.push({ pts: core, alpha: 0.5 });
      break;
    }
    case 'binary': {
      // 三维 8 字轨道本体
      line((t) => binaryAt(t * TAU), 160);
      // 两颗主星：x 轴两端各带一个倾斜光环
      for (const side of [-1, 1]) {
        const c = binaryAt(side < 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
        const ring = [];
        for (let i = 0; i <= 40; i++) {
          const a = (i / 40) * TAU;
          const p = tiltX(
            { x: Math.cos(a) * 0.16, y: 0, z: Math.sin(a) * 0.16 },
            BINARY_TILT + side * 0.35
          );
          ring.push({ x: c.x + p.x, y: c.y + p.y, z: c.z + p.z });
        }
        lines.push({ pts: ring, alpha: 0.75 });
      }
      // 物质桥：两星之间越过中心上方的一条弧
      const a = binaryAt(Math.PI / 2);
      const b = binaryAt((3 * Math.PI) / 2);
      const ctrl = tiltX(spinY({ x: 0, y: 0.9, z: 0 }, BINARY_YAW), BINARY_TILT);
      line((t) => quadAt(a, ctrl, b, t), 40, 0.4);
      break;
    }
    case 'sphere':
    default:
      break;
  }
  return lines;
}

/**
 * 把随机方向压到某个倾斜盘面内，让章节 / 知识点云沿形状骨架铺开，
 * 而不是围着课程点长成一团球。
 */
function planeDir(angle, dir, tangent = 1.3, normal = 0) {
  const n = tiltX({ x: 0, y: 1, z: 0 }, angle);
  const d = dir.x * n.x + dir.y * n.y + dir.z * n.z;
  const tx = dir.x - n.x * d;
  const ty = dir.y - n.y * d;
  const tz = dir.z - n.z * d;
  const len = Math.hypot(tx, ty, tz) || 1;
  return {
    x: (tx / len) * tangent,
    y: (ty / len) * tangent + n.y * normal,
    z: (tz / len) * tangent + n.z * normal
  };
}

/**
 * 章节 / 知识点云围绕课程散开的方向修正：让云也贴合形状的立体轮廓。
 * 现在节点主要走 shapePath 布局，这里保留给球形以外的散点与 puff 使用。
 */
export function shapeCloudDir(shape, dir) {
  switch (shape) {
    case 'galaxy':
      return planeDir(DISK_TILT, dir, 1.15, 0.28);
    case 'helix':
      return { x: dir.x * 0.7, y: dir.y * 1.1, z: dir.z * 0.7 };
    case 'torus':
      return planeDir(0.95, dir, 1.0, 0.3);
    case 'wave':
      return { x: dir.x * 1.6, y: dir.y * 0.8, z: dir.z * 1.6 };
    case 'tree':
      return { x: dir.x * 1.05, y: dir.y * 1.25, z: dir.z * 1.05 };
    case 'binary':
      return dir;
    case 'lattice':
    default:
      return dir;
  }
}

function loadShape() {
  try {
    const value = localStorage.getItem(STORE_KEY);
    if (SHAPES.some((s) => s.id === value)) ui.shape = value;
  } catch (e) {
    /* 隐私模式 / 存储不可用时保持默认球形。 */
  }
}

loadShape();

export function shapeInfo(id = ui.shape) {
  return SHAPES.find((s) => s.id === id) || SHAPES[0];
}

export function shapeId() {
  return shapeInfo().id;
}

/** 写入形状偏好；localStorage 不可用时静默忽略。 */
export function saveShape(id) {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch (e) {
    /* 隐私模式 / 存储不可用时本次会话仍然生效。 */
  }
}

/** 写入形状偏好；相同值时返回 false。 */
export function setShape(id) {
  if (!SHAPES.some((s) => s.id === id) || ui.shape === id) return false;
  ui.shape = id;
  saveShape(id);
  return true;
}

/** 形状图标：用同一套几何做带透视的点阵投影，每个形状一眼可辨。 */
export function shapeIcon(id) {
  const points = [];
  const count = 54;
  for (let i = 0; i < count; i++) points.push(shapePoint(id, i, count));
  const cyaw = Math.cos(0.5);
  const syaw = Math.sin(0.5);
  const cpitch = Math.cos(0.3);
  const spitch = Math.sin(0.3);
  const project = (p) => {
    // 固定等轴视角 + 轻微透视：近处点更大更亮，远处更小更暗。
    const x1 = p.x * cyaw - p.z * syaw;
    const z1 = p.x * syaw + p.z * cyaw;
    const y1 = p.y * cpitch - z1 * spitch;
    const z2 = p.y * spitch + z1 * cpitch;
    const persp = 1 / (1 - z2 * 0.22);
    return [x1 * persp, -y1 * persp, persp];
  };
  const projected = points.map(project);
  let maxR = 0.001;
  for (const [x, y] of projected) maxR = Math.max(maxR, Math.hypot(x, y));
  const scale = 18.5 / maxR;
  const dots = projected
    .map(([x, y, depth], i) => {
      const px = (24 + x * scale).toFixed(2);
      const py = (24 + y * scale).toFixed(2);
      const r = ((0.55 + (i / count) * 0.6) * depth).toFixed(2);
      const o = ((0.3 + (i / count) * 0.58) * Math.min(1.1, depth)).toFixed(2);
      return `<circle cx="${px}" cy="${py}" r="${r}" opacity="${o}"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" focusable="false">${dots}</svg>`;
}