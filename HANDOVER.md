# PSE 全景战略引擎 · 交接文档

> 交接时间：2026-10-15　｜　仓库：`D:\dsh\panorama`（git，分支 `main`）
> 远端：https://github.com/wzw4429-crypto/panorama-strategy
> 当前健康度：两套测试全绿（**216/216 + 60/60**）；已修 P0 地图红色横带与空白帧（§4）、P1 手机横屏排版（§4）、悬停提示「补给 NaN%」与事件弹窗点击偶发失效（§4）、生产面板闪白与新增产线口径（§4）、建造/科研/情报局的操作反馈文案（§4）、开局「选择国家」原生下拉被系统弹层截断/闪白（改为全站主题化下拉组件，§4）、P3 海战日志被「损失 0 艘」刷屏（同海区每周合并一条，§4）、沿海/港口数据错（内陆省能造海军船坞、能发起登陆，§4）、未宣战就能登陆/空降中立国（§4）、建设队列无法取消（稳定 id + ✕，§4）、日志被外国要闻淹没（玩家消息保底 + 「仅我方/全部世界」，§4）；（§5）另按用户要求补上「师团点名 / 按名字组合 / 编组」「集团军自定义：数量/名称/将领/编成」「国策 / 科研等面板全屏观看使用」；并已落地**平台适配层** `src/platform.ts`（web 退回原行为，桌面壳注入 `window.PSE_HOST` 即可接管存档/文件对话框，见 §3/§6）。

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
node --max-old-space-size=3072 tests/headless.js 3     # 216 项：地图/世界/3年长跑/确定性/存档/战斗/扩展系统/剧本/生产口径/集团军/平台层/地图拾取/操作反馈/主题化下拉/海战日志/沿海港口/登陆空降门槛/建设队列取消/日志保底
node tests/dom-smoke.js                                # 60 项：DOM 桩渲染 + 全部面板 + 面板刷新/全屏回归 + 下拉组件 + 设计器 + 平台层 + 提示与弹窗 + 移动端布局 + 沿海港口 + 队列取消 + 日志过滤

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
│   ├── select.ts         主题化下拉组件 PSE.SelectUI：原生 select 增强为页面内弹层（开局国家/科研/生产/贸易/设计器）
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
- 加载顺序：core → platform → data-rules → map-generated → data-map → world → sim → ai → systems → systems2 → save → render → select → ui → main
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

### P1 · 开局「选择国家」原生下拉被系统弹层截断 / 闪白 + 全站下拉主题化（**已修复**）

用户实测：开局界面「选择国家」点开是**系统原生下拉**，在缩放/窄屏/全屏下被浏览器/系统渲染成不完整列表，甚至整块刷白；要求换成与游戏一致的主题化下拉。

**根因**：原生 `<select>` 的弹出层由浏览器/系统绘制，样式完全不可控（`<option>` 不能带样式、列表高度与滚动由系统决定；Chrome 在部分缩放/fullscreen 下会先清掉系统层再重绘，看起来就是"闪白"）。

**修复**（新文件 `src/select.ts` → `PSE.SelectUI`；`index.html` 里 `src/select.js` 在 `ui.js` 之前加载）：
- `enhance(select)`：**保留原生 `<select>` 在 DOM 里**（`value`/`change` 语义不变，面板代码零改动），只把它视觉隐藏（1px、opacity 0、`pointer-events:none`），旁边插入同尺寸主题化按钮（当前值 + ▾），点击/Enter/Space 打开页面内弹层；弹层挂在 body 上的 `.pselLayer`（position:fixed、z-index 330，不受面板 `overflow` 裁切），按钮下方定位、空间不够自动翻到上方，宽度按最长选项自适应，`max-height = min(280, 视口x0.6)`，超出滚动。
- 选项行是普通 DOM：hover 主题色高亮、键盘 ↑↓/Home/End/Enter/Esc/首字母跳转、点击外部关闭、滚动跟随；选中后写回原生 select 并派发 `change`（含 InputEvent），`UI.renderPanel` 的 350ms tick 重建后用 `refresh(sel)` 重新同步标签；`SelectUI 打开时 UI.panelBusy()` 返回 true，面板重建挂起，下拉不会被刷掉。
- 移动端：`@media (pointer:coarse)` 选项行高 ≥34px；横屏弹层 `max-height:46vh`；窄屏不发生横向溢出。
- 接入点：`UI.renderPanel()` 结尾 `PSE.SelectUI.enhance(panelBody)`；开局界面填完 国家/剧本/难度 后 `enhance(startBox)`；已增强的 select 打 `data-psel=1` 标记，`enhance` 幂等。

