// 画布交互：3D 球体旋转 / 单击选中 / 双击进入局部 3D，节点下钻与缩放。
import { screenToWorld, zoomAt, center3DScene } from './camera.js';
import { el } from './lib/dom.js';
import { cam, ui, view } from './state.js';
import { openAddNode, closeAddModal, isMenuOpen, closeMenu } from './actions.js';
import { openPanel, closePanel, selectNode, isPanelOpen } from './ui/panel.js';
import { isAddOpen } from './ui/add-modal.js';
import { nodeAt3D, rotateScene, rotateFocus, moveSphereNode } from './hierarchy.js';
import { enterLocal, back, applySphereCamera } from './navigation.js';
import { nodeAtFocus, edgeAtFocus, fitFocus, moveFocusNode } from './focus.js';

/** 屏幕坐标命中当前的 2D 标题节点（兼容旧调试接口）。 */
export function nodeAtScreen(x, y) {
  return nodeAtFocus(x, y);
}

/** 高亮当前悬停边（仅 2D 标题图）。 */
function updateHoverEdge() {
  if (ui.level !== 'local') {
    ui.hoverEdge = null;
    return;
  }
  ui.hoverEdge = edgeAtFocus(ui.pointer.x, ui.pointer.y);
}

function hover3D(x, y) {
  const hit = nodeAt3D(x, y);
  ui.hover = hit || null;
  return hit;
}

/** 2D 节点：双击课程打开笔记，章节继续下钻，知识点打开侧栏。 */
function open2DNode(node) {
  const entity = node && node.entity;
  if (!entity) return;
  if (node.kind === 'external') {
    // 外部节点属于另一门课程/章节：直接切到它的局部图。
    enterLocal(entity.id, { from3D: false });
    return;
  }
  if (entity.level === 1) {
    openPanel(entity.id);
  } else if (entity.level === 2) {
    enterLocal(entity.id, { from3D: false, openSidebar: true });
  } else {
    openPanel(entity.id);
  }
}

