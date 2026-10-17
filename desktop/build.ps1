<#
.SYNOPSIS
  PSE 全景战略引擎 · Windows 桌面版一键构建 / 出包脚本

.DESCRIPTION
  产出可直接分发的目录（默认 desktop\dist\PSE-Panorama\）：

    PSE-Panorama.exe     Go + WebView2 桌面壳（单文件，约 3~4 MB）
    www\                 纯静态 web 游戏产物：index.html + src\*.js + data\
    README-分发.txt      给最终用户的使用说明

  桌面壳用 CoreWebView2.SetVirtualHostNameToFolderMapping 把 www\ 映射成
  https://panorama.local/（**不是 file://** —— file:// 下 WebView2 的 localStorage
  不可靠，会丢存档）。存档目录固定为 %LOCALAPPDATA%\PSE-Panorama。

  依赖：
    - Go 1.21+（默认找 C:\Go\bin\go.exe，或用 -GoBin 指定）
    - Microsoft Edge WebView2 Runtime（Win10/11 一般随系统已有；缺了脚本会告警）
    - 首次构建需要网络拉 NuGet 之外的 Go 模块（可用 -Goproxy 指定国内代理）

.PARAMETER RepoRoot
  web 游戏仓库根目录（含 index.html）。默认取本脚本所在目录的上一级。

.PARAMETER OutDir
  输出根目录，实际产物在其下的 <Name>\ 子目录。默认 desktop\dist。

.PARAMETER Name
  产物名，默认 PSE-Panorama（决定 exe 文件名与文件夹名）。

.PARAMETER GoBin
  go.exe 路径。默认依次找 $env:GO_BIN、C:\Go\bin\go.exe、PATH 里的 go。

.PARAMETER Goproxy
  GOPROXY 值，默认 https://goproxy.cn,direct（国内镜像；模块已缓存时不联网）。

.PARAMETER NoWww
  不复制 www（只出 exe；适合 www 已在目标机上单独更新的场景）。

.PARAMETER Zip
  额外打一个 PSE-Panorama-win-x64.zip。

.PARAMETER SelfTest
  构建后自动跑一遍冒烟自检：启动 → 自动开局 → 诊断探针（宿主/世界/画布）→
  存档 → 新进程读档比对哈希，全过才返回 0。

.EXAMPLE
  pwsh -File desktop\build.ps1
.EXAMPLE
  pwsh -File desktop\build.ps1 -Zip -Goproxy https://goproxy.cn,direct
.EXAMPLE
  pwsh -File desktop\build.ps1 -SelfTest
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = '',
  [string]$OutDir = '',
  [string]$Name = 'PSE-Panorama',
  [string]$GoBin = '',
  [string]$Goproxy = '',
  [string[]]$WwwExtra = @(),
  [switch]$NoWww,
  [switch]$Zip,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step([string]$msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $scriptDir }
if (-not $OutDir)   { $OutDir   = Join-Path $scriptDir 'dist' }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$OutDir   = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir)
$stage    = Join-Path $OutDir $Name
$wwwDst   = Join-Path $stage 'www'

Say "仓库根目录 : $RepoRoot"
Say "输出目录   : $stage"

# ---------------------------------------------------------------- 1. 环境检查

Step '1/6 环境检查'

$go = ''
foreach ($cand in @($GoBin, $env:GO_BIN, 'C:\Go\bin\go.exe')) {
  if ($cand -and (Test-Path -LiteralPath $cand)) { $go = (Resolve-Path -LiteralPath $cand).Path; break }
}
if (-not $go) {
  $cmd = Get-Command go -ErrorAction SilentlyContinue
  if ($cmd) { $go = $cmd.Source }
}
if (-not $go) {
  throw "找不到 go.exe。请安装 Go 1.21+，或用 -GoBin 'C:\Go\bin\go.exe' 指定。"
}
Say ("go         : {0}  ({1})" -f $go, (& $go version))

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'index.html'))) {
  throw "在 $RepoRoot 下找不到 index.html —— -RepoRoot 应指向 web 游戏仓库根目录。"
}
Say "index.html : 已找到"

