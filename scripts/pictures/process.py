"""Step 2: cut the item out of the fitting-room photo and write it as a transparent cut-out.

Inputs : cached isnet matte + u2net_cloth_seg label map per source photo (see parse_all.py),
         db/picture-sources.json, optional overrides.json ({code: {view: {"src": "IMG.jpg", ...flags}}}).
Outputs: <out>/<code>/<view>-{480,960,1600}.webp (360x480, 720x960, 1200x1600) as RGBA WebP: straight alpha, the
         background fully transparent, garment colour bled outward under the alpha (no fringe on light or dark grounds),
         <code>/fabric-1024.webp for tzitziyot (opt-in), and a meta json per view in the cache (used by quality.py).
usage  : process.py all | tz01,tz02 ...   [-j N]
paths  : environment, see paths.py / run.sh: PIC_SRC (source photos), PIC_CACHE (masks), PIC_OUT (item folders),
         PIC_SOURCES (picture-sources.json). PIC_KEEP=1 writes only the views whose files already exist in PIC_OUT
         (re-cut of a curated set without bringing the dropped views back).
No generative step anywhere: masks come from segmentation + colour/geometry rules, pixels are the real photo.
"""
import sys, os, json, cv2, numpy as np
from multiprocessing import Pool
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from paths import SRC, CACHE, OUT, SOURCES_JSON
SOURCES = json.load(open(SOURCES_JSON))
OVR = json.load(open(os.path.join(HERE, 'overrides.json'))) if os.path.exists(os.path.join(HERE, 'overrides.json')) else {}
CW, CH = 1200, 1600
OLIVE_ITEMS = {'tz11', 'tz16', 'tz18', 'tz28', 'pa01'}
SESSION = {}
PROTO = {}   # item colour prototypes learnt on the front view, reused for the back / side views of the same item


SEG = 0.5   # segmentation runs at half resolution; pixel kernels below are written for full-res and scaled here
def ell(k):
    k = max(3, int(k * SEG) | 1); return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
def largest(m, n=1):
    num, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    if num <= 1: return m.astype(bool)
    idx = 1 + np.argsort(-st[1:, cv2.CC_STAT_AREA])[:n]
    return np.isin(lab, idx)
def fill_holes(m):
    m8 = m.astype(np.uint8); h, w = m8.shape
    ff = np.zeros((h + 2, w + 2), np.uint8); pad = cv2.copyMakeBorder(m8, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    inv = (1 - pad).copy(); cv2.floodFill(inv, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 0)
    return (m8 | inv[1:-1, 1:-1]).astype(bool)
def drop_small(m, frac=0.0006):
    num, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    keep = np.zeros(num, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] > frac * m.size
    return keep[lab]


def load(f, need_cloth=True):
    rgb = cv2.cvtColor(cv2.imread(os.path.join(SRC, f)), cv2.COLOR_BGR2RGB)
    b = f.replace('.jpg', '')
    A = cv2.imread(os.path.join(CACHE, b + '_isnet.png'), 0)
    L = cv2.imread(os.path.join(CACHE, b + '_cloth.png'), 0)
    if A is None:
        sys.path.insert(0, HERE); import models
        A = (models.isnet(rgb, 2) * 255).astype(np.uint8); cv2.imwrite(os.path.join(CACHE, b + '_isnet.png'), A)
    if L is None and not need_cloth: L = np.zeros(rgb.shape[:2], np.uint8)
    if L is None:
        sys.path.insert(0, HERE); import models
        L = models.cloth(rgb, 2); cv2.imwrite(os.path.join(CACHE, b + '_cloth.png'), L)
    return rgb, A.astype(np.float32) / 255.0, L


def colour_model(lab, region):
    """robust Lab model of the under-clothes (trousers); returns None when there are too few pixels"""
    px = lab[region]
    if len(px) < 1000: return None
    med = np.median(px, 0); mad = np.median(np.abs(px - med), 0) * 1.4826
    return med, np.maximum(mad, [14, 3.2, 3.2])
def match(lab, model, t=3.0, tl=2.6):
    med, sd = model
    d = (lab - med) / sd
    return (np.abs(d[..., 0]) < tl) & ((d[..., 1] ** 2 + d[..., 2] ** 2) < t * t)


def skin_mask(rgb):
    ycc = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb).astype(np.int16)
    y, cr, cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    m = (cr > 139) & (cr < 200) & (cb > 78) & (cb < 128) & (y > 45) & (cr - cb > 20)
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, ell(5)).astype(bool)


def face_region(S, skin, dark, y0, H, cx, W):
    """face + beard + fringe hair as one filled blob (front and side views); empty when no face is visible"""
    zone = np.zeros_like(S); zone[y0:int(y0 + 0.27 * H), max(0, int(cx - 0.2 * W)):int(cx + 0.2 * W)] = True
    sk = skin & zone & S
    if sk.sum() < 0.0012 * S.size: return np.zeros_like(S), False
    sk = largest(cv2.morphologyEx(sk.astype(np.uint8), cv2.MORPH_CLOSE, ell(41)), 2) & zone
    ys, xs = np.nonzero(sk); fw = xs.max() - xs.min() + 1
    grow = cv2.dilate(sk.astype(np.uint8), ell(int(max(31, 0.45 * fw)) | 1)).astype(bool) & dark & S & zone
    reg = sk | grow
    reg = cv2.morphologyEx(reg.astype(np.uint8), cv2.MORPH_CLOSE, ell(int(max(41, 0.5 * fw)) | 1))
    cnts, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros(S.shape, np.uint8)
    for c in cnts:
        if cv2.contourArea(c) > 0.0008 * S.size: cv2.fillPoly(out, [cv2.convexHull(c)], 1)
    out = cv2.dilate(out, ell(9))
    return out.astype(bool), True


