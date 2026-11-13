// 知识库路径弹窗：按环境绑定本地知识文件，或从路径载入。
import { el } from '../lib/dom.js';
import { getKbPath, isDefaultKbPath } from '../kb-path.js';
import { getKbFileName, kbFileSupported } from '../kb-file.js';

let open = false;
let dataDirBound = false;

/** 桌面壳（WebView2）里才有 window.chrome.webview，浏览器里没有。 */
function hostBridge() {
  return (typeof window !== 'undefined' && window.chrome && window.chrome.webview) || null;
}

/** 数据目录只在 exe 壳里可设置；浏览器版保持隐藏。 */
function setupDataDir() {
  const bridge = hostBridge();
  if (!bridge || !el.dataDirField) return;
  el.dataDirField.hidden = false;
  if (!dataDirBound) {
    dataDirBound = true;
    bridge.addEventListener('message', (event) => {
      const msg = String(event.data || '');
      const prefix = 'starmap:data-dir:';
      if (msg.startsWith(prefix)) el.dataDirInput.value = msg.slice(prefix.length);
    });
    el.dataDirBtn.addEventListener('click', () => bridge.postMessage('starmap:pick-data-dir'));
  }
  bridge.postMessage('starmap:get-data-dir');
}

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
      ? '默认使用内置演示库'
      : `使用自定义路径：${path}`;
  el.kbPickBtn.textContent = kbFileSupported() ? '选择知识文件' : '从路径载入';
}

export function openKbDialog() {
  open = true;
  el.moreWrap.classList.remove('open');
  syncKbUi();
  setupDataDir();
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