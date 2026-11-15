// 声音设置：放在 ⋯ 菜单里的两行（总开关 / 音量），不再单独占一个顶栏按钮。
import { audioReady } from '../audio/engine.js';
import { onSoundChange, setSoundPref, soundPrefs, toggleSoundPref } from '../audio/prefs.js';
import * as sfx from '../audio/sfx.js';
import { el } from '../lib/dom.js';

let bound = false;

/** 把偏好状态写回菜单控件。 */
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

  onSoundChange(syncSoundPanel);
  syncSoundPanel();
}