**顺带修复（Chief 实测发现）**：装备设计器 5 个下拉选了没反应——`[data-design]` 原代码对 `sel.dataset.design` 做 `split(':')`，而 select 上写的是 `data-design="chassis"`（无冒号）→ key=undefined → `UI.setDesign(undefined)` 直接 return。现在 select 用 `data-design="<key>"`（值即新选项）也支持，其他元素保持 `"<key>:<value>"`；`UI.setDesign` 加 key 空值守卫。

**验证**：`tests/headless.js` §14（6 项：enhance 保留原生 select、选项同步、写回 value+change、disabled 跳过、refresh 标签、幂等），**172/172**；`tests/dom-smoke.js` +2 步（增强结构 `.psel`、状态/文案 API），**57/57**。真 Chrome CDP（临时脚本已删；1584x905 / 390x844 / 844x390 三种视口）**43/43 PASS**：国家下拉 58 项、弹层 280px 内滚动到最后一项、真实 hover 主题色 `rgb(255,210,74)`、点选最后一项（蒙古）生效并派发 change、Esc/外部点击关闭、开始游戏流程正常、地图非空白；科研/生产/产线切换 下拉真实选择生效且 tick 后保持；设计器 chassis/gun/armor/engine/airframe 5 个下拉真实选择 → `getDesign()` 生效、预览数值变化；竖屏无横向溢出、横屏弹层 ≤46vh；触发器宽度按最长选项自适应（按实际 padding/字号计算，桌面/竖屏实测余量 12.0–12.6px、长国名 0 裁切），真实鼠标点击触发器只开页面内弹层、原生 select 不被聚焦（不弹系统列表）；0 console 错误。截图：`tests/sel_start_desktop_open.png`、`tests/sel_start_portrait_open.png`、`tests/sel_start_landscape_open.png`、`tests/sel_panel_research.png`、`tests/sel_panel_prod.png`、`tests/sel_designer.png`、`tests/sel_width_desktop.png`、`tests/sel_width_portrait.png`。

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
- ~~README 的功能对照表随 UI 演进可能略有出入~~ → **上一轮已核对更新**（操作表加面板全屏、工业表加"新增产线"、指挥表重写"集团军"、陆军表加"师团点名与编组"、工程结构加 `platform.ts`、新增"平台适配层"小节）；测试数字随基线同步（现 179/58）

### P3 · 海战日志被「损失 0 艘」刷屏（**已修复**）

1936→1949 全战役快进（122640 游戏小时）实测：战斗日志里 500 条几乎全是「海战（日本 vs 中国）：损失 0 艘」这类条目，同一小时能一次写 10 条。

**根因**（`src/systems.ts` `Navy.daily`）：每周界（`w.hour % (24*7) === 0`）对同一海区**每一对**敌对舰队各写一条日志，且不看损失是否为 0。周界开头还会先 `Navy.reorganize` 用库存重建所有国家的舰队；同一天多对交战会快速耗尽一方库存，之后成对交战中 `Navy.shipLosses` 返回 0，于是「损失 0 艘」刷屏。

**修复**（最小改动，只动 `src/systems.ts` `Navy.daily`）：
- 同一海区本周所有交战**合并成一条**：`海区（北海）：3 组舰队交战，损失 7 艘`（海区名取自 `PSE.MapData.seaZones`；「组」只计有实际损失的成对交战）。
- 四舍五入后总损失为 0 时**不写日志**。
- 删掉算完没用的死变量 `ratio`。

**验证**：`tests/headless.js` §15（9 项：0 损失不写／同海区 3×3 对交战合并成 1 条且口径为「9 组舰队交战」／不同海区各 1 条且每海区每周 ≤1 条／非周界不写、周界写 1 条／真实路径（不 mock 周编队）无 0 损失日志且格式合规），**172/172 + 57/57**。真实路径实测（GER/POL 各 900 护航舰、周界）：`海区（北海）：1 组舰队交战，损失 16 艘`、`海区（波罗的海）：1 组舰队交战，损失 23 艘`，无 0 损失条目。

---

### P0 · 沿海 / 港口数据错：内陆省能造海军船坞、能发起登陆（**已修复**）

**现象**：内陆省（柏林 / 巴黎 / 马德里 / 华沙 / 哈尔滨 / 法兰克福 / 科隆 / 鲁尔 / 罗马 …）在数据里是 `coastal:true`，其中 23 个还被标成 `isPort`（港口）——于是玩家能在内陆造「海军船坞」、从内陆省发起登陆；国家的船坞工厂也会被撒到内陆省（法国开局 4 座船坞全在巴黎）。全图沿海 457、港口 103，明显偏多。

