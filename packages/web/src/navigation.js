// 层级导航：星海（3D 球）→ 课程/章节（局部标题图）→ 再下钻或进笔记。
// 面板 API 由 main.js 注入，避免与 ui/panel.js 形成循环依赖。
import { esc, el } from './lib/dom.js';
import { ui, view } from './state.js';
import { index } from './store.js';
import { center3DScene, fitFocusView, panelReserve } from './camera.js';
import { applyShape, captureTransitionFrom3D, clearTransition, resetSphereShape } from './hierarchy.js';
import { saveShape } from './shapes.js';
import { startTransition } from './scene/transition.js';
import { buildFocus, captureFocusScreenMap, clearManualPositions, fitFocus, getFocus } from './focus.js';
import { getEntity, pathOf, courseOf, refreshOutline } from './outline.js';
import { idleLabel, isStill, loadMotionPrefs, setIdleModes, setIdleSpeed, toggleIdleMode } from './motion.js';
import { updateStats } from './stats.js';

let panelApi = {
  openPanel: () => {},
  closePanel: () => {},
  selectNode: () => {}
};

/** 由 main.js 注入面板 API，避免循环 import。 */
export function setPanelApi(api) {
  panelApi = { ...panelApi, ...api };
}

export function getLevel() {
  return ui.level;
}

/** 不同形状的基准取景半径：非球形骨架更大，统一退到 430 左右。 */
const SHAPE_RADIUS = { galaxy: 430, helix: 430, torus: 430, lattice: 440, rose: 430, wave: 430, fish: 440 };

function sphereRadius() {
  const shaped = SHAPE_RADIUS[ui.shape];
  if (shaped) return ui.idleModes.puff || ui.spherePuffTarget > 0.5 ? shaped + 40 : shaped;
  if (ui.idleModes.puff) return 365;
  if (ui.spherePuffTarget > 0.5) return 430;
  if (ui.sphereScope >= 4) return 400;
  return ui.sphereScope >= 3 ? 350 : 300;
}

/** 场景转场起点：面板之外的可视区域中心。 */
function sceneOrigin() {
  return { x: Math.max(140, (view.w - panelReserve()) / 2), y: view.h * 0.47 };
}

/** 把星海相机摆到球体中心。 */
export function applySphereCamera(animate = true) {
  if (ui.level !== 'sphere') return;
  center3DScene(animate, sphereRadius());
}

function closeMotionPanel() {
  if (!el.motionPanel) return;
  el.motionPanel.hidden = true;
  if (el.motionBtn) {
    el.motionBtn.classList.remove('is-open');
    el.motionBtn.setAttribute('aria-expanded', 'false');
  }
}

function toggleMotionPanel() {
  if (!el.motionPanel) return;
  el.motionPanel.hidden = !el.motionPanel.hidden;
  el.motionBtn.classList.toggle('is-open', !el.motionPanel.hidden);
  el.motionBtn.setAttribute('aria-expanded', el.motionPanel.hidden ? 'false' : 'true');
}

