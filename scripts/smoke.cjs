// Edge CDP 冒烟测试：加载应用、收集控制台错误、截图。
// 用法：node scripts/smoke.cjs [url] [outPng]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:5180/';
const out = process.argv[3] || path.join(__dirname, '..', 'dist', 'smoke.png');
const port = 9411;
const profile = path.join(__dirname, '..', '.edge-smoke-profile');

fs.rmSync(profile, { recursive: true, force: true });

const headless = process.env.SMOKE_HEADFUL !== '1';
const scale = process.env.SMOKE_SCALE;
const windowSize = process.env.SMOKE_WINDOW || '1600,1000';
const browserArgs = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-extensions',
  '--hide-scrollbars',
  `--window-size=${windowSize}`,
  'about:blank'
];
if (scale) browserArgs.push(`--force-device-scale-factor=${scale}`);
if (headless) browserArgs.unshift('--headless=new');
const child = spawn(EDGE, browserArgs, { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  for (let i = 0; i < 60; i++) {
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
        ws,
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
      } else if (msg.method) {
        events.push(msg);
      }
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
    await sleep(3200);
    const info = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.getElementById('stage');
        const gl = document.getElementById('glstage');
        const sd = window.__starmap;
        return JSON.stringify({
          title: document.title,
          dpr: window.devicePixelRatio,
          renderer: sd ? sd.renderer : null,
          canvas: el ? [el.width, el.height, el.clientWidth, el.clientHeight] : null,
          glCanvas: gl ? [gl.width, gl.height, gl.clientWidth, gl.clientHeight, getComputedStyle(gl).width] : null,
          dock: (document.getElementById('dock')||{}).hidden,
          stats: (document.getElementById('statNodes')||{}).textContent,
          edges: (document.getElementById('statEdges')||{}).textContent,
          fatal: (document.getElementById('fatal')||{}).textContent,
          nodes: sd ? sd.data.nodes.length : null,
          edgeCount: sd ? sd.data.edges.length : null,
          cam: sd ? sd.cam : null
        });
      })()`,
      returnByValue: true
    });
    console.log('INFO', info.result && info.result.result && info.result.result.value);

    if (process.env.SMOKE_CLICK === '1') {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', {
          type,
          x: 1180,
          y: 700,
          button: 'left',
          clickCount: 1
        });
      }
      await sleep(90);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('SHOT', out, fs.statSync(out).size);

    const errors = cdp.events
      .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map((e) => JSON.stringify(e.params).slice(0, 400));
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