// 知识库数据模型：初始数据、规范化、迁移与序列化。
// 所有函数都是纯数据操作，不接触 DOM / localStorage。
import { clamp, edgeKey, toNumber, uid } from '../shared/utils.js';
import { CONTENT_VERSION, DATA_VERSION, LIMITS } from '../constants.js';
import { DEFAULT_CATEGORIES, DEFAULT_EDGES, DEFAULT_NODES } from '../seed/seed.js';
import { makeNote, noteFromDesc, normalizeNote } from './note.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SCALE_MIN = 0.4;
const SCALE_MAX = 1.8;
const DEFAULT_APPEARANCE = {
  defaultColor: '#ffffff',
  masteredColor: '#ffa200',
  nodeBrightness: 1,
  nodeSize: 1,
  nodeStarSize: 1,
  edgeBrightness: 1,
  pulseBrightness: 1,
  pulseSize: 1
};

// 旧版本的默认配色：存档里还是这两个色值时，视为“从未自定义过”，
// 升级成新的纯白/琥珀色，否则老用户打开后看不到新默认。
const LEGACY_APPEARANCE = {
  defaultColor: '#e4f2ff',
  masteredColor: '#ffbe4e'
};

/**
 * 滑杆基准：v3 起滑杆 100% 对应的渲染倍率。
 * 旧版把 180% / 119% / 161% / 80% 存成了绝对倍率；迁移时除以这里的值，
 * 老用户观感保持不变，而界面上显示为相对 100%。
 */
export const BASE_SCALE = Object.freeze({
  nodeBrightness: 1.8,
  nodeSize: 1.19,
  edgeBrightness: 1,
  pulseBrightness: 1.61,
  pulseSize: 0.8,
  // 星芒大小是 v3 之后新增的滑杆：100% 就是当时代码里的固定倍率，不需要迁移。
  nodeStarSize: 1
});

function cleanColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function migrateColor(value, legacy, fallback) {
  const color = cleanColor(value);
  if (!color) return fallback;
  return color === legacy ? fallback : color;
}

/** 外观滑杆值：限制在 40%–180%，旧数据没有时用 1。 */
function cleanScale(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, number));
}

/** 外观配置是可选字段；旧数据没有时回落到默认纯白/琥珀色。 */
function normalizeAppearance(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const appearance = {
    defaultColor: migrateColor(source.defaultColor, LEGACY_APPEARANCE.defaultColor, DEFAULT_APPEARANCE.defaultColor),
    masteredColor: migrateColor(source.masteredColor, LEGACY_APPEARANCE.masteredColor, DEFAULT_APPEARANCE.masteredColor),
    nodeBrightness: cleanScale(source.nodeBrightness, DEFAULT_APPEARANCE.nodeBrightness),
    nodeSize: cleanScale(source.nodeSize, DEFAULT_APPEARANCE.nodeSize),
    nodeStarSize: cleanScale(source.nodeStarSize, DEFAULT_APPEARANCE.nodeStarSize),
    edgeBrightness: cleanScale(source.edgeBrightness, DEFAULT_APPEARANCE.edgeBrightness),
    pulseBrightness: cleanScale(source.pulseBrightness, DEFAULT_APPEARANCE.pulseBrightness),
    pulseSize: cleanScale(source.pulseSize, DEFAULT_APPEARANCE.pulseSize),
    courses: {}
  };
  const rawCourses = source.courses && typeof source.courses === 'object' ? source.courses : {};
  Object.keys(rawCourses).forEach((courseId) => {
    if (!courseId) return;
    const item = rawCourses[courseId];
    if (!item || typeof item !== 'object') return;
    const override = {};
    const def = cleanColor(item.defaultColor);
    const mastered = cleanColor(item.masteredColor);
    if (def) override.defaultColor = def;
    if (mastered) override.masteredColor = mastered;
    if (override.defaultColor || override.masteredColor) appearance.courses[courseId] = override;
  });
  return appearance;
}

/**
 * 生成初始知识库（首次打开 / 恢复初始库时使用）。
 * @returns {import('../types.js').KnowledgeData}
 */
