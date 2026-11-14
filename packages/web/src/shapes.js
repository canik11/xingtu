// 星海形状：外层 3D 里课程节点的空间排布。只改“点分布”，不改层级与交互。
// 形状选择属于本机视觉偏好，存 localStorage，不写进知识数据。
import { TAU } from '@starmap/core';
import { ui } from './state.js';

const STORE_KEY = 'starmap.shape.v1';

export const SHAPES = [
  { id: 'sphere', name: '球形', hint: '均匀铺满球面' },
  { id: 'galaxy', name: '旋涡星系', hint: '三条旋臂绕核球倾斜展开' },
  { id: 'helix', name: '双螺旋', hint: '两股星链盘旋上升' },
  { id: 'torus', name: '星环', hint: '倾斜的立体环形星带' },
  { id: 'lattice', name: '晶格', hint: '悬浮的立体格点阵列' },
  { id: 'rose', name: '星芒', hint: '向三维空间放射的星芒' },
  { id: 'wave', name: '涟漪', hint: '起伏的立体星波' }
];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

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
      // 三条旋臂，盘面倾斜；中心附近给一点厚度，形成核球。
      const arm = i % 3;
      const ring = Math.floor(i / 3);
      const rings = Math.max(1, Math.ceil(n / 3));
      const t = Math.min(1, (ring + 0.5) / rings);
      const r = 0.16 + 0.8 * Math.pow(t, 0.7);
      const theta = arm * (TAU / 3) + r * 3.6 + (jitter(i, 7) - 0.5) * 0.24;
      const bulge = Math.max(0, 1 - r / 0.4);
      const y = (jitter(i, 11) - 0.5) * (0.1 + bulge * 0.55);
      // 盘面倾斜约 52°，投影成明显的椭圆盘而不是一条线。
      return tiltX({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }, 0.9);
    }
    case 'helix': {
      // 两股星链绕 y 轴盘旋，半径中段粗、两端收。
      const chain = i % 2;
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const theta = t * TAU * 1.55 + chain * Math.PI;
      const r = 0.5 * (1 - 0.55 * Math.abs(t - 0.5));
      return { x: Math.cos(theta) * r, y: (t - 0.5) * 1.7, z: Math.sin(theta) * r };
    }
    case 'torus': {
      // 主环在 xz 平面、管身绕环一周：主环方向密集、管面方向稀疏，
// 投影后是清晰的细环带，而不是一片实心云。
      const R = 0.72;
      const r = 0.11;
      const minor = 8;
      const major = Math.max(3, Math.round(n / minor));
      const k = i % major;
      const j = Math.floor(i / major);
      const theta = (k / major) * TAU + (j % 2) * (TAU / major) * 0.5;
      const phi = (j / minor) * TAU;
      const cr = R + r * Math.cos(phi);
      return tiltX({ x: cr * Math.cos(theta), y: r * Math.sin(phi), z: cr * Math.sin(theta) }, 1.15);
    }
    case 'lattice': {
      // 正方体线框：12 条棱上均匀采点，形成清晰的晶格骨架，而不是一团实心雾。
      const EDGES = [
        [0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1],
        [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
        [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]
      ];
      const seg = i % EDGES.length;
      const step = Math.floor(i / EDGES.length);
      const steps = Math.max(1, Math.ceil(n / EDGES.length));
      const t = (step + 0.5) / steps;
      const [ax, ay, az, bx, by, bz] = EDGES[seg];
      return tiltX(
        {
          x: (ax + (bx - ax) * t - 0.5) * 0.8,
          y: (ay + (by - ay) * t - 0.5) * 0.8,
          z: (az + (bz - az) * t - 0.5) * 0.8
        },
        0.5
      );
    }
    case 'rose': {
      // 三维星形体：14 根放射星芒，每根从外端连续收向中心，形成清晰的星形轮廓。
      const SPIKES = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
        [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
        [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
      ];
      const k = i % SPIKES.length;
      const step = Math.floor(i / SPIKES.length);
      const perRay = Math.max(1, Math.ceil(n / SPIKES.length));
      const t = (step + 0.5) / perRay;
      const d = SPIKES[k];
      const len = Math.hypot(d[0], d[1], d[2]);
      const spike = k < 6 ? 0.98 : 0.56;
      const r = spike * (1 - 0.74 * t);
      return { x: (d[0] / len) * r, y: (d[1] / len) * r, z: (d[2] / len) * r };
    }
    case 'wave': {
      // 同心波纹：几圈半径不同的环，环与环之间上下起伏，倾斜后像立体的水面涟漪。
      const rings = 6;
      const ring = i % rings;
      const step = Math.floor(i / rings);
      const perRing = Math.max(1, Math.ceil(n / rings));
      const t = (step + 0.5) / perRing;
      const theta = t * TAU + ring * 0.45;
      const r = 0.18 + ring * 0.15;
      const y = Math.sin((ring / (rings - 1)) * TAU) * 0.18;
      return tiltX({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }, 0.75);
    }
    case 'sphere':
    default:
      return fibonacci(i, n, 0.4);
  }
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
 * 章节 / 知识点云围绕课程散开的方向修正：让云也贴合形状的立体轮廓，
 * 而不是无论什么形状都长成一团球。
 */
export function shapeCloudDir(shape, dir) {
  switch (shape) {
    case 'galaxy':
      // 云沿倾斜盘面铺开，多个课程点的云连起来就是旋臂盘。
      return planeDir(0.9, dir, 1.35, 0.08);
    case 'helix':
      return { x: dir.x * 0.8, y: dir.y * 1.32, z: dir.z * 0.8 };
    case 'torus':
      return planeDir(0.85, dir, 1.1, 0.5);
    case 'wave':
      return planeDir(0.75, dir, 1.2, 0.28);
    case 'rose':
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