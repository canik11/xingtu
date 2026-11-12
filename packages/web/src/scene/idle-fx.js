// 静默状态下的节点微特效：呼吸星芒 + 柔光，不复制选中态的双层脉冲环/环绕光点。
import { ui } from '../state.js';
import { rgba } from '../mastery.js';

function hashId(id) {
  let h = 2166136261;
  const text = String(id || '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function ray(ctx, x, y, angle, len, color, alpha) {
  if (alpha <= 0.008) return;
  const dx = Math.cos(angle) * len;
  const dy = Math.sin(angle) * len;
  const g = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.strokeStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - dx, y - dy);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
}

/**
 * 在节点外围画缓慢闪烁的四芒星。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} r 节点半径
 * @param {string} id 用于错开每颗星的相位
 * @param {number} t 毫秒时间
 * @param {number[]} rgb 节点当前颜色（白/金）
 * @param {number} dim 层级带来的亮度
 * @param {number} depth 3D 纵深
 */
export function drawIdleFlare(ctx, x, y, r, id, t, rgb, dim, depth = 1) {
  const seed = hashId(id);
  const tw = 0.5 + 0.5 * Math.sin(t * (0.0011 + seed * 0.0007) + seed * 6.283);
  const still = !ui.idleModes.rotate && !ui.idleModes.breathe && !ui.idleModes.puff;
  const amp = dim * (0.55 + depth * 0.45) * (still ? 0.6 : 1);
  const alpha = (0.2 + tw * 0.2) * amp;
  if (alpha < 0.012) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1;

  const long = r * (4.5 + tw * 2.2);
  const short = r * (2.6 + tw * 1.4);
  ray(ctx, x, y, 0, long, rgb, alpha);
  ray(ctx, x, y, Math.PI / 2, long, rgb, alpha * 0.92);
  ctx.lineWidth = 0.7;
  ray(ctx, x, y, Math.PI / 4, short, rgb, alpha * 0.8);
  ray(ctx, x, y, -Math.PI / 4, short, rgb, alpha * 0.8);

  // 比常态 halo 更大、更淡的一层呼吸光，周期与星芒同步。
  const haloR = r * (3.8 + tw * 0.8);
  const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, haloR);
  halo.addColorStop(0, rgba(rgb, 0.08 * amp));
  halo.addColorStop(0.55, rgba(rgb, 0.035 * amp));
  halo.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}