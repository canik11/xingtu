// 外观设置弹窗：3D/2D 画质参数、视图模式 + 全局默认色/掌握色与按课程覆盖。
import { el } from '../lib/dom.js';
import { getOutline } from '../outline.js';
import { quality, resetQuality, setQuality, setViewMode } from '../quality.js';
import {
  appearanceConfig,
  appearanceColors,
  ensureAppearance,
  setGlobalAppearance,
  setScaleAppearance,
  setCourseAppearance,
  clearCourseAppearance,
  resetAppearance
} from '../mastery.js';

let open = false;
let drag = null;

const DRAG_MARGIN = 12;

function appearanceModal() {
  return el.appearanceLayer.querySelector('.appearance-modal');
}

function endAppearanceDrag() {
  if (!drag) return;
  drag = null;
  appearanceModal()?.classList.remove('is-dragging');
  document.body.classList.remove('appearance-dragging');
}

function moveAppearanceDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const box = appearanceModal();
  if (!box) {
    endAppearanceDrag();
    return;
  }
  const dx = Math.max(drag.minDx, Math.min(drag.maxDx, event.clientX - drag.startX));
  const dy = Math.max(drag.minDy, Math.min(drag.maxDy, event.clientY - drag.startY));
  box.style.left = `${drag.left + dx}px`;
  box.style.top = `${drag.top + dy}px`;
}

function startAppearanceDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest('button, a, input, select, textarea, label')) return;
  const box = appearanceModal();
  if (!box) return;
  const rect = box.getBoundingClientRect();
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: Number.parseFloat(box.style.left) || 0,
    top: Number.parseFloat(box.style.top) || 0,
    minDx: DRAG_MARGIN - rect.left,
    maxDx: window.innerWidth - DRAG_MARGIN - rect.right,
    minDy: DRAG_MARGIN - rect.top,
    maxDy: window.innerHeight - DRAG_MARGIN - rect.bottom
  };
  box.classList.add('is-dragging');
  document.body.classList.add('appearance-dragging');
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function clampAppearancePosition() {
  const box = appearanceModal();
  if (!box || (!box.style.left && !box.style.top)) return;
  const rect = box.getBoundingClientRect();
  let left = Number.parseFloat(box.style.left) || 0;
  let top = Number.parseFloat(box.style.top) || 0;
  if (rect.left < DRAG_MARGIN) left += DRAG_MARGIN - rect.left;
  if (rect.right > window.innerWidth - DRAG_MARGIN) {
    left -= rect.right - (window.innerWidth - DRAG_MARGIN);
  }
  if (rect.top < DRAG_MARGIN) top += DRAG_MARGIN - rect.top;
  if (rect.bottom > window.innerHeight - DRAG_MARGIN) {
    top -= rect.bottom - (window.innerHeight - DRAG_MARGIN);
  }
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

export function isAppearanceOpen() {
  return open;
}

function syncColorUi() {
  const cfg = appearanceConfig();
  el.appearanceDefault.value = cfg.defaultColor;
  el.appearanceMastered.value = cfg.masteredColor;
  el.appearanceDefaultHex.textContent = cfg.defaultColor.toUpperCase();
  el.appearanceMasteredHex.textContent = cfg.masteredColor.toUpperCase();
  el.appearanceDefaultDot.style.background = cfg.defaultColor;
  el.appearanceDefaultDot.style.color = cfg.defaultColor;
  el.appearanceMasteredDot.style.background = cfg.masteredColor;
  el.appearanceMasteredDot.style.color = cfg.masteredColor;
}

function scaleInputs() {
  return [
    [el.appearanceNodeBrightness, el.appearanceNodeBrightnessValue, 'nodeBrightness'],
    [el.appearanceNodeSize, el.appearanceNodeSizeValue, 'nodeSize'],
    [el.appearanceEdgeBrightness, el.appearanceEdgeBrightnessValue, 'edgeBrightness'],
    [el.appearancePulseBrightness, el.appearancePulseBrightnessValue, 'pulseBrightness'],
    [el.appearancePulseSize, el.appearancePulseSizeValue, 'pulseSize']
  ];
}

function syncScaleUi() {
  const cfg = appearanceConfig();
  for (const [input, output, kind] of scaleInputs()) {
    const percent = Math.round(cfg[kind] * 100);
    input.value = String(percent);
    output.textContent = `${percent}%`;
  }
}

/** 画质滑块：存储值是实际倍率，滑杆显示百分比（像素预算显示 MP）。
 *  groups 表示滑杆同时写入哪几组：星点密度/大小/光晕是 3D 与 2D 共用的背景参数。 */
function qualityInputs() {
  return [
    [['three'], 'maxScale', el.qualityMaxScale, el.qualityMaxScaleValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['three'], 'pixelBudget', el.qualityPixelBudget, el.qualityPixelBudgetValue, 1, (v) => `${v} MP`],
    [['three', 'two'], 'stars', el.qualityStars, el.qualityStarsValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['three', 'two'], 'starSize', el.qualityStarSize, el.qualityStarSizeValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['three', 'two'], 'glow', el.qualityGlow, el.qualityGlowValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['three'], 'sparkle', el.qualitySparkle, el.qualitySparkleValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['three'], 'ambient', el.qualityAmbient, el.qualityAmbientValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['two'], 'dprCap', el.qualityDpr, el.qualityDprValue, 0.01, (v) => `${Math.round(v * 100)}%`],
    [['two'], 'spread', el.qualitySpread, el.qualitySpreadValue, 0.01, (v) => `${Math.round(v * 100)}%`]
  ];
}

/** 3D 与 2D 共享的三个背景参数：老数据里两组可能不一致，打开面板时以 3D 组为准合并。 */
function syncSharedQuality() {
  const q = quality();
  for (const key of ['stars', 'starSize', 'glow']) {
    if (q.two[key] !== q.three[key]) setQuality('two', key, q.three[key]);
  }
}

function syncQualityUi() {
  const q = quality();
  const current = q.mode === '2d' ? 'two' : 'three';
  for (const [groups, key, input, output, factor, format] of qualityInputs()) {
    const group = groups.includes(current) ? current : groups[0];
    const value = q[group][key];
    input.value = String(value / factor);
    output.textContent = format(value);
  }
  for (const btn of el.qualityModeButtons) {
    const active = btn.dataset.viewMode === q.mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function makeColorInput(kind, color) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = color;
  input.dataset.kind = kind;
  input.setAttribute('aria-label', kind === 'defaultColor' ? '默认颜色' : '掌握颜色');
  return input;
}

function renderCourses() {
  const cfg = appearanceConfig();
  const courses = getOutline().courses;
  el.appearanceCourses.replaceChildren();
  for (const course of courses) {
    const override = cfg.courses[course.id];
    const palette = appearanceColors(course);
    const row = document.createElement('div');
    row.className = 'appearance-course';
    row.dataset.course = course.id;
    row.dataset.override = override ? '1' : '0';

    const name = document.createElement('div');
    name.className = 'appearance-course-name';
    name.textContent = course.name;
    row.appendChild(name);

    const defaultLabel = document.createElement('label');
    defaultLabel.className = 'appearance-color';
    defaultLabel.append('默认');
    defaultLabel.appendChild(makeColorInput('defaultColor', palette.defaultColor));
    row.appendChild(defaultLabel);

    const masteredLabel = document.createElement('label');
    masteredLabel.className = 'appearance-color';
    masteredLabel.append('掌握');
    masteredLabel.appendChild(makeColorInput('masteredColor', palette.masteredColor));
    row.appendChild(masteredLabel);

    const actions = document.createElement('div');
    actions.className = 'appearance-course-actions';
    const badge = document.createElement('span');
    badge.className = 'appearance-badge';
    badge.textContent = override ? '自定义' : '跟随全局';
    actions.appendChild(badge);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'link-btn';
    reset.dataset.resetCourse = course.id;
    reset.textContent = '恢复全局';
    reset.disabled = !override;
    actions.appendChild(reset);
    row.appendChild(actions);

    el.appearanceCourses.appendChild(row);
  }
}

function renderAll() {
  ensureAppearance();
  syncColorUi();
  syncScaleUi();
  syncQualityUi();
  renderCourses();
}

export function openAppearance() {
  open = true;
  el.moreWrap.classList.remove('open');
  renderAll();
  el.appearanceLayer.hidden = false;
  void el.appearanceLayer.offsetWidth;
  el.appearanceLayer.classList.add('open');
  clampAppearancePosition();
  el.appearanceDefault.focus({ preventScroll: true });
}

export function closeAppearance() {
  if (!open) return;
  endAppearanceDrag();
  open = false;
  el.appearanceLayer.classList.remove('open');
  el.appearanceLayer.hidden = true;
}

function updateCourseRow(input) {
  const row = input.closest('.appearance-course');
  if (!row) return;
  row.dataset.override = '1';
  const badge = row.querySelector('.appearance-badge');
  const reset = row.querySelector('[data-reset-course]');
  if (badge) badge.textContent = '自定义';
  if (reset) reset.disabled = false;
}

export function bindAppearance() {
  syncSharedQuality();
  el.appearanceDefault.addEventListener('input', () => {
    setGlobalAppearance('defaultColor', el.appearanceDefault.value);
    syncColorUi();
    // 只有仍跟随全局的课程需要同步，避免打断正在取色的颜色选择器。
    for (const row of el.appearanceCourses.children) {
      if (row.dataset.override === '1') continue;
      const input = row.querySelector('input[data-kind="defaultColor"]');
      if (input) input.value = el.appearanceDefault.value;
    }
  });
  el.appearanceDefault.addEventListener('change', renderCourses);

  el.appearanceMastered.addEventListener('input', () => {
    setGlobalAppearance('masteredColor', el.appearanceMastered.value);
    syncColorUi();
    for (const row of el.appearanceCourses.children) {
      if (row.dataset.override === '1') continue;
      const input = row.querySelector('input[data-kind="masteredColor"]');
      if (input) input.value = el.appearanceMastered.value;
    }
  });
  el.appearanceMastered.addEventListener('change', renderCourses);

  for (const [input, output, kind] of scaleInputs()) {
    input.addEventListener('input', () => {
      setScaleAppearance(kind, Number(input.value) / 100);
      output.textContent = `${input.value}%`;
    });
  }

  for (const [groups, key, input, output, factor, format] of qualityInputs()) {
    input.addEventListener('input', () => {
      const value = Number(input.value) * factor;
      for (const group of groups) setQuality(group, key, value);
      output.textContent = format(value);
    });
  }

  for (const btn of el.qualityModeButtons) {
    btn.addEventListener('click', () => {
      setViewMode(btn.dataset.viewMode);
      syncQualityUi();
    });
  }

  for (const btn of el.qualityResets) {
    btn.addEventListener('click', () => {
      resetQuality(btn.dataset.qualityReset);
      syncQualityUi();
    });
  }

  el.appearanceCourses.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-kind]');
    if (!input) return;
    const row = input.closest('.appearance-course');
    if (!row) return;
    setCourseAppearance(row.dataset.course, input.dataset.kind, input.value);
    updateCourseRow(input);
  });

  el.appearanceCourses.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reset-course]');
    if (!button) return;
    clearCourseAppearance(button.dataset.resetCourse);
    renderCourses();
  });

  el.appearanceReset.addEventListener('click', () => {
    resetAppearance();
    renderAll();
  });

  el.appearanceLayer.addEventListener('pointerdown', (event) => {
    if (event.target === el.appearanceLayer) closeAppearance();
  });
  el.appearanceLayer.addEventListener('click', (event) => {
    if (event.target.closest('[data-appearance-close]')) closeAppearance();
  });
  el.appearanceDone.addEventListener('click', closeAppearance);

  const head = appearanceModal()?.querySelector('.modal-head');
  if (head) {
    head.title = '按住标题栏拖动窗口';
    head.addEventListener('pointerdown', startAppearanceDrag);
    head.addEventListener('lostpointercapture', endAppearanceDrag);
  }
  window.addEventListener('pointermove', moveAppearanceDrag);
  window.addEventListener('pointerup', endAppearanceDrag);
  window.addEventListener('pointercancel', endAppearanceDrag);
  window.addEventListener('resize', clampAppearancePosition);

  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeAppearance();
  }, true);
}