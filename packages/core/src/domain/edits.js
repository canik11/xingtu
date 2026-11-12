// 编辑动作：节点/分类/关系的增删改。纯数据函数，返回新列表或报告变更。
import { LIMITS, PANEL_WIDTH } from '../constants.js';
import { randRange, uid } from '../shared/utils.js';

/**
 * 删除没有任何节点使用的自定义分类，内置分类始终保留。
 * @param {import('../types.js').Category[]} categories
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @param {string[]} builtinIds
 * @returns {{categories:import('../types.js').Category[], removed:number}}
 */
export function pruneEmptyCategories(categories, nodes, builtinIds) {
  const used = new Set(nodes.map((n) => n.cat));
  const builtin = new Set(builtinIds || []);
  const kept = categories.filter((c) => used.has(c.id) || builtin.has(c.id));
  return { categories: kept, removed: categories.length - kept.length };
}

/**
 * 按名称取分类，没有就新建。
 * @param {import('../types.js').Category[]} categories
 * @param {string} rawName
 * @param {[number,number]|null} [anchor]
 * @returns {import('../types.js').Category}
 */
export function getOrCreateCategory(categories, rawName, anchor) {
  const name = (rawName || '').trim().slice(0, LIMITS.categoryName) || '未分类';
  let c = categories.find((x) => x.name === name);
  if (!c) {
    c = { id: uid('cat'), name, anchor: anchor ? [anchor[0], anchor[1]] : null };
    categories.push(c);
  }
  if (anchor && (!c.anchor || !Array.isArray(c.anchor))) c.anchor = [anchor[0], anchor[1]];
  return c;
}

/**
 * 校验关系草稿：去掉空值、自环、重复，并补默认标签。
 * @param {Array<{other:string,label:string}>} draft
 * @param {string} selfId
 * @param {Set<string>} validIds
 * @returns {Array<{other:string,label:string}>}
 */
export function sanitizeRelations(draft, selfId, validIds) {
  const out = [];
  const seen = new Set();
  for (const r of draft || []) {
    if (!r || !r.other || r.other === selfId || !validIds.has(r.other)) continue;
    if (seen.has(r.other)) continue;
    seen.add(r.other);
    out.push({ other: r.other, label: (r.label || '').trim().slice(0, LIMITS.edgeLabel) || '相关' });
  }
  return out;
}

/**
 * 用给定关系替换某节点的全部边（左边的边 = 该节点的关联）。
 * @param {import('../types.js').KnowledgeEdge[]} edges
 * @param {string} nodeId
 * @param {Array<{other:string,label:string}>} relations 已 sanitize 的关系
 * @returns {import('../types.js').KnowledgeEdge[]}
 */
export function replaceNodeEdges(edges, nodeId, relations) {
  const kept = edges.filter((e) => e.a !== nodeId && e.b !== nodeId);
  for (const r of relations) kept.push({ a: nodeId, b: r.other, label: r.label });
  return kept;
}

/**
 * 删除节点及其所有边。
 * @param {import('../types.js').KnowledgeData} data
 * @param {string} nodeId
 * @returns {{nodes:import('../types.js').KnowledgeNode[], edges:import('../types.js').KnowledgeEdge[], removedEdges:number}}
 */
export function removeNode(data, nodeId) {
  const nodes = data.nodes.filter((n) => n.id !== nodeId);
  const edges = data.edges.filter((e) => e.a !== nodeId && e.b !== nodeId);
  return { nodes, edges, removedEdges: data.edges.length - edges.length };
}

/**
 * 新节点的落点：优先用双击位置，其次关联节点的重心，最后分类锚点。
 * @param {{pendingPos:[number,number]|null, relations:Array<{other:string}>, nodeMap:Map<string,{x:number,y:number}>, anchor:[number,number]|null}} opts
 * @returns {[number, number]}
 */
export function pickNewNodePosition({ pendingPos, relations, nodeMap, anchor }) {
  if (pendingPos) return [pendingPos[0], pendingPos[1]];
  const linked = (relations || []).map((r) => nodeMap.get(r.other)).filter(Boolean);
  if (linked.length) {
    return [
      linked.reduce((s, n) => s + n.x, 0) / linked.length + randRange(-55, 55),
      linked.reduce((s, n) => s + n.y, 0) / linked.length + randRange(-45, 45)
    ];
  }
  const a = anchor || [0, 0];
  return [a[0] + randRange(-80, 80), a[1] + randRange(-60, 60)];
}

/**
 * 组装一个新节点对象（不入库）。
 * @param {{name:string, catId:string, desc:string, x:number, y:number, now:number}} opts
 * @returns {import('../types.js').KnowledgeNode & {born:number}}
 */
export function buildNode({ name, catId, desc, x, y, now }) {
  return {
    id: uid('n'),
    name: String(name || '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.nodeName),
    cat: catId,
    desc: String(desc || '').trim().slice(0, LIMITS.desc),
    note: [],
    x,
    y,
    born: now
  };
}

/**
 * 名称是否冲突（忽略自身）。
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @param {string} name
 * @param {string|null} [exceptId]
 * @returns {boolean}
 */
export function nameTaken(nodes, name, exceptId) {
  return nodes.some((x) => x.id !== exceptId && x.name === name);
}

/**
 * 详情面板打开时，把节点摆在左侧可视区域中央。
 * 纯几何计算，不依赖相机实现，方便测试。
 * @param {{node:{x:number,y:number}, viewport:{w:number,h:number}, cam:{x:number,y:number,scale:number}}} opts
 * @returns {{x:number,y:number,scale:number}} 目标相机（直接赋值即可）
 */
export function panelFocusCamera({ node, viewport, cam }) {
  const { w: W, h: H } = viewport;
  const s = Math.min(1.35, Math.max(0.92, Math.max(cam.scale, 0.92)));
  let sx = W / 2;
  if (W > 820) sx = Math.max(130, (W - Math.min(PANEL_WIDTH, W)) / 2);
  const sy = H * 0.5;
  return { x: node.x - (sx - W / 2) / s, y: node.y - (sy - H / 2) / s, scale: s };
}

/** 统计节点关联数（不含重复边）。 */
export function degreeOf(nodeId, edges) {
  let deg = 0;
  for (const e of edges) if (e.a === nodeId || e.b === nodeId) deg++;
  return deg;
}