export function createDefaultData() {
  return {
    version: DATA_VERSION,
    contentVersion: CONTENT_VERSION,
    categories: DEFAULT_CATEGORIES.map((c) => ({ id: c.id, name: c.name, anchor: c.anchor.slice() })),
    nodes: DEFAULT_NODES.map((n) => ({
      id: n.id,
      name: n.name,
      cat: n.cat,
      desc: n.desc,
      note: makeNote(n.note),
      x: n.x,
      y: n.y
    })),
    edges: DEFAULT_EDGES.map((e) => ({ a: e[0], b: e[1], label: e[2] })),
    // 跨层级关系：a/b 可以是课程 id，也可以是 `h:<笔记块 id>`。
    topicEdges: [],
    // 三级知识点的掌握标记：{ [笔记块 id]: true }。
    mastery: {},
    // 外观：全局默认色/掌握色、节点与脉冲的亮度/大小，以及按一级课程覆盖的配色。
    appearance: {
      defaultColor: '#ffffff',
      masteredColor: '#ffa200',
      nodeBrightness: 1,
      nodeSize: 1,
      nodeStarSize: 1,
      edgeBrightness: 1,
      pulseBrightness: 1,
      pulseSize: 1,
      courses: {}
    },
    view: null
  };
}

/**
 * 规范化任意来源的数据（存档、导入文件、外部同步）。
 * 返回 null 表示数据不可用（没有节点）。
 * @param {unknown} raw
 * @returns {(import('../types.js').KnowledgeData & {migrated:boolean})|null}
 */
export function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : null;
  if (!rawNodes || rawNodes.length === 0) return null;
  let migrated = false;
  const rawVersion = Number.isFinite(+raw.version) ? +raw.version : 0;
  const contentVersion = Number.isFinite(+raw.contentVersion) ? +raw.contentVersion : 0;

  const cats = [];
  const catIds = new Set();
  const rawCats = Array.isArray(raw.categories) ? raw.categories : [];
  rawCats.forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const id = c.id != null ? String(c.id) : uid('cat');
    if (catIds.has(id)) return;
    const name = String(c.name || '未分类').trim().slice(0, LIMITS.categoryName) || '未分类';
    const anchor = Array.isArray(c.anchor) && c.anchor.length === 2 && c.anchor.every((v) => Number.isFinite(+v))
      ? [+c.anchor[0], +c.anchor[1]]
      : null;
    cats.push({ id, name, anchor });
    catIds.add(id);
  });

  const nodes = [];
  const nodeIds = new Set();
  rawNodes.forEach((n) => {
    if (!n || typeof n !== 'object') return;
    let id = n.id != null ? String(n.id) : uid('n');
    while (nodeIds.has(id)) id = uid('n');
    const name = String(n.name || '未命名知识点').slice(0, LIMITS.nodeName);
    let cat = n.cat != null ? String(n.cat) : '';
    if (!catIds.has(cat)) {
      const known = DEFAULT_CATEGORIES.find((c) => c.id === cat) || DEFAULT_CATEGORIES.find((c) => c.name === cat);
      const cid = known ? known.id : (cat || 'misc');
      if (!catIds.has(cid)) {
        cats.push({
          id: cid,
          name: known ? known.name : '未分类',
          anchor: known ? known.anchor.slice() : null
        });
        catIds.add(cid);
      }
      cat = cid;
    }
    const x = toNumber(n.x);
    const y = toNumber(n.y);
    const desc = typeof n.desc === 'string' ? n.desc.slice(0, 20000) : '';
    const hasNote = Array.isArray(n.note);
    const note = hasNote ? normalizeNote(n.note) : noteFromDesc(desc);
    if (!hasNote) migrated = true;
    nodes.push({
      id,
      name,
      cat,
      desc,
      note,
      x: x === null ? null : clamp(x, -LIMITS.coord, LIMITS.coord),
      y: y === null ? null : clamp(y, -LIMITS.coord, LIMITS.coord)
    });
    nodeIds.add(id);
  });
  if (!nodes.length) return null;

  const edges = [];
  const edgeKeys = new Set();
  (Array.isArray(raw.edges) ? raw.edges : []).forEach((item) => {
    if (!item) return;
    let a;
    let b;
    let label;
    if (Array.isArray(item)) {
      a = item[0];
      b = item[1];
      label = item[2];
    } else if (typeof item === 'object') {
      a = item.a;
      b = item.b;
      label = item.label;
    } else {
      return;
    }
    if (a == null || b == null) return;
    a = String(a);
    b = String(b);
    if (!nodeIds.has(a) || !nodeIds.has(b) || a === b) return;
    const key = edgeKey(a, b);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a, b, label: String(label || '相关').slice(0, LIMITS.edgeLabel) });
  });

  // 标题级关系：允许跨课程、跨章节、跨知识点连线。
  const topicEdges = [];
  const topicKeys = new Set();
  (Array.isArray(raw.topicEdges) ? raw.topicEdges : []).forEach((item) => {
    if (!item) return;
    let a;
    let b;
    let label;
    if (Array.isArray(item)) {
      a = item[0];
      b = item[1];
      label = item[2];
    } else if (typeof item === 'object') {
      a = item.a;
      b = item.b;
      label = item.label;
    } else {
      return;
    }
    if (a == null || b == null) return;
    a = String(a);
    b = String(b);
    if (!a || !b || a === b) return;
    const key = edgeKey(a, b);
    if (topicKeys.has(key)) return;
    topicKeys.add(key);
    topicEdges.push({ a, b, label: String(label || '相关').slice(0, LIMITS.edgeLabel) });
  });

  // 掌握标记按笔记块 id 存储；只保留布尔真值，避免旧文件/脏数据带进奇怪结构。
  const mastery = {};
  const rawMastery = raw.mastery;
  if (Array.isArray(rawMastery)) {
    rawMastery.forEach((id) => {
      if (id != null && String(id)) mastery[String(id)] = true;
    });
  } else if (rawMastery && typeof rawMastery === 'object') {
    Object.keys(rawMastery).forEach((id) => {
      if (id && rawMastery[id]) mastery[String(id)] = true;
    });
  }

  const appearance = normalizeAppearance(raw.appearance);

  // v3：滑杆从绝对倍率改为相对基准；旧存档除以基准，保持原来的观感。
  if (rawVersion < 3) {
    Object.keys(BASE_SCALE).forEach((kind) => {
      appearance[kind] = clamp(appearance[kind] / BASE_SCALE[kind], SCALE_MIN, SCALE_MAX);
    });
    migrated = true;
  }

  let view = null;
  if (raw.view && [raw.view.x, raw.view.y, raw.view.scale].every((v) => Number.isFinite(+v))) {
    view = { x: +raw.view.x, y: +raw.view.y, scale: +raw.view.scale };
  }

  if (mergeCalculusNodes(nodes, edges)) migrated = true;

  return { version: DATA_VERSION, contentVersion, categories: cats, nodes, edges, topicEdges, mastery, appearance, view, migrated };
}

