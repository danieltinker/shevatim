"""Review / final contact sheets, 12 views per sheet at 400x533, the cut-out laid on black with the shadows lifted so
dark leftovers show (for halos and fringes on the shop's grounds use sheet.py --grounds).
usage: review.py <prefix> code:view ...   (or 'candidates' / 'final' to take the list from sources / pictures-final.json)"""
import sys, os, json, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from paths import OUT, SOURCES_JSON, DB
from sheet import on_ground
def tile(code, view, lift=True):
    im = on_ground(os.path.join(OUT, code, view + '-960.webp'), (0, 0, 0))
    if im is None: im = np.zeros((960, 720, 3), np.uint8)
    im = cv2.resize(im, (400, 533), interpolation=cv2.INTER_AREA)
    if lift: im = (255 * (im / 255.0) ** 0.55).astype(np.uint8)
    im = cv2.copyMakeBorder(im, 0, 0, 0, 3, cv2.BORDER_CONSTANT, value=(90, 90, 90))
    cv2.putText(im, code + ' ' + view, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2, cv2.LINE_AA)
    return im
def sheets(prefix, items, lift=True):
    for i in range(0, len(items), 12):
        t = [tile(c, v, lift) for c, v in items[i:i + 12]]
        while len(t) % 6: t.append(np.zeros_like(t[0]))
        cv2.imwrite('%s%02d.jpg' % (prefix, i // 12), np.vstack([np.hstack(t[j:j + 6]) for j in range(0, len(t), 6)]), [cv2.IMWRITE_JPEG_QUALITY, 80])
    return (len(items) + 11) // 12
if __name__ == '__main__':
    if sys.argv[2] == 'candidates':
        S = json.load(open(SOURCES_JSON))
        items = [(c, v) for c in S for v in ('back', 'front', 'side') if v in S[c] and (v != 'side' or c.startswith('pa')) and c[:2] in sys.argv[3].split(',')]
    elif sys.argv[2] == 'final':
        F = json.load(open(os.path.join(DB, 'pictures-final.json')))
        items = [(c, p['view']) for c in F for p in F[c] if p.get('kind', 'product') == 'product']
    else: items = [a.split(':') for a in sys.argv[2:]]
    print(sheets(sys.argv[1], items, lift=sys.argv[2] != 'final'))
