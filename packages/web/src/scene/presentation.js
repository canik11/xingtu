// 放映模式：星雨落盘 → 课程降临（咚 + 心跳 + 涟漪）→ 星棋点亮 → 未掌握转掌握 → 汇聚成 3D 球。
// 完全接管 WebGL 场景的节点绘制，只保留星空、星尘与流星；退出后由 gl-scene 恢复常规渲染。
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { clamp } from '@starmap/core';
import { cam, ui, view } from '../state.js';
import { animateTo, snapTo, worldToScreen } from '../camera.js';
import { projectPoint, sceneVisuals } from '../hierarchy.js';
import { getOutline } from '../outline.js';
import { appearanceColors, masteryFor, scaledAppearance } from '../mastery.js';
import { coreTexture, glowTexture, nodeStarTexture } from './gl-textures.js';

const FONT =
  '"Segoe UI Variable Text","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// 时间线（毫秒）。整体约 35 秒的连续长镜头。
const T = {
  enter: 900, // 黑场淡入到第一颗星棋出现
  firstFall: 2200, // 第一颗单独下落，镜头跟随
  rainGap: 900, // 第一颗落地到星雨加速的间隔
  rainSpan: 6200, // 知识点雨的总跨度（越到后面越密）
  fall: 1500, // 常规下落时长
  chapterGap: 420,
  chapterSpan: 2100,
  chapterFall: 1150,
  courseGap: 520,
  courseFall: 1150,
  boomHold: 2400, // “咚”之后留给心跳与涟漪的时间
  igniteSpan: 3200,
  turnGap: 520,
  turnSpan: 6200,
  gatherLead: 800,
  gatherSpan: 6400
};

const DEPTH_R = { 1: 300, 2: 370, 3: 420 };
// 汇聚时把球收紧一点，三门课程才不会散成三个孤岛。
const BALL_TIGHTEN = 0.82;

const rgbHex = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
const mixRgb = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
];
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 稳定哈希：同一个 id 每次进入放映都得到同样的落点与节奏。 */
function rand(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * 平面落点：知识点铺成外圈，章节居中，课程落在盘心。
 * 横向放宽、纵向压扁，看起来像一块平放的星盘，雨点落上去有透视感。
 */
function layoutLanding(nodes) {
  const radii = { 1: 92, 2: 200, 3: 336 };
  const groups = { 1: [], 2: [], 3: [] };
  for (const n of nodes) groups[n.level].push(n);
  for (const level of [1, 2, 3]) {
    const items = groups[level];
    const count = items.length;
    items.forEach((n, index) => {
      const spread = 0.3 + 0.7 * Math.sqrt((index + 0.55) / Math.max(1, count));
      const angle = index * GOLDEN + rand(n.id, 3) * 1.5;
      const radius = radii[level] * spread;
      n.landX = Math.cos(angle) * radius * 1.24 + (rand(n.id, 5) - 0.5) * 30;
      n.landY = Math.sin(angle) * radius * 0.55 + (rand(n.id, 9) - 0.5) * 18;
      n.startY = n.landY - 1500;
    });
  }

  // 简易松弛，避免落点叠在一起。
  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.landX - a.landX;
        const dy = b.landY - a.landY;
        const dist = Math.hypot(dx, dy) || 0.001;
        const min = a.level === 3 && b.level === 3 ? 19 : 27;
        if (dist >= min) continue;
        const push = ((min - dist) / dist) * 0.5;
        a.landX -= dx * push;
        a.landY -= dy * push;
        b.landX += dx * push;
        b.landY += dy * push;
      }
    }
  }
}

