// 多级星图：外层 3D 球 → 局部标题图 → 内部 3D 笔记树。
// 只负责“几何与层级数据”，不碰 DOM / 相机；交互与面板由上层编排。
import { TAU, clamp, hashStr } from '@starmap/core';
import { cam, ui } from './state.js';
import { data } from './store.js';
import { worldToScreen } from './camera.js';
import { getOutline, chaptersOf, pointsOf } from './outline.js';
import { shapePoint, shapeCloudDir, shapePath, shapeTangent, shapeIdlePoint } from './shapes.js';

const OUTER_R = 300;
/** 非球形时把整棵树铺到更大的骨架半径上，形状不会缩在屏幕中央。 */
const SHAPE_OUTER = 392;
/**
 * 各级节点半径的比例：5 : 3 : 2 : 1（四级及以后都按 1 份算）。
 * 星海的课程 / 章节 / 知识点分别对应第 1 / 2 / 3 级；
 * 外观设置里的“节点大小”滑杆再对这里的结果统一乘一次。
 */
const LEVEL_PARTS = Object.freeze([5, 3, 2]);
const LEVEL_UNIT = 1.225;

/** 第 level 级（从 1 起）的基准半径；超出比例表的层级统一按 1 份算。 */
export function levelRadius(level) {
  const parts = LEVEL_PARTS[level - 1] || 1;
  return parts * LEVEL_UNIT;
}
const INNER_R = 250;
const FOCAL = 920;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const UP = { x: 0, y: 1, z: 0 };

/** 当前形状对应的星海外半径：球形保持原球面，其他形状用更大的骨架。 */
export function outerRadius() {
  return ui.shape === 'sphere' ? OUTER_R : SHAPE_OUTER;
}

/** 当前层级：sphere | local | inner。 */
export function getLevel() {
  return ui.level;
}

export function is3DLevel() {
  return ui.level === 'sphere' || ui.level === 'inner';
}

/**
 * 在单位球上取第 i 个点（Fibonacci 分布，稳定且均匀）。
 * @param {number} i
 * @param {number} count
 * @param {number} phase
 */
