// 多级星图：外层 3D 球 → 单击后的 2D 平铺 → 双击后的内部 3D 笔记树。
// 只负责“几何与层级数据”，不碰 DOM / 相机；交互与面板由上层编排。
import { TAU, clamp, hashStr } from '@starmap/core';
import { cam, ui } from './state.js';
import { data } from './store.js';
import { worldToScreen } from './camera.js';
import { getOutline, chaptersOf, pointsOf } from './outline.js';
import { quality2d } from './quality.js';

const OUTER_R = 300;
const INNER_R = 250;
const FOCAL = 920;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const UP = { x: 0, y: 1, z: 0 };

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

/** 稳定的随机单位向量，用于打散章节位置与膨胀方向。 */
function randDir(id, salt) {
  const u = rand01(id, `${salt}:u`);
  const v = rand01(id, `${salt}:v`);
  const theta = u * TAU;
  const z = v * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: Math.cos(theta) * r, y: z, z: Math.sin(theta) * r };
}

/**
 * 节点向外膨胀的随机位移。以“球心 → 节点”的方向为主，再叠一点切向抖动，
 * 这样整体仍是向外膨胀，而不是单纯把节点揉成一团。
 */
function puffOffsetForSeed(id, base, radius, seed) {
  const outward = norm(base);
  const jitter = randDir(id, `puff-${seed}`);
  const radial = 0.16 + rand01(id, `puff-r-${seed}`) * 0.58;
  // 每个节点有自己的呼吸相位：同一时刻有的先散、有的后散，整体更像星云。
  const phase = rand01(id, `puff-phase-${seed}`) * Math.PI * 2;
  const wobble = 0.62 + 0.38 * Math.sin(ui.idlePhase + phase);
  return {
    x: (outward.x * radial + jitter.x * 0.3) * radius * wobble,
    y: (outward.y * radial + jitter.y * 0.3) * radius * wobble,
    z: (outward.z * radial + jitter.z * 0.3) * radius * wobble
  };
}

