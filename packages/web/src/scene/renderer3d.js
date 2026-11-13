// 3D 层级渲染：外层知识球 / 内部笔记球。
// 沿用 2D 的白光、冷蓝辉光与深空底色，不引入新的视觉语言。
import { TAU, clamp, hashStr, mod } from '@starmap/core';
import { cam, ui, view } from '../state.js';
import { worldToScreen } from '../camera.js';
import { drawSpace, drawVignette, drawGrain } from './space.js';
import { drawAmbient } from './ambient.js';
import {
  sceneVisuals,
  sceneEdges,
  innerSelectionSet
} from '../hierarchy.js';
import { edgeDefaultRgb, edgeIsMastered, edgeMasteredRgb, masteryRgb, rgba, scaledAppearance } from '../mastery.js';
import { drawIdleFlare } from './idle-fx.js';

const FONT =
  '"Segoe UI Variable Text","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

function innerDim(v) {
  if (ui.level !== 'inner' || !ui.innerSelection) return 1;
  if (v.id === ui.innerSelection) return 1;
  const set = innerSelectionSet(ui.innerSelection);
  return set && set.has(v.id) ? 0.72 : 0.16;
}

function outerDim(v) {
  if (ui.level !== 'sphere') return 1;
  let d = 1;
  if (ui.selection && v.id !== ui.selection) d *= 0.3;
  const hits = ui.searchHits || [];
  if (ui.searchTerm && hits.length && !hits.includes(v.id)) d *= 0.18;
  return d;
}

function dimOf(v) {
  return ui.level === 'inner' ? innerDim(v) : outerDim(v);
}

function isSelected(v) {
  return ui.level === 'inner' ? ui.innerSelection === v.id : ui.selection === v.id;
}

function isHovered(v) {
  return ui.hover && ui.hover.id === v.id;
}

/** 3D 主绘制 */
export function draw3D(ctx, t, dt) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawSpace(ctx, t, dt);
  drawAmbient(ctx, t);

  const visuals = sceneVisuals();
  const edges = sceneEdges(visuals);
  const sorted = visuals.slice().sort((a, b) => a.depth - b.depth);

  drawEdges3D(ctx, t, edges);
  drawHalos3D(ctx, t, sorted);
  drawCores3D(ctx, t, sorted);
  drawLabels3D(ctx, t, sorted);

  drawVignette(ctx);
  drawGrain(ctx);
}

function screenPos(v) {
  return worldToScreen(v.x, v.y);
}

/** 屏幕半径：越靠前越大，保留远景的细光点感。 */
function radiusOf(v) {
  const scale = 0.6 + v.depth * 0.7;
  return Math.max(1.7, v.r * cam.scale * scale);
}

function bornAge(v, t) {
  if (!ui.innerGraph || ui.level !== 'inner') return 1;
  const born = ui.innerGraph.born || 0;
  return clamp((t - born) / 620, 0, 1);
}

