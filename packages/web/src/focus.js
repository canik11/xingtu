// 局部 3D 关系图：把一个课程 / 章节展开成“中心 + 章节点 + 知识点”的球状图。
// 几何坐标仍然是确定的，渲染层再做旋转、透视和深度排序。
import { cam, ui } from './state.js';
import { data } from './store.js';
import { worldToScreen, fitFocusView } from './camera.js';
import {
  getOutline,
  getEntity,
  pointsOf,
  chaptersOf,
  pathOf
} from './outline.js';
import { TAU, hashStr } from '@starmap/core';
import { projectPoint } from './hierarchy.js';

const CHAPTER_R = 195;
const POINT_CLOUD = 48;
const POINT_R = 150;
const SIBLING_R = 135;
const EXTERNAL_R = 285;
const DEPTH_R = 280;

let focusGraph = null;
/** 用户手动拖过的节点位置（本次会话内保留，重建关系图时不丢）。 */
const manualPositions = new Map();

function positionKey(focusId, nodeId) {
  return `${ui.mode}|${focusId}|${nodeId}`;
}

/** 清除某个焦点图里用户手动拖动过的位置；不传则清除全部。 */
export function clearManualPositions(focusId) {
  if (!focusId) {
    manualPositions.clear();
    return;
  }
  const prefix = `${ui.mode}|${focusId}|`;
  for (const key of [...manualPositions.keys()]) {
    if (key.startsWith(prefix)) manualPositions.delete(key);
  }
}

function trim(text, max = 26) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 稳定的球面分布，避免每次刷新都跳动。 */
function spherePoint(i, count, radius, phase = 0) {
  const n = Math.max(1, count);
  const y = 1 - (2 * (i + 0.5)) / n;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = i * 2.399963229728653 + phase;
  return {
    x: Math.cos(angle) * ring * radius,
    y: y * radius,
    z: Math.sin(angle) * ring * radius
  };
}

function addNode(nodes, node) {
  nodes.push(node);
  return node;
}

function addEdge(edges, map, a, b, label, kind) {
  if (!a || !b || a.id === b.id) return;
  const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  const existing = map.get(key);
  if (existing) {
    if (kind === 'topic' && !existing.label) {
      existing.label = label || '相关';
      existing.kind = 'topic';
    }
    return;
  }
  const e = { a: a.id, b: b.id, label: label || '', kind, pa: a, pb: b };
  edges.push(e);
  map.set(key, e);
}

function addPointNode(nodes, edges, edgeMap, parent, point, x, y, z, labelMax) {
  const node = addNode(nodes, {
    id: point.id,
    entity: point,
    kind: 'point',
    level: 3,
    label: trim(point.name, labelMax),
    name: point.name,
    x,
    y,
    z,
    r: 4.0,
    chapterId: parent.id
  });
  addEdge(edges, edgeMap, parent, node, '', 'hierarchy');
  return node;
}

/** 世界坐标 -> 当前 focusRot 下的投影坐标；2D 模式直接用平面坐标。 */
export function projectFocusNode(n) {
  if (ui.mode === '2d') {
    return { x: n.x || 0, y: n.y || 0, z: 0, depth: 0.7, persp: 1 };
  }
  return projectPoint(
    { x: n.x || 0, y: n.y || 0, z: n.z || 0 },
    ui.focusRot,
    DEPTH_R
  );
}

/**
 * 让节点跟随鼠标在屏幕平面内移动；反解 focusRot，得到世界坐标增量。
 * 这样无论球体转到哪个角度，节点都会跟着指针走。
 */
