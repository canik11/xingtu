// 桌面壳（WebView2）桥接：知识文件的选择、读取、写回与路径显示直接交给壳程序。
// 壳端用纯文本协议避免 JSON 转义：命令与路径、内容之间用换行分隔。
const PREFIX = 'starmap:kb-';
const TIMEOUT = 5000;

let hostPath = '';
let pending = null;

function bridge() {
  if (typeof window === 'undefined') return null;
  const webview = window.chrome && window.chrome.webview;
  return webview && typeof webview.postMessage === 'function' ? webview : null;
}

/** 当前是否运行在带桥接的桌面壳里。 */
export function hostKbSupported() {
  return !!bridge();
}

/** 壳里记住的知识文件完整路径（未绑定时为空串）。 */
export function getHostKbPath() {
  return hostPath;
}

export function hasHostKb() {
  return hostPath.length > 0;
}

function settle(result) {
  const waiter = pending;
  pending = null;
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }
}

function onMessage(event) {
  const raw = typeof event.data === 'string' ? event.data : '';
  if (!raw.startsWith(PREFIX)) return;
  if (raw === 'starmap:kb-none' || raw === 'starmap:kb-cancel' || raw === 'starmap:kb-error') {
    if (raw === 'starmap:kb-none') hostPath = '';
    settle({ status: raw.slice(PREFIX.length) });
    return;
  }
  const first = raw.indexOf('\n');
  const second = first >= 0 ? raw.indexOf('\n', first + 1) : -1;
  if (first < 0 || second < 0) return;
  const type = raw.slice(PREFIX.length, first);
  const path = raw.slice(first + 1, second);
  const content = raw.slice(second + 1);
  if (type === 'loaded' || type === 'picked') hostPath = path;
  settle({ status: type, path, content });
}

function waitForShell() {
  const webview = bridge();
  if (!webview) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle({ status: 'timeout' }), TIMEOUT);
    pending = { resolve, timer };
  });
}

function post(text) {
  const webview = bridge();
  if (!webview) return false;
  try {
    webview.postMessage(text);
    return true;
  } catch {
    return false;
  }
}

/** 启动时询问壳里是否已有绑定文件。 */
export async function requestHostKb() {
  if (!hostKbSupported()) return null;
  if (pending) settle(null);
  const wait = waitForShell();
  if (!post('starmap:kb-get')) return null;
  return wait;
}

/** 让壳弹出原生文件选择框；返回 { status, path, content }。 */
export async function pickHostKb() {
  if (!hostKbSupported()) return null;
  if (pending) settle(null);
  const wait = waitForShell();
  if (!post('starmap:kb-pick')) return null;
  return wait;
}

/** 把 JSON 文本交给壳写回当前绑定文件；未绑定时什么也不做。 */
export function saveHostKb(text) {
  if (!hostPath) return false;
  return post('starmap:kb-save\n' + text);
}

/** 解除绑定：壳会清掉记住的路径，但不会删除文件。 */
export function unbindHostKb() {
  hostPath = '';
  return post('starmap:kb-unbind');
}

if (typeof window !== 'undefined' && bridge()) {
  try {
    window.chrome.webview.addEventListener('message', onMessage);
  } catch {
    /* 桥接不可用时按浏览器版处理。 */
  }
}