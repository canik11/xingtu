# 生成「知识星图」应用图标：assets/xintu.png（512）与 assets/xintu.ico（多尺寸）。
# 纯 Pillow 绘制，不依赖外部素材；在 2048 画布上绘制后缩小，保证边缘平滑。
#
# 用法：
#   python make-icon.py            # 直接写 assets/
#   python make-icon.py --zip      # 把两个文件打成 zip 写到 stdout（用于受限环境：
#                                  #   cmd /c "python make-icon.py --zip > assets\icon.zip"）
import io
import math
import os
import random
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets')

S = 2048
CX = CY = S / 2.0


def radial_glow(radius_px, color, peak_alpha):
    """返回一张以 (CX,CY) 为中心、高斯衰减的光晕图层。"""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    dist = np.sqrt((xx - CX) ** 2 + (yy - CY) ** 2)
    falloff = np.clip(1.0 - dist / radius_px, 0.0, 1.0) ** 2.2
    alpha = (falloff * peak_alpha).astype(np.uint8)
    rgba = np.zeros((S, S, 4), dtype=np.uint8)
    rgba[..., 0] = color[0]
    rgba[..., 1] = color[1]
    rgba[..., 2] = color[2]
    rgba[..., 3] = alpha
    return Image.fromarray(rgba, 'RGBA')


def star_polygon(cx, cy, r_out, r_in, spikes=4, rotation=0.0):
    points = []
    for i in range(spikes * 2):
        angle = rotation + i * math.pi / spikes
        radius = r_out if i % 2 == 0 else r_in
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def build_canvas():
    # —— 背景：深蓝径向渐变，中心略亮 ——
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    dist = np.sqrt((xx - CX) ** 2 + (yy - CY) ** 2) / (S * 0.60)
    dist = np.clip(dist, 0.0, 1.0)[..., None]
    center = np.array([22, 36, 66], dtype=np.float32)
    edge = np.array([4, 8, 18], dtype=np.float32)
    rgb = center * (1 - dist) + edge * dist
    bg = Image.fromarray(rgb.astype(np.uint8), 'RGB').convert('RGBA')

    # 两团极淡的星云，给纯渐变一点层次。
    nebula = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    nebula.alpha_composite(radial_glow(S * 0.55, (46, 84, 150), 70).point(lambda a: a // 2))
    nebula = nebula.filter(ImageFilter.GaussianBlur(90))
    bg.alpha_composite(nebula)

    draw = ImageDraw.Draw(bg, 'RGBA')

    # —— 背景星点 ——
    rng = random.Random(20261112)
    for _ in range(110):
        x = rng.uniform(0.06, 0.94) * S
        y = rng.uniform(0.06, 0.94) * S
        r = rng.uniform(1.4, 3.4)
        a = rng.randint(35, 130)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(190, 214, 255, a))

    # —— 三颗主星的位置：构成一个稳定的等腰三角 ——
    stars = [
        (S * 0.500, S * 0.300, 1.00),   # 主星
        (S * 0.285, S * 0.660, 0.62),   # 左
        (S * 0.715, S * 0.660, 0.62),   # 右
    ]

    # 关系线：先画柔光，再画细线，模拟应用里的白色光丝。
    line_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line_layer, 'RGBA')
    links = [(0, 1), (0, 2), (1, 2)]
    for a, b in links:
        ld.line([stars[a][:2], stars[b][:2]], fill=(198, 224, 255, 120), width=7)
    bg.alpha_composite(line_layer.filter(ImageFilter.GaussianBlur(16)))
    bg.alpha_composite(line_layer)

    # —— 星点光晕 ——
    for cx, cy, scale in stars:
        canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(canvas, 'RGBA')
        d.ellipse((cx - S * 0.09 * scale, cy - S * 0.09 * scale,
                   cx + S * 0.09 * scale, cy + S * 0.09 * scale),
                  fill=(170, 205, 255, 55))
        d.ellipse((cx - S * 0.045 * scale, cy - S * 0.045 * scale,
                   cx + S * 0.045 * scale, cy + S * 0.045 * scale),
                  fill=(220, 238, 255, 120))
        bg.alpha_composite(canvas.filter(ImageFilter.GaussianBlur(26)))

    # —— 星芒 ——
    for cx, cy, scale in stars:
        r_out = S * 0.115 * scale
        r_in = S * 0.020 * scale
        # 主十字
        draw.polygon(star_polygon(cx, cy, r_out, r_in, 4, 0.0), fill=(246, 251, 255, 255))
        # 45° 短芒
        draw.polygon(star_polygon(cx, cy, r_out * 0.52, r_in * 0.9, 4, math.pi / 4),
                     fill=(214, 233, 255, 255))
        # 核心
        core = S * 0.016 * scale
        draw.ellipse((cx - core, cy - core, cx + core, cy + core), fill=(255, 255, 255, 255))

    # —— 圆角遮罩 ——
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=255)
    bg.putalpha(mask)

    # —— 内描边，让小尺寸也有轮廓 ——
    border = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    inset = int(S * 0.012)
    bd.rounded_rectangle((inset, inset, S - 1 - inset, S - 1 - inset),
                         radius=int(S * 0.21), outline=(120, 170, 255, 110),
                         width=int(S * 0.008))
    bg.alpha_composite(border)
    return bg


def encode_assets():
    canvas = build_canvas()

    png_buf = io.BytesIO()
    canvas.resize((512, 512), Image.LANCZOS).save(png_buf, 'PNG')

    sizes = [16, 24, 32, 40, 48, 64, 128, 256]
    frames = [canvas.resize((n, n), Image.LANCZOS) for n in sizes]
    ico_buf = io.BytesIO()
    frames[-1].save(ico_buf, format='ICO', sizes=[(n, n) for n in sizes],
                    append_images=frames[:-1])
    return png_buf.getvalue(), ico_buf.getvalue()


def main():
    png_bytes, ico_bytes = encode_assets()

    if '--zip' in sys.argv:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('xintu.png', png_bytes)
            zf.writestr('xintu.ico', ico_bytes)
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.buffer.flush()
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    png_path = os.path.join(OUT_DIR, 'xintu.png')
    ico_path = os.path.join(OUT_DIR, 'xintu.ico')
    with open(png_path, 'wb') as fh:
        fh.write(png_bytes)
    with open(ico_path, 'wb') as fh:
        fh.write(ico_bytes)
    print('icon: %s (%d bytes), png: %s (%d bytes)' % (
        ico_path, len(ico_bytes), png_path, len(png_bytes)))


if __name__ == '__main__':
    main()