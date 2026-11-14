// Edge CDP 交互测试：选中、双击面板、笔记编辑、添加节点、搜索、持久化。
// 用法：node scripts/smoke.cjs [url] [outPng]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:5180/?debug';
const outPng = process.argv[3] || path.join(__dirname, '..', 'dist', 'flow.png');
const port = 9412;
const profile = path.join(__dirname, '..', '.edge-flow-profile');

fs.rmSync(profile, { recursive: true, force: true });

const child = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('CDP 没有就绪');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () =>
      resolve({
        events,
        send(method, params) {
          const msgId = ++id;
          ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
          return new Promise((res) => pending.set(msgId, res));
        }
      })
    );
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method) events.push(msg);
    });
  });
}

(async () => {
  try {
    const cdp = await connect(await listTargets());
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });
    await sleep(3000);

    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    const screenOf = async (id) => {
      const point = await evaluate(`(() => {
        const sd = window.__starmap;
        const n = sd.data.nodes.find((x) => x.id === ${JSON.stringify(id)});
        if (!n) return null;
        const p = sd.toScreen(n.x, n.y);
        return Array.isArray(p) ? { x: p[0], y: p[1] } : p;
      })()`);
      return point;
    };

    const move = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    };
    const down = async (x, y, clickCount = 1) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
    };
    const up = async (x, y, clickCount = 1) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    };
    const click = async (x, y, n = 1) => {
      await move(x, y);
      for (let i = 1; i <= n; i++) {
        await down(x, y, i);
        await up(x, y, i);
      }
    };
    const key = async (type, keyName, code, keyCode) => {
      await cdp.send('Input.dispatchKeyEvent', { type, key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    };
    const typeText = async (text) => {
      await cdp.send('Input.insertText', { text });
    };

    const info = await evaluate(`JSON.stringify({nodes: window.__starmap.data.nodes.length, edges: window.__starmap.data.edges.length})`);
    console.log('INFO', info);

    // 1) 星海双击 calc1：进入以它为中心的局部图
    const calc = await evaluate(`(() => { const v = window.__starmap.scene.find(v => v.id === 'calc1'); return v ? {x:v.sx,y:v.sy} : null; })()`);
    await click(calc.x, calc.y, 2);
    await sleep(1000);
    console.log('SELECT', await evaluate(`JSON.stringify({level: window.__starmap.level, sel: window.__starmap.selection, dockHidden: document.getElementById('dock').hidden, dockName: document.getElementById('dockName').textContent})`));

    // 2) 局部图中打开课程侧栏
    await evaluate(`document.getElementById('dockOpen').click()`);
    await sleep(600);
    console.log(
      'PANEL',
      await evaluate(`JSON.stringify({
        open: document.getElementById('panel').classList.contains('open'),
        title: (document.querySelector('.panel-title')||{}).textContent,
        tabs: [...document.querySelectorAll('.panel-tab')].map(t => t.textContent.trim()),
        noteBlocks: document.querySelectorAll('.note-text').length,
        meta: (document.querySelector('.panel-meta')||{}).textContent
      })`)
    );
    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    fs.writeFileSync(outPng, Buffer.from(shot1.result.data, 'base64'));
    console.log('SHOT', outPng, fs.statSync(outPng).size);

    // 3) 笔记：点最后一条，回车拆分并输入
    const before = await evaluate('document.querySelectorAll(".note-text").length');
    await evaluate(`(() => {
      const blocks = [...document.querySelectorAll('.note-text')];
      const last = blocks[blocks.length - 1];
      last.focus();
      const r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    })()`);
    await key('keyDown', 'Enter', 'Enter', 13);
    await key('keyUp', 'Enter', 'Enter', 13);
    await sleep(200);
    await typeText('自动化测试条目');
    await sleep(700);
    const after = await evaluate('document.querySelectorAll(".note-text").length');
    console.log('NOTE', before, '->', after, 'saved:', await evaluate(`(localStorage.getItem('starmap.knowledge.v1')||'').includes('自动化测试条目')`));

    // 4) 关闭面板，双击空白添加节点
    await key('keyDown', 'Escape', 'Escape', 27);
    await key('keyUp', 'Escape', 'Escape', 27);
    await sleep(400);
    console.log('PANEL_CLOSED', await evaluate(`!document.getElementById('panel').classList.contains('open')`));
    await evaluate(`document.getElementById('btnAdd').click()`);
    await sleep(600);
    console.log('MODAL', await evaluate(`JSON.stringify({open: document.getElementById('modalLayer').classList.contains('open'), focus: document.activeElement.id})`));
    await typeText('测试知识点');
    await evaluate(`document.getElementById('addForm').requestSubmit()`);
    await sleep(700);
    console.log(
      'ADDED',
      await evaluate(`JSON.stringify({
        nodes: window.__starmap.data.nodes.length,
        exists: window.__starmap.data.nodes.some(n => n.name === '测试知识点'),
        panelOpen: document.getElementById('panel').classList.contains('open'),
        activeTab: (document.querySelector('.panel-tab.active')||{}).textContent,
        empty: !!document.querySelector('.note-empty')
      })`)
    );

    // 5) 持久化
    console.log('STORED', await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('starmap.knowledge.v1')||'null'); return JSON.stringify(raw ? {version: raw.version, nodes: raw.nodes.length, edges: raw.edges.length, styled: raw.nodes.filter(n=>Array.isArray(n.note)).length} : null); })()`));

    const errors = cdp.events
      .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map((e) => JSON.stringify(e.params).slice(0, 400))
      .filter((t) => !t.includes('favicon'));
    console.log('ERRORS', JSON.stringify(errors));
  } catch (err) {
    console.error('FAIL', err && err.message);
    process.exitCode = 1;
  } finally {
    child.kill();
    await sleep(400);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
})();