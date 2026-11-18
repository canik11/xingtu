// WebGL 场景：星空 + 荧光粒子 + 3D/局部知识图，统一交给 PixiJS 批处理。
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { TAU, clamp, mod } from '@starmap/core';
import { cam, ui, view } from '../state.js';
import { MAX_SCALE, worldToScreen } from '../camera.js';
import { outerRadius, projectPoint, sceneVisuals, sceneEdges, innerSelectionSet } from '../hierarchy.js';
import { shapePoint, shapeSkeleton, shapeIdlePoint } from '../shapes.js';
import { getFocus, projectFocusNode } from '../focus.js';
import { appearanceConfig, edgeDefaultRgb, edgeIsMastered, edgeMasteredRgb, masteryRgb, scaledAppearance } from '../mastery.js';
import { GLBackdrop } from './gl-backdrop.js';
import { GLAmbient } from './gl-ambient.js';
import { transitionAt, transitionPoint, coverRadius, endTransition } from './transition.js';
import { quality } from '../quality.js';
import {
  coreTexture,
  glowTexture,
  nodeStarTexture,
  ringTexture,
  sparkTexture,
  starTexture
} from './gl-textures.js';

const FONT =
  '"Segoe UI Variable Text","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
const LABEL_SCALE = 0.85;

/** 形状骨架星尘的数量与变形时长（毫秒）。 */
const DUST_COUNT = 720;
const DUST_DUR = 1350;

const rgbHex = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
const mixRgb = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
];

/** 星海总亮度倍率与星芒倍率。 */
function modeGlow() {
  return quality().three.glow;
}
function modeSparkle() {
  return quality().three.sparkle;
}
const isLocal = () => ui.level === 'local';
const range = (value, a, b) => Math.max(a, Math.min(b, value));

/** Pixi Graphics 没有虚线，用等长短线段拼出来（dash/gap 单位是屏幕像素）。 */
function strokeDashed(g, ax, ay, bx, by, width, color, alpha, dash = 9, gap = 7) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return;
  const ux = dx / len;
  const uy = dy / len;
  const step = dash + gap;
  for (let d = 0; d < len; d += step) {
    const end = Math.min(d + dash, len);
    g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * end, ay + uy * end).stroke({ width, color, alpha });
  }
}

function selectedId() {
  return ui.level === 'inner' ? ui.innerSelection : ui.selection;
}

function hoveredId() {
  return ui.hover && ui.hover.id ? ui.hover.id : null;
}

function innerDim(v) {
  if (ui.level !== 'inner' || !ui.innerSelection) return 1;
  if (v.id === ui.innerSelection) return 1;
  const set = innerSelectionSet(ui.innerSelection);
  return set && set.has(v.id) ? 0.72 : 0.16;
}

function outerDim(v) {
  if (ui.level !== 'sphere') return 1;
  return ui.selection && v.id !== ui.selection ? 0.3 : 1;
}

function depthDim(v) {
  return ui.level === 'inner' ? innerDim(v) : outerDim(v);
}

function bornAge(born, t) {
  if (!born) return 1;
  return clamp((t - born) / 620, 0, 1);
}

function makeLabel() {
  const text = new Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 12,
      fontWeight: '400',
      fill: 0xffffff,
      stroke: { color: 0x030812, width: 3 },
      lineJoin: 'round',
      align: 'center'
    }
  });
  text.resolution = Math.max(2, targetResolution());
  text.visible = false;
  text.anchor.set(0.5, 0);
  return text;
}

class WebGLScene {
  constructor(app) {
    this.app = app;
    this.root = new Container();
    this.root.eventMode = 'none';
    this.app.stage.addChild(this.root);

    this.backdrop = new GLBackdrop();
    this.root.addChild(this.backdrop.root);

    // 心跳时的整片透光：垫在星尘和节点后面，只让球心附近亮起一层很淡的冷光。
    this.breathGlow = new Sprite(glowTexture());
    this.breathGlow.anchor.set(0.5);
    this.breathGlow.blendMode = 'add';
    this.breathGlow.visible = false;
    this.root.addChild(this.breathGlow);

    this.ambient = new GLAmbient();
    this.root.addChild(this.ambient.root);
    this.breathMark = -1;

    // 知识图单独包一层：转场时只对图做遮罩/缩放/淡入，星空与粒子保持完整。
    this.graphRoot = new Container();
    this.graphRoot.eventMode = 'none';
    this.root.addChild(this.graphRoot);
    this.graphMask = new Graphics();
    this.graphMask.visible = false;
    this.root.addChild(this.graphMask);

    // 形状骨架星尘：几百个极小的星点把当前星海的轮廓勾出来，
    // 这样即便课程只有两三门，切换形状时也能看见星系盘、星环或双螺旋的骨架。
    this.shapeDust = new Container();
    this.shapeDust.eventMode = 'none';
    this.graphRoot.addChild(this.shapeDust);
    this.dustSprites = [];
    const dustTex = starTexture();
    for (let i = 0; i < DUST_COUNT; i++) {
      const sprite = new Sprite(dustTex);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      sprite.tint = 0x9fc4ff;
      sprite.alpha = 0;
      this.shapeDust.addChild(sprite);
      this.dustSprites.push(sprite);
    }
    this.dustWorld = new Float32Array(DUST_COUNT * 3);
    this.dustTarget = null;
    this.dustFrom = null;
    this.dustShape = null;
    this.dustStart = 0;

    // 骨架折线：比星尘更清晰的轮廓线，节点沿它生长，形状不会糊成一团。
    this.skeleton = new Graphics();
    this.skeleton.eventMode = 'none';
    this.skeleton.blendMode = 'add';
    this.graphRoot.addChildAt(this.skeleton, 0);
    this.skeletonShape = null;
    this.skeletonLines = null;

    this.edgeGlow = new Graphics();
    this.edgeGlow.blendMode = 'add';
    this.edgeMain = new Graphics();
    this.edgeMain.blendMode = 'add';
    this.graphRoot.addChild(this.edgeGlow, this.edgeMain);

    this.nodeGlowLayer = new Container();
    this.nodeCoreLayer = new Container();
    this.nodeFlareLayer = new Container();
    this.graphRoot.addChild(this.nodeGlowLayer, this.nodeFlareLayer, this.nodeCoreLayer);

    this.edgePulseLayer = new Container();
    this.graphRoot.addChild(this.edgePulseLayer);
    this.edgePulses = [];
    for (let i = 0; i < 6; i++) {
      const spike = new Sprite(glowTexture());
      const core = new Sprite(coreTexture());
      for (const s of [spike, core]) {
        s.anchor.set(0.5);
        s.blendMode = 'add';
        s.visible = false;
        this.edgePulseLayer.addChild(s);
      }
      this.edgePulses.push({ core, spike });
    }

    this.selectionLayer = new Container();
    this.graphRoot.addChild(this.selectionLayer);
    this.ringA = new Sprite(ringTexture());
    this.ringA.anchor.set(0.5);
    this.ringA.blendMode = 'add';
    this.ringA.visible = false;
    this.selectionLayer.addChild(this.ringA);
    this.orbit = [];
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(sparkTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.selectionLayer.addChild(s);
      this.orbit.push(s);
    }

    this.labelLayer = new Container();
    this.labelLayer.eventMode = 'none';
    this.graphRoot.addChild(this.labelLayer);
    this.labels = new Map();

    this.root.addChild(this.backdrop.overlay);

    this.nodes = new Map();
    this.usedNodes = new Set();
    this.usedLabels = new Set();
    this.bound = false;
  }

