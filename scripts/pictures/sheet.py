"""Contact sheets of the cut-outs, laid on the shop's grounds (the pictures are transparent, so a sheet needs a ground).
  sheet.py --grounds <dir> [code:view ...]   proof sheets: the 960 files at 320 px, 6 across, labelled code/view, every
                                             sheet once on the light stage (#DACBB1) and once on the dark stage (#3B2C20).
                                             Without a list: every *-960.webp in the item folders except fabric swatches.
  sheet.py <out.jpg> code:view ...           one sheet of the 480 files on the light stage
  sheet.py --all <dir>                       all views of picture-sources.json, 16 per sheet, on the light stage
"""
import sys, os, json, glob, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from paths import OUT, SOURCES_JSON
LIGHT, DARK = (0xDA, 0xCB, 0xB1), (0x3B, 0x2C, 0x20)   # RGB stage colours of the light and the dark theme

def on_ground(path, rgb):
    """the picture as BGR, composited on an RGB ground colour when it has alpha; None when the file is missing"""
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None: return None
    if im.ndim == 3 and im.shape[2] == 4:
        a = im[..., 3:].astype(np.float32) / 255.0
        im = (im[..., :3].astype(np.float32) * a + np.array(rgb[::-1], np.float32) * (1 - a) + 0.5).astype(np.uint8)
    return im

def tile(code, view, size='480', wh=(300, 400), ground=LIGHT):
    im = on_ground(os.path.join(OUT, code, '%s-%s.webp' % (view, size)), ground)
    if im is None: im = np.zeros((wh[1], wh[0], 3), np.uint8)
    im = cv2.resize(im, wh, interpolation=cv2.INTER_AREA)
    ink = (20, 20, 20) if sum(ground) > 380 else (235, 235, 235)
    cv2.putText(im, code + '/' + view, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, ink, 1, cv2.LINE_AA)
    return cv2.copyMakeBorder(im, 0, 2, 0, 2, cv2.BORDER_CONSTANT, value=(128, 128, 128))

def sheet(path, items, cols=8, **kw):
    t = [tile(*i, **kw) for i in items]
    while len(t) % cols: t.append(np.full_like(t[0], 128))
    cv2.imwrite(path, np.vstack([np.hstack(t[i:i + cols]) for i in range(0, len(t), cols)]), [cv2.IMWRITE_JPEG_QUALITY, 90])

def grounds(outdir, items, per=12):
    os.makedirs(outdir, exist_ok=True); made = []
    for i in range(0, len(items), per):
        for name, g in (('light', LIGHT), ('dark', DARK)):
            p = os.path.join(outdir, 'sheet_%02d_%s.jpg' % (i // per, name))
            sheet(p, items[i:i + per], cols=6, size='960', wh=(320, 427), ground=g); made.append(p)
    return made

if __name__ == '__main__':
    if sys.argv[1] == '--grounds':
        items = [a.split(':') for a in sys.argv[3:]]
        if not items:
            for f in sorted(glob.glob(os.path.join(OUT, '*', '*-960.webp'))):
                items.append((os.path.basename(os.path.dirname(f)), os.path.basename(f)[:-9]))
        print('\n'.join(grounds(sys.argv[2], items)))
    elif sys.argv[1] == '--all':
        S = json.load(open(SOURCES_JSON))
        items = [(c, v) for c in S for v in ('front', 'back', 'side', 'detail') if v in S[c]]
        os.makedirs(sys.argv[2], exist_ok=True)
        for i in range(0, len(items), 16): sheet(os.path.join(sys.argv[2], 'sheet_%02d.jpg' % (i // 16)), items[i:i + 16])
    else: sheet(sys.argv[1], [a.split(':') for a in sys.argv[2:]])
