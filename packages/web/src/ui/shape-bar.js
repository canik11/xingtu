// 左侧星海形状栏：把外观设置里的形状卡片独立成可折叠的常驻面板。
// 形状偏好本身由 shapes.js 保存（localStorage），这里只负责渲染、折叠与点击。
import { el } from '../lib/dom.js';
import { SHAPES, shapeIcon } from '../shapes.js';
import { applyShapeForUser } from '../navigation.js';

const STORE_KEY = 'starmap.shapebar.v1';

function readCollapsed() {
  try {
    const value = localStorage.getItem(STORE_KEY);
    if (value === 'collapsed') return true;
    if (value === 'open') return false;
  } catch (e) {
    /* 隐私模式 / 存储不可用时不记忆折叠状态。 */
  }
  // 窄屏默认收起，避免挡住星海。
  return window.innerWidth <= 900;
}

function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(STORE_KEY, collapsed ? 'collapsed' : 'open');
  } catch (e) {
    /* 隐私模式 / 存储不可用时本次会话仍然生效。 */
  }
}

export function setShapeBarCollapsed(collapsed) {
  if (!el.shapeBar) return;
  el.shapeBar.dataset.collapsed = collapsed ? '1' : '0';
  el.shapeBarToggle.setAttribute('aria-expanded', String(!collapsed));
  el.shapeBarToggle.title = collapsed ? '展开星海形状' : '收起星海形状';
  saveCollapsed(collapsed);
}

export function toggleShapeBar() {
  if (!el.shapeBar) return;
  setShapeBarCollapsed(el.shapeBar.dataset.collapsed !== '1');
}

/** 渲染形状卡片；选中态由 navigation.syncNav 统一同步。 */
export function renderShapeBar() {
  if (!el.shapeBarList) return;
  el.shapeBarList.replaceChildren();
  for (const shape of SHAPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shape-card';
    button.dataset.shape = shape.id;
    button.title = shape.hint;
    button.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('span');
    icon.className = 'shape-card-icon';
    icon.innerHTML = shapeIcon(shape.id);
    const name = document.createElement('span');
    name.className = 'shape-card-name';
    name.textContent = shape.name;
    button.append(icon, name);
    el.shapeBarList.appendChild(button);
  }
}

export function bindShapeBar() {
  if (!el.shapeBar) return;
  renderShapeBar();
  setShapeBarCollapsed(readCollapsed());
  el.shapeBarToggle.addEventListener('click', toggleShapeBar);
  el.shapeBarList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-shape]');
    if (!button || !button.dataset.shape) return;
    applyShapeForUser(button.dataset.shape);
  });
}