# 定位红色横带：判断它是否固定在地理纬度上（随缩放应改变屏幕行号、纬度恒定）
# 用 rowprofile.read_png 解码；cam 默认 (0.52, 0.34)，投影为等距圆柱，latMax=78, latMin=-55
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rowprofile import read_png

LAT_MAX, LAT_MIN = 78.0, -55.0
RANGE = LAT_MAX - LAT_MIN          # 133
SEA = ((14, 34, 51), (23, 58, 84))  # SEA_DEEP / 渐变中段附近

def is_sea(r, g, b):
    # 海色（#0e2233 → 渐变中段 #12314a）b-r 约 37~56；UI 面板 #161c24/#1e2630/#121820 的
    # b-r 只有 14~18，必须排除——否则画布顶部探测会被面板色误判成"海"（旧版报 canvas_top=30 就是这个坑）。
    return b > r + 25 and b > 40 and g > r and g < b

def analyze(path, vw, vh_hint, zoom, cam_y=0.34):
    w, h, nch, buf, pal, ct = read_png(path)

    def px(x, y):
        i = (y * w + x) * nch
        if ct == 3:
            p = buf[i] * 3
            return pal[p], pal[p + 1], pal[p + 2]
        return buf[i], buf[i + 1], buf[i + 2]

    x1 = min(vw, w)
    # 画布顶部：第一行"海色占多数"（面板色已由 is_sea 排除）
    canvas_top = None
    for y in range(0, min(h, 400)):
        sea = 0
        n = 0
        for x in range(0, x1, 8):
            r, g, b = px(x, y)
            n += 1
            if is_sea(r, g, b):
                sea += 1
        if sea > n * 0.6:
            canvas_top = y
            break
    if canvas_top is None:
        print(f'{path}: 未找到画布顶部')
        return
    vh = h - canvas_top
    s = min(vw, vh * 1.6) * zoom
    yc = canvas_top + vh / 2

    # 红带：行平均红度
    rows = []
    for y in range(canvas_top, h):
        sr = sg = sb = 0
        n = 0
        for x in range(0, x1, 6):
            r, g, b = px(x, y)
            sr += r; sg += g; sb += b; n += 1
        rows.append((sr / n, sg / n, sb / n))
    red = [r - max(g, b) for (r, g, b) in rows]
    base = sorted(red)[len(red) // 2]
    hits = [i for i in range(1, len(red) - 1) if red[i] > base + 8]
    groups = []
    for i in hits:
        if groups and i - groups[-1][-1] <= 3:
            groups[-1].append(i)
        else:
            groups.append([i])
    print(f'--- {os.path.basename(path)}  zoom={zoom}  canvas_top={canvas_top} vw={vw} vh={vh} s={s:.0f} median_red={base:.1f}')
    for g in groups:
        if len(g) < 3:
            continue
        y0, y1 = canvas_top + g[0], canvas_top + g[-1]
        mid = (y0 + y1) / 2
        ny = (mid - yc) / s + cam_y
        lat = LAT_MAX - ny * RANGE
        print(f'  BAND y={y0}..{y1} (h={y1-y0+1})  中心纬度≈{lat:.1f}°  '
              f'上边={LAT_MAX - ((y0 - yc) / s + cam_y) * RANGE:.1f}°  '
              f'下边={LAT_MAX - ((y1 - yc) / s + cam_y) * RANGE:.1f}°')

if __name__ == '__main__':
    for arg in sys.argv[1:]:
        parts = arg.split(':')
        analyze(parts[0], int(parts[1]) if len(parts) > 1 else 1280,
                int(parts[2]) if len(parts) > 2 else 0,
                float(parts[3]) if len(parts) > 3 else 1.0)