**根因**（`tools/build-map.js`，两层叠加）：
1. 老口径用「省质心离海区矩形 < 1.5°（≈165km）」判沿海（`distToZoneBox`），海区是矩形近似，柏林/法兰克福/马德里/华沙离北海/波罗的海矩形都不到 1.5°，于是全被算成沿海；`vp>0` 再把它们补成港口。
2. 换成真几何海岸线判定后仍有残留：省份是「国家陆地环 + Voronoi 裁剪」的大格子，**内陆大城的格子可能一路伸到海边**，只判「省界里有海岸线」的话，巴黎/伦敦/罗马这种省城在内陆的省照样算沿海。

**修复**（只动 `tools/build-map.js`，重跑生成器）：
- 真几何海岸判定 `coastInfo(p)`：取每条边中点沿两侧法线各 nudge 0.02°（≈2km），**恰好一侧是陆地、另一侧是海** → 这条边是该省真实海岸线（陆地以内置 110m 国家环 + 5° 网格索引加速）。
- 再加一条：**省城到这段海岸线的距离 ≤ 0.5°（约 55km）**才算沿海（`COAST_MAX_DIST`）——「这座城靠海」，而不是「这个省的地盘里有海」。巴黎 1.46°、柏林/里昂等没有海岸边 → 内陆。
- 港口以城市元数据（`cell.city[5]`）为权威，44 个河口港（伦敦/汉堡/马赛/列宁格勒/巴士拉/东京…）即使几何不贴海也保持 `isPort`；非城市省只有「确实沿海 + 省城离海 < 0.35°」才补港。岛屿省恒为沿海。
- 生成器自检清单扩到 21 省（含 巴黎/里昂/慕尼黑/莫斯科/芝加哥 = false，伦敦/纽约/上海/马赛 = true）并打印「省界贴海但省城离海过远 → 判内陆」的清单、无沿海省/无港口省的国家清单。

**结果**（`data/map-generated.js` 重新生成，666.4 KB）：沿海 457 → **222**，港口 103 → **80**；失去 `isPort` 的 23 省全部是内陆或非港城（曼彻斯特/马德里/塞维利亚/罗斯托夫/堪培拉/布鲁塞尔/罗马/河内/利雅得/京城/基律纳/华沙/考纳斯/柏林/鲁尔/科隆/法兰克福/安卡拉/萨格勒布/萨拉热窝/南京/哈尔滨/坦佩雷），**新增 0 个**（没有丢真港口）；不变量 `isPort⇒coastal`、`coastal⇒有海区`、`岛屿⇒coastal` 全 0 违规；全图**落在非沿海省的船坞 = 0**；无沿海省的国家 9 个且全是真内陆（AFG/AUT/BOL/CZE/ETH/HUN/MON/PAR/SWI，本来 `dock` 工厂就是 0）；德国沿海省 5 个（汉堡[港] + 4 个无名区），法国 9、英国 9、苏联 7、日本 12、美国 19。

**验证**：`tests/headless.js` §16（7 项：柏林/巴黎/里昂/慕尼黑/华沙 非沿海非港口、汉堡/马赛 港口、`isPort⇒coastal`、非沿海省无船坞、无沿海省国家清单、柏林排队船坞被拒、汉堡可排队）→ **179/179**；`tests/dom-smoke.js` +1 步（柏林省份详情「港口 否」、汉堡「港口 是」）→ **58/58**。真 Chrome CDP **16/16 PASS**（MapData coastal=222/isPort=80、**真实地图点击柏林** → 选中柏林且详情「港口 否」、真实点击「海军船坞」→ toast「「海军船坞」需要沿海省份，「柏林」不是」且柏林 `dock` 仍 0、汉堡 → 「已在「汉堡」排队建造「海军船坞」」、地图非空白 1650 色、无贯通红横带、0 console 错误）；截图 `tests/coast_fix.png`（259 KB）。注意：生产面板的「海军船坞」按钮是全局按钮（目标省取当前选中省），所以按钮本身仍在，拦截点是 `Cmd.queueBuildEx` 的沿海校验 + 明确原因 toast。

**副作用核对**：`straits` 213→217、孤立省 12→5（岛屿锚点改连真沿海省，连通性变好而非变差）；38 个省的邻接变化全部来自岛屿/跨海锚点重算；各国舰队/船坞工厂不受影响（有 `dock>0` 的国家都仍有沿海省）。

### P0 · 未宣战就能登陆 / 空降中立国（**已修复**）

**现象**：1936 开局德国与瑞典没有战争（`PSE.World.areAtWar(w,'GER','SWE') === false`），却能把师送上斯德哥尔摩：登陆抵达后目标省 owner/controller 仍是瑞典，没有任何外交或战斗反应；`Cmd.paradrop`（空降）同样。

