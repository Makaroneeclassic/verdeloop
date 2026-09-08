from PIL import Image, ImageFilter
from collections import deque
import sys, os

def cut(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    edge = []
    step = max(1, w // 80)
    for x in range(0, w, step):
        edge += [px[x, 0][:3], px[x, h - 1][:3]]
    for y in range(0, h, max(1, h // 80)):
        edge += [px[0, y][:3], px[w - 1, y][:3]]
    seed = tuple(sum(c[i] for c in edge) // len(edge) for i in range(3))

    # region growing แบบเทียบกับ "เพื่อนบ้านที่รับไปแล้ว" ไม่ใช่เทียบกับสี seed ตัวเดียว
    # เงาใต้แก้วเป็นการไล่สีเนียน ๆ จากพื้นขาวลงไปเทา ถ้าเทียบกับ seed จะหลุด
    # แต่ถ้าไล่ตามความต่างของพิกเซลข้างเคียง มันจะเดินตามเงาไปได้จนสุด
    # กันไม่ให้กินเข้าไปในหลอด ด้วยเงื่อนไข 2 ข้อ: ต้องยังสว่าง และต้องไม่อิ่มสี
    LOCAL = 16      # ความต่างจากพิกเซลข้างเคียงที่ยอมรับ
    MINV  = 168     # มืดกว่านี้ไม่ใช่พื้น/เงาอีกต่อไป
    MAXS  = 46      # อิ่มสีเกินนี้คือหลอด (หลอดเป็นสีแทนอมส้ม) ไม่ใช่พื้นเทา

    seen = bytearray(w * h)
    q = deque()

    def ok(c, ref):
        r, g, b = c
        if max(r, g, b) < MINV: return False
        if max(r, g, b) - min(r, g, b) > MAXS: return False
        return abs(r - ref[0]) + abs(g - ref[1]) + abs(b - ref[2]) <= LOCAL * 3

    def push(x, y, ref):
        i = y * w + x
        if seen[i]: return
        c = px[x, y][:3]
        if ok(c, ref):
            seen[i] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0, seed); push(x, h - 1, seed)
    for y in range(h):
        push(0, y, seed); push(w - 1, y, seed)
    while q:
        x, y = q.popleft()
        ref = px[x, y][:3]
        if x: push(x - 1, y, ref)
        if x < w - 1: push(x + 1, y, ref)
        if y: push(x, y - 1, ref)
        if y < h - 1: push(x, y + 1, ref)

    alpha = Image.frombytes('L', (w, h), bytes(0 if v else 255 for v in seen))
    # ปิดรูเล็ก ๆ ที่หลุดมาเป็นจุดขาวกลางวัตถุ แล้วค่อยเบลอขอบให้เนียน
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.9))
    im.putalpha(alpha)
    return im.crop(im.getbbox())

for f in sys.argv[1:]:
    im = cut(f)
    print(f, im.size)
    im.save('/tmp/prod/cut_' + os.path.basename(f))
