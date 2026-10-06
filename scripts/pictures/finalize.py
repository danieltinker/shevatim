"""Safety net: any view whose picture is still the original placeholder (older than the run) gets the crude
silhouette-minus-skin cut, so no model photo can survive in the shop. usage: finalize.py <unix time the run started>"""
import os, sys, json
import process as P
t0 = float(sys.argv[1])
for code, views in P.SOURCES.items():
    if code in ('ne01', 'br01'): continue
    for v in views:
        p = os.path.join(P.OUT, code, v + '-1600.webp')
        if not os.path.exists(p) or os.path.getmtime(p) < t0:
            try:
                m = P.fallback_view(code, v); m['error'] = 'not reached by the main pipeline'
            except Exception as e:
                m = dict(error=repr(e))
            json.dump(m, open(os.path.join(P.CACHE, 'meta_%s_%s.json' % (code, v)), 'w')); print('fallback', code, v, m)