**根因**：`src/systems.ts` 的 `Cmd.navalInvasion` 只检查「目标沿海 / 有可用部队 / 部队从沿海省出发 / 海军战力 ≥ 20 / 制海权 ≥ 0.4」，`Cmd.paradrop` 只检查「有运输机 / 有部队」——**两条指令都没有任何交战校验**。游戏里判定「能不能进这个省」的口径本来存在（`Sim.passable`，`src/sim.ts:96`，陆路寻路用：己方 / 同阵营 / 交战国控制 / 控制方中立但宗主国交战），但登陆/空降没有走它。

**修复**（只动 `src/systems.ts`）：
- 新增 `invasionGate(w, c, target, verb)`：直接复用 `PSE.Sim.passable(w, target, c.tag)`——进不去就不是合法目标。未宣战的第三方返回 `必须先对 瑞典 宣战才能在此登陆`（`verb` 为 `登陆`/`空降`）；未定领地（`controller === 'NEU'`）返回 `「X」是未定领地，没有可交战的对手，无法登陆`。两条指令在各自的「目标合法性」阶段就调用它（在海军力量/运输机校验之前，所以原因不会被别的条件覆盖）。
- `Navy.tickInsertions` 抵达结算时再查一次：航渡途中停战/目标被盟友接管的，**原地取消 + 写日志**，不再把人落进和平省份。

**有意保留**：己方 / 盟友控制的沿海省仍可登陆（跨海投送，与 `passable` 同口径）；只有「进不去」的省被拒。

**验证**：`tests/headless.js` §17（15 项：未宣战登陆被拒且提示含国名「瑞典」/ 部队状态不变且无 `invading`、`invasionTarget`、`invasionEta` / 空降同样被拒 / `NEU` 省被拒 / 控制台宣战后登陆成功且航渡 48~95 小时 / 推进后真的落在目标省并写「登陆/着陆」日志 / 中途停战则取消登陆且留在原地 / 己方省与盟友省仍可登陆）→ **194/194**；`tests/dom-smoke.js` **58/58**。真 Chrome CDP **18/18 PASS**：真实地图点击斯德哥尔摩 → 真实点击海军面板「对当前选中省发起登陆」→ toast `必须先对 瑞典 宣战才能在此登陆`、部队 `status=idle target=null eta=0`；控制台 `war SWE` → 再点 → `登陆船团已出发（约 2~4 天抵达）`、`status=invading`、**56 小时**后抵达斯德哥尔摩并写日志；0 console 错误；截图 `tests/invasion_gate.png`（拒绝，207 KB）、`tests/invasion_ok.png`（出发，214 KB）。

### P1 · 建设队列只能排队、不能取消（**已修复**）

**现象**：`c.construction` 只增不减——点错一个建筑、或想给别的省腾工期时没有任何撤销手段（面板只有「民用工厂 / 军用工厂 / …」排队按钮）。

**根因**：队列项**没有稳定标识**。面板渲染只能用数组下标定位，而 AI 建厂 push、完工 splice 会让下标立刻错位，「点某一行的 ✕」没法安全映射回那一项；`Cmd` 里也没有取消入口。

**修复**：
- `src/world.ts` 新增 `World.pushBuild(c, kind, prov, cost)`（唯一入队出口，入队时发 `b<seq>` 稳定 id）与 `World.ensureBuildIds(c)`（给老存档的项按顺序补 id，并把计数器推到存档最大序号之后）；`World.create` 的初始民工、`AI.manageConstruction`（`src/ai.ts`）、`Cmd.queueBuildEx` 全部改走 `pushBuild`；`World.deserialize` 读档时调 `ensureBuildIds`。
- `src/sim.ts` 新增 `Cmd.cancelBuild(w, id, idx)`：**先按 id 找**（找不到再 `ensureBuildIds` 重试），仍不行才退回下标；成功则 `splice` 并返回/写日志 `已取消建设：民用工厂（柏林，已完成 32%）`；重复取消返回失败原因，不会误删别人。
- `src/ui.ts` 建设队列每行加 ✕（`data-cancelbuild`＝id、`data-cancelidx`＝渲染时下标，双保险），处理器调 `cancelBuild` 并 toast。

**验证**：`tests/headless.js` §18（**14 项**：入队唯一 id、240 小时后两项都在涨、用 id 取消（此时下标已错位）仍删对项、文案含建筑名+完成度、取消写日志、重复取消失败、取消后剩余项继续涨且被取消项不复活、玩家队列不被 AI 补项、老存档无 id 用下标兜底、读档补 id 后取消命中正确项）；`tests/dom-smoke.js` 新增 1 步；真 Chrome CDP：物理点击 23×19px 的 ✕ → 队列 2→1、被取消项 id 不再出现在面板、toast 文案正确（整套 15/15 PASS）。

### P1 · 日志被外国要闻淹没，玩家看不到自己的大事（**已修复**）

**现象**：长时间游玩/快进后，玩家自己的「完成国策：重整军备」「完成科技：防空 I」在日志里被 59 国的要闻挤掉（旧实现是全局 500 条 FIFO 环形缓冲，一轮 3 年长跑能产生 1800+ 条要闻）。

