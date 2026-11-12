// 分类下拉数据：给「分类」输入框提供已有分类建议。
import { el, esc } from '../lib/dom.js';
import { data } from '../store.js';

export function refreshCategoryDatalist() {
  if (!el.catOptions) return;
  el.catOptions.innerHTML = data.categories.map((c) => `<option value="${esc(c.name)}"></option>`).join('');
}