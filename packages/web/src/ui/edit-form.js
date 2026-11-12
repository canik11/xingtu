// 面板“编辑资料”模式：进入、渲染、取消与状态持有。
import { el } from '../lib/dom.js';
import { ui } from '../state.js';
import { index } from '../store.js';
import { renderPanelEdit, renderPanelView } from './panel.js';

export const editState = { id: null, relations: [] };

let editing = false;

/** 是否在编辑态。 */
export function isEditing() {
  return editing;
}

/** 设置编辑态标记。 */
export function setEditing(value) {
  editing = !!value;
}

/** 进入编辑态。 */
export function enterEdit() {
  if (!ui.selection) return;
  const n = index.getNode(ui.selection);
  if (!n) return;
  editState.id = n.id;
  editState.relations = index.neighborsOf(n.id).map((r) => ({ other: r.other.id, label: r.label }));
  renderPanelEdit(n);
  setTimeout(() => {
    const inp = document.getElementById('editName');
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 80);
}

/** 取消编辑，回到查看态。 */
export function cancelEdit() {
  const n = index.getNode(ui.selection);
  editing = false;
  if (n && el.panelBody) renderPanelView(n);
}