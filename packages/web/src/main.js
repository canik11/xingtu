// 主入口：组装状态、数据、场景与 UI，启动渲染循环。
import '@starmap/core/styles';
import './styles/app.css';
import { randRange, ensurePositions, warmup } from '@starmap/core';
import { el, cacheDom } from './lib/dom.js';
import { cam, view, ui, flags, clock } from './state.js';
import { data, index, load, reindex, saveNow, scheduleSave, storageAvailable, bindCameraReader, initBackend, replaceData, bindRestore, markBaseline } from './store.js';
import { camState, setMaxScale, worldToScreen } from './camera.js';
import { heat } from './layout.js';
import { initSpace, buildBackdrop, resetGrainPattern } from './scene/space.js';
import { initAmbient, bindAmbient, ambientStats } from './scene/ambient.js';
import { initWebGLScene } from './scene/gl-scene.js';
import { startLoop } from './loop.js';
import { bindInteraction } from './interaction.js';
import { bindActions, updateStats, refreshCategoryDatalist, closeAddModal, deleteSelected } from './actions.js';
import { bindPanel, updateDock, bindPanelChrome, openPanel, closePanel, selectNode } from './ui/panel.js';
import { bindNavigation, syncNav, setPanelApi, enterSphere, applySphereCamera } from './navigation.js';
import { sceneVisuals, spherePuffState } from './hierarchy.js';
import { projectFocusNode, buildFocus, fitFocus } from './focus.js';
import { onQualityChange, quality, qualitySnapshot } from './quality.js';
import { getOutline, getEntity, refreshOutline } from './outline.js';
import { appearanceConfig, edgeIsMastered, toggleMastery } from './mastery.js';
import { bindAddModal } from './ui/add-modal.js';
import { bindConfirm } from './ui/confirm.js';
import { bindAppearance } from './ui/appearance.js';
import { bindGlobalDoc } from './ui/global-doc.js';
import { showFatal, toast } from './ui/feedback.js';
import { canFetchKbPath, fetchKnowledge, getKbPath, isDefaultKbPath } from './kb-path.js';
import { restoreKbFile } from './kb-file.js';
import { hostKbSupported, requestHostKb } from './kb-host.js';

let glScene = null;

