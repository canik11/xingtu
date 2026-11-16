// 应用内确认框：比 window.confirm 更贴合深色星空界面，也方便键盘操作。
import { el } from '../lib/dom.js';

let pending = null;

/**
 * 打开确认框。
 * @param {{
 *   title?: string,
 *   message?: string,
 *   confirmText?: string,
 *   cancelText?: string,
 *   danger?: boolean,
 *   onConfirm?: Function,
 *   onCancel?: Function
 * }} options
 */
export function askConfirm({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = true,
  onConfirm,
  onCancel
}) {
  if (!el.confirmLayer) return;
  pending = {
    confirm: typeof onConfirm === 'function' ? onConfirm : null,
    cancel: typeof onCancel === 'function' ? onCancel : null
  };
  el.confirmTitle.textContent = title || '确认操作';
  el.confirmText.textContent = message || '';
  el.confirmOk.textContent = confirmText;
  el.confirmOk.classList.toggle('is-danger', danger);
  el.confirmLayer.querySelectorAll('.modal-foot [data-confirm-cancel]').forEach((btn) => {
    btn.textContent = cancelText;
  });
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

function runCancel() {
  const fn = pending && pending.cancel;
  closeConfirm();
  if (fn) fn();
}

export function bindConfirm() {
  if (!el.confirmLayer) return;
  el.confirmOk.addEventListener('click', () => {
    const fn = pending && pending.confirm;
    closeConfirm();
    if (fn) fn();
  });
  el.confirmLayer.querySelectorAll('.modal-foot [data-confirm-cancel]').forEach((btn) => {
    btn.addEventListener('click', runCancel);
  });
  // 右上角的 × 只是收起确认框，不代表「放弃修改」。
  el.confirmLayer.querySelectorAll('.x-btn[data-confirm-cancel]').forEach((btn) => {
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
        // Esc 与点遮罩一样，只是收起确认框，不代替「放弃修改」按钮。
        closeConfirm();
      } else if (e.key === 'Enter' && document.activeElement === el.confirmOk) {
        e.preventDefault();
        el.confirmOk.click();
      }
    },
    true
  );
}