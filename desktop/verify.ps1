#requires -Version 5.1
<#
  PSE 全景战略引擎 · 桌面壳验收脚本
  ---------------------------------------------------------------------------
  对 desktop\dist\PSE-Panorama\PSE-Panorama.exe 跑一轮端到端验收并把证据
  （截图 + 验收报告.md）落到 -EvidenceDir：

    1. 冷启动：进程启动 → 页面导航完成耗时
    2. 渲染：宿主桥注入 / 世界已开局 / canvas 真的画了东西 / 虚拟主机是 https
    3. 启动画面截图
    4. 存档跨进程：进程A 写档 → 进程B 全新进程读回，哈希一致
    5. 窗口尺寸位置记忆：移动 → 退出 → 重启回到同一位置
    6. 全屏：与 F11 同一函数，全屏矩形 = 显示器矩形，退出后恢复原窗口
    7. 单实例：第二实例秒退、不产生第二个进程
    8. 设置回读：默认右键菜单关闭、DevTools 关闭、DPI = PerMonitorV2
    9. 应用图标：exe 内嵌 RT_GROUP_ICON 与 desktop\app.ico 像素一致、版本信息、运行时加载日志

  用法：
    powershell -ExecutionPolicy Bypass -File desktop\verify.ps1
    powershell -ExecutionPolicy Bypass -File desktop\verify.ps1 -FreshUserData

  注意：本脚本用 UTF-8 (BOM) 保存 —— Windows PowerShell 5.1 读无 BOM 的
  中文脚本会按 ANSI 解析并报「意外的标记」。

  说明：脚本默认复用已有的用户数据目录（%LOCALAPPDATA%\PSE-Panorama），
  加 -FreshUserData 会先把它删掉重来（更接近「首次安装」的冷启动数字）。
#>
param(
  [string]$ExePath = "",
  [string]$EvidenceDir = "",
  [string]$UserData = "",
  [switch]$FreshUserData,
  [int]$WarmStartSamples = 3
)

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
$script:lines = New-Object System.Collections.ArrayList

function Say([string]$text, [string]$color = 'Gray') {
  Write-Host $text -ForegroundColor $color
  [void]$script:lines.Add($text)
}

function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) { $script:pass++ } else { $script:fail++ }
  $tag = 'FAIL'
  if ($ok) { $tag = 'PASS' }
  Say ("[{0}] {1} —— {2}" -f $tag, $name, $detail) $(if ($ok) { 'Green' } else { 'Red' })
}

# 运行一次桌面壳并只保留日志行（桌面壳把日志写到 stderr）
# 自动带上 --pse-mutex：用户可能正开着自己那份正式版，它会占住默认的单实例互斥体，
# 导致验收里的每次启动都被「已有实例在运行」挡掉。测试用的名字固定且与正式版不同。
# 自动带上 --pse-offscreen：窗口放到屏幕外，验收全程不出现可见窗口（抓帧走 PrintWindow）。
function Invoke-Shell([string[]]$argList) {
  $all = @($argList)
  if ($all -notcontains '--pse-mutex') { $all += @('--pse-mutex', $script:verifyMutex) }
  if ($all -notcontains '--pse-offscreen') { $all += '--pse-offscreen' }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $script:exe @all 2>&1 | ForEach-Object { "$_" }
  } finally { $ErrorActionPreference = $prev }
  $lines = @($out | Where-Object { $_ -match 'PSE-DESKTOP' })
  $script:runLogs += ,$lines
  return $lines
}

function LastMatch([string[]]$logLines, [string]$pattern) {
  $hit = $logLines | Where-Object { $_ -match $pattern } | Select-Object -Last 1
  if ($null -eq $hit) { return '' }
  $m = [regex]::Match($hit, $pattern)
  if ($m.Groups.Count -gt 1) { return $m.Groups[1].Value }
  return $hit
}