function puffOffset(id, base, radius) {
  const mix = ui.spherePuffSeedMix ?? 1;
  if (mix >= 0.999) return puffOffsetForSeed(id, base, radius, ui.spherePuffSeed);
  const prev = puffOffsetForSeed(id, base, radius, ui.spherePuffPrevSeed ?? ui.spherePuffSeed);
  const next = puffOffsetForSeed(id, base, radius, ui.spherePuffSeed);
  const t = mix * mix * (3 - 2 * mix);
  return {
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
    z: prev.z + (next.z - prev.z) * t
  };
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

/** 外层每个课程节点的球面坐标（半径 OUTER_R）。 */
function courseBases() {
  const list = getOutline().courses;
  const puff = ui.spherePuff;
  return list.map((course, i) => {
    const unit = fibonacci(i, list.length, 0.4);
    const base = { x: unit.x * OUTER_R, y: unit.y * OUTER_R, z: unit.z * OUTER_R };
    const off = puffOffset(course.id, base, OUTER_R);
    const drag = sphereOffset(course.id);
    return {
      course,
      x: base.x + off.x * puff + drag.x,
      y: base.y + off.y * puff + drag.y,
      z: base.z + off.z * puff + drag.z
    };
  });
}

/**
 * 二级章节：随机散落在所属课程周围的球形云里。
 * 不用均匀圆环，避免每一门课看起来都像同一个模板。
 */
function chapterBases() {
  const out = [];
  const bases = courseBases();
  const puff = ui.spherePuff;
  bases.forEach((base) => {
    const chapters = chaptersOf(base.course.id);
    if (!chapters.length) return;
    chapters.forEach((chapter) => {
      const dir = randDir(chapter.id, 'chapter-pos');
      const radius = 36 + rand01(chapter.id, 'chapter-r') * 46;
      const own = puffOffset(chapter.id, base, 76);
      const drag = sphereOffset(chapter.id);
      out.push({
        chapter,
        course: base.course,
        x: base.x + dir.x * radius + own.x * puff * 0.58 + drag.x,
        y: base.y + dir.y * radius + own.y * puff * 0.58 + drag.y,
        z: base.z + dir.z * radius + own.z * puff * 0.58 + drag.z
      });
    });
  });
  return out;
}

/** 三级知识点：散落在所属章节周围的小星群。 */
function pointBases() {
  const out = [];
  const puff = ui.spherePuff;
  chapterBases().forEach((chapter) => {
    const points = pointsOf(chapter.chapter.id);
    if (!points.length) return;
    points.forEach((point, i) => {
      // 层级 3 只显示直属于章节的知识点；第 4 档“全部”才继续展开更深层。
      if (ui.sphereScope < 4 && (point.depth || 0) > 0) return;
      const dir = randDir(point.id, `point-pos-${i}`);
      const radius = 14 + rand01(point.id, 'point-r') * 24;
      const own = puffOffset(point.id, chapter, 30);
      const drag = sphereOffset(point.id);
      out.push({
        point,
        chapter: chapter.chapter,
        course: chapter.course,
        x: chapter.x + dir.x * radius + own.x * puff * 0.34 + drag.x,
        y: chapter.y + dir.y * radius + own.y * puff * 0.34 + drag.y,
        z: chapter.z + dir.z * radius + own.z * puff * 0.34 + drag.z
      });
    });
  });
  return out;
}

/** 外层 3D 视觉节点（一级课程，必要时加二级章节）。 */
function outerVisuals() {
  const rot = ui.sphereRot;
  const breath = ui.idleBreath || 1;
  const courses = courseBases().map((p) => {
    const q = projectPoint(p, rot, OUTER_R);
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
      wx: p.x,
      wy: p.y,
      wz: p.z,
      persp: q.persp,
      depth: q.depth,
      r: 4.6 + Math.min(n.deg || 0, 7) * 0.55
    };
  });

  if (ui.sphereScope < 2) return courses;

  const chapters = chapterBases().map((p) => {
    const q = projectPoint(p, rot, OUTER_R + 70);
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
      wx: p.x,
      wy: p.y,
      wz: p.z,
      persp: q.persp,
      depth: q.depth,
      r: 3.7
    };
  });
  if (ui.sphereScope < 3) return courses.concat(chapters);

  const points = pointBases().map((p) => {
    const q = projectPoint(p, rot, OUTER_R + 120);
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
      wx: p.x,
      wy: p.y,
      wz: p.z,
      persp: q.persp,
      depth: q.depth,
      r: 2.45
    };
  });
  return courses.concat(chapters, points);
}

