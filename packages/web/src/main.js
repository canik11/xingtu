// 主入口：组装状态、数据、场景与 UI，启动渲染循环。
import '@starmap/core/styles';
import './styles/app.css';
import { randRange, ensurePositions, warmup } from '@starmap/core';
import { el, cacheDom } from './lib/dom.js';
import { cam, view, ui, flags, clock } from './state.js';
import { data, index, load, reindex, saveNow, scheduleSave, storageAvailable, bindCameraReader, initBackend, replaceData, bindRestore, markBaseline, isDirty, onSaveStateChange } from './store.js';
import { camState, setMaxScale, worldToScreen } from './camera.js';
import { heat } from './layout.js';
import { initSpace, buildBackdrop, resetGrainPattern } from './scene/space.js';
import { initAmbient, bindAmbient, ambientStats } from './scene/ambient.js';
import { initWebGLScene } from './scene/gl-scene.js';
import { startLoop } from './loop.js';
import { bindInteraction } from './interaction.js';
import { bindActions, updateStats, refreshCategoryDatalist, closeAddModal, deleteSelected, saveEdit } from './actions.js';
import { isEditing, hasEditChanges, onEditStateChange } from './ui/edit-form.js';
import { bindPanel, updateDock, bindPanelChrome, openPanel, closePanel, selectNode } from './ui/panel.js';
import { bindNavigation, syncNav, setPanelApi, enterSphere, applyShapeForUser } from './navigation.js';
import { sceneVisuals, spherePuffState } from './hierarchy.js';
import { projectFocusNode, buildFocus, fitFocus } from './focus.js';
import { startIntroTransition } from './scene/transition.js';
import { mountIntro, playIntro, destroyIntro, showIntroPrompt, hideIntroPrompt } from './ui/intro.js';
import { onQualityChange, quality, qualitySnapshot } from './quality.js';
import { getOutline, getEntity, refreshOutline } from './outline.js';
import { appearanceConfig, edgeIsMastered, toggleMastery } from './mastery.js';
import { bindAddModal } from './ui/add-modal.js';
import { bindConfirm } from './ui/confirm.js';
import { bindAppearance } from './ui/appearance.js';
import { bindShapeBar } from './ui/shape-bar.js';
import { bindGlobalDoc } from './ui/global-doc.js';
import { showFatal, toast } from './ui/feedback.js';
import { canFetchKbPath, fetchKnowledge, getKbPath, isDefaultKbPath } from './kb-path.js';
import { restoreKbFile } from './kb-file.js';
import { hostKbSupported, requestHostKb } from './kb-host.js';
import { initSound, introSoundStart, introSoundCharge, introSoundBlast } from './audio/cues.js';
import { audioReady, unlockAudio, isAudioUnlocked, audioVolume } from './audio/engine.js';
import { soundPrefs } from './audio/prefs.js';
import { bindSound } from './ui/sound.js';

let glScene = null;

/** 画布尺寸（同时供 resize 事件复用）。 */
function resizeCanvas() {
  const canvas = el.stage;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cap = 2;
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
  initSound();
  flags.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  flags.debug = /[?&]debug\b/.test(location.search);
  initBackend();

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
  bindShapeBar();
  bindSound();
  bindSaveCue();
  onQualityChange((q) => {
    setMaxScale(q.three.maxScale);
    resizeCanvas();
    if (glScene) {
      glScene.resize();
      glScene.scene?.backdrop?.setDensity(q.three.stars);
      glScene.scene?.ambient?.setDensity(q.three.ambient);
    }
  });
  updateStats();
  updateDock();
  refreshCategoryDatalist();
  enterSphere(false);
  syncNav();

  bindRestore(() => {
    closePanel(true);
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
        return {
          modes: { ...ui.idleModes },
          speed: ui.idleSpeed,
          breath: ui.idleBreath,
          pulse: ui.idlePulse,
          breathAge: ui.breathAge
        };
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
      get shape() {
        return { id: ui.shape, morphing: !!ui.shapeMorph, sceneFx: ui.sceneFx && ui.sceneFx.kind };
      },
      get gl() {
        return glScene && glScene.scene;
      },
      setShape(id) {
        return applyShapeForUser(id);
      },
      entities() {
        return getOutline().all.map((e) => ({
          id: e.id,
          level: e.level,
          name: e.name,
          parentId: e.parentId,
          hostId: e.hostId,
          blockId: e.blockId,
          children: (e.children || []).slice()
        }));
      },
      isDirty() {
        return isDirty();
      },
      select(id) {
        selectNode(id);
        openPanel(id);
        return ui.selection;
      },
      deleteSelected() {
        return deleteSelected();
      },
      audio() {
        return { ready: audioReady(), unlocked: isAudioUnlocked(), volume: audioVolume(), prefs: soundPrefs() };
      }
    };
  }

  clock.last = performance.now();
  startLoop(ctx, glScene);
  // 首帧已经排进 rAF，再点燃开场爆炸；reduced-motion 时直接淡出黑幕。
  startIntroWithSound();
}