**修复**：
- `src/sim.ts`：`PSE.log` 容量策略改为「**玩家相关保底 + 优先淘汰无关要闻**」——`LOG_GROW = 1000`（超过才压缩）、`LOG_CAP = 800`（压缩目标）；`trimLog` 从最旧开始先丢 `!isPlayerLog` 的条目，全是玩家消息时才退化为 FIFO。
- `isPlayerLog(w, e)`：`tag` 为空（全局提示）/ 玩家自己 / 盟友 / **交战国**算「我方相关」，中立国要闻不算。
- `src/ui.ts` + `index.html`：日志面板加「仅我方 / 全部世界」切换（默认**仅我方**）；按钮是静态 HTML、每次渲染重挂事件（幂等，UI tick 重建也不会吞点击）；空列表给「最近还没有我方消息，切「全部世界」看看别国动静」。

**顺带修掉的真机问题**：`#toasts` 容器是 `position:fixed; right/bottom:14px; z-index:300` 且**没有 `pointer-events:none`**，于是 toast 显示的那几秒会把右下角的点击全吞掉——「仅我方 / 全部世界」按钮正在那一带，真实点击被热区挡下（CDP `elementFromPoint` 命中 `DIV.toast`）。已给 `#toasts` 加 `pointer-events:none`。

**验证**：`tests/headless.js` §19（**8 项**：玩家相关判定、3000 条无关要闻后玩家的国策/科研日志仍在、容量 ≤1000、交战方消息保底、真实 1800 小时长跑里 600 小时前的玩家消息全部保留且期间确实产生 1800+ 条要闻）；`tests/dom-smoke.js` 新增 1 步（切「全部世界」能看到别国消息、2000 条要闻后玩家消息仍在）；真 Chrome CDP 15/15 PASS（物理点击两个按钮切换过滤、等 4 个 UI tick 后仍可点、2500 条要闻后玩家消息仍在、0 console 错误）；截图 `tests/queue_log_fix.png`（267 KB，已人工确认：建设队列只剩一项、日志默认「仅我方」）。

---

## 5. 剩下的既定要求（来自用户）

