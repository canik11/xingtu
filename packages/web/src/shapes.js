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

/** 螺旋臂上的一点：offset 把三条细线错开成一条有宽度的光带。 */
function galaxySpiral(u, arm, offset = 0) {
  const r = 0.1 + u * DISK_R + offset;
  const phi = u * TAU * DISK_SPIN + arm * Math.PI;
  return spinY(
    tiltX({ x: Math.cos(phi) * r, y: -0.02, z: Math.sin(phi) * r }, DISK_TILT),
    DISK_YAW
  );
}

/** 盘面上的同心环（极坐标网格的纬线），r 是归一化半径。 */
function galaxyRing(a, r) {
  return spinY(tiltX({ x: Math.cos(a) * r, y: -0.02, z: Math.sin(a) * r }, DISK_TILT), DISK_YAW);
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
      // 节点沿主环前进，同时绕管壁转五圈：整条节点带缠满环状管面，
      // 管的外侧、内侧、上下缘都有节点，而不是全部挤在管壁的一条线上。
      return ringAt(u * TAU, u * TAU * 5 + 0.9);
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
      // 旋涡星云：两条螺旋臂各由三条细线叠成光带，再加盘面同心环，
      // 像一张斜放的极坐标网格——螺旋是臂，同心环是纬，一眼能读出星盘几何。
      for (let arm = 0; arm < 2; arm++) {
        for (const off of [-0.035, 0, 0.035]) {
          line((t) => galaxySpiral(t, arm, off), 200, off === 0 ? 0.95 : 0.42);
        }
      }
      for (const rr of [0.3, 0.55, 0.8, 1.02]) {
        line((t) => galaxyRing(t * TAU, rr), 120, rr > 1 ? 0.3 : 0.22);
      }
      // 核球：一圈亮环，中心体积交给星尘团。
      line((t) => galaxyRing(t * TAU, 0.12), 48, 0.5);
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
      // 环面网格：四圈纬线（外缘、管中、内缘、另一侧管中）铺开主环，
      // 十六道经线沿管壁绕一整圈，把整个甜甜圈完整包住。
      for (const v of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        line(
          (t) => ringAt(t * TAU, v),
          120,
          v === 0 || Math.abs(v - Math.PI) < 0.01 ? 0.45 : 0.22
        );
      }
      for (let k = 0; k < 16; k++) {
        const u = (k / 16) * TAU;
        line((t) => ringAt(u, t * TAU), 24, k % 4 === 0 ? 0.38 : 0.2);
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
    case 'sphere': {
      // 球面经纬网：五条纬线（赤道最亮）加八条经线，把整颗星球完整包住，
      // 球形和其他形状一样有自己的几何骨架，而不是只靠一圈星尘。
      for (const y of [-0.62, -0.32, 0, 0.32, 0.62]) {
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        line(
          (t) => ({ x: Math.cos(t * TAU) * r, y, z: Math.sin(t * TAU) * r }),
          120,
          Math.abs(y) < 0.01 ? 0.44 : 0.26
        );
      }
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * TAU;
        line(
          (t) => {
            const y = 1 - t * 2;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            return { x: Math.cos(yaw) * r, y, z: Math.sin(yaw) * r };
          },
          72,
          0.2
        );
      }
      break;
    }
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
    case 'binary':
      return dir;
    case 'lattice':
    default:
      return dir;
  }
}

// ——— 每形状私有的几何形变 ———
// 静默效果不再用同一种“向外膨胀”套所有形状：每种 3D 样式按自己的几何结构动。
// 输入输出都是世界坐标；time 为秒，scale 是当前骨架的外半径，strength ∈ [0,1] 负责渐入。
const IDLE_LABELS = {
  sphere: '呼吸',
  galaxy: '旋涌',
  helix: '扭转',
  torus: '环流',
  lattice: '声子',
  wave: '涟漪',
  binary: '进动'
};

const IDLE_NOTES = {
  sphere: '呼吸 = 整个星球沿半径同步胀缩，球面各层一起起伏',
  galaxy: '旋涌 = 星盘绕倾斜法线差速旋转，内圈快外圈慢，两条旋臂被越拉越弯',
  helix: '扭转 = 一道行波沿中轴传过双链，螺旋与碱基对横档跟着翻卷',
  torus: '环流 = 星尘沿管壁切向环流，环面像被一圈圈拧动',
  lattice: '声子 = 疏密行波沿晶格棱传递，节点在棱上轻声振动',
  wave: '涟漪 = 波峰从波心一圈圈向外荡开，环层随之起伏',
  binary: '进动 = 轨道面缓慢进动，两片叶瓣上下交错浮动'
};

/** 绕任意单位轴旋转（Rodrigues），用于星系差速旋转与星环环流。 */
function axisAngle(p, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = p.x * axis.x + p.y * axis.y + p.z * axis.z;
  const cr = {
    x: axis.y * p.z - axis.z * p.y,
    y: axis.z * p.x - axis.x * p.z,
    z: axis.x * p.y - axis.y * p.x
  };
  return {
    x: p.x * c + cr.x * s + axis.x * d * (1 - c),
    y: p.y * c + cr.y * s + axis.y * d * (1 - c),
    z: p.z * c + cr.z * s + axis.z * d * (1 - c)
  };
}

/** 星系盘的法线：盘面先倾斜再偏转，法线走同一套旋转。 */
const GALAXY_AXIS = unitize(spinY(tiltX({ x: 0, y: 1, z: 0 }, DISK_TILT), DISK_YAW));

