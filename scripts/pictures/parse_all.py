"""Step 1: run u2net_cloth_seg (label maps 0 bg,1 upper,2 lower,3 full) or isnet (PIC_MODEL=isnet, 8-bit matte) on source photos; cache as PNG.
usage: parse_all.py <worker_index> <n_workers> [all]   (default: first candidate per view; 'all' = every candidate)"""
import sys, os, json, cv2, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import models
SRC = '/home/claude/media-src/img'; CACHE = os.environ.get('PIC_CACHE', '/home/claude/pic-cache')
os.makedirs(CACHE, exist_ok=True)
d = json.load(open(os.path.join(os.path.dirname(__file__), '../../db/picture-sources.json')))
first = ['tz01', 'tz10', 'tz11', 'ls01', 'pa01', 'tz22', 'tz30', 'te02']
files = []
for code in first + [c for c in d if c not in first]:
    if code in ('ne01', 'br01'): continue
    for view, cands in d[code].items():
        for f in (cands if len(sys.argv) > 3 else cands[:1]):
            if f not in files: files.append(f)
k, n = int(sys.argv[1]), int(sys.argv[2])
if os.environ.get('PIC_REVERSE'): files = files[::-1]
for i, f in enumerate(files):
    if i % n != k: continue
    kind = os.environ.get('PIC_MODEL', 'cloth')
    out = os.path.join(CACHE, f.replace('.jpg', '_%s.png' % kind))
    if os.path.exists(out): continue
    rgb = cv2.cvtColor(cv2.imread(os.path.join(SRC, f)), cv2.COLOR_BGR2RGB)
    if kind == 'cloth': cv2.imwrite(out, models.cloth(rgb, 1))
    else: cv2.imwrite(out, (models.isnet(rgb, 1) * 255).astype(np.uint8))
    print(f, flush=True)