def geometry(S):
    ys, xs = np.nonzero(S); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    H = y1 - y0 + 1; W = x1 - x0 + 1
    band = S[int(y0 + 0.2 * H):int(y0 + 0.5 * H)]
    cx = np.median(np.nonzero(band)[1]) if band.any() else (x0 + x1) / 2
    return y0, y1, x0, x1, H, W, cx


def seg_poncho(code, view, rgb, A, C, o):
    h, w = A.shape
    S = largest(A > 0.5)
    y0, y1, x0, x1, H, W, cx = geometry(S)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    Lc = lab[..., 0]
    notes = []
    # under-clothes model from the legs (cloth 'lower' class when it found them, else the lower silhouette band)
    low = (C == 2) & S; low[:int(y0 + 0.5 * H)] = False
    legs = np.zeros_like(S); legs[int(y0 + 0.70 * H):int(y0 + 0.88 * H)] = True; legs &= S
    reg = cv2.erode(legs.astype(np.uint8), ell(15)).astype(bool)   # (the parser's 'lower' class is unreliable under a poncho)
    model = colour_model(lab, reg)
    olive_session = model is not None and model[0][0] < 125 and model[0][2] > 127 and model[0][1] < 136
    if view == 'front': SESSION[code] = olive_session
    elif model is not None and SESSION.get(code) and model[0][0] < 140: olive_session = True   # same session as the front view
    skin = skin_mask(rgb); skin_raw = skin.copy()
    dark = Lc < 75
    face, has_face = face_region(S, skin, dark, y0, H, cx, W)
    if o.get('hoodless') and has_face:      # no hood: everything above the chin is head, not item
        fy = np.nonzero(face.any(1))[0]; face[:fy.max() + int(0.035 * H)] = True
    if o.get('hoodless') and not has_face:  # back view of a bare head: cut at the narrowest silhouette row (neck)
        a0, a1 = int(y0 + 0.08 * H), int(y0 + 0.30 * H)
        wr = cv2.GaussianBlur(S[a0:a1].sum(1).astype(np.float32)[:, None], (1, 15), 0)[:, 0]
        face[:a0 + int(np.argmin(wr)) + int(0.02 * H)] = True
    if 'cuttop' in o: face[:int(y0 + o['cuttop'] * H)] = True
    under = np.zeros_like(S); under_loose = np.zeros_like(S)
    if olive_session:
        if code in OLIVE_ITEMS and not o.get('force_colour'):
            # item is olive too: only trust the colour where the parser says 'lower' or below the legs line
            # item is olive too: under-clothes = same colour AND flat (no stripe / lace texture), in sizeable blobs
            mu = cv2.blur(Lc, (15, 15)); sd = np.sqrt(np.maximum(cv2.blur(Lc * Lc, (15, 15)) - mu * mu, 0))
            flat = sd < o.get('flat', 7.0)
            under = match(lab, model, o.get('t', 2.4), o.get('tl', 2.2)) & (flat | (C == 2) | (np.arange(h)[:, None] > y0 + 0.66 * H))
            under = cv2.morphologyEx(under.astype(np.uint8), cv2.MORPH_OPEN, ell(21)).astype(bool)
            notes.append('olive item on olive under-clothes: separated by texture, expect sleeve remnants / bites')
        else:
            under = match(lab, model, o.get('t', 3.0), o.get('tl', 2.6))
    under = cv2.morphologyEx(under.astype(np.uint8), cv2.MORPH_OPEN, ell(9)).astype(bool)
    item0 = S & ~under & ~skin & ~face
    if not (code in OLIVE_ITEMS and not o.get('force_colour')) and not o.get('noproto'):
        # second pass: nearest-prototype classification (item colours from the central torso vs trousers vs skin)
        if True:
            # item colours: chest / belly box of the silhouette (below the neckline, above any hem)
            box = np.zeros_like(S); box[int(y0 + o.get('box0', 0.30) * H):int(y0 + o.get('box1', 0.43) * H), int(cx - 0.11 * W):int(cx + 0.11 * W)] = True
            samp = lab[box & S & ~skin & ~face]
            if len(samp) > 3000:
                samp = samp[np.random.RandomState(1).choice(len(samp), min(len(samp), 20000), replace=False)]
                _, kl, cen = cv2.kmeans(samp.astype(np.float32), 4, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0), 2, cv2.KMEANS_PP_CENTERS)
                cnt = np.bincount(kl.ravel(), minlength=4) / float(len(kl))
                good = cnt > 0.06
                if olive_session:
                    up = [model[0], model[0] + np.array([28, 0, 2]), model[0] + np.array([-22, 0, -2]), model[0] + np.array([50, 1, 4])]
                    good &= np.min([np.sqrt((((cen - u) * np.array([0.55, 1, 1])) ** 2).sum(1)) for u in up], 0) > o.get('pd', 13)
                if good.any(): cen = cen[good]
                if view == 'front': PROTO[code] = cen.copy()
                elif code in PROTO: cen = PROTO[code] if view == 'side' else np.vstack([cen, PROTO[code]])
                under = np.zeros_like(S)
                wgt = np.array([0.55, 1.0, 1.0], np.float32)
                def dmin(protos):
                    return np.min([np.sqrt((((lab - p) * wgt) ** 2).sum(2)) for p in protos], 0)
                d_item = dmin(cen)
                if olive_session:
                    d_under = dmin(up)
                    under2 = ((d_under < d_item * 1.12) & (d_under < o.get('ur', 28))) | (match(lab, model, 3.0, 2.6) & (d_under < d_item * 1.5))
                    under_loose = (d_under < d_item * 1.12) & (d_under < 30)
                    mu = cv2.blur(Lc, (15, 15)); sd = np.sqrt(np.maximum(cv2.blur(Lc * Lc, (15, 15)) - mu * mu, 0))
                    under2 &= sd < o.get('flat2', 1e9)      # under-clothes are flat; stripes of the item are not
                    under = cv2.morphologyEx(under2.astype(np.uint8), cv2.MORPH_OPEN, ell(o.get('uopen', 25))).astype(bool)
                sp = lab[skin & face & S] if has_face else np.zeros((0, 3))
                sprot = [np.median(sp, 0)] if len(sp) > 500 else [np.array([150, 148, 150], np.float32)]
                sprot += [sprot[0] + np.array([-40, 2, 0]), sprot[0] + np.array([35, -2, -2])]
                d_skin = dmin(sprot)
                skin = cv2.morphologyEx((skin & ~((d_item < 9) & (d_item < d_skin))).astype(np.uint8), cv2.MORPH_OPEN, ell(7)).astype(bool)
                # head zone: keep only item-coloured pixels (removes hair, cap, beard of a bare head above a hoodless item)
                w2 = np.array([0.25, 1.0, 1.0], np.float32)
                dc = np.min([np.sqrt((((lab - p) * w2) ** 2).sum(2)) for p in cen], 0)
                nonitem = dc > o.get('headd', 22)
                if not o.get('strict'): nonitem[int(y0 + 0.24 * H):] = False   # strict: whole image (bare arms under coloured light)
                nonitem = cv2.morphologyEx(nonitem.astype(np.uint8), cv2.MORPH_OPEN, ell(9)).astype(bool)
                item0 = S & ~under & ~skin & ~face & ~nonitem
    # body = big blob once thin things are opened away
    body = largest(cv2.morphologyEx(cv2.morphologyEx(item0.astype(np.uint8), cv2.MORPH_CLOSE, ell(17)), cv2.MORPH_OPEN, ell(25)))
    wrow = body.sum(1).astype(np.float32); wrow = cv2.GaussianBlur(wrow[:, None], (1, 41), 0)[:, 0]
    wmax = wrow.max(); rows = np.nonzero(wrow > o.get('hemfrac', 0.42 if olive_session else 0.64) * wmax)[0]
    by0 = np.nonzero(wrow > 0)[0].min(); hem = rows.max()
    if 'hem' in o: hem = int(by0 + o['hem'] * (hem - by0))
    body[hem + 1:] = False
    near = cv2.dilate(body.astype(np.uint8), ell(41)).astype(bool)
    cand0 = item0.copy(); cand0[hem + int(0.012 * H):] = False
    co = cv2.morphologyEx(cand0.astype(np.uint8), cv2.MORPH_OPEN, ell(7))
    num, cl = cv2.connectedComponents(co, connectivity=8)
    ids = np.unique(cl[body & (co > 0)]); ids = ids[ids > 0]
    final = cand0 & cv2.dilate(np.isin(cl, ids).astype(np.uint8), ell(17)).astype(bool)
    # fringe / tassels hanging just under the hem: thin, light and not under-clothes
    fr = item0 & near; fr[:hem] = False; fr[hem + int(0.06 * H):] = False
    final |= fr & (Lc > (model[0][0] + 35 if olive_session else 255))
    # tzitzit strings: thin bright cords over the trousers, below the hem and near the body's x-range
    strings = np.zeros_like(S)
    if olive_session and not o.get('nostrings'):
        bx = np.nonzero(body.any(0))[0]
        bright = (Lc > model[0][0] + 50) & (lab[..., 2] < 150) & ~skin
        th = cv2.morphologyEx(Lc, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 3))) > 28
        cand = bright & th & (A > 0.25)
        cand[:hem] = False; cand[hem + int(0.17 * H):] = False
        cand[:, :max(0, bx.min() - 30)] = False; cand[:, bx.max() + 30:] = False
        cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_CLOSE, ell(5))
        num, cl, st, _ = cv2.connectedComponentsWithStats(cand, 8)
        for i in range(1, num):
            x, y, ww, hh, ar = st[i]
            if hh > 0.035 * H and ww < 0.09 * W and ar < 0.5 * ww * hh + 400 and y < hem + 0.08 * H:
                strings |= cl == i
    # thin olive slivers left at sleeve borders: drop thin parts of the mask that look like under-clothes
    thin = final & ~cv2.morphologyEx(final.astype(np.uint8), cv2.MORPH_OPEN, ell(27)).astype(bool)
    final &= ~(thin & cv2.dilate(under_loose.astype(np.uint8), ell(5)).astype(bool))
    band = final & ~cv2.erode(final.astype(np.uint8), ell(o.get('band', 71))).astype(bool)
    if o.get('bandclean'):   # off by default: it also bites cream cloth and dark prints near the outline
        final &= ~(band & cv2.dilate((under_loose | skin_raw).astype(np.uint8), ell(7)).astype(bool))
        final = cv2.morphologyEx(final.astype(np.uint8), cv2.MORPH_OPEN, ell(5)).astype(bool)
    final = final | strings
    final = drop_small(final)
    # holes: refill everything enclosed except the head / neck opening
    filled = fill_holes(final); holes = filled & ~final
    num, hl = cv2.connectedComponents(holes.astype(np.uint8), connectivity=8)
    facez = cv2.dilate(face.astype(np.uint8), ell(31)).astype(bool)
    neck = facez.copy()
    if has_face:
        fy = np.nonzero(face.any(1))[0]; fx = np.nonzero(face.any(0))[0]
        neck[fy.min():int(fy.max() + 1.3 * (fy.max() - fy.min())), fx.min():fx.max()] = True
    for i in range(1, num):
        hm = hl == i
        if not (hm & neck).any() and hm.sum() < 0.03 * S.size: final |= hm & S
    alpha = final
    return alpha, body, strings, dict(notes=notes, has_face=bool(has_face), olive_session=bool(olive_session), hem=int(hem))


