// 轻量反馈：toast 提示与致命错误条。
import { el } from '../lib/dom.js';

let toastTimer = 0;

/**
 * 底部短暂提示。
 * @param {string} message
 * @param {number} [duration]
 */
export function toast(message, duration = 2400) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), duration);
}

/**
 * 致命错误条：脚本异常时显示，避免白屏无提示。
 * @param {string} message
 */
export function showFatal(message) {
  console.error(message);
  if (!el.fatal) return;
  el.fatal.textContent = '出错了：' + message;
  el.fatal.hidden = false;
}

/** 隐藏错误条。 */
export function clearFatal() {
  if (el.fatal) el.fatal.hidden = true;
}