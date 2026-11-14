// 放映模式的编排：进入/退出、镜头交代、字幕与音效、主界面隐藏与状态恢复。
import { flags, ui } from '../state.js';
import { el } from '../lib/dom.js';
import { closePanel } from './panel.js';
import { enterSphere, syncNav } from '../navigation.js';
import { PresentationScene } from '../scene/presentation.js';
import { presentationAudio } from '../presentation-audio.js';
import { toast } from './feedback.js';

const CAPTIONS = {
  enter: '星盘之上，知识为棋',
  drop3: '第一枚星棋，落向星盘',
  drop2: '章节次第落下',
  drop1: '课程，降临',
  boom: '镇',
  ignite: '星棋点亮',
  turn: '未掌握，正在成为掌握',
  gather: '所有星棋，汇聚成球',
  settle: '你的知识星盘'
};

let host = null;
let scene = null;
let active = false;
let snapshot = null;
let captionTimer = 0;
let timers = [];

function clearTimers() {
  for (const id of timers) window.clearTimeout(id);
  timers = [];
  if (captionTimer) {
    window.clearTimeout(captionTimer);
    captionTimer = 0;
  }
}

function later(fn, ms) {
  timers.push(window.setTimeout(fn, ms));
}

function setCaption(text, immediate = false) {
  const node = el.showCaption;
  if (!node || !text) return;
  if (node.__text === text) return;
  node.__text = text;
  node.classList.remove('in');
  if (captionTimer) window.clearTimeout(captionTimer);
  captionTimer = window.setTimeout(
    () => {
      node.textContent = text;
      node.classList.add('in');
    },
    immediate ? 0 : 300
  );
}

function handleStage(stage) {
  setCaption(CAPTIONS[stage]);
  if (stage === 'drop3') {
    later(() => setCaption('星棋如雨，越下越急'), 3400);
    presentationAudio.scheduleRain(700, 0.05);
  } else if (stage === 'drop2') {
    presentationAudio.chime(4, 0.12);
    presentationAudio.chime(9, 0.1, 0.22);
  } else if (stage === 'drop1') {
    presentationAudio.chime(-12, 0.16);
  } else if (stage === 'ignite') {
    [0, 4, 7, 9, 12, 16].forEach((semitone, i) => presentationAudio.chime(semitone, 0.085, i * 0.24));
    presentationAudio.scheduleRain(360, 0.045);
  } else if (stage === 'turn') {
    presentationAudio.sweep(3.4, 0.09);
  } else if (stage === 'gather') {
    presentationAudio.finale();
  }
}

function handleEvent(name) {
  if (name === 'boom') presentationAudio.thud();
}

function rememberState() {
  return {
    level: ui.level,
    sphereScope: ui.sphereScope,
    spherePuff: ui.spherePuff,
    spherePuffTarget: ui.spherePuffTarget,
    spherePuffSeed: ui.spherePuffSeed,
    spherePuffPrevSeed: ui.spherePuffPrevSeed,
    spherePuffSeedMix: ui.spherePuffSeedMix,
    rot: { x: ui.sphereRot.x, y: ui.sphereRot.y },
    idleModes: { ...ui.idleModes },
    idleBreath: ui.idleBreath,
    idlePulse: ui.idlePulse,
    offsets: new Map(ui.sphereOffsets)
  };
}

function applyPresentationState() {
  ui.level = 'sphere';
  ui.selection = null;
  ui.hover = null;
  ui.sphereScope = 4;
  ui.spherePuff = 0;
  ui.spherePuffTarget = 0;
  ui.spherePuffSeed = 0;
  ui.spherePuffPrevSeed = 0;
  ui.spherePuffSeedMix = 0;
  ui.sphereRot.x = -0.18;
  ui.sphereRot.y = 0.35;
  ui.sphereOffsets.clear();
  ui.idleModes.rotate = false;
  ui.idleModes.breathe = false;
  ui.idleModes.puff = false;
  ui.idleBreath = 1;
  ui.idlePulse = 0;
  ui.idlePhase = 0;
  ui.breathAge = 0;
}

function restoreState() {
  const saved = snapshot;
  snapshot = null;
  if (!saved) return;
  ui.sphereScope = saved.sphereScope;
  ui.spherePuff = saved.spherePuff;
  ui.spherePuffTarget = saved.spherePuffTarget;
  ui.spherePuffSeed = saved.spherePuffSeed;
  ui.spherePuffPrevSeed = saved.spherePuffPrevSeed;
  ui.spherePuffSeedMix = saved.spherePuffSeedMix;
  ui.sphereRot.x = saved.rot.x;
  ui.sphereRot.y = saved.rot.y;
  ui.idleBreath = saved.idleBreath;
  ui.idlePulse = saved.idlePulse;
  Object.assign(ui.idleModes, saved.idleModes);
  ui.sphereOffsets.clear();
  for (const [id, point] of saved.offsets) ui.sphereOffsets.set(id, point);
  enterSphere(false);
  syncNav();
}

export function isPresenting() {
  return active;
}

export function startPresentation() {
  if (active) return;
  if (!scene || !host) {
    toast('放映模式需要 WebGL 支持');
    return;
  }

  // 浏览器要求音频在用户手势里创建，点按钮的这一次调用必须同步 start。
  presentationAudio.start();

  snapshot = rememberState();
  applyPresentationState();
  active = true;

  closePanel();
  el.moreWrap?.classList.remove('open');
  if (el.showLayer) {
    el.showLayer.hidden = false;
    if (el.showCaption) el.showCaption.textContent = '';
  }
  // 下一帧再淡出主界面，保证过度是看得见的。
  later(() => document.body.classList.add('presenting'), 24);

  scene.start(host.scene, { onStage: handleStage, onEvent: handleEvent });
}

export function stopPresentation() {
  if (!active) return;
  active = false;
  clearTimers();
  if (scene) scene.stop();
  presentationAudio.stop();

  document.body.classList.remove('presenting');
  if (el.showLayer) {
    if (el.showCaption) {
      el.showCaption.classList.remove('in');
      el.showCaption.__text = '';
    }
    later(() => {
      if (!active && el.showLayer) el.showLayer.hidden = true;
    }, 760);
  }

  restoreState();
}

export function bindPresentation(gpu) {
  if (gpu) {
    host = gpu;
    scene = new PresentationScene();
    gpu.setPresentation(scene);
    if (flags.debug) window.__presentationScene = scene;
  }

  if (el.btnPresent) {
    el.btnPresent.addEventListener('click', () => startPresentation());
    if (!gpu) {
      el.btnPresent.disabled = true;
      el.btnPresent.title = '放映模式需要 WebGL 支持';
    }
  }

  const menuBtn = el.menu ? el.menu.querySelector('[data-menu="present"]') : null;
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      el.moreWrap?.classList.remove('open');
      startPresentation();
    });
  }

  if (el.showExit) {
    el.showExit.addEventListener('click', (e) => {
      e.preventDefault();
      stopPresentation();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stopPresentation();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (active) stopPresentation();
  });
}