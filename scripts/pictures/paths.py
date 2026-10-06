"""Where the picture pipeline reads and writes. Everything comes from the environment (run.sh sets it from its
arguments); the defaults are the folders of this repository plus ./media-src and ./pic-cache beside it.
  PIC_SRC      folder with the source photographs (IMG_xxxx.jpg web-size exports)
  PIC_MEDIA    folder with the source videos (only jewellery.py: <PIC_MEDIA>/c_jewelry.mp4); default: PIC_SRC/../seg
  PIC_CACHE    folder for the segmentation masks (<source>_isnet.png, <source>_cloth.png) and the per-view meta json
  PIC_OUT      folder with the item folders (default <repo>/public/media/items)
  PIC_SOURCES  picture-sources.json (default <repo>/db/picture-sources.json)
"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '../..'))
SRC = os.environ.get('PIC_SRC') or os.path.join(os.path.dirname(REPO), 'media-src/img')
MEDIA = os.environ.get('PIC_MEDIA') or os.path.join(os.path.dirname(os.path.normpath(SRC)), 'seg')
CACHE = os.environ.get('PIC_CACHE') or os.path.join(os.path.dirname(REPO), 'pic-cache')
OUT = os.environ.get('PIC_OUT') or os.path.join(REPO, 'public/media/items')
SOURCES_JSON = os.environ.get('PIC_SOURCES') or os.path.join(REPO, 'db/picture-sources.json')
DB = os.path.dirname(SOURCES_JSON)
