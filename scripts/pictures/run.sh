#!/bin/sh
# Full re-run of the item photographs as TRANSPARENT cut-outs (RGBA WebP, straight alpha, garment colour bled under the
# alpha so there is no fringe on the sand or the earth ground). Nothing is composited on black any more.
#
#   scripts/pictures/run.sh <source-photos-dir> <cache-dir> [<items-out-dir>] [<sheets-dir>]
#   e.g. scripts/pictures/run.sh ~/media-src/img ~/pic-cache            (out defaults to <repo>/public/media/items)
#
# The same paths can be given as environment instead (PIC_SRC, PIC_CACHE, PIC_OUT, PIC_SOURCES, PIC_MEDIA: see paths.py);
# no script holds an absolute path any more. Useful switches:
#   PIC_KEEP=1          only re-cut the views whose files already exist in the out dir (keeps a curated set curated)
#   PIC_RAW=<dir>       also keep the cut-out before the edge clean-up; `edges.py all` then redoes only edges + encoding
#   PIC_EDGE_T0=0.10    how much the soft outline is tightened;  PIC_Q=84  colour quality (the alpha is always lossless)
# One item or view:  PIC_SRC=… PIC_CACHE=… python3 process.py tz01,ls04 [front|back|side]
# Proof sheets on both stage colours (#DACBB1 / #3B2C20):  python3 sheet.py --grounds <dir>
# The 3D stills (3d-*.webp) are not made here: node cloth-lab/render-items.mjs (transparent too).
# The jewellery details (ne01, br01) are ordinary opaque photographs and stay that way.
#
# Needs the ONNX models in ~/.u2net (u2net_cloth_seg, isnet-general-use from
# https://github.com/danielgatis/rembg/releases/download/v0.0.0/<model>.onnx) unless the masks are already in the cache.
# ~1.2 GB RAM per parser process (ORT arena disabled); on 2 cores: parsing ~15 min, compositing ~10 min.
set -e
[ -n "$1" ] && export PIC_SRC="$1"
[ -n "$2" ] && export PIC_CACHE="$2"
[ -n "$3" ] && export PIC_OUT="$3"
SHEETS="${4:-${PIC_SHEETS:-$(mktemp -d)}}"
cd "$(dirname "$0")"
python3 parse_all.py 0 2 & python3 parse_all.py 1 2 & wait
PIC_MODEL=isnet python3 parse_all.py 0 2 & PIC_MODEL=isnet python3 parse_all.py 1 2 & wait
python3 process.py all -j 2
python3 jewellery.py
python3 quality.py
python3 sheet.py --grounds "$SHEETS"
# then, to publish only the reviewed views: python3 curate.py   (reads curation.json, deletes the other views)
