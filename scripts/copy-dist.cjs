// 把一个目录复制到目标位置（脚本在 scripts/ 下，路径相对仓库根）。
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'packages', 'web', 'dist');
const dest = path.join(root, 'app');

if (!fs.existsSync(src)) {
  console.error('找不到构建产物 packages/web/dist，请先 npm run build');
  process.exit(1);
}

// 不整目录删除：桌面版正在运行时 app/ 会被锁住（EPERM），
// 这里直接覆盖同名文件即可，dist 里只有单文件 index.html，不会残留旧文件。
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true, force: true });

// 附带：应用图标、快捷方式启动器、WebView2 壳程序（单文件版分发时一起拷走）。
const extras = [
  [path.join(root, 'assets', 'xingtu.ico'), path.join(dest, 'xingtu.ico')],
  [path.join(root, 'assets', 'xingtu.png'), path.join(dest, 'xingtu.png')],
  [path.join(root, 'scripts', 'create-shortcut.ps1'), path.join(dest, 'create-shortcut.ps1')],
  [path.join(root, 'scripts', 'create-shortcut.cmd'), path.join(dest, 'create-shortcut.cmd')],
  [path.join(root, 'packaging', 'dist', '知识星图.exe'), path.join(dest, '知识星图.exe')],
  [path.join(root, 'packaging', 'webview2', 'Microsoft.Web.WebView2.Core.dll'), path.join(dest, 'Microsoft.Web.WebView2.Core.dll')],
  [path.join(root, 'packaging', 'webview2', 'Microsoft.Web.WebView2.WinForms.dll'), path.join(dest, 'Microsoft.Web.WebView2.WinForms.dll')],
  [path.join(root, 'packaging', 'webview2', 'WebView2Loader.dll'), path.join(dest, 'WebView2Loader.dll')],
];
for (const [from, to] of extras) {
  if (!fs.existsSync(from)) {
    // 壳程序是可选产物：没有编译过 exe 时仍生成可双击的 index.html。
    console.warn('跳过不存在的分发文件：' + from);
    continue;
  }
  try {
    fs.copyFileSync(from, to);
  } catch (err) {
    // 桌面版正在运行时会锁住 exe/dll，此时跳过即可，不影响单文件版生成。
    console.warn('复制失败（可能被运行中的程序占用），已跳过：' + to + ' — ' + err.code);
  }
}

// 在产物 HTML 里保留第三方许可声明：MIT 要求在副本中包含版权声明与许可声明，
// 打包压缩后源码注释会丢失，所以这里显式注入一段注释。
const index = path.join(dest, 'index.html');
const notice = [
  '<!--',
  '知识星图 xingtu — 本项目代码按 CC BY-NC-SA 4.0 授权：https://creativecommons.org/licenses/by-nc-sa/4.0/',
  '本文件内含第三方组件，保留各自许可：',
  '  pixi.js — MIT License, Copyright (c) 2013-2023 Mathew Groves, Chad Engler',
  '  pdf.js (pdfjs-dist) — Apache License 2.0, Copyright 2024 Mozilla Foundation',
  '完整声明见 THIRD-PARTY-NOTICES.md 与 licenses/ 目录。',
  '-->'
].join('\n');
const html = fs.readFileSync(index, 'utf8');
if (!html.includes('知识星图 xingtu — 本项目代码按')) {
  const injected = html.includes('<head>')
    ? html.replace('<head>', '<head>\n' + notice)
    : html.replace(/(<!doctype html>)/i, '$1\n' + notice);
  fs.writeFileSync(index, injected, 'utf8');
}

console.log('已生成可双击打开的版本：' + index);
console.log('文件大小：' + (fs.statSync(index).size / 1024).toFixed(0) + ' KB');
console.log('已附带图标与快捷方式脚本：双击 app/create-shortcut.cmd 即可生成桌面快捷方式。');