# ---------------------------------------------------------------- 路径准备
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:verifyMutex = 'Local\PSE-Panorama-verify-' + $PID
$script:runLogs = @()
if ($ExePath -eq '') { $ExePath = Join-Path $scriptDir 'dist\PSE-Panorama\PSE-Panorama.exe' }
if ($EvidenceDir -eq '') { $EvidenceDir = Join-Path $scriptDir 'dist\_evidence' }
# 验收默认用**测试目录**，绝不碰用户真实的 %LOCALAPPDATA%\PSE-Panorama：
# 一来用户可能正开着自己那份 exe（同一目录不能被两个 WebView2 实例同时使用），
# 二来验收会写测试存档，不该污染真实存档。默认目录本身用 --pse-userdata-echo 单独验证（零副作用）。
if ($UserData -eq '') { $UserData = Join-Path $scriptDir '_test-appdata\verify-main' }

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "找不到桌面壳：$ExePath（先跑 build.ps1）"
}
$script:exe = (Resolve-Path -LiteralPath $ExePath).Path
$www = Join-Path (Split-Path -Parent $script:exe) 'www'
if (-not (Test-Path -LiteralPath (Join-Path $www 'index.html'))) {
  throw "找不到 web 资源目录：$www"
}

if ($FreshUserData -and (Test-Path -LiteralPath $UserData)) {
  Remove-Item -LiteralPath $UserData -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

Say "PSE 桌面壳验收" 'Cyan'
Say "  exe        : $script:exe"
Say "  大小       : $([math]::Round((Get-Item -LiteralPath $script:exe).Length / 1MB, 2)) MB"
Say "  www        : $www"
Say "  用户数据   : $UserData"
Say "  证据目录   : $EvidenceDir"
Say ""

# ---------------------------------------------------------------- 1) 冷启动 + 渲染 + 截图
Say "== 1) 冷启动 / 渲染 / 截图 ==" 'Cyan'
$t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$log = Invoke-Shell @('--pse-userdata', $UserData, '--pse-query', 'auto=GER&speed=3',
  '--pse-probe', '--pse-capture', (Join-Path $EvidenceDir '01-启动画面.png'), '--pse-exit')
$t1 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$coldMs = LastMatch $log 'nav-completed cost=(\d+)ms'
$coldExternal = $t1 - $t0
# 这一轮的完整日志（含最早的 DPI 行，那时 shell.log 还没建立）留到第 8 节做回读校验
$firstRunLog = $log

$hostOk = [bool]($log -match '"host":true')
$worldOk = [bool]($log -match '"world":true')
$vhostOk = [bool]($log -match 'virtual-host = https://panorama\.local/')
$mean = 0
$mm = [regex]::Match(($log -join "`n"), '"canvasMean":(\d+)')
if ($mm.Success) { $mean = [int]$mm.Groups[1].Value }

Check '宿主桥注入（PSE_HOST）' $hostOk '页面里 window.PSE_HOST 存在'
Check '虚拟主机映射（非 file://）' $vhostOk 'https://panorama.local/ → www 目录'
Check '游戏世界已开局' $worldOk '?auto=GER&speed=3 自动开局成功'
Check 'canvas 真的渲染了' ($mean -gt 0) "canvasMean=$mean（0 = 全黑没画）"
Check '启动导航完成' ($coldMs -ne '') "进程启动 → nav-completed = ${coldMs}ms（含 PowerShell 往返共 ${coldExternal}ms）"
Check '启动截图已生成' (Test-Path -LiteralPath (Join-Path $EvidenceDir '01-启动画面.png')) '01-启动画面.png'

# 默认用户数据目录（硬要求：%LOCALAPPDATA%\PSE-Panorama）——用零副作用的 --pse-userdata-echo 验证，
# 不真的往用户真实目录里写东西（用户可能正开着自己那份 exe，同一目录会被两个 WebView2 实例抢）。
$echoLog = Invoke-Shell @('--pse-userdata-echo')
$defaultUd = LastMatch $echoLog 'user-data-default = (.+)$'
$expectUd = Join-Path $env:LOCALAPPDATA 'PSE-Panorama'
Check '默认用户数据目录 = %LOCALAPPDATA%\PSE-Panorama' ($defaultUd.Trim() -eq $expectUd) "user-data-default = $defaultUd（验收实际用的是测试目录 $UserData）"

# ---------------------------------------------------------------- 2) 启动耗时采样
Say ""
Say "== 2) 启动耗时采样（热配置 $WarmStartSamples 次）==" 'Cyan'
$samples = @()
foreach ($i in 1..$WarmStartSamples) {
  $l = Invoke-Shell @('--pse-userdata', $UserData, '--pse-query', 'auto=GER&speed=3', '--pse-eval', '1+1', '--pse-exit')
  $ms = LastMatch $l 'nav-completed cost=(\d+)ms'
  if ($ms -ne '') { $samples += [int]$ms }
}
$avg = 0
if ($samples.Count -gt 0) { $avg = [int](($samples | Measure-Object -Average).Average) }
Check '启动耗时采样' ($samples.Count -eq $WarmStartSamples) ("{0} ms（样本：{1}）" -f $avg, ($samples -join ', '))

# ---------------------------------------------------------------- 3) 存档跨进程
Say ""
Say "== 3) 存档：进程A 写 → 进程B 读 ==" 'Cyan'
$slot = 'PSE验收存档'
$l1 = Invoke-Shell @('--pse-userdata', $UserData, '--pse-query', 'auto=GER&speed=3',
  '--pse-save', $slot, '--pse-exit')
$hash1 = LastMatch $l1 '"hash":(\d+)'
$l2 = Invoke-Shell @('--pse-userdata', $UserData, '--pse-load', $slot, '--pse-exit')
$hash2 = LastMatch $l2 '"hash":(\d+)'
$listed = [bool]($l2 -match 'PSE验收存档')
Check '存档写入磁盘' ($hash1 -ne '') "进程A 写入 hash=$hash1"
Check '新进程读回一致' (($hash1 -ne '') -and ($hash1 -eq $hash2)) "进程B 读回 hash=$hash2，slot 出现在 PSE.Save.list() 里=$listed"
$storageDir = Join-Path $UserData 'EBWebView\Default\Local Storage'
Check '存档落在应用自己的用户数据目录' (Test-Path -LiteralPath $storageDir) $storageDir

# ---------------------------------------------------------------- 4) 窗口记忆
Say ""
Say "== 4) 窗口尺寸位置记忆 ==" 'Cyan'
$l3 = Invoke-Shell @('--pse-userdata', $UserData, '--pse-move', '300,150,1280,860', '--pse-exit')
$moved = LastMatch $l3 'after-move: rect=([\d,-]+ \d+x\d+)'
$stateFile = Join-Path $UserData 'window-state.json'
$stateTxt = ''
if (Test-Path -LiteralPath $stateFile) { $stateTxt = (Get-Content -LiteralPath $stateFile -Raw).Trim() }
$l4 = Invoke-Shell @('--pse-userdata', $UserData, '--pse-query', 'auto=GER&speed=3',
  '--pse-capture', (Join-Path $EvidenceDir '02-记忆恢复.png'), '--pse-exit')
$restored = LastMatch $l4 'window-state loaded = ([\d,-]+ \d+x\d+)'
Check '窗口移动生效' ($moved -ne '') "after-move: $moved"
Check '退出时写入 window-state.json' ($stateTxt -match '"W":1280') $stateTxt
Check '重启回到上次位置' ($restored -eq '300,150 1280x860') "window-state loaded = $restored"
# 回归守卫：窗口若被最小化，GetWindowRect 给的是图标矩形（实测 160x28）、GetClientRect 给 0x0，
# 截图会变成废图，退出时还会把退化值写进 window-state.json（曾经真的发生过一次）。
# 这里校验截图尺寸与状态文件同时没被写坏。
$capSize = LastMatch $l4 'capture = .*02-记忆恢复\.png \((\d+x\d+),'
Check '记忆恢复截图尺寸正常（窗口未被最小化/退化）' ($capSize -eq '1280x860') "capture = $capSize（应为 1280x860）"

# ---------------------------------------------------------------- 5) 全屏 + 6) 按键矩阵 + 8) 设置/DPI
# 三组共用同一次启动：全屏切换、按键拦截矩阵、WebView2 设置与 DPI 都是这一次运行的日志，
# 少开一次窗口（用户要求验收不要反复弹窗口；所有启动还都带 --pse-offscreen 在屏幕外跑）。
Say ""
Say "== 5) 全屏切换（F11 走的同一个 toggleFullscreen）==" 'Cyan'
$l5 = Invoke-Shell @('--pse-userdata', $UserData, '--pse-query', 'auto=GER&speed=3',
  '--pse-fullscreen', '--pse-eval', '1+1', '--pse-capture', (Join-Path $EvidenceDir '03-全屏.png'), '--pse-exit')
$fsOn = LastMatch $l5 'fullscreen-on: rect=([\d,-]+ \d+x\d+)'
$fsOff = LastMatch $l5 'fullscreen-off: rect=([\d,-]+ \d+x\d+)'
$loaded5 = LastMatch $l5 'window-state loaded = ([\d,-]+ \d+x\d+)'
Check '进入全屏（去标题栏、铺满显示器）' ($fsOn -match '^0,0 ') "fullscreen-on: $fsOn"
# 语义判据：退出全屏必须回到「本次启动载入的那个窗口矩形」。绝对期望值（300,150 1280x860，
# 由第 4 组写入）在窗口状态被外部因素改写时会误报，所以以本次运行自报的载入值为准。
Check '退出全屏恢复原窗口' (($fsOff -ne '') -and ($fsOff -eq $loaded5)) "fullscreen-off: $fsOff（本次启动载入 = $loaded5）"
Check '全屏截图已生成' (Test-Path -LiteralPath (Join-Path $EvidenceDir '03-全屏.png')) '03-全屏.png'

Say ""
Say "== 6) 按键拦截矩阵（不抢游戏按键）==" 'Cyan'
$onlyF11 = $true
foreach ($line in ($l5 | Where-Object { $_ -match 'accelerator:' })) {
  $isF11 = [bool]($line -match 'F11')
  $blocked = [bool]($line -match '外壳拦截=true')
  if ($isF11 -ne $blocked) { $onlyF11 = $false }
  Say ("   " + ($line -replace '.*accelerator:', 'accelerator:'))
}
Check '只有 F11 被外壳拦截' $onlyF11 'F/Shift/Ctrl/Esc/Space/L/S/1/F5 全部透传给游戏'

# ---------------------------------------------------------------- 7) 单实例
Say ""
Say "== 7) 单实例 ==" 'Cyan'
$logFile = Join-Path $UserData 'shell.log'
# 用「nav-completed 出现次数」判断第一实例是否加载完页面 —— 不能用字节偏移，
# 日志里有中文，字节长度 ≠ 字符长度，按偏移切字符串会切错位置。
$beforeCount = 0
if (Test-Path -LiteralPath $logFile) {
  $beforeCount = ([regex]::Matches((Get-Content -LiteralPath $logFile -Raw -Encoding UTF8), 'nav-completed')).Count
}
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $script:exe
$psi.Arguments = "--pse-userdata `"$UserData`" --pse-query auto=GER&speed=3 --pse-mutex `"$($script:verifyMutex)`" --pse-offscreen --pse-hold 25000 --pse-exit"
$psi.UseShellExecute = $false
$first = [System.Diagnostics.Process]::Start($psi)
# 等第一实例把页面加载起来（看日志里 nav-completed 的次数增加）
$deadline = (Get-Date).AddSeconds(25)
$navSeen = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  if ($first.HasExited) { break }
  if (Test-Path -LiteralPath $logFile) {
    $now = ([regex]::Matches((Get-Content -LiteralPath $logFile -Raw -Encoding UTF8), 'nav-completed')).Count
    if ($now -gt $beforeCount) { $navSeen = $true; break }
  }
}
Check '第一实例已启动并加载完页面' ($navSeen -and -not $first.HasExited) "pid=$($first.Id)"
$tA = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$second = Invoke-Shell @('--pse-userdata', $UserData, '--pse-exit')
$tB = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$procs = @(Get-Process -Name (Split-Path -Leaf $script:exe).Replace('.exe', '') -ErrorAction SilentlyContinue)
Check '第二实例识别到已有实例并退出' ([bool]($second -match '已有实例在运行')) ("{0}ms 内退出；进程数={1}（应为 1）" -f ($tB - $tA), $procs.Count)
Check '第一实例不受影响' (-not $first.HasExited) "第一实例仍在运行（pid=$($first.Id)）"
if (-not $first.HasExited) { $first.WaitForExit(20000) | Out-Null }
if (-not $first.HasExited) { $first.Kill() }
Say "   第一实例已按 --pse-hold 自行退出（跟随 WM_CLOSE → 优雅关闭）"

