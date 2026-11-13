// 顶部统计：星海视图按当前展开层级统计；局部图/内部图仍显示全库总量。
import { el } from './lib/dom.js';
import { ui } from './state.js';
import { data } from './store.js';
import { sceneVisuals, sceneEdges } from './hierarchy.js';

export function updateStats() {
  if (!el.statNodes || !el.statEdges) return;
  if (ui.level === 'sphere') {
    const visuals = sceneVisuals();
    el.statNodes.textContent = visuals.length;
    el.statEdges.textContent = sceneEdges(visuals).length;
    return;
  }
  el.statNodes.textContent = data.nodes.length;
  el.statEdges.textContent = data.edges.length;
}