export class PresentationScene {
  constructor() {
    this.root = new Container();
    this.root.eventMode = 'none';
    this.root.visible = false;

    this.ringLayer = new Container();
    this.pulseLayer = new Container();
    this.linkLayer = new Container();
    this.trailLayer = new Container();
    this.glowLayer = new Container();
    this.flareLayer = new Container();
    this.coreLayer = new Container();
    this.labelLayer = new Container();

    // 心跳时整片星空跟着一起亮一下。
    this.heartGlow = new Sprite(glowTexture());
    this.heartGlow.anchor.set(0.5);
    this.heartGlow.blendMode = 'add';
    this.heartGlow.tint = 0x9fd6ff;
    this.heartGlow.visible = false;
    this.pulseLayer.addChild(this.heartGlow);

    // 汇聚成形后，球心透出一点体积光，星团才不像三簇孤立的星座。
    this.orbGlow = new Sprite(glowTexture());
    this.orbGlow.anchor.set(0.5);
    this.orbGlow.blendMode = 'add';
    this.orbGlow.tint = 0xbcd6ff;
    this.orbGlow.visible = false;
    this.pulseLayer.addChild(this.orbGlow);

    this.root.addChild(
      this.pulseLayer,
      this.ringLayer,
      this.linkLayer,
      this.trailLayer,
      this.glowLayer,
      this.flareLayer,
      this.coreLayer,
      this.labelLayer
    );

    this.links = new Graphics();
    this.links.blendMode = 'add';
    this.linkLayer.addChild(this.links);

    this.trails = new Graphics();
    this.trails.blendMode = 'add';
    this.trailLayer.addChild(this.trails);

    this.scene = null;
    this.nodes = [];
    this.byId = new Map();
    this.waves = [];
    this.labels = [];
    this.active = false;
    this.mounted = false;
    this.time = 0;
    this.stage = '';
    this.tl = null;
    this.boomFired = false;
    this.onStage = null;
    this.onEvent = null;
    this.fitCache = 0;
    this.fitCacheAt = -1e9;
  }

  /* ---------------------------------------------------------------- 生命周期 */

  start(scene, options = {}) {
    this.scene = scene;
    this.onStage = options.onStage || null;
    this.onEvent = options.onEvent || null;
    this.time = 0;
    this.stage = '';
    this.boomFired = false;
    this.active = true;
    this.fitCacheAt = -1e9;

    this.mount(scene);
    this.clearLayers();
    this.buildNodes();
    this.buildWaves();
    this.buildLinks();
    this.buildTimeline();

    if (this.tl.first) {
      snapTo(this.tl.first.landX, this.tl.first.landY + 60, 1.55);
    }
    this.emitStage('enter');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.stage = '';
    this.unmount();
  }

  mount(scene) {
    if (this.mounted) {
      this.root.visible = true;
      return;
    }
    // 插在星空之后、暗角/颗粒覆盖层之前：星棋在星盘之上，但仍被暗角压暗。
    const anchor = scene.backdrop && scene.backdrop.root;
    const at = anchor && anchor.parent === scene.root ? scene.root.children.indexOf(anchor) + 1 : scene.root.children.length;
    scene.root.addChildAt(this.root, Math.max(0, at));
    this.mounted = true;
    this.root.visible = true;
    scene.resetScene();
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    this.root.visible = false;
    if (this.root.parent) this.root.parent.removeChild(this.root);
  }

  clearLayers() {
    for (const layer of [this.ringLayer, this.linkLayer, this.trailLayer, this.glowLayer, this.flareLayer, this.coreLayer, this.labelLayer]) {
      const removed = layer.removeChildren();
      for (const child of removed) child.destroy();
    }
    this.links = new Graphics();
    this.links.blendMode = 'add';
    this.linkLayer.addChild(this.links);
    this.trails = new Graphics();
    this.trails.blendMode = 'add';
    this.trailLayer.addChild(this.trails);
    this.nodes = [];
    this.byId = new Map();
    this.waves = [];
    this.labels = [];
  }

  /* ------------------------------------------------------------------ 构建 */