/**
 * 历史迁移：把「高等数学（上）/（下）」合并成一个节点。
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @param {import('../types.js').KnowledgeEdge[]} edges
 * @returns {boolean} 是否发生了合并
 */
export function mergeCalculusNodes(nodes, edges) {
  const upper = nodes.find((n) => n.id === 'calc1');
  const lower = nodes.find((n) => n.id === 'calc2');
  if (!upper || !lower) return false;

  upper.name = '高等数学';
  if (!upper.desc && lower.desc) upper.desc = lower.desc;
  if (lower.note.length) {
    if (upper.note.length) {
      upper.note.push({ id: uid('nb'), text: '下册', collapsed: false, children: lower.note });
    } else {
      upper.note = lower.note;
    }
  }
  nodes.splice(nodes.indexOf(lower), 1);

  const seen = new Set();
  const merged = [];
  for (const edge of edges) {
    if (edge.a === 'calc2') edge.a = 'calc1';
    if (edge.b === 'calc2') edge.b = 'calc1';
    if (edge.a === edge.b) continue;
    const key = edgeKey(edge.a, edge.b);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(edge);
  }
  edges.length = 0;
  edges.push(...merged);
  return true;
}

/**
 * 一次性种子合并：老用户（contentVersion 落后）打开时补全笔记、合并高数、补关系。
 * 用户自己的节点名、分类、位置、手动关系都保留。
 * @param {import('../types.js').KnowledgeData} target
 * @returns {{addedNodes:number, refreshedNotes:number, addedEdges:number}}
 */
