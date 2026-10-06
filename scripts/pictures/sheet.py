"""contact sheets of the outputs: sheet.py <out.jpg> code:view ...  |  sheet.py --all <dir>"""
import sys, os, json, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '../../public/media/items')
def tile(code, view):
    im = cv2.imread(os.path.join(OUT, code, view + '-480.webp'))
    if im is None: im = np.zeros((480, 360, 3), np.uint8)
    im = cv2.resize(im, (300, 400)); im = cv2.copyMakeBorder(im, 0, 0, 0, 2, cv2.BORDER_CONSTANT, value=(60, 60, 60))
    cv2.putText(im, code + ' ' + view, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1, cv2.LINE_AA)
    return im
def sheet(path, items, cols=8):
    t = [tile(*i) for i in items]
    while len(t) % cols: t.append(np.zeros_like(t[0]))
    cv2.imwrite(path, np.vstack([np.hstack(t[i:i + cols]) for i in range(0, len(t), cols)]), [cv2.IMWRITE_JPEG_QUALITY, 82])
if __name__ == '__main__':
    if sys.argv[1] == '--all':
        S = json.load(open(os.path.join(HERE, '../../db/picture-sources.json')))
        items = [(c, v) for c in S for v in ('front', 'back', 'side', 'detail') if v in S[c]]
        os.makedirs(sys.argv[2], exist_ok=True)
        for i in range(0, len(items), 16): sheet(os.path.join(sys.argv[2], 'sheet_%02d.jpg' % (i // 16)), items[i:i + 16])
    else: sheet(sys.argv[1], [a.split(':') for a in sys.argv[2:]])
