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
  { id: 'galaxy', name: '棒旋星系', hint: '棒状核心 + 两条旋臂 + 潮汐尾' },
  { id: 'helix', name: 'DNA 双螺旋', hint: '两条主链盘旋上升，碱基对横档相连' },
  { id: 'torus', name: '莫比乌斯环', hint: '扭转半圈的立体星带' },
  { id: 'lattice', name: '晶格', hint: '立方线框，节点沿棱生长' },
  { id: 'rose', name: '星芒', hint: '十四道星芒向三维空间放射' },
  { id: 'wave', name: '波浪光带', hint: '一条在星海里起伏飘动的光带' },
  { id: 'fish', name: '大肥鱼', hint: '一条在星海里游动的胖鱼' }
];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const LATTICE_EDGES = [
  [0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]
];

const ROSE_SPIKES = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
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
      // 棒旋星系：细长棒状核心、两条主旋臂、一条甩出去的潮汐尾。
      const barCount = Math.max(1, Math.round(n * 0.18));
      const tailCount = Math.max(1, Math.round(n * 0.18));
      const armCount = Math.max(2, n - barCount - tailCount);
      if (i < barCount) {
        const u = (i + 0.5) / barCount;
        const a = i * GOLDEN;
        return tiltX(
          { x: (u - 0.5) * 1.05, y: Math.cos(a) * 0.085, z: Math.sin(a) * 0.085 },
          1.0
        );
      }
      if (i >= n - tailCount) {
        // 潮汐尾：从盘缘甩出去的一条长弧，打破“圆盘”的轮廓。
        const u = (i - (n - tailCount) + 0.5) / tailCount;
        const theta = 0.15 + u * 1.25;
        const r = 0.92 + u * 0.85;
        const y = (u - 0.5) * 0.2 + Math.sin(u * Math.PI) * 0.08;
        return tiltX({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }, 1.05);
      }
      const j = i - barCount;
      const arm = j % 2;
      const ring = Math.floor(j / 2);
      const rings = Math.max(1, Math.ceil(armCount / 2));
      const t = Math.min(1, (ring + 0.5) / rings);
      const r = 0.2 + 0.92 * Math.pow(t, 0.72);
      const theta = arm * Math.PI + r * 4.2 + (jitter(i, 7) - 0.5) * 0.3;
      const thick = (jitter(i, 11) - 0.5) * (0.05 + Math.max(0, 1 - r / 0.42) * 0.4);
      return tiltX({ x: Math.cos(theta) * r, y: thick, z: Math.sin(theta) * r }, 1.05);
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
      // 莫比乌斯带：沿带宽方向扭转半圈，投影是倾斜的立体扭带而不是正圆环。
      const theta = ((i + 0.5) / n) * TAU;
      const u = (jitter(i, 5) - 0.5) * 2;
      const R = 0.7;
      const w = 0.24;
      const twist = theta / 2;
      const cr = R + w * u * Math.cos(twist);
      return tiltX(
        { x: cr * Math.cos(theta), y: w * u * Math.sin(twist), z: cr * Math.sin(theta) },
        0.9
      );
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
    case 'rose': {
      // 三维星形体：14 根放射星芒，轴向略长、对角略短。
      const k = i % ROSE_SPIKES.length;
      const step = Math.floor(i / ROSE_SPIKES.length);
      const perRay = Math.max(1, Math.ceil(n / ROSE_SPIKES.length));
      const t = (step + 0.5) / perRay;
      const d = ROSE_SPIKES[k];
      const spike = k < 6 ? 0.92 : 0.54;
      const r = spike * (1 - 0.76 * t);
      return { x: (d[0] / Math.hypot(...d)) * r, y: (d[1] / Math.hypot(...d)) * r, z: (d[2] / Math.hypot(...d)) * r };
    }
    case 'wave': {
      // 立体星波：一条沿 x 轴起伏的光带，带宽在 y/z 方向展开，
      // 投影是波浪形飘带，不再是同心圆。
      const u = (i + 0.5) / n;
      const band = (jitter(i, 3) - 0.5) * 2;
      const x = (u - 0.5) * 2.05;
      const y = Math.sin(u * TAU * 1.55) * 0.52 + band * 0.09;
      const z = band * 0.14 + Math.cos(u * TAU * 1.15) * 0.34;
      return { x, y, z };
    }
    case 'fish': {
      // 大肥鱼：沿 x 轴拉长的纺锤形身体 + 分叉尾鳍。
      const bodyCount = Math.max(4, Math.round(n * 0.78));
      if (i < bodyCount) {
        const u = (i + 0.5) / bodyCount;
        const theta = i * GOLDEN;
        const bodyR = 0.6 * Math.pow(Math.max(0.001, Math.sin(Math.PI * u)), 0.55) *
          (1 + 0.12 * Math.sin(u * TAU * 1.5));
        return {
          x: (u - 0.5) * 1.55,
          y: Math.cos(theta) * bodyR,
          z: Math.sin(theta) * bodyR
        };
      }
      // 尾鳍：在 -x 端上下分叉成两片。
      const j = i - bodyCount;
      const tailCount = Math.max(1, n - bodyCount);
      const u = (j + 0.5) / tailCount;
      const side = j % 2 === 0 ? 1 : -1;
      return {
        x: -0.78 - u * 0.38,
        y: side * (0.06 + u * 0.5),
        z: (jitter(i, 9) - 0.5) * 0.12
      };
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
      // 两条旋臂轮流承载整棵树，走完一条再走另一条。
      const arm = u < 0.5 ? 0 : 1;
      const s = u < 0.5 ? u * 2 : (u - 0.5) * 2;
      const r = 0.2 + 0.92 * Math.pow(s, 0.78);
      const theta = arm * Math.PI + r * 4.2;
      const thick = Math.sin(s * Math.PI) * 0.05;
      return tiltX({ x: Math.cos(theta) * r, y: thick, z: Math.sin(theta) * r }, 1.05);
    }
    case 'helix': {
      // 前半程走链 A 由下到上，后半程走链 B 由上到下，形成完整的双链环。
      const chain = u < 0.5 ? 0 : 1;
      const s = u < 0.5 ? u * 2 : (1 - u) * 2;
      const theta = s * TAU * 2.2 + chain * Math.PI;
      return { x: Math.cos(theta) * 0.5, y: (s - 0.5) * 1.72, z: Math.sin(theta) * 0.5 };
    }
    case 'torus': {
      // 沿莫比乌斯带中线走一圈（中线不扭，仍是一条倾斜的环）。
      const theta = u * TAU;
      return tiltX({ x: Math.cos(theta) * 0.7, y: 0, z: Math.sin(theta) * 0.7 }, 0.9);
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
    case 'rose': {
      // 依次走 14 根星芒，从外端收向中心再跳回外端。
      const seg = Math.min(ROSE_SPIKES.length - 1, Math.floor(u * ROSE_SPIKES.length));
      const s = u * ROSE_SPIKES.length - seg;
      const d = ROSE_SPIKES[seg];
      const len = Math.hypot(...d);
      const spike = seg < 6 ? 0.92 : 0.54;
      const r = spike * (1 - 0.76 * s);
      return { x: (d[0] / len) * r, y: (d[1] / len) * r, z: (d[2] / len) * r };
    }
    case 'wave': {
      // 沿光带中线从一端走到另一端。
      const x = (u - 0.5) * 2.05;
      const y = Math.sin(u * TAU * 1.55) * 0.52;
      const z = Math.cos(u * TAU * 1.15) * 0.34;
      return { x, y, z };
    }
    case 'fish': {
      // 沿鱼身表面螺旋前进：u 是体长方向，theta 绕身体转两圈多。
      const theta = u * TAU * 2.4;
      const bodyR = 0.6 * Math.pow(Math.max(0.001, Math.sin(Math.PI * u)), 0.55) *
        (1 + 0.12 * Math.sin(u * TAU * 1.5));
      return {
        x: (u - 0.5) * 1.55,
        y: Math.cos(theta) * bodyR * 0.92,
        z: Math.sin(theta) * bodyR * 0.92
      };
    }
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
  const line = (fn, count = detail) => {
    const pts = [];
    for (let i = 0; i <= count; i++) pts.push(fn(i / count));
    lines.push(pts);
  };
  switch (shape) {
    case 'galaxy': {
      // 两条旋臂
      for (let arm = 0; arm < 2; arm++) {
        line((t) => {
          const r = 0.2 + 0.92 * Math.pow(t, 0.72);
          const theta = arm * Math.PI + r * 4.2;
          return tiltX({ x: Math.cos(theta) * r, y: 0, z: Math.sin(theta) * r }, 1.05);
        });
      }
      // 棒状核心
      line((t) => tiltX({ x: (t - 0.5) * 1.05, y: 0, z: 0 }, 1.0), 12);
      // 潮汐尾
      line((t) => {
        const theta = 0.15 + t * 1.25;
        const r = 0.92 + t * 0.85;
        return tiltX({ x: Math.cos(theta) * r, y: (t - 0.5) * 0.2, z: Math.sin(theta) * r }, 1.05);
      }, 40);
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
      // 莫比乌斯带的两条边缘 + 中线
      for (const u of [-1, 0, 1]) {
        line((t) => {
          const theta = t * TAU;
          const R = 0.7;
          const w = 0.24;
          const cr = R + w * u * Math.cos(theta / 2);
          return tiltX(
            { x: cr * Math.cos(theta), y: w * u * Math.sin(theta / 2), z: cr * Math.sin(theta) },
            0.9
          );
        });
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
    case 'rose':
      for (const d of ROSE_SPIKES) {
        const len = Math.hypot(...d);
        const spike = ROSE_SPIKES.indexOf(d) < 6 ? 0.92 : 0.54;
        lines.push([
          { x: 0, y: 0, z: 0 },
          { x: (d[0] / len) * spike, y: (d[1] / len) * spike, z: (d[2] / len) * spike }
        ]);
      }
      break;
    case 'wave': {
      // 光带的三条纵向轮廓线 + 两端横档，整体像一条起伏的飘带。
      for (const band of [-1, 0, 1]) {
        line((t) => {
          const x = (t - 0.5) * 2.05;
          const y = Math.sin(t * TAU * 1.55) * 0.52 + band * 0.09;
          const z = band * 0.14 + Math.cos(t * TAU * 1.15) * 0.34;
          return { x, y, z };
        });
      }
      for (const t of [0, 1]) {
        const x = (t - 0.5) * 2.05;
        const y = Math.sin(t * TAU * 1.55) * 0.52;
        const z = Math.cos(t * TAU * 1.15) * 0.34;
        lines.push([
          { x, y: y - 0.09, z: z - 0.14 },
          { x, y: y + 0.09, z: z + 0.14 }
        ]);
      }
      break;
    }
    case 'fish': {
      // 胖鱼轮廓：上下身体曲线、背鳍 / 胸鳍、尾鳍扇形，再点一只眼睛。
      const bodyR = (t) => 0.6 * Math.pow(Math.max(0.001, Math.sin(Math.PI * t)), 0.55) *
        (1 + 0.12 * Math.sin(t * TAU * 1.5));
      const bodyX = (t) => (t - 0.5) * 1.55;
      line((t) => ({ x: bodyX(t), y: bodyR(t), z: 0 }));
      line((t) => ({ x: bodyX(t), y: -bodyR(t), z: 0 }));
      // 背鳍
      lines.push({
        pts: [
          { x: bodyX(0.42), y: bodyR(0.42) * 0.96, z: 0 },
          { x: bodyX(0.52), y: bodyR(0.52) + 0.28, z: 0 },
          { x: bodyX(0.64), y: bodyR(0.64) * 0.92, z: 0 }
        ],
        alpha: 0.75
      });
      // 胸鳍
      lines.push({
        pts: [
          { x: bodyX(0.46), y: -bodyR(0.46) * 0.9, z: 0 },
          { x: bodyX(0.4), y: -bodyR(0.4) - 0.26, z: 0 },
          { x: bodyX(0.58), y: -bodyR(0.58) * 0.86, z: 0 }
        ],
        alpha: 0.75
      });
      // 尾鳍：从尾根斜出去的三条线 + 扇形外缘
      lines.push({
        pts: [
          { x: -0.78, y: 0, z: 0 },
          { x: -1.16, y: 0.56, z: 0 }
        ],
        alpha: 0.8
      });
      lines.push({
        pts: [
          { x: -0.78, y: 0, z: 0 },
          { x: -1.18, y: 0, z: 0 }
        ],
        alpha: 0.8
      });
      lines.push({
        pts: [
          { x: -0.78, y: 0, z: 0 },
          { x: -1.16, y: -0.56, z: 0 }
        ],
        alpha: 0.8
      });
      lines.push({
        pts: [
          { x: -1.16, y: 0.56, z: 0 },
          { x: -1.18, y: 0, z: 0 },
          { x: -1.16, y: -0.56, z: 0 }
        ],
        alpha: 0.8
      });
      // 侧线：沿 z 方向的体侧轮廓，暗示胖鱼的体积
      lines.push({
        pts: Array.from({ length: 41 }, (_, i) => {
          const t = i / 40;
          return { x: bodyX(t), y: 0, z: bodyR(t) * 0.68 };
        }),
        alpha: 0.45
      });
      // 眼睛：鱼头侧面一个小圆
      const eye = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * TAU;
        eye.push({
          x: 0.56 + Math.cos(a) * 0.075,
          y: bodyR(0.86) * 0.35 + Math.sin(a) * 0.075,
          z: 0.4
        });
      }
      lines.push(eye);
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
      return planeDir(1.05, dir, 1.2, 0.05);
    case 'helix':
      return { x: dir.x * 0.7, y: dir.y * 1.1, z: dir.z * 0.7 };
    case 'torus':
      return planeDir(0.9, dir, 1.0, 0.25);
    case 'wave':
      return { x: dir.x * 1.5, y: dir.y * 1.25, z: dir.z * 0.55 };
    case 'rose':
    case 'lattice':
    case 'fish':
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