export function moveFocusNode(node, dxScreen, dyScreen) {
  if (!node) return;
  if (ui.mode === '2d') {
    // 2D 图没有透视：直接按屏幕平移世界坐标。
    const factor = Math.max(0.001, cam.scale || 1);
    node.x = (node.x || 0) + dxScreen / factor;
    node.y = (node.y || 0) + dyScreen / factor;
    const dist = Math.hypot(node.x, node.y);
    const limit = 560;
    if (dist > limit) {
      const k = limit / dist;
      node.x *= k;
      node.y *= k;
    }
    if (ui.focusId) {
      manualPositions.set(positionKey(ui.focusId, node.id), {
        x: node.x,
        y: node.y,
        z: 0
      });
    }
    return;
  }
  const p = projectFocusNode(node);
  const factor = Math.max(0.001, cam.scale * (p.persp || 1));
  const x1 = dxScreen / factor;
  const y1 = dyScreen / factor;

  const cx = Math.cos(ui.focusRot.x);
  const sx = Math.sin(ui.focusRot.x);
  const cy = Math.cos(ui.focusRot.y);
  const sy = Math.sin(ui.focusRot.y);

  // 反解 forward projectPoint()：屏幕平面内的位移对应世界坐标的哪个方向。
  const wy = y1 * cx;
  const z1 = -y1 * sx;
  const wx = x1 * cy + z1 * sy;
  const wz = -x1 * sy + z1 * cy;

  node.x += wx;
  node.y += wy;
  node.z += wz;

  // 别拖得太远，远离视野就不好找回来了。
  const dist = Math.hypot(node.x, node.y, node.z);
  const limit = 560;
  if (dist > limit) {
    const k = limit / dist;
    node.x *= k;
    node.y *= k;
    node.z *= k;
  }

  if (ui.focusId) {
    manualPositions.set(positionKey(ui.focusId, node.id), {
      x: node.x,
      y: node.y,
      z: node.z
    });
  }
}

function childrenOf(center, nodes, edges) {
  const ids = new Set();
  for (const e of edges) {
    if (e.kind !== 'hierarchy') continue;
    if (e.a === center.id) ids.add(e.b);
    else if (e.b === center.id) ids.add(e.a);
  }
  const list = [];
  for (const id of ids) {
    const n = nodes.find((x) => x.id === id);
    if (n) list.push(n);
  }
  return list;
}

const focusRand = (id, salt) => (hashStr(`${id}|${salt}`) % 1000000) / 1000000;

/**
 * 2D 局部图：中心节点在原点，章节节点按黄金角排在外圈，
 * 各自的知识点散在它周围；关联节点放在最外圈。
 * 纯平面星点布局，不做球面投影，也不画云团。
 */
function layoutFocus2D(center, nodes, edges) {
  center.x = 0;
  center.y = 0;
  center.z = 0;
  const centerR = center.kind === 'chapter' ? 150 : 90;

  const children = childrenOf(center, nodes, edges);
  const placed = [];
  const loose = [];

  children.forEach((child, i) => {
    if (child.kind !== 'chapter') {
      loose.push(child);
      return;
    }
    const id = child.id;
    const leaves = childrenOf(child, nodes, edges).filter((n) => n !== center);
    const clusterR = Math.min(150, 88 + Math.sqrt(Math.max(1, leaves.length)) * 24);
    const ang = i * 2.399963229728653 + (focusRand(id, 'star-angle') - 0.5) * 0.9;
    const orbit = 420 + Math.sqrt(i + 0.5) * 190;
    let cx = Math.cos(ang) * orbit;
    let cy = Math.sin(ang) * orbit * 0.92;
    for (const prev of placed) {
      const dx = cx - prev.x;
      const dy = cy - prev.y;
      const d = Math.hypot(dx, dy);
      const need = prev.r + clusterR * 0.75;
      if (d < need && d > 0.001) {
        const push = (need - d) / d;
        cx += dx * push;
        cy += dy * push;
      }
    }
    placed.push({ x: cx, y: cy, r: clusterR });
    child.x = cx;
    child.y = cy;
    child.z = 0;
    leaves.forEach((leaf) => {
      const a = focusRand(leaf.id, 'leaf-angle') * TAU;
      const u = Math.pow(focusRand(leaf.id, 'leaf-dist'), 1.5);
      const d = clusterR * (0.2 + u * 0.7);
      leaf.x = cx + Math.cos(a) * d;
      leaf.y = cy + Math.sin(a) * d;
      leaf.z = 0;
    });
  });

  // 没有下级的节点直接散在中心周围。
  loose.forEach((n) => {
    const a = focusRand(n.id, 'leaf-angle') * TAU;
    const u = Math.pow(focusRand(n.id, 'leaf-dist'), 1.4);
    const d = centerR * (0.3 + u * 0.7);
    n.x = Math.cos(a) * d;
    n.y = Math.sin(a) * d;
    n.z = 0;
  });

  const externals = nodes.filter((n) => n.kind === 'external');
  externals.forEach((n, i) => {
    const ang = i * 2.399963229728653 + 0.6;
    const r = (center.kind === 'chapter' ? 520 : 900) + Math.floor(i / 3) * 130;
    n.x = Math.cos(ang) * r;
    n.y = Math.sin(ang) * r * 0.9;
    n.z = 0;
  });
}