/** 同步面包屑、返回按钮、层级提示与 3D 层级按钮。 */
export function syncNav() {
  const level = ui.level;
  const path = ui.focusId ? pathOf(ui.focusId) : [];
  const back = el.navBack;
  if (back) back.hidden = level === 'sphere';

  if (el.navCrumbs) {
    const parts = [];
    if (level !== 'sphere') {
      parts.push('<button type="button" class="crumb" data-nav="sphere">星海</button>');
    } else {
      parts.push('<span class="crumb is-current">星海</span>');
    }
    path.forEach((entity, i) => {
      parts.push('<span class="crumb-sep">/</span>');
      const current = i === path.length - 1;
      if (current) {
        parts.push(`<span class="crumb is-current">${esc(entity.name)}</span>`);
      } else {
        parts.push(
          `<button type="button" class="crumb" data-focus="${esc(entity.id)}">${esc(entity.name)}</button>`
        );
      }
    });
    if (level === 'sphere') {
      const scope = ui.sphereScope === 4
        ? '全部层级'
        : ui.sphereScope === 3
          ? '课程 + 章节 + 知识点'
          : ui.sphereScope === 2
            ? '课程 + 章节'
            : '课程';
      parts.push(`<span class="nav-scope">· ${scope}</span>`);
    }
    el.navCrumbs.innerHTML = parts.join('');
  }

  if (el.levelBtn) {
    el.levelBtn.hidden = level !== 'sphere';
    el.levelBtn.textContent = ui.sphereScope === 4
      ? '层级 · 全部'
      : ui.sphereScope === 3
        ? '层级 · 三级'
        : ui.sphereScope === 2
          ? '层级 · 二级'
          : '层级 · 一级';
    el.levelBtn.classList.toggle('is-2', ui.sphereScope === 2);
    el.levelBtn.classList.toggle('is-3', ui.sphereScope >= 3);
    el.levelBtn.setAttribute(
      'aria-label',
      ui.sphereScope === 4
        ? '展开显示全部层级，包括更深层的子知识点'
        : ui.sphereScope === 3
          ? '3D 显示课程、章节和知识点'
          : ui.sphereScope === 2
            ? '3D 显示课程与章节'
            : '3D 只显示课程'
    );
  }
  if (el.motionWrap) {
    const sphereOnly = level === 'sphere';
    el.motionWrap.hidden = !sphereOnly;
    if (!sphereOnly) closeMotionPanel();
    else {
      el.motionBtn.textContent = `静默 · ${idleLabel()}`;
      el.motionBtn.classList.toggle('is-open', !el.motionPanel.hidden);
      el.motionPanel.querySelectorAll('[data-motion]').forEach((btn) => {
        const mode = btn.dataset.motion;
        btn.classList.toggle('is-active', mode === 'still' ? isStill() : !!ui.idleModes[mode]);
        btn.setAttribute('aria-pressed', mode === 'still'
          ? String(isStill())
          : String(!!ui.idleModes[mode]));
      });
      if (document.activeElement !== el.motionSpeed) el.motionSpeed.value = String(ui.idleSpeed);
      el.motionSpeedText.textContent = `${ui.idleSpeed.toFixed(2).replace(/\.?0+$/, '')}×`;
    }
  }
  if (el.spreadBtn) {
    el.spreadBtn.hidden = false;
    el.spreadBtn.textContent = '重置图形';
    el.spreadBtn.classList.remove('is-open');
    el.spreadBtn.setAttribute('aria-pressed', 'false');
    el.spreadBtn.setAttribute(
      'aria-label',
      level === 'sphere' ? '恢复标准图形与旋转，并清除手动拖动偏移' : '恢复当前视图的标准图形与位置'
    );
  }
  document.body.dataset.level = level;
  updateStats();
}

function closeSidebar() {
  panelApi.closePanel();
  ui.panelOpen = false;
}

/** 局部图之间切换时，复用旧节点的屏幕位置，让同名节点从原处飞入新位置。 */
function captureLocalBridge() {
  const from = captureFocusScreenMap();
  if (!from || !from.size) return null;
  return { from, screenFrom: from, start: performance.now(), dur: 720 };
}

/** 回到星海。 */
export function enterSphere(animate = true) {
  const origin = sceneOrigin();
  const screenFrom = captureFocusScreenMap();
  closeSidebar();
  ui.level = 'sphere';
  ui.focusId = null;
  ui.hostId = null;
  ui.innerGraph = null;
  ui.innerSelection = null;
  ui.focusGraph = null;
  ui.selection = null;
  ui.hover = null;
  ui.hoverEdge = null;
  clearTransition();
  if (animate) startTransition({ kind: 'sphere', origin, screenFrom, dur: 900 });
  panelApi.selectNode(null);
  applySphereCamera(animate);
  syncNav();
}

/**
 * 进入局部标题图（课程或章节）。
 * @param {string} id 课程 id / `h:<blockId>`
 * @param {{animate?:boolean, from3D?:boolean, openSidebar?:boolean, origin?:{x:number,y:number}}} [opts]
 */
export function enterLocal(id, opts = {}) {
  refreshOutline();
  const entity = getEntity(id);
  if (!entity) return false;
  const from3D = ui.level === 'sphere';
  // 星海 → 局部：从球面位置飞入；局部内下钻 / 返回：从旧图上的屏幕位置飞入。
  const bridge = from3D
    ? captureTransitionFrom3D()
    : ui.level === 'local' && ui.focusGraph
      ? captureLocalBridge()
      : null;
  const origin = opts.origin || sceneOrigin();
  closeSidebar();
  ui.level = 'local';
  ui.focusId = id;
  ui.hostId = entity.courseId;
  ui.innerGraph = null;
  ui.innerSelection = null;
  ui.selection = id;
  ui.hover = null;
  ui.hoverEdge = null;
  if (opts.animate !== false) startTransition({ kind: 'local', origin, dur: 640 });
  ui.transition = opts.animate === false ? null : bridge;
  buildFocus(id);
  fitFocus(opts.animate !== false);
  panelApi.selectNode(id);
  syncNav();
  if (opts.openSidebar) panelApi.openPanel(id);
  return true;
}

/** 从局部图回到星海。 */
export function backToSphere() {
  enterSphere(true);
}

