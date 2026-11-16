<#
  为「知识星图」单文件网页创建一个桌面 / 开始菜单快捷方式。

  默认行为：优先使用同目录的「知识星图.exe」——独立窗口、任务栏自定义图标；
  没有 exe 时退回本机 Edge / Chrome 的 --app 模式（无地址栏、无标签页）。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\create-shortcut.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\create-shortcut.ps1 -Browser chrome
    powershell -NoProfile -ExecutionPolicy Bypass -File .\create-shortcut.ps1 -Place startmenu
    powershell -NoProfile -ExecutionPolicy Bypass -File .\create-shortcut.ps1 -SourceDir D:\xingtu\app

  说明：快捷方式里保存的是绝对路径，所以换电脑后请对新的文件夹再运行一次本脚本。
#>
param(
  [string]$SourceDir = $PSScriptRoot,
  [ValidateSet('auto', 'edge', 'chrome', 'default')]
  [string]$Browser = 'auto',
  [ValidateSet('desktop', 'startmenu')]
  [string]$Place = 'desktop',
  [string]$Name = '知识星图',
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'

function Resolve-AppDir([string]$dir) {
  if ($dir -and (Test-Path -LiteralPath (Join-Path $dir 'index.html'))) { return (Resolve-Path -LiteralPath $dir).Path }
  $fallback = Join-Path (Split-Path -Parent $dir) 'app'
  if (Test-Path -LiteralPath (Join-Path $fallback 'index.html')) { return (Resolve-Path -LiteralPath $fallback).Path }
  throw "找不到 index.html；请把本脚本放在 index.html 旁边，或用 -SourceDir 指定目录。"
}

function Find-Browser([string]$kind) {
  $candidates = switch ($kind) {
    'edge' {
      @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
      )
    }
    'chrome' {
      @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
      )
    }
    default { @() }
  }
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

$appDir = Resolve-AppDir $SourceDir
$html = Join-Path $appDir 'index.html'
$icon = Join-Path $appDir 'xingtu.ico'
if (-not (Test-Path -LiteralPath $icon)) {
  $icon = Join-Path $appDir 'xingtu.png'
}

# —— 优先使用同目录的「知识星图.exe」：独立窗口，不依赖浏览器外壳 ——
$appExe = Join-Path $appDir '知识星图.exe'
$useAppExe = Test-Path -LiteralPath $appExe

# —— 没有 exe 时选浏览器：auto 先 Edge 再 Chrome，都没有就交给默认浏览器 ——
$browserExe = $null
if (-not $useAppExe) {
  switch ($Browser) {
    'edge' { $browserExe = Find-Browser 'edge' }
    'chrome' { $browserExe = Find-Browser 'chrome' }
    'auto' {
      $browserExe = Find-Browser 'edge'
      if (-not $browserExe) { $browserExe = Find-Browser 'chrome' }
    }
  }
}

# —— 目标目录 ——
$targetDir = if ($Place -eq 'startmenu') {
  Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
} else {
  [Environment]::GetFolderPath('Desktop')
}
$shortcutPath = Join-Path $targetDir ($Name + '.lnk')

$uri = ([System.Uri]$html).AbsoluteUri
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.Description = '知识星图 · 离线单文件版'
if ($useAppExe) {
  $shortcut.TargetPath = $appExe
  $shortcut.Arguments = ''
  $shortcut.IconLocation = $appExe + ',0'
} elseif ($browserExe) {
  $shortcut.TargetPath = $browserExe
  $shortcut.Arguments = '--app="' + $uri + '"'
} else {
  # 没有找到 Edge/Chrome：退回默认浏览器，会有地址栏，但也能用。
  $shortcut.TargetPath = $html
}
$shortcut.WorkingDirectory = $appDir
if (-not $useAppExe -and $icon -and (Test-Path -LiteralPath $icon)) {
  $shortcut.IconLocation = $icon + ',0'
}
$shortcut.Save()

"已创建快捷方式：$shortcutPath"
if ($useAppExe) {
  "打开方式：$appExe（独立窗口，任务栏显示自定义图标）"
} elseif ($browserExe) {
  "打开方式：$browserExe --app=$uri"
} else {
  "打开方式：系统默认浏览器（没有找到 Edge / Chrome 的 --app 模式）"
}
"图标：$icon"

if ($Launch) {
  if ($useAppExe) {
    Start-Process -FilePath $appExe
  } elseif ($browserExe) {
    Start-Process -FilePath $browserExe -ArgumentList ('--app="' + $uri + '"')
  } else {
    Start-Process -FilePath $html
  }
}