# WebView2 Runtime：从注册表读版本（HKLM 32/64 位 + HKCU）
$wv2Key = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wv2Ver = $null
foreach ($k in @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$wv2Key",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$wv2Key",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$wv2Key")) {
  try {
    $pv = (Get-ItemProperty -Path $k -Name pv -ErrorAction Stop).pv
    if ($pv) { $wv2Ver = $pv; break }
  } catch { }
}
if ($wv2Ver) {
  Say ("WebView2   : 已安装 {0}" -f $wv2Ver)
} else {
  Say 'WebView2   : 未检测到 Runtime —— 目标机需要安装 Microsoft Edge WebView2 Runtime（Evergreen），否则 exe 无法启动。' 'Yellow'
}

$exeSrc = Join-Path $scriptDir 'main.go'
if (-not (Test-Path -LiteralPath $exeSrc)) { throw "找不到 main.go（$exeSrc）" }

# 应用图标 / 清单 / 版本信息：由 go-winres 从 winres\winres.json + app.ico 生成，入库后离线可构建
$sysoPath = Join-Path $scriptDir 'rsrc_windows_amd64.syso'
if (Test-Path -LiteralPath $sysoPath) {
  Say ("应用图标   : 已内嵌 {0}（{1} 字节）" -f (Split-Path -Leaf $sysoPath), (Get-Item -LiteralPath $sysoPath).Length)
} else {
  Say '应用图标   : 缺少 rsrc_windows_amd64.syso —— exe 会退回系统默认图标。' 'Yellow'
  Say '             重新生成：desktop\make-icon.ps1 然后用 go-winres make（见 desktop\README.md「应用图标」）' 'Yellow'
}

# ---------------------------------------------------------------- 2. 模块依赖

Step '2/6 拉取 Go 模块依赖'
# 缺省用国内镜像（goproxy.cn 是 proxy.golang.org 的完整镜像）；模块已在本地缓存时不会联网。
if (-not $Goproxy) { $Goproxy = 'https://goproxy.cn,direct' }
Say "GOPROXY    : $Goproxy"
$env:GOPROXY = $Goproxy
$env:GOFLAGS = ''
Push-Location $scriptDir
try {
  & $go mod download 2>&1 | ForEach-Object { Say "  $_" 'DarkGray' }
  if ($LASTEXITCODE -ne 0) {
    throw "go mod download 失败（退出码 $LASTEXITCODE）。离线时请先联网，或加 -Goproxy https://goproxy.cn,direct 指定可用镜像。"
  }
  Say '依赖就绪'

  # -------------------------------------------------------------- 3. 编译 exe

  Step '3/6 编译桌面壳（go build -trimpath -buildvcs=false -ldflags "-s -w"）'
  if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  $exePath = Join-Path $stage "$Name.exe"
  $env:CGO_ENABLED = '0'
  $env:GOOS = 'windows'
  $env:GOARCH = 'amd64'
  # -buildvcs=false：不把 git 提交号/脏标记写进二进制，同一份源码永远产出同一个 exe（可复现）
  & $go build -trimpath -buildvcs=false -ldflags '-s -w' -o $exePath .
  if ($LASTEXITCODE -ne 0) { throw "go build 失败（退出码 $LASTEXITCODE）" }
} finally {
  Pop-Location
}

# ---------------------------------------------------------------- 4. 复制 www

