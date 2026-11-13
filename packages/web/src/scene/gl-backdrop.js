// WebGL 星空背景：底色、星云、星点、微粒与流星，全部走 Pixi 批处理。
import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { clamp, randRange, TAU } from '@starmap/core';
import { cam, view } from '../state.js';
import { quality } from '../quality.js';
import {
  bgTexture,
  crossTexture,
  glowTexture,
  grainTexture,
  sparkTexture,
  starTexture,
  vignetteTexture
} from './gl-textures.js';

const mod = (value, max) => ((value % max) + max) % max;
const NEBULAS = [
  { u: 0.23, v: 0.22, r: 0.48, c: 0x3e60be, a: 0.10, ph: 0.2, sp: 0.9 },
  { u: 0.78, v: 0.28, r: 0.42, c: 0x6044af, a: 0.09, ph: 2.1, sp: 0.7 },
  { u: 0.52, v: 0.84, r: 0.52, c: 0x22708c, a: 0.052, ph: 4.2, sp: 0.6 },
  { u: 0.92, v: 0.72, r: 0.34, c: 0x3658af, a: 0.07, ph: 1.3, sp: 1.1 },
  { u: 0.07, v: 0.78, r: 0.36, c: 0x523a96, a: 0.055, ph: 3.4, sp: 0.8 },
  { u: 0.36, v: 0.58, r: 0.62, c: 0x244c96, a: 0.035, ph: 5.1, sp: 0.5 },
  { u: 0.7, v: 0.12, r: 0.3, c: 0x4e42a8, a: 0.04, ph: 4.6, sp: 0.75 }
];
const STAR_CLUSTERS = [
  { u: 0.2, v: 0.22 },
  { u: 0.78, v: 0.18 },
  { u: 0.62, v: 0.74 },
  { u: 0.13, v: 0.82 },
  { u: 0.88, v: 0.58 }
];

export class GLBackdrop {
  constructor() {
    this.root = new Container();
    this.root.eventMode = 'none';

    this.bg = new Sprite(bgTexture());
    this.bg.width = 1;
    this.bg.height = 1;
    this.root.addChild(this.bg);

    this.nebulaLayer = new Container();
    this.root.addChild(this.nebulaLayer);
    this.nebulas = NEBULAS.map((cfg) => {
      const s = new Sprite(glowTexture());
      s.anchor.set(0.5);
      s.tint = cfg.c;
      s.alpha = cfg.a;
      s.blendMode = 'add';
      this.nebulaLayer.addChild(s);
      return { cfg, s };
    });

    this.starLayer = new Container();
    this.root.addChild(this.starLayer);
    this.stars = [];
    this.starBase = view.w < 700 ? 520 : 900;
    // 多生成 200%，画质面板把密度拉到 300% 时不用重建纹理与分布。
    const starCount = Math.ceil(this.starBase * 3.0);
    for (let i = 0; i < starCount; i++) {
      let u = Math.random();
      let v = Math.random();
      if (Math.random() < 0.42) {
        const c = STAR_CLUSTERS[i % STAR_CLUSTERS.length];
        u = mod(c.u + (Math.random() + Math.random() + Math.random() - 1.5) * 0.12, 1);
        v = mod(c.v + (Math.random() + Math.random() + Math.random() - 1.5) * 0.12, 1);
      }
      const z = 0.15 + Math.random() * 0.85;
      const sprite = new Sprite(starTexture());
      sprite.anchor.set(0.5);
      sprite.blendMode = 'normal';
      this.starLayer.addChild(sprite);
      const big = Math.random() < 0.16;
      let cross = null;
      if (big) {
        cross = new Sprite(crossTexture());
        cross.anchor.set(0.5);
        cross.blendMode = 'add';
        this.starLayer.addChild(cross);
      }
      this.stars.push({
        u,
        v,
        z,
        r: 0.35 + Math.pow(Math.random(), 2.2) * 1.55,
        a: 0.22 + Math.random() * 0.72,
        tw: 0.5 + Math.random() * 1.9,
        ph: Math.random() * TAU,
        tint: Math.random() < 0.12,
        big,
        crossAngle: Math.random() < 0.65 ? 0 : Math.PI / 4,
        sprite,
        cross
      });
    }

    this.moteLayer = new Container();
    this.root.addChild(this.moteLayer);
    this.motes = [];
    this.moteBase = view.w < 700 ? 130 : 220;
    const moteCount = Math.ceil(this.moteBase * 3.0);
    for (let i = 0; i < moteCount; i++) {
      const s = new Sprite(sparkTexture());
      s.anchor.set(0.5);
      s.blendMode = 'normal';
      this.moteLayer.addChild(s);
      this.motes.push({
        u: Math.random(),
        v: Math.random(),
        z: 0.2 + Math.random() * 0.8,
        r: 0.5 + Math.pow(Math.random(), 2) * 2.3,
        a: 0.14 + Math.random() * 0.30,
        sp: 0.35 + Math.random() * 1.4,
        ph: Math.random() * TAU,
        tw: 0.4 + Math.random() * 1.2,
        s
      });
    }

    this.meteor = new Sprite(glowTexture());
    this.meteor.anchor.set(0.5);
    this.meteor.blendMode = 'add';
    this.meteor.tint = 0xd8ecff;
    this.meteor.visible = false;
    this.root.addChild(this.meteor);
    this.meteorData = null;
    this.nextMeteor = performance.now() + randRange(800, 1800);

    this.overlay = new Container();
    this.overlay.eventMode = 'none';
    this.vignette = new Sprite(vignetteTexture());
    this.vignette.anchor.set(0);
    this.overlay.addChild(this.vignette);
    this.grain = new TilingSprite({
      texture: grainTexture(),
      width: 1,
      height: 1
    });
    this.grain.blendMode = 'overlay';
    this.grain.alpha = 0.12;
    this.overlay.addChild(this.grain);

    this.setDensity(1);
    this.resize();
  }