  buildNodes() {
    const visuals = sceneVisuals() || [];
    const list = visuals
      .filter((v) => v && v.wx !== undefined)
      .map((v) => {
        const palette = appearanceColors(v.node);
        const ratio = masteryFor(v.node);
        const n = {
          id: v.id,
          entity: v.node,
          level: v.level,
          kind: v.kind,
          label: v.label,
          wx: v.wx,
          wy: v.wy,
          wz: v.wz,
          depthRadius: DEPTH_R[v.level] || 420,
          baseR: v.r,
          hash: rand(v.id, 1),
          palette,
          ratio,
          // 点亮时先呈现“当前知识库”的真实状态：未掌握偏冷白，已掌握是金色。
          baseRgb: mixRgb(palette.defaultRgb, palette.masteredRgb, clamp(ratio, 0, 1)),
          masteredRgb: palette.masteredRgb.slice(),
          lit: 0,
          flash: 0,
          turnK: 0,
          landed: false,
          inAir: false,
          curX: v.wx,
          curY: v.wy,
          sx: -1e5,
          sy: -1e5,
          dropStart: 0,
          fallDur: T.fall,
          landX: 0,
          landY: 0,
          startY: 0,
          lightAt: rand(v.id, 11) * 0.84,
          turnAt: rand(v.id, 17) * 0.76,
          sprites: null,
          labelSprite: null
        };
        const halo = new Sprite(glowTexture());
        halo.anchor.set(0.5);
        halo.blendMode = 'add';
        const core = new Sprite(coreTexture());
        core.anchor.set(0.5);
        const flare = new Sprite(nodeStarTexture());
        flare.anchor.set(0.5);
        flare.blendMode = 'add';
        halo.visible = core.visible = flare.visible = false;
        this.glowLayer.addChild(halo);
        this.flareLayer.addChild(flare);
        this.coreLayer.addChild(core);
        n.sprites = { halo, core, flare };
        if (v.level <= 2) n.labelSprite = this.makeLabel(v.label, v.level === 1 ? 13.5 : 10.5);
        return n;
      });

    // 按课程分组排布点亮/变色的先后，形成从盘心向外扫过的秩序。
    this.nodes = list;
    this.byId = new Map(list.map((n) => [n.id, n]));
    layoutLanding(list);
  }

  makeLabel(text, size) {
    const label = new Text({
      text,
      style: {
        fontFamily: FONT,
        fontSize: size,
        fontWeight: size > 12 ? '600' : '400',
        fill: 0xdfeaff,
        stroke: { color: 0x030812, width: 3 },
        lineJoin: 'round',
        align: 'center'
      }
    });
    label.anchor.set(0.5, 0);
    label.visible = false;
    this.labelLayer.addChild(label);
    this.labels.push(label);
    return label;
  }

  buildWaves() {
    for (let i = 0; i < 8; i++) {
      const g = new Graphics();
      g.blendMode = 'add';
      this.ringLayer.addChild(g);
      this.waves.push({ g, tint: 0xffffff, life: 0, max: 0, dur: 1, delay: 0, r0: 0, reach: 0, r: 0, k: -1, cx: 0, cy: 0, alpha0: 0 });
    }
  }

  buildLinks() {
    this.linkPairs = (getOutline().hierarchy || [])
      .map((e) => [e.a, e.b])
      .filter(([a, b]) => this.byId.has(a) && this.byId.has(b));
  }

