# PSE 全景战略引擎 · Windows 桌面版（Go + WebView2 壳）

把仓库里的纯静态 web 游戏（`index.html` + `src/*.js` + `data/`）包成一个**双击就能玩**的 Windows 桌面程序。
桌面壳只消费 web 产物，**不改一行游戏代码**（web 版、PWA、Android 版行为完全不受影响）。

```
desktop\
  main.go           桌面壳全部源码（Win32 窗口 + WebView2 + 测试钩子）
  go.mod / go.sum   Go 模块（唯一第三方依赖 github.com/jchv/go-webview2）
  winres\winres.json 图标 / 应用清单(PerMonitorV2) / 版本信息 的 go-winres 配置
  app.ico           应用图标（7 个尺寸，由 make-icon.ps1 生成，与 Android 版同源）
  make-icon.ps1     重新生成 app.ico（GDI+ 画金色地球 + 指北星）
  rsrc_windows_amd64.syso  内嵌资源（go-winres 产物，入库＝离线可构建）
  build.ps1         一键构建 / 出包（含可选自检）
  verify.ps1        端到端验收：9 组 27 项，产出报告 + 截图
  dist\             构建产物（已 gitignore，不入库）
```

## 1. 快速开始

```powershell
# 构建（默认输出 desktop\dist\PSE-Panorama\）
powershell -ExecutionPolicy Bypass -File desktop\build.ps1

# 出 zip 包（给最终用户分发用）
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -Zip

# 构建 + 冒烟自检（启动→自动开局→探针→存档→新进程读档比对哈希）
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -SelfTest

# 跑完整验收（9 组 27 项，产出桌面截图与《验收报告.md》）
powershell -ExecutionPolicy Bypass -File desktop\verify.ps1 -FreshUserData
```

直接玩：

```
desktop\dist\PSE-Panorama\PSE-Panorama.exe
```

## 2. 产物与分发形态

| 路径 | 说明 |
|---|---|
| `desktop\dist\PSE-Panorama\PSE-Panorama.exe` | 单文件 exe，**3.56 MB**（3 732 992 字节；Go 静态链接，不需要 .NET / 不需要装 Go） |
| `desktop\dist\PSE-Panorama\www\` | web 游戏产物 16 个文件 **1.26 MB**（`index.html` + `src\*.js` + `data\`） |
| `desktop\dist\PSE-Panorama\README-分发.txt` | 给最终用户看的说明（存档位置、快捷键、右键） |
| `desktop\dist\PSE-Panorama-win-x64.zip` | 上面三者打成一个 zip，**1.83 MB**（1 915 587 字节） |
| `desktop\dist\_evidence\` | 验收截图与报告（`01-启动画面.png` / `02-记忆恢复.png` / `03-全屏.png` / `04-应用图标-32.png` / `验收报告.md`） |

**分发形态＝ exe + www 目录一起给**（解压即用，共 4.83 MB）。不做单文件内嵌：网页资源留在外面，改游戏内容只要替换 `www\`，不用重新编译 exe。

运行要求：Windows 10 1809 x64 及以上 + **Microsoft Edge WebView2 Runtime**（Win11 自带，Win10 一般随 Edge 装好）。缺失时 `build.ps1` 会告警，用户到微软官网装 Evergreen 版即可。

## 3. 设计要点（为什么这么做）

1. **不用 `file://`，用虚拟主机映射**
   `CoreWebView2.SetVirtualHostNameToFolderMapping("panorama.local", <www 绝对路径>, DenyCors)` 把游戏目录映射成 `https://panorama.local/`。
   原因：`file://` 在 WebView2 下 localStorage 不可靠（源不透明/易失），**会丢存档**；虚拟主机给的是正常 https 源，localStorage 稳定落盘，且**零端口、零防火墙弹窗、零异步竞态**（本游戏零网络请求，纯静态）。
   —— 硬要求，验收里专门有一项检查 `origin === 'https://panorama.local'`。
2. **存档目录独立**
   `UserDataFolder = %LOCALAPPDATA%\PSE-Panorama`，存档随应用走，不和浏览器/其他程序抢用户数据目录。删掉该目录＝清档重置。
3. **不抢游戏按键**
   `AcceleratorKeyCallback` 里只有 **F11**（`0x7B`）返回"已处理"，其余一律透传：`F`（地图全屏）、`Shift+F`（面板全屏）、`Esc`（退面板全屏）、数字键、`L`/`S` 等游戏快捷键原样进游戏。
   同时 `AreDefaultContextMenusEnabled=false` 禁掉 WebView2 默认右键菜单，右键才能被游戏用作下达命令。
