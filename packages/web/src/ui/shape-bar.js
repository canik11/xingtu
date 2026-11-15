// 左侧星海形状栏：一列形状卡片，可折叠、可拖动。
// 形状偏好本身由 shapes.js 保存（localStorage），这里只负责渲染、折叠、拖动与点击。
import { el } from '../lib/dom.js';
import { SHAPES, shapeIcon } from '../shapes.js';
import { applyShapeForUser } from '../navigation.js';

const STORE_KEY = 'starmap.shapebar.v1';
const POS_KEY = 'starmap.shapebar.pos.v1';
const DRAG_THRESHOLD = 4;
const EDGE_GAP = 8;

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

function readPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) return pos;
  } catch (e) {
    /* 位置记录损坏时回到默认位置。 */
  }
  return null;
}

function savePos(left, top) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
  } catch (e) {
    /* 存储不可用时仅本次会话生效。 */
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function limits() {
  const width = el.shapeBar.offsetWidth || 36;
  const height = el.shapeBar.offsetHeight || 36;
  return {
    maxLeft: Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP),
    maxTop: Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)
  };
}

function applyPos(left, top, remember) {
  if (!el.shapeBar) return;
  const { maxLeft, maxTop } = limits();
  const nextLeft = clamp(left, EDGE_GAP, maxLeft);
  const nextTop = clamp(top, EDGE_GAP, maxTop);
  el.shapeBar.style.left = `${nextLeft}px`;
  el.shapeBar.style.top = `${nextTop}px`;
  if (remember) savePos(nextLeft, nextTop);
}

/** 临时切到目标折叠态量一次尺寸，立刻恢复；不会触发过渡或闪烁。 */
function measureSize(collapsed) {
  const bar = el.shapeBar;
  const previous = bar.dataset.collapsed;
  bar.classList.add('measuring');
  bar.dataset.collapsed = collapsed ? '1' : '0';
  const width = bar.offsetWidth;
  const height = bar.offsetHeight;
  bar.dataset.collapsed = previous;
  void bar.offsetWidth;
  bar.classList.remove('measuring');
  return { width, height };
}

/**
 * 折叠/展开时贴着屏幕近的一边生长：
 * 面板在屏幕右半就保持右边缘、向左展开；在下半就保持下边缘、向上展开。
 * 同时按目标尺寸把位置夹回视口内，避免展开后被屏幕边缘裁掉。
 */
function placeAnchored(rect, size) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const anchorRight = rect.left + rect.width / 2 > vw / 2;
  const anchorBottom = rect.top + rect.height / 2 > vh / 2;
  const left = anchorRight ? rect.right - size.width : rect.left;
  const top = anchorBottom ? rect.bottom - size.height : rect.top;
  const maxLeft = Math.max(EDGE_GAP, vw - size.width - EDGE_GAP);
  const maxTop = Math.max(EDGE_GAP, vh - size.height - EDGE_GAP);
  const nextLeft = clamp(left, EDGE_GAP, maxLeft);
  const nextTop = clamp(top, EDGE_GAP, maxTop);
  el.shapeBar.style.left = `${nextLeft}px`;
  el.shapeBar.style.top = `${nextTop}px`;
  savePos(nextLeft, nextTop);
}

/** 尺寸变化后把面板拉回视口内；未越界时不动，避免把默认位置写死。 */
function ensureVisible() {
  if (!el.shapeBar) return;
  const rect = el.shapeBar.getBoundingClientRect();
  const { maxLeft, maxTop } = limits();
  const nextLeft = clamp(rect.left, EDGE_GAP, maxLeft);
  const nextTop = clamp(rect.top, EDGE_GAP, maxTop);
  if (nextLeft !== rect.left || nextTop !== rect.top) {
    el.shapeBar.style.left = `${nextLeft}px`;
    el.shapeBar.style.top = `${nextTop}px`;
  }
}

export function setShapeBarCollapsed(collapsed) {
  if (!el.shapeBar) return;
  const bar = el.shapeBar;
  const wasCollapsed = bar.dataset.collapsed === '1';
  el.shapeBarToggle.setAttribute('aria-expanded', String(!collapsed));
  el.shapeBarToggle.title = collapsed ? '展开星海形状' : '收起星海形状';
  saveCollapsed(collapsed);
  if (wasCollapsed === collapsed) return;
  // 先量当前矩形（旧尺寸），再量目标尺寸；位置以靠近屏幕的那条边为锚点。
  const rect = bar.getBoundingClientRect();
  const size = measureSize(collapsed);
  bar.dataset.collapsed = collapsed ? '1' : '0';
  placeAnchored(rect, size);
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

// 拖动整个面板：按住标题栏拖走，松手时记住位置；没拖动就是折叠/展开。
let drag = null;

function beginDrag(event) {
  if (drag || event.button !== 0) return;
  const rect = el.shapeBar.getBoundingClientRect();
  drag = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top,
    moved: false
  };
  el.shapeBar.classList.add('dragging');
  try {
    el.shapeBarToggle.setPointerCapture(event.pointerId);
  } catch (e) {
    /* 指针捕获不可用时仍可依赖普通事件。 */
  }
}

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  drag.moved = true;
  applyPos(drag.left + dx, drag.top + dy, false);
}

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null;
  el.shapeBar.classList.remove('dragging');
  try {
    if (el.shapeBarToggle.hasPointerCapture(event.pointerId)) {
      el.shapeBarToggle.releasePointerCapture(event.pointerId);
    }
  } catch (e) {
    /* 指针捕获已释放时忽略。 */
  }
  if (moved) {
    const rect = el.shapeBar.getBoundingClientRect();
    savePos(rect.left, rect.top);
  } else {
    toggleShapeBar();
  }
}

function onKeyDown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleShapeBar();
}

export function bindShapeBar() {
  if (!el.shapeBar) return;
  const bar = el.shapeBar;
  renderShapeBar();
  // 首次摆放不要做过渡，否则刷新时会看到面板从默认位置滑过去。
  bar.classList.add('no-anim');
  const saved = readPos();
  if (saved) {
    bar.style.left = `${saved.left}px`;
    bar.style.top = `${saved.top}px`;
  }
  setShapeBarCollapsed(readCollapsed());
  ensureVisible();
  requestAnimationFrame(() => bar.classList.remove('no-anim'));
  el.shapeBarToggle.addEventListener('pointerdown', beginDrag);
  el.shapeBarToggle.addEventListener('pointermove', moveDrag);
  el.shapeBarToggle.addEventListener('pointerup', endDrag);
  el.shapeBarToggle.addEventListener('pointercancel', endDrag);
  el.shapeBarToggle.addEventListener('keydown', onKeyDown);
  el.shapeBarList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-shape]');
    if (!button || !button.dataset.shape) return;
    applyShapeForUser(button.dataset.shape);
  });
  window.addEventListener('resize', ensureVisible);
}