Step '4/6 组装 www 资源目录'
if (-not $NoWww) {
  $excludeExt = @('.ts', '.tsbuildinfo', '.map', '.md')
  $copied = 0; $bytes = 0

  function Copy-Tree([string]$srcDir, [string]$dstDir, [string[]]$skip) {
    if (-not (Test-Path -LiteralPath $srcDir)) { return }
    Get-ChildItem -LiteralPath $srcDir -Recurse -File | ForEach-Object {
      if ($skip -contains $_.Extension.ToLower()) { return }
      if ($_.FullName -match '\\node_modules\\') { return }
      $rel = $_.FullName.Substring($srcDir.Length).TrimStart('\', '/')
      $dst = Join-Path $dstDir $rel
      $parent = Split-Path -Parent $dst
      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
      Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
      $script:copied++
      $script:bytes += $_.Length
    }
  }

  New-Item -ItemType Directory -Force -Path $wwwDst | Out-Null
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'index.html') -Destination (Join-Path $wwwDst 'index.html') -Force
  $copied++; $bytes += (Get-Item -LiteralPath (Join-Path $RepoRoot 'index.html')).Length
  Copy-Tree (Join-Path $RepoRoot 'src')  (Join-Path $wwwDst 'src')  $excludeExt
  Copy-Tree (Join-Path $RepoRoot 'data') (Join-Path $wwwDst 'data') $excludeExt
  foreach ($extra in $WwwExtra) { Copy-Tree (Join-Path $RepoRoot $extra) (Join-Path $wwwDst $extra) $excludeExt }
  Say ("www        : {0} 个文件, {1:N2} MB" -f $copied, ($bytes / 1MB))
} else {
  Say 'www        : 已跳过（-NoWww）'
}

# ---------------------------------------------------------------- 5. 分发说明

Step '5/6 写分发说明'
$readme = Join-Path $stage 'README-分发.txt'
@"
PSE 全景战略引擎 · Windows 桌面版
==================================

怎么用
------
双击 $Name.exe 即可。不用装浏览器、不用起服务器、不用联网。

存档在哪
--------
%LOCALAPPDATA%\$Name
  ├─ EBWebView\         WebView2 用户数据（游戏存档就在里面）
  └─ window-state.json  窗口位置/大小记忆
删掉这个目录 = 清空存档与设置（等于全新开始）。

从双击到页面加载完成约 2.6~2.8 秒（主要是 WebView2 运行时初始化 + 地图数据解析，
本机实测冷启动 2744ms、热启动 2600/2612/2623ms），随后进入游戏。

快捷键
------
F11       窗口全屏 / 退出全屏（桌面壳提供，窗口位置大小会被记住）
F         游戏内地图全屏（桌面壳不拦截，透传给游戏）
Shift+F   游戏内面板全屏
Esc       退出游戏内面板全屏
鼠标右键   游戏内下达命令（桌面壳已禁用 WebView2 默认右键菜单）
再次双击 exe 不会开第二个窗口，而是把已有窗口切到前台（单实例）。

文件说明
--------
$Name.exe      桌面壳（Go + WebView2；虚拟主机 https://panorama.local/ 指向 www\）
www\           web 游戏产物（index.html + src\*.js + data\），可直接替换升级游戏内容
本文件          你正在看的说明

运行要求
--------
Windows 10 1809 (x64) 或更高；需要 Microsoft Edge WebView2 Runtime
（Win11 自带，Win10 通常已随 Edge 安装；缺失时到 https://developer.microsoft.com/microsoft-edge/webview2/ 下载 Evergreen 版）。

"@ | Set-Content -LiteralPath $readme -Encoding UTF8
Say "说明文件   : $readme"

# ---------------------------------------------------------------- 6. 汇总 / 自检

Step '6/6 汇总'
$exeInfo = Get-Item -LiteralPath $exePath
$wwwSize = 0; $wwwCount = 0
if (Test-Path -LiteralPath $wwwDst) {
  $f = Get-ChildItem -LiteralPath $wwwDst -Recurse -File
  $wwwCount = $f.Count; $wwwSize = ($f | Measure-Object -Property Length -Sum).Sum
}
$totalSize = (Get-ChildItem -LiteralPath $stage -Recurse -File | Measure-Object -Property Length -Sum).Sum
Say ("exe        : {0}  ({1:N2} MB)" -f $exePath, ($exeInfo.Length / 1MB)) 'Green'
Say ("www        : {0} 个文件 {1:N2} MB" -f $wwwCount, ($wwwSize / 1MB))
Say ("产物总计   : {0:N2} MB" -f ($totalSize / 1MB))
Say ("绝对路径   : {0}" -f $stage) 'Green'