4. **不是第二个浏览器窗口**
   `PerMonitorV2` DPI 感知（应用清单声明 `permonitorv2,system`，运行时再调一次 `SetProcessDpiAwarenessContext(-4)` 兜底并回读 `AreDpiAwarenessContextsEqual` 自证；多屏/缩放切换时按 `WM_DPICHANGED` 建议矩形重排）、窗口位置尺寸记忆（`window-state.json`，跨屏越界会 clamp 回可见区）、单实例（`Local\PSE-Panorama-Shell` 互斥体，第二次双击把已有窗口切前台）、自绘 Win32 窗口类不用库默认消息循环（`WM_SIZE`→`Resize()`、`WM_DESTROY`→优雅关闭）。
5. **应用图标与游戏同源**
   `app.ico` 由 `make-icon.ps1` 用 GDI+ 画出来（深蓝底 + 金色地球 + 指北星），坐标直接取 Android 版 `android/app/src/main/res/drawable/splash_logo.xml` 的 108×108 设计图；`go-winres` 把它连同 PerMonitorV2 清单、版本信息一起编进 `rsrc_windows_amd64.syso`，窗口类 `HIcon/HIconSm` + `WM_SETICON` 用的是**同一份**内嵌资源，所以 exe 文件图标、标题栏、任务栏、Alt-Tab 四处一致。

## 4. 宿主桥 `window.PSE_HOST`（与 web 侧的唯一契约）

壳在**导航发生之前**注入（`AddScriptToExecuteOnDocumentCreated`，对当前文档无效，所以顺序不能反）：

```js
window.PSE_HOST = {
  kind: 'webview2', desktop: true,
  version: '0.3.0',
  kv:  { get:, set:, remove:, keys: },   // 基于 localStorage（https 源＝可靠落盘）
  saveFile(name, text, mime),            // 导出下载
  openFile(),                            // 选文件读文本
  notify(title, body), fullscreen(on), openExternal(url)
};
```

web 侧 `src/platform.ts` 只看"有没有 `window.PSE_HOST`"判定桌面（`PSE.Platform.isDesktop()`），所以壳报 `webview2` 也算桌面。**web 版没有宿主时行为不变**（存档回退 localStorage），这是两套 web 测试（146/146 + 27/27）能继续全绿的原因。

## 5. 命令行参数

最终用户只需要双击 exe，不传参。以下参数给自动化/排障用：

| 参数 | 作用 |
|---|---|
| `--pse-root <dir>` | 指定 www 根目录（默认：exe 同级 `www\` → 上级若干层 → 当前目录） |
| `--pse-query <qs>` | 附加到 `index.html` 的查询串，如 `auto=GER&speed=3`（自动开局，跳过开始界面） |
| `--pse-userdata <dir>` | 指定用户数据目录（默认 `%LOCALAPPDATA%\PSE-Panorama`） |
| `--pse-console` | 强制保留控制台窗口（默认：独占控制台＝资源管理器双击启动，会自动隐藏；从 pwsh/cmd 启动则不动你的终端） |
| `--pse-version` | 只打印版本（不初始化 WebView2） |
| `--pse-capture <png>` | 截图整窗后退出（PrintWindow + 桌面 BitBlt 双抓，取内容得分高者） |
| `--pse-grab-canvas <png>` | 导出页面内 canvas 原始像素（诊断渲染用） |
| `--pse-probe` | 打印渲染诊断：宿主/世界/hour/画布尺寸与均值/viewport/bounds |
| `--pse-eval <js>` / `--pse-js <file>` / `--pse-eval-out <file>` | 在页面里求值并把结果回传（复杂表达式用 `--pse-js` 读文件，避免命令行转义） |
| `--pse-save <slot>` / `--pse-load <slot>` | 调 `PSE.Save.save/load` 并回传 `{ok,slot,bytes,hash}` |
| `--pse-move x,y,w,h` | 移动到指定位置/尺寸（验证窗口记忆） |
| `--pse-fullscreen` | 走 F11 回调里同一个 `toggleFullscreen()`（无交互前台时用它做确定性验证） |
| `--pse-input` | 打印按键拦截矩阵 |
| `--pse-hold <ms>` / `--pse-exit` | 保持若干毫秒/到点自动退出 |

诊断日志：`%LOCALAPPDATA%\PSE-Panorama\shell.log`（同时输出到 stderr）。里面 `process-start epoch=` 与 `nav-completed ... epoch=` 是跨进程算启动耗时的依据。

## 6. 验收（9 组 27 项，全部通过）

```powershell
powershell -ExecutionPolicy Bypass -File desktop\verify.ps1 -FreshUserData
# → 结论：27 项通过，0 项失败   （有失败项会 exit 1）
```

| 组 | 检查点 | 实测证据 |
|---|---|---|
| 1 | 宿主桥注入 / 虚拟主机（非 file://）/ 世界已开局 / canvas 真的画了 / 启动截图 | `origin=https://panorama.local`、`canvasMean=50`（0＝全黑）、`01-启动画面.png` |
| 2 | 启动耗时（热配置 3 次采样） | 冷启动 **2644 / 2692 ms**（两次独立全量验收）；热启动采样 **2586~2705 ms**，冷页缓存时首轮可到 5022 ms |
| 3 | 存档：**进程 A 写 → 全新进程 B 读** | A 写 `hash=2968368646` → B 读回同 hash，slot 出现在 `PSE.Save.list()`，落盘位置 `%LOCALAPPDATA%\PSE-Panorama\EBWebView\Default\Local Storage` |
| 4 | 窗口尺寸位置记忆 | `after-move: 300,150 1280x860` → `window-state.json {"X":300,"Y":150,"W":1280,"H":860}` → 重启 `window-state loaded = 300,150 1280x860` |
| 5 | 全屏开/关 | `fullscreen-on: 0,0 1920x1080`（`caption=false thickframe=false`）→ `fullscreen-off: 300,150 1280x860`，`03-全屏.png` |
| 6 | 按键拦截矩阵 | 10 个键里**只有 F11 拦截＝true**，F/Esc/Shift/Ctrl/Space/L/S/1/F5 全部透传 |
| 7 | 单实例 | 第二实例 **29~35 ms** 内退出并打印"已有实例在运行"，进程数保持 1，第一实例不受影响 |
| 8 | 运行时回读设置与 DPI | `右键菜单=false 开发者工具=false 状态栏=false`、`AreDpiAwarenessContextsEqual=1`（PerMonitorV2） |
| 9 | 应用图标与版本信息 | `ExtractAssociatedIcon` 取到的 32×32 像素签名与 `desktop\app.ico` **完全一致**；`app-icon: 已从内嵌资源加载 RT_GROUP_ICON "APP"`；`PSE 全景战略引擎 / PSE 全景战略引擎 桌面版 / 0.3.0.0` |

