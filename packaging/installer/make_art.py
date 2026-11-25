"""Draw the installer's side and corner pictures in the Ink Arcade style (needs Pillow).
python packaging\\installer\\make_art.py  ->  wizard-big.bmp (164x314 @2x) and wizard-small.bmp (55x55 @2x)"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
BG, INK, FG = (22, 20, 26), (0, 0, 0), (255, 248, 236)
ACC = [(198, 255, 61), (77, 195, 255), (255, 201, 61), (255, 95, 162), (178, 139, 255), (93, 255, 176), (255, 138, 61), (46, 230, 214)]


def tile(d, x, y, s, col, r=None):
    r = r or s // 4
    d.rounded_rectangle((x + s // 9, y + s // 9, x + s + s // 9, y + s + s // 9), r, fill=INK)        # hard shadow
    d.rounded_rectangle((x, y, x + s, y + s), r, fill=col, outline=INK, width=max(3, s // 14))


def logo(d, x, y, s):
    """The suite mark: a 2x2 grid of coloured squares in an ink tile."""
    tile(d, x, y, s, FG)
    g, q = s // 8, (s - s // 8 * 3) // 2
    for i, c in enumerate(ACC[:4]):
        cx, cy = x + g + (i % 2) * (q + g), y + g + (i // 2) * (q + g)
        d.rounded_rectangle((cx, cy, cx + q, cy + q), q // 4, fill=c, outline=INK, width=max(2, s // 28))


def big():
    w, h = 164 * 2, 314 * 2
    im = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(im)
    for yy in range(0, h, 20):            # dot wallpaper
        for xx in range(0, w, 20):
            d.ellipse((xx, yy, xx + 2, yy + 2), fill=(40, 37, 46))
    logo(d, 70, 70, 180)
    # a falling stack of tool tiles
    pos = [(30, 330, 70), (120, 300, 64), (210, 345, 70), (55, 430, 60), (160, 420, 74), (40, 520, 66), (140, 525, 58), (225, 495, 62)]
    for (x, y, s), c in zip(pos, ACC):
        tile(d, x, y, s, c)
    im.resize((164 * 2, 314 * 2)).save(os.path.join(HERE, "wizard-big.bmp"))


def small():
    s = 55 * 2
    im = Image.new("RGB", (s, s), (255, 255, 255))
    logo(ImageDraw.Draw(im), 10, 10, 82)
    im.save(os.path.join(HERE, "wizard-small.bmp"))


if __name__ == "__main__":
    big()
    small()
    print("ok")
