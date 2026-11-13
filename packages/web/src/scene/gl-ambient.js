// WebGL 白色荧光粒子：悬停聚拢、拖动留痕、点击绽开。
import { Container, Sprite } from 'pixi.js';
import { clamp, TAU } from '@starmap/core';
import { view } from '../state.js';
import { flareTexture, pulseRingTexture, sparkTexture, starRingTexture } from './gl-textures.js';

const PARTICLE_COUNT = 240;
const PARTICLE_POOL = Math.ceil(PARTICLE_COUNT * 3.0);
const MAX_SPARKS = 180;

export class GLAmbient {
  constructor() {
    this.root = new Container();
    this.root.eventMode = 'none';
    this.particleLayer = new Container();
    this.sparkLayer = new Container();
    this.rippleLayer = new Container();
    this.root.addChild(this.particleLayer, this.sparkLayer, this.rippleLayer);

    this.particles = [];
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const s = new Sprite(sparkTexture());
      s.anchor.set(0.5);
      s.blendMode = 'normal';
      s.tint = 0xffffff;
      this.particleLayer.addChild(s);
      this.particles.push({
        u: Math.random(),
        v: Math.random(),
        z: 0.25 + Math.random() * 0.75,
        r: 0.7 + Math.random() * 2.2,
        a: 0.16 + Math.random() * 0.24,
        vx: (Math.random() - 0.5) * 0.016,
        vy: (Math.random() - 0.5) * 0.012,
        ph: Math.random() * TAU,
        tw: 0.25 + Math.random() * 0.9,
        s
      });
    }

