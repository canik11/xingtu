// 画布渲染：分类标题 → 关系光丝 → 节点光晕 → 节点核心 → 标签 → 后处理。
// 只读状态，不写业务数据；所有动画都由时间 t 驱动。
// 关键数值与首版单文件一一对应，改动前请先对照 legacy/starmap-single-file.html。
import { CATEGORY_COLORS, TAU, clamp, hashStr, mod } from '@starmap/core';
import { data, index } from '../store.js';
import { cam, view, ui } from '../state.js';
import { worldToScreen } from '../camera.js';
import { drawSpace, drawVignette, drawGrain } from './space.js';
import { drawAmbient } from './ambient.js';
import { draw3D } from './renderer3d.js';
import { drawFocus } from './rendererFocus.js';
import { transitionAt, endTransition } from './transition.js';
import { getLevel } from '../hierarchy.js';

const FONT =
  '"Segoe UI Variable Text","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

/** 分类颜色：按索引循环取淡色（面板 chip 用）。 */
export function catColor(catId) {
  const i = data.categories.findIndex((c) => c.id === catId);
  return CATEGORY_COLORS[(i < 0 ? 0 : i) % CATEGORY_COLORS.length];
}

export function catTint(catId) {
  return catColor(catId);
}

/** 节点半径（按度数，与 core 的 rebuild 一致）。 */
export function nodeRadius(node) {
  return node.r || 3.9 + Math.min(node.deg || 0, 7) * 0.46;
}

/** 节点在屏幕上的半径（最小 2.2px）。 */
function screenRadius(node) {
  return Math.max(2.2, nodeRadius(node) * cam.scale);
}

/** 入场动画缓动后的缩放比（born 后 650ms 内渐变）。 */
function bornScale(node, t) {
  if (!node.born) return 1;
  const age = clamp((t - node.born) / 650, 0, 1);
  return 1 - Math.pow(1 - age, 3);
}

let cachedSelSet = null;
let cachedSelId = undefined;
function selectionSet() {
  if (cachedSelId === ui.selection) return cachedSelSet;
  cachedSelId = ui.selection;
  cachedSelSet = ui.selection ? index.selectionSetOf(ui.selection) : null;
  return cachedSelSet;
}

/** 节点亮度系数：选中/搜索时压暗无关节点。 */
function nodeDim(n) {
  let d = 1;
  const selSet = selectionSet();
  if (ui.selection && ui.selection !== n.id && selSet && !selSet.has(n.id)) d *= 0.3;
  const hits = ui.searchHits;
  if (ui.searchTerm && hits && hits.length && !hits.includes(n.id)) d *= 0.22;
  return d;
}

/** 局部图节点的绘制坐标：从 3D 摊平过来时做一次位置插值。 */
export function nodeDrawPos(n, t) {
  const tr = ui.transition;
  if (!tr) return n;
  const age = clamp((t - tr.start) / tr.dur, 0, 1);
  const from = tr.from.get(n.id);
  if (!from) return n;
  if (age >= 1) {
    ui.transition = null;
    return n;
  }
  const ease = 1 - Math.pow(1 - age, 3);
  return {
    x: from.x + (n.x - from.x) * ease,
    y: from.y + (n.y - from.y) * ease
  };
}

/** 主绘制函数。 */
export function draw(ctx, t, dt) {
  // WebGL 路径由 gl-scene.updateFx 清理；Canvas 2D 回退时在这里收尾。
  if (ui.sceneFx) {
    const fx = transitionAt(t);
    if (!fx || fx.done) endTransition();
  }
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  if (getLevel() !== 'local') {
    draw3D(ctx, t, dt);
    return;
  }

  if (ui.focusGraph) {
    drawFocus(ctx, t, dt);
    return;
  }

  drawSpace(ctx, t, dt);
  drawAmbient(ctx, t);
  drawCategoryLabels(ctx, t);
  drawEdges(ctx, t);
  drawNodeHalos(ctx, t);
  drawNodeCores(ctx, t);
  drawNodeLabels(ctx, t);
  drawVignette(ctx);
  drawGrain(ctx);
}

