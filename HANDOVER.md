# PSE 全景战略引擎 · 交接文档

> 交接时间：2026-10-15　｜　仓库：`D:\dsh\panorama`（git，分支 `main`）
> 远端：https://github.com/wzw4429-crypto/panorama-strategy
> 当前健康度：两套测试全绿（**157/157 + 28/28**）；已修 P0 地图红色横带与空白帧（§4）、P1 手机横屏排版（§4）、悬停提示「补给 NaN%」与事件弹窗点击偶发失效（§4）、生产面板闪白与新增产线口径（§4）、建造/科研/情报局的操作反馈文案（§4）；（§5）另按用户要求补上「师团点名 / 按名字组合 / 编组」「集团军自定义：数量/名称/将领/编成」「国策 / 科研等面板全屏观看使用」；并已落地**平台适配层** `src/platform.ts`（web 退回原行为，桌面壳注入 `window.PSE_HOST` 即可接管存档/文件对话框，见 §3/§6）。

---

## 1. 这是什么

1936–1950 全景式历史大战略模拟（HOI4 风格）的可玩原型：

- **Web 版**：纯静态页面 + Canvas 2D，零运行时依赖、零网络请求（`file://` 直开也能玩）
- **Android 版**：同一份 web 资源打进 `android/` 的 WebView 壳，CI 自动出 APK
- 规模：真实地理地图（Natural Earth 110m + Voronoi 剖分）**1293 省 / 59 国 / 26 海区**，1 游戏小时为时间粒度

---

## 2. 五分钟上手

```powershell
# 1) 起本地服务（当前已在 8787 跑着，若停了就重开）
cd D:\dsh\panorama
node server.js 8787           # node 不在 PATH，见 §6 绝对路径
# 浏览器打开 http://127.0.0.1:8787/   或直接双击 index.html

# 2) 跑测试（改任何逻辑后必跑）
node --max-old-space-size=3072 tests/headless.js 3     # 157 项：地图/世界/3年长跑/确定性/存档/战斗/扩展系统/剧本/生产口径/集团军/平台层/地图拾取/操作反馈
node tests/dom-smoke.js                                # 28 项：DOM 桩渲染 + 全部面板 + 面板刷新/全屏回归 + 平台层 + 提示与弹窗

# 3) 改 TS 后必须重新编译（浏览器加载的是 src/*.js）
npm run build      # = tsc -p tsconfig.json，就地 emit src/*.js
```

游戏内：`空格` 暂停、`1-5` 速度、`L` 切图层、`S` 存档、`~` 控制台、`F` 全屏地图、`Shift+F` 或面板右上「⛶ 全屏」= 面板全屏（国策/科研放大看，`Esc` 退出）。
调试用 URL 参数（`src/main.ts` 末尾解析）：
`?auto=GER&speed=3&days=60&zoom=1&layer=political&tab=equipment&focus=柏林&ironman=0&panelfs=1`（`panelfs=1` = 以面板全屏开局，截图/深链用）

---

## 3. 工程结构

```
panorama/
├── index.html            入口：顶栏/工具行/Canvas/侧栏/弹窗/开局界面/控制台
├── server.js             零依赖静态服务器（已加 no-store 头，避免旧资源被缓存）
├── package.json          scripts: build / watch / test / serve
├── tsconfig.json         outDir=src（就地编译），strict=false
├── src/                  ★ .ts 是唯一真源，.js 由 tsc 生成并提交
│   ├── core.ts           定点/RNG(xorshift128+)/事件总线/时间/stateHash
│   ├── data-rules.ts     平衡常量、59 国、营制、模板、装备、科技、国策树、事件、顾问
│   ├── data-map.ts       消费 data/map-generated.js：投影(等距圆柱)/点选/海区/跨海通道
│   ├── world.ts          世界构建与序列化、师团、外交查询、效果执行器
│   ├── sim.ts            小时管线(移动→战斗→恢复→登陆) + 日界(经济/生产/科研/政治/占领/外交/事件/AI)
│   ├── ai.ts             各国 AI：国策评分、生产再平衡、扩军、战线与进攻
│   ├── systems.ts        装备设计器、军贸/租借、海军舰队与海战、空军任务、间谍、傀儡、燃料、核武
│   ├── systems2.ts       煤炭、决议与民族精神、将领/集团军/前线计划、学说精通度、阵营、和平会议、自制度、难度、剧本、控制台、MOD
│   ├── save.ts           存档（经 platform.ts 落到 localStorage / 桌面壳 / 内存）
│   ├── platform.ts       平台适配层：kind()/isDesktop()/store()/download()/pickText()/notify()/fullscreen()（web·PWA·桌面壳接入点）
│   ├── render.ts         Canvas 渲染 + 7 图层（补给管网/战线折线/海区航线/空域/抵抗/地形/政治）
│   ├── ui.ts             顶栏、10 面板、省份详情、事件与和平弹窗、日志、toast、师团点名/编组选择
│   └── main.ts           主循环(rAF)、速度、摄像机输入、快捷键、控制台、自动存档
├── data/
│   ├── countries-110m.json  Natural Earth 110m TopoJSON
│   └── map-generated.js     生成产物：1293 省多边形 + 230 跨海通道 + 26 海区（670 KB）
├── tools/build-map.js    地图生成器（改地图算法后重跑，约 1 分钟）
├── android/              Android WebView 壳（Gradle 工程）
├── desktop/              ★ Windows 桌面壳（Go + WebView2）：main.go / build.ps1 / verify.ps1 / make-icon.ps1 / app.ico / winres/ / rsrc_windows_amd64.syso / README.md，见 §7
├── .github/workflows/build-apk.yml   CI：tsc → 签名 → 打包 APK
└── tests/                headless.js / dom-smoke.js / probe*.js / *.py 取证脚本
```