function fibonacci(i, count, phase = 0) {
  if (count <= 1) return { x: 0, y: 0, z: 1 };
  const y = 1 - (i / (count - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * i + phase;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function norm(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function rand01(id, salt) {
  return (hashStr(`${id}|${salt}`) % 1000000) / 1000000;
}

function sphereOffset(id) {
  return ui.sphereOffsets.get(id) || { x: 0, y: 0, z: 0 };
}

/** 稳定的随机单位向量，用于打散章节与知识点的散落方向。 */
function randDir(id, salt) {
  const u = rand01(id, `${salt}:u`);
  const v = rand01(id, `${salt}:v`);
  const theta = u * TAU;
  const z = v * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: Math.cos(theta) * r, y: z, z: Math.sin(theta) * r };
}

/** 绕 Y 轴再绕 X 轴旋转，返回透视后的世界坐标。 */
export function projectPoint(p, rot, radius) {
  const cy = Math.cos(rot.y);
  const sy = Math.sin(rot.y);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const cx = Math.cos(rot.x);
  const sx = Math.sin(rot.x);
  const y1 = p.y * cx - z1 * sx;
  const z2 = p.y * sx + z1 * cx;
  const persp = clamp(FOCAL / (FOCAL - z2), 0.55, 2.2);
  return {
    x: x1 * persp,
    y: y1 * persp,
    z: z2,
    persp,
    depth: clamp((z2 / radius + 1) / 2, 0, 1)
  };
}

let layoutCache = null;

/**
 * 非球形：整棵树沿 shapePath 骨架生长。
 * 每门课程占路径的一段，课程点在段中心，章节向两侧展开，知识点再细分。
 * 这样节点越多越沿骨架铺开，而不是挤在中心糊成一团。
 */
function shapeLayout() {
  const outline = getOutline();
  if (
    layoutCache &&
    layoutCache.outline === outline &&
    layoutCache.shape === ui.shape &&
    layoutCache.scope === ui.sphereScope
  ) {
    return layoutCache.map;
  }
  const map = new Map();
  const courses = outline.courses;
  const n = Math.max(1, courses.length);
  const shape = ui.shape;

  const place = (id, t, spread) => {
    const p = shapePath(shape, t);
    const tan = shapeTangent(shape, t);
    const dir = randDir(id, 'shape-cloud');
    // 去掉切向分量，只在骨架的法平面里抖动，让节点贴着路径但不排成一条死线。
    const dot = dir.x * tan.x + dir.y * tan.y + dir.z * tan.z;
    const ox = dir.x - tan.x * dot;
    const oy = dir.y - tan.y * dot;
    const oz = dir.z - tan.z * dot;
    const ol = Math.hypot(ox, oy, oz) || 1;
    map.set(id, {
      x: (p.x + (ox / ol) * spread) * SHAPE_OUTER,
      y: (p.y + (oy / ol) * spread) * SHAPE_OUTER,
      z: (p.z + (oz / ol) * spread) * SHAPE_OUTER
    });
  };

  courses.forEach((course, ci) => {
    const baseT = (ci + 0.5) / n;
    const span = (1 / n) * 0.9;
    // 把这一门课下所有可见节点按“课程 → 章节 → 知识点”的顺序排成一列，
    // 再均匀铺满整段路径。节点多时沿骨架铺开，不会在树冠/环的一小段里糊成一团。
    const members = [{ id: course.id, spread: 0.006 }];
    for (const chapter of chaptersOf(course.id)) {
      members.push({ id: chapter.id, spread: 0.022 });
      if (ui.sphereScope < 3) continue;
      for (const point of pointsOf(chapter.id)) {
        // 层级 3 只显示直属于章节的知识点；第 4 档“全部”才继续展开更深层。
        if (ui.sphereScope < 4 && (point.depth || 0) > 0) continue;
        members.push({ id: point.id, spread: 0.04 });
      }
    }
    members.forEach((member, mi) => {
      const t = baseT + ((mi + 0.5) / members.length - 0.5) * span;
      place(member.id, t, member.spread);
    });
  });

  layoutCache = { outline, shape, scope: ui.sphereScope, map };
  return map;
}

/** 外层每个课程节点的球面坐标（半径 OUTER_R）。 */
function courseBases() {
  const list = getOutline().courses;
  if (ui.shape !== 'sphere') {
    const layout = shapeLayout();
    return list.map((course) => {
      const p = layout.get(course.id) || { x: 0, y: 0, z: 0 };
      const drag = sphereOffset(course.id);
      return { course, x: p.x + drag.x, y: p.y + drag.y, z: p.z + drag.z };
    });
  }
  return list.map((course, i) => {
    const unit = shapePoint(ui.shape, i, list.length);
    const base = { x: unit.x * OUTER_R, y: unit.y * OUTER_R, z: unit.z * OUTER_R };
    const drag = sphereOffset(course.id);
    return { course, x: base.x + drag.x, y: base.y + drag.y, z: base.z + drag.z };
  });
}

/**
 * 二级章节：随机散落在所属课程周围的球形云里。
 * 不用均匀圆环，避免每一门课看起来都像同一个模板。
 */
function chapterBases() {
  const out = [];
  const bases = courseBases();
  if (ui.shape !== 'sphere') {
    const layout = shapeLayout();
    bases.forEach((base) => {
      chaptersOf(base.course.id).forEach((chapter) => {
        const p = layout.get(chapter.id);
        if (!p) return;
        const drag = sphereOffset(chapter.id);
        out.push({
          chapter,
          course: base.course,
          x: p.x + drag.x,
          y: p.y + drag.y,
          z: p.z + drag.z
        });
      });
    });
    return out;
  }
  bases.forEach((base) => {
    const chapters = chaptersOf(base.course.id);
    if (!chapters.length) return;
    chapters.forEach((chapter) => {
      const dir = shapeCloudDir(ui.shape, randDir(chapter.id, 'chapter-pos'));
      const radius = 36 + rand01(chapter.id, 'chapter-r') * 46;
      const drag = sphereOffset(chapter.id);
      out.push({
        chapter,
        course: base.course,
        x: base.x + dir.x * radius + drag.x,
        y: base.y + dir.y * radius + drag.y,
        z: base.z + dir.z * radius + drag.z
      });
    });
  });
  return out;
}

/** 三级知识点：散落在所属章节周围的小星群。 */
function pointBases() {
  const out = [];
  if (ui.shape !== 'sphere') {
    const layout = shapeLayout();
    chapterBases().forEach((chapter) => {
      const points = pointsOf(chapter.chapter.id);
      if (!points.length) return;
      points.forEach((point) => {
        if (ui.sphereScope < 4 && (point.depth || 0) > 0) return;
        const p = layout.get(point.id);
        if (!p) return;
        const drag = sphereOffset(point.id);
        out.push({
          point,
          chapter: chapter.chapter,
          course: chapter.course,
          x: p.x + drag.x,
          y: p.y + drag.y,
          z: p.z + drag.z
        });
      });
    });
    return out;
  }
  chapterBases().forEach((chapter) => {
    const points = pointsOf(chapter.chapter.id);
    if (!points.length) return;
    points.forEach((point, i) => {
      // 层级 3 只显示直属于章节的知识点；第 4 档“全部”才继续展开更深层。
      if (ui.sphereScope < 4 && (point.depth || 0) > 0) return;
      const dir = shapeCloudDir(ui.shape, randDir(point.id, `point-pos-${i}`));
      const radius = 14 + rand01(point.id, 'point-r') * 24;
      const drag = sphereOffset(point.id);
      out.push({
        point,
        chapter: chapter.chapter,
        course: chapter.course,
        x: chapter.x + dir.x * radius + drag.x,
        y: chapter.y + dir.y * radius + drag.y,
        z: chapter.z + dir.z * radius + drag.z
      });
    });
  });
  return out;
}

/**
 * 切换形状时，节点世界坐标从旧形状平滑飞向新形状。
 * 用 performance.now() 读取进度，保证同一帧内多次调用结果一致。
 */
function morphWorld(id, p) {
  const m = ui.shapeMorph;
  if (!m) return p;
  const from = m.from.get(id);
  if (!from) return p;
  const raw = clamp((performance.now() - m.start) / m.dur, 0, 1);
  if (raw >= 1) return p;
  const e = 1 - Math.pow(1 - raw, 3);
  return {
    x: from.x + (p.x - from.x) * e,
    y: from.y + (p.y - from.y) * e,
    z: from.z + (p.z - from.z) * e
  };
}

/** 外层 3D 视觉节点（一级课程，必要时加二级章节）。 */
function outerVisuals() {
  const rot = ui.sphereRot;
  const breath = ui.idleBreath || 1;
  const courseDepthR = ui.shape === 'sphere' ? OUTER_R : SHAPE_OUTER;
  const chapterDepthR = ui.shape === 'sphere' ? OUTER_R + 70 : SHAPE_OUTER;
  const pointDepthR = ui.shape === 'sphere' ? OUTER_R + 120 : SHAPE_OUTER;
  // 静默效果的几何形变统一挂到这里：节点、边、骨架与星尘用同一套世界坐标。
  const idle = (p, radius) =>
    ui.spherePuff > 0.0005
      ? shapeIdlePoint(ui.shape, p, ui.shapeClock, radius, ui.spherePuff)
      : p;
  const courses = courseBases().map((p) => {
    const m = idle(morphWorld(p.course.id, p), courseDepthR);
    const q = projectPoint(m, rot, courseDepthR);
    const n = p.course;
    return {
      id: n.id,
      node: n,
      kind: 'top',
      level: 1,
      label: n.name,
      x: q.x * breath,
      y: q.y * breath,
      z: q.z,
      wx: m.x,
      wy: m.y,
      wz: m.z,
      persp: q.persp,
      depth: q.depth,
      r: levelRadius(1)
    };
  });

  if (ui.sphereScope < 2) return courses;

  const chapters = chapterBases().map((p) => {
    const m = idle(morphWorld(p.chapter.id, p), chapterDepthR);
    const q = projectPoint(m, rot, chapterDepthR);
    return {
      id: p.chapter.id,
      node: p.chapter,
      courseNode: p.course,
      kind: 'chapter',
      level: 2,
      label: p.chapter.label,
      x: q.x * breath,
      y: q.y * breath,
      z: q.z,
      wx: m.x,
      wy: m.y,
      wz: m.z,
      persp: q.persp,
      depth: q.depth,
      r: levelRadius(2)
    };
  });
  if (ui.sphereScope < 3) return courses.concat(chapters);

  const points = pointBases().map((p) => {
    const m = idle(morphWorld(p.point.id, p), pointDepthR);
    const q = projectPoint(m, rot, pointDepthR);
    return {
      id: p.point.id,
      node: p.point,
      courseNode: p.course,
      chapterNode: p.chapter,
      kind: 'point',
      level: 3,
      label: p.point.label,
      x: q.x * breath,
      y: q.y * breath,
      z: q.z,
      wx: m.x,
      wy: m.y,
      wz: m.z,
      persp: q.persp,
      depth: q.depth,
      r: levelRadius(3)
    };
  });
  return courses.concat(chapters, points);
}

/** 内部 3D 视觉节点。 */
function innerVisuals() {
  const graph = ui.innerGraph;
  if (!graph) return [];
  const rot = ui.innerRot;
  return graph.nodes.map((n) => {
    const p = projectPoint({ x: n.x, y: n.y, z: n.z }, rot, INNER_R);
    return {
      id: n.id,
      node: n,
      kind: n.kind,
      label: n.label,
      x: p.x,
      y: p.y,
      z: p.z,
      depth: p.depth,
      r: n.r,
      treeDepth: n.treeDepth,
      blockId: n.blockId,
      hasChildren: n.hasChildren
    };
  });
}

/** 当前层级的所有视觉节点（带世界坐标与深度）。 */
export function sceneVisuals() {
  if (ui.level === 'inner') return innerVisuals();
  if (ui.level === 'sphere') {
    return outerVisuals();
  }
  return [];
}

/** 由视觉节点生成关系光丝（世界坐标）。 */
export function sceneEdges(visuals) {
  if (ui.level === 'sphere') {
    const map = new Map(visuals.map((v) => [v.id, v]));
    const out = [];
    const push = (aId, bId, label, kind) => {
      const a = map.get(aId);
      const b = map.get(bId);
      if (!a || !b) return;
      out.push({
        a: aId,
        b: bId,
        label,
        pa: a,
        pb: b,
        depth: (a.depth + b.depth) / 2,
        kind
      });
    };

    for (const e of data.edges) push(e.a, e.b, e.label, 'top');
    const outline = getOutline();
    // 星海只画知识点之间的真实关系；课程—章节—知识点的逐级连线在节点多时
    // 会织成一张密网（球形、盘状形状尤其明显），把形状的几何轮廓淹掉。
    // 层级关系改由「层级」按钮、侧栏与星河长卷呈现。
    for (const e of outline.topicEdges) push(e.a, e.b, e.label, 'topic');
    for (const e of outline.crossEdges || []) push(e.a, e.b, e.label, 'topic');

    const seen = new Set();
    return out.filter((e) => {
      const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (ui.level === 'inner' && ui.innerGraph) {
    const map = new Map(visuals.map((v) => [v.id, v]));
    return ui.innerGraph.edges
      .map((e) => {
        const a = map.get(e.a);
        const b = map.get(e.b);
        if (!a || !b) return null;
        return {
          a: e.a,
          b: e.b,
          label: e.label,
          pa: a,
          pb: b,
          depth: (a.depth + b.depth) / 2,
          kind: e.kind || 'inner'
        };
      })
      .filter(Boolean);
  }
  return [];
}

/** 3D 节点屏幕命中（前层优先）。 */
export function nodeAt3D(sx, sy) {
  const list = sceneVisuals()
    .slice()
    .sort((a, b) => a.depth - b.depth);
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    const p = worldToScreen(v.x, v.y);
    const hit = Math.max(10, v.r * 2.4);
    if (Math.hypot(sx - p.x, sy - p.y) <= hit) return v;
  }
  return null;
}

/** 拖动旋转当前层级；方向与鼠标保持一致。 */
export function rotateScene(dx, dy) {
  const rot = ui.level === 'inner' ? ui.innerRot : ui.sphereRot;
  rot.y -= dx * 0.0045;
  rot.x = clamp(rot.x - dy * 0.0038, -1.25, 1.25);
}

/** 拖动旋转局部关系图。 */
export function rotateFocus(dx, dy) {
  ui.focusRot.y -= dx * 0.0042;
  ui.focusRot.x = clamp(ui.focusRot.x - dy * 0.0036, -1.25, 1.25);
}

/**
 * 拖动星海 3D 节点：在屏幕平面内跟手，反解球面旋转后写回该节点的空间偏移。
 * 拖课程会带着它周围的章节一起走；拖章节只移动章节自己。
 */
export function moveSphereNode(visual, dxScreen, dyScreen) {
  if (!visual) return;
  const factor = Math.max(0.001, cam.scale * (visual.persp || 1));
  const x1 = dxScreen / factor;
  const y1 = dyScreen / factor;
  const rot = ui.sphereRot;
  const cx = Math.cos(rot.x);
  const sx = Math.sin(rot.x);
  const cy = Math.cos(rot.y);
  const sy = Math.sin(rot.y);

  const wy = y1 * cx;
  const z1 = -y1 * sx;
  const wx = x1 * cy + z1 * sy;
  const wz = -x1 * sy + z1 * cy;

  const cur = sphereOffset(visual.id);
  let nx = cur.x + wx;
  let ny = cur.y + wy;
  let nz = cur.z + wz;
  const dist = Math.hypot(nx, ny, nz);
  const limit = 560;
  if (dist > limit) {
    const k = limit / dist;
    nx *= k;
    ny *= k;
    nz *= k;
  }
  ui.sphereOffsets.set(visual.id, { x: nx, y: ny, z: nz });
}

/** 切换当前形状的私有静默形变；再点一次回到标准形态。 */
export function toggleSpherePuff() {
  if (ui.spherePuffTarget > 0.5) {
    ui.spherePuffTarget = 0;
    // “还原球体”同时清掉手动拖拽造成的节点偏移，否则球回来了、节点仍歪着。
    ui.sphereOffsets.clear();
  } else {
    ui.spherePuffTarget = 1;
  }
  return ui.spherePuffTarget > 0.5;
}

/** 把星海恢复成标准形态，并清掉所有手动拖动偏移。 */
export function resetSphereShape() {
  ui.spherePuff = 0;
  ui.spherePuffTarget = 0;
  ui.sphereOffsets.clear();
}

export function spherePuffState() {
  return {
    expanded: ui.spherePuffTarget > 0.5,
    value: ui.spherePuff,
    target: ui.spherePuffTarget
  };
}

/**
 * 切换星海形状：记录当前世界坐标，下一帧起用 1350ms 从旧形状飞到新形状。
 * 返回是否真的发生了切换。
 */
export function applyShape(shape) {
  if (!shape || shape === ui.shape) return false;
  const from = new Map();
  for (const v of sceneVisuals()) {
    from.set(v.id, { x: v.wx ?? v.x, y: v.wy ?? v.y, z: v.wz ?? v.z });
  }
  ui.shape = shape;
  if (from.size) {
    ui.shapeMorph = { from, start: performance.now(), dur: 1350 };
  }
  return true;
}

/** 每帧自动缓慢自转 / 呼吸（拖拽时暂停旋转）并推进形状私有形变。 */
export function tick(dt) {
  if (ui.shapeMorph && performance.now() - ui.shapeMorph.start >= ui.shapeMorph.dur) {
    ui.shapeMorph = null;
  }
  // 静默里的私有形变：每种形状按自己的几何推进，强度由开关平滑补间。
  if (ui.level === 'sphere') {
    ui.spherePuffTarget = ui.idleModes.puff ? 1 : 0;
    if (ui.idleModes.puff) ui.shapeClock += (dt / 1000) * ui.idleSpeed;
  }
  if (ui.level === 'sphere' && Math.abs(ui.spherePuff - ui.spherePuffTarget) > 0.0001) {
    const k = 1 - Math.exp(-dt / 260);
    ui.spherePuff += (ui.spherePuffTarget - ui.spherePuff) * k;
    if (Math.abs(ui.spherePuffTarget - ui.spherePuff) < 0.001) {
      ui.spherePuff = ui.spherePuffTarget;
    }
  }

  if (ui.level === 'sphere' && ui.idleModes.breathe) {
    // 心跳：一拍 2.4s。主拍先收缩 2.8%，跟一个很轻的次拍（lub-dub），
    // 中间带一点回弹。几何上几乎只是轻颤，真正的心跳感交给光脉冲。
    // 每拍幅度上下浮动 ±10%，避免机械重复。频率固定，不受速度滑条影响。
    const PERIOD = 2400;
    ui.breathPhase += (dt / PERIOD) * TAU;
    const p = ((ui.breathPhase % TAU) + TAU) % TAU;
    const d = Math.atan2(Math.sin(p), Math.cos(p));
    const beat = Math.floor(ui.breathPhase / TAU);
    const noise = Math.sin(beat * 12.9898) * 43758.5453;
    const gain = 0.9 + (noise - Math.floor(noise)) * 0.2;
    const main = Math.exp(-(d * d) / (2 * 0.3 * 0.3));
    const dub = Math.exp(-((d - 0.72) * (d - 0.72)) / (2 * 0.3 * 0.3));
    const rebound = Math.exp(-((d - 0.36) * (d - 0.36)) / (2 * 0.35 * 0.35));
    ui.idleBreath = 1 - (main * 0.028 + dub * 0.014) * gain + rebound * 0.01;
    const pMain = Math.exp(-(d * d) / (2 * 0.42 * 0.42));
    const pDub = Math.exp(-((d - 0.72) * (d - 0.72)) / (2 * 0.38 * 0.38));
    ui.idlePulse = Math.min(1.2, (pMain + pDub * 0.55) * gain);
    ui.breathAge = (p / TAU) * PERIOD;
  } else {
    ui.idleBreath = 1;
    ui.idlePulse = 0;
  }

  if (ui.orbitDrag || ui.level === 'local') return;
  if (ui.level === 'sphere') {
    if (ui.idleModes.rotate) {
      ui.sphereRot.y += dt * 0.000042 * ui.idleSpeed;
      ui.sphereRot.x += Math.sin(performance.now() * 0.00006) * dt * 0.0000045 * ui.idleSpeed;
    }
  } else if (ui.level === 'inner') {
    ui.innerRot.y += dt * 0.00003 * ui.idleSpeed;
  }
}

/** 记录进入局部图前的 3D 世界坐标与屏幕坐标，供回退渲染层 / WebGL 做位置插值。 */
export function captureTransitionFrom3D() {
  const from = new Map();
  const screenFrom = new Map();
  for (const v of sceneVisuals()) {
    from.set(v.id, { x: v.x, y: v.y });
    const s = worldToScreen(v.x, v.y);
    screenFrom.set(v.id, { x: s.x, y: s.y });
  }
  if (!from.size) return null;
  return { from, screenFrom, start: performance.now(), dur: 1080 };
}

export function clearTransition() {
  ui.transition = null;
}

/**
 * 从笔记大纲构建内部 3D 图：中心 = 知识点本身，根章节 = 一级内部节点，
 * 子条目继续挂在父条目周围；边即“所属 / 包含”关系。
 * @param {import('@starmap/core').KnowledgeNode} host
 */
export function buildInner(host) {
  if (!host) {
    ui.innerGraph = null;
    return null;
  }
  const nodes = [];
  const edges = [];
  const byId = new Map();

  const center = {
    id: 'inner-center',
    label: host.name,
    kind: 'center',
    blockId: null,
    treeDepth: -1,
    hasChildren: true,
    r: 11,
    x: 0,
    y: 0,
    z: 0
  };
  nodes.push(center);
  byId.set(center.id, center);

  const roots = (host.note || []).filter((b) => b && (String(b.text || '').trim() || (b.children || []).length));
  roots.forEach((block, i) => {
    const rootNode = makeInnerNode(block, 0, `root-${block.id}`);
    const unit = fibonacci(i, roots.length, 0.15);
    rootNode.x = unit.x * 118;
    rootNode.y = unit.y * 118;
    rootNode.z = unit.z * 118;
    addNode(rootNode, center);
    placeChildren(rootNode, block.children || [], 1, i + 1);
  });

  function addNode(n, parent) {
    nodes.push(n);
    byId.set(n.id, n);
    edges.push({
      a: parent ? parent.id : center.id,
      b: n.id,
      label: '',
      kind: parent ? 'inner-child' : 'inner-root'
    });
  }

  function makeInnerNode(block, treeDepth, id) {
    const text = String(block.text || '').trim() || '未命名条目';
    const label = text.length > 26 ? text.slice(0, 25) + '…' : text;
    const childCount = (block.children || []).length;
    return {
      id: `inner-${id}`,
      label,
      fullText: text,
      kind: treeDepth === 0 ? 'root' : 'child',
      blockId: block.id,
      treeDepth,
      hasChildren: childCount > 0,
      r: levelRadius(treeDepth + 1),
      x: 0,
      y: 0,
      z: 0
    };
  }

  function placeChildren(parent, children, treeDepth, seed) {
    const valid = (children || []).filter((b) => b && (String(b.text || '').trim() || (b.children || []).length));
    if (!valid.length) return;
    const axis = norm({ x: parent.x, y: parent.y, z: parent.z });
    let t1 = cross(axis, UP);
    if (Math.hypot(t1.x, t1.y, t1.z) < 0.01) t1 = cross(axis, { x: 1, y: 0, z: 0 });
    t1 = norm(t1);
    const t2 = cross(axis, t1);
    const ring = treeDepth === 1 ? 37 : 27;
    valid.forEach((block, j) => {
      const child = makeInnerNode(block, treeDepth, `n-${block.id}`);
      const angle = j * 2.39996 + seed * 0.73;
      const out = ring * (0.9 + 0.08 * (j % 3));
      child.x = parent.x + t1.x * Math.cos(angle) * out + t2.x * Math.sin(angle) * out + axis.x * out * 0.22;
      child.y = parent.y + t1.y * Math.cos(angle) * out + t2.y * Math.sin(angle) * out + axis.y * out * 0.22;
      child.z = parent.z + t1.z * Math.cos(angle) * out + t2.z * Math.sin(angle) * out + axis.z * out * 0.22;
      const len = Math.hypot(child.x, child.y, child.z);
      if (len > INNER_R) {
        child.x *= INNER_R / len;
        child.y *= INNER_R / len;
        child.z *= INNER_R / len;
      }
      addNode(child, parent);
      placeChildren(child, block.children || [], treeDepth + 1, seed + j + 1);
    });
  }

  const graph = {
    hostId: host.id,
    hostName: host.name,
    nodes,
    edges,
    byId,
    born: performance.now(),
    rotation: ui.innerRot
  };
  ui.innerGraph = graph;
  return graph;
}

/** 在内部图中定位某个笔记块。 */
export function innerVisualForBlock(blockId) {
  if (!ui.innerGraph) return null;
  return ui.innerGraph.nodes.find((n) => n.blockId === blockId) || null;
}

/** 当前内部图的节点总数（调试 / 导航提示用）。 */
export function innerCount() {
  return ui.innerGraph ? ui.innerGraph.nodes.length : 0;
}

/** 选中某个内部节点，返回被选中的对象。 */
export function selectInner(id) {
  const node = ui.innerGraph && ui.innerGraph.byId.get(id);
  ui.innerSelection = node ? node.id : null;
  return node || null;
}

/** 内部图里与某节点直接相连的节点 id 集合（含自身）。 */
export function innerSelectionSet(id) {
  if (!id || !ui.innerGraph) return null;
  const set = new Set([id]);
  for (const e of ui.innerGraph.edges) {
    if (e.a === id) set.add(e.b);
    if (e.b === id) set.add(e.a);
  }
  return set;
}

/** 内层节点在水面上的角度，可用于后续扩展。 */
export function innerAngle(id) {
  const n = ui.innerGraph && ui.innerGraph.byId.get(id);
  return n ? Math.atan2(n.z, n.x) : 0;
}

export { OUTER_R, INNER_R, TAU };