# 生成 Windows 应用图标 desktop\app.ico
#
# 图案与 Android 版同源（android/app/src/main/res/drawable/splash_logo.xml）：
# 深蓝底 + 金色地球（经纬网 / 赤道 / 南北回归线）+ 指北星。
# 用法：powershell -ExecutionPolicy Bypass -File desktop\make-icon.ps1
#
# 输出：desktop\app.ico（16/24/32/48/64/128/256，PNG 压缩条目；Win10+ Shell 支持）
#       可选 -PngPreview <path> 顺带导出一张 256 的 PNG 便于肉眼检查。

[CmdletBinding()]
param(
  [string]$Out = '',
  [string]$PngPreview = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $scriptDir 'app.ico' }

$GOLD = [System.Drawing.Color]::FromArgb(255, 232, 194, 104)   # #E8C268
$TOP  = [System.Drawing.Color]::FromArgb(255, 22, 40, 58)      # #16283A
$BOT  = [System.Drawing.Color]::FromArgb(255, 7, 11, 16)       # #070B10

# 用 108x108 的设计坐标（与 splash_logo.xml 一致），乘 $s 缩放到实际像素
function New-IconBitmap([int]$size) {
  $s = $size / 108.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # --- 背景：圆角矩形 + 竖向渐变 ---
  $pad = 1.0 * $s
  $rect = New-Object System.Drawing.RectangleF($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $radius = 22.0 * $s
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
  $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
  $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
  $path.CloseFigure()
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $TOP, $BOT, 90.0)
  $g.FillPath($bg, $path)
  $bg.Dispose()

  # --- 金色笔宽（小尺寸下至少 1px，否则经纬线会消失）---
  function Pen([double]$designWidth) {
    $w = $designWidth * $s
    if ($w -lt 1.0) { $w = 1.0 }
    $p = New-Object System.Drawing.Pen($GOLD, $w)
    $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $p.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    return $p
  }

  # --- 指北星（四角光芒）---
  $star = @(
    @(54.0, 4.0), @(57.0, 15.0), @(68.0, 18.0), @(57.0, 21.0),
    @(54.0, 32.0), @(51.0, 21.0), @(40.0, 18.0), @(51.0, 15.0)
  )
  $pts = New-Object 'System.Drawing.PointF[]' $star.Count
  for ($i = 0; $i -lt $star.Count; $i++) {
    $pts[$i] = New-Object System.Drawing.PointF(($star[$i][0] * $s), ($star[$i][1] * $s))
  }
  $starBrush = New-Object System.Drawing.SolidBrush($GOLD)
  $g.FillPolygon($starBrush, $pts)
  $starBrush.Dispose()

  # --- 地球外圈 ---
  $penOuter = Pen 3.0
  $cx = 54.0 * $s; $cy = 54.0 * $s; $rr = 32.0 * $s
  $g.DrawEllipse($penOuter, ($cx - $rr), ($cy - $rr), (2 * $rr), (2 * $rr))
  $penOuter.Dispose()

  # --- 本初子午线（竖直椭圆）---
  $penMid = Pen 1.6
  $g.DrawEllipse($penMid, (40.0 * $s), (22.0 * $s), (28.0 * $s), (64.0 * $s))
  $penMid.Dispose()

  # --- 赤道 ---
  $penEq = Pen 1.6
  $g.DrawLine($penEq, (22.5 * $s), (54.0 * $s), (85.5 * $s), (54.0 * $s))
  $penEq.Dispose()

  # --- 南北回归线（0.75 透明度）---
  $penTr = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, $GOLD), ([Math]::Max(1.0, 1.2 * $s)))
  $g.DrawLine($penTr, (30.0 * $s), (40.0 * $s), (78.0 * $s), (40.0 * $s))
  $g.DrawLine($penTr, (30.0 * $s), (68.0 * $s), (78.0 * $s), (68.0 * $s))
  $penTr.Dispose()

  $path.Dispose()
  $g.Dispose()
  return $bmp
}

# 把 32bpp 位图转成 ICO 用的 DIB 条目（BITMAPINFOHEADER + BGRA 自下而上 + AND 掩码）。
# 小尺寸必须用 DIB：.NET System.Drawing.Icon / 老 GDI 读不了 PNG 压缩的条目。
function ConvertTo-DibBytes([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $xorSize = $w * $h * 4
  $andRow = [int]([Math]::Floor(($w + 31) / 32) * 4)
  $andSize = $andRow * $h
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt32]40)                      # biSize
  $bw.Write([Int32]$w)                       # biWidth
  $bw.Write([Int32]($h * 2))                 # biHeight = XOR + AND
  $bw.Write([UInt16]1)                       # biPlanes
  $bw.Write([UInt16]32)                      # biBitCount
  $bw.Write([UInt32]0)                       # biCompression = BI_RGB
  $bw.Write([UInt32]($xorSize + $andSize))   # biSizeImage
  $bw.Write([Int32]0); $bw.Write([Int32]0)   # 分辨率
  $bw.Write([UInt32]0); $bw.Write([UInt32]0) # 调色板
  for ($y = $h - 1; $y -ge 0; $y--) {        # 自下而上
    for ($x = 0; $x -lt $w; $x++) {
      $c = $bmp.GetPixel($x, $y)
      $bw.Write([Byte]$c.B); $bw.Write([Byte]$c.G); $bw.Write([Byte]$c.R); $bw.Write([Byte]$c.A)
    }
  }
  $bw.Write((New-Object byte[] $andSize))    # AND 掩码全 0：不透明信息由 alpha 决定
  $bw.Flush()
  $out = $ms.ToArray()
  $bw.Dispose(); $ms.Dispose()
  return , $out
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()
foreach ($sz in $sizes) {
  $bmp = New-IconBitmap $sz
  if ($PngPreview -and $sz -eq 256) { $bmp.Save($PngPreview, [System.Drawing.Imaging.ImageFormat]::Png) }
  if ($sz -le 64) {
    $entries += , @{ size = $sz; kind = 'DIB'; bytes = (ConvertTo-DibBytes $bmp) }
  } else {
    # 128/256 用 PNG 条目（Vista+ Shell 支持，体积远小于原始位图）
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $entries += , @{ size = $sz; kind = 'PNG'; bytes = $ms.ToArray() }
    $ms.Dispose()
  }
  $bmp.Dispose()
}

# --- 组装 ICO：ICONDIR + N × ICONDIRENTRY + 各条目数据（≤64 为 DIB，128/256 为 PNG）---
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type = 1 (icon)
$bw.Write([UInt16]$entries.Count)    # count
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
  $dim = $e.size
  if ($dim -ge 256) { $dim = 0 }     # 256 在 ICO 里记作 0
  $bw.Write([Byte]$dim)              # width
  $bw.Write([Byte]$dim)              # height
  $bw.Write([Byte]0)                 # palette
  $bw.Write([Byte]0)                 # reserved
  $bw.Write([UInt16]1)               # planes
  $bw.Write([UInt16]32)              # bpp
  $bw.Write([UInt32]$e.bytes.Length) # bytes in resource
  $bw.Write([UInt32]$offset)         # offset
  $offset += $e.bytes.Length
}
foreach ($e in $entries) { $bw.Write($e.bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($Out, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

Write-Host ("app.ico: {0}（{1} 个尺寸：{2}，共 {3} 字节）" -f $Out, $entries.Count, ($sizes -join '/'), (Get-Item -LiteralPath $Out).Length) -ForegroundColor Green
if ($PngPreview) { Write-Host ("PNG 预览: {0}" -f $PngPreview) -ForegroundColor Green }
