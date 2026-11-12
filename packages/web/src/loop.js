// 主循环：每帧推进相机补间、按温度推进力导向模拟、然后绘制。
import { simulateStep } from '@starmap/core';
import { data, index, scheduleSave } from './store.js';
import { cam, view, clock, flags, ui } from './state.js';
import { stepCamera } from './camera.js';
import { temperature, cool } from './layout.js';
import { tick } from './hierarchy.js';
import { updateAmbient } from './scene/ambient.js';
import { draw } from './scene/renderer.js';

let raf = 0;

/**
 * 开始渲染循环。
 * @param {CanvasRenderingContext2D|null} ctx
 * @param {{render:(t:number,dt:number)=>void}|null} gpu
 */
export function startLoop(ctx, gpu = null) {
  clock.last = performance.now();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, Math.max(0, now - clock.last));
    clock.last = now;
    clock.now = now;

    if (stepCamera(dt)) scheduleSave();

    if (ui.level === 'local' && !ui.focusGraph && temperature.alpha > 0.0005) {
      simulateStep(data, data.edges, index.categoryMap, temperature.alpha);
      cool(dt);
    }

    tick(dt);
    if (gpu) {
      gpu.render(now, dt);
    } else {
      updateAmbient(dt, now);
      draw(ctx, now, dt);
    }
  };
  raf = requestAnimationFrame(frame);
}

/** 停止循环（用于热更新/卸载）。 */
export function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}