  /** 星点密度：1 = 默认；0.2–3.0 对应画质面板的 20%–300%。 */
  setDensity(value) {
    this.starDensity = clamp(Number(value) || 1, 0.2, 3.0);
    const stars = Math.min(this.stars.length, Math.round(this.starBase * this.starDensity));
    this.stars.forEach((s, i) => {
      const show = i < stars;
      s.sprite.visible = show;
      if (s.cross) s.cross.visible = show;
    });
    const motes = Math.min(this.motes.length, Math.round(this.moteBase * this.starDensity));
    this.motes.forEach((m, i) => {
      m.s.visible = i < motes;
    });
  }

  resize() {
    const w = Math.max(1, view.w);
    const h = Math.max(1, view.h);
    this.bg.width = w;
    this.bg.height = h;
    this.vignette.width = w;
    this.vignette.height = h;
    this.grain.width = w;
    this.grain.height = h;
    this.meteor.visible = false;
  }

  update(t, dt) {
    const W = view.w;
    const H = view.h;
    const time = t * 0.001;
    const nt = t * 0.00002;
    const qAll = quality();
    const q = qAll.mode === '2d' ? qAll.two : qAll.three;
    const sizeScale = clamp(q.starSize || 1, 0.3, 3);
    const bright = clamp(q.glow || 1, 0.2, 3);
    const sparkle = clamp(q.sparkle || q.glow || 1, 0.2, 3);

    for (const { cfg, s } of this.nebulas) {
      const x = cfg.u * W + Math.sin(nt * cfg.sp + cfg.ph) * W * 0.018 + cam.x * 0.012;
      const y = cfg.v * H + Math.cos(nt * cfg.sp * 0.8 + cfg.ph) * H * 0.018 + cam.y * 0.012;
      const r = cfg.r * Math.max(W, H) * (1 + 0.035 * Math.sin(nt * 2 + cfg.ph));
      s.position.set(x, y);
      s.width = r * 2;
      s.height = r * 2;
      s.alpha = cfg.a * (0.9 + 0.1 * Math.sin(nt * 1.3 + cfg.ph));
    }

    for (const s of this.stars) {
      if (!s.sprite.visible) continue;
      const par = 0.05 + s.z * 0.12;
      const sx = mod(s.u * W - cam.x * par, W);
      const sy = mod(s.v * H - cam.y * par * 0.7, H);
      const twinkle = 0.72 + 0.28 * Math.sin(time * s.tw + s.ph);
      const alpha = Math.min(1, s.a * twinkle * bright);
      const size = Math.max(0.7, s.r * 4.2 * sizeScale);
      s.sprite.position.set(sx, sy);
      s.sprite.width = size;
      s.sprite.height = size;
      s.sprite.alpha = alpha;
      s.sprite.tint = s.tint ? 0xfff2dc : 0xe8f2ff;
      if (s.cross) {
        // 星芒与星核约 1:3：星核直径 s.r*4.2，十字区域直径 s.r*13。
        const bigSize = Math.max(7, s.r * 13 * sizeScale);
        s.cross.position.set(sx, sy);
        s.cross.width = bigSize;
        s.cross.height = bigSize;
        s.cross.rotation = s.crossAngle;
        s.cross.alpha = Math.min(1, alpha * sparkle);
        s.cross.tint = s.tint ? 0xfff2dc : 0xe8f2ff;
      }
    }

    for (const m of this.motes) {
      if (!m.s.visible) continue;
      const drift = t * 0.000012 * m.sp;
      const sx = mod(m.u * W + drift * W * 0.2 - cam.x * 0.05, W);
      const sy = mod(m.v * H - drift * H * 0.28 - cam.y * 0.05, H);
      const a = Math.min(1, m.a * (0.55 + 0.45 * Math.sin(time * m.tw + m.ph)) * bright);
      const size = Math.max(1.2, m.r * 2.0 * sizeScale);
      m.s.position.set(sx, sy);
      m.s.width = size;
      m.s.height = size;
      m.s.alpha = a;
      m.s.tint = 0xcde4ff;
    }

    if (!this.meteorData && t > this.nextMeteor) {
      this.meteorData = {
        x: randRange(W * 0.15, W * 0.75),
        y: randRange(0, H * 0.35),
        len: randRange(140, 260),
        vx: randRange(180, 300),
        vy: randRange(120, 220),
        life: randRange(700, 1150),
        age: 0
      };
      this.meteor.visible = true;
    }
    if (this.meteorData) {
      const m = this.meteorData;
      m.age += dt;
      m.x += m.vx * dt * 0.001;
      m.y += m.vy * dt * 0.001;
      const k = 1 - m.age / m.life;
      if (k <= 0) {
        this.meteorData = null;
        this.meteor.visible = false;
        this.nextMeteor = t + randRange(700, 2200);
      } else {
        const angle = Math.atan2(m.vy, m.vx);
        this.meteor.position.set(m.x, m.y);
        this.meteor.rotation = angle;
        this.meteor.width = m.len;
        this.meteor.height = 2.8;
        this.meteor.alpha = 0.62 * k;
      }
    }
  }
}