    this.sparks = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = new Sprite(sparkTexture());
      s.anchor.set(0.5);
      s.blendMode = 'normal';
      s.visible = false;
      this.sparkLayer.addChild(s);
      this.sparks.push({ s, life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, r: 1 });
    }

    this.ripples = [];
    for (let i = 0; i < 9; i++) {
      const s = new Sprite(starRingTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.rippleLayer.addChild(s);
      this.ripples.push({ s, life: 0, max: 1, delay: 0, size0: 12, size1: 180, alpha0: 0.8, x: 0, y: 0, curve: 'fade' });
    }

    // 心跳涟漪单独一组：细柔光弧，绝不复用带星芒的点击星环。
    this.pulseRipples = [];
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(pulseRingTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.rippleLayer.addChild(s);
      this.pulseRipples.push({ s, life: 0, max: 1, delay: 0, size0: 12, size1: 180, alpha0: 0.8, x: 0, y: 0, curve: 'fade' });
    }

    this.burstStars = [];
    for (let i = 0; i < 2; i++) {
      const s = new Sprite(flareTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.rippleLayer.addChild(s);
      this.burstStars.push({ s, life: 0, max: 1, x: 0, y: 0 });
    }

    this.pointer = {
      x: -9999,
      y: -9999,
      active: false,
      down: false,
      downX: 0,
      downY: 0,
      lastX: 0,
      lastY: 0,
      downAt: 0,
      moved: false
    };
    this.bound = false;
    this.lastSpawn = 0;
    this.setDensity(1);
  }

  /** 环境粒子密度：1 = 默认；0.2–3.0 对应画质面板的 20%–300%。 */
  setDensity(value) {
    this.particleDensity = clamp(Number(value) || 1, 0.2, 3.0);
    const count = Math.min(this.particles.length, Math.round(PARTICLE_COUNT * this.particleDensity));
    this.particles.forEach((p, i) => {
      p.s.visible = i < count;
    });
  }

  bind(stage) {
    if (this.bound || !stage) return;
    this.bound = true;
    const local = (e) => {
      const x = e.clientX;
      const y = e.clientY;
      return { x, y };
    };
    stage.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.active = true;
      if (this.pointer.down) {
        const dx = p.x - this.pointer.lastX;
        const dy = p.y - this.pointer.lastY;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) this.pointer.moved = true;
        if (d > 7 && performance.now() - this.lastSpawn > 24) {
          this.lastSpawn = performance.now();
          this.spawnSpark(p.x, p.y, -dx * 0.09, -dy * 0.09, 1.2 + Math.random() * 1.6, 340 + Math.random() * 260);
        }
        this.pointer.lastX = p.x;
        this.pointer.lastY = p.y;
      }
    });
    stage.addEventListener('pointerdown', (e) => {
      const p = local(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.active = true;
      this.pointer.down = true;
      this.pointer.downX = p.x;
      this.pointer.downY = p.y;
      this.pointer.lastX = p.x;
      this.pointer.lastY = p.y;
      this.pointer.downAt = performance.now();
      this.pointer.moved = false;
    });
    stage.addEventListener('pointerup', (e) => {
      const p = local(e);
      const quick = performance.now() - this.pointer.downAt < 620;
      const dist = Math.hypot(p.x - this.pointer.downX, p.y - this.pointer.downY);
      if (this.pointer.down && quick && dist < 7) {
        this.burst(p.x, p.y);
      }
      this.pointer.down = false;
    });
    stage.addEventListener('pointerleave', () => {
      this.pointer.active = false;
      this.pointer.down = false;
    });
    window.addEventListener('pointerup', () => {
      this.pointer.down = false;
    });
    window.addEventListener('pointercancel', () => {
      this.pointer.down = false;
    });
  }

  spawnSpark(x, y, vx, vy, r, life) {
    const s = this.sparks.find((item) => item.life <= 0);
    if (!s) return;
    s.life = life;
    s.max = life;
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.r = r;
    s.s.visible = true;
  }

  spawnRing(x, y, delay, size0, size1, duration, alpha0, tint = 0xffffff, curve = 'fade') {
    const ring = this.ripples.find((item) => item.life <= 0);
    if (!ring) return;
    ring.life = duration + delay;
    ring.max = duration + delay;
    ring.delay = delay;
    ring.size0 = size0;
    ring.size1 = size1;
    ring.alpha0 = alpha0;
    ring.curve = curve;
    ring.x = x;
    ring.y = y;
    ring.s.visible = false;
    ring.s.position.set(x, y);
    ring.s.tint = tint;
  }

  /** 心跳涟漪：细柔光弧，从轮廓向外荡开；没有星芒，不会糊成光带。 */
  spawnPulseRing(x, y, size0, size1, duration, alpha0, tint = 0xffffff) {
    const ring = this.pulseRipples.find((item) => item.life <= 0);
    if (!ring) return;
    ring.life = duration;
    ring.max = duration;
    ring.delay = 0;
    ring.size0 = size0;
    ring.size1 = size1;
    ring.alpha0 = alpha0;
    ring.curve = 'tide';
    ring.x = x;
    ring.y = y;
    ring.s.visible = false;
    ring.s.position.set(x, y);
    ring.s.tint = tint;
  }

  burst(x, y) {
    // 点击只绽开一圈细星环，外加一次很短的星芒中心闪光。
    this.spawnRing(x, y, 0, 14, 180, 640, 0.95);
    const star = this.burstStars.find((item) => item.life <= 0);
    if (star) {
      star.life = 200;
      star.max = 200;
      star.x = x;
      star.y = y;
      star.s.visible = true;
      star.s.position.set(x, y);
      star.s.tint = 0xffffff;
    }
  }

  update(dt, t) {
    const W = view.w;
    const H = view.h;
    const time = t * 0.001;
    const pointer = this.pointer;
    const px = pointer.x;
    const py = pointer.y;

    for (const p of this.particles) {
      if (!p.s.visible) continue;
      p.u = (p.u + p.vx * dt * 0.001 * (p.z * 1.4 + 0.2) + 1) % 1;
      p.v = (p.v + p.vy * dt * 0.001 * (p.z * 1.1 + 0.15) + 1) % 1;
      let x = p.u * W;
      let y = p.v * H;
      const base = p.a * (0.55 + 0.45 * Math.sin(time * p.tw + p.ph));
      let a = base;
      let ox = 0;
      let oy = 0;
      if (pointer.active) {
        const dx = x - px;
        const dy = y - py;
        const d = Math.hypot(dx, dy);
        if (d < 210) {
          const k = 1 - d / 210;
          a += 0.16 * k;
          ox -= (dx / (d + 0.001)) * 8 * k;
          oy -= (dy / (d + 0.001)) * 8 * k;
          ox += (-dy / (d + 0.001)) * 6 * k;
          oy += (dx / (d + 0.001)) * 6 * k;
        }
      }
      x += ox;
      y += oy;
      p.s.position.set(x, y);
      const size = Math.max(1.4, p.r * 3.0);
      p.s.width = size;
      p.s.height = size;
      p.s.alpha = Math.min(0.9, a);
    }

    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.s.visible = false;
        continue;
      }
      s.vy += 10 * dt * 0.001;
      s.x += s.vx * dt * 0.001;
      s.y += s.vy * dt * 0.001;
      const k = s.life / s.max;
      s.s.position.set(s.x, s.y);
      const size = Math.max(2, s.r * 3.6);
      s.s.width = size;
      s.s.height = size;
      s.s.alpha = Math.min(0.95, k * 1.1);
      s.s.tint = 0xffffff;
    }

    this.updateRipples(this.ripples, dt);
    this.updateRipples(this.pulseRipples, dt);

    for (const star of this.burstStars) {
      if (star.life <= 0) {
        star.s.visible = false;
        continue;
      }
      star.life -= dt;
      if (star.life <= 0) {
        star.s.visible = false;
        continue;
      }
      const k = 1 - star.life / star.max;
      star.s.position.set(star.x, star.y);
      star.s.width = 8 + k * 22;
      star.s.height = star.s.width;
      star.s.alpha = Math.min(1, 0.92 * (1 - k));
      star.s.rotation = k * 0.5;
      star.s.tint = 0xffffff;
    }
  }

  updateRipples(list, dt) {
    for (const r of list) {
      if (r.life <= 0) {
        r.s.visible = false;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) {
        r.s.visible = false;
        continue;
      }
      const elapsed = r.max - r.life;
      if (elapsed < r.delay) {
        r.s.visible = false;
        continue;
      }
      const k = Math.min(1, (elapsed - r.delay) / Math.max(1, r.max - r.delay));
      const ease = 1 - Math.pow(1 - k, 3);
      const size = r.size0 + (r.size1 - r.size0) * ease;
      r.s.visible = true;
      r.s.position.set(r.x, r.y);
      r.s.width = size;
      r.s.height = size;
      const envelope = r.curve === 'tide'
        ? Math.sin(Math.PI * Math.min(1, k))
        : Math.pow(1 - k, 1.5);
      r.s.alpha = r.alpha0 * envelope;
    }
  }

  stats() {
    return {
      particles: this.particles.length,
      sparks: this.sparks.filter((s) => s.life > 0).length,
      ripples: this.ripples.filter((r) => r.life > 0).length,
      pulseRipples: this.pulseRipples.filter((r) => r.life > 0).length,
      stars: this.burstStars.filter((s) => s.life > 0).length
    };
  }
}