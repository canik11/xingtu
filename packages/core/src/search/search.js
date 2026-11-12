// 搜索：跨节点名称、简介、笔记正文与分类名。
// 保留原单文件版语义（子串匹配、命中集合），额外给出排序结果供搜索面板使用。
import { noteToText } from '../domain/note.js';

/**
 * @typedef {{node:import('../types.js').KnowledgeNode, score:number, field:'name'|'desc'|'note'|'category'}} SearchHit
 */

/**
 * 返回命中的节点 id 集合（含分类名匹配，与原版行为一致）。
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @param {Map<string, import('../types.js').Category>} catMap
 * @param {string} rawQuery 未转小写的原始输入
 * @returns {Set<string>}
 */
export function matchNodeIds(nodes, catMap, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  const ids = new Set();
  if (!q) return ids;
  for (const n of nodes) {
    const cat = catMap.get(n.cat);
    const hay = (n.name + ' ' + n.desc + ' ' + (n.noteText || noteToText(n.note || [])) + ' ' + (cat ? cat.name : '')).toLowerCase();
    if (hay.includes(q)) ids.add(n.id);
  }
  return ids;
}

/**
 * 带排序的搜索：名称命中权重最高，其次简介、笔记正文、分类名。
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @param {Map<string, import('../types.js').Category>} catMap
 * @param {string} rawQuery
 * @param {number} [limit]
 * @returns {SearchHit[]}
 */
export function searchNodes(nodes, catMap, rawQuery, limit = 40) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const n of nodes) {
    const name = (n.name || '').toLowerCase();
    let score = 0;
    let field = 'name';
    const idx = name.indexOf(q);
    if (idx === 0) score = 120;
    else if (idx > 0) score = 90 - Math.min(idx, 20);
    if (!score && n.desc && n.desc.toLowerCase().includes(q)) {
      score = 55;
      field = 'desc';
    }
    if (!score) {
      const noteText = (n.noteText || noteToText(n.note || [])).toLowerCase();
      if (noteText.includes(q)) {
        score = 28;
        field = 'note';
      }
    }
    if (!score) {
      const cat = catMap && catMap.get(n.cat);
      if (cat && cat.name.toLowerCase().includes(q)) {
        score = 12;
        field = 'category';
      }
    }
    if (score) hits.push({ node: n, score, field });
  }
  hits.sort((a, b) => b.score - a.score || (b.node.deg || 0) - (a.node.deg || 0));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

/**
 * 在命中集合里挑一个「最中心」的节点（关联最多者优先，同分取名称序）。
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @param {Set<string>} ids
 * @returns {import('../types.js').KnowledgeNode|null}
 */
export function bestMatch(nodes, ids) {
  let best = null;
  for (const n of nodes) {
    if (!ids.has(n.id)) continue;
    if (!best || (n.deg || 0) > (best.deg || 0)) best = n;
  }
  return best;
}