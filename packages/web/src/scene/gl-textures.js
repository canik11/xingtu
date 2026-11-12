// WebGL 渲染用的程序化纹理：全部用 Canvas 生成一次，之后由 Pixi 复用。
import { Texture } from 'pixi.js';
import { TAU } from '@starmap/core';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finish(key, canvas, { repeat = false, mipmap = true } = {}) {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  if (repeat) texture.source.addressMode = 'repeat';
  // Thin procedural strokes (rings, spark cores) are drawn at high resolution
  // and then shrunk a lot on screen. Without mipmaps the GPU point-samples
  // them, which reads as a broken/dashed edge while sprites rotate. Pixi skips
  // this on contexts without non-power-of-two mipmap support.
  if (mipmap) {
    texture.source.autoGenerateMipmaps = true;
    texture.source.mipmapFilter = 'linear';
  }
  cache.set(key, texture);
  return texture;
}

function texture(key, size, draw, options) {
  if (cache.has(key)) return cache.get(key);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
  return finish(key, canvas, options);
}

/** 柔光圆斑，用于节点 halo、星云、微粒。 */
export function glowTexture() {
  return texture('glow', 256, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.14, 'rgba(255,255,255,.94)');
    g.addColorStop(0.4, 'rgba(255,255,255,.34)');
    g.addColorStop(0.72, 'rgba(255,255,255,.075)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}


/**
 * 节点/脉冲核心：硬核心直径缩到原先一半，外面加一层低亮散射光辉。
 * 原先的高亮平台直径约为 .55s；这里核心直径约为 .275s。
 */
export function coreTexture() {
  return texture('core', 128, (ctx, s) => {
    const c = s / 2;
    const core = s * 0.1375;
    const g = ctx.createRadialGradient(c, c, core * 0.72, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,.24)');
    g.addColorStop(0.22, 'rgba(240,249,255,.14)');
    g.addColorStop(0.52, 'rgba(212,235,255,.055)');
    g.addColorStop(0.8, 'rgba(180,216,255,.012)');
    g.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(c, c, core, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

/**
 * 选中态的双层脉冲光环。按 5 倍分辨率绘制，避免镜头放大后纹理发虚；
 * 每圈都是"柔边打底 + 亮线压边"，缩小时线不会断成虚线。
 */
export function ringTexture() {
  return texture('ring', 800, (ctx, s) => {
    const c = s / 2;
    const k = s / 160;
    const ring = (radius, coreWidth, coreAlpha, glowWidth, glowAlpha) => {
      ctx.strokeStyle = `rgba(205,232,255,${glowAlpha})`;
      ctx.lineWidth = glowWidth;
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${coreAlpha})`;
      ctx.lineWidth = coreWidth;
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(c * 0.44, 3.2 * k, 0.95, 7 * k, 0.22);
    ring(c * 0.55, 2.2 * k, 0.42, 5 * k, 0.12);
  });
}

/**
 * 小光点：一个只有原先一半直径的硬核心，外面是一层低亮度的散射光辉。
 * 用于星点、微尘、环境粒子和环绕点；中心保持清晰，不整体发糊。
 */
export function sparkTexture() {
  return texture('spark', 128, (ctx, s) => {
    const c = s / 2;
    const core = s * 0.075;
    const g = ctx.createRadialGradient(c, c, core * 0.7, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,.30)');
    g.addColorStop(0.2, 'rgba(240,249,255,.19)');
    g.addColorStop(0.48, 'rgba(212,235,255,.09)');
    g.addColorStop(0.76, 'rgba(180,216,255,.025)');
    g.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(c, c, core, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

/** 点击星环：一圈细环 + 环上 8 颗四芒小星。 */
export function starRingTexture() {
  return texture('star-ring', 256, (ctx, s) => {
    const c = s / 2;
    const r = c * 0.79;
    ctx.strokeStyle = 'rgba(255,255,255,.82)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      const len = i % 2 ? 4.2 : 6.4;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = i % 2 ? 1.1 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
  });
}

/**
 * 节点静默星芒：四臂十字。每条臂不是线条，而是一枚顶角 5° 的棱状三角形，
 * 中间用高亮脊线表现棱面；纹理按高倍率绘制，镜头放大后依然锐利。
 */
export function nodeStarTexture() {
  return texture('node-star', 512, (ctx, s) => {
    const c = s / 2;
    const len = c * 0.752;
    const base = len * Math.tan((2.5 * Math.PI) / 180);
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((i * Math.PI) / 2);

      // The arm is two back-to-back facets (a slim prism). The upper facet
      // catches the light, the lower facet is cooler/darker, and the shared
      // centre line is the bright ridge.
      const lit = ctx.createLinearGradient(0, 0, len, 0);
      lit.addColorStop(0, 'rgba(255,255,255,1)');
      lit.addColorStop(0.16, 'rgba(255,255,255,.94)');
      lit.addColorStop(0.5, 'rgba(244,250,255,.52)');
      lit.addColorStop(0.82, 'rgba(218,238,255,.16)');
      lit.addColorStop(1, 'rgba(190,222,255,0)');
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, -base);
      ctx.closePath();
      ctx.fillStyle = lit;
      ctx.fill();

      const shade = ctx.createLinearGradient(0, 0, len, 0);
      shade.addColorStop(0, 'rgba(226,242,255,.72)');
      shade.addColorStop(0.16, 'rgba(208,232,255,.52)');
      shade.addColorStop(0.5, 'rgba(176,214,255,.24)');
      shade.addColorStop(0.82, 'rgba(150,198,255,.07)');
      shade.addColorStop(1, 'rgba(140,190,255,0)');
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, base);
      ctx.closePath();
      ctx.fillStyle = shade;
      ctx.fill();

      const ridge = ctx.createLinearGradient(0, 0, len * 0.8, 0);
      ridge.addColorStop(0, 'rgba(255,255,255,1)');
      ridge.addColorStop(0.55, 'rgba(255,255,255,.6)');
      ridge.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = ridge;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(len * 0.8, 0);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** 节点的四芒星，光线细而亮，中心不铺大范围柔光。 */
export function flareTexture() {
  return texture('flare', 192, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.13);
    g.addColorStop(0, 'rgba(255,255,255,.36)');
    g.addColorStop(0.55, 'rgba(255,255,255,.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);

    const ray = (angle, w, len, alpha) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      const lg = ctx.createLinearGradient(-len, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.38, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
      lg.addColorStop(0.62, 'rgba(255,255,255,0)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-len, -w / 2, len * 2, w);
      ctx.restore();
    };
    ray(0, 3.4, c * 0.98, 1);
    ray(Math.PI / 2, 3.4, c * 0.98, 1);
    ray(Math.PI / 4, 1.3, c * 0.46, 0.52);
    ray(-Math.PI / 4, 1.3, c * 0.46, 0.52);
  });
}

/** 背景大星：横向/纵向十字光晕。 */
export function crossTexture() {
  return texture('cross', 96, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(0.35, 'rgba(220,240,255,.13)');
    g.addColorStop(1, 'rgba(160,205,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);

    const line = (x1, y1, x2, y2, w, a) => {
      const lg = ctx.createLinearGradient(x1, y1, x2, y2);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${a})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    line(4, c, s - 4, c, 1.1, 0.9);
    line(c, 5, c, s - 5, 1.1, 0.82);
  });
}

/** 背景底色：与 Canvas 旧版的深空渐变一致。 */
export function bgTexture() {
  return texture('bg', 512, (ctx, s) => {
    const g = ctx.createRadialGradient(s * 0.5, s * 0.4, 0, s * 0.5, s * 0.52, s * 0.82);
    g.addColorStop(0, '#091023');
    g.addColorStop(0.42, '#050a17');
    g.addColorStop(0.78, '#03060e');
    g.addColorStop(1, '#020308');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** 暗角遮罩。 */
export function vignetteTexture() {
  return texture('vignette', 512, (ctx, s) => {
    const g = ctx.createRadialGradient(s * 0.5, s * 0.48, s * 0.18, s * 0.5, s * 0.5, s * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(0,0,0,.10)');
    g.addColorStop(0.85, 'rgba(0,0,0,.34)');
    g.addColorStop(1, 'rgba(0,0,0,.74)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** 细噪点，避免大面积色带。 */
export function grainTexture() {
  return texture('grain', 128, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 105 + Math.random() * 130;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 24;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: true });
}

/** 星海光点：半尺寸硬核心 + 外围散射光辉。 */
export function starTexture() {
  return texture('star', 128, (ctx, s) => {
    const c = s / 2;
    const core = s * 0.08;
    const g = ctx.createRadialGradient(c, c, core * 0.7, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,.34)');
    g.addColorStop(0.18, 'rgba(240,249,255,.22)');
    g.addColorStop(0.44, 'rgba(220,240,255,.10)');
    g.addColorStop(0.74, 'rgba(190,222,255,.03)');
    g.addColorStop(1, 'rgba(170,210,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(c, c, core, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

/** 散景：空心柔化圆。 */
export function bokehTexture() {
  return texture('bokeh', 96, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,.10)');
    g.addColorStop(0.5, 'rgba(220,238,255,.28)');
    g.addColorStop(0.82, 'rgba(180,216,255,.16)');
    g.addColorStop(1, 'rgba(150,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}