关键不变量（改代码时别破坏）：
- 状态纯 JSON 可序列化；**省 id = `w.provinces` 数组下标**
- 确定性：禁止 `Math.random` / `Date.now` 参与世界演化（用 `PSE.rng.fork(salt)`），同种子双跑 `stateHash` 必须一致
- 加载顺序：core → platform → data-rules → map-generated → data-map → world → sim → ai → systems → systems2 → save → render → ui → main
- 渲染投影是**等距圆柱（plate carrée）**：`x=(lon-lonMin)/(lonMax-lonMin)`、`y=(latMax-lat)/(latMax-latMin)`，只此一处（`data-map.ts`），render 一律走 `MD.project/unproject`

**平台适配层契约（`src/platform.ts`，桌面壳/PWA 接入点）**

页面只通过 `PSE.Platform` 触碰宿主能力，**浏览器（含 Android WebView）下全部退回原行为**，所以无宿主也能玩：

```js
// 壳在页面加载前注入（core.js / platform.js 之前设好即可）
window.PSE_HOST = {
  kind: 'tauri' | 'electron' | 'pwa' | 'web',        // 可选，缺省按 __TAURI__ / process.versions.electron / standalone 判定
  kv: { get(k), set(k, v), remove(k), keys() },      // 可选：同步键值（原生文件/store），缺省退回 localStorage
  saveFile(name, text, mime) -> boolean,             // 可选：原生"保存"对话框，接管"导出存档"
  openFile() -> string | null,                       // 可选：原生"打开"对话框，接管"导入存档"
  notify(title, body),                               // 可选：系统通知
  fullscreen(on),                                    // 可选：窗口全屏
  openExternal(url),                                 // 可选：系统浏览器打开
};
```

- `PSE.Platform` 暴露：`kind()` / `isDesktop()` / `isMobile()` / `store()`（= 宿主 kv > localStorage > 内存）/ `storageKind()` / `download(name,text,mime)` / `pickText(accept)` / `notify()` / `fullscreen(on)` / `openExternal(url)` / `info()`
- **`isDesktop()` 以"有没有宿主"为准**（Go+WebView2 壳报 `kind:'webview2'`，不能只认 tauri/electron）；宿主可显式写 `desktop: false` 表示自己只是伪装成宿主的 web 垫片。`kind()` 只作展示标签，宿主没写 kind 时回退为 `'host'`
- 宿主方法**逐个**探测：某个方法不存在或抛错只影响那一项，其余仍走 web 实现（浏览器/Android WebView 行为与旧版完全一致）
- 契约在 `tests/headless.js`（14 项）与 `tests/dom-smoke.js`（1 项）里有回归：断言 web 判定、脚本加载顺序、壳注入后 store/文件对话框被接管、壳移除后回退

---

## 4. 未解决问题（按优先级）

### P0 · 地图红色横带（**已修复**：地图数据反经线 bug，另修掉同源的空白帧竞态）

**结论（本次）**：横带**不是**渲染层画错，而是**地图生成器的反经线（±180°）bug**；`zoom=2` 偶发的 105KB 空白帧则是**另一个独立 bug**（resize 清空画布后未同步重绘的竞态），两个都已修。

**根因**：`data/countries-110m.json` 里俄罗斯的环在 ±180° 处首尾相接（实测最大经度跳变 = 360.0，位于 `[-180,64.9796] → [179.9928,64.9745]`），而 `tools/build-map.js` 全程用平面 lon-lat 做点选/裁剪/Voronoi，没有任何反经线处理。于是该环"绕远路"把**整条北极纬带算作环内**：`pointInPoly(-120,67)=true`、`(-100,67)=true`、`(0,67)=true`；苏联的 Voronoi 种子因此撒到加拿大/大西洋/斯堪的纳维亚，裁出横跨半个地球的长条省 → 就是那条横带；同时真正的苏联北极格子落空 → 同纬度的"缺口"。
- 实测（修复前，沿 lat 67 采样）：lon -150/-135/-120/-105/-90 处**苏联省与美/加省重复覆盖**；lon -75…+15 只剩苏联省；**lon 30…165E 全为空**（缺口）。province 数据本身查不出异常（无 lon 越界、无 span>300、无接缝边），所以早期 probe9/probe10 全部漏掉。