/** 2D 平面星点布局：课程按黄金角铺开，章节与知识点围绕父节点散成星点。 */
function outer2DVisuals() {
  const spread = Math.max(0.6, Math.min(1.6, quality2d().spread || 1));
  const out = [];
  const bases = courseBases();

  const chapterMap = new Map();
  for (const p of chapterBases()) {
    if (!chapterMap.has(p.course.id)) chapterMap.set(p.course.id, []);
    chapterMap.get(p.course.id).push(p);
  }
  const pointMap = new Map();
  for (const p of pointBases()) {
    if (!pointMap.has(p.chapter.id)) pointMap.set(p.chapter.id, []);
    pointMap.get(p.chapter.id).push(p);
  }

  const placed = [];
  const count = Math.max(1, bases.length);
  const step = Math.min(360, 1500 / count);
  bases.forEach((base, index) => {
    const n = base.course;
    const deg = Math.min(n.deg || 0, 8);
    // 课程星点：黄金角铺开 + 稳定随机，课程之间只留节点与标签的空间。
    const ang = index * 2.399963229728653 + (rand01(n.id, 'star-angle') - 0.5) * 1.1;
    const orbit = (210 + index * step + rand01(n.id, 'star-orbit') * 120) * spread;
    let cx = Math.cos(ang) * orbit;
    let cy = Math.sin(ang) * orbit * 0.78;
    for (const prev of placed) {
      const dx = cx - prev.x;
      const dy = cy - prev.y;
      const d = Math.hypot(dx, dy);
      const need = (prev.r + 26) * spread;
      if (d < need && d > 0.001) {
        const push = (need - d) / d;
        cx += dx * push;
        cy += dy * push;
      }
    }
    placed.push({ x: cx, y: cy, r: 26 });
    out.push({
      id: n.id,
      node: n,
      kind: 'top',
      level: 1,
      label: n.name,
      x: cx,
      y: cy,
      z: 0,
      wx: cx,
      wy: cy,
      wz: 0,
      persp: 1,
      depth: 0.86,
      r: 4.6 + deg * 0.55
    });
    if (ui.sphereScope < 2) return;

    for (const cp of chapterMap.get(n.id) || []) {
      const a = rand01(cp.chapter.id, 'chapter-angle') * Math.PI * 2;
      const u = Math.pow(rand01(cp.chapter.id, 'chapter-dist'), 1.8);
      const dist = (30 + u * 70) * spread;
      const sx = cx + Math.cos(a) * dist;
      const sy = cy + Math.sin(a) * dist;
      out.push({
        id: cp.chapter.id,
        node: cp.chapter,
        courseNode: n,
        kind: 'chapter',
        level: 2,
        label: cp.chapter.label,
        x: sx,
        y: sy,
        z: 0,
        wx: cp.x,
        wy: cp.y,
        wz: 0,
        persp: 1,
        depth: 0.7,
        r: 3.7
      });
      if (ui.sphereScope < 3) continue;

      for (const pp of pointMap.get(cp.chapter.id) || []) {
        if (ui.sphereScope < 4 && (pp.point.depth || 0) > 0) continue;
        const pa = rand01(pp.point.id, 'star-point') * Math.PI * 2;
        const pr = (10 + Math.pow(rand01(pp.point.id, 'star-point-r'), 1.4) * 32) * spread;
        out.push({
          id: pp.point.id,
          node: pp.point,
          courseNode: n,
          chapterNode: cp.chapter,
          kind: 'point',
          level: 3,
          label: pp.point.label,
          x: sx + Math.cos(pa) * pr,
          y: sy + Math.sin(pa) * pr,
          z: 0,
          wx: pp.x,
          wy: pp.y,
          wz: 0,
          persp: 1,
          depth: 0.56,
          r: 2.45
        });
      }
    }
  });

  // 2D 同样支持拖动：偏移量复用球体那套，重置图形时一起清空。
  for (const v of out) {
    const drag = sphereOffset(v.id);
    v.x += drag.x;
    v.y += drag.y;
  }
  return out;
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
    return ui.mode === '2d' ? outer2DVisuals() : outerVisuals();
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
    if (ui.sphereScope >= 2) {
      for (const e of outline.hierarchy) {
        if (e.kind === 'chapter') push(e.a, e.b, '', 'chapter');
        if (ui.sphereScope >= 3 && e.kind === 'point') push(e.a, e.b, '', 'point');
      }
    }
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
  if (ui.mode === '2d') {
    // 2D 星云里拖动节点：直接改屏幕平面内的偏移，不做球面反解。
    const factor = Math.max(0.01, cam.scale || 1);
    const cur = sphereOffset(visual.id);
    const nx = clamp(cur.x + dxScreen / factor, -1600, 1600);
    const ny = clamp(cur.y + dyScreen / factor, -1600, 1600);
    ui.sphereOffsets.set(visual.id, { x: nx, y: ny, z: 0 });
    return;
  }
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

/** 切换球体随机膨胀；再点一次回到标准球。 */
export function toggleSpherePuff() {
  if (ui.spherePuffTarget > 0.5) {
    ui.spherePuffTarget = 0;
    // “还原球体”同时清掉手动拖拽造成的节点偏移，否则球回来了、节点仍歪着。
    ui.sphereOffsets.clear();
  } else {
    ui.spherePuffSeed = (Math.random() * 1e9) | 0;
    ui.spherePuffTarget = 1;
  }
  return ui.spherePuffTarget > 0.5;
}

/** 把星海恢复成标准球体，并清掉所有手动拖动偏移。 */
export function resetSphereShape() {
  ui.spherePuff = 0;
  ui.spherePuffTarget = 0;
  ui.spherePuffDepth = 0.62;
  ui.spherePuffPrevSeed = ui.spherePuffSeed;
  ui.spherePuffSeed = (Math.random() * 1e9) | 0;
  ui.spherePuffSeedMix = 1;
  ui.sphereOffsets.clear();
}

export function spherePuffState() {
  return {
    expanded: ui.spherePuffTarget > 0.5,
    value: ui.spherePuff,
    target: ui.spherePuffTarget,
    depth: ui.spherePuffDepth,
    seedMix: ui.spherePuffSeedMix
  };
}

/** 每帧自动缓慢自转 / 呼吸（拖拽时暂停旋转）并推进膨胀补间。 */
export function tick(dt) {
  // 「膨胀」静默效果：每个循环缓慢涨大再缩回，到谷底换一套随机方向。
  if (ui.level === 'sphere' && ui.idleModes.puff) {
    ui.idlePhase += dt * 0.00055 * ui.idleSpeed;
    if (ui.idlePhase >= Math.PI * 2) {
      ui.idlePhase -= Math.PI * 2;
      // 先留一份旧种子做交叉淡入，避免换种子瞬间节点整体跳位。
      ui.spherePuffPrevSeed = ui.spherePuffSeed;
      ui.spherePuffSeed = (Math.random() * 1e9) | 0;
      ui.spherePuffSeedMix = 0;
      ui.spherePuffDepth = 0.56 + Math.random() * 0.3;
    }
    const wave = 0.5 - 0.5 * Math.cos(ui.idlePhase);
    ui.spherePuffTarget = 0.03 + wave * ui.spherePuffDepth;
  }
  if (ui.spherePuffSeedMix < 1) {
    ui.spherePuffSeedMix = Math.min(1, ui.spherePuffSeedMix + dt / 650);
  }

  if (ui.level === 'sphere' && Math.abs(ui.spherePuff - ui.spherePuffTarget) > 0.0001) {
    const k = 1 - Math.exp(-dt / 190);
    ui.spherePuff += (ui.spherePuffTarget - ui.spherePuff) * k;
    if (Math.abs(ui.spherePuffTarget - ui.spherePuff) < 0.001) {
      ui.spherePuff = ui.spherePuffTarget;
    }
  }

  if (ui.level === 'sphere' && ui.idleModes.breathe) {
    // 心跳：每拍只跳一次——先收缩、再轻轻回弹，像一次真实心跳。
    // 相位以 0 为收缩峰值；渲染层在相位回绕时从星海轮廓向外放一圈星辉涟漪。
    ui.breathPhase += dt * 0.0042 * ui.idleSpeed;
    const p = ((ui.breathPhase % TAU) + TAU) % TAU;
    const d = Math.atan2(Math.sin(p), Math.cos(p));
    const squeeze = Math.exp(-(d * d) / (2 * 0.09 * 0.09));
    const rebound = Math.exp(-((d - 0.24) * (d - 0.24)) / (2 * 0.13 * 0.13));
    ui.idleBreath = 1 - squeeze * 0.075 + rebound * 0.045;
  } else {
    ui.idleBreath = 1;
  }

  if (ui.orbitDrag || ui.level === 'local') return;
  if (ui.level === 'sphere') {
    if (ui.idleModes.rotate && ui.mode !== '2d') {
      ui.sphereRot.y += dt * 0.000042 * ui.idleSpeed;
      ui.sphereRot.x += Math.sin(performance.now() * 0.00006) * dt * 0.0000045 * ui.idleSpeed;
    }
  } else if (ui.level === 'inner') {
    ui.innerRot.y += dt * 0.00003 * ui.idleSpeed;
  }
}

/** 记录进入 2D 前的 3D 世界坐标，供渲染层做“摊平”插值。 */
export function captureTransitionFrom3D() {
  const map = new Map();
  for (const v of sceneVisuals()) map.set(v.id, { x: v.x, y: v.y });
  if (!map.size) return null;
  return { from: map, start: performance.now(), dur: 720 };
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
      r: treeDepth === 0 ? 6.1 + Math.min(childCount, 6) * 0.35 : Math.max(3.2, 4.5 - treeDepth * 0.35),
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