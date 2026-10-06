"""Round 2: publish only clean real cut-outs. Reads curation.json ({code: {view: [score, note]}} = the views to publish,
in display order), deletes every other <view>-*.webp from public/media/items (never fabric-1024.webp or 3d-*),
writes db/pictures-final.json and quality.json (published views only) and the final contact sheets."""
import os, sys, json, glob
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from paths import CACHE, OUT, SOURCES_JSON, DB
S = json.load(open(SOURCES_JSON))
K = json.load(open(os.path.join(HERE, 'curation.json')))
final, q, dropped = {}, {}, []
for code in S:
    keep = K.get(code, {})
    order = [v for v in (('back', 'front', 'side', 'detail') if code.startswith('ls') else ('front', 'back', 'side', 'detail')) if v in keep]
    final[code] = []; q[code] = {}
    for v in order:
        assert all(os.path.exists(os.path.join(OUT, code, '%s-%d.webp' % (v, n))) for n in (480, 960, 1600)), (code, v)
        final[code].append({'view': v, 'base': '/media/items/%s/%s' % (code, v), 'sizes': [480, 960, 1600], 'ext': 'webp', 'w': 1200, 'h': 1600, 'kind': 'product'})
        p = os.path.join(CACHE, 'meta_%s_%s.json' % (code, v)); m = json.load(open(p)) if os.path.exists(p) else {}
        q[code][v] = {'source': m.get('source', S[code][v][0]), 'score': keep[v][0], 'notes': keep[v][1]}
    for v in ('front', 'back', 'side', 'detail'):
        if v in keep: continue
        for f in glob.glob(os.path.join(OUT, code, v + '-*.webp')):
            os.remove(f); dropped.append(os.path.relpath(f, OUT))
json.dump(final, open(os.path.join(DB, 'pictures-final.json'), 'w'), indent=1)
json.dump(q, open(os.path.join(OUT, 'quality.json'), 'w'), indent=1, ensure_ascii=False)
from collections import Counter
print('published', sum(len(v) for v in final.values()), 'deleted files', len(dropped))
print(sorted(Counter((c[:2], p['view']) for c, v in final.items() for p in v).items()))
print('EMPTY:', [c for c, v in final.items() if not v])
