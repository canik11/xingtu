// 打赏作者弹窗：展示微信赞赏码，点击外部或「完成」关闭。
import { el } from '../lib/dom.js';

let open = false;

export function isRewardDialogOpen() {
  return open;
}

export function openRewardDialog() {
  open = true;
  el.moreWrap.classList.remove('open');
  el.rewardLayer.hidden = false;
  void el.rewardLayer.offsetWidth;
  el.rewardLayer.classList.add('open');
}

export function closeRewardDialog() {
  if (!open) return;
  open = false;
  el.rewardLayer.classList.remove('open');
  el.rewardLayer.hidden = true;
}

export function bindRewardDialog() {
  el.rewardLayer.addEventListener('pointerdown', (event) => {
    if (event.target === el.rewardLayer) closeRewardDialog();
  });
  el.rewardLayer.addEventListener('click', (event) => {
    if (event.target.closest('[data-reward-close]')) closeRewardDialog();
  });
  el.rewardDone.addEventListener('click', closeRewardDialog);

  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeRewardDialog();
  }, true);
}