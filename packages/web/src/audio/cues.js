// 音效总调度：手势解锁、开场音、全局点击声、弹层开合、心跳应和。
// 其他模块只管在关键动作处调用 sfx.*，这里负责「什么时候能出声」。
import { audioReady, setMasterVolume, unlockAudio } from './engine.js';
import { onSoundChange, soundPrefs, toggleSoundPref } from './prefs.js';
import { ambientState, startAmbient, stopAmbient, startWaitAmbience, stopWaitAmbience } from './ambient.js';
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
  // 还没点进星海：把等待页的循环底噪铺上（持续振荡器，首尾天然无缝）。
  if (!introStarted) syncWaitAmbience();
  // 用户在爆炸之后才第一次交互：开场音已经错过，用一声苏醒音补偿。
  if (introStarted && introDone && !introAwakened) {
    introAwakened = true;
    sfx.awaken();
  }
}

/** 等待页氛围音：只看「开场 · 等待页氛围」这一项开关。 */
function syncWaitAmbience() {
  const prefs = soundPrefs();
  const want = prefs.enabled && prefs.channels.introWait === true && !introStarted;
  if (want) startWaitAmbience();
  else stopWaitAmbience();
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
  // 等待页还没结束：跟着「等待页氛围」的开关即时响起或收掉。
  if (!introStarted) syncWaitAmbience();
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
 * 开场开始时调用：只登记开场状态，等待页不再额外铺一层长音
 * （点击后立刻爆炸，等待音会盖住爆炸）。
 * 若音频尚未解锁，后续音效会被引擎静默丢弃，不会报错。
 */
export function introSoundStart() {
  // 进入爆炸前把等待页底噪收掉，别让它盖住爆炸。
  stopWaitAmbience(0.55);
  introStarted = true;
  introBlasted = false;
  introDone = false;
  introAwakened = false;
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    introDone = true;
  }, 3200);
}

/** 等待页结束、奇点收紧时调用（紧接在爆炸之前）。 */
export function introSoundCharge() {
  if (!introStarted) return;
  sfx.introCharge(0.18);
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

/* ------------------------------ 初始化 ------------------------------ */

export function initSound() {
  const prefs = soundPrefs();
  setMasterVolume(prefs.enabled ? prefs.volume : 0);
  bindGestures();
  // 桌面版（WebView2 带 autoplay 参数）可能允许自动播放：静默试一次，
  // 成功就把等待页底噪铺上；网页版会失败，等第一次点击再解锁。
  attemptUnlock();
  bindShortcuts();
  bindDelegates();
  watchOverlays();
  onSoundChange(applyPrefs);
}
