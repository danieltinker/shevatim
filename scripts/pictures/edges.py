"""Redo only the edge clean-up and the encoding from the raw cut-outs that process.py leaves in PIC_RAW
(<code>_<view>_rgb.png straight colour, _a.png 16-bit coverage, _v.png where the colour is real).
usage: PIC_RAW=<dir> [PIC_OUT=<dir>] [PIC_EDGE_T0=0.10] [PIC_Q=84] edges.py all | tz01:back ls01:front ...   [-j N]"""
import os, sys, glob, cv2, numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import process as P

def one(cv):
    code, view = cv; b = os.path.join(P.RAW, '%s_%s' % (code, view))
    col = cv2.cvtColor(cv2.imread(b + '_rgb.png'), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    a = cv2.imread(b + '_a.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0
    valid = cv2.imread(b + '_v.png', 0) > 127
    o = P.view_overrides(code, view)
    if o.get('darkrim'): a = P.dark_rim(col, a, o)
    col, a = P.clean_edges(col, a, valid)
    P.save_webps(col, a, code, view)
    return code, view

if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if x != '-j' and not x.isdigit()]
    nj = int(sys.argv[sys.argv.index('-j') + 1]) if '-j' in sys.argv else 1
    if args[0] == 'all':
        jobs = sorted(tuple(os.path.basename(f)[:-8].split('_', 1)) for f in glob.glob(os.path.join(P.RAW, '*_rgb.png')))
    else: jobs = [tuple(x.split(':')) for x in args]
    for c, v in (Pool(nj).imap_unordered(one, jobs) if nj > 1 else map(one, jobs)): print(c, v, flush=True)
