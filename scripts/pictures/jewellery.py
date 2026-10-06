"""Jewellery detail pictures: no cut-out, they stay opaque photographs (not part of the transparent set).
Crop to 3:4, tone darker / warmer, vignette to black.
ne01: table photo of the shell necklace. br01: sharpest early frame of c_jewelry.mp4 (bracelets on the wrist; 720x960 video, so soft)."""
import os, sys, json, subprocess, glob, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from paths import SRC, MEDIA, CACHE, OUT

def tone(img, vig=0.85, warm=1.05, gamma=1.18, cx=0.5, cy=0.5):
    f = img.astype(np.float32) / 255.0
    f = f ** gamma
    f[..., 2] *= warm; f[..., 0] /= warm          # BGR: warmer
    h, w = f.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((x / w - cx) / 0.62) ** 2 + ((y / h - cy) / 0.62) ** 2)
    v = 1 - vig * np.clip((r - 0.45) / 0.55, 0, 1) ** 1.6
    return (np.clip(f * v[..., None], 0, 1) * 255 + 0.5).astype(np.uint8)

def save(img, code):
    d = os.path.join(OUT, code); os.makedirs(d, exist_ok=True)
    big = cv2.resize(img, (1200, 1600), interpolation=cv2.INTER_AREA if img.shape[1] >= 1200 else cv2.INTER_LANCZOS4)
    for n, s in {'1600': (1200, 1600), '960': (720, 960), '480': (360, 480)}.items():
        cv2.imwrite(os.path.join(d, 'detail-%s.webp' % n), big if n == '1600' else cv2.resize(big, s, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 84])

def necklace(src='IMG_6526.jpg', box=(60, 200, 1410, 2000)):
    im = cv2.imread(os.path.join(SRC, src)); x0, y0, x1, y1 = box
    save(tone(im[y0:y1, x0:x1], cx=0.5, cy=0.58), 'ne01')
    json.dump(dict(source=src), open(os.path.join(CACHE, 'meta_ne01_detail.json'), 'w'))

def bracelet(box=(131, 150, 531, 683)):
    tmp = os.path.join(CACHE, 'brframes'); os.makedirs(tmp, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(MEDIA, 'c_jewelry.mp4'), '-t', '1.3', os.path.join(tmp, 'f_%03d.png')], check=True)
    x0, y0, x1, y1 = box; best = None
    for f in sorted(glob.glob(os.path.join(tmp, 'f_*.png'))):
        c = cv2.imread(f)[y0:y1, x0:x1]; s = cv2.Laplacian(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        if best is None or s > best[0]: best = (s, f, c)
    save(tone(best[2], vig=0.9, warm=1.03, gamma=1.12), 'br01')
    json.dump(dict(source='c_jewelry.mp4 frame ' + os.path.basename(best[1])), open(os.path.join(CACHE, 'meta_br01_detail.json'), 'w'))
    print('bracelet frame', best[1], best[0])

if __name__ == '__main__':
    necklace(); bracelet()
