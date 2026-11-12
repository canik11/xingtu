// 索引层：把线性数据整理成渲染层要用的查询结构。
// 由于绘图每帧都要用到索引，这里做成类，由应用启动时持有实例。
import { noteToText, countNote } from './note.js';

export class KnowledgeIndex {
  constructor() {
    /** @type {Map<string, import('../types.js').KnowledgeNode>} */
    this.nodeMap = new Map();
    /** @type {Map<string, import('../types.js').Category>} */
    this.catMap = new Map();
    /** @type {Map<string, import('../types.js').KnowledgeEdge[]>} */
    this.neighborMap = new Map();
  }

  /**
   * 重建索引。会顺手去重边、补齐标签、派生出 deg / r / noteText / noteCount 等渲染字段。
   * @param {import('../types.js').KnowledgeData} data
   * @returns {import('../types.js').KnowledgeData} 规范化之后的 data（edges 被去重）
   */
  rebuild(data) {
    const { nodeMap, catMap, neighborMap } = this;
    nodeMap.clear();
    catMap.clear();
    this.categoryMap = catMap;
    neighborMap.clear();

    data.categories.forEach((c) => catMap.set(c.id, c));
    data.nodes.forEach((n) => {
      nodeMap.set(n.id, n);
      neighborMap.set(n.id, []);
    });

    const edges = [];
    const seen = new Set();
    data.edges.forEach((e) => {
      if (!e || !nodeMap.has(e.a) || !nodeMap.has(e.b) || e.a === e.b) return;
      const key = e.a < e.b ? e.a + '|' + e.b : e.b + '|' + e.a;
      if (seen.has(key)) return;
      seen.add(key);
      e.label = (e.label && String(e.label).trim()) || '相关';
      edges.push(e);
      neighborMap.get(e.a).push(e);
      neighborMap.get(e.b).push(e);
    });
    data.edges = edges;

    data.nodes.forEach((n) => {
      n.deg = neighborMap.get(n.id).length;
      n.r = 3.9 + Math.min(n.deg, 7) * 0.46;
      n.note = Array.isArray(n.note) ? n.note : [];
      n.noteText = noteToText(n.note);
      n.noteCount = countNote(n.note);
      n.vx = Number.isFinite(n.vx) ? n.vx : 0;
      n.vy = Number.isFinite(n.vy) ? n.vy : 0;
      n.fx = 0;
      n.fy = 0;
      n.fixed = !!n.fixed;
    });
    return data;
  }

  getNode(id) {
    return this.nodeMap.get(id) || null;
  }

  getCategory(id) {
    return this.catMap.get(id) || null;
  }

  /** 某节点的全部关联边。 */
  edgesOf(id) {
    return this.neighborMap.get(id) || [];
  }

  /** 某节点的邻居节点列表（带关系标签）。 */
  neighborsOf(id) {
    return this.edgesOf(id)
      .map((e) => {
        const otherId = e.a === id ? e.b : e.a;
        return { other: this.getNode(otherId), label: e.label };
      })
      .filter((r) => r.other);
  }

  /** 选中一个节点时，需要保持明亮的节点集合（自身 + 直接邻居）。 */
  selectionSetOf(id) {
    const set = new Set();
    if (!id || !this.nodeMap.has(id)) return set;
    set.add(id);
    for (const e of this.edgesOf(id)) set.add(e.a === id ? e.b : e.a);
    return set;
  }

  /** 某分类的成员节点。 */
  membersOf(catId) {
    return this.nodeMap.size ? [...this.nodeMap.values()].filter((n) => n.cat === catId) : [];
  }
}

/**
 * 给没有坐标的分类补一个引力中心（成员重心）。
 * @param {import('../types.js').KnowledgeData} data
 */
export function ensureAnchors(data) {
  data.categories.forEach((c) => {
    if (!Array.isArray(c.anchor) || c.anchor.length !== 2 || !c.anchor.every((v) => Number.isFinite(+v))) {
      const members = data.nodes.filter((n) => n.cat === c.id && Number.isFinite(n.x) && Number.isFinite(n.y));
      if (members.length) {
        c.anchor = [
          members.reduce((s, n) => s + n.x, 0) / members.length,
          members.reduce((s, n) => s + n.y, 0) / members.length
        ];
      } else {
        c.anchor = [0, 0];
      }
    } else {
      c.anchor = [+c.anchor[0], +c.anchor[1]];
    }
  });
}

/**
 * 给缺坐标的节点在分类附近随机落点。
 * @param {import('../types.js').KnowledgeData} data
 * @param {Map<string, import('../types.js').Category>} catMap
 * @param {(a:number,b:number)=>number} randRange
 * @returns {number} 缺失坐标的节点数量
 */
export function ensurePositions(data, catMap, randRange) {
  let missing = 0;
  data.nodes.forEach((n) => {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      missing++;
      const c = catMap.get(n.cat);
      const a = c && c.anchor ? c.anchor : [0, 0];
      n.x = a[0] + randRange(-90, 90);
      n.y = a[1] + randRange(-70, 70);
    }
  });
  return missing;
}