<#
  把 packaging/Program.cs 编译成「知识星图.exe」，并把 WebView2 依赖复制到 app/。
  需要 .NET Framework 4.8 自带的 csc.exe（Windows 10/11 默认就有）。

  用法：powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-shell.ps1
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sdk = Join-Path $root 'packaging\webview2'
$app = Join-Path $root 'app'
$dist = Join-Path $root 'packaging\dist'
$source = Join-Path $root 'packaging\Program.cs'
$icon = Join-Path $root 'assets\xingtu.ico'
$outExe = Join-Path $dist '知识星图.exe'

if (-not (Test-Path -LiteralPath $csc)) { throw "找不到 csc.exe：$csc" }
if (-not (Test-Path -LiteralPath $source)) { throw "找不到源码：$source" }
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll'))) {
  throw "缺少 packaging\webview2 下的 WebView2 DLL。"
}
if (-not (Test-Path -LiteralPath $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (-not (Test-Path -LiteralPath $app)) { New-Item -ItemType Directory -Path $app | Out-Null }

& $csc /nologo /target:winexe /platform:x64 /codepage:65001 /optimize `
  "/out:$outExe" `
  "/win32icon:$icon" `
  "/reference:$(Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')" `
  "/reference:$(Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll')" `
  /reference:System.Windows.Forms.dll `
  /reference:System.Drawing.dll `
  /reference:System.Core.dll `
  $source
if ($LASTEXITCODE -ne 0) { throw "csc 编译失败（exit $LASTEXITCODE）" }

Copy-Item (Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll') $app -Force
Copy-Item (Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll') $app -Force
Copy-Item (Join-Path $sdk 'WebView2Loader.dll') $app -Force
Copy-Item $outExe $app -Force

"已生成：$outExe"
"已复制到：$app"