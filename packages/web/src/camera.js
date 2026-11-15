// 相机：世界坐标与屏幕坐标互转、缩放、平移动画与适配视图。
import { clamp } from '@starmap/core';
import { cam, ui, view } from './state.js';
import { data } from './store.js';

export const MIN_SCALE = 0.3;
export let MAX_SCALE = 3.0;

/** 画质设置里的渲染倍率上限：改变时同步影响缩放上限。 */
export function setMaxScale(value) {
  const next = clamp(Number(value) || 3.0, 1.2, 3.0);
  MAX_SCALE = next;
  if (cam.tscale > next) cam.tscale = next;
  if (cam.scale > next) cam.scale = next;
}

/** 世界坐标 → 屏幕坐标。 */
export function worldToScreen(x, y) {
  return {
    x: (x - cam.x) * cam.scale + view.w / 2,
    y: (y - cam.y) * cam.scale + view.h / 2
  };
}

/** 屏幕坐标 → 世界坐标。 */
export function screenToWorld(x, y) {
  return {
    x: (x - view.w / 2) / cam.scale + cam.x,
    y: (y - view.h / 2) / cam.scale + cam.y
  };
}

/** 保存前把相机目标写回当前值（用于序列化）。 */
export function readCam(saved) {
  cam.x = cam.tx = saved.x;
  cam.y = cam.ty = saved.y;
  cam.scale = cam.tscale = saved.scale;
}

/**
 * 适配视图：让全部节点落在可视区域内。
 * @param {Array<{x:number,y:number}>} nodes
 * @param {boolean} [animate]
 */
export function fitView(nodes, animate = true) {
  const pts = (nodes || []).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!pts.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of pts) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const narrow = view.w <= 900;
  const padL = narrow ? 46 : 100;
  const padR = narrow ? 46 : 100;
  const padT = narrow ? 108 : 122;
  const padB = narrow ? 88 : 102;
  const bw = Math.max(420, maxX - minX);
  const bh = Math.max(320, maxY - minY);
  const availW = Math.max(220, view.w - padL - padR);
  const availH = Math.max(220, view.h - padT - padB);
  const scale = clamp(Math.min(availW / bw, availH / bh), MIN_SCALE, 1.35);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // 与单文件旧版一致：内容中心对齐到扣除 padding 后的可视区中心
  const targetScreenX = padL + availW / 2;
  const targetScreenY = padT + availH / 2;
  animateTo(
    cx - (targetScreenX - view.w / 2) / scale,
    cy - (targetScreenY - view.h / 2) / scale,
    scale,
    animate
  );
}

/** 以屏幕点为锚缩放。 */
export function zoomAt(sx, sy, factor) {
  const next = clamp((cam.tscale || cam.scale) * factor, MIN_SCALE, MAX_SCALE);
  const before = screenToWorld(sx, sy);
  cam.tscale = next;
  // 用目标比例反推目标中心，保证锚点不动
  cam.tx = before.x - (sx - view.w / 2) / next;
  cam.ty = before.y - (sy - view.h / 2) / next;
}

/** 以屏幕中心缩放。 */
export function zoomCenter(factor) {
  zoomAt(view.w / 2, view.h / 2, factor);
}

/**
 * 面板实际占用的可视宽度（收起时为 0；避免窄屏把内容压没）。
 */
export function panelReserve() {
  if (!ui.panelOpen || ui.panelCollapsed) return 0;
  const w = Number.isFinite(ui.panelWidth) ? ui.panelWidth : 430;
  return Math.min(w, view.w * 0.62);
}

/**
 * 聚焦节点：把它放在左侧可视区中央（右侧留给面板）。
 * @param {{x:number,y:number}} node
 * @param {boolean} [reservePanel] 是否给面板留空间
 */
export function focusNode(node, reservePanel = true) {
  const W = view.w;
  const reserve = reservePanel ? panelReserve() : 0;
  let sx = W / 2;
  let scale = Math.max(cam.scale, 0.92);
  if (reserve > 0) {
    sx = Math.max(130, (W - reserve) / 2);
    scale = clamp(scale, 0.92, 1.35);
  }
  const sy = view.h / 2;
  animateTo(node.x - (sx - W / 2) / scale, node.y - (sy - view.h / 2) / scale, scale, true);
}

