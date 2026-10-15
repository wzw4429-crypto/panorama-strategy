# 行平均色剖面找“半透明红带”：按 (r-g, r-b) 相对突出度定位
import struct, sys, zlib

def read_png(path):
    data = open(path, 'rb').read()
    pos = 8; idat = b''; pal = None
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos+8])
        chunk = data[pos+8:pos+8+ln]
        if typ == b'IHDR': w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'PLTE': pal = chunk
        elif typ == b'IDAT': idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    nch = {0:1, 2:3, 3:1, 4:2, 6:4}[ct]
    stride = w * nch
    out = bytearray(); prev = bytearray(stride); i = 0
    for y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i+stride]); i += stride
        if f == 1:
            for x in range(nch, stride): line[x] = (line[x] + line[x-nch]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x-nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-nch] if x >= nch else 0
                b = prev[x]; c = prev[x-nch] if x >= nch else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line; prev = line
    return w, h, nch, bytes(out), pal, ct

def main(path):
    img = read_png(path)
    w, h, nch, buf, pal, ct = img
    print(f'size {w}x{h} ct={ct}')
    # 行平均（跳过右侧面板：只取 x < 0.72*w，避开 UI）
    x1 = int(w * 0.72)
    prof = []
    for y in range(h):
        sr = sg = sb = 0
        for x in range(0, x1, 3):
            i = (y * w + x) * nch
            if ct == 3:
                p = buf[i]*3; r, g, b = pal[p], pal[p+1], pal[p+2]
            else:
                r, g, b = buf[i], buf[i+1], buf[i+2]
            sr += r; sg += g; sb += b
        n = len(range(0, x1, 3))
        prof.append((sr/n, sg/n, sb/n))
    # 每行的“红度” = r - max(g,b)；找局部极大带
    red = [p[0] - max(p[1], p[2]) for p in prof]
    base = sorted(red)[len(red)//2]
    print(f'median redness={base:.1f}')
    hits = [y for y in range(2, h-2) if red[y] > base + 6 and red[y] >= red[y-1] and red[y] >= red[y+1] and red[y] > red[y-2] and red[y] > red[y+2]]
    # 聚簇
    groups = []
    for y in hits:
        if groups and y - groups[-1][-1] <= 2: groups[-1].append(y)
        else: groups.append([y])
    for g in groups:
        y0, y1 = g[0], g[-1]
        print(f'BAND y={y0}..{y1} (h={y1-y0+1}) redness={red[(y0+y1)//2]:.1f} avgRGB={tuple(round(v) for v in prof[(y0+y1)//2])}')
        for yy in (y0-2, y0, (y0+y1)//2, y1, y1+2):
            yy = max(0, min(h-1, yy))
            print(f'   y={yy}: avg={tuple(round(v) for v in prof[yy])} redness={red[yy]:.1f}')

if __name__ == '__main__':
    main(sys.argv[1])