/** 分类标题：居中、字距 5px，随缩放淡入。 */
function drawCategoryLabels(ctx, t) {
  if (cam.scale < 0.38) return;
  const baseAlpha = 0.235 * clamp((cam.scale - 0.38) / 0.5, 0, 1);
  if (baseAlpha <= 0.005) return;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(120,165,255,.5)';
  ctx.shadowBlur = 13;
  for (const c of data.categories) {
    const members = index.membersOf(c.id);
    if (!members.length) continue;
    let minY = Infinity;
    let sumX = 0;
    for (const n of members) {
      const np = nodeDrawPos(n, t);
      minY = Math.min(minY, np.y);
      sumX += np.x;
    }
    const p = worldToScreen(sumX / members.length, minY);
    const x = clamp(p.x, 100, view.w - 100);
    const y = clamp(p.y - 38, 104, view.h - 100);
    const size = Math.round(clamp(24 * cam.scale, 14, 26));
    ctx.font = `500 ${size}px ${FONT}`;
    const chars = Array.from(c.name);
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const spacing = 5;
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = x - total / 2;
    ctx.fillStyle = `rgba(196,218,255,${baseAlpha})`;
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cx, y);
      cx += widths[i] + spacing;
    }
  }
  ctx.restore();
}

/** 关系光丝：外辉光 + 主线 + 沿线光脉冲 + 关系标签。 */
function drawEdges(ctx, t) {
  const sel = ui.selection;
  const hasSel = !!sel;
  const hoverEdge = ui.hoverEdge;
  const hits = ui.searchHits || [];
  const searchActive = !!(ui.searchTerm && hits.length);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const activeLabels = [];

  for (const e of data.edges) {
    const A = index.getNode(e.a);
    const B = index.getNode(e.b);
    if (!A || !B) continue;
    const active = hasSel && (e.a === sel || e.b === sel);
    const hovered =
      hoverEdge && ((e.a === hoverEdge.a && e.b === hoverEdge.b) || (e.a === hoverEdge.b && e.b === hoverEdge.a));
    let alpha = 0.235;
    if (hasSel) alpha = active ? 0.64 : 0.028;
    if (hovered && !hasSel) alpha = 0.48;
    if (searchActive && !(hits.includes(e.a) && hits.includes(e.b))) alpha = Math.min(alpha, 0.028);
    if (active) alpha += 0.05 * Math.sin(t * 0.0035 + (hashStr(e.a + e.b) % 628) / 100);
    alpha = clamp(alpha, 0, 0.78);

    const A2 = nodeDrawPos(A, t);
    const B2 = nodeDrawPos(B, t);
    const pa = worldToScreen(A2.x, A2.y);
    const pb = worldToScreen(B2.x, B2.y);
    if (!segmentVisible(pa, pb)) continue;

    ctx.strokeStyle = `rgba(150,192,255,${alpha * 0.15})`;
    ctx.lineWidth = active ? 9 : 6;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();

    ctx.strokeStyle = `rgba(228,242,255,${alpha})`;
    ctx.lineWidth = active ? 1.5 : 1.05;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();

    const seed = hashStr(e.a + e.b) % 1000;
    const baseSpeed = active ? 0.00022 : 0.000075;
    const p = mod(t * baseSpeed + seed / 1000, 1);
    drawEdgePulse(ctx, pa.x, pa.y, pb.x, pb.y, p, active ? alpha : Math.min(alpha * 0.75, 0.16), active);
    if (active) drawEdgePulse(ctx, pa.x, pa.y, pb.x, pb.y, mod(p + 0.5, 1), alpha, true);

    if (active || hovered) activeLabels.push({ key: e.a + '|' + e.b, label: e.label, pa, pb, active });
  }
  ctx.globalCompositeOperation = 'source-over';

  // 关系标签：仅选中/悬停，或放大到 0.95 且未搜索时显示
  const labels = [];
  const wanted = new Map(activeLabels.map((l) => [l.key, l]));
  if (cam.scale > 0.95 && !ui.searchTerm) {
    for (const e of data.edges) {
      const key = e.a + '|' + e.b;
      if (wanted.has(key)) continue;
      if (hasSel && e.a !== sel && e.b !== sel) continue;
      const A = index.getNode(e.a);
      const B = index.getNode(e.b);
      if (!A || !B) continue;
      const A2 = nodeDrawPos(A, t);
      const B2 = nodeDrawPos(B, t);
      wanted.set(key, {
        key,
        label: e.label,
        pa: worldToScreen(A2.x, A2.y),
        pb: worldToScreen(B2.x, B2.y),
        active: false
      });
    }
  }
  for (const l of activeLabels) labels.push(l);
  for (const l of wanted.values()) if (!l.active) labels.push(l);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 11px ${FONT}`;
  for (const l of labels) {
    const text = l.label || '相关';
    const mx = (l.pa.x + l.pb.x) / 2;
    const my = (l.pa.y + l.pb.y) / 2;
    let ang = Math.atan2(l.pb.y - l.pa.y, l.pb.x - l.pa.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = `rgba(206,226,255,${l.active ? 0.78 : 0.6})`;
    ctx.fillText(text, 0, -8);
    ctx.restore();
  }
  ctx.restore();
}

function drawEdgePulse(ctx, ax, ay, bx, by, t, alpha, active) {
  const fade = Math.sin(Math.PI * t);
  const a = alpha * fade * (active ? 0.9 : 0.55);
  if (a <= 0.008) return;
  const x = ax + (bx - ax) * t;
  const y = ay + (by - ay) * t;
  const rr = active ? 7 : 5;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
  g.addColorStop(0, `rgba(242,249,255,${Math.min(1, a)})`);
  g.addColorStop(0.35, `rgba(190,222,255,${a * 0.35})`);
  g.addColorStop(1, 'rgba(140,185,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
}

function segmentVisible(pa, pb) {
  const pad = 120;
  return !(
    (pa.x < -pad && pb.x < -pad) ||
    (pa.x > view.w + pad && pb.x > view.w + pad) ||
    (pa.y < -pad && pb.y < -pad) ||
    (pa.y > view.h + pad && pb.y > view.h + pad)
  );
}

/** 节点光晕 + 十字星芒 + 选中脉冲环。 */
function drawNodeHalos(ctx, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const n of data.nodes) {
    const dim = nodeDim(n);
    if (dim < 0.02) continue;
    const active = ui.selection === n.id;
    const hovered = ui.hover && ui.hover.id === n.id;
    const np = nodeDrawPos(n, t);
    const s = worldToScreen(np.x, np.y);
    const rad = screenRadius(n);
    const age = bornScale(n, t);
    if (age <= 0) continue;
    const boost = active ? 1.7 : hovered ? 1.3 : 1;
    const haloR = rad * (active ? 9 : 7.2);
    const a = 0.26 * dim * boost * age;
    const g = ctx.createRadialGradient(s.x, s.y, rad * 0.15, s.x, s.y, haloR);
    g.addColorStop(0, `rgba(255,255,255,${Math.min(1, a * 2.35)})`);
    g.addColorStop(0.16, `rgba(226,241,255,${Math.min(1, a * 1.4)})`);
    g.addColorStop(0.45, `rgba(150,190,255,${a * 0.4})`);
    g.addColorStop(1, 'rgba(90,135,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, haloR, 0, TAU);
    ctx.fill();

    if (active || hovered || (n.deg >= 5 && cam.scale > 0.55)) {
      drawFlare(ctx, s.x, s.y, rad * (active ? 9 : 6.2), (active ? 0.62 : hovered ? 0.42 : 0.2) * dim * age);
    }
  }

  // 选中脉冲环与环绕光点
  const selNode = ui.selection ? index.getNode(ui.selection) : null;
  if (selNode) {
    const sp = nodeDrawPos(selNode, t);
    const s = worldToScreen(sp.x, sp.y);
    const rad = screenRadius(selNode);
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.0028);
    ctx.strokeStyle = `rgba(214,234,255,${0.16 + 0.2 * (1 - pulse)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rad + 10 + pulse * 12, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(236,246,255,${0.24 + 0.18 * (1 - pulse)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rad + 4 + pulse * 4, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const ang = t * 0.00035 + (i * TAU) / 3;
      const orbit = (rad + 16 + Math.sin(t * 0.0011 + i) * 3) * 0.6;
      const ox = s.x + Math.cos(ang) * orbit;
      const oy = s.y + Math.sin(ang) * orbit * 0.72;
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.beginPath();
      ctx.arc(ox, oy, 1.4, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 十字星芒：水平长、垂直短。 */
function drawFlare(ctx, x, y, len, alpha) {
  if (alpha <= 0.008) return;
  const h = ctx.createLinearGradient(x - len, y, x + len, y);
  h.addColorStop(0, 'rgba(170,205,255,0)');
  h.addColorStop(0.5, `rgba(245,250,255,${alpha})`);
  h.addColorStop(1, 'rgba(170,205,255,0)');
  ctx.strokeStyle = h;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - len, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();

  const vlen = len * 0.68;
  const v = ctx.createLinearGradient(x, y - vlen, x, y + vlen);
  v.addColorStop(0, 'rgba(170,205,255,0)');
  v.addColorStop(0.5, `rgba(245,250,255,${alpha * 0.8})`);
  v.addColorStop(1, 'rgba(170,205,255,0)');
  ctx.strokeStyle = v;
  ctx.beginPath();
  ctx.moveTo(x, y - vlen);
  ctx.lineTo(x, y + vlen);
  ctx.stroke();
}

/** 节点核心：两圈实心白点，选中时多一圈柔光。 */
function drawNodeCores(ctx, t) {
  ctx.save();
  for (const n of data.nodes) {
    const dim = nodeDim(n);
    if (dim < 0.02) continue;
    const active = ui.selection === n.id;
    const np = nodeDrawPos(n, t);
    const s = worldToScreen(np.x, np.y);
    const age = bornScale(n, t);
    if (age <= 0) continue;
    const rad = screenRadius(n) * (0.35 + age * 0.65);

    ctx.fillStyle = `rgba(230,243,255,${0.86 * dim})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rad + 0.9, 0, TAU);
    ctx.fill();

    ctx.fillStyle = `rgba(255,255,255,${0.98 * dim})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(1.25, rad * 0.66), 0, TAU);
    ctx.fill();

    if (active) {
      ctx.fillStyle = `rgba(255,255,255,${0.13 + 0.07 * Math.sin(t * 0.004)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad + 3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 节点名称：深色描边 + 冷色光晕，固定在节点下方。 */
function drawNodeLabels(ctx, t) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of data.nodes) {
    const active = ui.selection === n.id;
    const hovered = ui.hover && ui.hover.id === n.id;
    if (cam.scale < 0.46 && !active && !hovered) continue;
    const dim = nodeDim(n);
    if (dim < 0.02) continue;
    const np = nodeDrawPos(n, t);
    const s = worldToScreen(np.x, np.y);
    if (s.x < -80 || s.y < -80 || s.x > view.w + 80 || s.y > view.h + 80) continue;
    const age = bornScale(n, t);
    if (age <= 0) continue;
    const rad = screenRadius(n);
    const ly = s.y + rad + 12.5;
    ctx.font = `${active ? 600 : 400} ${active ? 14.5 : 13.5}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(3,8,18,.68)';
    ctx.strokeText(n.name, s.x, ly);
    ctx.shadowColor = 'rgba(162,202,255,.78)';
    ctx.shadowBlur = 11;
    ctx.fillStyle = `rgba(238,247,255,${Math.min(1, dim + 0.3) * age})`;
    ctx.fillText(n.name, s.x, ly);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}