function drawEdges3D(ctx, t, edges) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const activeSel = ui.level === 'inner' ? ui.innerSelection : ui.selection;
  const labels = [];
  // 心跳光脉冲：连线跟着整片星海一起亮一点。
  const beat = 1 + (ui.idlePulse || 0) * 0.12;
  const style = scaledAppearance();

  for (const e of edges) {
    const pa = screenPos(e.pa);
    const pb = screenPos(e.pb);
    if (!visible(a => a, pa, pb)) continue;
    const active = activeSel && (e.a === activeSel || e.b === activeSel);
    const front = clamp((e.pa.depth + e.pb.depth) * 0.5, 0, 1);
    let alpha = (0.2 + front * 0.14) * (0.7 + front * 0.3);
    if (ui.level === 'inner') alpha *= 0.82;
    if (e.kind === 'chapter') alpha *= 0.58;
    if (e.kind === 'point') alpha *= 0.42;
    if (e.kind === 'topic') alpha *= 1.18;
    if (activeSel) alpha = active ? 0.58 : alpha * 0.2;
    if (ui.searchTerm && ui.level === 'sphere') alpha *= 0.25;
    alpha = clamp(alpha * style.edgeBrightness, 0, 0.66) * beat;
    const goldEdge = edgeIsMastered(e.pa.node, e.pb.node);
    const edgeRgb = goldEdge ? edgeMasteredRgb(e.pa.node, e.pb.node) : edgeDefaultRgb(e.pa.node, e.pb.node);

    ctx.strokeStyle = rgba(edgeRgb, goldEdge ? Math.min(0.34, alpha * 0.24) : alpha * 0.16);
    ctx.lineWidth = active ? 8 : 5.2;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();

    ctx.strokeStyle = rgba(edgeRgb, goldEdge ? Math.min(0.86, alpha * 1.08) : Math.min(1, alpha));
    ctx.lineWidth = active ? 1.45 : 0.95;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();

    if (active || (e.kind === 'inner-root' && front > 0.35)) {
      const seed = hashStr(e.a + e.b) % 1000;
      const p = mod(t * (active ? 0.0002 : 0.00007) + seed / 1000, 1);
      drawPulse(ctx, pa.x, pa.y, pb.x, pb.y, p, active ? alpha : Math.min(0.14, alpha * 0.7), active, edgeRgb);
    }
    const wantLabel =
      active ||
      (ui.level === 'sphere' && e.label && cam.scale > 1.45 && front > 0.72);
    if (wantLabel && e.label) labels.push({ e, pa, pb, active });
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 10.5px ${FONT}`;
  for (const l of labels) {
    const mx = (l.pa.x + l.pb.x) / 2;
    const my = (l.pa.y + l.pb.y) / 2;
    let ang = Math.atan2(l.pb.y - l.pa.y, l.pb.x - l.pa.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = `rgba(206,226,255,${l.active ? 0.72 : 0.42})`;
    ctx.fillText(l.e.label, 0, -7);
    ctx.restore();
  }
  ctx.restore();
}

function visible(_, pa, pb) {
  const pad = 100;
  return !(
    (pa.x < -pad && pb.x < -pad) ||
    (pa.x > view.w + pad && pb.x > view.w + pad) ||
    (pa.y < -pad && pb.y < -pad) ||
    (pa.y > view.h + pad && pb.y > view.h + pad)
  );
}

function drawPulse(ctx, ax, ay, bx, by, t, alpha, active, edgeRgb) {
  const fade = Math.sin(Math.PI * t);
  const a = alpha * fade * (active ? 0.9 : 0.6);
  if (a <= 0.01) return;
  const x = ax + (bx - ax) * t;
  const y = ay + (by - ay) * t;
  const rr = active ? 7 : 4.6;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
  g.addColorStop(0, rgba(edgeRgb.map((v) => Math.min(255, v + 45)), Math.min(1, a)));
  g.addColorStop(0.35, rgba(edgeRgb, a * 0.4));
  g.addColorStop(1, rgba(edgeRgb, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
}

function drawHalos3D(ctx, t, visuals) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 心跳光脉冲：光晕与星芒随主拍一起亮，幅度很小。
  const beat = 1 + (ui.idlePulse || 0) * 0.3;
  for (const v of visuals) {
    const dim = dimOf(v) * bornAge(v, t);
    if (dim < 0.02) continue;
    const p = screenPos(v);
    const active = isSelected(v);
    const hovered = isHovered(v);
    const rad = radiusOf(v);
    const rgb = masteryRgb(v.node);
    const a = (0.16 + v.depth * 0.2) * dim * (active ? 1.5 : hovered ? 1.25 : 1) * beat;
    const haloR = rad * (active ? 8.5 : 6.6) * (1 + (ui.idlePulse || 0) * 0.06);
    const g = ctx.createRadialGradient(p.x, p.y, rad * 0.1, p.x, p.y, haloR);
    g.addColorStop(0, rgba(rgb.map((x) => Math.min(255, x + 24)), Math.min(1, a * 2.3)));
    g.addColorStop(0.18, rgba(rgb, Math.min(1, a * 1.35)));
    g.addColorStop(0.48, rgba(rgb, a * 0.36));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, haloR, 0, TAU);
    ctx.fill();

    if (active || hovered || (v.kind === 'center' && cam.scale > 0.55)) {
      drawFlare(ctx, p.x, p.y, rad * (active ? 9 : 6), (active ? 0.55 : hovered ? 0.4 : 0.2) * dim * beat);
    } else {
      drawIdleFlare(ctx, p.x, p.y, rad, v.id, t, rgb, dim * (1 + (ui.idlePulse || 0) * 0.22), v.depth);
    }
  }
  ctx.restore();
}

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

  const vlen = len * 0.62;
  const v = ctx.createLinearGradient(x, y - vlen, x, y + vlen);
  v.addColorStop(0, 'rgba(170,205,255,0)');
  v.addColorStop(0.5, `rgba(245,250,255,${alpha * 0.78})`);
  v.addColorStop(1, 'rgba(170,205,255,0)');
  ctx.strokeStyle = v;
  ctx.beginPath();
  ctx.moveTo(x, y - vlen);
  ctx.lineTo(x, y + vlen);
  ctx.stroke();
}

function drawCores3D(ctx, t, visuals) {
  ctx.save();
  const beat = 1 + (ui.idlePulse || 0) * 0.12;
  for (const v of visuals) {
    const dim = dimOf(v) * bornAge(v, t) * beat;
    if (dim < 0.02) continue;
    const p = screenPos(v);
    const active = isSelected(v);
    const hovered = isHovered(v);
    const rad = radiusOf(v);
    const frontBoost = 0.72 + v.depth * 0.28;
    const rgb = masteryRgb(v.node);

    ctx.fillStyle = rgba(rgb, 0.86 * dim * frontBoost);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad + 0.9, 0, TAU);
    ctx.fill();

    ctx.fillStyle = rgba(rgb.map((x) => Math.min(255, x + 20)), 0.98 * dim * frontBoost);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.1, rad * 0.66), 0, TAU);
    ctx.fill();

    if (active) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0028);
      ctx.strokeStyle = `rgba(214,234,255,${0.16 + 0.2 * (1 - pulse)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad + 9 + pulse * 11, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(236,246,255,${0.24 + 0.18 * (1 - pulse)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad + 4 + pulse * 4, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const ang = t * 0.00035 + (i * TAU) / 3;
        const orbit = (rad + 15 + Math.sin(t * 0.0011 + i) * 3) * 0.6;
        ctx.fillStyle = 'rgba(255,255,255,0.76)';
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(ang) * orbit, p.y + Math.sin(ang) * orbit * 0.78, 1.3, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}



function drawLabels3D(ctx, t, visuals) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  const occupied = [];
  const ordered = [...visuals].sort((a, b) => {
    const pa = isSelected(a) || isHovered(a) ? 0 : a.kind === 'chapter' ? 2 : 1;
    const pb = isSelected(b) || isHovered(b) ? 0 : b.kind === 'chapter' ? 2 : 1;
    return pa - pb || b.depth - a.depth;
  });
  for (const v of ordered) {
    const active = isSelected(v);
    const hovered = isHovered(v);
    const dim = dimOf(v) * bornAge(v, t);
    if (dim < 0.04) continue;

    let show = true;
    let font = 12.5;
    if (ui.level === 'inner') {
      if (v.kind === 'center') font = 14.5;
      else if (v.kind === 'root') font = 12.2;
      else {
        font = 10.2;
        show = active || hovered || (ui.innerGraph && ui.innerGraph.nodes.length < 15);
      }
    } else if (v.kind === 'chapter') {
      font = active ? 11.6 : 9.6;
      // 二级模式需要看到章节名；只压掉背面的标签，保留正面的层级信息。
      if (v.depth < 0.14 && !active && !hovered) show = false;
    } else if (v.kind === 'point') {
      font = active ? 10.2 : 8.8;
      // 三级知识点数量多，只给前台且靠近屏幕中心的节点显示名字，避免刷屏。
      show = active || hovered || (v.depth > 0.72 && cam.scale > 1.05);
    } else {
      font = active ? 14.6 : 12.8;
      // 背面的标签降低存在感，但不消失，保留球体的纵深
      if (v.depth < 0.18 && !active && !hovered) show = false;
    }
    if (!show) continue;

    const p = screenPos(v);
    if (p.x < -80 || p.y < -80 || p.x > view.w + 80 || p.y > view.h + 80) continue;
    const rad = radiusOf(v);
    const ly = p.y + rad + (ui.level === 'inner' ? 10 : 11.5);
    const alpha = clamp(
      dim * (v.kind === 'chapter' ? 0.34 + v.depth * 0.58 : 0.55 + v.depth * 0.55),
      0.06,
      1
    );
    const text =
      v.kind === 'chapter' && !active && v.label.length > 18
        ? `${v.label.slice(0, 17)}…`
        : v.kind === 'point' && !active && v.label.length > 14
          ? `${v.label.slice(0, 13)}…`
          : v.label;
    ctx.font = `${active || v.kind === 'center' ? 600 : 400} ${font}px ${FONT}`;
    const labelW = ctx.measureText(text).width;
    const box = { l: p.x - labelW / 2 - 2, r: p.x + labelW / 2 + 2, t: ly - 2, b: ly + font + 2 };
    if (v.kind === 'chapter' && !active && !hovered) {
      // 二级章节很多，按前到后做一次简单避让，避免名字糊成一团
      if (occupied.some((r) => !(box.r < r.l || box.l > r.r || box.b < r.t || box.t > r.b))) continue;
    }
    occupied.push(box);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = `rgba(3,8,18,${0.64 * Math.min(1, alpha + 0.2)})`;
    ctx.strokeText(text, p.x, ly);
    const rgb = masteryRgb(v.node);
    ctx.shadowColor = rgba(rgb, 0.7);
    ctx.shadowBlur = 10;
    ctx.fillStyle = rgba(rgb.map((x) => Math.min(255, x + 8)), alpha);
    ctx.fillText(text, p.x, ly);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}