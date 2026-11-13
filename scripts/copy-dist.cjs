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

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });

// 附带：应用图标、快捷方式启动器、WebView2 壳程序（单文件版分发时一起拷走）。
const extras = [
  [path.join(root, 'assets', 'xintu.ico'), path.join(dest, 'xintu.ico')],
  [path.join(root, 'assets', 'xintu.png'), path.join(dest, 'xintu.png')],
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
  fs.copyFileSync(from, to);
}

const index = path.join(dest, 'index.html');
console.log('已生成可双击打开的版本：' + index);
console.log('文件大小：' + (fs.statSync(index).size / 1024).toFixed(0) + ' KB');
console.log('已附带图标与快捷方式脚本：双击 app/create-shortcut.cmd 即可生成桌面快捷方式。');