// PSE 全景战略引擎 · Windows 桌面壳（Go + WebView2）
//
// 设计要点（与验收标准一一对应）：
//  1. 绝不用 file://。web 资源通过 CoreWebView2.SetVirtualHostNameToFolderMapping
//     映射为 https://panorama.local/ —— 这是 https 源，localStorage / IndexedDB 可靠落盘，
//     存档可跨进程重启保留（file:// 下 WebView2 的 localStorage 不可靠）。
//     选虚拟主机而不是本地 HTTP 服务：零端口占用、零防火墙弹窗、零异步竞态。
//  2. UserDataFolder = %LOCALAPPDATA%\PSE-Panorama，存档随应用独立保存。
//  3. F11 切换全屏；窗口尺寸/位置记忆；禁用 WebView2 默认右键菜单；PerMonitorV2 DPI；单实例。
//  4. 不抢游戏按键：AcceleratorKeyCallback 只拦截 F11(VK 0x7B)，F / Shift+F / Esc 全部透传。
//  5. 桌面壳只消费 web 产物，不修改 src/、index.html、data/。
package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

// ---------------------------------------------------------------- 常量

const (
	appDataName = "PSE-Panorama"
	virtualHost = "panorama.local"
	hostURL     = "https://panorama.local/index.html"
	winClass    = "PSEPanoramaShellWnd"
	winTitle    = "PSE 全景战略引擎"

	stateFile = "window-state.json"
	logFile   = "shell.log"
)

// Win32 常量
const (
	gwlpStyle   = ^uintptr(15) // -16  GWLP_STYLE
	gwlpExStyle = ^uintptr(19) // -20  GWLP_EXSTYLE

	wsCaption     = 0x00C00000
	wsThickFrame  = 0x00040000
	wsMinimizeBox = 0x00020000
	wsMaximizeBox = 0x00010000
	wsSysMenu     = 0x00080000
	wsOverlapped  = 0x00CF0000 // WS_OVERLAPPEDWINDOW

	swShow     = 5
	swRestore  = 9
	swMaximize = 3

	swpNoSize      = 0x0001
	swpNoMove      = 0x0002
	swpNoZOrder    = 0x0004
	swpNoActivate  = 0x0010
	swpFrameChange = 0x0020

	smCXScreen        = 0
	smCYScreen        = 1
	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79

	wmSize          = 0x0005
	wmKeyDown       = 0x0100
	wmKeyUp         = 0x0101
	wmMouseMove     = 0x0200
	wmRButtonDown   = 0x0204
	wmRButtonUp     = 0x0205
	wmMove          = 0x0003
	wmMoving        = 0x0216
	wmSetFocus      = 0x0007
	wmClose         = 0x0010
	wmDestroy       = 0x0002
	wmGetMinMaxInfo = 0x0024
	wmDpiChanged    = 0x02E0
	wmApp           = 0x8000 // 自定义：UI 线程派发队列

	dpiAwarenessPerMonitorV2 = ^uintptr(3) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4

	monitorDefaultToNearest = 2
	idcArrow                = 32512

	pwRenderFullContent = 2 // PrintWindow 标志：抓取 DirectComposition(D3D) 内容
	srccopy             = 0x00CC0020
	captureBLACK        = 0x00FF0000

	minWinW = 960
	minWinH = 600

	keyeventfKeyUp = 0x0002
)

// ---------------------------------------------------------------- Win32 绑定

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")

	pRegisterClassExW         = user32.NewProc("RegisterClassExW")
	pLoadCursorW              = user32.NewProc("LoadCursorW")
	pCreateWindowExW          = user32.NewProc("CreateWindowExW")
	pDefWindowProcW           = user32.NewProc("DefWindowProcW")
	pDestroyWindow            = user32.NewProc("DestroyWindow")
	pPostQuitMessage          = user32.NewProc("PostQuitMessage")
	pGetMessageW              = user32.NewProc("GetMessageW")
	pTranslateMessage         = user32.NewProc("TranslateMessage")
	pDispatchMessageW         = user32.NewProc("DispatchMessageW")
	pPostMessageW             = user32.NewProc("PostMessageW")
	pShowWindow               = user32.NewProc("ShowWindow")
	pGetConsoleWindow         = kernel32.NewProc("GetConsoleWindow")
	pGetConsoleProcessList    = kernel32.NewProc("GetConsoleProcessList")
	pIsZoomed                 = user32.NewProc("IsZoomed")
	pSetWindowPos             = user32.NewProc("SetWindowPos")
	pGetWindowLongPtr         = user32.NewProc("GetWindowLongPtrW")
	pSetWindowLongPtr         = user32.NewProc("SetWindowLongPtrW")
	pGetWindowRect            = user32.NewProc("GetWindowRect")
	pGetClientRect            = user32.NewProc("GetClientRect")
	pFindWindowW              = user32.NewProc("FindWindowW")
	pFindWindowExW            = user32.NewProc("FindWindowExW")
	pSetFocus                 = user32.NewProc("SetFocus")
	pKeybdEvent               = user32.NewProc("keybd_event")
	pClientToScreen           = user32.NewProc("ClientToScreen")
	pSetForeground            = user32.NewProc("SetForegroundWindow")
	pGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	pGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	pGetCurrentThreadId       = kernel32.NewProc("GetCurrentThreadId")
	pAttachThreadInput        = user32.NewProc("AttachThreadInput")
	pBringWindowToTop         = user32.NewProc("BringWindowToTop")
	pSetActiveWindow          = user32.NewProc("SetActiveWindow")
	pSetWindowTextW           = user32.NewProc("SetWindowTextW")
	pSetDpiAwareness          = user32.NewProc("SetProcessDpiAwarenessContext")
	pGetThreadDpiCtx          = user32.NewProc("GetThreadDpiAwarenessContext")
	pDpiCtxEqual              = user32.NewProc("AreDpiAwarenessContextsEqual")
	pMonitorFromWin           = user32.NewProc("MonitorFromWindow")
	pGetMonitorInfoW          = user32.NewProc("GetMonitorInfoW")
	pGetDC                    = user32.NewProc("GetDC")
	pReleaseDC                = user32.NewProc("ReleaseDC")
	pPrintWindow              = user32.NewProc("PrintWindow")

	pCreateMutexW = kernel32.NewProc("CreateMutexW")

	pCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	pSelectObject           = gdi32.NewProc("SelectObject")
	pGetDIBits              = gdi32.NewProc("GetDIBits")
	pDeleteObject           = gdi32.NewProc("DeleteObject")
	pDeleteDC               = gdi32.NewProc("DeleteDC")
	pBitBlt                 = gdi32.NewProc("BitBlt")
)

type point struct{ X, Y int32 }
type rect struct{ Left, Top, Right, Bottom int32 }

// pointT 是 ClientToScreen 用的 POINT
type pointT struct{ X, Y int32 }

// msgT 对应 Win32 MSG（amd64：48 字节；Message 后 4 字节填充对齐 WPARAM）
type msgT struct {
	Hwnd     windows.Handle
	Message  uint32
	_        uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       point
	LPrivate uint32
}

type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}

type minMaxInfo struct {
	PtReserved     point
	PtMaxSize      point
	PtMaxPosition  point
	PtMinTrackSize point
	PtMaxTrackSize point
}

type wndClassExW struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     windows.Handle
	HIcon         windows.Handle
	HCursor       windows.Handle
	HbrBackground windows.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       windows.Handle
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// ---------------------------------------------------------------- 选项 / 状态

type options struct {
	root       string
	userData   string
	capture    string
	evalExpr   string
	jsFile     string
	evalOut    string
	grabCanvas string
	probe      bool
	saveSlot   string
	loadSlot   string
	query      string
	move       string
	keys       string
	fsTest     bool
	inputTest  bool
	holdMs     int
	autoExit   bool
	testMode   bool
}

type winState struct {
	X, Y, W, H int
	Maximized  bool
}

type app struct {
	opt      options
	chromium *edge.Chromium
	hwnd     windows.Handle

	fullscreen bool
	prevStyle  uintptr
	prevRect   rect
	prevMax    bool

	navDone   atomic.Bool
	startAt   time.Time
	navCostMs int64

	qMu sync.Mutex
	q   []func()

	uiReady chan struct{}
}

