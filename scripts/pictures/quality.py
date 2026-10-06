"""Step 3: write shop/public/media/items/quality.json from the per-view meta (cache) + reviewed scores in scores.json.
scores.json: {"<code>": {"<view>": [score, "notes"]}} filled by eye from the contact sheets; unreviewed views get a
conservative automatic score from the pipeline's own flags."""
import os, json
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '../../public/media/items')
CACHE = os.environ.get('PIC_CACHE', '/home/claude/pic-cache')
S = json.load(open(os.path.join(HERE, '../../db/picture-sources.json')))
R = json.load(open(os.path.join(HERE, 'scores.json'))) if os.path.exists(os.path.join(HERE, 'scores.json')) else {}
D = R.get('_defaults', {})
OV = json.load(open(os.path.join(HERE, 'overrides.json'))) if os.path.exists(os.path.join(HERE, 'overrides.json')) else {}
q = {}
for code, views in S.items():
    q[code] = {}
    for view in views:
        p = os.path.join(CACHE, 'meta_%s_%s.json' % (code, view))
        m = json.load(open(p)) if os.path.exists(p) else {}
        notes = list(m.get('notes', []))
        if code[:2] in ('ne', 'br'): score = 4 if code == 'ne01' else 3
        elif code[:2] in ('ls', 'pa') or code == 'te07': score = 3 if m.get('parser_ok', True) else 2
        elif code[:2] == 'te': score = 3
        else:
            score = 3
            if m.get('dark_room'): score = 2; notes.append('barber-shop photo: dark busy background, coloured light, white shorts under the item')
            if any('olive item' in n for n in notes): score = 2
        if code[:2] == 'tz' and view == 'side' and score > 2: score = 2; notes.append('side views are weak: the arm leaves an empty notch')
        if code[:2] == 'tz' and OV.get(code, {}).get('*', {}).get('strict'):
            score = min(score, 2); notes.append('non-olive session (white tee / shorts, bare arms): aggressive colour gate used; under-tee, shorts or part of an arm may still show - check before publishing')
        if code[:2] in ('tz', 'te') and code != 'te07':
            notes.append('tzitzit strings kept' if m.get('strings') else 'tzitzit strings not recovered')
        auto = True
        if code in R and view in R[code]:
            score, extra = R[code][view]; auto = False
            if extra: notes.insert(0, extra)
        elif code[:2] in D:
            dv = D[code[:2]]
            if isinstance(dv, list): notes.insert(0, dv[1])
        if 'error' in m: score = 1; notes.insert(0, 'pipeline error: ' + m['error'])
        e = {'source': m.get('source', views[view][0]), 'score': int(score), 'notes': '; '.join(n for n in notes if n) + ('' if not auto else ' (score not individually reviewed)')}
        q[code][view] = e
    if code.startswith('tz'):
        q[code]['_fabric'] = {'file': 'fabric-1024.webp', 'ok': os.path.exists(os.path.join(OUT, code, 'fabric-1024.webp'))}
json.dump(q, open(os.path.join(OUT, 'quality.json'), 'w'), indent=1, ensure_ascii=False)
from collections import Counter
c = Counter(v['score'] for it in q.values() for k, v in it.items() if not k.startswith('_'))
print(sorted(c.items()), sum(c.values()))