| 要求 | 出处 | 状态 |
|---|---|---|
| 修到"没有任何一点 bug"再推送 | m01338 | P0/P1 + 本轮三件事已修并本地提交（`d51d3cc` + `0cee85a` + `851312d` + `8dcd51d` + 本次），待用户确认后推送 |
| 每次修完自己跑测试并全面复查代码 | m01338 | 持续执行中（现 216/216 + 60/60） |
| 交接文档 | m01471 | **本文档** |
| 自主推进、不要频繁确认 | 会话早期多轮 | 持续遵守 |
| 把聚在一地的师拆开、给每个师起名字、按名字组合 | 用户（本轮） | **已实现**：师团名带兵种（如 德国·第3装甲师）；「陆军」面板逐个师点选（拆堆叠）、按名字组合选中、「存为编组」一键召回（随存档持久化） |
| 集团军数量与编成可自定义 | 用户（本轮） | **已实现**：`PSE.Army.add/remove/rename/setGeneral/setDivisions/releaseDivisions/autoFill`；面板上 新建集团军/解散/改名/换将/编入选中师/调出选中师/自动补齐；手动编成（`d.armyManual`）不被每日自动编组覆盖，`ensure` 改用 `c.armiesInit` 标记（玩家可把集团军全解散而不被重建） |
| 点开生产线的下拉「闪一下变白」 | 用户（本轮） | **已修复**：面板每 350ms 整块 `innerHTML` 重建（见 §4），改为「内容签名不动就不重建 + 正在交互（焦点在 select/input）时挂起；重绘后按 id 恢复下拉选择/焦点」，并给聊天/日志加 `willChange: transform` 减重排 |
| 有空的军工工厂，点「新增产线」却说「没有空闲」 | 用户（本轮） | **已修复**：面板显示的 `空闲` 与命令 `Prod.freeMil` 不是同一口径（面板 `free = mil - used` 只减了「已分配产线数」，命令还要求有空闲工厂且选中项是陆/空军装备；选到舰船/未知装备会直接报没有空闲）。现在统一用 `PSE.Cmd.prodFreeMil()`，提示区分「占用中」与「真没有工厂」，并在空闲为 0 时给出「怎么才有空闲」的指引 |
| 国策 / 科研等面板要能全屏观看、使用 | 用户（本轮） | **已实现**：面板右上「⛶ 全屏」/ `Shift+F` / URL `&panelfs=1`；全屏后 `#side` 铺满窗口，顶部条可一键切换 政治/生产/装备/科研/国策/陆军/海军/空军/谍报/外交/后勤/战报，国策树/科研列表按窗口高度放大，`Esc` 退出；地图全屏仍是 `F` |
| 开局「选择国家」下拉显示不全、点开闪白 | 用户（本轮） | **已修复**：全站改为主题化下拉组件 `PSE.SelectUI`（原生 select 保留 value/change 语义，页面内弹层，见 §4） |
| 装备设计器的下拉选了不生效 | Chief 实测（本轮） | **已修复**：`[data-design]` 绑定不再对无冒号的 key 做 `split(':')`，select 上写 `data-design="chassis"` 即可（见 §4） |

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
| `Navy.daily` 周界会先重建舰队 | `w.hour % (24*7) === 0` 时 `Navy.daily` 会先对每个国家调 `Navy.reorganize`（按库存舰船重建舰队，`Navy.power<=0` 则清空）——单测里手工构造舰队验证海战日志时，必须临时 `PSE.Navy.reorganize = () => {}`（对应 §4 P3），否则舰队被重建 |
| 桌面壳 / PWA | 页面加载前注入 `window.PSE_HOST`（契约见 §3）；无宿主时 `PSE.Platform.kind()==='web'`、存档走 localStorage。**桌面判定看"有没有宿主"（isDesktop），kind 只是标签**——Go+WebView2 壳报 `webview2` 也照样算桌面。桌面壳已完成，见 **§7**（Go + WebView2，`https://panorama.local/` 虚拟主机，不走 file://），web 侧只需保住这个契约 |
| 本地服务 | `node server.js 8787`；已加 `no-store` 缓存头（改了 JS 不生效时先怀疑缓存） |
| 复现地图 bug 的最短路径 | `?auto=GER&speed=3&days=60&zoom=1&layer=political` → 看顶部/高纬是否出现横带；`zoom=2` 多截几次看是否空白 |
| 改了 `tools/build-map.js` 必须重跑生成器 | `node tools/build-map.js` 会重写 `data/map-generated.js`（666 KB，会整行进 diff）——别忘了跑；判「沿海」用**省城到真实海岸线的距离**（`COAST_MAX_DIST`），别再退回海区矩形（柏林/马德里离北海矩形不到 1.5° 会被误判，对应 §4 沿海港口那条） |
| 登陆/空降的合法性口径 | 用 `PSE.Sim.passable(w, target, tag)` 判（`src/sim.ts:96`，陆路寻路同一口径）——己方 / 同阵营 / 交战国控制 / 控制方中立但宗主国交战才可进入；别另写一套「是不是敌国」的判断，否则会和移动规则分叉（对应 §4 未宣战登陆那条） |
| 无头环境看 DOM | `tests/dom-smoke.js` 是自研最小 DOM 桩：`document.getElementById` + canvas 代理 + `select` 真实子节点；面板断言要用 `const UI = PSE.UI`（`PSE.Game` 里只有 `world/start`），新增加载脚本要同步 `tests/headless.js` 的 `FILES` 与 `tests/dom-smoke.js` 的加载数组 |
| DOM 桩的属性选择器 | 桩的 `querySelectorAll` 现在会从 `innerHTML` 解析 `[attr]` / `[attr="v"]`（`parseAttrEls`，按 innerHTML 快照缓存，返回同一批对象），所以面板/日志按钮上挂的 `onclick` 能在桩里被 `click()` 点到；其它选择器仍返回 `[]` |
| 覆盖层会吞点击 | `#toasts`（右下角 fixed、z-index 300）原先没设 `pointer-events:none`：toast 显示的那几秒，右下角所有点击都被它吃掉（CDP `elementFromPoint` 命中 `DIV.toast`，日志的「仅我方/全部世界」按钮就在那一带）。已修；以后新增 fixed 覆盖层一律带 `pointer-events:none` |

---

## 7. Windows 桌面版（Go + WebView2 壳，已完成）

产物：`desktop\dist\PSE-Panorama\`（exe 3.58 MB / 3 752 960 字节，SHA256 `2CFA6F69…D1BA6FE` ＋ `www\` 17 文件 1.30 MB，另可出 1.84 MB 的 zip；同目录 `build-info.txt` 记这份 www 的来源 commit / 是否干净 / 组装时间，验收报告头会读它）。全程**只动 `desktop/`**，不碰 `src/`、`index.html`、`data/`、`tests/`、`tools/`。

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -Zip      # 出包（自检段也走离屏，不弹窗口）
powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -SelfTest # 出包 + 冒烟自检
powershell -ExecutionPolicy Bypass -File desktop\verify.ps1 -FreshUserData  # 11 组 34 项验收（全程无可见窗口）
```

