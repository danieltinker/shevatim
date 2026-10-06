#!/bin/sh
# Full re-run of the item pictures. Needs the ONNX models in ~/.u2net (u2net_cloth_seg, isnet-general-use from
# https://github.com/danielgatis/rembg/releases/download/v0.0.0/<model>.onnx) and the source media in /home/claude/media-src.
# ~1.2 GB RAM per parser process (ORT arena disabled); on 2 cores: parsing ~15 min, compositing ~5 min.
cd "$(dirname "$0")"
python3 parse_all.py 0 2 & python3 parse_all.py 1 2 & wait
PIC_MODEL=isnet python3 parse_all.py 0 2 & PIC_MODEL=isnet python3 parse_all.py 1 2 & wait
python3 process.py all -j 2
python3 jewellery.py
python3 quality.py
python3 sheet.py --all /home/claude/shots-pictures