def soften(final, A, keep=None):
    f = cv2.GaussianBlur(final.astype(np.float32), (0, 0), 1.2)
    f = np.clip((f - 0.3) / 0.45, 0, 1)
    a = np.clip((A - 0.4) / 0.5, 0, 1)
    if keep is not None and keep.any():
        k = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.0); a = np.maximum(a, np.clip(k * 1.6, 0, 1))
    return f * a


def seg_standard(code, view, rgb, A, C, o, cls):
    """shirts / tees (cloth class 1) and pants (class 2): trust the garment parser, clean with colour rules"""
    h, w = A.shape
    S = largest(A > 0.5)
    y0, y1, x0, x1, H, W, cx = geometry(S)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32); Lc = lab[..., 0]
    skin = skin_mask(rgb); notes = []
    m = np.isin(C, [cls, 3]) & S
    other = (C == (2 if cls == 1 else 1)) & S
    ok = m.sum() > 0.25 * S.sum()
    if not ok:
        notes.append('garment parser failed: silhouette minus skin / other garment used')
        m = S & ~skin & ~other
        if cls == 1: m[int(y0 + o.get('cut', 0.82) * H):] = False
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ell(15)).astype(bool) & S & ~other
    m = largest(cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, ell(9)))
    m = fill_holes(m)
    if code not in ('ls06', 'ls18', 'ls09', 'te01', 'te05'):   # skin-coloured cloth: no skin rule
        edge = m & ~cv2.erode(m.astype(np.uint8), ell(o.get('band', 141))).astype(bool)
        if cls == 1:   # hands sit at the cuffs (low) and neck skin at the collar (top); sleeve prints in between can be skin-coloured
            ys = np.nonzero(m.any(1))[0]; t_, h_ = ys.min(), ys.max() - ys.min()
            edge[int(t_ + 0.10 * h_):int(t_ + o.get('handzone', 0.68) * h_)] = False
        m &= ~(skin & edge)
        m = fill_holes(largest(cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, ell(7))))
    if 'cutbottom' in o:
        ys = np.nonzero(m.any(1))[0]; m[int(ys.min() + o['cutbottom'] * (ys.max() - ys.min())):] = False
    strings = np.zeros_like(S)
    if code.startswith('te') and code != 'te07' and (C == 2).sum() > 0.01 * S.size:
        model = colour_model(lab, cv2.erode(((C == 2) & S).astype(np.uint8), ell(15)).astype(bool))
        if model is not None and model[0][0] < 125:
            ys = np.nonzero(m.any(1))[0]; hem = ys.max(); bx = np.nonzero(m.any(0))[0]
            th = cv2.morphologyEx(Lc, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 3))) > 28
            cand = (Lc > model[0][0] + 50) & th & ~skin & (A > 0.25)
            cand[:hem - int(0.05 * H)] = False; cand[hem + int(0.24 * H):] = False
            cand[:, :max(0, bx.min() - 30)] = False; cand[:, bx.max() + 30:] = False
            cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_CLOSE, ell(5))
            num, cl, st, _ = cv2.connectedComponentsWithStats(cand, 8)
            for i in range(1, num):
                x, y, ww, hh, ar = st[i]
                if hh > 0.035 * H and ww < 0.09 * W and y < hem + 0.08 * H: strings |= (cl == i) & ~m
    body = m.copy()
    alpha = m | strings
    return alpha, body, strings, dict(notes=notes, parser_ok=bool(ok))


