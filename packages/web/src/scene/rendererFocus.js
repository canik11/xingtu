// 局部 3D 关系图渲染：课程 / 章节为中心，向外铺开章节与知识点。
// 白发光、冷蓝辉光、深空底色与 3D 星海保持一致。
import { TAU, clamp, hashStr, mod } from '@starmap/core';
import { cam, view, ui } from '../state.js';
import { worldToScreen } from '../camera.js';
import { drawSpace, drawVignette, drawGrain } from './space.js';
import { drawAmbient } from './ambient.js';
import { getFocus, projectFocusNode } from '../focus.js';
import { edgeDefaultRgb, edgeIsMastered, edgeMasteredRgb, masteryRgb, rgba, scaledAppearance } from '../mastery.js';
import { drawIdleFlare } from './idle-fx.js';

const FONT =
  '"Segoe UI Variable Text","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

function bornScale(t) {
  const graph = getFocus();
  if (!graph || !graph.born) return 1;
  return 1 - Math.pow(1 - clamp((t - graph.born) / 620, 0, 1), 3);
}

function depthOf(n) {
  return projectFocusNode(n).depth;
}

function dimOf(n) {
  const depthFade = 0.38 + depthOf(n) * 0.62;
  if (!ui.selection || ui.selection === n.id) return depthFade;
  const graph = getFocus();
  if (!graph) return depthFade;
  for (const e of graph.edges) {
    if ((e.a === ui.selection && e.b === n.id) || (e.b === ui.selection && e.a === n.id)) {
      return 0.72 * depthFade;
    }
  }
  return 0.32 * depthFade;
}

function isSelected(n) {
  return ui.selection === n.id;
}

function isHovered(n) {
  return ui.hover && ui.hover.id === n.id;
}

function screenPos(n) {
  const p = projectFocusNode(n);
  return worldToScreen(p.x, p.y);
}

function radiusOf(n) {
  const d = depthOf(n);
  return Math.max(1.8, n.r * cam.scale * (0.74 + d * 0.5));
}

function drawOrder(graph) {
  return [...graph.nodes].sort((a, b) => depthOf(a) - depthOf(b));
}

/** 主绘制：背景与粒子都沿用原星空。 */
export function drawFocus(ctx, t, dt) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawSpace(ctx, t, dt);
  drawAmbient(ctx, t);

  const graph = getFocus();
  if (!graph) return;

  drawEdges(ctx, t, graph);
  const ordered = drawOrder(graph);
  drawHalos(ctx, t, graph, ordered);
  drawCores(ctx, t, graph, ordered);
  drawLabels(ctx, t, graph, ordered);

  drawVignette(ctx);
  drawGrain(ctx);
}