  buildTimeline() {
    const groups = [
      { level: 3, items: this.nodes.filter((n) => n.level === 3), span: T.rainSpan, fall: T.fall, gap: T.rainGap },
      { level: 2, items: this.nodes.filter((n) => n.level === 2), span: T.chapterSpan, fall: T.chapterFall, gap: T.chapterGap },
      { level: 1, items: this.nodes.filter((n) => n.level === 1), span: 0, fall: T.courseFall, gap: T.courseGap }
    ];

    const tl = {
      enter: T.enter,
      levelAt: {},
      first: null,
      firstStart: T.enter,
      firstLand: T.enter,
      boom: 0,
      ignite: 0,
      turn: 0,
      gather: 0,
      settle: 0
    };

    let cursor = T.enter;
    let started = false;

    for (const group of groups) {
      if (!group.items.length) continue;
      if (!started) {
        const head = group.items[0];
        head.dropStart = cursor;
        head.fallDur = T.firstFall;
        head.head = true;
        tl.first = head;
        cursor += T.firstFall;
        started = true;
        group.start = cursor + T.rainGap;
      } else {
        group.start = cursor + group.gap;
      }

      const rest = group.items.filter((n) => !n.head);
      rest.forEach((n, i) => {
        const count = rest.length;
        const p = count > 1 ? i / (count - 1) : 0;
        // 前疏后密：雨越下越急。
        n.dropStart = group.start + group.span * (1 - Math.pow(1 - p, 2.4));
        n.fallDur = group.fall;
      });

      tl.levelAt[group.level] = Math.min(...group.items.map((n) => n.dropStart));
      const lastDrop = group.items.reduce((max, n) => Math.max(max, n.dropStart + n.fallDur), 0);
      cursor = Math.max(cursor, lastDrop);
    }

    if (tl.first) {
      tl.firstStart = tl.first.dropStart;
      tl.firstLand = tl.first.dropStart + tl.first.fallDur;
    }
    tl.boom = this.nodes.reduce((max, n) => Math.max(max, n.dropStart + n.fallDur), 0);
    tl.ignite = tl.boom + T.boomHold;
    tl.turn = tl.ignite + T.igniteSpan + T.turnGap;
    tl.gather = tl.turn + T.turnSpan - T.gatherLead;
    tl.settle = tl.gather + T.gatherSpan;
    this.tl = tl;
  }

  /* ------------------------------------------------------------------ 渲染 */

  render(scene, t, dt) {
    if (!this.active) return;
    this.scene = scene;
    this.time += dt;
    const el = this.time;

    this.spin(dt);
    this.emitStage(this.stageAt(el));
    if (el >= this.tl.boom && !this.boomFired) this.fireBoom(el);

    this.updateWaves(dt);
    this.updateHeartGlow(el);
    this.updateOrbGlow(el);
    this.updateNodes(el, dt);
    this.drawTrails(el);
    this.updateCamera(el);
    this.updateLabels(el);
    this.drawLinks(el);
  }

  /** 下落中的星棋拖一条淡蓝尾迹，让"雨"看得出来。 */
  drawTrails(el) {
    const g = this.trails;
    g.clear();
    for (const n of this.nodes) {
      if (!n.inAir) continue;
      if (n.sx < -140 || n.sx > view.w + 140 || n.sy < -260 || n.sy > view.h + 200) continue;
      const fallP = clamp((el - n.dropStart) / Math.max(1, n.fallDur), 0, 1);
      const tail = 20 + 210 * (1 - fallP) * (1 - fallP);
      const alpha = 0.08 + 0.3 * (1 - fallP);
      g.moveTo(n.sx, n.sy - 2).lineTo(n.sx, n.sy - tail).stroke({
        width: 0.8 + 1.6 * (1 - fallP),
        color: 0xa9c8ff,
        alpha,
        cap: 'round'
      });
    }
  }

  stageAt(el) {
    const tl = this.tl;
    if (el >= tl.settle) return 'settle';
    if (el >= tl.gather) return 'gather';
    if (el >= tl.turn) return 'turn';
    if (el >= tl.ignite) return 'ignite';
    if (el >= tl.boom) return 'boom';
    if (tl.levelAt[1] !== undefined && el >= tl.levelAt[1]) return 'drop1';
    if (tl.levelAt[2] !== undefined && el >= tl.levelAt[2]) return 'drop2';
    if (tl.levelAt[3] !== undefined && el >= tl.levelAt[3]) return 'drop3';
    return 'enter';
  }

  emitStage(next) {
    if (!next || next === this.stage) return;
    this.stage = next;
    if (this.onStage) this.onStage(next);
  }

  /* --------------------------------------------------------------- 降临时刻 */

  updateHeartGlow(el) {
    const hb = this.heartbeat(el);
    const g = this.heartGlow;
    if (hb < 0.02) {
      g.visible = false;
      return;
    }
    const size = Math.max(view.w, view.h) * 2.1;
    g.visible = true;
    g.position.set(view.w / 2, view.h / 2);
    g.width = g.height = size;
    g.alpha = Math.min(0.17, hb * 0.15);
  }

