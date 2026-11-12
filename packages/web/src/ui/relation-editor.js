// 关联编辑器：课程通用的「选择节点 + 关系标签」行。
import { esc, closest } from '../lib/dom.js';
import { data } from '../store.js';

/**
 * 渲染关联行。
 * @param {HTMLElement} wrap 容器
 * @param {Array<{other:string,label:string}>} relations
 * @param {string|null} excludeId 不能连到自己的节点 id
 */
export function renderRelations(wrap, relations, excludeId) {
  if (!wrap) return;
  wrap.innerHTML =
    relations
      .map((r, i) => {
        const opts = data.nodes
          .filter((n) => n.id !== excludeId)
          .map((n) => `<option value="${esc(n.id)}" ${n.id === r.other ? 'selected' : ''}>${esc(n.name)}</option>`)
          .join('');
        return `<div class="rel-row" data-i="${i}">
        <select aria-label="关联节点"><option value="">选择节点…</option>${opts}</select>
        <input class="rel-label" type="text" maxlength="20" value="${esc(r.label || '')}" placeholder="关系，如：基础" aria-label="关系说明">
        <button class="rel-remove" type="button" data-act="removeRel" data-i="${i}" title="移除" aria-label="移除">×</button>
      </div>`;
      })
      .join('') || '<div class="rel-empty">暂无关联。点击下方按钮添加一条。</div>';
}

/**
 * 绑定编辑器的三条事件（改节点、改标签、删除一行）。
 * @param {HTMLElement} wrap
 * @param {{relations:Array<{other:string,label:string}>}} state
 * @param {() => void} rerender
 */
export function wireRelEditor(wrap, state, rerender) {
  wrap.onchange = (e) => {
    const sel = closest(e.target, 'select');
    if (!sel) return;
    const row = closest(sel, '.rel-row');
    const i = Number(row.dataset.i);
    if (state.relations[i]) state.relations[i].other = sel.value;
  };
  wrap.oninput = (e) => {
    const inp = closest(e.target, 'input.rel-label');
    if (!inp) return;
    const row = closest(inp, '.rel-row');
    const i = Number(row.dataset.i);
    if (state.relations[i]) state.relations[i].label = inp.value;
  };
  wrap.onclick = (e) => {
    const btn = closest(e.target, '[data-act="removeRel"]');
    if (!btn) return;
    const i = Number(closest(btn, '.rel-row').dataset.i);
    state.relations.splice(i, 1);
    rerender();
  };
}