/** 绑定画布与全局事件。 */
export function bindInteraction() {
  const canvas = el.stage;

  window.addEventListener('resize', () => {
    const oldW = view.w;
    const oldH = view.h;
    if (typeof window.__resizeStage === 'function') window.__resizeStage();
    if (ui.level !== 'local') {
      if (ui.level === 'sphere' && ui.mode === '2d') {
        applySphereCamera(false);
        return;
      }
      const radius = ui.level === 'inner' ? 250 : ui.spherePuffTarget > 0.5 ? 430 : 300;
      center3DScene(false, radius);
      return;
    }
    if (ui.focusGraph) {
      // 宽度变化后按新的可视区重新适配；比简单平移更符合标题图的阅读方式。
      const dx = (oldW - view.w) / (2 * cam.scale);
      const dy = (oldH - view.h) / (2 * cam.scale);
      cam.x += dx;
      cam.y += dy;
      cam.tx = cam.x;
      cam.ty = cam.y;
      fitFocus(false);
      return;
    }
    cam.x += (oldW - view.w) / (2 * cam.scale);
    cam.y += (oldH - view.h) / (2 * cam.scale);
    cam.tx = cam.x;
    cam.ty = cam.y;
  });

  canvas.addEventListener('pointerdown', (e) => {
    ui.pointer.x = e.clientX;
    ui.pointer.y = e.clientY;

    if (e.button === 2) {
      e.preventDefault();
      ui.dragNode = {
        mode: 'pan',
        hit: null,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        camX: cam.x,
        camY: cam.y,
        moved: false,
        id: e.pointerId
      };
      ui.orbitDrag = { id: e.pointerId, hit: null };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      return;
    }
    if (e.button !== 0) return;

    if (ui.level !== 'local') {
      const hit = nodeAt3D(e.clientX, e.clientY);
      if (hit) selectNode(hit.id);
      // 2D 星云里空白拖动是平移（没有球面可转）；3D 保持旋转。
      const mode = hit && ui.level === 'sphere'
        ? 'node3d'
        : (ui.level === 'sphere' && ui.mode === '2d' ? 'pan' : 'orbit');
      ui.dragNode = {
        mode,
        hit,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        camX: cam.x,
        camY: cam.y,
        primary: true,
        moved: false,
        id: e.pointerId
      };
      ui.orbitDrag = { id: e.pointerId, hit };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      return;
    }

    const hit = nodeAtFocus(e.clientX, e.clientY);
    if (hit) selectNode(hit.id);
    ui.dragNode = {
      // 2D 标题图没有可转的球面，空白拖动改为平移。
      mode: hit ? 'node' : (ui.mode === '2d' ? 'pan' : 'rotate'),
      hit,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      camX: cam.x,
      camY: cam.y,
      primary: true,
      moved: false,
      id: e.pointerId
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 某些浏览器在合成事件下会抛错，忽略 */
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    ui.pointer.x = e.clientX;
    ui.pointer.y = e.clientY;
    const drag = ui.dragNode;
    if (drag && drag.id === e.pointerId) {
      if (drag.mode === 'node3d') {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
          drag.moved = true;
          canvas.classList.add('grabbing');
        }
        if (drag.moved) moveSphereNode(drag.hit, dx, dy);
        return;
      }

      if (drag.mode === 'orbit') {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
          drag.moved = true;
          canvas.classList.add('grabbing');
        }
        if (drag.moved) {
          rotateScene(dx, dy);
          canvas.classList.add('grabbing');
        }
        return;
      }

      if (drag.mode === 'node') {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
          drag.moved = true;
          canvas.classList.add('grabbing');
        }
        if (drag.moved) moveFocusNode(drag.hit, dx, dy);
        return;
      }

      if (drag.mode === 'rotate') {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
          drag.moved = true;
          canvas.classList.add('grabbing');
        }
        if (drag.moved) rotateFocus(dx, dy);
        return;
      }
      if (drag.mode !== 'pan') return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        canvas.classList.add('grabbing');
      }
      if (drag.moved) {
        cam.x = cam.tx = drag.camX - dx / cam.scale;
        cam.y = cam.ty = drag.camY - dy / cam.scale;
      }
      return;
    }

    if (ui.level !== 'local') {
      const hit = hover3D(e.clientX, e.clientY);
      canvas.classList.toggle('pointer', !!hit);
      return;
    }
    const hit = nodeAtFocus(e.clientX, e.clientY);
    ui.hover = hit;
    canvas.classList.toggle('pointer', !!hit);
    updateHoverEdge();
  });

  const endDrag = (e) => {
    const drag = ui.dragNode;
    if (!drag || drag.id !== e.pointerId) return;
    ui.dragNode = null;
    ui.orbitDrag = null;
    canvas.classList.remove('grabbing');
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }

    if (drag.mode === 'orbit') {
      if (!drag.moved && drag.hit) selectNode(drag.hit.id);
      else if (!drag.moved && !drag.hit) clearSelection();
      return;
    }
    if (drag.mode === 'pan' && drag.primary && !drag.moved) clearSelection();
    if (drag.mode === 'rotate' && !drag.moved && !drag.hit) clearSelection();
  };

  function clearSelection() {
    if (ui.innerSelection) ui.innerSelection = null;
    if (ui.selection) selectNode(null);
    if (isPanelOpen()) closePanel();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (!ui.dragNode) {
      ui.hover = null;
      ui.hoverEdge = null;
      canvas.classList.remove('pointer');
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    if (ui.level !== 'local') {
      const hit = nodeAt3D(e.clientX, e.clientY);
      if (!hit) return;
      enterLocal(hit.id, { from3D: true, openSidebar: hit.kind === 'chapter' });
      return;
    }
    const hit = nodeAtFocus(e.clientX, e.clientY);
    if (hit) {
      open2DNode(hit);
    } else {
      const w = screenToWorld(e.clientX, e.clientY);
      openAddNode([w.x, w.y]);
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0011));
    },
    { passive: false }
  );

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isAddOpen()) {
        closeAddModal();
        return;
      }
      if (isMenuOpen()) {
        closeMenu();
        return;
      }
      if (isPanelOpen()) {
        closePanel();
        return;
      }
      if (ui.level === 'local') {
        if (back()) return;
      }
      if (ui.selection) {
        selectNode(null);
        return;
      }
    }
    });
}

export { openPanel };