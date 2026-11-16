// 面板“编辑资料”模式：进入、渲染、取消与状态持有。
import { el } from '../lib/dom.js';
import { ui } from '../state.js';
import { index } from '../store.js';
import { renderPanelEdit, renderPanelView } from './panel.js';

export const editState = { id: null, relations: [], original: null };

let editing = false;
const editListeners = new Set();

/** 订阅编辑态/编辑内容变化（用于刷新未保存提示）。 */
export function onEditStateChange(fn) {
  editListeners.add(fn);
  return () => editListeners.delete(fn);
}

function notifyEditState() {
  for (const fn of editListeners) {
    try {
      fn();
    } catch (e) {
      /* 监听器异常不影响编辑 */
    }
  }
}

/** 是否在编辑态。 */
export function isEditing() {
  return editing;
}

/** 设置编辑态标记。 */
export function setEditing(value) {
  editing = !!value;
  if (!editing) editState.original = null;
  notifyEditState();
}

/** 读取编辑表单当前内容（关系用字符串比较，顺序稳定即可）。 */
function readForm() {
  const name = document.getElementById('editName');
  const cat = document.getElementById('editCat');
  const desc = document.getElementById('editDesc');
  return {
    name: name ? name.value.trim() : '',
    cat: cat ? cat.value.trim() : '',
    desc: desc ? desc.value.trim() : '',
    relations: (editState.relations || []).map((r) => `${r.other || ''}\u0001${r.label || ''}`).join('\u0002')
  };
}

/** 进入编辑时记下原始值，之后用来判断有没有改动。 */
export function captureEditOriginal() {
  editState.original = readForm();
}

/** 编辑内容是否与进入时不同（关闭前询问用）。 */
export function hasEditChanges() {
  if (!editing || !editState.original) return false;
  const now = readForm();
  const old = editState.original;
  return now.name !== old.name || now.cat !== old.cat || now.desc !== old.desc || now.relations !== old.relations;
}

/** 进入编辑态。 */
export function enterEdit() {
  if (!ui.selection) return;
  const n = index.getNode(ui.selection);
  if (!n) return;
  editState.id = n.id;
  editState.relations = index.neighborsOf(n.id).map((r) => ({ other: r.other.id, label: r.label }));
  renderPanelEdit(n);
  captureEditOriginal();
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
  editState.original = null;
  if (n && el.panelBody) renderPanelView(n);
}