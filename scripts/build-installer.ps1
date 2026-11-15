param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$npm = 'C:\Program Files\nodejs\npm.cmd'

# 版本号统一从根 package.json 读取，避免安装包与项目版本两处手改。
$version = & $node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,'');process.stdout.write(JSON.parse(s).version)" (Join-Path $root 'package.json')
if (-not $version) { throw '无法从 package.json 读取版本号' }
Write-Host "项目版本：$version"

$iscc = Join-Path $root 'tools\InnoSetup6\ISCC.exe'
if (-not (Test-Path $iscc)) {
  throw "找不到 Inno Setup 编译器：$iscc（请把 Inno Setup 6 安装到 tools\InnoSetup6）"
}

if (-not $SkipBuild) {
  Write-Host '1/3 编译 WebView2 壳程序…'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-shell.ps1')
  if ($LASTEXITCODE -ne 0) { throw "壳程序编译失败（exit $LASTEXITCODE）" }

  Write-Host '2/3 构建单文件网页…'
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw "前端构建失败（exit $LASTEXITCODE）" }
}

Write-Host '3/3 生成安装包…'
$outDir = Join-Path $root 'packaging\dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

& $iscc "/DAppVersion=$version" (Join-Path $root 'installer\知识星图.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup 编译失败（exit $LASTEXITCODE）" }

$exe = Join-Path $outDir "知识星图-安装包-$version.exe"
if (-not (Test-Path $exe)) { throw "安装包未生成：$exe" }
$size = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host "安装包已生成：$exe（$size MB）"