def relight(rgb, alpha, wall):
    """gentle studio-ish correction: neutralise the wall cast, flatten left-right falloff, lift shadows, set white point"""
    img = rgb.astype(np.float32) / 255.0
    m = alpha > 0.6
    if wall is not None:
        g = wall.mean() / np.maximum(wall, 1e-3); g = np.clip(g, 0.88, 1.14); img = img * g
    else:  # dark, coloured room: pull the garment's average chroma halfway to neutral
        mean = img[m].mean(0); g = mean.mean() / np.maximum(mean, 1e-3); g = 1 + (np.clip(g, 0.8, 1.25) - 1) * 0.6; img = img * g
    lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
    ys, xs = np.nonzero(m)
    if len(xs) > 5000:
        sel = np.random.RandomState(0).choice(len(xs), 5000, replace=False)
        x = xs[sel].astype(np.float32); l = np.log(np.maximum(lum[ys[sel], xs[sel]], 0.02))
        k = np.polyfit(x - x.mean(), l, 1)[0]; k = float(np.clip(k, -2.5e-4, 2.5e-4))
        img = img * np.exp(-0.7 * k * (np.arange(img.shape[1], dtype=np.float32) - x.mean()))[None, :, None]
        lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
        p98 = np.percentile(lum[m], 98.5); p50 = np.percentile(lum[m], 50)
        gain = np.clip(0.93 / max(p98, 1e-3), 1.0, 1.35) if p50 > 0.38 else np.clip(0.8 / max(p98, 1e-3), 1.0, 1.25)
        img = img * gain
    img = np.clip(img, 0, 1)
    img = img + 0.10 * img * (1 - img) * (1 - img) * 4 * 0.5      # lift shadows a little
    img = np.clip((img - 0.5) * 1.05 + 0.5, 0, 1)
    return img