/** 兼容旧调用：进入章节/课程焦点；内部 3D 已不再作为主流程。 */
export function enterInner(id, opts = {}) {
  return enterLocal(id, { ...opts, from3D: ui.level === 'sphere' });
}

/** 在局部图中选中一个标题。 */
export function selectHeading(id) {
  const entity = getEntity(id);
  if (!entity) return null;
  ui.selection = entity.id;
  syncNav();
  return entity;
}

/** 选中并打开一个标题的侧栏。 */
export function openHeading(id) {
  const entity = getEntity(id);
  if (!entity) return null;
  ui.selection = entity.id;
  panelApi.openPanel(entity.id);
  return entity;
}

/**
 * Esc / 返回：章节图 → 课程图 → 星海。
 * @returns {boolean} 是否消费了返回
 */
export function back() {
  if (ui.level === 'inner') {
    const id = ui.focusId || ui.hostId;
    if (id) return enterLocal(id, { from3D: false });
    return false;
  }
  if (ui.level === 'local') {
    const entity = getEntity(ui.focusId);
    if (entity && entity.level === 3) {
      return enterLocal(entity.parentId || entity.courseId, { from3D: false });
    }
    if (entity && entity.level === 2) {
      return enterLocal(entity.courseId, { from3D: false });
    }
    backToSphere();
    return true;
  }
  return false;
}

/** 面板宽度变化 / 收起后，让当前场景重新居中。 */
export function refreshScene(animate = true) {
  if (ui.level === 'sphere') {
    applySphereCamera(animate);
    return;
  }
  if (ui.level === 'inner') {
    center3DScene(animate, 250);
    return;
  }
  const graph = getFocus();
  if (graph) fitFocusView(graph.nodes, animate);
}

/** 打开/收起/拖拽面板后，需要重新安排场景。 */
export function onPanelGeometryChanged() {
  refreshScene(true);
  syncNav();
}

/** 外观设置里切换星海形状：节点 morph、相机重新取景、导航文案同步。 */
export function applyShapeForUser(shape) {
  if (!applyShape(shape)) return false;
  saveShape(shape);
  if (ui.level === 'sphere') applySphereCamera(true);
  syncNav();
  return true;
}

/** 绑定导航条事件；返回卸载函数（目前单页，不需要）。 */
export function bindNavigation() {
  loadMotionPrefs();
  if (el.navBack) el.navBack.addEventListener('click', () => back());
  if (el.navCrumbs) {
    el.navCrumbs.addEventListener('click', (e) => {
      const target = e.target.closest('[data-nav], [data-focus]');
      if (!target) return;
      e.preventDefault();
      if (target.dataset.nav === 'sphere') enterSphere(true);
      else if (target.dataset.focus) enterLocal(target.dataset.focus, { from3D: false });
    });
  }
  if (el.levelBtn) {
    el.levelBtn.addEventListener('click', () => {
      ui.sphereScope = ui.sphereScope >= 4 ? 1 : ui.sphereScope + 1;
      if (ui.level === 'sphere') applySphereCamera(true);
      syncNav();
    });
  }
  if (el.motionBtn) {
    el.motionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMotionPanel();
    });
    el.motionPanel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-motion]');
      if (!btn) return;
      e.stopPropagation();
      const before = sphereRadius();
      toggleIdleMode(btn.dataset.motion);
      // 只开/关其他效果时不动相机；膨胀会改变球体视角半径，才重新居中。
      if (ui.level === 'sphere' && sphereRadius() !== before) applySphereCamera(true);
      syncNav();
    });
    el.motionSpeed.addEventListener('input', () => {
      setIdleSpeed(el.motionSpeed.value);
      el.motionSpeedText.textContent = `${ui.idleSpeed.toFixed(2).replace(/\.?0+$/, '')}×`;
    });
    document.addEventListener('pointerdown', (e) => {
      if (!el.motionWrap.contains(e.target)) closeMotionPanel();
    });
  }
  if (el.spreadBtn) {
    el.spreadBtn.addEventListener('click', () => {
      // 「重置图形」同时恢复默认球形，避免用户找不到回到球形的方法。
      if (ui.shape !== 'sphere') {
        applyShape('sphere');
        saveShape('sphere');
      }
      setIdleModes({ rotate: true, breathe: false, puff: false });
      resetSphereShape();
      closeMotionPanel();
      if (ui.level === 'sphere') {
        applySphereCamera(true);
      } else if (ui.level === 'local') {
        clearManualPositions(ui.focusId);
        if (ui.focusId) buildFocus(ui.focusId);
        fitFocus(true);
      }
      syncNav();
    });
  }
  syncNav();
}

export { panelReserve, courseOf };
export { index };