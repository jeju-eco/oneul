"""아이콘 생성 — python tools/make_icons.py"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (15, 23, 32)
TEAL = (77, 184, 168)
SAND = (228, 161, 75)

def draw(size):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    u = size / 100.0
    # 바다
    d.rectangle([0, 72*u, size, size], fill=(24, 48, 62))
    # 오름 두 개 (제주 오름 실루엣)
    d.polygon([(12*u, 74*u), (38*u, 30*u), (64*u, 74*u)], fill=TEAL)
    d.polygon([(52*u, 74*u), (72*u, 44*u), (92*u, 74*u)], fill=(58, 140, 128))
    # 분화구
    d.ellipse([32*u, 26*u, 44*u, 34*u], fill=(40, 110, 100))
    # 해
    d.ellipse([70*u, 14*u, 88*u, 32*u], fill=SAND)
    return img

for s in (192, 512):
    p = os.path.join(OUT, f"icon-{s}.png")
    draw(s).save(p)
    print(p, os.path.getsize(p), "bytes")
