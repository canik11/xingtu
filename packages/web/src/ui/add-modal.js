// “添加知识点”弹窗：打开、关闭与 ESC 兜底。
import { el } from '../lib/dom.js';

/** 打开弹窗并聚焦名称输入框。 */
export function openAdd() {
  el.modalLayer.hidden = false;
  // 先显示再添加 open 类，让淡入/位移动画正常触发。
  void el.modalLayer.offsetWidth;
  el.modalLayer.classList.add('open');
  setTimeout(() => el.addName.focus(), 90);
}

/** 关闭弹窗。 */
export function closeModal() {
  el.modalLayer.classList.remove('open');
  el.modalLayer.hidden = true;
}

/** 弹窗是否打开。 */
export function isAddOpen() {
  return !el.modalLayer.hidden;
}

/** 绑定遮罩点击与关闭按钮。 */
export function bindAddModal(onClose) {
  el.modalLayer.addEventListener('click', (e) => {
    if (e.target === el.modalLayer) onClose();
  });
  el.modalLayer.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', onClose);
  });
}