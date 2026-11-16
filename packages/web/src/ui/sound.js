// 音效设置：⋯ 菜单里的「音效设置」入口，打开一个独立弹窗收纳全部音效选项。
import { audioReady } from '../audio/engine.js';
import { onSoundChange, setSoundPref, soundPrefs, toggleSoundPref } from '../audio/prefs.js';
import * as sfx from '../audio/sfx.js';
import { el } from '../lib/dom.js';
import { toast } from './feedback.js';

let bound = false;
let open = false;

export function isSoundDialogOpen() {
  return open;
}

/** 把偏好状态写回弹窗控件。 */
export function syncSoundPanel() {
  const prefs = soundPrefs();
  if (el.soundEnabled) {
    el.soundEnabled.setAttribute('aria-checked', prefs.enabled ? 'true' : 'false');
    el.soundEnabled.classList.toggle('is-on', prefs.enabled);
  }
  if (el.soundVolume) {
    const value = Math.round(prefs.volume * 100);
    if (String(value) !== el.soundVolume.value) el.soundVolume.value = String(value);
    if (el.soundVolumeText) el.soundVolumeText.textContent = `${value}%`;
  }
  if (el.soundModes) {
    for (const btn of el.soundModes.querySelectorAll('[data-sound]')) {
      const on = prefs.enabled && !!prefs[btn.dataset.sound];
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  if (el.soundHint) {
    el.soundHint.textContent = audioReady()
      ? '按 M 键可以快速静音；界面音效跟随每一次操作。'
      : '点一下页面任意位置后，声音才会开始。';
  }
}

export function openSoundDialog() {
  if (!el.soundLayer) return;
  syncSoundPanel();
  el.soundLayer.hidden = false;
  void el.soundLayer.offsetWidth;
  el.soundLayer.classList.add('open');
  open = true;
  sfx.modal(true);
}

export function closeSoundDialog() {
  if (!el.soundLayer || !open) return;
  open = false;
  el.soundLayer.classList.remove('open');
  el.soundLayer.hidden = true;
}

function demo(kind = 'ui') {
  if (!audioReady() || !soundPrefs().enabled) {
    toast('声音还没有开始：点一下页面任意位置');
    return;
  }
  if (kind === 'edit') {
    sfx.keyPress();
    window.setTimeout(() => sfx.keyBack(), 110);
    window.setTimeout(() => sfx.saved(), 240);
    return;
  }
  if (kind === 'intro') {
    sfx.introCharge(0.5);
    return;
  }
  sfx.nudge(true);
  window.setTimeout(() => sfx.level(2), 130);
}

export function bindSound() {
  if (bound) return;
  bound = true;

  if (el.soundEnabled) {
    el.soundEnabled.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSoundPref('enabled');
      syncSoundPanel();
      if (soundPrefs().enabled && audioReady()) sfx.nudge(true);
    });
  }

  if (el.soundVolume) {
    el.soundVolume.addEventListener('input', () => {
      setSoundPref('volume', Number(el.soundVolume.value) / 100);
      syncSoundPanel();
    });
  }

  if (el.soundModes) {
    el.soundModes.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sound]');
      if (!btn) return;
      const key = btn.dataset.sound;
      toggleSoundPref(key);
      syncSoundPanel();
      if (soundPrefs().enabled && soundPrefs()[key] && audioReady()) demo(key);
    });
  }

  if (el.soundDemo) el.soundDemo.addEventListener('click', () => demo('ui'));

  if (el.soundLayer) {
    el.soundLayer.addEventListener('click', (e) => {
      if (e.target === el.soundLayer) closeSoundDialog();
      else if (e.target.closest('[data-sound-close]')) closeSoundDialog();
    });
  }
  if (el.soundDone) el.soundDone.addEventListener('click', closeSoundDialog);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    e.preventDefault();
    closeSoundDialog();
  }, true);

  onSoundChange(syncSoundPanel);
  syncSoundPanel();
}