/** 局部图入口：保持整图可读的缩放，把被点节点放到屏幕中心。 */
export function focusLocalNode(node, animate = true) {
  if (!node) return;
  const W = view.w;
  const reserve = panelReserve();
  const narrow = W <= 900;
  const padL = narrow ? 46 : 100;
  const padR = (narrow ? 46 : 100) + reserve;
  const padT = narrow ? 108 : 122;
  const padB = narrow ? 88 : 102;
  const nodes = data ? data.nodes : [];
  if (!nodes.length) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const bw = Math.max(420, maxX - minX);
  const bh = Math.max(320, maxY - minY);
  const availW = Math.max(220, W - padL - padR);
  const availH = Math.max(220, view.h - padT - padB);
  const scale = clamp(Math.min(availW / bw, availH / bh), 0.6, 1.08);
  const sx = padL + availW / 2;
  const sy = padT + availH / 2;
  animateTo(node.x - (sx - W / 2) / scale, node.y - (sy - view.h / 2) / scale, scale, animate);
}

/** 局部标题图：按整张 focus 图适配，并给右侧面板留空间。 */
export function fitFocusView(nodes, animate = true) {
  const pts = (nodes || []).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!pts.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of pts) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const narrow = view.w <= 900;
  const reserve = panelReserve();
  const padL = narrow ? 42 : 92;
  const padR = (narrow ? 42 : 92) + reserve;
  const padT = narrow ? 108 : 118;
  const padB = narrow ? 86 : 96;
  const bw = Math.max(520, maxX - minX);
  const bh = Math.max(420, maxY - minY);
  const availW = Math.max(220, view.w - padL - padR);
  const availH = Math.max(220, view.h - padT - padB);
  const scale = clamp(Math.min(availW / bw, availH / bh), 0.28, 1.2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const targetScreenX = padL + availW / 2;
  const targetScreenY = padT + availH / 2;
  animateTo(
    cx - (targetScreenX - view.w / 2) / scale,
    cy - (targetScreenY - view.h / 2) / scale,
    scale,
    animate
  );
}

/**
 * 3D 层级居中：球心落在面板左侧可视区中央，并按高度适配。
 * @param {boolean} [animate]
 * @param {number} [radius] 球半径（外层 300 / 内层 250）
 */
export function center3DScene(animate = true, radius = 300) {
  const reserve = panelReserve();
  const availW = Math.max(260, view.w - reserve);
  const base = clamp(Math.min(availW / 780, view.h / 820), 0.46, 1.32);
  // 非球形骨架半径更大，用更大的视半径换算，再轻微推近，让形状铺满视野。
  const shaped = !!ui.shape && ui.shape !== 'sphere';
  const viewR = shaped ? 392 : 300;
  let scale = radius > 300 ? clamp((base * viewR) / radius, 0.36, 1.32) : base;
  if (shaped) scale = clamp(scale * 1.05, 0.4, 1.9);
  const cx = reserve / (2 * scale);
  const cy = (view.h * 0.02) / scale;
  animateTo(cx, cy, scale, animate);
}

/** 3D 缩放：锚定可视区中心，而不是整屏中心。 */
export function zoom3DCenter(factor) {
  const reserve = panelReserve();
  const sx = Math.max(120, (view.w - reserve) / 2);
  zoomAt(sx, view.h / 2, factor);
}

/**
 * 相机补间：每帧调用。
 * @param {number} dt 毫秒
 * @returns {boolean} 是否已稳定（可用于触发保存）
 */
export function stepCamera(dt) {
  // 时间常数约为旧值的 1.5 倍，整体相机转场更从容。
  const k = 1 - Math.pow(0.0034, dt / 1000);
  const dx = cam.tx - cam.x;
  const dy = cam.ty - cam.y;
  const ds = cam.tscale - cam.scale;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(ds) < 0.0001) {
    cam.x = cam.tx;
    cam.y = cam.ty;
    cam.scale = cam.tscale;
    return false;
  }
  cam.x += dx * k;
  cam.y += dy * k;
  cam.scale += ds * k;
  const settled = Math.abs(cam.tx - cam.x) < 0.6 && Math.abs(cam.ty - cam.y) < 0.6 && Math.abs(cam.tscale - cam.scale) < 0.0015;
  if (settled) {
    cam.x = cam.tx;
    cam.y = cam.ty;
    cam.scale = cam.tscale;
    return true;
  }
  return false;
}

/**
 * 平滑移动到目标。
 * @param {number} x
 * @param {number} y
 * @param {number} scale
 * @param {boolean} [animate]
 */
export function animateTo(x, y, scale, animate = true) {
  cam.tx = x;
  cam.ty = y;
  cam.tscale = clamp(scale, MIN_SCALE, MAX_SCALE);
  if (!animate) {
    cam.x = cam.tx;
    cam.y = cam.ty;
    cam.scale = cam.tscale;
  }
}

/** 立即把相机放到目标位置。 */
export function snapTo(x, y, scale) {
  animateTo(x, y, scale, false);
}

/** 相机序列化（三位小数）。 */
export function camState() {
  return {
    x: Math.round(cam.x * 10) / 10,
    y: Math.round(cam.y * 10) / 10,
    scale: Math.round(cam.scale * 1000) / 1000
  };
}