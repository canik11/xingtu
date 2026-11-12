// 知识库路径弹窗：按环境绑定本地知识文件，或从路径载入。
import { el } from '../lib/dom.js';
import { getKbPath, isDefaultKbPath } from '../kb-path.js';
import { getKbFileName, kbFileSupported } from '../kb-file.js';

let open = false;

export function isKbDialogOpen() {
  return open;
}

/** 同步绑定文件、输入框与按钮文案，供载入/绑定后刷新。 */
export function syncKbUi() {
  if (!el.kbPathInput) return;
  const name = getKbFileName();
  const path = getKbPath();
  const value = name || path;
  el.kbPathInput.value = value;
  el.kbPathInput.readOnly = kbFileSupported();
  el.kbPathHint.textContent = name
    ? `已绑定知识文件：${name}`
    : isDefaultKbPath(path)
      ? '默认使用 knowledge/seed.json'
      : `使用自定义路径：${path}`;
  el.kbPickBtn.textContent = kbFileSupported() ? '选择知识文件' : '从路径载入';
}

export function openKbDialog() {
  open = true;
  el.moreWrap.classList.remove('open');
  syncKbUi();
  el.kbLayer.hidden = false;
  void el.kbLayer.offsetWidth;
  el.kbLayer.classList.add('open');
  el.kbPathInput.focus({ preventScroll: true });
  el.kbPathInput.select();
}

export function closeKbDialog() {
  if (!open) return;
  open = false;
  el.kbLayer.classList.remove('open');
  el.kbLayer.hidden = true;
}

export function bindKbDialog() {
  el.kbLayer.addEventListener('pointerdown', (event) => {
    if (event.target === el.kbLayer) closeKbDialog();
  });
  el.kbLayer.addEventListener('click', (event) => {
    if (event.target.closest('[data-kb-close]')) closeKbDialog();
  });
  el.kbDone.addEventListener('click', closeKbDialog);

  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeKbDialog();
  }, true);
}