var theApp *app

// ---------------------------------------------------------------- main

func main() {
	var (
		root        = flag.String("pse-root", "", "覆盖 web 资源根目录（含 index.html）")
		capture     = flag.String("pse-capture", "", "测试：导航完成后整窗截图到指定 PNG 并退出")
		evalExpr    = flag.String("pse-eval", "", "测试：导航完成后执行 JS 表达式，结果从 stdout 打印")
		jsFile      = flag.String("pse-js", "", "测试：从文件读取 JS 表达式执行（避免命令行转义问题）")
		evalOut     = flag.String("pse-eval-out", "", "测试：把 JS 表达式结果额外写入文件")
		grabCanvas  = flag.String("pse-grab-canvas", "", "测试：把页面 canvas 缩略图导出为 PNG（页面内渲染证明）")
		probe       = flag.Bool("pse-probe", false, "测试：输出内置页面渲染诊断信息")
		saveSlot    = flag.String("pse-save", "", "测试：调用游戏 PSE.Save.save(PSE.Game.world, SLOT)")
		loadSlot    = flag.String("pse-load", "", "测试：调用游戏 PSE.Save.load(SLOT)")
		query       = flag.String("pse-query", "", "启动 URL 的 query（游戏调试参数，如 auto=GER&speed=3）")
		move        = flag.String("pse-move", "", "测试：移动/缩放窗口到 x,y,w,h（验证窗口记忆）")
		keys        = flag.String("pse-keys", "", "测试：合成按键序列，如 F11,F11（验证全屏切换）")
		fsTest      = flag.Bool("pse-fullscreen", false, "测试：直接触发全屏切换（与 F11 同一函数）")
		inputTest   = flag.Bool("pse-input", false, "测试：向 WebView2 投递真实鼠标/键盘消息，验证按键透传与右键到达游戏")
		holdMs      = flag.Int("pse-hold", 0, "测试：动作执行完后再保持运行 N 毫秒")
		autoExit    = flag.Bool("pse-exit", false, "测试：动作执行完退出")
		keepConsole = flag.Bool("pse-console", false, "保留控制台窗口（调试用）")
		userDataDir = flag.String("pse-userdata", "", "覆盖用户数据目录（默认 %LOCALAPPDATA%\\PSE-Panorama）")
		version     = flag.Bool("pse-version", false, "打印版本并退出")
	)
	flag.Parse()

	if *version {
		fmt.Printf("pse-desktop %s %s/%s\n", buildVersion, runtime.GOOS, runtime.GOARCH)
		return
	}

	testMode := os.Getenv("PSE_DESKTOP_TEST") == "1" || *capture != "" || *evalExpr != "" ||
		*jsFile != "" || *saveSlot != "" || *loadSlot != "" || *grabCanvas != "" || *probe ||
		*autoExit || *move != "" || *keys != "" || *fsTest || *inputTest

	// 双击启动时不显示黑色控制台窗口：本程序是 console 子系统（这样才能在 CI/脚本里
	// 捕获输出、PowerShell 才会等待它结束），但只在「控制台完全属于自己」时隐藏它 ——
	// 从 cmd/PowerShell 里启动时控制台是共享的，绝不隐藏用户的终端。
	hideOwnConsole(!testMode && !*keepConsole)

	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Dir(os.TempDir())
	}
	suffix := ""
	if testMode {
		suffix = "-test"
	}
	userData := filepath.Join(localAppData, appDataName+suffix)
	// 显式指定时按原样使用（验收测试可以锁定到真实目录，仍然走 -test 之外的路径）
	if *userDataDir != "" {
		userData = *userDataDir
	}
	if err := os.MkdirAll(userData, 0o755); err != nil {
		fatal("无法创建用户数据目录 "+userData, err)
	}

	// 单实例：命名 Mutex。第二个实例把已有窗口带到前台后立即退出。
	mutexName, _ := windows.UTF16PtrFromString(`Local\` + appDataName + `-Shell`)
	h, _, callErr := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(mutexName)))
	if h != 0 && (callErr == windows.ERROR_ALREADY_EXISTS || windows.GetLastError() == windows.ERROR_ALREADY_EXISTS) {
		logf("pid=%d 已有实例在运行（mutex 已存在），把已有窗口带到前台后退出", os.Getpid())
		bringExistingToFront()
		return
	}

	rootDir, err := resolveWebRoot(*root)
	if err != nil {
		fatal("找不到 web 资源（index.html）", err)
	}

	opt := options{
		root: rootDir, userData: userData,
		capture: *capture, evalExpr: *evalExpr, jsFile: *jsFile, evalOut: *evalOut,
		grabCanvas: *grabCanvas, probe: *probe, saveSlot: *saveSlot, loadSlot: *loadSlot,
		query: *query, move: *move, keys: *keys, fsTest: *fsTest, inputTest: *inputTest,
		holdMs: *holdMs, autoExit: *autoExit, testMode: testMode,
	}
	run(opt)
}

const buildVersion = "0.3.0"

// procStart 是包初始化时刻（早于 main），用于冷启动计时。
var procStart = time.Now()

// ---------------------------------------------------------------- 运行

func run(opt options) {
	runtime.LockOSThread() // 全部窗口 / WebView2 调用都必须在同一个 OS 线程上

	// PerMonitorV2：必须在创建任何窗口之前设置。
	if r, _, err := pSetDpiAwareness.Call(dpiAwarenessPerMonitorV2); r == 0 {
		logf("SetProcessDpiAwarenessContext(PerMonitorV2) 失败（忽略）: %v", err)
	} else {
		// 回读验证：确认当前线程确实处于 PerMonitorV2 感知模式
		cur, _, _ := pGetThreadDpiCtx.Call()
		eq, _, _ := pDpiCtxEqual.Call(cur, dpiAwarenessPerMonitorV2)
		logf("dpi-context: PerMonitorV2 = %v (AreDpiAwarenessContextsEqual=%d)", eq != 0, eq)
	}

	theApp = &app{opt: opt, startAt: time.Now(), uiReady: make(chan struct{})}
	a := theApp

	a.chromium = edge.NewChromium()
	a.chromium.DataPath = opt.userData // ← 硬要求 2：存档独立于浏览器
	a.chromium.AcceleratorKeyCallback = a.onAcceleratorKey
	a.chromium.NavigationCompletedCallback = a.onNavigationCompleted
	a.chromium.MessageCallback = a.onWebMessage

	logf("web-root = %s", opt.root)
	logf("user-data = %s", opt.userData)
	logf("test-mode = %v", opt.testMode)
	logf("process-start epoch=%d version=%s", procStart.UnixMilli(), buildVersion)

	// 注册窗口类（关键：wndproc 必须是真实回调，否则消息派发会崩）
	className, _ := windows.UTF16PtrFromString(winClass)
	title, _ := windows.UTF16PtrFromString(winTitle)
	var inst windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &inst)
	// HCursor 必须是 LoadCursorW 返回的真实句柄：直接填 IDC_ARROW 的数值(32512)
	// 会被 RegisterClassExW 判为 ERROR_INVALID_PARAMETER。
	arrow, _, _ := pLoadCursorW.Call(0, uintptr(idcArrow))
	wc := wndClassExW{
		CbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		HInstance:     inst,
		LpszClassName: className,
		LpfnWndProc:   windows.NewCallback(wndProc),
		HCursor:       windows.Handle(arrow),
	}
	if r, _, err := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		fatal("RegisterClassExW 失败", err)
	}

	st := loadWinState(opt.userData)
	logf("window-state loaded = %d,%d %dx%d maximized=%v", st.X, st.Y, st.W, st.H, st.Maximized)
	st = clampToScreen(st)
	hwnd, _, err := pCreateWindowExW.Call(0,
		uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(title)),
		wsOverlapped,
		uintptr(int2u(int64(st.X))), uintptr(int2u(int64(st.Y))),
		uintptr(int2u(int64(st.W))), uintptr(int2u(int64(st.H))),
		0, 0, uintptr(inst), 0)
	if hwnd == 0 {
		fatal("CreateWindowExW 失败", err)
	}
	a.hwnd = windows.Handle(hwnd)

	if st.Maximized {
		pShowWindow.Call(hwnd, uintptr(swMaximize))
	} else {
		pShowWindow.Call(hwnd, uintptr(swShow))
	}
	a.logWinState("startup")

	// WebView2 初始化（内部会泵消息直到 controller 就绪）
	if !a.chromium.Embed(hwnd) {
		fatal("WebView2 初始化失败（WebView2 Runtime 是否已安装？）", fmt.Errorf("Chromium.Embed 返回 false"))
	}

	// 关键：初始 WM_SIZE 发生在 controller 就绪之前（被 Resize() 直接 return 掉），
	// Embed 之后必须显式按客户区尺寸设置一次 bounds，否则 WebView2 一直是 0x0：
	// 页面 viewport 变成默认尺寸、窗口客户区一片空白。
	a.resizeWebView()

	// 禁用默认右键菜单（游戏自己用右键下达命令）等
	if s, err := a.chromium.GetSettings(); err == nil {
		_ = s.PutAreDefaultContextMenusEnabled(false)
		_ = s.PutAreDevToolsEnabled(false)
		_ = s.PutIsStatusBarEnabled(false)
		_ = s.PutAreHostObjectsAllowed(false)
		_ = s.PutIsSwipeNavigationEnabled(false)
		_ = s.PutIsZoomControlEnabled(false)
		// 回读验证：这些设置真的落到 WebView2 上了
		cm, e1 := s.GetAreDefaultContextMenusEnabled()
		dv, e2 := s.GetAreDevToolsEnabled()
		sb, e3 := s.GetIsStatusBarEnabled()
		if e1 == nil && e2 == nil && e3 == nil {
			logf("settings: 右键菜单=%v 开发者工具=%v 状态栏=%v", cm, dv, sb)
		} else {
			logf("settings: 回读失败 %v %v %v", e1, e2, e3)
		}
	} else {
		logf("读取 WebView2 Settings 失败：%v", err)
	}

	// 硬要求 1：虚拟主机映射，而不是 file://
	if wv3 := a.chromium.GetICoreWebView2_3(); wv3 != nil {
		if err := wv3.SetVirtualHostNameToFolderMapping(
			virtualHost, opt.root, edge.COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW); err != nil {
			fatal("SetVirtualHostNameToFolderMapping 失败", err)
		}
		logf("virtual-host = https://%s/ -> %s", virtualHost, opt.root)
	} else {
		fatal("当前 WebView2 Runtime 不支持 ICoreWebView2_3（需要较新的 Edge WebView2）", nil)
	}

	_ = a.chromium.GetController().PutIsVisible(true)
	a.chromium.Focus()

	// PSE_HOST 必须在 Navigate 之前注入：AddScriptToExecuteOnDocumentCreated
	// 只对「之后创建」的文档生效，导航完成后再注入对当前文档无效。
	a.injectHostBridge()
	close(a.uiReady)

	startURL := hostURL
	if opt.query != "" {
		startURL += "?" + opt.query
	}
	a.chromium.Navigate(startURL)
	a.messageLoop()

	// 给 WebView2 浏览器进程一点时间走完 Close 并落盘（localStorage → LevelDB）
	time.Sleep(600 * time.Millisecond)
	logf("exit")
}

func (a *app) messageLoop() {
	var m msgT
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 { // 0 = WM_QUIT，-1 = 错误
			return
		}
		if m.Message == wmApp {
			for _, f := range a.drain() {
				f()
			}
			continue
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

// post 把一个函数排到 UI 线程执行（WebView2 的 COM 调用只能在 UI 线程上做）
func (a *app) post(fn func()) {
	a.qMu.Lock()
	a.q = append(a.q, fn)
	a.qMu.Unlock()
	pPostMessageW.Call(uintptr(a.hwnd), wmApp, 0, 0)
}

func (a *app) drain() []func() {
	a.qMu.Lock()
	q := append([]func(){}, a.q...)
	a.q = nil
	a.qMu.Unlock()
	return q
}

// ---------------------------------------------------------------- 窗口过程

func wndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	a := theApp
	if a == nil {
		r, _, _ := pDefWindowProcW.Call(hwnd, msg, wparam, lparam)
		return r
	}
	switch msg {
	case wmGetMinMaxInfo:
		mmi := (*minMaxInfo)(unsafe.Pointer(lparam))
		mmi.PtMinTrackSize = point{X: minWinW, Y: minWinH}
		return 0
	case wmSize:
		if a.chromium != nil {
			a.chromium.Resize()
		}
		return 0
	case wmMove, wmMoving:
		if a.chromium != nil {
			_ = a.chromium.NotifyParentWindowPositionChanged()
		}
		return 0
	case wmSetFocus:
		if a.chromium != nil {
			a.chromium.Focus()
		}
		return 0
	case wmDpiChanged:
		if lparam != 0 {
			nr := (*rect)(unsafe.Pointer(lparam))
			pSetWindowPos.Call(hwnd, 0,
				uintptr(int2u(int64(nr.Left))), uintptr(int2u(int64(nr.Top))),
				uintptr(nr.Right-nr.Left), uintptr(nr.Bottom-nr.Top),
				swpNoZOrder|swpNoActivate)
		}
		if a.chromium != nil {
			a.chromium.Resize()
		}
		return 0
	case wmClose:
		pDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		a.saveStateNow()
		// 优雅关闭 WebView2：ICoreWebView2Controller::Close()。
		// 不调用 Close 而直接退出，浏览器进程会在宿主进程退出后才被回收，
		// localStorage（LevelDB）的落盘依赖它的正常退出路径 —— 存档「不丢」是硬要求。
		a.closeWebView()
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, msg, wparam, lparam)
	return r
}

// ICoreWebView2Controller vtable 槽位（0 起，前 3 个槽位为 IUnknown）。
// 该绑定库只声明了 vtable 中的 Close 字段，却没有提供调用方法，
// 因此这里用槽位下标直接调用；下标先用 get_Bounds(slot 5) 与库的 GetBounds()
// 做逐字段比对校验，只有校验通过才会调用 Close(slot 24)，避免打错位置崩进程。
const (
	ctrlSlotGetBounds = 5
	ctrlSlotClose     = 24
)

type rectT struct{ Left, Top, Right, Bottom int32 }

func ctrlVtblSlot(c unsafe.Pointer, slot uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(c)
	return *(*uintptr)(unsafe.Add(vtbl, slot*unsafe.Sizeof(uintptr(0))))
}

// verifyControllerVtbl 通过 get_Bounds 校验槽位推算是否正确。
func (a *app) closeWebView() {
	if a.chromium == nil {
		return
	}
	ctrl := a.chromium.GetController()
	if ctrl == nil {
		return
	}
	c := unsafe.Pointer(ctrl)
	_ = ctrl.PutIsVisible(false)

	// 校验：slot 5 读到的矩形必须与库方法 GetBounds() 的结果一致
	var got rectT
	fn := ctrlVtblSlot(c, ctrlSlotGetBounds)
	if fn == 0 {
		logf("webview-close: 跳过（vtable 槽位为空）")
		return
	}
	_, _, _ = syscall.SyscallN(fn, uintptr(c), uintptr(unsafe.Pointer(&got)))
	want := rectT{}
	if r, err := ctrl.GetBounds(); err == nil && r != nil {
		want = *(*rectT)(unsafe.Pointer(r))
	}
	if got != want {
		logf("webview-close: 跳过（槽位校验不一致 slot5=%+v lib=%+v）", got, want)
		return
	}
	if cfn := ctrlVtblSlot(c, ctrlSlotClose); cfn != 0 {
		_, _, _ = syscall.SyscallN(cfn, uintptr(c))
		logf("webview-close: Close() 已调用")
	}
}

// ---------------------------------------------------------------- 键盘：只拦 F11

// shellHandlesAccel 是「外壳是否吃掉这个键」的唯一判据：只有 VK_F11。
// 游戏自身的快捷键（F=地图全屏、Shift+F=面板全屏、Esc=退出面板全屏、
// Space=暂停、1~5=速度、L=切换图层、S=存档…）全部 return false 原样透传。
func shellHandlesAccel(vk uint) bool { return vk == 0x7B } // VK_F11

func (a *app) onAcceleratorKey(vk uint) bool {
	if shellHandlesAccel(vk) {
		a.toggleFullscreen()
		return true
	}
	// F / Shift+F / Esc 等一律透传给游戏
	return false
}

// logAcceleratorMatrix 打印拦截矩阵作为「不抢游戏按键」的运行时证据
func (a *app) logAcceleratorMatrix() {
	keys := []struct {
		name string
		vk   uint
	}{
		{"F", 0x46}, {"F11", 0x7B}, {"Esc", 0x1B}, {"Shift", 0x10}, {"Ctrl", 0x11},
		{"Space", 0x20}, {"L", 0x4C}, {"S", 0x53}, {"1", 0x31}, {"F5", 0x74},
	}
	for _, k := range keys {
		logf("accelerator: %-5s vk=0x%02X 外壳拦截=%v → %s", k.name, k.vk,
			shellHandlesAccel(k.vk), map[bool]string{true: "外壳处理", false: "透传给游戏"}[shellHandlesAccel(k.vk)])
	}
}

func (a *app) toggleFullscreen() {
	if a.fullscreen {
		a.exitFullscreen()
	} else {
		a.enterFullscreen()
	}
}

func (a *app) enterFullscreen() {
	style, _, _ := pGetWindowLongPtr.Call(uintptr(a.hwnd), gwlpStyle)
	a.prevStyle = style
	var r rect
	pGetWindowRect.Call(uintptr(a.hwnd), uintptr(unsafe.Pointer(&r)))
	a.prevRect = r
	a.prevMax = isZoomed(a.hwnd)

	mon := monitorFromWindow(a.hwnd)
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	if r, _, _ := pGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi))); r == 0 {
		mi.RcMonitor = rect{0, 0, int32(getMetric(smCXScreen)), int32(getMetric(smCYScreen))}
	}
	newStyle := style &^ (wsCaption | wsThickFrame)
	pSetWindowLongPtr.Call(uintptr(a.hwnd), gwlpStyle, newStyle)
	pShowWindow.Call(uintptr(a.hwnd), uintptr(swRestore))
	pSetWindowPos.Call(uintptr(a.hwnd), 0,
		uintptr(int2u(int64(mi.RcMonitor.Left))), uintptr(int2u(int64(mi.RcMonitor.Top))),
		uintptr(int2u(int64(mi.RcMonitor.Right-mi.RcMonitor.Left))),
		uintptr(int2u(int64(mi.RcMonitor.Bottom-mi.RcMonitor.Top))),
		swpNoZOrder|swpFrameChange|swpNoActivate)
	a.fullscreen = true
	_ = a.chromium.NotifyParentWindowPositionChanged()
	logf("fullscreen = on")
}

func (a *app) exitFullscreen() {
	pSetWindowLongPtr.Call(uintptr(a.hwnd), gwlpStyle, a.prevStyle)
	pSetWindowPos.Call(uintptr(a.hwnd), 0,
		uintptr(int2u(int64(a.prevRect.Left))), uintptr(int2u(int64(a.prevRect.Top))),
		uintptr(int2u(int64(a.prevRect.Right-a.prevRect.Left))),
		uintptr(int2u(int64(a.prevRect.Bottom-a.prevRect.Top))),
		swpNoZOrder|swpFrameChange|swpNoActivate)
	if a.prevMax {
		pShowWindow.Call(uintptr(a.hwnd), uintptr(swMaximize))
	}
	a.fullscreen = false
	_ = a.chromium.NotifyParentWindowPositionChanged()
	logf("fullscreen = off")
}

// ---------------------------------------------------------------- 导航完成 / 桥

func (a *app) onNavigationCompleted(_ *edge.ICoreWebView2, _ *edge.ICoreWebView2NavigationCompletedEventArgs) {
	if !a.navDone.CompareAndSwap(false, true) {
		return
	}
	a.navCostMs = time.Since(a.startAt).Milliseconds()
	logf("nav-completed cost=%dms epoch=%d (proc-start epoch=%d)", a.navCostMs, time.Now().UnixMilli(), procStart.UnixMilli())
	a.injectHostBridge()
	if a.opt.justTest() {
		go a.testSequence()
	}
}

// justTest：是否请求了任何自动化动作（决定是否启动测试序列）
func (o options) justTest() bool {
	return o.capture != "" || o.evalExpr != "" || o.jsFile != "" || o.saveSlot != "" ||
		o.loadSlot != "" || o.grabCanvas != "" || o.probe || o.autoExit ||
		o.move != "" || o.keys != "" || o.fsTest || o.inputTest
}

// injectHostBridge 注入 window.PSE_HOST，供游戏 src/platform.ts 消费。
// 必须在 Navigate 之前调用：AddScriptToExecuteOnDocumentCreated 只对之后创建的文档生效。
// 契约见 src/platform.ts：{kind, kv:{get,set,remove,keys}, saveFile(name,text,mime),
// openFile()->text|null, notify(title,body), fullscreen(on), openExternal(url)}
func (a *app) injectHostBridge() {
	js := `(function(){ if (window.PSE_HOST) return;
  function post(msg){ try{ window.chrome.webview.postMessage(JSON.stringify(msg)); }catch(e){} }
  window.PSE_HOST = {
    kind: "desktop-go",
    kv: {
      get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
      set: function(k,v){ try{ localStorage.setItem(k, String(v)); return true; }catch(e){ return false; } },
      remove: function(k){ try{ localStorage.removeItem(k); return true; }catch(e){ return false; } },
      keys: function(){ try{ var r=[],i; for(i=0;i<localStorage.length;i++){ r.push(localStorage.key(i)); } return r; }catch(e){ return []; } }
    },
    saveFile: function(name, text, mime){
      try{
        var blob=new Blob([text],{type:mime||"application/json"});
        var url=URL.createObjectURL(blob);
        var a=document.createElement("a"); a.href=url; a.download=name||"save.json";
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },1500);
        return true;
      }catch(e){ return false; }
    },
    openFile: function(){
      return new Promise(function(res){
        try{
          var inp=document.createElement("input"); inp.type="file"; inp.accept=".json,application/json,text/plain";
          inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(!f){ res(null); return; }
            var r=new FileReader(); r.onload=function(){ res(String(r.result)); }; r.onerror=function(){ res(null); }; r.readAsText(f); };
          inp.click();
        }catch(e){ res(null); }
      });
    },
    notify: function(title, body){
      post({pse:"notify", title:String(title==null?"":title), body:String(body==null?"":body)});
    },
    fullscreen: function(on){
      try{ post({pse:"fullscreen", on: !!on}); }catch(e){}
    },
    openExternal: function(url){ try{ post({pse:"openExternal", url:String(url)}); }catch(e){} }
  };
})();`
	a.chromium.Init(js)
}

// onWebMessage 接收 JS 侧 window.chrome.webview.postMessage 的消息
func (a *app) onWebMessage(s string) {
	switch {
	case strings.HasPrefix(s, "PSE_EVAL:"):
		out := strings.TrimPrefix(s, "PSE_EVAL:")
		logf("eval = %s", out)
		if a.opt.evalOut != "" {
			_ = os.WriteFile(a.opt.evalOut, []byte(out), 0o644)
		}
	case strings.HasPrefix(s, "PSE_SAVE:"):
		logf("save = %s", strings.TrimPrefix(s, "PSE_SAVE:"))
	case strings.HasPrefix(s, "PSE_LOAD:"):
		logf("load = %s", strings.TrimPrefix(s, "PSE_LOAD:"))
	case strings.HasPrefix(s, "PSE_PNG:"):
		payload := strings.TrimPrefix(s, "PSE_PNG:")
		if strings.HasPrefix(payload, "ERR:") {
			logf("grab-canvas 失败: %s", strings.TrimPrefix(payload, "ERR:"))
			return
		}
		path := a.opt.grabCanvas
		if path == "" {
			return
		}
		i := strings.Index(payload, "base64,")
		if i < 0 {
			logf("grab-canvas 失败: 非法 dataURL")
			return
		}
		raw, err := base64.StdEncoding.DecodeString(payload[i+7:])
		if err != nil {
			logf("grab-canvas 解码失败: %v", err)
			return
		}
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			logf("grab-canvas 写入失败: %v", err)
			return
		}
		logf("grab-canvas = %s (%d bytes)", path, len(raw))
	default:
		var m map[string]any
		if json.Unmarshal([]byte(s), &m) == nil {
			if v, ok := m["pse"]; ok {
				switch v {
				case "fullscreen":
					on, _ := m["on"].(bool)
					a.post(func() {
						if on != a.fullscreen {
							a.toggleFullscreen()
						}
					})
				case "notify":
					logf("notify: %v | %v", m["title"], m["body"])
				case "openExternal":
					logf("openExternal: %v", m["url"])
				}
				return
			}
		}
		logf("web-message: %s", s)
	}
}

// logWinState：打印窗口当前几何/全屏状态（用于验收证据）
func (a *app) logWinState(tag string) {
	style, _, _ := pGetWindowLongPtr.Call(uintptr(a.hwnd), gwlpStyle)
	var r rect
	pGetWindowRect.Call(uintptr(a.hwnd), uintptr(unsafe.Pointer(&r)))
	logf("%s: rect=%d,%d %dx%d fullscreen=%v caption=%v thickframe=%v maximized=%v",
		tag, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top,
		a.fullscreen, style&wsCaption != 0, style&wsThickFrame != 0, isZoomed(a.hwnd))
}

// pressKey：合成一次按键（走真实输入路径，验证 AcceleratorKeyCallback）
func pressKey(vk uint32) {
	pKeybdEvent.Call(uintptr(vk), 0, 0, 0)
	time.Sleep(60 * time.Millisecond)
	pKeybdEvent.Call(uintptr(vk), 0, keyeventfKeyUp, 0)
}

// forceForeground 强行把窗口提到前台：直接 SetForegroundWindow 在后台进程里常被系统拒绝，
// 先 AttachThreadInput 到当前前台线程即可绕过该限制。
func forceForeground(hwnd windows.Handle) bool {
	pShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
	pBringWindowToTop.Call(uintptr(hwnd))
	fg, _, _ := pGetForegroundWindow.Call()
	myThread, _, _ := pGetCurrentThreadId.Call()
	fgThread, _, _ := pGetWindowThreadProcessId.Call(fg, 0)
	if fg != 0 && fgThread != 0 && fgThread != myThread {
		pAttachThreadInput.Call(myThread, fgThread, 1)
		pSetForeground.Call(uintptr(hwnd))
		pAttachThreadInput.Call(myThread, fgThread, 0)
	} else {
		pSetForeground.Call(uintptr(hwnd))
	}
	pSetActiveWindow.Call(uintptr(hwnd))
	pSetFocus.Call(uintptr(hwnd))
	time.Sleep(250 * time.Millisecond)
	now, _, _ := pGetForegroundWindow.Call()
	return now == uintptr(hwnd)
}

// postKeyToWebView 把按键直接投递给 WebView2 的子窗口（不依赖进程是否处于前台，
// 用于自动化验证 AcceleratorKeyCallback 这条链路）。
func postKeyToWebView(hwnd windows.Handle, vk uint32) {
	child, _, _ := pFindWindowExW.Call(uintptr(hwnd), 0, 0, 0)
	if child == 0 {
		logf("postKeyToWebView: 找不到 WebView2 子窗口")
		return
	}
	pPostMessageW.Call(child, wmKeyDown, uintptr(vk), 0x00140001)
	time.Sleep(60 * time.Millisecond)
	pPostMessageW.Call(child, wmKeyUp, uintptr(vk), 0xC0140001)
}

// ---------------------------------------------------------------- 输入透传验证

// jsInputInstall 在页面里挂监听，记录真正到达游戏的键盘 / 鼠标事件。
const jsInputInstall = `(function(){
  if (!window.__pseInput) {
    window.__pseInput = {keys: [], ctx: 0, rdown: 0, lbd: 0, f11: 0};
    window.addEventListener('keydown', function(e){
      var rec = e.key + '/preventDefault=' + e.defaultPrevented;
      if (e.key === 'F11') { window.__pseInput.f11++; } else { window.__pseInput.keys.push(rec); }
    }, true);
    window.addEventListener('contextmenu', function(){ window.__pseInput.ctx++; }, true);
    window.addEventListener('mousedown', function(e){
      if (e.button === 2) { window.__pseInput.rdown++; } else if (e.button === 0) { window.__pseInput.lbd++; }
    }, true);
  }
  return 'input-listeners-installed';
})()`

const jsInputRead = `JSON.stringify(window.__pseInput || null)`

// postMouse 用 PostMessage 向 WebView2 子窗口投递鼠标消息（lParam = y<<16|x，客户区坐标）
func postMouse(child uintptr, msg uint32, x, y int32) {
	lp := uintptr(uint32(y)&0xFFFF)<<16 | uintptr(uint32(x)&0xFFFF)
	pPostMessageW.Call(child, uintptr(msg), 0, lp)
}

// inputPassthroughTest 验证「外壳不抢游戏输入」：
//   - 右键必须到达页面（游戏靠右键下达命令），默认右键菜单已在 settings 里关掉；
//   - F / Esc 等按键必须原样透传（AcceleratorKeyCallback 只对 VK_F11 返回 true）；
//   - F11 由外壳吃掉（切全屏），页面内的 F11 计数应保持 0。
func (a *app) inputPassthroughTest() {
	a.post(func() { a.chromium.Eval(jsEval(jsInputInstall)) })
	time.Sleep(700 * time.Millisecond)

	child, _, _ := pFindWindowExW.Call(uintptr(a.hwnd), 0, 0, 0)
	if child == 0 {
		logf("input-test: 找不到 WebView2 子窗口")
		return
	}
	var cr rect
	pGetClientRect.Call(child, uintptr(unsafe.Pointer(&cr)))
	cx := (cr.Right - cr.Left) / 2
	cy := (cr.Bottom - cr.Top) / 2
	logf("input-test: webview-child=%#x client=%dx%d 目标点=%d,%d", child, cr.Right-cr.Left, cr.Bottom-cr.Top, cx, cy)

	// 右键
	postMouse(child, wmMouseMove, cx, cy)
	time.Sleep(150 * time.Millisecond)
	postMouse(child, wmRButtonDown, cx, cy)
	time.Sleep(180 * time.Millisecond)
	postMouse(child, wmRButtonUp, cx, cy)
	time.Sleep(500 * time.Millisecond)

	// 游戏按键：F（地图全屏）、Esc（退出面板全屏）
	postVkToChild(child, 0x46)
	time.Sleep(200 * time.Millisecond)
	postVkToChild(child, 0x1B)
	time.Sleep(200 * time.Millisecond)
	postVkToChild(child, 0x46)
	time.Sleep(300 * time.Millisecond)

	// F11：外壳拦截
	wasFs := a.fullscreen
	postVkToChild(child, 0x7B)
	time.Sleep(1000 * time.Millisecond)
	logf("input-test: 按 F11 后 外壳 fullscreen %v -> %v", wasFs, a.fullscreen)
	if a.fullscreen {
		a.post(func() { a.toggleFullscreen() })
		time.Sleep(800 * time.Millisecond)
	}

	a.post(func() { a.chromium.Eval(jsEval(jsInputRead)) })
	time.Sleep(900 * time.Millisecond)
	logf("input-test: 说明 —— WebView2 不处理 PostMessage 注入的伪输入（它只接受真实输入队列），" +
		"本自动化会话又拿不到交互前台，因此键盘/鼠标注入无法端到端复现；" +
		"「不抢游戏输入」的保证来自下面这张拦截矩阵 + settings 回读 + 页面内 preventDefault 记录。")
	a.logAcceleratorMatrix()
}

// postVkToChild 向指定子窗口投递一次按下+抬起
func postVkToChild(child uintptr, vk uint32) {
	pPostMessageW.Call(child, wmKeyDown, uintptr(vk), 0x00140001)
	time.Sleep(60 * time.Millisecond)
	pPostMessageW.Call(child, wmKeyUp, uintptr(vk), 0xC0140001)
}

// vkOf：按键名 → 虚拟键码
func vkOf(name string) (uint32, bool) {
	switch strings.ToUpper(name) {
	case "F11":
		return 0x7B, true
	case "ESC", "ESCAPE":
		return 0x1B, true
	case "F":
		return 0x46, true
	}
	return 0, false
}

// parseMove：解析 "x,y,w,h"
func parseMove(s string) (x, y, w, h int, ok bool) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return 0, 0, 0, 0, false
	}
	vals := make([]int, 4)
	for i, p := range parts {
		v, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return 0, 0, 0, 0, false
		}
		vals[i] = v
	}
	if vals[2] <= 0 || vals[3] <= 0 {
		return 0, 0, 0, 0, false
	}
	return vals[0], vals[1], vals[2], vals[3], true
}

// ---------------------------------------------------------------- 测试钩子

func (a *app) testSequence() {
	time.Sleep(3500 * time.Millisecond) // 等游戏首帧稳定

	// 窗口位置/尺寸（验证记忆 + clamp）
	if a.opt.move != "" {
		if x, y, w, h, ok := parseMove(a.opt.move); ok {
			logf("move-request = %d,%d %dx%d", x, y, w, h)
			pSetWindowPos.Call(uintptr(a.hwnd), 0,
				uintptr(int2u(int64(x))), uintptr(int2u(int64(y))),
				uintptr(int2u(int64(w))), uintptr(int2u(int64(h))), swpNoZOrder)
			time.Sleep(700 * time.Millisecond)
			a.logWinState("after-move")
		} else {
			logf("--pse-move 参数非法: %q（应为 x,y,w,h）", a.opt.move)
		}
	}

	// 按键序列（如 F11,F11）：验证全屏切换走真实按键路径
	if a.opt.keys != "" {
		for i, name := range strings.Split(a.opt.keys, ",") {
			name = strings.TrimSpace(name)
			vk, ok := vkOf(name)
			if !ok {
				logf("未知按键: %q（支持 F11/Esc/F）", name)
				continue
			}
			want := !a.fullscreen
			done := false
			for attempt := 1; attempt <= 3 && !done; attempt++ {
				method := "keybd_event"
				if attempt <= 2 {
					fg := forceForeground(a.hwnd)
					logf("press-key[%d] = %s：前台=%v（attempt=%d）", i, name, fg, attempt)
					pressKey(vk)
				} else {
					method = "postmessage"
					postKeyToWebView(a.hwnd, vk)
				}
				time.Sleep(1100 * time.Millisecond)
				if a.fullscreen == want {
					done = true
					logf("press-key[%d] = %s 生效（%s, attempt=%d）", i, name, method, attempt)
				} else {
					logf("press-key[%d] = %s 未生效（%s, attempt=%d）", i, name, method, attempt)
				}
			}
			a.logWinState("after-key-" + name)
		}
	}

	// 直接触发全屏切换（与 F11 走同一个 toggleFullscreen()）。用于在没有交互前台的
	// 自动化会话里确定性验证全屏状态机；截图会拍到全屏后的画面。
	if a.opt.fsTest {
		a.post(func() { a.toggleFullscreen() })
		time.Sleep(1200 * time.Millisecond)
		a.logWinState("fullscreen-on")
	}

	if a.opt.probe {
		a.logWebViewBounds()
		a.post(func() { a.chromium.Eval(jsEval(probeExpr)) })
		time.Sleep(900 * time.Millisecond)
	}
	if a.opt.inputTest {
		a.inputPassthroughTest()
	}
	expr := a.opt.evalExpr
	if a.opt.jsFile != "" {
		if b, err := os.ReadFile(a.opt.jsFile); err == nil {
			expr = string(b)
		} else {
			logf("读取 --pse-js 失败: %v", err)
		}
	}
	if expr != "" {
		a.post(func() { a.chromium.Eval(jsEval(expr)) })
		time.Sleep(900 * time.Millisecond)
	}
	if a.opt.saveSlot != "" {
		a.post(func() { a.chromium.Eval(jsSave(a.opt.saveSlot)) })
		time.Sleep(1600 * time.Millisecond)
	}
	if a.opt.loadSlot != "" {
		a.post(func() { a.chromium.Eval(jsLoad(a.opt.loadSlot)) })
		time.Sleep(1600 * time.Millisecond)
	}
	if a.opt.grabCanvas != "" {
		a.post(func() { a.chromium.Eval(jsGrabCanvas) })
		time.Sleep(1500 * time.Millisecond)
	}
	if a.opt.capture != "" {
		done := make(chan struct{})
		a.post(func() {
			a.captureTo(a.opt.capture)
			close(done)
		})
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			logf("截图超时")
		}
		time.Sleep(400 * time.Millisecond)
	}
	if a.opt.holdMs > 0 {
		time.Sleep(time.Duration(a.opt.holdMs) * time.Millisecond)
	}
	// 全屏测试收尾：切回窗口模式，验证恢复逻辑
	if a.opt.fsTest {
		a.post(func() { a.toggleFullscreen() })
		time.Sleep(1200 * time.Millisecond)
		a.logWinState("fullscreen-off")
	}
	a.post(func() { pPostMessageW.Call(uintptr(a.hwnd), wmClose, 0, 0) })
}

// resizeWebView 按当前客户区尺寸同步 WebView2 bounds（UI 线程调用）
func (a *app) resizeWebView() {
	if a.chromium == nil {
		return
	}
	a.chromium.Resize()
}

// logWebViewBounds：打印 WebView2 controller 实际 bounds（必须在 UI 线程调用）
func (a *app) logWebViewBounds() {
	done := make(chan struct{})
	a.post(func() {
		if c := a.chromium.GetController(); c != nil {
			if b, err := c.GetBounds(); err == nil && b != nil {
				logf("wv2-bounds = %d,%d %dx%d", b.Left, b.Top, b.Right-b.Left, b.Bottom-b.Top)
			} else {
				logf("wv2-bounds 读取失败: %v", err)
			}
		}
		close(done)
	})
	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}
}

// probeExpr：内置渲染诊断，避免命令行转义问题
const probeExpr = `(function(){
  var out={vis:document.visibilityState,focus:document.hasFocus(),title:document.title,
    canvases:document.querySelectorAll('canvas').length,bodyLen:document.body.innerHTML.length,
    origin:location.origin,host:!!window.PSE_HOST,
    storeKind:(window.PSE&&PSE.Platform&&PSE.Platform.storeKind)?PSE.Platform.storeKind():null,
    world:!!(window.PSE&&PSE.Game&&PSE.Game.world),
    hour:(window.PSE&&PSE.Game&&PSE.Game.world)?PSE.Game.world.hour:null,
    innerW:window.innerWidth,innerH:window.innerHeight,dpr:window.devicePixelRatio,
    vvScale:(window.visualViewport?window.visualViewport.scale:null)};
  var cv=document.querySelector('canvas');
  if(cv){var b=cv.getBoundingClientRect();
    out.cssW=Math.round(b.width);out.cssH=Math.round(b.height);
    out.cssX=Math.round(b.left);out.cssY=Math.round(b.top);
    out.styleW=cv.style.width||null;out.styleH=cv.style.height||null;}
  var c=document.querySelector('canvas');
  if(c){
    out.cw=c.width; out.ch=c.height;
    try{
      var g=c.getContext('2d');
      if(g&&c.width>0&&c.height>0){
        var W=Math.min(c.width,400),H=Math.min(c.height,300);
        var d=g.getImageData(0,0,W,H).data,s=0,n=0;
        for(var i=0;i<d.length;i+=4){ s+=(d[i]+d[i+1]+d[i+2])/3; n++; }
        out.canvasMean=Math.round(s/n);
      }
    }catch(e){ out.err=String(e&&e.message); }
  }
  return out;})()`

// jsGrabCanvas：把页面主 canvas 缩放到 <=600px 宽后以 dataURL 回传（页面内渲染证明）
const jsGrabCanvas = `(function(){
  var c=document.querySelector('canvas');
  if(!c){ window.chrome.webview.postMessage('PSE_PNG:ERR:no-canvas'); return; }
  try{
    var s=Math.min(1,600/c.width);
    var t=document.createElement('canvas');
    t.width=Math.max(1,Math.round(c.width*s)); t.height=Math.max(1,Math.round(c.height*s));
    var g=t.getContext('2d'); g.drawImage(c,0,0,t.width,t.height);
    window.chrome.webview.postMessage('PSE_PNG:'+t.toDataURL('image/png'));
  }catch(e){ window.chrome.webview.postMessage('PSE_PNG:ERR:'+(e&&e.message)); }
})()`

func jsEval(expr string) string {
	return `(function(){var out;try{var r=(` + expr + `);` +
		`out=(typeof r==="string")?r:JSON.stringify(r);}catch(e){out="ERR:"+(e&&e.message);}` +
		`window.chrome.webview.postMessage("PSE_EVAL:"+out);})()`
}

func jsSave(slot string) string {
	return `(function(){var out;try{` +
		`if(typeof PSE==="undefined"||!PSE.Save||!PSE.Save.save){out="no-PSE.Save";}` +
		`else if(!PSE.Game||!PSE.Game.world){out="no-PSE.Game.world";}` +
		`else{out=JSON.stringify(PSE.Save.save(PSE.Game.world, ` + strconv.Quote(slot) + `));}` +
		`}catch(e){out="ERR:"+(e&&e.message);}` +
		`window.chrome.webview.postMessage("PSE_SAVE:"+out);})()`
}

// jsLoad：从存档读回并复活的验证钩子（存档跨重启保留的硬证据）。
// 顺序：先 list()（证明存储里有存档）→ load(slot) → 校验 world 里的关键字段。
func jsLoad(slot string) string {
	q := strconv.Quote(slot)
	return `(function(){var out={};try{` +
		`out.hasPSE=(typeof PSE!=="undefined");` +
		`out.list=(PSE&&PSE.Save&&PSE.Save.list)?PSE.Save.list():null;` +
		`if(PSE&&PSE.Save&&PSE.Save.load){` +
		`var w=PSE.Save.load(` + q + `);` +
		`if(w){out.ok=true;out.day=w.day;out.hour=w.hour;out.year=w.year;` +
		`out.countries=(w.countries&&w.countries.length)||0;out.tag=(w.playerTag||w.tag||null);` +
		`out.gameworld=!!(PSE.Game&&PSE.Game.world);` +
		`if(PSE.Game)PSE.Game.world=w;out.gameworldAfter=!!(PSE.Game&&PSE.Game.world);}` +
		`else{out.ok=false;out.reason="load-returned-null";}}else{out.ok=false;out.reason="no-PSE.Save.load";}` +
		`out.raw=(PSE&&PSE.Platform&&PSE.Platform.store)?(PSE.Platform.store().getItem("pse_save_` + slot + `")?"raw-present":"raw-missing"):"no-store";` +
		`}catch(e){out.err=String(e&&e.message);}` +
		`window.chrome.webview.postMessage("PSE_LOAD:"+JSON.stringify(out));})()`
}

// ---------------------------------------------------------------- 截图

func (a *app) captureTo(path string) {
	var r rect
	pGetWindowRect.Call(uintptr(a.hwnd), uintptr(unsafe.Pointer(&r)))
	w := int(r.Right - r.Left)
	h := int(r.Bottom - r.Top)
	if w <= 0 || h <= 0 {
		logf("截图失败：窗口尺寸无效 %dx%d", w, h)
		return
	}

	// 两种方式都抓一次，按「客户区内容丰富度」打分选优：
	// PrintWindow 对 WebView2 的 DComp 合成常给纯白/纯黑，而纯白图在整窗范围内
	// 因边框/标题栏有对比，单靠 isBlank 会误判为有效。
	var (
		pwImg, scrImg *image.RGBA
		pwOK, scrOK   bool
	)
	pwImg, pwOK = capturePrintWindow(a.hwnd, w, h)
	pSetForeground.Call(uintptr(a.hwnd))
	time.Sleep(700 * time.Millisecond)
	scrImg, scrOK = captureScreen(r, w, h)

	// 客户区在整窗图中的偏移（左上角），用于只对游戏画面打分
	cx, cy := clientOriginOffset(a.hwnd, r)
	cw, ch := clientSize(a.hwnd)

	method := "none"
	scorePW, scoreScr := -1, -1
	if pwOK {
		scorePW = contentScore(pwImg, cx, cy, cw, ch)
	}
	if scrOK {
		scoreScr = contentScore(scrImg, cx, cy, cw, ch)
	}
	logf("capture-scores: printwindow=%d screen=%d (client %dx%d at %d,%d)", scorePW, scoreScr, cw, ch, cx, cy)

	var img *image.RGBA
	switch {
	case scrOK && scoreScr >= scorePW:
		img, method = scrImg, "screen"
	case pwOK:
		img, method = pwImg, "printwindow"
	}
	if img == nil {
		logf("截图失败：两种方式都拿不到位图")
		return
	}
	f, err := os.Create(path)
	if err != nil {
		logf("截图写入失败: %v", err)
		return
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		logf("截图编码失败: %v", err)
		return
	}
	logf("capture = %s (%dx%d, %s)", path, w, h, method)
}

func capturePrintWindow(hwnd windows.Handle, w, h int) (*image.RGBA, bool) {
	hdc, _, _ := pGetDC.Call(uintptr(hwnd))
	if hdc == 0 {
		return nil, false
	}
	defer pReleaseDC.Call(uintptr(hwnd), hdc)
	mdc, _, _ := pCreateCompatibleDC.Call(hdc)
	if mdc == 0 {
		return nil, false
	}
	defer pDeleteDC.Call(mdc)
	bmp, _, _ := pCreateCompatibleBitmap.Call(hdc, uintptr(w), uintptr(h))
	if bmp == 0 {
		return nil, false
	}
	defer pDeleteObject.Call(bmp)
	old, _, _ := pSelectObject.Call(mdc, bmp)
	defer pSelectObject.Call(mdc, old)
	if r, _, _ := pPrintWindow.Call(uintptr(hwnd), mdc, pwRenderFullContent); r == 0 {
		return nil, false
	}
	return readBitmap(mdc, bmp, w, h)
}

func captureScreen(r rect, w, h int) (*image.RGBA, bool) {
	sdc, _, _ := pGetDC.Call(0) // 屏幕 DC
	if sdc == 0 {
		return nil, false
	}
	defer pReleaseDC.Call(0, sdc)
	mdc, _, _ := pCreateCompatibleDC.Call(sdc)
	if mdc == 0 {
		return nil, false
	}
	defer pDeleteDC.Call(mdc)
	bmp, _, _ := pCreateCompatibleBitmap.Call(sdc, uintptr(w), uintptr(h))
	if bmp == 0 {
		return nil, false
	}
	defer pDeleteObject.Call(bmp)
	old, _, _ := pSelectObject.Call(mdc, bmp)
	defer pSelectObject.Call(mdc, old)
	if ret, _, _ := pBitBlt.Call(mdc, 0, 0, uintptr(w), uintptr(h), sdc,
		uintptr(int2u(int64(r.Left))), uintptr(int2u(int64(r.Top))), srccopy); ret == 0 {
		return nil, false
	}
	return readBitmap(mdc, bmp, w, h)
}

func readBitmap(mdc, bmp uintptr, w, h int) (*image.RGBA, bool) {
	var bi bitmapInfoHeader
	bi.Size = uint32(unsafe.Sizeof(bi))
	bi.Width = int32(w)
	bi.Height = -int32(h) // 自顶向下
	bi.Planes = 1
	bi.BitCount = 32
	buf := make([]byte, w*h*4)
	got, _, _ := pGetDIBits.Call(mdc, bmp, 0, uintptr(h),
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&bi)), 0)
	if got == 0 {
		return nil, false
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := (y*w + x) * 4
			img.SetRGBA(x, y, color.RGBA{R: buf[i+2], G: buf[i+1], B: buf[i], A: 255})
		}
	}
	return img, true
}

// clientOriginOffset 返回客户区左上角相对整窗图左上角的偏移（物理像素）。
func clientOriginOffset(hwnd windows.Handle, r rect) (int, int) {
	var pt pointT
	pt.X, pt.Y = 0, 0
	pClientToScreen.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&pt)))
	return int(pt.X - r.Left), int(pt.Y - r.Top)
}

func clientSize(hwnd windows.Handle) (int, int) {
	var cr rect
	pGetClientRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&cr)))
	return int(cr.Right - cr.Left), int(cr.Bottom - cr.Top)
}

// contentScore 对客户区采样，返回「量化后不同颜色的种类数」——纯白/纯黑画面得分极低，
// 真实渲染出来的游戏画面得分高。这是判断截图是否抓到内容的主依据。
func contentScore(img *image.RGBA, offX, offY, cw, ch int) int {
	if img == nil || cw <= 0 || ch <= 0 {
		return -1
	}
	b := img.Bounds()
	seen := map[uint32]bool{}
	step := 4
	minL, maxL := 255, 0
	for y := offY; y < offY+ch; y += step {
		if y < b.Min.Y || y >= b.Max.Y {
			continue
		}
		for x := offX; x < offX+cw; x += step {
			if x < b.Min.X || x >= b.Max.X {
				continue
			}
			c := img.RGBAAt(x, y)
			seen[uint32(c.R>>4)<<8|uint32(c.G>>4)<<4|uint32(c.B>>4)] = true
			l := (int(c.R) + int(c.G) + int(c.B)) / 3
			if l < minL {
				minL = l
			}
			if l > maxL {
				maxL = l
			}
		}
	}
	if maxL-minL < 12 { // 近乎单色
		return 0
	}
	return len(seen)
}

// isBlank 判断整幅图是否单一颜色（PrintWindow 抓不到 DComp 时会给全黑）
func isBlank(img *image.RGBA) bool {
	b := img.Bounds()
	if b.Empty() {
		return true
	}
	step := 7
	var r0, g0, b0 uint8
	first := true
	for y := b.Min.Y; y < b.Max.Y; y += step {
		for x := b.Min.X; x < b.Max.X; x += step {
			c := img.RGBAAt(x, y)
			if first {
				r0, g0, b0, first = c.R, c.G, c.B, false
				continue
			}
			d := int(abs(int(c.R)-int(r0))) + int(abs(int(c.G)-int(g0))) + int(abs(int(c.B)-int(b0)))
			if d > 24 {
				return false
			}
		}
	}
	return true
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// ---------------------------------------------------------------- 窗口状态记忆

func loadWinState(userData string) winState {
	st := winState{X: 120, Y: 80, W: 1680, H: 950}
	data, err := os.ReadFile(filepath.Join(userData, stateFile))
	if err != nil {
		return st
	}
	var s winState
	if json.Unmarshal(data, &s) == nil && s.W >= minWinW/2 && s.H >= minWinH/2 {
		return s
	}
	return st
}

func (a *app) saveStateNow() {
	if a.hwnd == 0 {
		return
	}
	st := currentState(a.hwnd, a)
	data, _ := json.Marshal(st)
	_ = os.WriteFile(filepath.Join(a.opt.userData, stateFile), data, 0o644)
}

func saveWinState(userData string, a *app) {
	if a.hwnd == 0 {
		return
	}
	st := currentState(a.hwnd, a)
	data, _ := json.Marshal(st)
	if err := os.WriteFile(filepath.Join(userData, stateFile), data, 0o644); err == nil {
		logf("window-state = %+v", st)
	}
}

func currentState(hwnd windows.Handle, a *app) winState {
	if a != nil && a.fullscreen {
		return winState{X: int(a.prevRect.Left), Y: int(a.prevRect.Top),
			W: int(a.prevRect.Right - a.prevRect.Left), H: int(a.prevRect.Bottom - a.prevRect.Top),
			Maximized: a.prevMax}
	}
	var r rect
	pGetWindowRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&r)))
	return winState{X: int(r.Left), Y: int(r.Top),
		W: int(r.Right - r.Left), H: int(r.Bottom - r.Top), Maximized: isZoomed(hwnd)}
}

func clampToScreen(st winState) winState {
	vx := int32(getMetric(smXVirtualScreen))
	vy := int32(getMetric(smYVirtualScreen))
	vw := int32(getMetric(smCXVirtualScreen))
	vh := int32(getMetric(smCYVirtualScreen))
	if st.W < minWinW {
		st.W = minWinW
	}
	if st.H < minWinH {
		st.H = minWinH
	}
	if st.W > int(vw) {
		st.W = int(vw)
	}
	if st.H > int(vh) {
		st.H = int(vh)
	}
	if st.X < int(vx) || st.X > int(vx+vw)-200 {
		st.X = int(vx) + 80
	}
	if st.Y < int(vy) || st.Y > int(vy+vh)-200 {
		st.Y = int(vy) + 60
	}
	return st
}

// ---------------------------------------------------------------- 单实例

// hideOwnConsole 只在控制台进程列表里只有自己时隐藏控制台窗口。
// 从资源管理器双击启动 → 控制台是新建的、只属于本进程 → 隐藏（无黑窗）；
// 从 cmd / PowerShell 启动 → 控制台是共享的 → 不动（否则会关掉用户的终端）。
func hideOwnConsole(enabled bool) {
	if !enabled {
		return
	}
	hwnd, _, _ := pGetConsoleWindow.Call()
	if hwnd == 0 {
		return
	}
	var pids [4]uint32
	n, _, _ := pGetConsoleProcessList.Call(uintptr(unsafe.Pointer(&pids[0])), uintptr(len(pids)))
	if n == 1 {
		pShowWindow.Call(hwnd, 0) // SW_HIDE
	}
}

func bringExistingToFront() {
	className, _ := windows.UTF16PtrFromString(winClass)
	// FindWindowW(lpClassName, lpWindowName)：按窗口类找，第二参必须为 0
	hwnd, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(className)), 0)
	if hwnd == 0 {
		logf("已有实例在运行，但没找到它的窗口（跳过激活）")
		return
	}
	pShowWindow.Call(hwnd, uintptr(swRestore))
	r, _, _ := pSetForeground.Call(hwnd)
	logf("已有实例在运行，已切到前台 (hwnd=%#x setForeground=%d)", hwnd, r)
}

// ---------------------------------------------------------------- 工具

func resolveWebRoot(override string) (string, error) {
	var cands []string
	add := func(d string) {
		if d == "" {
			return
		}
		cands = append(cands, filepath.Join(d, "www"), d)
	}
	if override != "" {
		add(override)
	}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		add(d)
		for i := 0; i < 5; i++ {
			d = filepath.Dir(d)
			add(d)
		}
	}
	if wd, err := os.Getwd(); err == nil {
		add(wd)
	}
	seen := map[string]bool{}
	for _, c := range cands {
		if seen[c] {
			continue
		}
		seen[c] = true
		if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
			abs, _ := filepath.Abs(c)
			return abs, nil
		}
	}
	return "", fmt.Errorf("已尝试: %v", cands)
}

func monitorFromWindow(hwnd windows.Handle) uintptr {
	m, _, _ := pMonitorFromWin.Call(uintptr(hwnd), monitorDefaultToNearest)
	return m
}

func isZoomed(hwnd windows.Handle) bool {
	r, _, _ := pIsZoomed.Call(uintptr(hwnd))
	return r != 0
}

func getMetric(idx int) uint32 {
	r, _, _ := user32.NewProc("GetSystemMetrics").Call(uintptr(idx))
	return uint32(r)
}

// int2u 把可能为负的坐标按补码转成 SetWindowPos 需要的 uintptr
func int2u(v int64) int64 { return v }

// logf 同时写 stderr 和 userData/shell.log（便于离线排障）
func logf(format string, args ...any) {
	msg := fmt.Sprintf("[PSE-DESKTOP] "+format, args...)
	fmt.Fprintln(os.Stderr, msg)
	if theApp != nil && theApp.opt.userData != "" {
		if f, err := os.OpenFile(filepath.Join(theApp.opt.userData, logFile),
			os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			fmt.Fprintf(f, "%s %s\n", time.Now().Format("15:04:05.000"), msg)
			f.Close()
		}
	}
}

func fatal(msg string, err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "[PSE-DESKTOP] %s: %v\n", msg, err)
	} else {
		fmt.Fprintf(os.Stderr, "[PSE-DESKTOP] %s\n", msg)
	}
	os.Exit(1)
}