**要分发的产物必须来自已提交的干净源码**（工作树里可能有别人未提交的改动）：`git archive -o <tar> --format=tar HEAD` 解到临时目录，再 `build.ps1 -RepoRoot <临时目录> -SourceCommit <short sha> -Zip`；这样 www 对应一个确定的 commit，`build-info.txt` 与验收报告头都写那个 commit。

七条硬性设计（理由都是实测踩出来的）：

1. **不用 `file://`，用 `SetVirtualHostNameToFolderMapping` 映射成 `https://panorama.local/`** —— file:// 下 WebView2 的 localStorage 不可靠会丢存档；虚拟主机是正常 https 源，零端口零防火墙弹窗。
2. **`UserDataFolder=%LOCALAPPDATA%\PSE-Panorama`**，存档（`EBWebView\Default\Local Storage`）与窗口记忆（`window-state.json`）都在这里，删目录即清档。
3. **只拦 F11**（`AcceleratorKeyCallback` 里 `vk==0x7B`）：`F`/`Shift+F`/`Esc`/数字键/`L`/`S` 全部透传，并 `AreDefaultContextMenusEnabled=false` 让右键归游戏用。
4. **PerMonitorV2 DPI + 窗口位置尺寸记忆（含跨屏 clamp）+ 单实例**（`Local\PSE-Panorama-Shell` 互斥体，第二次双击切前台）。
5. **应用图标与游戏同源**：`desktop\make-icon.ps1` 用 GDI+ 按 Android 版 `splash_logo.xml` 的 108×108 设计图画出 `app.ico`（深蓝底 + 金色地球 + 指北星，16/24/32/48/64 为 DIB 条目、128/256 为 PNG 条目），`go-winres` 按 `winres\winres.json` 把它和应用清单（`permonitorv2,system`）、版本信息一起编成 `rsrc_windows_amd64.syso`（入库，离线可构建）；窗口类 `HIcon/HIconSm` + `WM_SETICON` 用同一份内嵌资源，exe 文件图标 / 标题栏 / 任务栏 / Alt-Tab 四处一致。
6. **冷启动不闪白**：WebView2 的 `put_DefaultBackgroundColor` 默认白色，而页面首帧要等 1.2 MB 同步脚本跑完才画（实测约 3 秒）—— 修前连拍有 **11 帧纯白**（t=227→2943 ms，mean=255、亮像素 100%）。两处都设成页面底色 `#0D1117`（窗口类 `HbrBackground` + 必须在 `Navigate` 前调的 `PutDefaultBackgroundColor`），修后 30 帧 **WHITE=0**、t≈350 ms 起就是深色底。注意绑定库 `GetDefaultBackgroundColor()` 的出参声明是错的（`**COREWEBVIEW2_COLOR`，会把 4 字节颜色写进 8 字节指针并崩在 `applyDefaultBackground`），这里是自己 QueryInterface + 按 vtable 槽 26/27 调用。
7. **验收不打扰用户**：`--pse-offscreen` 让窗口从创建起就在 `-32000,-32000`，截图/抓帧只走 `PrintWindow`（离屏窗口照常渲染，实测 30 帧无节流），验收期间没有任何可见窗口；`--pse-mutex <名字>` 换单实例互斥体名，避免和用户自己跑着的那份打架。

宿主桥 `window.PSE_HOST`（`kind:'webview2'`）必须在**导航之前**注入（`AddScriptToExecuteOnDocumentCreated` 对当前文档无效，顺序反了就是白屏）；kv 基于 localStorage，契约与 `src/platform.ts` 逐项对齐（`store()` 的接口是 `getItem/setItem/removeItem/key/length`）。

