// Edge CDP 截图脚本：为 README 生成配图。
// 用法：node scripts/shots.cjs [outDir]
// 依赖 app/index.html（先 npm run build）与本机 Edge。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.env.SHOT_URL || 'file:///D:/xingtu/app/index.html?debug';
const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const port = 9413;
const profile = path.join(__dirname, '..', '.edge-shots-profile');
const W = 1600;
const H = 1000;

fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const child = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    `--window-size=${W},${H}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
);

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
  let cdp = null;
  try {
    cdp = await connect(await listTargets());
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const evaluate = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.result && res.result.exceptionDetails) {
        throw new Error('evaluate 失败：' + JSON.stringify(res.result.exceptionDetails).slice(0, 300));
      }
      return res.result && res.result.result && res.result.result.value;
    };

    const click = async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    };

    const key = async (name, code, vk) => {
      const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };

    const shot = async (file) => {
      const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const out = path.join(outDir, file);
      fs.writeFileSync(out, Buffer.from(res.result.data, 'base64'));
      console.log('SHOT', file, fs.statSync(out).size, 'bytes');
    };

    await cdp.send('Page.navigate', { url });
    await sleep(3400); // 等 boot 完成、黑幕上的等待页出现

    await click(Math.round(W / 2), Math.round(H / 2)); // 「点击任意处，进入星海」
    await sleep(4600); // 奇点蓄力 + 爆炸 + 1500ms 过渡 + 星海展开

    // 收起左侧「星海形状」面板，让封面上的星图完整居中
    await evaluate(`document.getElementById('shapeBarToggle').click()`);
    await sleep(800);

    // 1. 星海总览
    await shot('01-starmap.png');

    // 2. 侧栏笔记：选一个内容最多的知识点
    await evaluate(`window.__starmap.select('hsmath-func')`);
    await sleep(2000);
    await shot('02-notes.png');

    // 3. 掌握标记：把这个知识点的部分叶子条目打勾，看金色掌握色
    const mastery = await evaluate(`(() => {
      const sd = window.__starmap;
      const all = sd.entities();
      // 章节实体（二级）→ 所属课程（一级），用来按课程圈定叶子
      const chapterCourse = new Map(all.filter((e) => e.level === 2).map((e) => [e.id, e.parentId]));
      const leaves = all.filter((e) => e.level === 3 && (!e.children || !e.children.length));
      const wanted = new Set(['hsmath-func', 'calc1']);
      const targets = leaves.filter((e) => wanted.has(chapterCourse.get(e.parentId)));
      targets.forEach((e) => sd.toggleMastery(e.id));
      return targets.length;
    })()`);
    if (mastery > 0) {
      await evaluate(`window.__starmap.select('hsmath-func')`);
      await sleep(1600);
      await shot('03-mastery.png');
      await key('Escape', 'Escape', 27);
      await sleep(1400);
      await shot('03b-mastered-map.png');
    } else {
      console.log('跳过掌握图：没有可标记的叶子条目');
    }

    // 4. 搜索
    await key('Escape', 'Escape', 27);
    await sleep(900);
    await evaluate(`(() => {
      const input = document.getElementById('searchInput');
      input.focus();
      input.value = '导数';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
    await sleep(1400);
    await shot('04-search.png');

    // 5. 星河长卷（全项目大纲）
    await key('Escape', 'Escape', 27);
    await sleep(700);
    await evaluate(`(() => {
      const input = document.getElementById('searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      return true;
    })()`);
    await sleep(500);
    await evaluate(`document.getElementById('docOpenBtn').click()`);
    await sleep(2200);
    await shot('05-outline.png');

    const errors = cdp.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => JSON.stringify(e.params).slice(0, 300));
    console.log('ERRORS', JSON.stringify(errors));
  } catch (err) {
    console.error('FAIL', err && err.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.ws.close();
    child.kill();
    await sleep(400);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
})();