# PSE 全景战略引擎 · 交接文档

> 交接时间：2026-10-15　｜　仓库：`D:\dsh\panorama`（git，分支 `main`）
> 远端：https://github.com/wzw4429-crypto/panorama-strategy
> 当前健康度：两套测试全绿（**96/96 + 19/19**，含新增的 3 项回归）；**原 P0 地图红色横带已定位并修复**（见 §4），顺带修掉同源的"空白帧"竞态。

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
node --max-old-space-size=3072 tests/headless.js 3     # 94 项：地图/世界/3年长跑/确定性/存档/战斗/扩展系统/剧本
node tests/dom-smoke.js                                # 18 项：DOM 桩渲染 + 全部面板

# 3) 改 TS 后必须重新编译（浏览器加载的是 src/*.js）
npm run build      # = tsc -p tsconfig.json，就地 emit src/*.js
```

游戏内：`空格` 暂停、`1-5` 速度、`L` 切图层、`S` 存档、`~` 控制台。
调试用 URL 参数（`src/main.ts` 末尾解析）：
`?auto=GER&speed=3&days=60&zoom=1&layer=political&tab=equipment&focus=柏林&ironman=0`

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
│   ├── save.ts           localStorage 存档（Node 下降级内存）
│   ├── render.ts         Canvas 渲染 + 7 图层（补给管网/战线折线/海区航线/空域/抵抗/地形/政治）
│   ├── ui.ts             顶栏、10 面板、省份详情、事件与和平弹窗、日志、toast
│   └── main.ts           主循环(rAF)、速度、摄像机输入、快捷键、控制台、自动存档
├── data/
│   ├── countries-110m.json  Natural Earth 110m TopoJSON
│   └── map-generated.js     生成产物：1293 省多边形 + 230 跨海通道 + 26 海区（670 KB）
├── tools/build-map.js    地图生成器（改地图算法后重跑，约 1 分钟）
├── android/              Android WebView 壳（Gradle 工程）
├── .github/workflows/build-apk.yml   CI：tsc → 签名 → 打包 APK
└── tests/                headless.js / dom-smoke.js / probe*.js / *.py 取证脚本
```

关键不变量（改代码时别破坏）：
- 状态纯 JSON 可序列化；**省 id = `w.provinces` 数组下标**
- 确定性：禁止 `Math.random` / `Date.now` 参与世界演化（用 `PSE.rng.fork(salt)`），同种子双跑 `stateHash` 必须一致
- 加载顺序：core → data-rules → map-generated → data-map → world → sim → ai → systems → systems2 → save → render → ui → main
- 渲染投影是**等距圆柱（plate carrée）**：`x=(lon-lonMin)/(lonMax-lonMin)`、`y=(latMax-lat)/(latMax-latMin)`，只此一处（`data-map.ts`），render 一律走 `MD.project/unproject`

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
> 注意：`bandlat.py` 的"画布顶部"探测会被 UI 面板色误判（报 canvas_top=30 是错的，真实约 128），改判据需收紧（面板 `#161c24` 应被排除）。

### P1 · 手机窄屏排版
K80 横屏（1067×480）下工具行按钮被换行挤压，"拖动平移·滚轮/双指缩放…"帮助文本与按钮重叠（见 `tests/k80_land_check.png`）。建议：工具行 `flex-wrap` + 把帮助文本折叠进「玩法说明」弹层。竖屏已在 `f70ab2b` 修好（响应式堆叠 + ResizeObserver）。

### P2 · 杂项
- `package.json` 的 `description` 是乱码（写入时编码坏了，纯 cosmetic）
- PowerShell 读取 UTF-8 文件（含 `.gitignore`、workflow）会显示乱码——**只是显示问题**，文件本身正常，不要"顺手重写"
- `tests/` 下有一批未跟踪的取证脚本（`probe9/10/12-15.js`、`forensics.py`、`pngsample.py`、`rowprofile.py`、`bandlat.py`）与截图；`*.png` 已 gitignore，脚本没有
- README 的功能对照表随 UI 演进可能略有出入，修完 bug 顺带更新

---

## 5. 剩下的既定要求（来自用户）

| 要求 | 出处 | 状态 |
|---|---|---|
| 修到"没有任何一点 bug"再推送 | m01338 | 未完成（P0 横带未修） |
| 每次修完自己跑测试并全面复查代码 | m01338 | 持续执行中 |
| 交接文档 | m01471 | **本文档** |
| 自主推进、不要频繁确认 | 会话早期多轮 | 持续遵守 |

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
| node / npm | 不在 PATH：`C:\Users\wupengyaguangyaxuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（`npm.cmd` 同目录） |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`，用 `--headless=new`；**截图文件异步生成，命令返回后要 `Start-Sleep 5-6s`**；必须带独立 `--user-data-dir`（默认 profile 被占用会静默失败） |
| Python（取证） | `C:\Users\wupengyaguangyaxuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（含 Pillow；`rowprofile.py` 甚至不用它，纯 zlib 解 PNG） |
| `--dump-dom` | 与 `--virtual-time-budget` 同用；输出重定向后同样要等进程结束再读，过早读会得到空文件 |
| 本地服务 | `node server.js 8787`；已加 `no-store` 缓存头（改了 JS 不生效时先怀疑缓存） |
| 复现地图 bug 的最短路径 | `?auto=GER&speed=3&days=60&zoom=1&layer=political` → 看顶部/高纬是否出现横带；`zoom=2` 多截几次看是否空白 |

---

## 7. Android / APK

- 工程：`android/`（`com.pse.panorama`，`versionCode 2` / `versionName 1.1.0`，minSdk 24 / target 34，横屏、常亮、`file:///android_asset/www/index.html`，启动封面 + 图标 + 沉浸模式）
- 签名：PKCS#12 密钥库 `android/app/pse-release.p12`（**已 gitignore，不入库**；本地构建把它放进 `android/app/` 并设 `PANORAMA_KEYSTORE_PASSWORD` 即可自动签名）
- CI：`.github/workflows/build-apk.yml`，push `main` 触发
  1. `npx -y -p typescript@5.6.3 tsc -p tsconfig.json`
  2. 从 secrets 解码密钥库：`PANORAMA_KEYSTORE_B64`（须存在，否则 CI 直接失败）+ `PANORAMA_KEYSTORE_PASSWORD`
  3. `cp -r index.html src data` → `android/app/src/main/assets/www/`
  4. `gradle -p android assembleRelease` → `apksigner verify` → 产物 `panorama-strategy.apk`（Actions artifact `panorama-strategy-apk`）
- 本地旧产物：`apk-out/panorama-strategy.apk`（10/11 的 debug 版，**已过时**，最新请从 Actions 下载）

---

## 8. 交接后建议的第一步

1. `node server.js 8787` + 浏览器打开，确认可玩（当前服务在本机 8787 已起）
2. 跑两套测试，确认基线仍为 **96/96 + 19/19**（含 §4 P0 的 3 项回归）
3. 若再动地图算法：改 `tools/build-map.js` → `node tools/build-map.js` 重生成 `data/map-generated.js`（约 1 分钟）→ 两套测试；**任何跨 ±180° 的环都必须先 `splitAntimeridian` 再参与平面运算**
4. 若再动渲染时序：`node <npx 缓存里的 tsc.js> -p tsconfig.json` 编译 → 两套测试 → 多次 `zoom=2` 截图（456KB≈正常，105KB≈空白帧）→ 提交
5. 提交后推送（触发 APK 重建）→ 在 Actions 下载新 APK 实机验证；推送 token 由用户提供