def compose(img, alpha, body, strings, o):
    ys = np.nonzero(body.any(1))[0]; xs = np.nonzero(body.any(0))[0]
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    full = alpha > 0.3; fy = np.nonzero(full.any(1))[0]; fx = np.nonzero(full.any(0))[0]
    colz = full[:, max(0, bx0 - 20):bx1 + 20]; ty = np.nonzero(colz.sum(1) > 6)[0]
    if len(ty): by0 = min(by0, ty.min())
    bh = by1 - by0 + 1
    sc = o.get('fill', 0.86) * CH / bh
    sc = min(sc, 0.93 * CW / (fx.max() - fx.min() + 1), max(0.87 * CH / (fy.max() - by0 + 1), 0.78 * CH / bh))
    top = 0.07 * CH
    cxm = (fx.min() + fx.max()) / 2.0 * 0.5 + (bx0 + bx1) / 2.0 * 0.5
    M = np.array([[sc, 0, CW / 2 - cxm * sc], [0, sc, top - by0 * sc]], np.float32)
    interp = cv2.INTER_AREA if sc < 1 else cv2.INTER_LANCZOS4
    pm = img * alpha[..., None]
    if sc < 1:
        k = 1.0 / sc; pm = cv2.GaussianBlur(pm, (0, 0), 0.35 * k); alpha = cv2.GaussianBlur(alpha, (0, 0), 0.35 * k)
    can = cv2.warpAffine(pm, M, (CW, CH), flags=cv2.INTER_LINEAR if sc < 1 else cv2.INTER_CUBIC, borderValue=0)
    ca = cv2.warpAffine(alpha, M, (CW, CH), flags=cv2.INTER_LINEAR, borderValue=0)
    fade = np.clip((CH - 8 - np.arange(CH, dtype=np.float32)) / 60.0, 0, 1)[:, None]; ca = ca * fade
    ca0 = ca.copy()
    for poly in o.get('erase', []):
        cv2.fillPoly(ca, [np.array([[int(px * CW), int(py * CH)] for px, py in poly], np.int32)], 0)
    if o.get('skinrects'):   # skin showing through fringe: drop skin-coloured pixels inside the given canvas rectangles only
        ycc = cv2.cvtColor((np.clip(can, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2YCrCb).astype(np.int16)
        sk = ((ycc[..., 1] > 137) & (ycc[..., 1] - ycc[..., 2] > 15)).astype(np.uint8)
        sk = cv2.dilate(sk, np.ones((7, 7), np.uint8)); zone = np.zeros_like(sk)
        for x0, y0, x1, y1 in o['skinrects']: zone[int(y0 * CH):int(y1 * CH), int(x0 * CW):int(x1 * CW)] = 1
        ca = ca * (1 - (sk & zone))
    num, cl, st, _ = cv2.connectedComponentsWithStats((ca > 0.5).astype(np.uint8), 8)
    if num > 1:
        big = st[1:, cv2.CC_STAT_AREA].max()
        keep = np.zeros(num, bool); keep[1:] = (st[1:, cv2.CC_STAT_AREA] >= min(big, o.get('island', 2500)))
        ca = ca * cv2.dilate(keep[cl].astype(np.uint8), np.ones((5, 5), np.uint8))
    ca = cv2.GaussianBlur(cv2.erode(ca, np.ones((3, 3), np.uint8)), (0, 0), 0.8)
    ca = np.clip((ca - 0.12) / 0.8, 0, 1)
    # The black pictures were  can * min(ca / ca0, 1) * fade  =  colour * min(ca, ca0): the same colour and the same
    # coverage are kept here, only un-premultiplied (colour = can / warped alpha) instead of flattened on black.
    aw = ca0 / np.maximum(fade, 1e-6); aw[fade[:, 0] <= 0] = 0
    col = np.clip(can / np.maximum(aw, 1e-4)[..., None], 0, 1)
    a = np.where(ca0 >= 1e-3, np.minimum(ca, ca0), 0.0).astype(np.float32); a[ca < 0.02] = 0
    return (col, a, aw > 0.05), None, float(sc)


RAW = os.environ.get('PIC_RAW')   # optional folder: the cut-out before the edge clean-up, so edges.py can redo only that
def dark_rim(col, a, o):
    """Override "darkrim" (light, unprinted cloth only): dark bits of trousers / room that sit in the outline between
    fringe tassels. They were invisible on black and are specks on sand. Removed when they are much darker than the
    cloth around them, lie within a few pixels of the outline and are open to the outside. Never on by default: on a
    dark or printed garment this would eat the garment."""
    thr = o['darkrim'] if isinstance(o['darkrim'], (int, float)) and not isinstance(o['darkrim'], bool) else 0.55
    lum = col @ np.array([0.299, 0.587, 0.114], np.float32)
    solid = a > 0.5; k = solid.astype(np.float32)
    loc = cv2.GaussianBlur(lum * k, (0, 0), 25) / np.maximum(cv2.GaussianBlur(k, (0, 0), 25), 1e-3)
    r = int(o.get('darkrim_px', 14))
    band = solid & ~cv2.erode(solid.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))).astype(bool)
    dark = band & (lum < thr * loc)
    num, lab = cv2.connectedComponents(dark.astype(np.uint8), connectivity=8)
    open_ = cv2.dilate((~solid).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    ids = np.unique(lab[dark & open_]); ids = ids[ids > 0]
    rem = np.isin(lab, ids)
    if not rem.any(): return a
    rem = cv2.dilate(rem.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
    return a * np.clip(1 - cv2.GaussianBlur(rem, (0, 0), 0.8) * 1.5, 0, 1)


def view_overrides(code, view):
    o = dict(OVR.get(code, {}).get('*', {})); o.update(OVR.get(code, {}).get(view, {})); return o


def finish(raw, code, view):
    col, a, valid = raw
    if RAW:
        os.makedirs(RAW, exist_ok=True); b = os.path.join(RAW, '%s_%s' % (code, view))
        cv2.imwrite(b + '_rgb.png', cv2.cvtColor((col * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 1])
        cv2.imwrite(b + '_a.png', (a * 65535 + 0.5).astype(np.uint16), [cv2.IMWRITE_PNG_COMPRESSION, 1])
        cv2.imwrite(b + '_v.png', valid.astype(np.uint8) * 255, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    o = view_overrides(code, view)
    if o.get('darkrim'): a = dark_rim(col, a, o)
    col, a = clean_edges(col, a, valid)
    save_webps(col, a, code, view)
    return a


def spread(col, known, passes):
    """grow the colours of the known pixels outward by `passes` pixels (average of the known neighbours)"""
    col = col * known[..., None]; kn = known.astype(np.float32)
    for _ in range(passes):
        k2 = cv2.blur(kn, (3, 3)); c2 = cv2.blur(col, (3, 3))
        new = (kn == 0) & (k2 > 1e-6)
        col[new] = c2[new] / k2[new][:, None]; kn[new] = 1
    return col, kn > 0


def fill_far(col, known):
    """push-pull: every unknown pixel takes a smooth average of the known colours around it (whole canvas)"""
    k = known.astype(np.float32); c = col * k[..., None]
    pyr = [(c, k)]
    while min(pyr[-1][1].shape) > 2:
        c0, k0 = pyr[-1]; sz = ((k0.shape[1] + 1) // 2, (k0.shape[0] + 1) // 2)
        pyr.append((cv2.resize(c0, sz, interpolation=cv2.INTER_AREA), cv2.resize(k0, sz, interpolation=cv2.INTER_AREA)))
    cu, ku = pyr[-1]; out = cu / np.maximum(ku, 1e-6)[..., None]
    if ku.max() <= 0: return col
    for c0, k0 in pyr[-2::-1]:
        up = cv2.resize(out, (k0.shape[1], k0.shape[0]), interpolation=cv2.INTER_LINEAR)
        w = np.clip(k0 * 4, 0, 1)[..., None]            # any known coverage at this level wins over the coarser guess
        out = w * (c0 / np.maximum(k0, 1e-6)[..., None]) + (1 - w) * up
    return np.where(known[..., None], col, out)


def clean_edges(col, a, valid):
    """Edges for any ground. The photo's outline pixels are a mix of cloth and whatever was behind it (wall, trousers,
    skin): invisible on black, a fringe on sand. So: (1) tighten the coverage a little, (2) replace the colour of the
    soft outline by cloth colour bled out from just inside the outline, (3) fill everything empty with the same bled
    colour so neither the encoder nor a scaling browser can mix a foreign colour in. Fully covered pixels keep the
    photo's own colour untouched."""
    a = np.clip((a - EDGE_T0) / (1 - EDGE_T0), 0, 1)
    solid = (a >= 0.985) & valid
    core = cv2.erode(solid.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)      # one pixel inside the outline
    b1, r1 = spread(col, core, 6)
    # thin things (strings, fringe) have no solid core nearby: bleed from their own ridge instead
    ridge = (a >= 0.7) & valid & ~r1
    b2, r2 = spread(col, ridge, 4)
    bled = np.where(r1[..., None], b1, b2); reach = r1 | r2
    w = np.clip((a - 0.6) / 0.385, 0, 1); w = w * w * (3 - 2 * w)                          # 1 = the photo's own colour
    w = np.where(reach, w, np.where(valid, 1.0, 0.0)).astype(np.float32)[..., None]
    col = np.where(reach[..., None], bled, col) * (1 - w) + col * w
    col = fill_far(col, reach | (valid & (a > 0.02)))
    return np.clip(col, 0, 1), a.astype(np.float32)
EDGE_T0 = float(os.environ.get('PIC_EDGE_T0', 0.10))


WEBP = dict(quality=int(os.environ.get('PIC_Q', 84)), alpha_quality=100, method=6, exact=True)   # lossless alpha; exact keeps the bled colour under it
def save_webps(col, a, code, view):
    """col: straight RGB float (bled over the whole canvas), a: coverage float. Smaller sizes are scaled premultiplied."""
    d = os.path.join(OUT, code); os.makedirs(d, exist_ok=True)
    for name, (ww, hh) in {'1600': (1200, 1600), '960': (720, 960), '480': (360, 480)}.items():
        if os.environ.get('PIC_KEEP') and not os.path.exists(os.path.join(d, '%s-%s.webp' % (view, name))): continue
        if ww == 1200: c, al = col, a
        else:
            al = cv2.resize(a, (ww, hh), interpolation=cv2.INTER_AREA)
            pm = cv2.resize(col * a[..., None], (ww, hh), interpolation=cv2.INTER_AREA)
            c = (pm + 0.02 * cv2.resize(col, (ww, hh), interpolation=cv2.INTER_AREA)) / (al + 0.02)[..., None]
        al8 = (np.clip(al, 0, 1) * 255 + 0.5).astype(np.uint8); al8[al8 < 3] = 0
        rgba = np.dstack([(np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8), al8])
        Image.fromarray(rgba, 'RGBA').save(os.path.join(d, '%s-%s.webp' % (view, name)), 'WEBP', **WEBP)


def fabric(code, img, alpha, body, meta):
    """1024 swatch from the largest clean square of the front panel; left/right edges mirror-blended so it tiles in x"""
    ys = np.nonzero(body.any(1))[0]; xs = np.nonzero(body.any(0))[0]
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max(); bh = by1 - by0; bw = bx1 - bx0
    solid = (alpha > 0.95).astype(np.uint8)
    zone = np.zeros_like(solid); zone[int(by0 + 0.50 * bh):int(by0 + 0.90 * bh), int(bx0 + 0.25 * bw):int(bx0 + 0.75 * bw)] = 1
    dt = cv2.distanceTransform(solid, cv2.DIST_C, 3) * zone
    _, r, _, (px, py) = cv2.minMaxLoc(dt)
    r = int(min(r, 0.2 * bw) * 0.92)
    if r < 40: return False
    sw = img[py - r:py + r, px - r:px + r].copy()
    g = cv2.cvtColor((sw * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx, jyy, jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
    ang = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy)); coh = np.hypot(jxx - jyy, 2 * jxy) / (jxx + jyy + 1e-6)
    if coh > 0.25 and abs(ang) < 14 and jxx > jyy:   # vertical stripes leaning a little: rotate them upright
        R = int(r * 1.25)
        if py - R >= 0 and px - R >= 0 and py + R < img.shape[0] and px + R < img.shape[1] and solid[py - R:py + R, px - R:px + R].mean() > 0.97:
            big = img[py - R:py + R, px - R:px + R]
            rot = cv2.warpAffine(big, cv2.getRotationMatrix2D((R, R), ang, 1.0), (2 * R, 2 * R), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
            sw = rot[R - r:R + r, R - r:R + r]
    sw = cv2.resize(sw, (1024, 1024), interpolation=cv2.INTER_LANCZOS4 if r < 512 else cv2.INTER_AREA)
    lum = sw @ np.array([0.299, 0.587, 0.114], np.float32)
    low = cv2.resize(cv2.GaussianBlur(cv2.resize(lum, (64, 64), interpolation=cv2.INTER_AREA), (0, 0), 11), (1024, 1024), interpolation=cv2.INTER_CUBIC); sw = sw * (low.mean() / np.maximum(low, 1e-3))[..., None] ** 0.8   # flatten shading
    p = np.percentile(sw, 99.5)
    if p > 0.97: sw = sw * (0.97 / p)
    sw = np.clip(sw, 0, 1)
    x = np.arange(1024, dtype=np.float32); d = np.minimum(x, 1023 - x) / 110.0
    wgt = 0.5 + 0.5 * np.clip(d, 0, 1) ** 1; wgt = (wgt * wgt * (3 - 2 * wgt))[None, :, None] if False else wgt[None, :, None]
    sw = wgt * sw + (1 - wgt) * sw[:, ::-1]
    cv2.imwrite(os.path.join(OUT, code, 'fabric-1024.webp'), cv2.cvtColor((sw * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_WEBP_QUALITY, 88])
    meta['fabric_px'] = int(2 * r)
    return True


def category(code):
    return {'tz': 'poncho', 'ls': 'shirt', 'te': 'shirt', 'pa': 'pants'}.get(code[:2])


def run_view(code, view, src=None):
    o = dict(OVR.get(code, {}).get('*', {})); o.update(OVR.get(code, {}).get(view, {}))
    f = src or o.get('src') or SOURCES[code][view][0]
    cat = category(code)
    rgb, A, C = load(f, cat != 'poncho' or code in OLIVE_ITEMS)
    h, w = A.shape; hs, ws = int(h * SEG), int(w * SEG)
    rs = cv2.resize(rgb, (ws, hs), interpolation=cv2.INTER_AREA); As = cv2.resize(A, (ws, hs), interpolation=cv2.INTER_AREA)
    Cs = cv2.resize(C, (ws, hs), interpolation=cv2.INTER_NEAREST)
    if cat == 'poncho': fin, body, strings, meta = seg_poncho(code, view, rs, As, Cs, o)
    else: fin, body, strings, meta = seg_standard(code, view, rs, As, Cs, o, 2 if cat == 'pants' else 1)
    up = lambda m: cv2.resize(m.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
    body = up(body) > 0.5; strings = up(strings) > 0.35
    alpha = soften(up(fin), A, strings)
    bgm = (A[::4, ::4] < 0.05); r4 = rgb[::4, ::4]
    wallpx = r4[bgm & (r4.min(2) > 150)]
    wall = wallpx.mean(0) / 255.0 if len(wallpx) > 0.15 * bgm.sum() else None
    nz = np.nonzero(alpha > 0.02)
    if len(nz[0]):      # crop to the item before the float work (speed)
        ya, yb, xa, xb = max(0, nz[0].min() - 8), min(h, nz[0].max() + 8), max(0, nz[1].min() - 8), min(w, nz[1].max() + 8)
        rgb, alpha, body, strings = rgb[ya:yb, xa:xb], alpha[ya:yb, xa:xb], body[ya:yb, xa:xb], strings[ya:yb, xa:xb]
        if not body.any(): body = alpha > 0.5
    img = relight(rgb, alpha, wall)
    raw, _, sc = compose(img, alpha, body, strings, o)
    ca = finish(raw, code, view)
    meta.update(source=f, scale=round(sc, 3), strings=bool(strings.any()), dark_room=wall is None,
                item_frac=round(float((ca > 0.5).mean()), 3))
    if cat == 'poncho' and view == 'front' and os.environ.get('PIC_FABRIC'):   # swatches are owned by the 3D work now: opt-in only
        meta['fabric'] = fabric(code, img, alpha, body, meta)
    json.dump(meta, open(os.path.join(CACHE, 'meta_%s_%s.json' % (code, view)), 'w'))
    return code, view, meta


def fallback_view(code, view):
    """last resort so that no placeholder photo survives: silhouette minus skin, composed the same way"""
    f = SOURCES[code][view][0]; rgb, A, C = load(f)
    S = largest(A > 0.5); sk = cv2.dilate(skin_mask(rgb).astype(np.uint8), ell(31)).astype(bool)
    alpha = A * (S & ~sk); body = S & ~sk
    raw, _, sc = compose(relight(rgb, alpha, None), alpha, body, np.zeros_like(S), {})
    finish(raw, code, view)
    return dict(source=f, notes=['pipeline failed on this view: crude silhouette-minus-skin cut used'], fallback=True)


def job(a):
    try: return run_view(*a)
    except Exception as e:
        import traceback; traceback.print_exc()
        m = dict(error=repr(e))
        try: m.update(fallback_view(a[0], a[1]))
        except Exception as e2: m['error2'] = repr(e2)
        json.dump(m, open(os.path.join(CACHE, 'meta_%s_%s.json' % (a[0], a[1])), 'w'))
        return a[0], a[1], m


VIEWS = os.environ.get('PIC_VIEWS', 'front,back,side,detail').split(',')
def wanted(code, v):
    """PIC_KEEP: only the views that are published (files exist); a poncho's front is still computed, its colours are reused by the back"""
    if not os.environ.get('PIC_KEEP'): return True
    return os.path.exists(os.path.join(OUT, code, v + '-1600.webp')) or (category(code) == 'poncho' and v == 'front')
def job_item(code):
    return [job((code, v)) for v in ('front', 'back', 'side', 'detail') if v in SOURCES[code] and v in VIEWS and wanted(code, v)]


if __name__ == '__main__':
    codes = [c for c in SOURCES if c not in ('ne01', 'br01')] if sys.argv[1] == 'all' else sys.argv[1].split(',')
    jobs = [(c, v) for c in codes for v in SOURCES[c] if not (len(sys.argv) > 2 and sys.argv[2] in ('front', 'back', 'side', 'detail') and v != sys.argv[2])]
    nj = int(sys.argv[sys.argv.index('-j') + 1]) if '-j' in sys.argv else 1
    if len(jobs) == sum(len(SOURCES[c]) for c in codes) and not (len(sys.argv) > 2 and sys.argv[2] in ('front', 'back', 'side', 'detail')):      # whole items: front first, so PROTO is shared
        it = Pool(nj).imap_unordered(job_item, codes) if nj > 1 else map(job_item, codes)
        for res in it:
            for c, v, m in res: print(c, v, json.dumps(m), flush=True)
    else:
        for c, v, m in map(job, jobs): print(c, v, json.dumps(m), flush=True)