**修复**：
1. `tools/build-map.js`：新增 `splitAntimeridian(ring)`（经度解绕 → 按 -360/0/+360 平移 → `clipHalf` 裁回 [-180,180]，得到 1~2 个正常环），建块循环改为先拆环再 `clipBox`，`blockKey` 加 `.k` 后缀；随后重跑生成器。
2. `data/map-generated.js`：重新生成（1293 → **1285 省**，SOV 72；孤立省 12）。
3. `src/render.ts` / `src/render.js`：`R.resize()` 改为**尺寸未变就不赋值** `c.width/c.height`（赋值会清空画布并重置上下文）；一旦赋值就**在同一个任务里同步补画一帧**（`R.draw(0)`，`R._syncing` 防重入）；`R.draw` 开头加尺寸自检（backing store 与 `R.vw/R.vh/dpr` 不一致则先补 resize）。
4. `tests/headless.js`：新增 2 项回归（网格采样无重叠省份 / 省份环无 ±180 接缝边）；`tests/dom-smoke.js`：新增 1 项回归（resize 尺寸未变不重置、尺寸变化后立即同步重绘）。

**验证**（修复后，1680×950）：
- `zoom=1` 横带检测 2/120 行（修复前 42/120；阈值内属正常海陆交界），目视无横带、无缺口；`zoom=1.5 / 2.05 / 3.2 / fs=1 / 900×600` 全部正常出图
- `zoom=2` 连截 6 次全部 456~457KB（修复前 3 次里有 1 次 105KB 空白帧），且两次字节完全相同 → 帧已确定性
- `node --max-old-space-size=3072 tests/headless.js 3` → 96/96；`node tests/dom-smoke.js` → 19/19
- 编译：环境里没有 npm（`npm.cmd` 不在 node 目录），用 npx 缓存的 tsc：`node "C:\Users\wupengyaguangyaxuan\AppData\Local\npm-cache\_npx\397d2194ba975aaa\node_modules\typescript\lib\tsc.js" -p tsconfig.json`（5.6.3，与 CI 同版本）

**修复前的原始记录（保留作取证参考）**：

**现象**：世界/高纬视图出现一条横贯整幅画布的暗红色带，边缘笔直，跨越海洋、格陵兰、加拿大、苏联；同时在苏联同纬度处出现"缺口"。桌面 1680×950 与红米 K80 横屏都能看到。

**今日实测（HEAD `f70ab2b`）**：
- `tests/handover_check.png`（`zoom=1&layer=political&days=60`）带体位于 y≈380–420，横跨全宽
- 带内海面像素 = `(163,59,59)`，恰为苏联国家色 `#a33b3b`（不透明）
- **新发现（重要）**：同一 URL 的 `zoom=2` 截图**时好时坏**——两次得到"整幅画布空白只剩海色"（105552 B，两次字节数完全相同），一次正常出图（457085 B）；`zoom=1.5 / 2.05 / 3.2` 均正常出图
  → 说明这不是"某个省画错"，而是**画布内容被清空/只部分重绘**的竞态：横带很可能就是"上一帧残留在画布某一段行区间、未被新帧覆盖"的旧内容（旧帧里该行区间正好是苏联红）

**已排除**（有脚本与结论）：
1. 静态地图数据无异常：`tests/probe9.js` — 无 bbox 宽>60° 或高>40° 的省，无跨反经线环
2. 运行时世界多边形无异常：`tests/probe10.js` — 0 超宽 / 0 NaN / 0 越界（1293 省）
3. 全仓库没有对 `poly` 的写操作（只有引用复制 `world.ts:537 poly: p.poly`）
4. `src/render.ts` 全部 629 行已审计：只有 8 处 `fillRect`，全是小范围（背景/城市标签/图例/海区矩形/部队框），**没有任何全宽绘制**
5. 只有一块 canvas（`#map`），无覆盖其上的 DOM 层

**首要嫌疑（下一步从这里查）**：
- `src/render.ts:53-64 R.resize()` **无条件**给 `c.width/c.height` 赋值——给 canvas 尺寸赋值会**清空画布并重置 2D 上下文**；`R.resize()` 的触发源有三个：`window.resize`、`f70ab2b` 新增的 **ResizeObserver**（`src/render.ts` 约 40–51 行，监听画布父容器）、`src/main.ts:254-255` 布局变化时手动调用，另有 `MainActivity.onConfigurationChanged`
- 只要"清空"与"下一帧完整重绘"之间被截图/切换/中断插进来，就会看到空白或残留带
- 建议修法（择一或组合）：① 尺寸未变化时**不要**再赋值 `c.width/c.height`；② 任何 `resize()` 之后**立即同步调用一次 `R.draw()`**；③ 渲染改为"离屏 canvas 全量绘制 → 一次 `drawImage` 上屏"，避免半成品状态可见；④ 给 `R.draw` 结尾加自检（画布尺寸 vs `R.vw/R.vh/dpr` 不一致则重绘）