function projectedNodes(graph) {
  return graph.nodes.map((n) => {
    const p = projectFocusNode(n);
    return { ...n, x: p.x, y: p.y, z: p.z, depth: p.depth };
  });
}

/**
 * 构建局部 3D 关系图。
 * @param {string} focusId 课程 id 或 `h:<blockId>`
 */
export function buildFocus(focusId) {
  const entity = getEntity(focusId);
  if (!entity) {
    ui.focusGraph = null;
    focusGraph = null;
    return null;
  }

  const nodes = [];
  const edges = [];
  const edgeMap = new Map();
  const center = addNode(nodes, {
    id: entity.id,
    entity,
    kind: entity.level === 1 ? 'course' : entity.level === 2 ? 'chapter' : 'point',
    level: entity.level,
    label: entity.name,
    name: entity.name,
    x: 0,
    y: 0,
    z: 0,
    r: entity.level === 1 ? 12 : entity.level === 2 ? 8.6 : 6
  });

  if (entity.level === 1) {
    const chapters = chaptersOf(entity.id);
    chapters.forEach((chapter, i) => {
      const base = spherePoint(i, chapters.length, CHAPTER_R, 0.45);
      const chapterNode = addNode(nodes, {
        id: chapter.id,
        entity: chapter,
        kind: 'chapter',
        level: 2,
        label: trim(chapter.name, 30),
        name: chapter.name,
        x: base.x,
        y: base.y,
        z: base.z,
        r: 7.4
      });
      addEdge(edges, edgeMap, center, chapterNode, '', 'hierarchy');

      const pts = pointsOf(chapter.id);
      pts.forEach((point, j) => {
        const q = spherePoint(j, pts.length, POINT_CLOUD, i * 0.73);
        addPointNode(
          nodes,
          edges,
          edgeMap,
          chapterNode,
          point,
          base.x + q.x,
          base.y + q.y,
          base.z + q.z,
          16
        );
      });
    });
  } else if (entity.level === 2) {
    const pts = pointsOf(entity.id);
    pts.forEach((point, i) => {
      const q = spherePoint(i, pts.length, POINT_R, 0.2);
      addPointNode(nodes, edges, edgeMap, center, point, q.x, q.y, q.z, 28);
    });
  } else {
    // 三级知识点：中心点 + 同章节的兄弟节点，方便看上下文。
    const chapter = getEntity(entity.parentId);
    if (chapter) {
      const pts = pointsOf(chapter.id).filter((p) => p.id !== entity.id);
      pts.forEach((point, i) => {
        const q = spherePoint(i, pts.length, SIBLING_R, 0.2);
        addPointNode(nodes, edges, edgeMap, center, point, q.x, q.y, q.z, 26);
      });
    }
  }

  // 跨节点关系：可见端点之间直接画；一端不可见的，在外圈补一个“远端点”。
  const visible = new Set(nodes.map((n) => n.id));
  const externals = new Map();
  const outline = getOutline();
  const topicEdges = [...outline.topicEdges, ...(outline.crossEdges || [])];
  for (const edge of topicEdges) {
    const hasA = visible.has(edge.a);
    const hasB = visible.has(edge.b);
    if (!hasA && !hasB) continue;
    if (hasA && hasB) {
      addEdge(edges, edgeMap, nodes.find((n) => n.id === edge.a), nodes.find((n) => n.id === edge.b), edge.label, 'topic');
      continue;
    }
    const outsideId = hasA ? edge.b : edge.a;
    const insideId = hasA ? edge.a : edge.b;
    let outside = externals.get(outsideId);
    if (!outside) {
      const other = getEntity(outsideId);
      if (!other) continue;
      const q = spherePoint(externals.size, Math.max(6, Math.min(18, topicEdges.length)), EXTERNAL_R, 1.1);
      outside = addNode(nodes, {
        id: other.id,
        entity: other,
        kind: 'external',
        level: other.level,
        label: trim(other.name, 24),
        name: other.name,
        x: q.x,
        y: q.y,
        z: q.z,
        r: 3.5
      });
      externals.set(outsideId, outside);
    }
    addEdge(edges, edgeMap, nodes.find((n) => n.id === insideId), outside, edge.label, 'topic');
  }

  // 保留一级课程之间的关系：当前焦点课程与外部课程。
  for (const edge of data.edges) {
    if (visible.has(edge.a) && visible.has(edge.b)) {
      addEdge(edges, edgeMap, nodes.find((n) => n.id === edge.a), nodes.find((n) => n.id === edge.b), edge.label, 'course');
      continue;
    }
    if (entity.level === 1) {
      const otherId = edge.a === entity.id ? edge.b : edge.b === entity.id ? edge.a : null;
      if (!otherId || visible.has(otherId)) continue;
      let outside = externals.get(otherId);
      if (!outside) {
        const other = getEntity(otherId);
        if (!other) continue;
        const q = spherePoint(externals.size, 12, EXTERNAL_R, 0.5);
        outside = addNode(nodes, {
          id: other.id,
          entity: other,
          kind: 'external',
          level: 1,
          label: trim(other.name, 24),
          name: other.name,
          x: q.x,
          y: q.y,
          z: q.z,
          r: 3.8
        });
        externals.set(otherId, outside);
      }
      addEdge(edges, edgeMap, center, outside, edge.label, 'course');
    }
  }

  if (ui.mode === '2d') layoutFocus2D(center, nodes, edges);

  for (const node of nodes) {
    const saved = manualPositions.get(positionKey(entity.id, node.id));
    if (saved) {
      node.x = saved.x;
      node.y = saved.y;
      node.z = saved.z;
    }
  }

  const graph = {
    focusId: entity.id,
    level: entity.level,
    kind: entity.kind,
    center,
    nodes,
    edges,
    byId: new Map(nodes.map((n) => [n.id, n])),
    origin: entity,
    path: pathOf(entity.id),
    born: performance.now()
  };
  focusGraph = graph;
  ui.focusGraph = graph;
  return graph;
}