/** 晶格的三根棱方向（随晶格骨架一起倾斜），形变沿最近的那根棱振动。 */
const LATTICE_AXES = [
  unitize(tiltX({ x: 1, y: 0, z: 0 }, 0.5)),
  unitize(tiltX({ x: 0, y: 1, z: 0 }, 0.5)),
  unitize(tiltX({ x: 0, y: 0, z: 1 }, 0.5))
];

/**
 * 静默效果的几何形变：把世界坐标 p 按当前形状的私有规律推到新位置。
 * 强度为 0 时严格返回原坐标，关闭效果不会留下任何偏移。
 * @param {string} shape
 * @param {{x:number,y:number,z:number}} p 世界坐标
 * @param {number} time 秒
 * @param {number} scale 当前骨架外半径
 * @param {number} strength 0..1
 */
export function shapeIdlePoint(shape, p, time, scale, strength) {
  const s = Math.max(0, Math.min(1, strength || 0));
  if (s <= 0.0001) return p;
  const R = scale || 1;

  switch (shape) {
    case 'galaxy': {
      // 旋涌：整片星盘绕倾斜法线缓慢自转，只保留很轻的差速——旋臂随盘一起转动，
      // 几何轮廓始终清晰，而不是把节点甩出去织成乱线。
      const r = Math.hypot(p.x, p.y, p.z) / R;
      const omega = 0.075 + 0.03 / (1 + r);
      const swirl = axisAngle(p, GALAXY_AXIS, s * omega * time);
      const pulse = 1 + s * 0.02 * Math.sin(time * 0.9);
      return { x: swirl.x * pulse, y: swirl.y * pulse, z: swirl.z * pulse };
    }
    case 'helix': {
      // DNA：扭转角沿 Y 轴滑行，形成一道从下往上（或反向）传过的行波。
      const y = p.y / R;
      const wave = time * 1.3 - y * 4.5;
      const phi = s * 0.35 * Math.sin(wave);
      const grow = 1 + s * 0.05 * Math.sin(wave + 1.2);
      const q = spinY(p, phi);
      return { x: q.x * grow, y: q.y, z: q.z * grow };
    }
    case 'torus': {
      // 星环：先逆倾斜到环面坐标，再绕主环切向把节点卷到管壁的另一侧。
      const q = tiltX(p, -RING_TILT);
      const u = Math.atan2(q.z, q.x);
      const cx = Math.cos(u) * RING_R;
      const cy = Math.sin(2 * u) * 0.18;
      const cz = Math.sin(u) * RING_R;
      const v = { x: q.x - cx * R, y: q.y - cy * R, z: q.z - cz * R };
      const tangent = unitize({
        x: -Math.sin(u) * RING_R,
        y: 0.36 * Math.cos(2 * u),
        z: Math.cos(u) * RING_R
      });
      const rot = axisAngle(v, tangent, s * (time * 0.5 + u * 0.6));
      return tiltX(
        { x: rot.x + cx * R, y: rot.y + cy * R, z: rot.z + cz * R },
        RING_TILT
      );
    }
    case 'lattice': {
      // 晶格：先逆倾斜回立方体坐标，找离节点最近的那根棱，让疏密波沿棱传递。
      const local = tiltX(p, -0.5);
      const ux = local.x / R;
      const uy = local.y / R;
      const uz = local.z / R;
      const ax = Math.abs(ux);
      const ay = Math.abs(uy);
      const az = Math.abs(uz);
      const axis = ax <= ay && ax <= az
        ? LATTICE_AXES[0]
        : ay <= az
          ? LATTICE_AXES[1]
          : LATTICE_AXES[2];
      const amp = R * 0.018 * s * Math.sin(time * 2.0 + (ux + uy + uz) * 4.0);
      return { x: p.x + axis.x * amp, y: p.y + axis.y * amp, z: p.z + axis.z * amp };
    }
    case 'wave': {
      // 星波：波峰从中心向外一圈圈荡开，环层半径与高度一起起伏。
      const r = Math.hypot(p.x, p.z) / R;
      const wave = time * 1.5 - r * 6.0;
      const grow = 1 + s * 0.075 * Math.sin(wave);
      const lift = R * 0.03 * s * Math.sin(wave) * Math.min(1, r);
      return { x: p.x * grow, y: p.y * grow + lift, z: p.z * grow };
    }
    case 'binary': {
      // 双星：轨道面绕 Y 轴进动，两叶瓣沿高度方向交错浮动。
      const q = spinY(p, s * 0.22 * Math.sin(time * 0.6));
      const bob = R * 0.035 * s * Math.sin(time * 0.75 + Math.atan2(q.z, q.x));
      return { x: q.x, y: q.y + bob, z: q.z };
    }
    case 'sphere':
    default: {
      // 球形：唯一保持球对称的样式，用整体径向呼吸而不是各自乱飞。
      const breath = 1 + 0.1 * s * Math.sin(time * 1.1);
      return { x: p.x * breath, y: p.y * breath, z: p.z * breath };
    }
  }
}

/** 当前形状的私有静默效果名（用于静默面板按钮与提示）。 */
export function shapeIdleLabel(shape) {
  return IDLE_LABELS[shape] || IDLE_LABELS.sphere;
}

/** 当前形状私有静默效果的说明文案。 */
export function shapeIdleNote(shape) {
  return IDLE_NOTES[shape] || IDLE_NOTES.sphere;
}

function loadShape() {
  try {
    let value = localStorage.getItem(STORE_KEY);
    // 旧版本存过“知识树”与“玫瑰”，现在这两项已移除，回落到默认球形。
    if (value === 'tree' || value === 'rose') value = 'sphere';
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