if ($Zip) {
  # 先压到临时目录再搬回 OutDir：zip 直接写在被打包的目录里会被自己占用。
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zipPath = Join-Path $OutDir ("{0}-win-x64.zip" -f $Name)
  $zipTmp = Join-Path $env:TEMP ("{0}-{1}.zip" -f $Name, [guid]::NewGuid().ToString('N').Substring(0, 8))
  [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipTmp, [System.IO.Compression.CompressionLevel]::Optimal, $true)
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  Move-Item -LiteralPath $zipTmp -Destination $zipPath -Force
  Say ("zip        : {0} ({1:N2} MB)" -f $zipPath, ((Get-Item -LiteralPath $zipPath).Length / 1MB)) 'Green'
}

if ($SelfTest) {
  Step '自检（启动 → 自动开局 → 探针 → 存档 → 新进程读档）'
  # 自检用独立的用户数据目录，不碰真实存档
  $env:LOCALAPPDATA = Join-Path $env:TEMP ("pse-selftest-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $wwwRoot = Join-Path $stage 'www'

  # 注意：桌面壳把日志写到 stderr，$ErrorActionPreference='Stop' 会把原生命令的
  # stderr 当成终止性错误，所以这里临时放宽并把每条输出转成字符串。
  function Invoke-Shell([string[]]$argList) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $out = & $exePath @argList 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match 'PSE-DESKTOP' }
    } finally { $ErrorActionPreference = $prev }
    return ($out -join "`n")
  }

  # --pse-offscreen：自检的窗口也放到屏幕外，用户不会看到一闪而过的窗口
  $probeText = Invoke-Shell @('--pse-root', $wwwRoot, '--pse-query', 'auto=GER&speed=3', '--pse-probe', '--pse-offscreen', '--pse-exit')
  $hostOk = $probeText -match '"host":true'
  $worldOk = $probeText -match '"world":true'
  $ok1 = $hostOk -and $worldOk
  Say ("  探针  : 宿主注入={0} 世界已开局={1} 虚拟主机={2}" -f $hostOk, $worldOk, ($probeText -match 'panorama\.local')) $(if ($ok1) { 'Green' } else { 'Red' })

  $saveText = Invoke-Shell @('--pse-root', $wwwRoot, '--pse-query', 'auto=GER&speed=3', '--pse-save', 'pse_selftest', '--pse-offscreen', '--pse-exit')
  $hash1 = [regex]::Match($saveText, '"hash":(\d+)').Groups[1].Value

  $loadText = Invoke-Shell @('--pse-root', $wwwRoot, '--pse-load', 'pse_selftest', '--pse-offscreen', '--pse-exit')
  $hash2 = [regex]::Match($loadText, '"hash":(\d+)').Groups[1].Value
  $ok2 = ($hash1 -ne '') -and ($hash1 -eq $hash2)
  $verdict = '不一致 ✗'
  if ($ok2) { $verdict = '一致 ✓' }
  Say ("  存档  : 进程A写入哈希 {0} → 进程B读回哈希 {1} → {2}" -f $hash1, $hash2, $verdict) $(if ($ok2) { 'Green' } else { 'Red' })

  if (-not ($ok1 -and $ok2)) {
    Say '  最近日志：' 'DarkGray'
    Say $probeText 'DarkGray'
    throw '自检失败：桌面壳未通过启动/存档验证。'
  }
  Say '  自检通过（桌面壳能启动、能注入宿主、能开局、存档可跨进程保留）' 'Green'
  Remove-Item -LiteralPath $env:LOCALAPPDATA -Recurse -Force -ErrorAction SilentlyContinue
}

Say "`n完成。" 'Green'