**复现与取证命令**（以下针对"修复前"已失效，留作复现方法参考）：
```powershell
# 截图（chrome 是 GUI 进程，命令立即返回，必须 sleep 后再读文件）
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-sandbox `
  --hide-scrollbars --user-data-dir="D:\dsh\panorama\tests\.chrome-handover" --window-size=1680,950 `
  --virtual-time-budget=20000 --screenshot="D:\dsh\panorama\tests\shot.png" `
  "http://127.0.0.1:8787/?auto=GER&speed=3&days=60&zoom=2&layer=political&tab=equipment"
Start-Sleep -Seconds 6      # 再 Get-Item shot.png；文件大小 105KB≈空白帧，400KB+≈正常帧

# 行剖面找红带（纯 python，无需第三方库）
& "<python 绝对路径>" tests/rowprofile.py tests/handover_check.png
& "<python 绝对路径>" tests/bandlat.py "tests/handover_check.png:1280:0:1"
```
> 注意：`bandlat.py` 的"画布顶部"探测曾把 UI 面板色（`#161c24` 等，b-r 仅 14~18）误判成海色（报 canvas_top=30），判据已收紧为 `b > r+25`；现可信（1067×480 实测 canvas_top=79）。

### P1 · 手机窄屏排版（**已修复**）

K80 横屏（1067×480）下工具行按钮被换行挤压，"拖动平移·滚轮/双指缩放…"帮助文本与按钮重叠（见 `tests/k80_land_check.png`）。

**根因（CSS 优先级）**：三处窄屏折叠规则写的是裸选择器 `.hintText { display: none; }`（优先级 0,1,0），被基础规则 `#toolbar .group { display: flex; }`（1,1,0）**覆盖**——提示文字从来没被真正隐藏过；而横屏媒体查询又把 `#toolbar` 设成 `flex-wrap: nowrap; overflow-x: auto`，于是提示文字与右侧按钮一起被压成竖排并互相遮挡。

**修复**：
1. `index.html` 三处改为 `#toolbar .hintText { display: none; }`（矮屏横屏 / 触屏横屏 / 竖屏），并在注释里标明"必须带 #toolbar"。
2. 基础规则加固：`#toolbar .group { flex: 0 0 auto; }`、`#toolbar button { white-space: nowrap; }`、`#toolbar .sep { flex: 0 0 auto; }` —— 窄屏宁可整组换行/横向滚动，也不再压成竖排。
3. 横向滚动时右端按钮钉住：`#toolbar .tail { position: sticky; right: 0; background: var(--panel2); ... }`（工具行右端那组加 `class="group tail"`），⛶/玩法说明/控制台 不会被滚走。
4. 操作提示改在「玩法说明」弹层里也写一份（`#helpBox` 顶部新增"地图操作：拖动平移 · 滚轮/双指缩放 · …"），窄屏隐藏内联提示后仍可发现。
5. `tests/dom-smoke.js` 新增 P1 回归：解析 `index.html`，禁止裸 `.hintText{display:none}`（会被 ID 规则覆盖），并要求 ≥3 条带 `#toolbar` 的折叠规则。→ 测试数 19 → **20**。

**验证**（Chrome headless，`?auto=GER&speed=3&days=60&zoom=1&layer=political`）：
- 1067×480：工具行从 3 行/竖排 → 1 行可横向滚动，右端按钮钉住；`tests/bandlat.py` 实测画布顶 y=150 → **79**，地图可视高度 330 → **401 px**（+71px）；截图 `tests/p1_fix2_1067x480.png`
- K80 等价（CSS 986×444，另测 dpr 2.75 = 2712×1221 设备像素）：正常，截图 `tests/p1_fix2_986x444.png` / `tests/p1_fix2_k80.png`
- 竖屏 480×1067 与桌面 1680×950：正常；桌面仍显示内联提示文字（未误伤）
- 基础：`tests/headless.js 3` 96/96、`tests/dom-smoke.js` 20/20

### P1 · 悬停提示「补给 NaN%」+ 事件弹窗点击偶发失效（**已修复**）

玩家反馈：鼠标滑过省份时提示显示「补给 NaN%」且看不到胜利点/军工厂；事件弹窗的选项按钮「点了没反应，要再点一次」。

**根因 A（静态地图对象当世界状态用）**：`provAtEvent()` 直接返回 `PSE.MapData.pickProvince()` 的**生成期静态对象**——它只有 `vp`/`supplyAt`/`buildings{mil:0}`，没有 `supply`、`cityVp`，且静态地图上所有省份 `buildings.mil` 都是 0（军工厂是运行时分配的）→ `Math.round(undefined*100)` = **NaN**，胜利点/军工厂两行的条件恒假。`PSE.MapData.provinces` 静态对象字段：`id,x,y,cx,cy,poly,code,owner,controller,terrain,name,vp,isPort,…,supplyAt,buildings,_bb`（**无 supply / cityVp**）。