  updateOrbGlow(el) {
    const tl = this.tl;
    const k = clamp((el - tl.gather) / T.gatherSpan, 0, 1);
    const g = this.orbGlow;
    if (k <= 0.02) {
      g.visible = false;
      return;
    }
    const c = worldToScreen(0, 0);
    const radius = 300 * BALL_TIGHTEN * cam.scale;
    g.visible = true;
    g.position.set(c.x, c.y);
    g.width = g.height = radius * 2.2;
    g.alpha = 0.1 * easeInOutCubic(k);
  }

  fireBoom(el) {
    this.boomFired = true;
    const center = worldToScreen(0, 0);
    const reach = Math.hypot(view.w, view.h) * 0.46;
    const ringTint = [0x9fd6ff, 0xbfe4ff, 0xd8ecff, 0xffffff];
    const delays = [0, 420, 900, 1500];
    for (let i = 0; i < delays.length; i++) {
      this.spawnWave(center.x, center.y, delays[i], 3200, 0.46 - i * 0.06, ringTint[i], reach * (0.94 + i * 0.06), 26);
    }
    for (const n of this.nodes) {
      if (n.level === 1) {
        n.flash = 1;
        n.landed = true;
      }
    }
    if (this.onEvent) this.onEvent('boom', { at: el });
  }

  spawnWave(cx, cy, delay, duration, alpha0, tint, reach, r0 = 20) {
    const w = this.waves.find((item) => item.life <= 0);
    if (!w) return;
    w.life = duration + delay;
    w.max = duration + delay;
    w.dur = duration;
    w.delay = delay;
    w.r0 = r0;
    w.reach = reach;
    w.r = r0;
    w.k = -1;
    w.cx = cx;
    w.cy = cy;
    w.alpha0 = alpha0;
    w.tint = tint;
    w.g.clear();
  }

  updateWaves(dt) {
    for (const w of this.waves) {
      if (w.life <= 0) {
        w.k = -1;
        w.g.visible = false;
        continue;
      }
      w.life -= dt;
      const elapsed = w.max - w.life;
      if (elapsed < w.delay || w.life <= 0) {
        w.g.visible = false;
        continue;
      }
      const k = clamp((elapsed - w.delay) / Math.max(1, w.dur), 0, 1);
      w.k = k;
      if (k >= 1) {
        w.g.visible = false;
        w.g.clear();
        continue;
      }
      const ease = easeOutCubic(k);
      w.r = w.r0 + (w.reach - w.r0) * ease;
      const alpha = w.alpha0 * Math.pow(1 - k, 1.7);
      const g = w.g;
      g.visible = true;
      g.clear();
      // 水波是一道极细的亮环，外沿再带一圈晕开的柔光。
      g.circle(w.cx, w.cy, w.r).stroke({ width: 1.8, color: w.tint, alpha: Math.min(1, alpha * 1.6) });
      g.circle(w.cx, w.cy, w.r).stroke({ width: 14, color: w.tint, alpha: alpha * 0.2 });
      g.circle(w.cx, w.cy, w.r * 0.985).stroke({ width: 30, color: w.tint, alpha: alpha * 0.06 });
    }
  }

  /* ------------------------------------------------------------------ 心跳 */

  heartbeat(el) {
    const tl = this.tl;
    let value = 0;
    for (const beat of [0, 560, 1280]) {
      const x = el - (tl.boom + beat);
      if (x >= 0 && x < 1300) value += Math.exp(-Math.pow(x / 240, 2));
    }
    if (el > tl.settle) {
      const cycle = ((el - tl.settle) % 2800) / 2800;
      value += Math.exp(-Math.pow((cycle - 0.05) / 0.09, 2)) * 0.45;
    }
    return clamp(value, 0, 1.7);
  }

  /* ------------------------------------------------------------------ 节点 */

