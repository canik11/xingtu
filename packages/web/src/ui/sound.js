// 声音面板：顶栏「声音」按钮弹出的小面板（总开关 / 音量 / 三个分类）。
import { audioReady } from '../audio/engine.js';
import { onSoundChange, setSoundPref, soundPrefs, toggleSoundPref } from '../audio/prefs.js';
import * as sfx from '../audio/sfx.js';
import { el } from '../lib/dom.js';

let bound = false;

function isOpen() {
  return !!el.soundPanel && !el.soundPanel.hidden;
}

function openPanel() {
  if (!el.soundPanel || !el.soundBtn) return;
  syncSoundPanel();
  el.soundPanel.hidden = false;
  el.soundBtn.classList.add('is-open');
  el.soundBtn.setAttribute('aria-expanded', 'true');
  sfx.tab();
}

function closePanel() {
  if (!el.soundPanel || !el.soundBtn || el.soundPanel.hidden) return;
  el.soundPanel.hidden = true;
  el.soundBtn.classList.remove('is-open');
  el.soundBtn.setAttribute('aria-expanded', 'false');
}

export function toggleSoundPanel() {
  if (isOpen()) closePanel();
  else openPanel();
}

/** 把偏好状态写回 DOM（面板打开、偏好变化时调用）。 */
export function syncSoundPanel() {
  if (!el.soundPanel) return;
  const prefs = soundPrefs();
  if (el.soundBtn) el.soundBtn.classList.toggle('is-on', prefs.enabled);
  if (el.soundEnabled) {
    el.soundEnabled.setAttribute('aria-checked', prefs.enabled ? 'true' : 'false');
    el.soundEnabled.classList.toggle('is-on', prefs.enabled);
  }
  if (el.soundModes) {
    el.soundModes.querySelectorAll('[data-sound]').forEach((btn) => {
      const key = btn.dataset.sound;
      const on =
        prefs.enabled && (key === 'ui' ? prefs.ui : key === 'ambient' ? prefs.ambient : prefs.pulse);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (el.soundVolume) {
    const value = Math.round(prefs.volume * 100);
    if (String(value) !== el.soundVolume.value) el.soundVolume.value = String(value);
    if (el.soundVolumeText) el.soundVolumeText.textContent = `${value}%`;
  }
  if (el.soundHint) {
    el.soundHint.textContent = audioReady() ? '按 M 键可以快速静音' : '点一下页面任意位置开始发声';
  }
}

/** 点分类按钮时给一小段示范，让用户知道那一类是什么声音。 */
function demo(key) {
  if (!audioReady()) return;
  if (key === 'ui') {
    sfx.nudge(true);
    setTimeout(() => sfx.level(2), 130);
  } else if (key === 'ambient') {
    sfx.sphere();
  } else if (key === 'pulse') {
    sfx.heartbeat(1);
  }
}

export function bindSound() {
  if (bound) return;
  bound = true;

  if (el.soundBtn) {
    el.soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSoundPanel();
    });
  }

  if (el.soundPanel) {
    el.soundPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.soundPanel.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const mode = target.closest('[data-sound]');
      if (mode) {
        const key = mode.dataset.sound;
        toggleSoundPref(key);
        syncSoundPanel();
        demo(key);
        return;
      }
      if (target.closest('#soundEnabled')) {
        toggleSoundPref('enabled');
        syncSoundPanel();
        if (soundPrefs().enabled) demo('ui');
        return;
      }
      if (target.closest('#soundDemo')) {
        demo('ui');
      }
    });
    el.soundPanel.addEventListener('input', (e) => {
      if (e.target !== el.soundVolume) return;
      setSoundPref('volume', Number(el.soundVolume.value) / 100);
      syncSoundPanel();
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (!isOpen()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && el.soundWrap && el.soundWrap.contains(target)) return;
    closePanel();
  });

  // 首次手势会异步解锁音频：解锁后把提示文案从「点一下页面…」换成快捷键说明。
  let readySeen = false;
  const refreshAfterUnlock = () => {
    if (readySeen) return;
    setTimeout(() => {
      if (readySeen || !audioReady()) return;
      readySeen = true;
      syncSoundPanel();
    }, 160);
  };
  document.addEventListener('pointerdown', refreshAfterUnlock, { passive: true });
  window.addEventListener('keydown', refreshAfterUnlock);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closePanel();
  });

  onSoundChange(() => syncSoundPanel());
  syncSoundPanel();
}

/** 供调试接口使用。 */
export function soundPanelOpen() {
  return isOpen();
}