# Cleans the fabric swatches (shop/public/media/items/<code>/fabric-1024.webp) so the 3D lighting is not
# fighting folds baked into phone photos. Three treatments, chosen per item by looking at its photos:
#   stripe  – a 1-D stripe profile (bands aligned by cross-correlation, median per column), re-woven clean
#   flatten – keep the photo (ornaments, prints, checks) but divide out the lighting and restore the colour
#   solid   – the item colour with a woven texture
# The untouched originals are kept in cloth-lab/swatch-src/ (not committed; they are in git history).
import os, sys, json, shutil
import numpy as np
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); shop = os.path.dirname(here)
items_dir = os.path.join(shop, "public/media/items"); src_dir = os.path.join(here, "swatch-src")
os.makedirs(src_dir, exist_ok=True)
seed = {i["code"]: i for i in json.load(open(os.path.join(shop, "db/seed.json")))["items"] if i.get("cloth")}
ov_path = os.path.join(shop, "db/cloth-overrides.json")
overrides = json.load(open(ov_path)) if os.path.exists(ov_path) else {}

# mode, optional source ("back"/"front" product picture + crop box as fractions x0,y0,size-of-width), optional colour
CFG = {
  "tz01": ("solid",), "tz02": ("flatten", ("back", 0.37, 0.37, 0.30)), "tz03": ("flatten",), "tz04": ("stripe",), "tz05": ("stripe",),
  "tz06": ("stripe", ("back", 0.36, 0.30, 0.30)), "tz07": ("solid",), "tz08": ("flatten",), "tz09": ("ribs", None, None, 50),
  "tz10": ("flatten",), "tz11": ("stripe",), "tz12": ("solid",), "tz13": ("ribs", None, None, 22), "tz14": ("ribs", None, None, 22),
  "tz15": ("copy", "tz08"), "tz16": ("solid",), "tz17": ("stripe", ("back", 0.30, 0.20, 0.30)), "tz18": ("solid",),
  "tz19": ("ribs", None, None, 22), "tz20": ("ribs", None, None, 22), "tz21": ("ribs", None, None, 22), "tz22": ("solid",), "tz23": ("flatten", ("back", 0.30, 0.22, 0.36)),
  "tz24": ("flatten",), "tz25": ("mesh", None, "#8D9098"), "tz26": ("solid",), "tz27": ("flatten", ("back", 0.30, 0.30, 0.36)),
  "tz28": ("solid",), "tz29": ("ribs", None, None, 22), "tz30": ("stripe",), "tz31": ("ribs", None, None, 22), "tz32": ("ribs", None, None, 55),
}
rng = np.random.default_rng(7)
def hexrgb(h): h = h.lstrip("#"); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)
def lum(a): return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114
def blur(a, r): return np.asarray(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32)