  ballPoint(n) {
    const p = projectPoint({ x: n.wx, y: n.wy, z: n.wz }, ui.sphereRot, n.depthRadius);
    return {
      x: p.x * BALL_TIGHTEN,
      y: p.y * BALL_TIGHTEN,
      z: p.z * BALL_TIGHTEN,
      persp: p.persp,
      depth: p.depth
    };
  }

  updateNodes(el, dt) {
    const style = scaledAppearance();
    const tl = this.tl;
    const hb = this.heartbeat(el);
    const gatherP = clamp((el - tl.gather) / T.gatherSpan, 0, 1);
    const gatherK = easeInOutCubic(gatherP);
    const litP = clamp((el - tl.ignite) / T.igniteSpan, 0, 1);
    const turnP = clamp((el - tl.turn) / T.turnSpan, 0, 1);
    let waveOn = false;
    for (const w of this.waves) if (w.k > 0 && w.k < 1) waveOn = true;

    for (const n of this.nodes) {
      const fallP = clamp((el - n.dropStart) / Math.max(1, n.fallDur), 0, 1);
      if (fallP <= 0) {
        this.hideNode(n);
        continue;
      }
      const drop = fallP * fallP;
      n.inAir = fallP < 1;

      let wx;
      let wy;
      let depth;
      if (n.inAir) {
        wx = n.landX + Math.sin(fallP * 6.4 + n.hash * 7) * 12 * (1 - fallP);
        wy = lerp(n.startY, n.landY, drop);
        depth = 0.62;
      } else if (gatherK > 0.0001) {
        const ball = this.ballPoint(n);
        wx = lerp(n.landX, ball.x, gatherK);
        wy = lerp(n.landY, ball.y, gatherK);
        depth = lerp(0.62, ball.depth, gatherK);
        n.ball = ball;
      } else {
        wx = n.landX;
        wy = n.landY;
        depth = 0.62;
      }
      n.curX = wx;
      n.curY = wy;

      if (!n.landed && !n.inAir) this.land(n);

      const p = worldToScreen(wx, wy);
      n.sx = p.x;
      n.sy = p.y;

      const lit = easeOutCubic(clamp((litP - n.lightAt) / 0.17, 0, 1));
      n.lit = lit;
      const turnK = easeInOutCubic(clamp((turnP - n.turnAt) / 0.23, 0, 1));
      n.turnK = turnK;
      const color = mixRgb(n.baseRgb, n.masteredRgb, turnK);

      // 落地闪光 + 涟漪波前经过时的闪烁。
      n.flash = Math.max(0, n.flash - dt / 520);
      let flash = n.flash;
      if (waveOn) flash = Math.max(flash, this.waveFlash(n));
      if (lit > 0.02 && !n.litFired) {
        n.litFired = true;
        flash = Math.max(flash, 0.85);
      }

      const rad = Math.max(2.2, n.baseR * cam.scale * (0.62 + depth * 0.72) * style.nodeSize * 1.9);
      if (p.x < -160 || p.x > view.w + 160 || p.y < -260 || p.y > view.h + 160) {
        this.hideNode(n, true);
        continue;
      }
      this.paint(n, rad, depth, lit, color, flash, hb, style);
    }
  }