**验收实测（`desktop\verify.ps1`，34/34 通过，exit 0，全程无可见窗口）**：宿主桥注入 ✓；`origin=https://panorama.local` ✓；`?auto=GER&speed=3` 自动开局、`canvasMean=50~61`（0＝全黑）✓；启动 进程start→nav-completed **2499~2712 ms**（另一次全量验收 2589~2820 ms；热启动采样 2502~2663 ms）✓；**进程 A 写存档 `hash=2968368646` → 全新进程 B 读回同一 hash** ✓；窗口 `300,150 1280x860` 记忆跨重启 ✓；全屏 `0,0 1920x1080`（无标题栏）开/关 ✓；第二实例 20~42 ms 退出、进程数仍为 1 ✓；运行时回读 `右键菜单=false 开发者工具=false`、`AreDpiAwarenessContextsEqual=1` ✓；**exe 内嵌图标 32×32 像素签名与 `desktop\app.ico` 完全一致** ✓；冷启动抓帧 `WHITE=0 LIGHT=0`、`default-background = #FF0D1117` ✓；`1280x860` 下开始界面 `clippedPx` 全 0 ✓；11/11 次启动都带 `--pse-offscreen` ✓；跑完无残余进程 ✓。截图与《验收报告.md》（含 exe SHA256）在 `desktop\dist\_evidence\`（dist 已 gitignore）。同期 web 两套测试 **172/172 + 57/57**（HEAD `4ed4299`），桌面壳只消费 web 产物、未改任何游戏代码。

**该路线踩过的坑（改壳时注意）**：① 库 `github.com/jchv/go-webview2` 的 `Resize()` 在 controller 未就绪时直接 return，初始 `WM_SIZE` 会丢 → WebView2 永远 0×0、窗口一片白，`Embed()` 成功后必须显式再 `Resize()` 一次；② 该库用 `int64(res) < 0` 判 HRESULT 失败，amd64 上零扩展恒为正 → 失败漏判后空指针崩，别依赖它的错误判断；③ `ICoreWebView2Controller` 的 `Close` 库里只声明字段没实现，得自己按 vtable 槽位 24 调用（先 `PutIsVisible(false)`），否则退出时 localStorage 落盘不干净（实测会冒一行 `can't open file for write !`）；④ `RegisterClassExW` 的 `HCursor` 必须传 `LoadCursorW` 得到的真实句柄，直接写 32512 会 `ERROR_INVALID_PARAMETER`；⑤ 所有 WebView2 COM 调用必须在同一 UI 线程（`runtime.LockOSThread`），在协程里调用会崩；⑥ `winres.json` 的 `RT_GROUP_ICON` 值必须是**字符串**路径（写成数组会被当成 PNG 列表解码，报 `image: unknown format`），`dpi-awareness` 只认 `unaware`/`per monitor`/`per monitor v2`；⑦ 应用清单声明了 DPI 感知后 `SetProcessDpiAwarenessContext` 会返回 `Access is denied`（正常），自证要看 `AreDpiAwarenessContextsEqual`；⑧ **窗口一旦被最小化**，`GetWindowRect` 给的是"图标矩形"（实测 160×28，位于 -32000,-32000）、`GetClientRect` 给 0×0 —— 截图会变废图、退出时还会把退化值写进 `window-state.json`（下次启动就丢窗口记忆）。壳现在的做法：最小化时**拒绝写状态**（`window-state: 跳过写入`），离屏验收模式下截图前先 `SW_RESTORE` 再摆回屏幕外；验收第 4 组专门有一项盯着截图尺寸。⑨ 桌面产物要可复现必须加 `-buildvcs=false`（否则 Go 把 vcs.revision/工作树是否脏写进二进制，同源 exe 哈希每次都变）；⑩ 本机 pwsh 工具其实是 **Windows PowerShell 5.1**，`.ps1` 含中文时必须是 **UTF-8 with BOM**（用 `edit`/`write` 改完要重新加 BOM），否则报一串"表达式或语句中包含意外的标记"。⑪ 打包脚本里**别用"完整路径减前缀"算相对路径**：`%TEMP%` 常被展开成 8.3 短路径（`C:\Users\WUPENG~1\...`），而 `Get-ChildItem` 返回长路径，前缀差对不上就会把多出来的那段当成子目录（曾把 `www\` 装成 `www\src\<8hex>\src\*.js`，页面里没有游戏脚本 → 自检报"世界已开局=False / canvasMean=0"，幸好被 build.ps1 自检拦住）。build.ps1 已改为逐层递归自己拼相对路径，并在组装前清空 `www\`。⑫ PS 5.1 里**别把二进制管道喂给 tar**：`git archive HEAD | tar -x` 会被按文本解码，tar 报一串 `Damaged tar archive (bad header checksum)` 且解出 0 个文件，必须先 `git archive -o <文件>` 再 `tar -xf`；build.ps1 自检改过的 `$env:LOCALAPPDATA` 也已在 `try/finally` 里还原（否则同一个 shell 紧接着跑 verify.ps1 会读到临时目录）。
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
2. 跑两套测试，确认基线仍为 **216/216 + 60/60**（新增主题化下拉/设计器下拉/海战日志/沿海港口/登陆空降门槛/建设队列取消/日志保底回归）（含 §4 P0/P1 的 4 项回归、悬停提示与弹窗点击回归、操作反馈文案回归、生产口径与面板刷新/全屏回归、集团军与平台层回归）
3. 若再动地图算法：改 `tools/build-map.js` → `node tools/build-map.js` 重生成 `data/map-generated.js`（约 1 分钟）→ 两套测试；**任何跨 ±180° 的环都必须先 `splitAntimeridian` 再参与平面运算**
4. 若再动渲染时序：`node <npx 缓存里的 tsc.js> -p tsconfig.json` 编译 → 两套测试 → 多次 `zoom=2` 截图（456KB≈正常，105KB≈空白帧）→ 提交
5. 提交后推送（触发 APK 重建）→ 在 Actions 下载新 APK 实机验证；推送 token 由用户提供
