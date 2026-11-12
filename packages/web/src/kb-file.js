// 知识文件绑定：把知识数据的读写绑定到一个本地 JSON 文件。
// 浏览器用 File System Access API；句柄存 IndexedDB，刷新后仍有效（写权限需授权一次）。
import { normalizeData } from '@starmap/core';

const DB_NAME = 'starmap-kb';
const STORE = 'handles';
const HANDLE_KEY = 'kb-file';

let boundHandle = null;
let boundName = '';
let writeChain = Promise.resolve();

function pickerTypes() {
  return [{ description: '知识库 JSON', accept: { 'application/json': ['.json'] } }];
}

/** 当前运行环境是否支持文件读写绑定。 */
export function kbFileSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

/** 已绑定文件的名称；未绑定时为空串。 */
export function getKbFileName() {
  return boundName;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb'));
  });
}

async function putHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('indexeddb'));
  });
  db.close();
}

async function getHandle() {
  const db = await openDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('indexeddb'));
  });
  db.close();
  return handle;
}

async function deleteHandle() {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* IndexedDB 不可用时忽略。 */
  }
}

async function permission(handle, request) {
  if (!handle) return 'denied';
  try {
    if (request && typeof handle.requestPermission === 'function') {
      return await handle.requestPermission({ mode: 'readwrite' });
    }
    if (typeof handle.queryPermission === 'function') {
      return await handle.queryPermission({ mode: 'readwrite' });
    }
    return 'granted';
  } catch {
    return 'denied';
  }
}

async function readText(handle) {
  const file = await handle.getFile();
  return file.text();
}

async function writeText(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function bind(handle) {
  const state = await permission(handle, true);
  if (state !== 'granted') throw new Error('permission');
  boundHandle = handle;
  boundName = handle.name || 'knowledge.json';
  try {
    await putHandle(handle);
  } catch {
    /* 句柄存不进 IndexedDB 时仅当前会话有效。 */
  }
}

/** 选择并绑定一个知识文件，返回读取到的规范化数据。 */
export async function pickKbFile() {
  if (!kbFileSupported()) throw new Error('unsupported');
  const [handle] = await window.showOpenFilePicker({ types: pickerTypes(), multiple: false });
  if (!handle) throw new Error('cancelled');
  await bind(handle);
  const norm = normalizeData(JSON.parse(await readText(handle)));
  if (!norm) throw new Error('invalid');
  return norm;
}

/** 启动时恢复上次绑定的文件；权限未授予时只恢复句柄，等用户重新选择。 */
export async function restoreKbFile() {
  if (!kbFileSupported()) return null;
  let handle = null;
  try {
    handle = await getHandle();
  } catch {
    return null;
  }
  if (!handle) return null;
  boundHandle = handle;
  boundName = handle.name || 'knowledge.json';
  try {
    const state = await permission(handle, false);
    if (state !== 'granted') return { permission: false, name: boundName };
    const norm = normalizeData(JSON.parse(await readText(handle)));
    if (!norm) return { permission: true, name: boundName, invalid: true };
    return { permission: true, name: boundName, data: norm };
  } catch {
    return { permission: true, name: boundName, error: true };
  }
}

/** 解除当前文件绑定（只影响本机，不删除文件）。路径载入或手动改路径时使用。 */
export async function unbindKbFile() {
  boundHandle = null;
  boundName = '';
  await deleteHandle();
}

/** 把数据写回绑定文件；未绑定或没有写权限时返回 false。 */
export async function writeBoundKbFile(text) {
  if (!boundHandle) return false;
  if ((await permission(boundHandle, false)) !== 'granted') return false;
  writeChain = writeChain.then(() => writeText(boundHandle, text)).catch(() => {});
  await writeChain;
  return true;
}