**修复 A**：新增 `PSE.World.provinceAt(w, lon, lat)`（`src/world.ts`）＝ pickProvince + 按 `id` 解析成 `w.provinces[id]`（不变量：省份 id = `w.provinces` 下标），世界未建立时退回静态对象；`src/main.ts` 的鼠标悬停/点选/右键/双击与触屏点选全部改走它；tooltip 生成抽成纯函数 `PSE.UI.provinceTooltipHtml(w, p, divCount)`（`src/ui.ts`），补给取不到时显示 `—` 而不是 NaN。

**根因 B（每 350ms 整块重建含按钮的 DOM）**：`UI.renderEvent` 每次 UI tick 都 `optEl.innerHTML = …`，把玩家正按下的按钮销毁重建；mousedown 与 mouseup 跨过一次重建时浏览器不派发 `click`。CDP 实测：弹窗显示时 `#eventOptions` 2.5s 内 childList 变动 **7 次**（≈350ms 一次），同一按钮中心连点 6 次 **5 次生效、1 次卡住**。`UI.renderPeace`（和平会议选项）同一毛病。

**修复 B**：事件/会议的**内容签名**（`evtSig = tag|id|选项数`、`peaceSig = defeated|main|playerTag`）——签名不变就不重建，弹窗关闭/换事件时复位；`renderLog` 同样加签名（无新日志不动 DOM）。同类"每 tick 重建可点元素"的地方已全查：面板区（上次已修 `tickPanel`）、事件弹窗、和平会议、日志；`renderTop` 只写文本/`<span>`，`showGameOver` 只显示一次，无风险。

**验证**：
- `tests/headless.js` §12（7 项）：静态对象无 `supply`/`cityVp`、`provinceAt` 返回 `w.provinces[id]` 同一对象、深海返回 null、世界未建立时退回静态对象；`tests/dom-smoke.js` +2 步：tooltip 纯函数（无 NaN、有补给百分比/胜利点/军工厂/驻军）、事件与和平弹窗 8 次刷新 0 重建且关闭重开必重建。
- 真 Chrome（CDP，`?auto=GER&speed=0&days=30&zoom=1`）：悬停柏林 → `柏林（森林）控制：德国｜补给 100% 驻军 2 个师 胜利点 50｜港口｜军工厂 1`（截图 `tests/bugfix_tooltip.png`）；`#eventOptions` 2.6s 重建 **0 次**（旧版 7 次）；CDP `Input.dispatchMouseEvent` 真实物理连点 **10/10 生效**；0 console 异常。

### P2 · 操作反馈缺失 / 误导文案（**已修复**）

用户实测反馈三处「点了没动静 / 提示不对」：

1. **建造成功无提示**：`src/ui.ts` 的 `[data-build]` 处理器成功时只 `renderPanel` 不 toast，只有失败才说话。
2. **成立情报局成功无提示**：`data-agency` 同理；招募特工也只在失败时提示。
3. **科研失败一律「该科技前置未满足」**：把「已研究完」也说成前置问题；下拉里已研究/研究中/不可研究的条目没有区分标注。

**修复**：三处命令都补了「返回原因」的 Ex 版本（与既有的 `addProductionEx` 同一风格），UI 直接把命令返回的文案 toast 出去，失败原因分类：

- `Cmd.queueBuildEx(w, kind, provId)` → `已在「慕尼黑」排队建造「民用工厂」`／`「X」不在你的控制下，不能建设`／`「海军船坞」需要沿海省份，「慕尼黑」不是`；`Cmd.queueBuild` = `.ok`（布尔 API 不变）。
- `Spy.buildEx` / `Spy.recruitEx`（`src/systems.ts`）→ `情报局已成立（扣 50 政治点，可开始招募特工）`／`情报局已经成立了`／`政治点不足（成立情报局需要 50，现有 N）`；招募另有 `特工名额已满（3/3，建民用工厂可增加名额）`。`Spy.build`/`Spy.recruit` 保持返回布尔。
- `Cmd.setResearchEx`（`src/sim.ts`）→ 区分 `「X」已研究完成，换一项吧`／`「X」已在另一个科研槽研究中`／`「X」前置未满足：需先研究 民用工业 I`／`与已选学说冲突`／`学说线同时只能研究一项`；成功给 `科研槽 1 开始研究「X」`。
- `techOptions()`（`src/ui.ts`）给下拉项加标注：`（已研究）`／`（研究中）`／`（前置未满足）`，不可研究的项继续 `disabled`（已研究的不能选中，避免"选了才报错"）。

**验证**：`tests/headless.js` §13（11 项：建造成功文案 + 非己方/内陆船坞原因 + 三个布尔 API 行为不变 + 科研四类原因）；`tests/dom-smoke.js` +1 步（下拉含「已研究」「前置未满足」标注、已研究失败原因正确、三处成功路径都有文案）；真 Chrome CDP（`?auto=GER&speed=0&tab=production`）**10/10 PASS**：建造 toast `已在「柏林」排队建造「民用工厂」`、下拉标注 `民用工业 I（工业）（已研究）` 且 disabled、`民用工业 III（工业）（前置未满足）`、选已研究 → `「民用工业 I」已研究完成，换一项吧`、情报局 → `情报局已成立（扣 50 政治点，可开始招募特工）`；0 console 异常；截图 `tests/feedback_toast.png`。

