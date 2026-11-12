// 应用内确认框：比 window.confirm 更贴合深色星空界面，也方便键盘操作。
import { el } from '../lib/dom.js';

let pending = null;

export function askConfirm({ title, message, confirmText = '确定', onConfirm }) {
  if (!el.confirmLayer) return;
  pending = typeof onConfirm === 'function' ? onConfirm : null;
  el.confirmTitle.textContent = title || '确认操作';
  el.confirmText.textContent = message || '';
  el.confirmOk.textContent = confirmText;
  el.confirmOk.classList.add('is-danger');
  el.confirmLayer.hidden = false;
  void el.confirmLayer.offsetWidth;
  el.confirmLayer.classList.add('open');
  setTimeout(() => el.confirmOk.focus(), 60);
}

export function closeConfirm() {
  if (!el.confirmLayer) return;
  pending = null;
  el.confirmLayer.classList.remove('open');
  el.confirmLayer.hidden = true;
}

export function isConfirmOpen() {
  return !!el.confirmLayer && !el.confirmLayer.hidden;
}

export function bindConfirm() {
  if (!el.confirmLayer) return;
  el.confirmOk.addEventListener('click', () => {
    const fn = pending;
    closeConfirm();
    if (fn) fn();
  });
  el.confirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((btn) => {
    btn.addEventListener('click', closeConfirm);
  });
  el.confirmLayer.addEventListener('click', (e) => {
    if (e.target === el.confirmLayer) closeConfirm();
  });
  // capture 阶段先吃掉 Esc，避免下层同时关闭面板/返回层级。
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isConfirmOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeConfirm();
      } else if (e.key === 'Enter' && document.activeElement === el.confirmOk) {
        e.preventDefault();
        el.confirmOk.click();
      }
    },
    true
  );
}