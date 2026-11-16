// 音效设置：⋯ 菜单里的「音效设置」入口，打开一个独立弹窗，
// 每一类具体音效单独一行开关，用户可以只留自己想要的那几个。
import { audioReady } from '../audio/engine.js';
import { SOUND_GROUPS, onSoundChange, setSoundPref, soundPrefs, toggleSoundPref } from '../audio/prefs.js';
import * as sfx from '../audio/sfx.js';
import { el, esc } from '../lib/dom.js';
import { toast } from './feedback.js';

let bound = false;
let open = false;

/** 每个开关的试听音：点一下就能听见它控制的是什么。 */
const DEMO = {
  introWait: () => sfx.introWait(1.6),
  introBlast: () => sfx.introBlast(),
  shape: () => sfx.shape('sphere'),
  navigate: () => sfx.enter(2),
  select: () => sfx.select(2, 0),
  motion: () => sfx.motion('rotate', true),
  reset: () => sfx.reset(),
  zoom: () => sfx.zoom(),
  panel: () => sfx.panelOpen(),
  modal: () => sfx.modal(true),
  tab: () => sfx.tab(),
  menu: () => sfx.menu('kb'),
  search: () => sfx.searchPick(),
  nudge: () => sfx.nudge(true),
  typing: () => {
    sfx.keyPress();
    window.setTimeout(() => sfx.keyBack(), 150);
  },
  save: () => sfx.saved(),
  undo: () => {
    sfx.undo();
    window.setTimeout(() => sfx.redo(), 280);
  },
  add: () => sfx.lockLight(),
  delete: () => sfx.blackhole(),
  mastery: () => sfx.mastery(true),
  transfer: () => sfx.exported(),
  docFold: () => sfx.docFold(true),
  docMove: () => sfx.docDrop(),
  docEdit: () => sfx.docAdd()
};

export function isSoundDialogOpen() {
  return open;
}

function renderChannels() {
  if (!el.soundChannels || el.soundChannels.dataset.built) return;
  el.soundChannels.dataset.built = '1';
  el.soundChannels.innerHTML = SOUND_GROUPS.map(
    (group) => `
      <section class="sound-group">
        <h3>${esc(group.title)}</h3>
        <div class="sound-items">
          ${group.items
            .map(
              ([key, label]) => `
            <button class="sound-item" type="button" data-channel="${key}" aria-pressed="true">
              <span class="sound-item-name">${esc(label)}</span>
              <span class="sound-item-switch" aria-hidden="true"><i></i></span>
            </button>`
            )
            .join('')}
        </div>
      </section>`
  ).join('');
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
  if (el.soundChannels) {
    renderChannels();
    for (const btn of el.soundChannels.querySelectorAll('[data-channel]')) {
      const on = prefs.enabled && prefs.channels[btn.dataset.channel] !== false;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const group of el.soundChannels.querySelectorAll('.sound-group')) {
      const any = [...group.querySelectorAll('[data-channel]')].some((btn) => btn.classList.contains('is-on'));
      group.classList.toggle('is-dim', !any);
    }
  }
  if (el.soundHint) {
    el.soundHint.textContent = audioReady()
      ? '点任意一项可以试听；按 M 键快速静音。'
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

function demo(channel) {
  if (!audioReady()) {
    toast('声音还没有开始：点一下页面任意位置');
    return;
  }
  if (!soundPrefs().enabled) {
    toast('总开关是关着的，先打开再试听');
    return;
  }
  const play = DEMO[channel];
  if (play) play();
}

/** 「全部试听」：挑几段短的，按顺序过一遍。 */
function demoAll() {
  if (!audioReady() || !soundPrefs().enabled) {
    demo('nudge');
    return;
  }
  const order = ['shape', 'navigate', 'select', 'panel', 'tab', 'typing', 'save', 'mastery', 'docFold'];
  order.forEach((key, index) => window.setTimeout(() => demo(key), index * 320));
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

  if (el.soundChannels) {
    el.soundChannels.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-channel]');
      if (!btn) return;
      const channel = btn.dataset.channel;
      toggleSoundPref(`channel:${channel}`);
      syncSoundPanel();
      if (soundPrefs().enabled && soundPrefs().channels[channel] !== false) demo(channel);
    });
  }

  if (el.soundDemo) el.soundDemo.addEventListener('click', demoAll);

  if (el.soundLayer) {
    el.soundLayer.addEventListener('click', (e) => {
      if (e.target === el.soundLayer) closeSoundDialog();
      else if (e.target.closest('[data-sound-close]')) closeSoundDialog();
    });
  }
  if (el.soundDone) el.soundDone.addEventListener('click', closeSoundDialog);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !open) return;
      e.stopPropagation();
      e.preventDefault();
      closeSoundDialog();
    },
    true
  );

  renderChannels();
  onSoundChange(syncSoundPanel);
  syncSoundPanel();
}