### P2 · 杂项
- ~~`package.json` 的 `description` 是乱码~~ → **已复查：文件本身没有问题**（`description` 解码后是「全景式历史战略模拟引擎（1936-1950）—— Web/Android 原型」，码点正确、无 U+FFFD；43 个文本文件全量扫描均合法 UTF-8）。见下一条。
- PowerShell 读取 UTF-8 文件（含 `.gitignore`、workflow）会显示乱码——**只是显示问题**，文件本身正常，不要"顺手重写"
- `tests/` 取证工具：**保留并入库** `rowprofile.py`（行剖面）＋`bandlat.py`（横带定位，画布顶探测的"面板色误判"已收紧判据）；一次性脚本（`probe9/10/12-15.js`、`forensics.py`、`pngsample.py`）与 `apk_check/`、Chrome 临时 profile、`__pycache__` 已清理；`.gitignore` 新增 `tests/.chrome-*/` 与 `__pycache__/`
- ~~README 的功能对照表随 UI 演进可能略有出入~~ → **上一轮已核对更新**（操作表加面板全屏、工业表加"新增产线"、指挥表重写"集团军"、陆军表加"师团点名与编组"、工程结构加 `platform.ts`、新增"平台适配层"小节）；测试数字随基线同步（现 157/28）

---

## 5. 剩下的既定要求（来自用户）

| 要求 | 出处 | 状态 |
|---|---|---|
| 修到"没有任何一点 bug"再推送 | m01338 | P0/P1 + 本轮三件事已修并本地提交（`d51d3cc` + `0cee85a` + `851312d` + `8dcd51d` + 本次），待用户确认后推送 |
| 每次修完自己跑测试并全面复查代码 | m01338 | 持续执行中（现 157/157 + 28/28） |
| 交接文档 | m01471 | **本文档** |
| 自主推进、不要频繁确认 | 会话早期多轮 | 持续遵守 |
| 把聚在一地的师拆开、给每个师起名字、按名字组合 | 用户（本轮） | **已实现**：师团名带兵种（如 德国·第3装甲师）；「陆军」面板逐个师点选（拆堆叠）、按名字组合选中、「存为编组」一键召回（随存档持久化） |
| 集团军数量与编成可自定义 | 用户（本轮） | **已实现**：`PSE.Army.add/remove/rename/setGeneral/setDivisions/releaseDivisions/autoFill`；面板上 新建集团军/解散/改名/换将/编入选中师/调出选中师/自动补齐；手动编成（`d.armyManual`）不被每日自动编组覆盖，`ensure` 改用 `c.armiesInit` 标记（玩家可把集团军全解散而不被重建） |
| 点开生产线的下拉「闪一下变白」 | 用户（本轮） | **已修复**：面板每 350ms 整块 `innerHTML` 重建（见 §4），改为「内容签名不动就不重建 + 正在交互（焦点在 select/input）时挂起；重绘后按 id 恢复下拉选择/焦点」，并给聊天/日志加 `willChange: transform` 减重排 |
| 有空的军工工厂，点「新增产线」却说「没有空闲」 | 用户（本轮） | **已修复**：面板显示的 `空闲` 与命令 `Prod.freeMil` 不是同一口径（面板 `free = mil - used` 只减了「已分配产线数」，命令还要求有空闲工厂且选中项是陆/空军装备；选到舰船/未知装备会直接报没有空闲）。现在统一用 `PSE.Cmd.prodFreeMil()`，提示区分「占用中」与「真没有工厂」，并在空闲为 0 时给出「怎么才有空闲」的指引 |
| 国策 / 科研等面板要能全屏观看、使用 | 用户（本轮） | **已实现**：面板右上「⛶ 全屏」/ `Shift+F` / URL `&panelfs=1`；全屏后 `#side` 铺满窗口，顶部条可一键切换 政治/生产/装备/科研/国策/陆军/海军/空军/谍报/外交/后勤/战报，国策树/科研列表按窗口高度放大，`Esc` 退出；地图全屏仍是 `F` |

推送流程（remote 已去掉 token）：
```powershell
cd D:\dsh\panorama
git add -A; git commit -m "..."
git -c credential.helper= push "https://x-access-token:<TOKEN>@github.com/wzw4429-crypto/panorama-strategy.git" main
git fetch origin          # 同步 tracking ref（否则 status 会显示 ahead）
```
推送 `main` 会自动触发 CI 构建 APK。**token 由用户提供（见会话记录），用后建议轮换**；本文档不写入明文。

---

## 6. 环境与坑位清单

