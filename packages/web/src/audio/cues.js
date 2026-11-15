// 音效总调度：手势解锁、开场音、全局点击声、弹层开合、心跳应和。
// 其他模块只管在关键动作处调用 sfx.*，这里负责「什么时候能出声」。
import { audioReady, setMasterVolume, unlockAudio } from './engine.js';
import { isSoundOn, onSoundChange, soundPrefs, toggleSoundPref } from './prefs.js';
import { ambientState, startAmbient, stopAmbient } from './ambient.js';
import * as sfx from './sfx.js';
import { ui } from '../state.js';
import { el, isTypingTarget } from '../lib/dom.js';
import { toast } from '../ui/feedback.js';

let unlocked = false;
let unlocking = false;
let gestureBound = false;

let introStarted = false;
let introBlasted = false;
let introDone = false;
let introAwakened = false;
let wakeTimer = 0;

let pulseRaf = 0;
let lastBreathAge = 0;

/* ------------------------------ 解锁 ------------------------------ */

async function attemptUnlock() {
  if (unlocked || unlocking) return;
  unlocking = true;
  const ok = await unlockAudio();
  unlocking = false;
  if (!ok) return;
  unlocked = true;
  unbindGestures();
  applyPrefs(soundPrefs());
  syncAmbient();
  // 用户在爆炸之后才第一次交互：开场音已经错过，用一声苏醒音补偿。
  if (introStarted && introDone && !introAwakened) {
    introAwakened = true;
    sfx.awaken();
  }
}

function onGesture() {
  attemptUnlock();
}

function bindGestures() {
  if (gestureBound) return;
  gestureBound = true;
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  window.addEventListener('touchstart', onGesture, { capture: true, passive: true });
}

function unbindGestures() {
  if (!gestureBound) return;
  gestureBound = false;
  window.removeEventListener('pointerdown', onGesture, true);
  window.removeEventListener('keydown', onGesture, true);
  window.removeEventListener('touchstart', onGesture, true);
}

/* ------------------------------ 偏好同步 ------------------------------ */

function applyPrefs(prefs) {
  setMasterVolume(prefs.enabled ? prefs.volume : 0);
  syncAmbient();
}

function syncAmbient() {
  const prefs = soundPrefs();
  const want = prefs.enabled && prefs.ambient && audioReady();
  const running = ambientState().running;
  if (want && !running) startAmbient();
  else if (!want && running) stopAmbient();
}

/* ------------------------------ 开场 ------------------------------ */

/**
 * 在 playIntro 之前调用：蓄力音 + 2.6 秒后标记开场结束。
 * 若音频尚未解锁，蓄力音会被引擎静默丢弃，不会报错。
 */
export function introSoundStart() {
  introStarted = true;
  introBlasted = false;
  introDone = false;
  introAwakened = false;
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    introDone = true;
  }, 2600);
  sfx.introCharge(0.42);
}

/** 在 onBlast 里调用：大爆炸。重复调用只响一次。 */
export function introSoundBlast() {
  if (introBlasted || !introStarted) return;
  introBlasted = true;
  sfx.introBlast();
}

/* ------------------------------ 全局声 ------------------------------ */

function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'm' && e.key !== 'M') return;
    if (isTypingTarget(e.target)) return;
    if (!audioReady()) return;
    toggleSoundPref('enabled');
    toast(soundPrefs().enabled ? '声音已开启' : '已静音（按 M 恢复）', 1400);
  });
}

function bindDelegates() {
  document.addEventListener(
    'click',
    (e) => {
      const node = e.target instanceof Element ? e.target : null;
      if (!node) return;
      const item = node.closest('#menu [data-menu]');
      if (item) {
        sfx.menu(item.dataset.menu);
        return;
      }
      if (node.closest('#btnMenu')) {
        sfx.menu('default');
        return;
      }
      if (node.closest('#panelBody [data-act="tab"]')) {
        sfx.tab();
        return;
      }
      if (node.closest('#searchResults')) sfx.searchPick();
    },
    true
  );
}

/** 所有弹窗统一用 hidden 开关，监听它就能覆盖到每个入口。 */
function watchOverlays() {
  const layers = [
    el.modalLayer,
    el.confirmLayer,
    el.appearanceLayer,
    el.kbLayer,
    el.rewardLayer,
    el.importLayer,
    el.docLayer
  ].filter(Boolean);
  for (const node of layers) {
    let open = !node.hidden;
    const observer = new MutationObserver(() => {
      const next = !node.hidden;
      if (next === open) return;
      open = next;
      sfx.modal(next);
    });
    observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
  }
}

/* ------------------------------ 心跳应和 ------------------------------ */

function startPulseWatch() {
  if (pulseRaf) return;
  const step = () => {
    pulseRaf = requestAnimationFrame(step);
    if (!audioReady() || !isSoundOn('pulse')) return;
    if (ui.level !== 'sphere' || !ui.idleModes || !ui.idleModes.breathe) {
      lastBreathAge = 0;
      return;
    }
    const age = Number(ui.breathAge) || 0;
    // breathAge 在每拍结束时归零：一次归零 = 一次心跳。
    if (age < lastBreathAge - 600) sfx.heartbeat(0.95);
    lastBreathAge = age;
  };
  pulseRaf = requestAnimationFrame(step);
}

/* ------------------------------ 初始化 ------------------------------ */

export function initSound() {
  const prefs = soundPrefs();
  setMasterVolume(prefs.enabled ? prefs.volume : 0);
  bindGestures();
  bindShortcuts();
  bindDelegates();
  watchOverlays();
  startPulseWatch();
  onSoundChange(applyPrefs);
}