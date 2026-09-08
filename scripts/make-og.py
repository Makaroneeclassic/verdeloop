from PIL import Image, ImageDraw, ImageFont
import os

OUT = '/Users/makaronee/Verdeloop/public/img/og'
os.makedirs(OUT, exist_ok=True)
F7 = lambda s: ImageFont.truetype('plex700.ttf', s)
F6 = lambda s: ImageFont.truetype('plex600.ttf', s)
F4 = lambda s: ImageFont.truetype('plex400.ttf', s)

FOREST9 = (20, 58, 40)
FOREST6 = (52, 122, 82)
CANE    = (198, 154, 82)
CREAM   = (250, 247, 240)

def card(subject, dst, head, sub, scale=0.86, shift=0):
    W, H = 1200, 630
    im = Image.new('RGB', (W, H), CREAM)
    d = ImageDraw.Draw(im)
    # ไล่สีเขียวอ่อน → ครีม แนวตั้ง ให้เหมือน hero ของเว็บ
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(
            round(233 + (250 - 233) * t),
            round(242 + (247 - 242) * t),
            round(234 + (240 - 234) * t)))

    s = Image.open(subject)
    m = min(W * 0.46 / s.width, H * scale / s.height)
    s = s.resize((round(s.width * m), round(s.height * m)), Image.LANCZOS)
    im.paste(s, (W - s.width - 60, (H - s.height) // 2 + shift), s)

    x = 78
    d.text((x, 92), 'VERDELOOP', font=F6(27), fill=FOREST6)
    # ขีดสีอ้อยใต้ชื่อแบรนด์ — องค์ประกอบเดียวกับ .tick-rule ในเว็บ
    d.rectangle([x, 138, x + 58, 142], fill=CANE)

    y = 186
    for line in head:
        d.text((x, y), line, font=F7(60), fill=FOREST9)
        y += 82
    y += 18
    for line in sub:
        d.text((x, y), line, font=F4(29), fill=(58, 96, 74))
        y += 46

    p = os.path.join(OUT, dst)
    im.save(p, 'JPEG', quality=88, optimize=True)
    print(f'{dst:22s} {os.path.getsize(p)//1024}KB')

card('f_c2_SmartBio_HC12mm_001-1.png', 'og-default.jpg',
     ['หลอดกระดาษเปื่อยยุ่ย', 'หลอดชานอ้อยไม่เป็น'],
     ['ย่อยสลายเองได้ 100% รับรอง TUV Home Compost', 'มี 3 ขนาด 6 / 8 / 12 มม. ราคาส่ง'], 0.74)

for size, f, drink in [
    ('6',  'f_c2_SmartBio_HC6mm_004.png',   'น้ำเปล่า กาแฟเย็น ชาเย็น'),
    ('8',  'f_c2_SmartBio_HC8mm_002.png',   'เมนูปั่น สมูทตี้ มิลค์เชค'),
    ('12', 'f_c2_SmartBio_HC12mm_003.png',  'ชานมไข่มุก เครื่องดื่มท็อปปิ้ง'),
]:
    card(f, f'og-straw-{size}mm.jpg',
         [f'หลอดชานอ้อย {size} มม.'],
         [f'ยาว 210 มม. · {drink}', 'แช่ได้ไม่เปื่อยยุ่ย ย่อยสลายเองได้ 100%'],
         0.80 if size != '8' else 0.72)