| 项 | 值 / 说明 |
|---|---|
| node / npm | node 不在 PATH：`C:\Users\wupengyaguangyaxuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`；**本机没有 npm/npm.cmd**，编译用 npx 缓存里的 tsc 5.6.3：`node "C:\Users\wupengyaguangyaxuan\AppData\Local\npm-cache\_npx\397d2194ba975aaa\node_modules\typescript\lib\tsc.js" -p tsconfig.json --alwaysStrict`（不加 `--alwaysStrict` 会把已提交 js 顶部的 `"use strict"` prologue 删掉，产生无关 diff） |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`，用 `--headless=new`；**截图文件异步生成，命令返回后要 `Start-Sleep 5-6s`**；必须带独立 `--user-data-dir`（默认 profile 被占用会静默失败） |
| Python（取证） | `C:\Users\wupengyaguangyaxuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（含 Pillow；`rowprofile.py` 甚至不用它，纯 zlib 解 PNG） |
| `--dump-dom` | 与 `--virtual-time-budget` 同用；输出重定向后同样要等进程结束再读，过早读会得到空文件 |
| `--virtual-time-budget` 会挂住 | headless 加 `--virtual-time-budget=…` 时，本工程有 `requestAnimationFrame` 主循环 + 350ms 定时器，虚拟时间跑不完会**一直不退出**（实测 120s 被杀，截图 0 字节）。截图/取 DOM 只等真实时间（`--timeout=…` 或直接 `Start-Sleep`），不要用虚拟时间预算 |
| 桌面壳 / PWA | 页面加载前注入 `window.PSE_HOST`（契约见 §3）；无宿主时 `PSE.Platform.kind()==='web'`、存档走 localStorage。**桌面判定看"有没有宿主"（isDesktop），kind 只是标签**——Go+WebView2 壳报 `webview2` 也照样算桌面。桌面壳已完成，见 **§7**（Go + WebView2，`https://panorama.local/` 虚拟主机，不走 file://），web 侧只需保住这个契约 |
| 本地服务 | `node server.js 8787`；已加 `no-store` 缓存头（改了 JS 不生效时先怀疑缓存） |
| 复现地图 bug 的最短路径 | `?auto=GER&speed=3&days=60&zoom=1&layer=political` → 看顶部/高纬是否出现横带；`zoom=2` 多截几次看是否空白 |

---

## 7. Windows 桌面版（Go + WebView2 壳，已完成）

产物：`desktop\dist\PSE-Panorama\`（exe 3.56 MB / 3 732 992 字节 + `www\` 16 文件 1.26 MB，另可出 1.83 MB 的 zip）。全程**只动 `desktop/`**，不碰 `src/`、`index.html`、`data/`、`tests/`、`tools/`。

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -Zip      # 出包
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -SelfTest # 出包 + 冒烟自检
powershell -ExecutionPolicy Bypass -File desktop\verify.ps1 -FreshUserData  # 9 组 27 项验收
```

五条硬性设计（理由都是实测踩出来的）：

1. **不用 `file://`，用 `SetVirtualHostNameToFolderMapping` 映射成 `https://panorama.local/`** —— file:// 下 WebView2 的 localStorage 不可靠会丢存档；虚拟主机是正常 https 源，零端口零防火墙弹窗。
2. **`UserDataFolder=%LOCALAPPDATA%\PSE-Panorama`**，存档（`EBWebView\Default\Local Storage`）与窗口记忆（`window-state.json`）都在这里，删目录即清档。
3. **只拦 F11**（`AcceleratorKeyCallback` 里 `vk==0x7B`）：`F`/`Shift+F`/`Esc`/数字键/`L`/`S` 全部透传，并 `AreDefaultContextMenusEnabled=false` 让右键归游戏用。
4. **PerMonitorV2 DPI + 窗口位置尺寸记忆（含跨屏 clamp）+ 单实例**（`Local\PSE-Panorama-Shell` 互斥体，第二次双击切前台）。
5. **应用图标与游戏同源**：`desktop\make-icon.ps1` 用 GDI+ 按 Android 版 `splash_logo.xml` 的 108×108 设计图画出 `app.ico`（深蓝底 + 金色地球 + 指北星，16/24/32/48/64 为 DIB 条目、128/256 为 PNG 条目），`go-winres` 按 `winres\winres.json` 把它和应用清单（`permonitorv2,system`）、版本信息一起编成 `rsrc_windows_amd64.syso`（入库，离线可构建）；窗口类 `HIcon/HIconSm` + `WM_SETICON` 用同一份内嵌资源，exe 文件图标 / 标题栏 / 任务栏 / Alt-Tab 四处一致。

宿主桥 `window.PSE_HOST`（`kind:'webview2'`）必须在**导航之前**注入（`AddScriptToExecuteOnDocumentCreated` 对当前文档无效，顺序反了就是白屏）；kv 基于 localStorage，契约与 `src/platform.ts` 逐项对齐（`store()` 的接口是 `getItem/setItem/removeItem/key/length`）。