不破坏 web（在仓库根跑，需已装 node）：

```powershell
node --max-old-space-size=3072 tests\headless.js 3   # 全部通过（检查 157 项）
node tests\dom-smoke.js                              # 冒烟测试全部通过（检查 28 项）
```

## 6.1 应用图标怎么重做

```powershell
# 1) 重新生成 app.ico（可选 -PngPreview 出一张 256 的 PNG 看效果）
powershell -ExecutionPolicy Bypass -File desktop\make-icon.ps1 -PngPreview icon-256.png

# 2) 重新生成内嵌资源 rsrc_windows_amd64.syso
cd desktop
go run github.com/tc-hib/go-winres@latest make --in winres/winres.json --out rsrc
```

`winres\winres.json` 里 `RT_GROUP_ICON.APP` 必须写成**字符串**路径（写数组会被当成 PNG 列表去解码而报 `unknown format`）；`dpi-awareness` 只认 `""`/`unaware`/`per monitor`/`per monitor v2`。`app.ico` 里 16/24/32/48/64 是标准 DIB 条目（老 Shell/GDI+/`.NET` 都能读），128/256 是 PNG 条目（体积小，Vista+ Shell 支持）。

## 7. 排障

| 现象 | 处理 |
|---|---|
| 启动报缺 WebView2 | 装 Evergreen Runtime；或 `build.ps1` 的环境检查会提前告警 |
| 白屏 | 看 `shell.log` 里 `nav-completed` 有没有；有就用 `--pse-probe` 看宿主/世界/canvas 均值；再 `--pse-capture` 出图 |
| 存档不见了 | 确认用的是虚拟主机（`origin` 必须是 `https://panorama.local`），`file://` 会丢；再确认 `%LOCALAPPDATA%\PSE-Panorama\EBWebView` 存在 |
| 想清档重来 | 删 `%LOCALAPPDATA%\PSE-Panorama` |
| PS 5.1 报"表达式或语句中包含意外的标记" | `.ps1` 必须是 **UTF-8 with BOM**（PowerShell 5.1 否则按 GBK 解析）；用编辑器保存为 UTF-8 BOM 即可 |
| 构建时拉不到 Go 模块 | `build.ps1 -Goproxy https://goproxy.cn,direct` |

## 8. 已知限制

- **合成键鼠注入无法在本环境复现**：WebView2（Chromium）不处理 `PostMessage` 造出来的伪输入，且自动化会话拿不到交互式前台窗口（`GetForegroundWindow` 不是本窗口）。因此 F11 的端到端验证走 `--pse-fullscreen`（与 F11 回调**同一个** `toggleFullscreen()` 函数），"不抢游戏按键"的保证由拦截矩阵 + 运行时设置回读 + 代码路径共同给出。真人在有前台的桌面上按 F11 会走 `AcceleratorKeyCallback`。
- 目前只有 x64（`go build` 默认本机架构）；要 arm64 需交叉编译并自备对应 WebView2 运行时。
- 壳不做自动更新；升级＝替换 `www\`（或整个目录）。
- 全屏截图里底部偶见任务栏：那是"窗口拿不到前台"时任务栏 z 序压在窗口上，窗口矩形本身是 `0,0 1920x1080`（已在验收里断言）。