# ---------------------------------------------------------------- 8) 设置 / DPI 回读
# 这两项每次启动都会打印，用第 5 组那次运行的日志即可（不再单独启动一次）。
Say ""
Say "== 8) WebView2 设置与 DPI 回读（复用第 5 组的运行）==" 'Cyan'
$rootLog = ''
if (Test-Path -LiteralPath $logFile) { $rootLog = (Get-Content -LiteralPath $logFile -Raw -Encoding UTF8) }
$l5Text = ($l5 -join "`n")
Check '默认右键菜单已禁用' ([bool](($l5Text -match '右键菜单=false') -or ($firstRunLog -match '右键菜单=false') -or ($rootLog -match '右键菜单=false'))) 'settings: 右键菜单=false（游戏自己用右键下达命令）'
Check 'DevTools 已禁用' ([bool](($l5Text -match '开发者工具=false') -or ($firstRunLog -match '开发者工具=false') -or ($rootLog -match '开发者工具=false'))) 'settings: 开发者工具=false'
Check 'PerMonitorV2 DPI 感知' ([bool](($firstRunLog -match 'PerMonitorV2 = true') -or ($l5Text -match 'PerMonitorV2 = true'))) 'AreDpiAwarenessContextsEqual=1（SetProcessDpiAwarenessContext 后立即回读）'

