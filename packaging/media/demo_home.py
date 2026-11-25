"""Make a made-up user folder for screenshots: Downloads, Pictures, Documents, Desktop full of demo files.
python packaging\\media\\demo_home.py <folder>     (needs Pillow; every file here is generated, nothing is real)"""
import json
import math
import os
import random
import struct
import sys
import time
import wave
import zipfile

from PIL import Image, ImageDraw, ImageFilter

root = sys.argv[1]
R = random.Random(7)
D = {k: os.path.join(root, k) for k in ("Downloads", "Pictures", "Documents", "Desktop", "Music", "Videos")}
for p in D.values():
    os.makedirs(p, exist_ok=True)
os.makedirs(os.path.join(D["Pictures"], "Trip to the hills"), exist_ok=True)


def scene(path, w, h, sky, sun, hills, seed):
    r = random.Random(seed)
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):   # sky gradient
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(sky[0][i] * (1 - t) + sky[1][i] * t) for i in range(3)))
    sx, sy, sr = r.randint(w // 5, 4 * w // 5), r.randint(h // 6, h // 3), h // 9
    d.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=sun)
    for k, col in enumerate(hills):   # layered hills
        base = h * (0.55 + 0.13 * k)
        pts = [(0, h)] + [(x, base - 40 * math.sin(x / (90 + 40 * k) + seed + k) - r.randint(0, 12)) for x in range(0, w + 20, 20)] + [(w, h)]
        d.polygon(pts, fill=col)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(path, quality=90)


PAL = [((255, 166, 115), (255, 225, 190)), ((32, 40, 90), (120, 90, 160)), ((90, 180, 255), (220, 240, 255)), ((255, 120, 140), (255, 210, 160)),
       ((20, 30, 50), (60, 80, 120)), ((255, 200, 90), (255, 240, 200))]
HILLS = [[(70, 60, 110), (40, 35, 70), (20, 18, 40)], [(60, 140, 120), (30, 90, 80), (15, 50, 45)], [(150, 80, 90), (100, 50, 70), (50, 25, 40)]]
names = ["Sunrise ridge", "Lake at dusk", "Clear morning", "Pink hour", "Night valley", "Golden field", "Mist", "Last light"]
for i, n in enumerate(names):
    scene(os.path.join(D["Pictures"], "Trip to the hills", f"{n}.jpg"), 1600, 1066, PAL[i % len(PAL)], (255, 250, 230) if i % 3 else (255, 230, 120), HILLS[i % 3], i)
for i in range(3):
    scene(os.path.join(D["Pictures"], f"Wallpaper {i + 1}.jpg"), 1920, 1080, PAL[(i + 2) % len(PAL)], (255, 245, 220), HILLS[(i + 1) % 3], 40 + i)

# Downloads: a mix of everyday files
open(os.path.join(D["Downloads"], "Weekend trip plan.md"), "w", encoding="utf-8").write("""# Weekend trip plan

## Saturday
- 07:30 leave early, beat the traffic
- 10:00 breakfast at the lake cafe
- Afternoon: the ridge walk (6 km, easy)

## Sunday
- Sunrise from the viewpoint
- Pack up by 11:00

## Packing
- [x] Rain jacket
- [x] Power bank
- [ ] Snacks for the road

| Item | Cost |
|---|---|
| Fuel | 1,800 |
| Stay | 3,200 |
| Food | 1,400 |
""")
with open(os.path.join(D["Downloads"], "monthly-budget.csv"), "w") as f:
    f.write("Month,Food,Travel,Bills,Fun\n" + "\n".join(f"{m},{R.randint(6, 9)}000,{R.randint(1, 4)}000,{R.randint(3, 5)}500,{R.randint(1, 3)}000" for m in ["Jul", "Aug", "Sep", "Oct", "Nov"]))
open(os.path.join(D["Downloads"], "settings.json"), "w").write(json.dumps({"theme": "ink-arcade", "accent": "#c6ff3d", "sounds": False, "shortcuts": {"palette": "Ctrl+K", "notes": "Ctrl+J"}}, indent=2))
open(os.path.join(D["Downloads"], "bouncing_ball.py"), "w").write('''"""A tiny physics toy: a ball that bounces and slowly loses energy."""
import math

G, DAMP = 9.81, 0.82


def simulate(height, steps=200, dt=0.02):
    y, v, out = height, 0.0, []
    for _ in range(steps):
        v -= G * dt
        y += v * dt
        if y <= 0:            # hit the floor: bounce back up, a bit weaker
            y, v = 0.0, -v * DAMP
        out.append(round(y, 3))
    return out


if __name__ == "__main__":
    for i, h in enumerate(simulate(2.0)[::20]):
        print(f"{i:3}  {'#' * int(h * 20)}")
''')
with zipfile.ZipFile(os.path.join(D["Downloads"], "pixel-icons.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for i in range(6):
        im = Image.new("RGB", (16, 16), (22, 20, 26))
        dd = ImageDraw.Draw(im)
        dd.rectangle((3, 3, 12, 12), fill=[(198, 255, 61), (77, 195, 255), (255, 201, 61), (255, 95, 162), (178, 139, 255), (93, 255, 176)][i])
        tmp = os.path.join(root, f"_icon{i}.png")
        im.resize((64, 64), Image.NEAREST).save(tmp)
        z.write(tmp, f"icons/icon-{i + 1}.png")
        os.remove(tmp)
    z.writestr("README.txt", "Six pixel icons, free to use.")


def tone(path, secs, notes):
    sr = 22050
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        frames = bytearray()
        for i in range(int(sr * secs)):
            t = i / sr
            f = notes[int(t * 2) % len(notes)]
            env = 0.5 * (1 - (t * 2 % 1)) ** 2
            frames += struct.pack("<h", int(9000 * env * math.sin(2 * math.pi * f * t)))
        w.writeframes(bytes(frames))


tone(os.path.join(D["Music"], "Little loop.wav"), 24, [262, 330, 392, 523, 392, 330])
tone(os.path.join(D["Downloads"], "notification-chime.wav"), 3, [880, 1175])
open(os.path.join(D["Documents"], "Ideas.txt"), "w").write("Ideas\n\n- A plant-watering reminder\n- Pixel art for the blog header\n- Learn three songs on guitar\n")
open(os.path.join(D["Desktop"], "todo.txt"), "w").write("Call the plumber\nReturn library books\n")
# file times: spread over the last week so "new in Downloads" looks lived-in
now = time.time()
for i, f in enumerate(sorted(os.listdir(D["Downloads"]))):
    p = os.path.join(D["Downloads"], f)
    os.utime(p, (now - i * 5400, now - i * 5400))
print("demo home ready:", root)
