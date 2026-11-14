// 星海形状：外层 3D 里课程节点的空间排布。只改“点分布”，不改层级与交互。
// 形状选择属于本机视觉偏好，存 localStorage，不写进知识数据。
import { TAU } from '@starmap/core';
import { ui } from './state.js';

const STORE_KEY = 'starmap.shape.v1';

export const SHAPES = [
  { id: 'sphere', name: '球形', hint: '均匀铺满球面' },
  { id: 'galaxy', name: '旋涡星系', hint: '三条旋臂向外卷开' },
  { id: 'helix', name: '双螺旋', hint: '两股星链盘旋上升' },
  { id: 'torus', name: '环带', hint: '首尾相接的环形星带' },
  { id: 'lattice', name: '晶格', hint: '悬浮的立体格点阵列' },
  { id: 'rose', name: '星芒', hint: '五瓣星芒向四周绽放' },
  { id: 'wave', name: '涟漪', hint: '一圈圈起伏的星波' }
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

function latticeCells(count) {
  const side = Math.max(1, Math.ceil(Math.cbrt(count)));
  const all = [];
  for (let z = 0; z < side; z++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) all.push({ x, y, z });
    }
  }
  const picks = [];
  if (count <= 1 || all.length === 1) {
    picks.push(all[0]);
  } else {
    for (let i = 0; i < count; i++) {
      picks.push(all[Math.round((i * (all.length - 1)) / (count - 1))]);
    }
  }
  const c = (side - 1) / 2;
  const half = Math.max(0.5, c);
  const span = 0.74;
  return picks.map((p) => ({
    x: ((p.x - c) / half) * span,
    y: ((p.y - c) / half) * span,
    z: ((p.z - c) / half) * span
  }));
}

/**
 * 形状上第 i 个点的单位坐标（大致落在 [-1,1] 的立方体内）。
 * @param {string} shape
 * @param {number} i
 * @param {number} count
 */
export function shapePoint(shape, i, count) {
  const n = Math.max(1, count);
  switch (shape) {
    case 'galaxy': {
      const arm = i % 3;
      // 同一条旋臂上的点共享一个“半径层”，数量少时也能看出三条臂的骨架。
      const ring = Math.floor(i / 3);
      const rings = Math.max(1, Math.ceil(n / 3));
      const t = Math.min(1, (ring + 0.5) / rings);
      const r = 0.18 + 0.82 * Math.pow(t, 0.72);
      const theta = arm * (TAU / 3) + r * 3.4 + (jitter(i, 7) - 0.5) * 0.22;
      // 盘面朝向初始镜头（xy 平面），z 只留一点厚度，旋臂才不会被压成一条线。
      return {
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r * 0.92,
        z: (jitter(i, 11) - 0.5) * 0.22 * (1 - r * 0.5)
      };
    }
    case 'helix': {
      const chain = i % 2;
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const theta = t * TAU * 1.62 + chain * Math.PI;
      const r = 0.44;
      return {
        x: Math.cos(theta) * r,
        y: (t - 0.5) * 1.66,
        z: Math.sin(theta) * r
      };
    }
    case 'torus': {
      const R = 0.64;
      const r = 0.27;
      const theta = i * GOLDEN;
      const phi = (i * 0.61803398875 + 0.17) * TAU;
      const cr = R + r * Math.cos(phi);
      // 主环放在 xy 平面正对镜头，管身沿 z 起伏，环带轮廓才完整。
      return { x: cr * Math.cos(theta), y: cr * Math.sin(theta), z: r * Math.sin(phi) };
    }
    case 'lattice': {
      const cells = latticeCells(n);
      const p = cells[Math.min(i, cells.length - 1)] || cells[0];
      return {
        x: p.x + (jitter(i, 3) - 0.5) * 0.03,
        y: p.y + (jitter(i, 5) - 0.5) * 0.03,
        z: p.z + (jitter(i, 9) - 0.5) * 0.03
      };
    }
    case 'rose': {
      const t = (i + 0.5) / n;
      const theta = t * TAU;
      const r = 0.34 + 0.6 * Math.abs(Math.cos((theta * 5) / 2));
      // 星芒正对镜头铺开，只保留极薄的 z 抖动，避免变成一条水平线。
      return {
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r * 0.9,
        z: (jitter(i, 13) - 0.5) * 0.18 * (1 - r * 0.6)
      };
    }
    case 'wave': {
      const t = (i + 0.5) / n;
      const r = Math.sqrt(t) * 0.92;
      const theta = i * GOLDEN;
      // 涟漪是面向镜头的同心波，y 起伏直接画在屏幕平面上。
      return {
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r * 0.9 + Math.sin(r * 6.6 + 0.3) * 0.16,
        z: Math.cos(r * 5.2) * 0.1
      };
    }
    case 'sphere':
    default:
      return fibonacci(i, n, 0.4);
  }
}

/**
 * 章节 / 知识点云围绕课程散开的方向修正：让云也贴合形状轮廓，
 * 而不是无论什么形状都长成一团球。
 */
export function shapeCloudDir(shape, dir) {
  switch (shape) {
    case 'galaxy':
      return { x: dir.x * 1.32, y: dir.y * 1.32, z: dir.z * 0.3 };
    case 'helix':
      return { x: dir.x * 0.8, y: dir.y * 1.32, z: dir.z * 0.8 };
    case 'torus':
      return { x: dir.x, y: dir.y, z: dir.z * 0.55 };
    case 'rose':
    case 'wave':
      return { x: dir.x * 1.14, y: dir.y * 1.14, z: dir.z * 0.3 };
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

/** 形状图标：直接用同一套几何投影成点阵，每个形状一眼可辨。 */
export function shapeIcon(id) {
  const points = [];
  const count = 54;
  for (let i = 0; i < count; i++) points.push(shapePoint(id, i, count));
  const project = (p) => {
    switch (id) {
      case 'helix':
        return [p.x, -p.y * 0.95];
      case 'lattice':
        return [p.x - p.z * 0.58, (p.x + p.z) * 0.32 - p.y * 0.92];
      case 'sphere':
        return [p.x, p.y * 0.92 + p.z * 0.3];
      case 'galaxy':
      case 'torus':
      case 'rose':
      case 'wave':
        return [p.x, -p.y];
      default:
        return [p.x, p.z];
    }
  };
  const projected = points.map(project);
  let maxR = 0.001;
  for (const [x, y] of projected) maxR = Math.max(maxR, Math.hypot(x, y));
  const scale = 19 / maxR;
  const dots = projected
    .map(([x, y], i) => {
      const px = (24 + x * scale).toFixed(2);
      const py = (24 + y * scale).toFixed(2);
      const r = (0.6 + (i / count) * 0.75).toFixed(2);
      const o = (0.32 + (i / count) * 0.6).toFixed(2);
      return `<circle cx="${px}" cy="${py}" r="${r}" opacity="${o}"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" focusable="false">${dots}</svg>`;
}