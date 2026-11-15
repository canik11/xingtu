// 场景转场：节点位置插值 + 圆形遮罩/整体缩放的开场与层级切换。
// 状态挂在 ui.sceneFx / ui.transition 上，渲染层每帧读取。
import { clamp } from '@starmap/core';
import { ui, view } from '../state.js';

export const TRANSITION_DUR = 1140;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * 开始一次场景转场。
 * from / screenFrom 都是 Map<id, {x,y}> 的屏幕坐标；优先 screenFrom（WebGL），
 * from 作为 Canvas 2D 回退路径的世界坐标兼容字段。
 */
export function startTransition({ kind, origin, from = null, screenFrom = null, dur = TRANSITION_DUR } = {}) {
  const now = performance.now();
  const at = origin || { x: view.w / 2, y: view.h / 2 };
  ui.sceneFx = {
    kind: kind || 'enter',
    origin: { x: at.x, y: at.y },
    start: now,
    dur: Math.max(1, dur)
  };
  const map = from || screenFrom;
  ui.transition = map && map.size
    ? { from: from || new Map(), screenFrom: screenFrom || null, start: now, dur: Math.max(1, dur) }
    : null;
}

/** 当前转场进度；结束后返回 null（调用方负责清理 ui.sceneFx）。 */
export function transitionAt(now) {
  const fx = ui.sceneFx;
  if (!fx) return null;
  const raw = (now - fx.start) / fx.dur;
  const t = clamp(raw, 0, 1);
  return {
    kind: fx.kind,
    origin: fx.origin,
    raw,
    t,
    eased: easeOutCubic(t),
    done: raw >= 1
  };
}

export function endTransition() {
  ui.sceneFx = null;
  ui.transition = null;
}

/** 把某个节点的目标屏幕位置与转场起点混合；返回 null 表示不需要混合。 */
export function transitionPoint(id, x, y, now) {
  const tr = ui.transition;
  if (!tr) return null;
  const raw = (now - tr.start) / tr.dur;
  if (raw >= 1) {
    ui.transition = null;
    return null;
  }
  const from = (tr.screenFrom && tr.screenFrom.get(id)) || (tr.from && tr.from.get(id));
  if (!from) return null;
  const e = easeOutCubic(clamp(raw, 0, 1));
  return {
    x: from.x + (x - from.x) * e,
    y: from.y + (y - from.y) * e
  };
}

/** 从 origin 扩散到覆盖整个视口所需的半径。 */
export function coverRadius(origin) {
  const dx = Math.max(origin.x, view.w - origin.x);
  const dy = Math.max(origin.y, view.h - origin.y);
  return Math.hypot(dx, dy) + 48;
}

/** 开场大爆炸：遮罩从中心展开，图整体略微推近。 */
export function startIntroTransition(dur = 1500) {
  startTransition({
    kind: 'intro',
    origin: { x: view.w / 2, y: view.h / 2 },
    dur
  });
}