  bind(stage) {
    if (this.bound) return;
    this.bound = true;
    this.ambient.bind(stage);
  }

  resize() {
    const resolution = targetResolution();
    if (Math.abs(this.app.renderer.resolution - resolution) > 0.01) {
      this.app.renderer.resolution = resolution;
    }
    this.app.renderer.resize(view.w, view.h);
    this.backdrop.resize();
  }

  ensureNode(id) {
    if (this.nodes.has(id)) return this.nodes.get(id);
    const halo = new Sprite(glowTexture());
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    const core = new Sprite(coreTexture());
    core.anchor.set(0.5);
    const flare = new Sprite(nodeStarTexture());
    flare.anchor.set(0.5);
    flare.blendMode = 'add';
    halo.visible = core.visible = flare.visible = false;
    this.nodeGlowLayer.addChild(halo);
    this.nodeFlareLayer.addChild(flare);
    this.nodeCoreLayer.addChild(core);
    const record = { halo, core, flare };
    this.nodes.set(id, record);
    return record;
  }

  getLabel(key, text, size, weight, fill, anchorY = 0) {
    let label = this.labels.get(key);
    if (!label) {
      label = makeLabel();
      this.labels.set(key, label);
      this.labelLayer.addChild(label);
    }
    if (label.__key !== `${text}|${size}|${weight}`) {
      label.text = text;
      if (label.style.fontSize !== size) label.style.fontSize = size;
      if (label.style.fontWeight !== weight) label.style.fontWeight = weight;
      label.__key = `${text}|${size}|${weight}`;
    }
    label.anchor.set(0.5, anchorY);
    label.tint = fill;
    label.visible = true;
    this.usedLabels.add(label);
    return label;
  }

  clearUnused() {
    for (const [id, record] of this.nodes) {
      if (!this.usedNodes.has(id)) {
        record.halo.visible = false;
        record.core.visible = false;
        record.flare.visible = false;
      }
    }
    for (const label of this.labels.values()) {
      if (!this.usedLabels.has(label)) label.visible = false;
    }
    this.usedLabels.clear();
  }