function drawEdges(ctx, t, graph) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const hoverEdge = ui.hoverEdge;
  const adjacency = new Set();
  if (ui.selection) {
    for (const e of graph.edges) {
      if (e.a === ui.selection) adjacency.add(e.b);
      if (e.b === ui.selection) adjacency.add(e.a);
    }
  }

  for (const e of graph.edges) {
    const pa = screenPos(e.pa);
    const pb = screenPos(e.pb);
    if (!onScreen(pa) && !onScreen(pb)) continue;

    const active =
      (ui.selection && (e.a === ui.selection || e.b === ui.selection)) ||
      (hoverEdge && hoverEdge.a === e.a && hoverEdge.b === e.b);
    let alpha = e.kind === 'topic' ? 0.36 : e.kind === 'course' ? 0.2 : 0.23;
    if (ui.selection) {
      alpha = active ? 0.62 : adjacency.has(e.a) || adjacency.has(e.b) ? alpha * 0.6 : alpha * 0.12;
    }
    const edgeDepth = Math.max(projectFocusNode(e.pa).depth, projectFocusNode(e.pb).depth);
    alpha *= 0.42 + edgeDepth * 0.58;
    if (e.kind === 'topic') alpha *= 1.15;
    if (ui.searchTerm) alpha *= 0.3;
    alpha *= scaledAppearance().edgeBrightness;
    const goldEdge = edgeIsMastered(e.pa.entity, e.pb.entity);
    const edgeRgb = goldEdge ? edgeMasteredRgb(e.pa.entity, e.pb.entity) : edgeDefaultRgb(e.pa.entity, e.pb.entity);

    const glow = active ? 8 : e.kind === 'topic' ? 6.5 : 6;
    // 外部节点的关系线统一画成虚线，和本节点的下级连线区分开。
    const dashed = e.pa.kind === 'external' || e.pb.kind === 'external';
    ctx.strokeStyle = rgba(edgeRgb, clamp(alpha * 0.22, 0, 0.3));
    ctx.lineWidth = glow;
    ctx.setLineDash(dashed ? [9, 7] : []);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();

    ctx.strokeStyle = rgba(edgeRgb, clamp(alpha * 1.05, 0, 0.78));
    ctx.lineWidth = active ? 1.5 : e.kind === 'topic' ? 1.15 : 0.95;
    ctx.setLineDash(dashed ? [9, 7] : e.kind === 'topic' ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (active) {
      const seed = hashStr(e.a + e.b) % 1000;
      const p = mod(t * 0.00022 + seed / 1000, 1);
      drawPulse(ctx, pa.x, pa.y, pb.x, pb.y, p, 0.6, edgeRgb);
    }
  }
  ctx.restore();

  // 关系标签：只画当前选中或悬停的边，避免局部图被文字淹没。
  const labelEdge = hoverEdge || (ui.selection ? graph.edges.find((e) => e.a === ui.selection || e.b === ui.selection) : null);
  if (labelEdge && labelEdge.label) {
    const pa = screenPos(labelEdge.pa);
    const pb = screenPos(labelEdge.pb);
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2 - 8;
    ctx.save();
    ctx.font = `400 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(labelEdge.label).width + 14;
    ctx.fillStyle = 'rgba(3,8,18,.72)';
    roundRect(ctx, mx - w / 2, my - 9, w, 18, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(226,240,255,.86)';
    ctx.fillText(labelEdge.label, mx, my + 0.5);
    ctx.restore();
  }
}

function drawHalos(ctx, t, graph, ordered) {
  const age = bornScale(t);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const n of ordered) {
    const p = screenPos(n);
    if (!onScreen(p)) continue;
    const selected = isSelected(n) || isHovered(n);
    const dim = dimOf(n);
    const r = radiusOf(n);
    const rgb = masteryRgb(n.entity);
    const halo = r * (selected ? 9 : 7.2);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, halo);
    g.addColorStop(0, rgba(rgb, 0.26 * dim * age));
    g.addColorStop(0.38, rgba(rgb, 0.12 * dim * age));
    g.addColorStop(0.72, rgba(rgb, 0.04 * dim * age));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, halo, 0, TAU);
    ctx.fill();

    if (selected) {
      const pulse = (Math.sin(t * 0.0026) + 1) / 2;
      ctx.strokeStyle = rgba(rgb, 0.28 + pulse * 0.22);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2 + pulse * 3.2, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(rgb, 0.16 + pulse * 0.14);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.3 + pulse * 5, 0, TAU);
      ctx.stroke();
    } else {
      drawIdleFlare(ctx, p.x, p.y, r, n.id, t, rgb, dim * age);
    }
  }
  ctx.restore();
}

function drawCores(ctx, t, graph, ordered) {
  const age = bornScale(t);
  for (const n of ordered) {
    const p = screenPos(n);
    if (!onScreen(p)) continue;
    const dim = dimOf(n) * age;
    const r = radiusOf(n);
    const selected = isSelected(n);
    const rgb = masteryRgb(n.entity);
    const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r * 1.7);
    g.addColorStop(0, `rgba(255,255,255,${0.96 * dim})`);
    g.addColorStop(0.45, rgba(rgb, 0.82 * dim));
    g.addColorStop(1, rgba(rgb, 0.12 * dim));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.65, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(rgb.map((v) => Math.min(255, v + 18)), 0.94 * dim);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.2, r * 0.62), 0, TAU);
    ctx.fill();
    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.24, p.y - r * 0.26, Math.max(0.9, r * 0.2), 0, TAU);
      ctx.fill();
    }
  }
}



function drawLabels(ctx, t, graph, ordered) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const age = bornScale(t);
  const placed = [];
  for (const n of ordered) {
    const p = screenPos(n);
    if (!onScreen(p, 40)) continue;
    const depth = depthOf(n);
    const selected = isSelected(n) || isHovered(n);
    const external = n.kind === 'external';
    // 背面节点不抢正面的标签；章节视图的三级知识点和跨层级端点例外，保证名字可见。
    if (depth < 0.16 && !selected && !(graph.level === 2 && n.kind === 'point') && !external) continue;
    // 进入二级章节后必须直接看到三级知识点的名字；课程总图仍按缩放控制密度。
    if (n.kind === 'point' && !selected && graph.level !== 2 && cam.scale < 1.35) continue;
    const dim = dimOf(n) * age * (external ? 0.9 : 1);
    const size = external
      ? 9.8
      : (n.kind === 'course' ? Math.max(12, Math.min(18, 14 * cam.scale)) : n.kind === 'chapter' ? 10.8 : 10.2) *
        (0.86 + depth * 0.22);
    const placeAbove = external && p.y > view.h * 0.72;
    let y = placeAbove ? p.y - radiusOf(n) - 12 : p.y + radiusOf(n) + (n.kind === 'course' ? 16 : 11);
    ctx.font = `${n.kind === 'course' ? 600 : 400} ${size}px ${FONT}`;
    const w = ctx.measureText(n.label).width;
    const labelX = external
      ? Math.max(w / 2 + 7, Math.min(view.w - w / 2 - 7, p.x))
      : p.x;
    if (n.kind === 'course' || n.kind === 'chapter' || external || (n.kind === 'point' && graph.level === 2)) {
      let guard = 0;
      while (guard++ < 9 && placed.some((r) => Math.abs((r.y + r.h / 2) - y) < r.h + 3 && Math.abs((r.x + r.w / 2) - labelX) < (r.w + w) / 2)) {
        y += size + 3;
      }
      placed.push({ x: labelX - w / 2, y: y - size / 2, w, h: size + 2 });
    }
    ctx.shadowColor = 'rgba(3,8,18,.9)';
    ctx.shadowBlur = 7;
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(3,8,18,${0.72 * dim})`;
    ctx.strokeText(n.label, labelX, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(masteryRgb(n.entity), (selected ? 0.98 : external ? 0.62 : 0.76) * dim);
    ctx.fillText(n.label, labelX, y);
  }
  ctx.restore();
}

function drawPulse(ctx, ax, ay, bx, by, p, alpha, edgeRgb) {
  const x = ax + (bx - ax) * p;
  const y = ay + (by - ay) * p;
  const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
  g.addColorStop(0, rgba(edgeRgb.map((v) => Math.min(255, v + 45)), alpha));
  g.addColorStop(1, rgba(edgeRgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, TAU);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function onScreen(p, margin = 30) {
  return p.x > -margin && p.x < view.w + margin && p.y > -margin && p.y < view.h + margin;
}