// 力导向布局：同分类强弹簧聚成星座，跨分类弱弹簧拉出长长光丝。
// 纯计算，不依赖 DOM，可在 Node 中直接跑模拟验证。
import { randRange } from '../shared/utils.js';

/**
 * 推进一帧模拟。
 * @param {import('../types.js').KnowledgeData} data 节点需带 x/y/vx/vy/fx/fy/fixed/r
 * @param {import('../types.js').KnowledgeEdge[]} edges
 * @param {Map<string, import('../types.js').Category>} catMap
 * @param {number} alpha 当前温度（0–1）
 */
export function simulateStep(data, edges, catMap, alpha) {
  const nodes = data.nodes;
  if (!nodes.length) return;
  for (const n of nodes) {
    n.fx = 0;
    n.fy = 0;
  }

  // 分类引力中心
  for (const n of nodes) {
    const cat = catMap.get(n.cat);
    if (!cat || !cat.anchor) continue;
    n.fx += (cat.anchor[0] - n.x) * 0.005;
    n.fy += (cat.anchor[1] - n.y) * 0.005;
  }

  // 全局微重力：让整体不至于飘远
  for (const n of nodes) {
    n.fx += -n.x * 0.0001;
    n.fy += -n.y * 0.0001;
  }

  // 斥力 + 最小间距
  const reach = 620;
  const reach2 = reach * reach;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > reach2) continue;
      if (d2 < 0.01) {
        dx = randRange(-1, 1);
        dy = randRange(-1, 1);
        d2 = dx * dx + dy * dy || 1;
      }
      const d = Math.sqrt(d2);
      const push = Math.min(12, 30000 / Math.max(d2, 100));
      const ux = dx / d;
      const uy = dy / d;
      a.fx -= ux * push;
      a.fy -= uy * push;
      b.fx += ux * push;
      b.fy += uy * push;
      if (d < 104) {
        const extra = 0.14 * (104 - d);
        a.fx -= ux * extra;
        a.fy -= uy * extra;
        b.fx += ux * extra;
        b.fy += uy * extra;
      }
    }
  }

  // 弹簧
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = nodeMap.get(e.a);
    const b = nodeMap.get(e.b);
    if (!a || !b) continue;
    const same = a.cat === b.cat;
    const rest = same ? 175 : 330;
    const k = same ? 0.012 : 0.002;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    if (d < 0.01) {
      dx = randRange(-1, 1);
      dy = randRange(-1, 1);
      d = Math.hypot(dx, dy) || 1;
    }
    const f = Math.max(same ? -9 : -0.8, Math.min(same ? 3.0 : 0.8, (d - rest) * k));
    const ux = dx / d;
    const uy = dy / d;
    a.fx += ux * f;
    a.fy += uy * f;
    b.fx -= ux * f;
    b.fy -= uy * f;
  }

  // 积分：与单文件旧版保持一致，alpha 只作用在速度积分上
  for (const n of nodes) {
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = (n.vx + n.fx * alpha * 0.6) * 0.86;
    n.vy = (n.vy + n.fy * alpha * 0.6) * 0.86;
    const speed = Math.hypot(n.vx, n.vy);
    if (speed > 9) {
      n.vx = (n.vx / speed) * 9;
      n.vy = (n.vy / speed) * 9;
    }
    n.x += n.vx;
    n.y += n.vy;
  }

  // 兜底：硬性最小间距
  const minGap = 80;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d >= minGap) continue;
      const shift = (minGap - d) * 0.5;
      const ux = dx / d;
      const uy = dy / d;
      if (!a.fixed) {
        a.x -= ux * shift;
        a.y -= uy * shift;
      }
      if (!b.fixed) {
        b.x += ux * shift;
        b.y += uy * shift;
      }
    }
  }
}

/**
 * 预热：反复推进直到收敛，用于首次打开、重新布局、导入之后。
 * @param {import('../types.js').KnowledgeData} data
 * @param {import('../types.js').KnowledgeEdge[]} edges
 * @param {Map<string, import('../types.js').Category>} catMap
 * @param {number} [steps=360]
 */
export function warmup(data, edges, catMap, steps = 360) {
  let alpha = 1;
  for (let i = 0; i < steps; i++) {
    simulateStep(data, edges, catMap, alpha);
    alpha *= 0.985;
    if (alpha < 0.02) alpha = 0.02;
  }
}

/**
 * 计算布局包围盒，供 fitView 使用。
 * @param {import('../types.js').KnowledgeNode[]} nodes
 * @returns {{minX:number,minY:number,maxX:number,maxY:number,width:number,height:number}}
 */
export function layoutBounds(nodes) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}