  drawNode(id, x, y, rad, depth, dim, active, hovered, rgb, born, isPoint = false, lowDetail = false, t = 0, gain = 1, haloScale = 1, starScale = 1) {
    const rec = this.ensureNode(id);
    this.usedNodes.add(id);
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 997;
    // 光芒与核心保持 1:3：核心精灵直径 2*rad，光晕直径 6*rad。
    // 选中态不再额外放大光晕，否则会压住周围节点和标签。
    const haloR = rad * 3.0 * haloScale;
    const haloBase = active || hovered ? 0.11 + depth * 0.16 : 0.075 + depth * 0.10;
    const glowK = modeGlow();
    // 心跳光脉冲：整片星海一起轻轻亮一下，节点光晕再放大一点，但不刺眼。
    const pulse = 1 + (ui.idlePulse || 0) * 0.34;
    const alpha = haloBase * dim * born * (active ? 1.4 : hovered ? 1.2 : 1) * glowK;
    rec.halo.visible = alpha > 0.012 && rad > 0.4 && !(isPoint && lowDetail);
    rec.halo.position.set(x, y);
    rec.halo.width = haloR * 2;
    rec.halo.height = haloR * 2;
    rec.halo.alpha = Math.min(active || hovered ? 0.5 : 0.38, alpha * 1.5 * gain * pulse);
    rec.halo.tint = rgbHex(rgb);

    rec.core.visible = rad > 0.3 && dim * born > 0.02;
    rec.core.position.set(x, y);
    rec.core.width = rad * 2;
    rec.core.height = rad * 2;
    rec.core.alpha = Math.min(1, 0.76 * dim * born * gain * (1 + (ui.idlePulse || 0) * 0.14));
    rec.core.tint = rgbHex(rgb.map((v) => Math.min(255, v + 8)));

    // Every node gets its own resting cross-star. The star is four
    // 5°-apex triangular rays; each node twinkles on its own phase.
    const twinkle = 0.58 + 0.42 * Math.sin(t * (0.0011 + (hash % 7) * 0.00007) + hash * 0.37);
    const detail = isPoint && lowDetail ? 0.36 : 1;
    const flareAlpha = active || hovered ? 0 : (0.34 + depth * 0.20) * dim * born * detail * modeSparkle();
    rec.flare.visible = flareAlpha > 0.012 && rad > 0.45;
    if (rec.flare.visible) {
      const beat = (ui.idlePulse || 0) * 0.42;
      // starScale 只改十字星芒的外接尺寸，节点核心与光晕不受影响。
      const size =
        rad * (isPoint ? 5.4 : 6.4) * (isPoint && lowDetail ? 0.68 : 1) * (0.94 + 0.06 * twinkle) * (1 + beat * 0.16) * starScale;
      rec.flare.position.set(x, y);
      rec.flare.width = size;
      rec.flare.height = size;
      rec.flare.alpha = Math.min(0.82, flareAlpha * (0.58 + 0.42 * twinkle) * gain * (1 + beat));
      rec.flare.tint = rgbHex(rgb.map((v) => Math.min(255, v + 10)));
      rec.flare.rotation = 0;
    }
  }

  drawEdgePulses(infos, t) {
    for (const item of this.edgePulses) {
      item.core.visible = false;
      item.spike.visible = false;
    }
    if (!infos || !infos.length) return;
    const cfg = scaledAppearance();
    const count = Math.min(infos.length, this.edgePulses.length);
    for (let i = 0; i < count; i++) {
      const info = infos[i];
      const item = this.edgePulses[i];
      // One-way, slow drift from pa to pb. Fade at both ends so the wrap back
      // to the start does not read as a bounce.
      const p = mod(t * 0.00022 + i * 0.17, 1);
      const fade = Math.min(1, p * 12, (1 - p) * 8);
      const x = info.pa.x + (info.pb.x - info.pa.x) * p;
      const y = info.pa.y + (info.pb.y - info.pa.y) * p;
      const tint = Number.isFinite(info.color) ? info.color : (info.gold ? 0xffd98a : 0xeef7ff);
      const alpha = Math.min(1, (0.58 + info.alpha * 0.75) * cfg.pulseBrightness);
      // Pulses live in screen space, so scale them with the camera like the
      // nodes; otherwise they stay tiny while the graph is zoomed in.
      const zoom = clamp(cam.scale, 0.3, MAX_SCALE);
      const size = (info.gold ? 1 : 0.86) * cfg.pulseSize * zoom;
      item.spike.visible = true;
      item.spike.position.set(x, y);
      item.spike.width = 30 * size;
      item.spike.height = item.spike.width;
      item.spike.alpha = Math.min(0.62, alpha * 0.38) * fade;
      item.spike.tint = tint;
      item.spike.rotation = 0;
      item.core.visible = true;
      item.core.position.set(x, y);
      item.core.width = 6.4 * size;
      item.core.height = item.core.width;
      item.core.alpha = Math.min(1, alpha) * fade;
      item.core.tint = tint;
    }
  }