**验收实测（`desktop\verify.ps1`，27/27 通过）**：宿主桥注入 ✓；`origin=https://panorama.local` ✓；`?auto=GER&speed=3` 自动开局、`canvasMean=50`（0＝全黑）✓；启动 进程start→nav-completed **2644 ms / 2692 ms**（两次独立全量验收；热启动采样 2586~2705 ms）✓；**进程 A 写存档 `hash=2968368646` → 全新进程 B 读回同一 hash** ✓；窗口 `300,150 1280x860` 记忆跨重启 ✓；全屏 `0,0 1920x1080`（无标题栏）开/关 ✓；第二实例 35 ms 退出、进程数仍为 1 ✓；运行时回读 `右键菜单=false 开发者工具=false`、`AreDpiAwarenessContextsEqual=1` ✓；**exe 内嵌图标 32×32 像素签名与 `desktop\app.ico` 完全一致**、`app-icon: 已从内嵌资源加载 RT_GROUP_ICON "APP"`、版本信息 `PSE 全景战略引擎 / 0.3.0.0` ✓。截图与《验收报告.md》（含 exe SHA256）在 `desktop\dist\_evidence\`（dist 已 gitignore）。同期 web 两套测试 **157/157 + 28/28**，未受桌面壳影响。

**该路线踩过的坑（改壳时注意）**：① 库 `github.com/jchv/go-webview2` 的 `Resize()` 在 controller 未就绪时直接 return，初始 `WM_SIZE` 会丢 → WebView2 永远 0×0、窗口一片白，`Embed()` 成功后必须显式再 `Resize()` 一次；② 该库用 `int64(res) < 0` 判 HRESULT 失败，amd64 上零扩展恒为正 → 失败漏判后空指针崩，别依赖它的错误判断；③ `ICoreWebView2Controller` 的 `Close` 库里只声明字段没实现，得自己按 vtable 槽位 24 调用（先 `PutIsVisible(false)`），否则退出时 localStorage 落盘不干净（实测会冒一行 `can't open file for write !`）；④ `RegisterClassExW` 的 `HCursor` 必须传 `LoadCursorW` 得到的真实句柄，直接写 32512 会 `ERROR_INVALID_PARAMETER`；⑤ 所有 WebView2 COM 调用必须在同一 UI 线程（`runtime.LockOSThread`），在协程里调用会崩；⑥ `winres.json` 的 `RT_GROUP_ICON` 值必须是**字符串**路径（写成数组会被当成 PNG 列表解码，报 `image: unknown format`），`dpi-awareness` 只认 `unaware`/`per monitor`/`per monitor v2`；⑦ 应用清单声明了 DPI 感知后 `SetProcessDpiAwarenessContext` 会返回 `Access is denied`（正常），自证要看 `AreDpiAwarenessContextsEqual`。
**已知限制**：自动化会话拿不到交互式前台，WebView2 也不处理 `PostMessage` 造的伪输入 → 键鼠注入无法端到端复现；F11 的端到端验证走 `--pse-fullscreen`（与 F11 回调同一个 `toggleFullscreen()`），"不抢按键"由拦截矩阵 + 设置回读保证。

---

## 8. Android / APK

- 工程：`android/`（`com.pse.panorama`，`versionCode 2` / `versionName 1.1.0`，minSdk 24 / target 34，横屏、常亮、`file:///android_asset/www/index.html`，启动封面 + 图标 + 沉浸模式）
- 签名：PKCS#12 密钥库 `android/app/pse-release.p12`（**已 gitignore，不入库**；本地构建把它放进 `android/app/` 并设 `PANORAMA_KEYSTORE_PASSWORD` 即可自动签名）
- CI：`.github/workflows/build-apk.yml`，push `main` 触发
  1. `npx -y -p typescript@5.6.3 tsc -p tsconfig.json`
  2. 从 secrets 解码密钥库：`PANORAMA_KEYSTORE_B64`（须存在，否则 CI 直接失败）+ `PANORAMA_KEYSTORE_PASSWORD`
  3. `cp -r index.html src data` → `android/app/src/main/assets/www/`
  4. `gradle -p android assembleRelease` → `apksigner verify` → 产物 `panorama-strategy.apk`（Actions artifact `panorama-strategy-apk`）
- 本地旧产物：`apk-out/panorama-strategy.apk`（10/11 的 debug 版，**已过时**，最新请从 Actions 下载）

---

## 9. 交接后建议的第一步

1. `node server.js 8787` + 浏览器打开，确认可玩（当前服务在本机 8787 已起）
2. 跑两套测试，确认基线仍为 **157/157 + 28/28**（含 §4 P0/P1 的 4 项回归、悬停提示与弹窗点击回归、操作反馈文案回归、生产口径与面板刷新/全屏回归、集团军与平台层回归）
3. 若再动地图算法：改 `tools/build-map.js` → `node tools/build-map.js` 重生成 `data/map-generated.js`（约 1 分钟）→ 两套测试；**任何跨 ±180° 的环都必须先 `splitAntimeridian` 再参与平面运算**
4. 若再动渲染时序：`node <npx 缓存里的 tsc.js> -p tsconfig.json` 编译 → 两套测试 → 多次 `zoom=2` 截图（456KB≈正常，105KB≈空白帧）→ 提交
5. 提交后推送（触发 APK 重建）→ 在 Actions 下载新 APK 实机验证；推送 token 由用户提供