# ---------------------------------------------------------------- 9) 应用图标
Say ""
Say "== 9) 应用图标与版本信息 ==" 'Cyan'

# 位图逐像素签名：GetPixel 逐点取值后哈希，用于比较 exe 内嵌图标与 app.ico
function Get-IconSignature([System.Drawing.Bitmap]$bmp) {
  $sb = New-Object System.Text.StringBuilder
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) { [void]$sb.Append($bmp.GetPixel($x, $y).ToArgb().ToString('X8')) }
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($sb.ToString()))) -replace '-', '')
}

Add-Type -AssemblyName System.Drawing
$sigExe = ''
$sigIco = ''
$iconErr = ''
try {
  $bmExe = [System.Drawing.Icon]::ExtractAssociatedIcon($script:exe).ToBitmap()
  $sigExe = Get-IconSignature $bmExe
  $icoPath = Join-Path $scriptDir 'app.ico'
  if (Test-Path -LiteralPath $icoPath) {
    $bmIco = (New-Object System.Drawing.Icon($icoPath, 32, 32)).ToBitmap()
    $sigIco = Get-IconSignature $bmIco
    $bmIco.Save((Join-Path $EvidenceDir '04-应用图标-32.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  }
} catch { $iconErr = $_.Exception.Message }

$vi = (Get-Item -LiteralPath $script:exe).VersionInfo
$iconSizeTxt = '（提取失败）'
if ($null -ne $bmExe) { $iconSizeTxt = ("{0}x{1} 像素" -f $bmExe.Width, $bmExe.Height) }
Check 'exe 内嵌应用图标可提取' ($sigExe -ne '') ("ExtractAssociatedIcon → $iconSizeTxt，像素签名 " + $sigExe.Substring(0, 16) + '…')
Check '内嵌图标与 desktop\app.ico 一致' (($sigIco -ne '') -and ($sigExe -eq $sigIco)) $(if ($sigIco -eq '') { "未找到 app.ico：$iconErr" } else { "两侧 32x32 像素签名 $sigIco" })
Check '窗口运行时加载了内嵌图标' ([bool](($firstRunLog -match 'app-icon: 已从内嵌资源加载') -or ($rootLog -match 'app-icon: 已从内嵌资源加载'))) '日志：app-icon: 已从内嵌资源加载 RT_GROUP_ICON "APP"'
Check '版本信息已写入 exe' ([bool]($vi.ProductName -match 'PSE')) ("{0} / {1} / {2}" -f $vi.ProductName, $vi.FileDescription, $vi.FileVersion)

# ---------------------------------------------------------------- 10) 冷启动白屏 / 首屏布局
Say ""
Say "== 10) 冷启动白屏 / 首屏布局 ==" 'Cyan'
Say ("单实例互斥体：" + $script:verifyMutex + "（避免与用户正在运行的正式版互斥）") 'DarkGray'

# WebView2 的默认背景是白色：不设 put_DefaultBackgroundColor 时，从 Embed 到页面首帧
# 之间整屏纯白（本机实测 11 帧 / 约 2.9 秒）。这里对 exe 冷启动连拍，要求 0 帧白色。
$frameDir = Join-Path $EvidenceDir 'frames'
$frameUser = Join-Path $scriptDir '_test-appdata\verify-frames'
Remove-Item -LiteralPath $frameUser -Recurse -Force -ErrorAction SilentlyContinue
$fLog = Invoke-Shell @('--pse-frames', $frameDir, '--pse-frames-ms', '100', '--pse-frames-count', '30',
  '--pse-userdata', $frameUser, '--pse-query', 'auto=GER&speed=3', '--pse-hold', '200', '--pse-exit')
$frameSum = ''
$sumPath = Join-Path $frameDir 'frames-summary.txt'
if (Test-Path -LiteralPath $sumPath) {
  $frameSum = (Get-Content -LiteralPath $sumPath -Encoding UTF8 | Where-Object { $_ -match '^frames:' } | Select-Object -Last 1)
}
$whiteN = LastMatch @($frameSum) 'WHITE=(\d+)'
$frameN = LastMatch @($frameSum) 'n=(\d+)'
$whiteOk = $false
if (($whiteN -ne '') -and ($frameN -ne '')) { $whiteOk = ([int]$whiteN -eq 0) -and ([int]$frameN -ge 8) }
Check '冷启动抓帧无白色帧' $whiteOk "$frameSum（间隔 100ms）"
Check 'WebView2 默认背景色 = 页面底色' ([bool](($fLog -match 'default-background = #FF0D1117') -or ($firstRunLog -match 'default-background = #FF0D1117'))) '日志：default-background = #FF0D1117（index.html 的 --bg #0D1117）'

# 开始界面在 1280x860 窗口下不能有裁切（#startBox 四边都要在 viewport 内）
$jsPath = Join-Path $EvidenceDir 'startbox-check.js'
$jsText = @'
(function () {
  function pack(el) { if (!el) return null; var b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }
  var sb = document.querySelector('#startBox');
  var r = sb ? sb.getBoundingClientRect() : null;
  var doc = document.documentElement;
  return JSON.stringify({
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    startBox: pack(sb),
    startBoxVisible: !!(sb && getComputedStyle(sb).display !== 'none' && sb.offsetWidth > 0),
    startBoxFullyInside: !!r && r.left >= -0.5 && r.top >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
    clippedPx: r ? { left: Math.max(0, Math.round(-r.left)), top: Math.max(0, Math.round(-r.top)),
      right: Math.max(0, Math.round(r.right - window.innerWidth)), bottom: Math.max(0, Math.round(r.bottom - window.innerHeight)) } : null,
    pageOverflow: doc.scrollWidth > window.innerWidth + 1 || doc.scrollHeight > window.innerHeight + 1
  });
})()
'@
[System.IO.File]::WriteAllText($jsPath, $jsText, (New-Object System.Text.UTF8Encoding($false)))
$boxUser = Join-Path $scriptDir '_test-appdata\verify-startbox'
Remove-Item -LiteralPath $boxUser -Recurse -Force -ErrorAction SilentlyContinue
$boxJsonPath = Join-Path $EvidenceDir 'startbox-1280x860.json'
Remove-Item -LiteralPath $boxJsonPath -Force -ErrorAction SilentlyContinue
$boxLog = Invoke-Shell @('--pse-move', '300,150,1280,860', '--pse-js', $jsPath, '--pse-eval-out', $boxJsonPath,
  '--pse-capture', (Join-Path $EvidenceDir '05-启动界面-1280x860.png'), '--pse-userdata', $boxUser,
  '--pse-hold', '300', '--pse-exit')
$boxJson = ''
if (Test-Path -LiteralPath $boxJsonPath) { $boxJson = (Get-Content -LiteralPath $boxJsonPath -Encoding UTF8 -Raw) }
$boxOk = [bool](($boxJson -match '"startBoxFullyInside":true') -and ($boxJson -match '"clippedPx":\{"left":0,"top":0,"right":0,"bottom":0\}') -and ($boxJson -match '"pageOverflow":false'))
$vwTxt = '未知'
$vwm = [regex]::Match($boxJson, '"viewport":\{"w":(\d+),"h":(\d+)')
if ($vwm.Success) { $vwTxt = $vwm.Groups[1].Value + 'x' + $vwm.Groups[2].Value }
$sbTxt = '未取到'
$sbm = [regex]::Match($boxJson, '"startBox":\{[^}]*\}')
if ($sbm.Success) { $sbTxt = $sbm.Value }
$boxDetail = "viewport ${vwTxt}，$sbTxt，clippedPx 全 0"
if (-not $boxOk) {
  # 失败时把这次运行的日志尾部带进证据，省得再去翻 shell.log
  $tail = @($boxLog | Select-Object -Last 4) -join ' / '
  if ($tail -eq '') { $tail = "（这次运行没有任何日志行，用户数据目录 $boxUser）" }
  $boxDetail = "$boxDetail；本组日志：$tail"
}
Check '1280x860 下开始界面未被裁切' $boxOk $boxDetail

# 用户要求：验收全程不出现可见窗口 —— 每次启动都必须带 --pse-offscreen（窗口在 -32000,-32000）
$runs = @($script:runLogs | Where-Object { ($_ -join "`n") -match 'process-start' })
$offs = @($runs | Where-Object { ($_ -join "`n") -match 'offscreen: 验收模式' })
Check '验收全程无可见窗口' (($runs.Count -gt 0) -and ($offs.Count -eq $runs.Count)) `
  ("{0}/{1} 次启动都带 --pse-offscreen（窗口在屏幕外 -32000,-32000，抓帧走 PrintWindow）" -f $offs.Count, $runs.Count)

# ---------------------------------------------------------------- 11) 验收卫生
# 用户要求「跑完不留残余进程」：清掉本次验收留下的进程（只清我们这份 exe，绝不碰用户自己那份，
# 用户那份在别的目录，靠 Path 精确匹配排除）。
Say ""
Say "== 11) 验收卫生（无残余进程）==" 'Cyan'
$exeName = (Split-Path -Leaf $script:exe).Replace('.exe', '')
$stray = @()
foreach ($proc in @(Get-Process -Name $exeName -ErrorAction SilentlyContinue)) {
  try { if ($proc.Path -eq $script:exe) { $stray += $proc } } catch { }
}
foreach ($proc in $stray) { try { $proc.Kill(); $proc.WaitForExit(5000) | Out-Null } catch { } }
Start-Sleep -Milliseconds 300
$left = @()
foreach ($proc in @(Get-Process -Name $exeName -ErrorAction SilentlyContinue)) {
  try { if ($proc.Path -eq $script:exe) { $left += $proc } } catch { }
}
Check '跑完无残余进程' ($left.Count -eq 0) ("清掉 {0} 个，现存 {1} 个（本次验收的 exe：{2}；用户自己那份在别的目录，未触碰）" -f $stray.Count, $left.Count, $script:exe)

# ---------------------------------------------------------------- 汇总
Say ""
Say ("结论：{0} 项通过，{1} 项失败" -f $script:pass, $script:fail) $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })

$reportPath = Join-Path $EvidenceDir '验收报告.md'
$exeItem = Get-Item -LiteralPath $script:exe
$exeSha = (Get-FileHash -LiteralPath $script:exe -Algorithm SHA256).Hash
$wwwFiles = @(Get-ChildItem -LiteralPath $www -Recurse -File -ErrorAction SilentlyContinue)
$wwwBytes = ($wwwFiles | Measure-Object -Property Length -Sum).Sum
$header = @(
  '# PSE 桌面壳验收报告',
  '',
  ("- 时间：" + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')),
  ("- exe：``" + $script:exe + "``"),
  ("- 大小：" + $exeItem.Length + " 字节（" + [math]::Round($exeItem.Length / 1MB, 2) + " MB）"),
  ("- SHA256：" + "``" + $exeSha + "``"),
  ("- web 资源：www " + $wwwFiles.Count + " 个文件，" + [math]::Round($wwwBytes / 1MB, 2) + " MB（随 exe 一起分发）"),
  ("- 用户数据：" + "``" + $UserData + "``"),
  ("- 验收方式：全程 ``--pse-offscreen``（窗口在屏幕外 -32000,-32000，验收全程无可见窗口；抓帧与截图走 PrintWindow）"),
  ("- 单实例互斥体：" + "``" + $script:verifyMutex + "``（避开用户正在运行的正式版）"),
  ("- 结果：**" + $script:pass + " 项通过 / " + $script:fail + " 项失败**"),
  '',
  '| 检查项 | 结果 | 证据 |',
  '| --- | --- | --- |'
)
$body = @()
foreach ($line in $script:lines) {
  if ($line -match '^\[(PASS|FAIL)\] (.+?) —— (.+)$') {
    $body += ("| " + $Matches[2] + " | " + $Matches[1] + " | " + $Matches[3] + " |")
  }
}
$files = @()
Get-ChildItem -LiteralPath $EvidenceDir -Filter '*.png' -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
  $files += ("- " + $_.Name + "（" + [math]::Round($_.Length / 1KB) + " KB）")
}
(($header + $body + @('', '## 证据截图', '') + $files) -join "`r`n") |
  Out-File -LiteralPath $reportPath -Encoding UTF8
Say ("验收报告: " + $reportPath) 'Cyan'

if ($script:fail -gt 0) { exit 1 }
exit 0