export function mergeSeedContent(target) {
  const existing = new Map(target.nodes.map((n) => [n.id, n]));
  let addedNodes = 0;
  let refreshedNotes = 0;

  DEFAULT_NODES.forEach((seed) => {
    let n = existing.get(seed.id);
    if (!n) {
      const cat = DEFAULT_CATEGORIES.find((c) => c.id === seed.cat);
      if (cat && !target.categories.some((c) => c.id === cat.id)) {
        target.categories.push({ id: cat.id, name: cat.name, anchor: cat.anchor.slice() });
      }
      n = {
        id: seed.id,
        name: seed.name,
        cat: seed.cat,
        desc: seed.desc,
        note: makeNote(seed.note),
        x: seed.x,
        y: seed.y
      };
      target.nodes.push(n);
      existing.set(seed.id, n);
      addedNodes++;
      return;
    }

    n.note = makeNote(seed.note);
    refreshedNotes++;
    if (seed.id === 'calc1') {
      n.name = '高等数学';
      n.desc = seed.desc;
    } else if (!n.desc) {
      n.desc = seed.desc;
    }
    if (!Number.isFinite(+n.x) || !Number.isFinite(+n.y)) {
      n.x = seed.x;
      n.y = seed.y;
    }
  });

  const keys = new Set(target.edges.map((e) => edgeKey(e.a, e.b)));
  let addedEdges = 0;
  DEFAULT_EDGES.forEach(([a, b, label]) => {
    if (!existing.has(a) || !existing.has(b) || a === b) return;
    const key = edgeKey(a, b);
    if (keys.has(key)) return;
    keys.add(key);
    target.edges.push({ a, b, label });
    addedEdges++;
  });

  target.contentVersion = CONTENT_VERSION;
  return { addedNodes, refreshedNotes, addedEdges };
}

/**
 * 增量种子合并：只补入新版本新增的节点与关系，不改动用户已有的名称、简介、
 * 笔记、分类和坐标。用于 contentVersion >= 2 的老用户升级。
 * @param {import('../types.js').KnowledgeData} target
 * @returns {{addedNodes:number, refreshedNotes:number, addedEdges:number}}
 */
export function mergeSeedAdditions(target) {
  const existing = new Map(target.nodes.map((n) => [n.id, n]));
  let addedNodes = 0;

  DEFAULT_NODES.forEach((seed) => {
    if (existing.has(seed.id)) return;
    const cat = DEFAULT_CATEGORIES.find((c) => c.id === seed.cat);
    if (cat && !target.categories.some((c) => c.id === cat.id)) {
      target.categories.push({ id: cat.id, name: cat.name, anchor: cat.anchor.slice() });
    }
    const n = {
      id: seed.id,
      name: seed.name,
      cat: seed.cat,
      desc: seed.desc,
      note: makeNote(seed.note),
      x: seed.x,
      y: seed.y
    };
    target.nodes.push(n);
    existing.set(seed.id, n);
    addedNodes++;
  });

  const keys = new Set(target.edges.map((e) => edgeKey(e.a, e.b)));
  let addedEdges = 0;
  DEFAULT_EDGES.forEach(([a, b, label]) => {
    if (!existing.has(a) || !existing.has(b) || a === b) return;
    const key = edgeKey(a, b);
    if (keys.has(key)) return;
    keys.add(key);
    target.edges.push({ a, b, label });
    addedEdges++;
  });

  target.contentVersion = CONTENT_VERSION;
  return { addedNodes, refreshedNotes: 0, addedEdges };
}

/**
 * 是否需要种子升级。
 * @param {import('../types.js').KnowledgeData} data
 * @returns {boolean}
 */
export function needsSeedUpgrade(data) {
  return !(Number(data && data.contentVersion) >= CONTENT_VERSION);
}

/**
 * 序列化为可存盘的干净对象（坐标取整、去掉 UI 临时字段）。
 * @param {import('../types.js').KnowledgeData} data
 * @param {{x:number,y:number,scale:number}|null} [view]
 * @returns {import('../types.js').KnowledgeData}
 */
export function serializeData(data, view) {
  const v = view || data.view || null;
  return {
    version: DATA_VERSION,
    contentVersion: CONTENT_VERSION,
    categories: data.categories.map((c) => ({
      id: c.id,
      name: c.name,
      anchor: c.anchor ? [Math.round(c.anchor[0]), Math.round(c.anchor[1])] : null
    })),
    nodes: data.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      cat: n.cat,
      desc: n.desc,
      note: cloneNotePlain(n.note),
      x: Math.round(n.x),
      y: Math.round(n.y)
    })),
    edges: data.edges.map((e) => ({ a: e.a, b: e.b, label: e.label })),
    topicEdges: (data.topicEdges || []).map((e) => ({ a: e.a, b: e.b, label: e.label })),
    mastery: Object.fromEntries(
      Object.entries(data.mastery || {}).filter(([id, value]) => id && value)
    ),
    appearance: normalizeAppearance(data.appearance),
    view: v
      ? { x: Math.round(v.x), y: Math.round(v.y), scale: Math.round(v.scale * 1000) / 1000 }
      : null
  };
}

function cloneNotePlain(note) {
  return (note || []).map((block) => ({
    id: block.id,
    text: block.text,
    collapsed: !!block.collapsed,
    children: cloneNotePlain(block.children)
  }));
}