  drawRings(x, y, rad, rgb, active, t, compact = false) {
    for (const item of [this.ringA, ...this.orbit]) item.visible = false;
    if (!active) return;
    const color = rgbHex(rgb.map((v) => Math.min(255, v + 28)));
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.0028);
    // Keep the selection halo close to the node. A course node is drawn at
    // rad ~12px, so the old 12.4*rad outer ring reached ~40px and cut through
    // the label sitting 28px below the node. One counter-rotating ring pair
    // was removed as well, leaving a single two-line halo.
    const ringASize = compact ? (rad * 6.2 + pulse * rad * 1.0) * 0.7 : rad * 6.4 + pulse * rad * 0.8;
    const orbitRadius = rad * 2.6 * (compact ? 0.7 : 1) * 0.6;
    const orbitSize = compact ? rad * 1.7 : rad * 1.55;
    this.ringA.visible = true;
    this.ringA.position.set(x, y);
    this.ringA.width = ringASize;
    this.ringA.height = ringASize;
    this.ringA.alpha = clamp((0.5 + pulse * 0.2) * modeGlow(), 0, 1);
    this.ringA.tint = color;
    this.ringA.rotation = t * 0.00023;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.0012 + (i * TAU) / 3;
      const s = this.orbit[i];
      s.visible = true;
      s.position.set(x + Math.cos(a) * orbitRadius, y + Math.sin(a) * orbitRadius);
      s.width = orbitSize;
      s.height = orbitSize;
      s.alpha = clamp(modeGlow(), 0, 1);
      s.tint = color;
    }
  }

  positionsFor(visuals) {
    const positions = new Map();
    for (const v of visuals) {
      const p = isLocal() ? worldToScreen(projectFocusNode(v).x, projectFocusNode(v).y) : worldToScreen(v.x, v.y);
      positions.set(v.id, p);
    }
    return positions;
  }

  drawGraph3D(t, dt) {
    const visuals = sceneVisuals();
    if (!visuals.length) {
      this.edgeGlow.clear();
      this.edgeMain.clear();
      this.usedNodes.clear();
      this.drawEdgePulses([], t);
      this.clearUnused();
      return;
    }
    const edges = sceneEdges(visuals);
    const ordered = visuals.slice().sort((a, b) => a.depth - b.depth);
    const positions = new Map();
    for (const v of visuals) {
      const s = worldToScreen(v.x, v.y);
      positions.set(v.id, transitionPoint(v.id, s.x, s.y, t) || s);
    }
    const active = selectedId();
    const hover = hoveredId();
    const style = scaledAppearance();
    const innerGraph = ui.innerGraph;
    const born = ui.level === 'inner' && innerGraph ? innerGraph.born : 0;
    // 先算好每个节点的屏幕半径，供节点绘制与光丝端点使用。
    const rads = new Map();
    for (const v of visuals) {
      const base = Math.max(1.7, v.r * cam.scale * (0.6 + v.depth * 0.7)) * style.nodeSize;
      rads.set(v.id, base);
    }
    // At full three-level fit the point cloud is tiny and dense. Halos are
    // skipped and cross-stars are faint/small until the user zooms in.
    const lowDetail = ui.level === 'sphere' && ui.sphereScope >= 3 && cam.scale < 1.15;

    this.edgeGlow.clear();
    this.edgeMain.clear();
    const pulseInfos = [];
    const edgeLabels = [];
    for (const e of edges) {
      const pa = positions.get(e.pa.id);
      const pb = positions.get(e.pb.id);
      if (!pa || !pb) continue;
      if (!this.onScreen(pa, 100) && !this.onScreen(pb, 100)) continue;
      const isActive = !!(active && (e.a === active || e.b === active));
      const front = clamp((e.pa.depth + e.pb.depth) * 0.5, 0, 1);
      let alpha = (0.2 + front * 0.14) * (0.7 + front * 0.3);
      if (ui.level === 'inner') alpha *= 0.82;
      if (e.kind === 'chapter') alpha *= 0.58;
      if (e.kind === 'point') alpha *= 0.42;
      if (e.kind === 'topic') alpha *= 1.18;
      if (active) alpha = isActive ? 0.58 : alpha * 0.2;
      alpha = clamp(alpha * style.edgeBrightness, 0, 0.66);
      const gold = edgeIsMastered(e.pa.node, e.pb.node);
      const edgeRgb = gold ? edgeMasteredRgb(e.pa.node, e.pb.node) : edgeDefaultRgb(e.pa.node, e.pb.node);
      const color = rgbHex(edgeRgb);
      // 心跳时关系光丝跟着亮一点，让“整片星海亮一下”也扫到连线。
      const beat = 1 + (ui.idlePulse || 0) * 0.12;
      const glowWidth = isActive ? 8 : 5.2;
      const mainWidth = isActive ? 1.45 : 0.95;
      this.edgeGlow.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({
        width: glowWidth,
        color,
        alpha: Math.min(1, (gold ? Math.min(0.3, alpha * 0.24) : alpha * 0.16) * beat)
      });
      this.edgeMain.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({
        width: mainWidth,
        color,
        alpha: Math.min(1, (gold ? Math.min(0.8, alpha * 1.08) : alpha) * beat)
      });
      if (isActive) {
        pulseInfos.push({ pa, pb, color, alpha, gold });
      }
      if ((isActive || (ui.level === 'sphere' && e.label && cam.scale > 1.45 && front > 0.72)) && e.label) {
        edgeLabels.push({ e, pa, pb, active: isActive });
      }
    }

    this.drawEdgePulses(pulseInfos, t);

    for (const e of edgeLabels) {
      const mx = (e.pa.x + e.pb.x) / 2;
      const my = (e.pa.y + e.pb.y) / 2;
      let angle = Math.atan2(e.pb.y - e.pa.y, e.pb.x - e.pa.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      const label = this.getLabel(`e:${e.e.a}:${e.e.b}`, e.e.label, 10.5, '400', 0xcee2ff, 0.5);
      label.position.set(mx, my - 7);
      label.rotation = angle;
      label.alpha = e.active ? 0.78 : 0.42;
    }

    this.usedNodes.clear();
    const age = ui.level === 'inner' && innerGraph ? bornAge(born, t) : 1;
    const labelNodes = [];
    for (const v of ordered) {
      const p = positions.get(v.id);
      if (!p || !this.onScreen(p, 70)) continue;
      const rad = rads.get(v.id) ?? Math.max(1.7, v.r * cam.scale * (0.6 + v.depth * 0.7)) * style.nodeSize;
      const isActive = v.id === (ui.level === 'inner' ? ui.innerSelection : ui.selection);
      const isHovered = v.id === hover;
      let dim = depthDim(v) * age;
      if (ui.innerSelection && v.id !== ui.innerSelection) {
        const set = innerSelectionSet(ui.innerSelection);
        dim *= set && set.has(v.id) ? 0.72 : 0.16;
      }
      const rgb = masteryRgb(v.node);
      this.drawNode(v.id, p.x, p.y, rad, v.depth, dim, isActive, isHovered, rgb, 1, v.kind === 'point', lowDetail, t, style.nodeBrightness, 1, style.nodeStarSize);
      labelNodes.push({ v, p, rad, dim, selected: isActive || isHovered });
      if (isActive) this.drawRings(p.x, p.y, rad, rgb, true, t);
    }
    labelNodes.sort((a, b) => {
      const rank = (item) =>
        (item.selected ? 3 : 0) +
        (item.v.kind === 'top' ? 2 : item.v.kind === 'chapter' ? 1 : 0);
      return rank(b) - rank(a) || b.v.depth - a.v.depth;
    });
    // 屏幕空间防重叠：课程标签先占位，章节 / 知识点只在空位出现。
    // 节点很多（层级·全部）时标签不会叠成一团，形状轮廓才看得清。
    const labelRects = [];
    let chapterLabels = 0;
    const chapterLimit = ui.sphereScope >= 3 ? 18 : cam.scale > 1.35 ? 48 : 30;
    for (const item of labelNodes) {
      if (item.v.kind === 'chapter' && !item.selected) {
        if (chapterLabels >= chapterLimit) continue;
        chapterLabels++;
      }
      this.draw3DLabel(item.v, item.p, item.rad, item.dim, item.selected, t, labelRects);
    }
    this.clearUnused();
    if (!visuals.some((v) => v.id === (ui.level === 'inner' ? ui.innerSelection : ui.selection))) {
      this.drawRings(0, 0, 0, [255, 255, 255], false, t);
    }
  }

  drawGraphLocal(t, dt) {
    const graph = getFocus();
    if (!graph) {
      this.edgeGlow.clear();
      this.edgeMain.clear();
      this.usedNodes.clear();
      this.drawRings(0, 0, 0, [255, 255, 255], false, t);
      this.drawEdgePulses([], t);
      this.clearUnused();
      return;
    }
    const style = scaledAppearance();
    const positions = new Map();
    const depths = new Map();
    for (const n of graph.nodes) {
      const p = projectFocusNode(n);
      const s = worldToScreen(p.x, p.y);
      positions.set(n.id, transitionPoint(n.id, s.x, s.y, t) || s);
      depths.set(n.id, p.depth);
    }
    const rads = new Map();
    for (const n of graph.nodes) {
      const depth = depths.get(n.id) || 0;
      const base = Math.max(1.8, n.r * cam.scale * (0.74 + depth * 0.5)) * style.nodeSize;
      rads.set(n.id, base);
    }
    const adjacency = new Set();
    if (ui.selection) {
      for (const e of graph.edges) {
        if (e.a === ui.selection) adjacency.add(e.b);
        if (e.b === ui.selection) adjacency.add(e.a);
      }
    }
    const age = bornAge(graph.born, t);
    const edgeLabels = [];
    this.edgeGlow.clear();
    this.edgeMain.clear();
    const pulseInfos = [];

    for (const e of graph.edges) {
      const pa = positions.get(e.pa.id);
      const pb = positions.get(e.pb.id);
      if (!pa || !pb) continue;
      if (!this.onScreen(pa, 70) && !this.onScreen(pb, 70)) continue;
      const active = (ui.selection && (e.a === ui.selection || e.b === ui.selection)) ||
        (ui.hoverEdge && ui.hoverEdge.a === e.a && ui.hoverEdge.b === e.b);
      let alpha = e.kind === 'topic' ? 0.36 : e.kind === 'course' ? 0.2 : 0.23;
      if (ui.selection) {
        alpha = active ? 0.62 : (adjacency.has(e.a) || adjacency.has(e.b) ? alpha * 0.6 : alpha * 0.12);
      }
      const edgeDepth = Math.max(depths.get(e.pa.id), depths.get(e.pb.id));
      alpha *= 0.42 + edgeDepth * 0.58;
      const gold = edgeIsMastered(e.pa.entity, e.pb.entity);
      const edgeRgb = gold ? edgeMasteredRgb(e.pa.entity, e.pb.entity) : edgeDefaultRgb(e.pa.entity, e.pb.entity);
      const color = rgbHex(edgeRgb);
      // 外部节点的关系线改虚线：一眼区分“本节点下级”和“别的课程/章节”。
      const dashed = e.pa.kind === 'external' || e.pb.kind === 'external';
      alpha = clamp(alpha * style.edgeBrightness, 0, 0.7);
      const glowWidth = active ? 8 : e.kind === 'topic' ? 6.5 : 6;
      const glowAlpha = gold ? Math.min(0.3, alpha * 0.22) : Math.min(0.2, alpha * 0.16);
      const mainWidth = active ? 1.4 : 0.9;
      const mainAlpha = gold ? Math.min(0.8, alpha * 1.08) : alpha;
      if (dashed) {
        strokeDashed(this.edgeGlow, pa.x, pa.y, pb.x, pb.y, glowWidth, color, glowAlpha);
        strokeDashed(this.edgeMain, pa.x, pa.y, pb.x, pb.y, mainWidth, color, mainAlpha);
      } else {
        this.edgeGlow.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({
          width: glowWidth,
          color,
          alpha: glowAlpha
        });
        this.edgeMain.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({
          width: mainWidth,
          color,
          alpha: mainAlpha
        });
      }
      if (active) pulseInfos.push({ pa, pb, color, alpha, gold });
      if ((active || (ui.hoverEdge && ui.hoverEdge.a === e.a && ui.hoverEdge.b === e.b)) && e.label) {
        edgeLabels.push({ e, pa, pb, active });
      }
    }

    this.drawEdgePulses(pulseInfos, t);

    for (const e of edgeLabels) {
      const mx = (e.pa.x + e.pb.x) / 2;
      const my = (e.pa.y + e.pb.y) / 2 - 8;
      const label = this.getLabel(`e:${e.e.a}:${e.e.b}`, e.e.label, 11, '400', 0xcfe2ff, 0.5);
      label.position.set(mx, my);
      label.rotation = 0;
      label.alpha = 0.78;
    }

    const hover = hoveredId();
    const compact = graph.level >= 2;
    const ordered = graph.nodes.slice().sort((a, b) => (depths.get(a.id) || 0) - (depths.get(b.id) || 0));
    this.usedNodes.clear();
    const placed = [];
    for (const n of ordered) {
      const p = positions.get(n.id);
      if (!p || !this.onScreen(p, 50)) continue;
      const depth = depths.get(n.id) || 0;
      const rad = rads.get(n.id) ?? Math.max(1.8, n.r * cam.scale * (0.74 + depth * 0.5)) * style.nodeSize;
      const selected = n.id === ui.selection || n.id === hover;
      const external = n.kind === 'external';
      let dim = (0.38 + depth * 0.62) * age;
      if (ui.selection && n.id !== ui.selection) {
        dim *= adjacency.has(n.id) ? 0.72 * (0.38 + depth * 0.62) : 0.16 * (0.38 + depth * 0.62);
      }
      const rgb = masteryRgb(n.entity);
      this.drawNode(n.id, p.x, p.y, rad, depth, dim, selected, n.id === hover, rgb, 1, n.kind === 'point', false, t, style.nodeBrightness, compact ? 0.7 : 1, style.nodeStarSize);
      this.drawLocalLabel(graph, n, p, rad, depth, dim, selected, external, placed, t);
      if (n.id === ui.selection) this.drawRings(p.x, p.y, rad, rgb, true, t, compact);
    }
    if (!ui.selection) this.drawRings(0, 0, 0, [255, 255, 255], false, t);
    this.clearUnused();
  }

  draw3DLabel(v, p, rad, dim, selected, t, placed = null) {
    if (dim < 0.04) return;
    let show = true;
    let size = 12.5;
    if (ui.level === 'inner') {
      if (v.kind === 'center') size = 14.5;
      else if (v.kind === 'root') size = 12.2;
      else {
        size = 10.2;
        show = selected || (ui.innerGraph && ui.innerGraph.nodes.length < 15);
      }
    } else if (v.kind === 'chapter') {
      size = selected ? 11.6 : 9.6;
      show = selected || (v.depth > 0.25 && (ui.sphereScope === 2 || cam.scale > 1.25));
    } else if (v.kind === 'point') {
      size = selected ? 10.2 : 8.8;
      show = selected || (v.depth > 0.84 && cam.scale > 1.65);
    } else {
      size = selected ? 14.6 : 12.8;
      if (v.depth < 0.18 && !selected) show = false;
    }
    if (!show) return;
    size *= LABEL_SCALE;
    const x = p.x;
    if (x < -80 || p.y < -80 || x > view.w + 80 || p.y > view.h + 80) return;
    let text = v.label;
    if (v.kind === 'chapter' && !selected && text.length > 18) text = `${text.slice(0, 17)}…`;
    if (v.kind === 'point' && !selected && text.length > 14) text = `${text.slice(0, 13)}…`;
    const w = text.length * size * 0.62;
    const h = size + 4;
    const top = p.y + rad + (ui.level === 'inner' ? 10 : 11.5);
    const box = { x0: x - w / 2, x1: x + w / 2, y0: top, y1: top + h };
    if (placed) {
      if (!selected) {
        for (const r of placed) {
          if (box.x0 < r.x1 && box.x1 > r.x0 && box.y0 < r.y1 && box.y1 > r.y0) return;
        }
      }
      placed.push(box);
    }
    const label = this.getLabel(`n:${v.id}`, text, size, selected || v.kind === 'center' ? '600' : '400', rgbHex(masteryRgb(v.node)), 0);
    label.position.set(x, p.y + rad + (ui.level === 'inner' ? 10 : 11.5));
    label.alpha = clamp(dim * (v.kind === 'chapter' ? 0.34 + v.depth * 0.58 : 0.55 + v.depth * 0.55), 0.06, 1);
  }

  drawLocalLabel(graph, n, p, rad, depth, dim, selected, external, placed, t) {
    if (dim < 0.04) return;
    if (depth < 0.16 && !selected && !(graph.level === 2 && n.kind === 'point') && !external) return;
    if (n.kind === 'point' && !selected && graph.level !== 2 && cam.scale < 1.35) return;
    const size = (external
      ? 9.8
      : (n.kind === 'course' ? Math.max(12, Math.min(18, 14 * cam.scale)) : n.kind === 'chapter' ? 10.8 : 10.2) *
        (0.86 + depth * 0.22)) * LABEL_SCALE;
    const placeAbove = external && p.y > view.h * 0.72;
    let y = placeAbove ? p.y - rad - 12 : p.y + rad + (n.kind === 'course' ? 16 : 11);
    const label = this.getLabel(`n:${n.id}`, n.label, size, n.kind === 'course' ? '600' : '400', rgbHex(masteryRgb(n.entity)), 0);
    label.position.set(p.x, y);
    label.alpha = (selected ? 0.98 : external ? 0.74 : 0.8) * (0.55 + depth * 0.45);
    if (external) {
      const w = label.width;
      label.x = Math.max(w / 2 + 7, Math.min(view.w - w / 2 - 7, p.x));
    }
    if (n.kind === 'course' || n.kind === 'chapter' || external || (n.kind === 'point' && graph.level === 2)) {
      const box = { x: label.x - label.width / 2, y: label.y - 2, w: label.width, h: label.height + 4 };
      let guard = 0;
      while (guard++ < 9 && placed.some((r) => Math.abs(r.y + r.h / 2 - (box.y + box.h / 2)) < r.h + 3 && Math.abs(r.x + r.w / 2 - (box.x + box.w / 2)) < (r.w + box.w) / 2)) {
        y += size + 3;
        label.y = y;
        box.y = y - 2;
      }
      placed.push(box);
    }
  }

  onScreen(p, margin = 30) {
    return p.x > -margin && p.x < view.w + margin && p.y > -margin && p.y < view.h + margin;
  }

  /**
   * 心跳节拍：球心透光随节拍亮起又落下，每拍再从星海轮廓荡出一圈极细的柔光。
   * 透光是整片区域一起呼吸，细环只在轮廓外 1.45 倍以内扩散，两层都很轻，
   * 不会像旧版那样把潮汐环放大成粗重光带。
   */
  breathRipple() {
    const on = ui.level === 'sphere' && ui.idleModes.breathe;
    if (!on) {
      this.breathMark = -1;
      this.breathGlow.visible = false;
      return;
    }
    const pulse = ui.idlePulse || 0;
    const visuals = sceneVisuals() || [];
    // 以球心为圆心，取最远可见节点的投影距离作为轮廓半径。
    const center = worldToScreen(0, 0);
    let r0 = 80;
    for (const v of visuals) {
      const vp = worldToScreen(v.x, v.y);
      if (vp.x < -120 || vp.x > view.w + 120 || vp.y < -120 || vp.y > view.h + 120) continue;
      r0 = Math.max(r0, Math.hypot(vp.x - center.x, vp.y - center.y));
    }
    r0 += 10;

    const glow = this.breathGlow;
    glow.visible = pulse > 0.015;
    if (glow.visible) {
      const size = r0 * (2.7 + pulse * 0.4);
      glow.position.set(center.x, center.y);
      glow.width = size;
      glow.height = size;
      glow.alpha = Math.min(0.12, pulse * 0.075);
    }

    const p = ((ui.breathPhase % TAU) + TAU) % TAU;
    const prev = this.breathMark;
    this.breathMark = p;
    // 相位回绕时正好是收缩峰值：每拍只触发一次。
    if (prev < 0 || p >= prev || !visuals.length) return;
    // 纹理里的环在精灵宽度的 90% 处，所以尺寸 = 目标环直径 / 0.9。
    const ringSize = (radius) => (radius * 2) / 0.9;
    this.ambient.spawnPulseRing(center.x, center.y, ringSize(r0 * 1.02), ringSize(r0 * 1.48), 1200, 0.16, 0xd4e7ff);
  }

  /**
   * 骨架折线：把形状的主轮廓画成细细的星线。
   * 星尘负责氛围，折线负责形状识别；节点就长在这些线上。
   */
  updateSkeleton(t) {
    const g = this.skeleton;
    if (ui.level !== 'sphere' || !ui.shape) {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (this.skeletonShape !== ui.shape) {
      this.skeletonLines = shapeSkeleton(ui.shape, 100);
      this.skeletonShape = ui.shape;
    }
    g.clear();
    const R = outerRadius();
    const rot = ui.sphereRot;
    const breath = ui.idleBreath || 1;
    const gain = Math.min(1, modeGlow());
    for (const entry of this.skeletonLines) {
      const pts = Array.isArray(entry) ? entry : entry.pts;
      const weight = Array.isArray(entry) ? 1 : entry.alpha ?? 1;
      const screen = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        // 骨架线与节点共用同一套形状私有形变，轮廓和星点不会各自乱动。
        const world = shapeIdlePoint(
          ui.shape,
          { x: p.x * R * breath, y: p.y * R * breath, z: p.z * R },
          ui.shapeClock,
          R,
          ui.spherePuff
        );
        const q = projectPoint(world, rot, R);
        screen.push(worldToScreen(q.x, q.y));
      }
      const trace = () => {
        for (let i = 0; i < screen.length; i++) {
          const s = screen[i];
          if (i === 0) g.moveTo(s.x, s.y);
          else g.lineTo(s.x, s.y);
        }
      };
      // 一层宽而淡的辉光加一条细亮主线：几何骨架从关系线里跳出来，但不会太刺眼。
      trace();
      g.stroke({ width: 5.2, color: 0x7fb0ff, alpha: 0.055 * gain * weight });
      trace();
      g.stroke({ width: 1.5, color: 0xcfe3ff, alpha: 0.6 * gain * weight });
    }
  }

  /**
   * 形状骨架星尘：按当前形状采样一小批星点，让整体轮廓始终可见。
   * 切换形状时从旧位置平滑飞到新位置，投影方式与节点完全一致。
   */
  updateShapeDust(t) {
    const shape = ui.shape || 'sphere';
    const R = outerRadius();
    if (shape !== this.dustShape || !this.dustTarget) {
      this.dustFrom = this.dustShape ? new Float32Array(this.dustWorld) : null;
      this.dustTarget = new Float32Array(DUST_COUNT * 3);
      for (let i = 0; i < DUST_COUNT; i++) {
        const p = shapePoint(shape, i, DUST_COUNT);
        const k = i * 3;
        this.dustTarget[k] = p.x * R;
        this.dustTarget[k + 1] = p.y * R;
        this.dustTarget[k + 2] = p.z * R;
      }
      this.dustShape = shape;
      this.dustStart = t;
      if (!this.dustFrom) this.dustWorld.set(this.dustTarget);
    }

    const raw = clamp((t - this.dustStart) / DUST_DUR, 0, 1);
    const eased = 1 - Math.pow(1 - raw, 3);
    const breath = ui.idleBreath || 1;
    const gain = modeGlow();
    const rot = ui.sphereRot;
    // 球形保持原来的干净球面，只留一层很淡的星尘；其他形状才把骨架点亮。
    const shapeDim = shape === 'sphere' ? 0.45 : 0.62;
    // 点云在球心附近投影最密，容易糊成一团白光：靠中心的位置压暗一些。
    const center = worldToScreen(0, 0);
    const coreRef = Math.max(60, Math.min(view.w, view.h) * 0.3);
    for (let i = 0; i < DUST_COUNT; i++) {
      const k = i * 3;
      const tx = this.dustTarget[k] * breath;
      const ty = this.dustTarget[k + 1] * breath;
      const tz = this.dustTarget[k + 2];
      let x = tx;
      let y = ty;
      let z = tz;
      if (this.dustFrom) {
        const fx = this.dustFrom[k];
        const fy = this.dustFrom[k + 1];
        const fz = this.dustFrom[k + 2];
        x = fx + (tx - fx) * eased;
        y = fy + (ty - fy) * eased;
        z = fz + (tz - fz) * eased;
      }
      this.dustWorld[k] = x;
      this.dustWorld[k + 1] = y;
      this.dustWorld[k + 2] = z;

      // 星尘与节点、骨架线同步形变；存储位置保持未形变，关闭效果后不留残影。
      const world = shapeIdlePoint(shape, { x, y, z }, ui.shapeClock, R, ui.spherePuff);
      const q = projectPoint(world, rot, R);
      const s = worldToScreen(q.x, q.y);
      const sprite = this.dustSprites[i];
      sprite.position.set(s.x, s.y);
      const twinkle = 0.72 + 0.28 * Math.sin(t * 0.0011 + i * 1.7);
      const coreFade = clamp(Math.hypot(s.x - center.x, s.y - center.y) / coreRef, 0.16, 1);
      sprite.alpha = Math.min(0.8, (0.16 + q.depth * 0.36) * twinkle) * gain * shapeDim * coreFade;
      const scale = (0.055 + q.depth * 0.075) * (0.8 + (q.persp - 1) * 0.3);
      sprite.scale.set(scale);
    }
    if (raw >= 1) this.dustFrom = null;
  }

  /**
   * 场景转场：球形遮罩从 origin 展开 + 整图轻微推近/淡入。
   * 只作用于 graphRoot，星空背景与粒子层保持完整画面。
   */
  updateFx(t) {
    const fx = transitionAt(t);
    if (!fx || fx.done) {
      if (fx && fx.done) endTransition();
      if (this.graphRoot.mask) {
        this.graphRoot.mask = null;
        this.graphMask.visible = false;
      }
      this.graphRoot.alpha = 1;
      this.graphRoot.scale.set(1);
      this.graphRoot.position.set(0, 0);
      this.graphRoot.pivot.set(0, 0);
      return;
    }
    const { origin, eased, raw, kind } = fx;
    const expand = kind === 'intro' || kind === 'local';
    if (expand) {
      const radius = Math.max(0, coverRadius(origin) * eased);
      this.graphMask.clear();
      if (radius > 0.5) {
        this.graphMask.circle(origin.x, origin.y, radius).fill({ color: 0xffffff });
        this.graphMask.visible = true;
        this.graphRoot.mask = this.graphMask;
      }
    } else if (this.graphRoot.mask) {
      this.graphRoot.mask = null;
      this.graphMask.visible = false;
    }
    // 以转场原点为支点：图从点击处轻轻推近，而不是整屏平移。
    const s = kind === 'intro' ? 0.9 + eased * 0.1 : 0.94 + eased * 0.06;
    this.graphRoot.pivot.set(origin.x, origin.y);
    this.graphRoot.position.set(origin.x, origin.y);
    this.graphRoot.scale.set(s);
    this.graphRoot.alpha = clamp(raw * 4.5, 0, 1);
  }

  render(t, dt) {
    this.backdrop.update(t, dt);
    this.ambient.update(dt, t);
    this.breathRipple();
    this.updateFx(t);
    if (isLocal()) {
      this.shapeDust.visible = false;
      this.skeleton.visible = false;
      this.drawGraphLocal(t, dt);
    } else {
      this.shapeDust.visible = true;
      this.updateSkeleton(t);
      this.updateShapeDust(t);
      this.drawGraph3D(t, dt);
    }
    this.app.renderer.render(this.app.stage);
  }

  stats() {
    return {
      nodes: this.nodes.size,
      labels: this.labels.size,
      ambient: this.ambient.stats()
    };
  }
}

function targetResolution() {
  // 按画质预算限制渲染倍率，避免高 DPI 屏幕上像素预算被撑爆。
  const q = quality();
  const area = Math.max(1, view.w * view.h);
  const budgetScale = Math.sqrt((q.three.pixelBudget * 1_000_000) / area);
  return Math.max(0.8, Math.min(MAX_SCALE, budgetScale));
}

export async function initWebGLScene(canvas) {
  const app = new Application();
  await app.init({
    canvas,
    width: Math.max(1, view.w),
    height: Math.max(1, view.h),
    backgroundAlpha: 0,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    resolution: targetResolution(),
    preference: 'webgl',
    powerPreference: 'high-performance'
  });
  app.ticker.stop();
  const scene = new WebGLScene(app);
  scene.resize();
  return {
    bind(stage) {
      scene.bind(stage);
    },
    resize() {
      scene.resize();
    },
    render(t, dt) {
      scene.render(t, dt);
    },
    stats() {
      return scene.stats();
    },
    scene
  };
}