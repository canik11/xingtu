// 核心包测试运行器：逐个 import 测试文件（沙箱内 node --test 不能 spawn 子进程）。
const { readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const roots = process.argv.slice(2);
const targets = roots.length ? roots : ['packages/core/test'];

(async () => {
  let failed = 0;
  let ran = 0;
  for (const dir of targets) {
    const abs = resolve(__dirname, '..', dir);
    let files = [];
    try {
      files = readdirSync(abs).filter((f) => f.endsWith('.test.js'));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      ran++;
      try {
        await import(pathToFileURL(join(abs, f)).href);
      } catch (err) {
        failed++;
        console.error(`✗ ${f}\n${err && err.stack ? err.stack : err}`);
      }
    }
  }
  console.log(`\n${ran} test file(s), ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();