export function getFocus() {
  return ui.focusGraph || null;
}

export function focusNodeAt(id) {
  const graph = getFocus();
  return graph ? graph.byId.get(id) || null : null;
}

/** 屏幕命中局部 3D 节点。 */
export function nodeAtFocus(sx, sy) {
  const graph = getFocus();
  if (!graph) return null;
  const sorted = [...graph.nodes].sort((a, b) => projectFocusNode(a).depth - projectFocusNode(b).depth);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const n = sorted[i];
    const p = projectFocusNode(n);
    const s = worldToScreen(p.x, p.y);
    const depthScale = 0.78 + p.depth * 0.44;
    const hit = Math.max(9, n.r * cam.scale * depthScale + 9);
    if (Math.hypot(sx - s.x, sy - s.y) <= hit) return n;
  }
  return null;
}

/** 局部关系图的边命中。 */
export function edgeAtFocus(x, y) {
  const graph = getFocus();
  if (!graph) return null;
  let best = null;
  let bd = 10;
  for (const e of graph.edges) {
    const a = worldToScreen(projectFocusNode(e.pa).x, projectFocusNode(e.pa).y);
    const b = worldToScreen(projectFocusNode(e.pb).x, projectFocusNode(e.pb).y);
    const d = distToSegment(x, y, a, b);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** 适配当前局部 3D 图（使用投影后的包围盒，面板留白由 camera 处理）。 */
export function fitFocus(animate = true) {
  const graph = getFocus();
  if (!graph) return;
  const pts = projectedNodes(graph);
  // 2D 局部图只让中心与章节云参与适配，外圈关联节点允许留在视口边缘，避免把星云压小。
  const fitPts = ui.mode === '2d' ? pts.filter((n) => n.kind !== 'external') : pts;
  fitFocusView(fitPts.length ? fitPts : pts, animate);
}

/** 从当前选择重画图（关联增删后调用）。 */
export function rebuildFocus() {
  const id = ui.focusId;
  if (!id) return null;
  const graph = buildFocus(id);
  fitFocus(true);
  return graph;
}

export { EXTERNAL_R, CHAPTER_R };