/**
 * 开场。浏览器要求「先有一次手势」才允许出声，所以音频没解锁时先停在黑幕上，
 * 等用户第一次点击/按键；解锁失败或超时也照常开场，只是没有声音。
 */
function startIntroWithSound() {
  let started = false;
  const beginIntro = (origin) => {
    if (started) return;
    started = true;
    hideIntroPrompt();
    // 点击后不再等待：只留奇点收紧的 180ms 蓄力，随即炸开。
    introSoundStart();
    introSoundCharge();
    playIntro({
      reduced: flags.reducedMotion,
      origin,
      onBlast: () => {
        introSoundBlast();
        startIntroTransition(1500);
        // 保底：就算开场 canvas 的动画停在中途，过渡结束后也把遮罩撤掉，
        // 免得粒子残影一直盖在星海上。
        setTimeout(destroyIntro, 1900);
      }
    });
  };

  // 不管声音是否已就绪，开场都必须等用户点击：等待页就是「被吸入奇点」的那一刻。
  // 桌面版（WebView2 带 autoplay 参数）在 initSound 里已经自动解锁并铺好等待底噪；
  // 网页版在这里第一次点击时才解锁，爆炸音会紧接着放出来。
  showIntroPrompt();
  const onGesture = (e) => {
    if (started) return;
    const origin = {
      x: Number.isFinite(e.clientX) ? e.clientX : view.w / 2,
      y: Number.isFinite(e.clientY) ? e.clientY : view.h / 2
    };
    unlockAudio().catch(() => false);
    beginIntro(origin);
  };
  window.addEventListener('pointerdown', onGesture, { capture: true, once: true });
  window.addEventListener('keydown', onGesture, { capture: true, once: true });
}

/** 黑幕期间的手势先拿来解锁音频，避免点击丢在 boot 还没完成的时候。 */
function armIntroAudioUnlock() {
  const tryUnlock = () => {
    window.removeEventListener('pointerdown', tryUnlock, true);
    window.removeEventListener('keydown', tryUnlock, true);
    unlockAudio().catch(() => false);
  };
  window.addEventListener('pointerdown', tryUnlock, true);
  window.addEventListener('keydown', tryUnlock, true);
}

/**
 * 未保存提示与手动保存：
 * - 左上角的小月亮在数据改动后亮起，落盘后自动熄灭；编辑面板里有改动时也亮；
 * - 点月亮或按 Ctrl+S 立即保存；编辑面板里 Ctrl+S 等同于点“保存修改”。
 */
function bindSaveCue() {
  const paint = () => {
    const editingDirty = isEditing() && hasEditChanges();
    document.body.classList.toggle('has-unsaved', isDirty() || editingDirty);
  };
  onSaveStateChange(paint);
  onEditStateChange(paint);
  if (el.panelBody) {
    el.panelBody.addEventListener('input', paint);
    el.panelBody.addEventListener('click', paint);
  }
  if (el.saveOrb) {
    el.saveOrb.addEventListener('click', () => {
      saveNow();
      toast('已保存修改');
    });
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (isEditing()) {
        saveEdit();
        return;
      }
      saveNow();
      toast('已保存修改');
    },
    true
  );
  paint();
}

/** 全局错误兜底：显示红条，避免“白屏无提示”。 */
function setFatalHandler() {
  window.addEventListener('error', (e) => showFatal((e && e.message) || '发生未知错误'));
  window.addEventListener('unhandledrejection', (e) => showFatal(String((e && e.reason) || '发生未知错误')));
}

function start() {
  mountIntro();
  // 黑幕一出现就给提示并接住第一次手势：boot 期间点击也不会白点干等。
  showIntroPrompt();
  armIntroAudioUnlock();
  boot().catch((error) => {
    console.error('[starmap] 启动失败', error);
    destroyIntro();
    showFatal((error && error.message) || '应用启动失败');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}