def weave(n=1024):
    """Multiplicative woven texture: warp ribs (4 mm), weft threads, slubs, grain. Mean 1."""
    x = np.arange(n)
    ribs = 0.035 * np.sin(x * 2 * np.pi / 8.2)[None, :] + 0.02 * np.sin(x * 2 * np.pi / 2.7 + 1.0)[None, :]
    weft = 0.02 * np.sin(np.arange(n) * 2 * np.pi / 3.1)[:, None] + 0.012 * rng.standard_normal((n, 1))
    col = 0.018 * rng.standard_normal((1, n))
    grain = 0.03 * rng.standard_normal((n, n))
    slub = blur((rng.standard_normal((n, n)) * 40 + 128)[..., None].repeat(3, 2), 1.2)[..., 0]
    slub = (blur(np.where(rng.random((n, n)) > 0.9985, 255.0, 0.0)[..., None].repeat(3, 2), 0.8)[..., 0] / 255.0)
    slub = np.asarray(Image.fromarray((np.clip(slub * 4, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(0)).resize((n, n)), dtype=np.float32) / 255.0
    streak = np.asarray(Image.fromarray((slub * 255).astype(np.uint8)).resize((n, n // 12)).resize((n, n)), dtype=np.float32) / 255.0  # stretched vertically
    return 1 + ribs + weft + col + grain + 0.05 * streak

def load_source(code, src):
    if src:
        view, x0, y0, w = src
        im = Image.open(os.path.join(items_dir, code, "%s-1600.webp" % view)).convert("RGB")
        W, H = im.size; s = int(w * W)
        return im.crop((int(x0 * W), int(y0 * H), int(x0 * W) + s, int(y0 * H) + s)).resize((1024, 1024), Image.LANCZOS)
    keep = os.path.join(src_dir, code + ".webp")
    if not os.path.exists(keep): shutil.copy(os.path.join(items_dir, code, "fabric-1024.webp"), keep)
    return Image.open(keep).convert("RGB").resize((1024, 1024), Image.LANCZOS)

def balance(a, base, pct):
    """White balance: the cloth's ground colour (a high percentile per channel) becomes the item's base colour."""
    if lum(base) < 150: return a
    ref = np.percentile(a.reshape(-1, 3), pct, axis=0)
    return a * (base / np.maximum(ref, 1))

def do_ribs(a, base, sigma):
    """Near-solid cloth with woven ribs or faint stripes: the item colour, modulated by the fine part of the stripe profile only."""
    p = stripe_profile(a)
    pL = lum(p)
    k = np.exp(-0.5 * (np.arange(-3 * sigma, 3 * sigma + 1) / sigma) ** 2); k /= k.sum()
    smooth = np.convolve(np.pad(pL, 3 * sigma, mode="reflect"), k, mode="valid")
    detail = np.clip(pL / np.maximum(smooth, 1), 0.86, 1.1)
    img = np.ones((1024, 1024, 3), dtype=np.float32) * base * 0.985 * detail[None, :, None]
    return img * weave()[..., None]

def do_stripe(a, base):
    p = stripe_profile(a)
    img = np.repeat(p[None, :, :], 1024, axis=0)
    img = balance(img, base, 80)
    return img * weave()[..., None]

def stripe_profile(a):
    n = 1024; nb = 16; h = n // nb
    L = lum(a)
    prof = np.stack([a[k * h:(k + 1) * h].mean(axis=0) for k in range(nb)])          # nb × n × 3
    pl = np.stack([L[k * h:(k + 1) * h].mean(axis=0) for k in range(nb)]); pl = pl - blur(pl[..., None].repeat(3, 2), 60)[..., 0]
    ref = pl[nb // 2]
    out = []
    for k in range(nb):  # align every band to the middle one (folds shift and slant the stripes)
        best, bs = -1e18, 0
        for s in range(-90, 91, 2):
            c = float((np.roll(pl[k], s) * ref).sum())
            if c > best: best, bs = c, s
        out.append(np.roll(prof[k], bs, axis=0))
    p = np.median(np.stack(out), axis=0)                                               # n × 3
    # divide out slow lighting across the width (upper envelope of the luminance)
    pL = lum(p); pad = np.pad(pL, 150, mode="reflect")
    env = np.lib.stride_tricks.sliding_window_view(pad, 301).max(axis=1)
    env = np.convolve(np.pad(env, 150, mode="reflect"), np.ones(301) / 301, mode="valid")
    return p * (np.median(env) / env)[:, None]

def do_flatten(a, base):
    mx = np.asarray(Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.MaxFilter(31)), dtype=np.float32)
    env = blur(mx, 70)
    out = a / np.maximum(env, 1) * np.median(env.reshape(-1, 3), axis=0)
    out = balance(out, base, 85)
    return out * (1 + 0.02 * rng.standard_normal((1024, 1024, 1)))

def do_solid(base):
    return np.ones((1024, 1024, 3), dtype=np.float32) * base * 0.985 * weave()[..., None]

def do_mesh(col):
    img = np.ones((1024, 1024, 3), dtype=np.float32) * col
    yy, xx = np.mgrid[0:1024, 0:1024]
    cell = 20.48; dx = (xx % cell) - cell / 2; dy = ((yy + (xx // cell % 2) * cell / 2) % cell) - cell / 2
    hole = np.clip(1 - (np.sqrt(dx * dx + dy * dy) - 3.2) / 1.5, 0, 1)
    return img * (1 - 0.45 * hole[..., None]) * (1 + 0.03 * rng.standard_normal((1024, 1024, 1)))

only = sys.argv[1].split(",") if len(sys.argv) > 1 else None
for code, cfg in CFG.items():
    if only and code not in only: continue
    spec = overrides.get(code, seed[code]["cloth"])
    base = hexrgb(cfg[2] if len(cfg) > 2 and cfg[2] else spec["baseColor"])
    src = cfg[1] if len(cfg) > 1 and cfg[0] != "copy" else None
    mode = cfg[0]
    if mode == "copy":  # same cloth as another item whose photo is flatter
        load_source(code, None); shutil.copy(os.path.join(items_dir, cfg[1], "fabric-1024.webp"), os.path.join(items_dir, code, "fabric-1024.webp")); print(code, "copy of", cfg[1]); continue
    a = np.asarray(load_source(code, src), dtype=np.float32)
    out = do_ribs(a, base, cfg[3]) if mode == "ribs" else do_stripe(a, base) if mode == "stripe" else do_flatten(a, base) if mode == "flatten" else do_mesh(base) if mode == "mesh" else do_solid(base)
    load_source(code, None)  # make sure the original is kept
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(os.path.join(items_dir, code, "fabric-1024.webp"), quality=90, method=4)
    print(code, mode)