/** 画布尺寸（同时供 resize 事件复用）。 */
function resizeCanvas() {
  const canvas = el.stage;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const q = quality();
  const cap = q.mode === '2d' ? q.two.dprCap : 2;
  const dpr = Math.min(cap, Math.max(1, window.devicePixelRatio || 1));
  view.w = w;
  view.h = h;
  view.dpr = dpr;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

/** 在主画布上重建底色/暗角渐变（窗口尺寸变化或首次启动时调用）。 */
function rebuildBackdrop() {
  buildBackdrop(el.stage.getContext('2d', { alpha: false }));
  resetGrainPattern();
}

async function boot() {
  cacheDom();
  flags.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  flags.debug = /[?&]debug\b/.test(location.search);
  initBackend();

  ui.mode = quality().mode;
  setMaxScale(quality().three.maxScale);

  resizeCanvas();
  window.__resizeStage = () => {
    resizeCanvas();
    if (glScene) {
      glScene.resize();
    } else {
      initSpace();
      initAmbient();
      rebuildBackdrop();
    }
  };

  const glCanvas = document.getElementById('glstage');
  try {
    glScene = await initWebGLScene(glCanvas);
    document.body.classList.add('webgl');
  } catch (error) {
    console.warn('[starmap] WebGL 初始化失败，回退 Canvas 2D', error);
    glScene = null;
    if (glCanvas) glCanvas.hidden = true;
  }

  const ctx = glScene ? null : el.stage.getContext('2d', { alpha: false });
  setFatalHandler();
  if (!glScene) {
    initSpace();
    initAmbient();
    rebuildBackdrop();
  }

  bindCameraReader(() => {
    Object.assign(cam, camState());
  });

  const loaded = load();
  // 桌面壳：优先用壳记住的知识文件（完整路径、重启自动读写）。
  // 浏览器：绑定了本地知识文件时优先恢复它；首次打开再尝试自定义路径。
  let bound = null;
  if (hostKbSupported()) {
    const host = await requestHostKb();
    if (host && host.status === 'loaded' && host.content) {
      try {
        if (replaceData(JSON.parse(host.content))) bound = { data: true };
      } catch (e) {
        /* 绑定文件损坏时静默回退到内置演示库。 */
      }
    }
  } else {
    try {
      bound = await restoreKbFile();
    } catch (e) {
      bound = null;
    }
    if (bound && bound.data) {
      replaceData(bound.data);
    }
  }
  if (!bound && loaded.firstRun && !isDefaultKbPath() && canFetchKbPath(getKbPath())) {
    try {
      const fromPath = await fetchKnowledge(getKbPath());
      if (fromPath) replaceData(fromPath);
    } catch (e) {
      /* 路径不可用时静默回退到内置演示库。 */
    }
  }
  const missing = ensurePositions(data, index.categoryMap, randRange);
  reindex();

  if (loaded.firstRun || missing > 0) {
    warmup(data, data.edges, index.categoryMap, loaded.firstRun ? 360 : 320);
  }
  heat(0);

  data.nodes.forEach((n, i) => {
    n.born = performance.now() + i * 28;
  });

  setPanelApi({ openPanel, closePanel, selectNode });
  bindInteraction();
  if (glScene) glScene.bind(el.stage);
  else bindAmbient();
  bindPanel();
  bindPanelChrome();
  bindAddModal(closeAddModal);
  bindConfirm();
  bindAppearance();
  bindGlobalDoc();
  bindActions();
  bindNavigation();
  let lastQualityMode = quality().mode;
  onQualityChange((q) => {
    const modeChanged = q.mode !== lastQualityMode;
    lastQualityMode = q.mode;
    ui.mode = q.mode;
    setMaxScale(q.three.maxScale);
    resizeCanvas();
    if (glScene) {
      glScene.resize();
      glScene.scene?.backdrop?.setDensity(q.mode === '2d' ? q.two.stars : q.three.stars);
      glScene.scene?.ambient?.setDensity(q.mode === '2d' ? q.two.glow : q.three.ambient);
    }
    if (modeChanged && ui.level === 'sphere') {
      applySphereCamera(true);
      syncNav();
    } else if (modeChanged && ui.level === 'local' && ui.focusId) {
      // 3D 与 2D 的局部图是两套坐标，切换后必须按新布局重建。
      ui.selection = null;
      buildFocus(ui.focusId);
      fitFocus(true);
      syncNav();
    }
  });
  updateStats();
  updateDock();
  refreshCategoryDatalist();
  enterSphere(false);
  syncNav();

  bindRestore(() => {
    closePanel();
    ui.selection = null;
    reindex();
    refreshOutline();
    if (ui.level === 'local' && ui.focusId && getEntity(ui.focusId)) {
      try {
        buildFocus(ui.focusId);
        fitFocus(true);
      } catch (e) {
        enterSphere(false);
      }
    } else {
      enterSphere(false);
    }
    updateStats();
    updateDock();
    syncNav();
    heat(0.5);
  });

  if (loaded.firstRun) saveNow();
  if (loaded.migrated) saveNow();
  markBaseline();
  if (loaded.seeded) {
    const added = (loaded.upgraded && loaded.upgraded.addedNodes) || 0;
    setTimeout(() => toast(added > 0 ? `已升级知识库：新增 ${added} 个知识点` : '已升级知识库：已补全详细笔记'), 900);
  }
  if (!storageAvailable()) setTimeout(() => toast('本地存储不可用：本次改动不会自动保存'), 1000);

  if (flags.debug) {
    window.__starmap = {
      get renderer() {
        return glScene ? 'webgl' : 'canvas2d';
      },
      get webgl() {
        return glScene ? glScene.stats() : null;
      },
      get data() {
        return JSON.parse(
          JSON.stringify({
            nodes: data.nodes,
            edges: data.edges,
            topicEdges: data.topicEdges || [],
            mastery: data.mastery || {},
            categories: data.categories
          })
        );
      },
      get cam() {
        return { ...cam };
      },
      get selection() {
        return ui.selection;
      },
      get level() {
        return ui.level;
      },
      get focusId() {
        return ui.focusId;
      },
      get hostId() {
        return ui.hostId;
      },
      get innerSelection() {
        return ui.innerSelection;
      },
      get sphereRot() {
        return { ...ui.sphereRot };
      },
      get focusRot() {
        return { ...ui.focusRot };
      },
      get spherePuff() {
        return spherePuffState();
      },
      get crossEdges() {
        return getOutline().crossEdges.map((e) => ({ a: e.a, b: e.b, label: e.label }));
      },
      get sphereOffsets() {
        return [...ui.sphereOffsets.entries()].map(([id, p]) => ({ id, ...p }));
      },
      get motion() {
        return { modes: { ...ui.idleModes }, speed: ui.idleSpeed, breath: ui.idleBreath };
      },
      get appearance() {
        return JSON.parse(JSON.stringify(appearanceConfig()));
      },
      get quality() {
        return qualitySnapshot();
      },
      get focusNodes() {
        return ui.focusGraph
          ? ui.focusGraph.nodes.map((n) => ({
              id: n.id,
              kind: n.kind,
              x: Math.round(n.x || 0),
              y: Math.round(n.y || 0)
            }))
          : null;
      },
      edgeMastered(a, b) {
        return edgeIsMastered(getEntity(a), getEntity(b));
      },
      toggleMastery(id) {
        return toggleMastery(getEntity(id));
      },
      get outline() {
        const outline = getOutline();
        return {
          courses: outline.courses.map((c) => ({ id: c.id, name: c.name })),
          chapters: outline.all.filter((c) => c.level === 2).map((c) => ({
            id: c.id,
            name: c.name,
            courseId: c.courseId,
            parentId: c.parentId
          })),
          points: outline.all.filter((p) => p.level === 3).map((p) => ({
            id: p.id,
            name: p.name,
            courseId: p.courseId,
            parentId: p.parentId
          }))
        };
      },
      get ambient() {
        return glScene ? glScene.stats().ambient : ambientStats();
      },
      get focus() {
        const graph = ui.focusGraph;
        if (!graph) return null;
        return {
          focusId: graph.focusId,
          nodes: graph.nodes.map((n) => {
            const fp = projectFocusNode(n);
            const p = worldToScreen(fp.x, fp.y);
            return {
              id: n.id,
              name: n.name,
              kind: n.kind,
              level: n.level,
              x: n.x,
              y: n.y,
              z: n.z,
              sx: p.x,
              sy: p.y,
              r: n.r,
              depth: fp.depth
            };
          }),
          edges: graph.edges.map((e) => ({ a: e.a, b: e.b, label: e.label, kind: e.kind }))
        };
      },
      get scene() {
        return sceneVisuals().map((v) => {
          const p = worldToScreen(v.x, v.y);
          return {
            id: v.id,
            name: v.node ? v.node.name : v.label,
            kind: v.kind,
            x: v.x,
            y: v.y,
            z: v.z,
            sx: p.x,
            sy: p.y,
            r: v.r
          };
        });
      },
      toScreen(x, y) {
        return { x: (x - cam.x) * cam.scale + view.w / 2, y: (y - cam.y) * cam.scale + view.h / 2 };
      },
      select(id) {
        selectNode(id);
        openPanel(id);
        return ui.selection;
      },
      deleteSelected() {
        return deleteSelected();
      }
    };
  }

  clock.last = performance.now();
  startLoop(ctx, glScene);
}

/** 全局错误兜底：显示红条，避免“白屏无提示”。 */
function setFatalHandler() {
  window.addEventListener('error', (e) => showFatal((e && e.message) || '发生未知错误'));
  window.addEventListener('unhandledrejection', (e) => showFatal(String((e && e.reason) || '发生未知错误')));
}

function start() {
  boot().catch((error) => {
    console.error('[starmap] 启动失败', error);
    showFatal((error && error.message) || '应用启动失败');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}