  land(n) {
    n.landed = true;
    n.flash = 1;
    const p = worldToScreen(n.landX, n.landY);
    const ambient = this.scene && this.scene.ambient;
    if (!ambient) return;
    const count = n.level === 1 ? 7 : n.level === 2 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 18 + Math.random() * 46;
      ambient.spawnSpark(
        p.x + Math.cos(angle) * 3,
        p.y + Math.sin(angle) * 3,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 18,
        0.5 + Math.random() * 0.9,
        340 + Math.random() * 340
      );
    }
  }

  waveFlash(n) {
    let value = 0;
    for (const w of this.waves) {
      if (w.k <= 0 || w.k >= 1) continue;
      const dist = Math.hypot(n.sx - w.cx, n.sy - w.cy);
      const delta = Math.abs(dist - w.r);
      if (delta > 170) continue;
      value = Math.max(value, (1 - delta / 170) * Math.pow(1 - w.k, 1.35) * 2.2);
    }
    return value;
  }

  paint(n, rad, depth, lit, color, flash, hb, style) {
    const { halo, core, flare } = n.sprites;
    const twinkle = 0.55 + 0.45 * Math.sin(this.time * (0.001 + (n.hash % 7) * 0.00008) + n.hash * 9);
    const gain = style.nodeBrightness;
    const pulse = 1 + hb * 0.45;
    const air = n.inAir ? 0.26 : 0;
    // 未点亮也要看得见：一点点冷调的微光，点亮后再亮起来。
    const glow = clamp(0.28 + lit * 0.9 + air, 0, 1.3);
    const tint = rgbHex(mixRgb([150, 180, 232], color, clamp(lit * 1.5, 0, 1)));
    const coreColor = rgbHex(color);

    const haloSize = rad * 5.6 * (1 + flash * 0.55) * (0.88 + depth * 0.24);
    halo.visible = haloSize > 3;
    if (halo.visible) {
      halo.position.set(n.sx, n.sy);
      halo.width = halo.height = haloSize;
      halo.alpha = Math.min(0.52, (0.085 + depth * 0.075 + glow * (0.11 + depth * 0.15)) * gain * pulse * (1 + flash * 1.3));
      halo.tint = tint;
    }

    const coreSize = rad * 2;
    core.visible = coreSize > 0.8;
    if (core.visible) {
      core.position.set(n.sx, n.sy);
      core.width = core.height = coreSize;
      core.alpha = Math.min(1, (0.36 + 0.5 * glow) * (0.62 + depth * 0.38) * gain * (1 + flash * 0.6));
      core.tint = coreColor;
    }

    const flareMul = n.level === 3 ? 5.4 : 6.4;
    const flareSize = rad * flareMul * style.nodeStarSize * (0.9 + 0.1 * twinkle) * (1 + flash * 0.75) * (1 + hb * 0.22);
    flare.visible = flareSize > 2.4;
    if (flare.visible) {
      flare.position.set(n.sx, n.sy);
      flare.width = flare.height = flareSize;
      flare.alpha = Math.min(0.94, (0.24 + 0.58 * glow) * (0.52 + depth * 0.48) * gain * (0.58 + 0.42 * twinkle) * (1 + flash * 1.6));
      flare.tint = coreColor;
    }
  }

  hideNode(n, keepFlash = false) {
    const { halo, core, flare } = n.sprites;
    halo.visible = core.visible = flare.visible = false;
    n.sx = -1e5;
    n.sy = -1e5;
    if (!keepFlash) n.flash = 0;
  }

  /* ------------------------------------------------------------------ 标签 */

  updateLabels(el) {
    const tl = this.tl;
    const fade = clamp((el - tl.ignite - 500) / 1400, 0, 1);
    if (fade <= 0) {
      for (const n of this.nodes) if (n.labelSprite) n.labelSprite.visible = false;
      return;
    }
    const nodeSize = scaledAppearance().nodeSize;
    const placed = [];
    // 课程名先占位，章节名让开，避免压在一起。
    const ordered = this.nodes.slice().sort((a, b) => a.level - b.level);
    for (const n of ordered) {
      const label = n.labelSprite;
      if (!label) continue;
      const onScreen = n.lit > 0.55 && n.sx > -80 && n.sx < view.w + 80 && n.sy > -60 && n.sy < view.h + 60;
      if (!onScreen) {
        label.visible = false;
        continue;
      }
      const rad = Math.max(2.2, n.baseR * cam.scale * (0.62 + 0.72 * 0.7) * nodeSize * 1.9);
      const x = n.sx;
      const y = n.sy + rad + 9;
      // 底部留给字幕，章节名不要压上去。
      if (n.level > 1 && y > view.h * 0.84) {
        label.visible = false;
        continue;
      }
      const w = label.width || 40;
      const h = label.height || 14;
      const rect = { x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h };
      const clash = placed.some((p) => !(rect.x1 < p.x0 || rect.x0 > p.x1 || rect.y1 < p.y0 || rect.y0 > p.y1));
      if (n.level > 1 && clash) {
        label.visible = false;
        continue;
      }
      placed.push(rect);
      label.visible = true;
      label.position.set(x, y);
      label.alpha = fade * (n.level === 1 ? 0.9 : 0.5);
    }
  }

  /* ------------------------------------------------------------------ 关系 */

  drawLinks(el) {
    const g = this.links;
    g.clear();
    if (!this.linkPairs.length) return;
    const tl = this.tl;
    const k = clamp((el - tl.gather - 600) / (T.gatherSpan * 0.7), 0, 1);
    if (k <= 0) return;
    const alpha = 0.26 * k;
    for (const [a, b] of this.linkPairs) {
      const na = this.byId.get(a);
      const nb = this.byId.get(b);
      if (!na || !nb || na.sx < -200 || nb.sx < -200) continue;
      g.moveTo(na.sx, na.sy).lineTo(nb.sx, nb.sy).stroke({ width: 1.15, color: 0x9fc4ff, alpha });
    }
  }

  /* ------------------------------------------------------------------ 相机 */

  fitScale() {
    if (this.time - this.fitCacheAt < 220) return this.fitCache;
    let maxX = 1;
    let maxY = 1;
    for (const n of this.nodes) {
      const p = projectPoint({ x: n.wx, y: n.wy, z: n.wz }, ui.sphereRot, n.depthRadius);
      maxX = Math.max(maxX, Math.abs(p.x) * BALL_TIGHTEN);
      maxY = Math.max(maxY, Math.abs(p.y) * BALL_TIGHTEN);
    }
    const sx = (view.w * 0.94) / (2 * maxX);
    const sy = (view.h * 0.92) / (2 * maxY);
    this.fitCache = clamp(Math.min(sx, sy), 0.36, 1.85);
    this.fitCacheAt = this.time;
    return this.fitCache;
  }

  /** 落地阶段按落点的包围盒铺满屏幕，别让星盘缩成一小团。 */
  landScale() {
    let maxX = 1;
    let maxY = 1;
    for (const n of this.nodes) {
      const pad = n.baseR * 3;
      maxX = Math.max(maxX, Math.abs(n.landX) + pad);
      maxY = Math.max(maxY, Math.abs(n.landY) + pad);
    }
    return clamp(Math.min((view.w * 0.9) / (2 * maxX), (view.h * 0.82) / (2 * maxY)), 0.4, 2.2);
  }

  updateCamera(el) {
    const tl = this.tl;
    const first = tl.first;
    if (!first) return;
    const global = this.fitScale();
    const land = this.landScale();
    const hold = tl.firstLand + 900;

    if (el < hold) {
      // 镜头跟着第一颗星棋从上往下落，星空在身后缓缓流过。
      animateTo(first.curX, first.curY + 96, 1.55);
      return;
    }

    const p = clamp((el - hold) / Math.max(1, tl.boom - hold), 0, 1);
    const e = easeOutCubic(p);
    let scale = lerp(1.55, land, e);
    let cx = lerp(first.landX, 0, e);
    let cy = lerp(first.landY + 96, 0, e);
    if (el > tl.gather) {
      const g = clamp((el - tl.gather) / T.gatherSpan, 0, 1);
      const ge = easeInOutCubic(g);
      scale = lerp(land, global * 0.94, ge);
      cx = lerp(cx, 0, ge);
      cy = lerp(cy, 0, ge);
    }
    animateTo(cx, cy, scale);
  }

  /** 汇聚阶段缓慢自转，让球体有体积感。 */
  spin(dt) {
    if (!this.active || !this.tl) return;
    if (this.time < this.tl.gather) return;
    const k = clamp((this.time - this.tl.gather) / T.gatherSpan, 0, 1);
    ui.sphereRot.y += dt * 0.000048 * (0.35 + 0.65 * k);
  }
}