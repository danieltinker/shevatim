# Contact sheet of the rendered stills: python3 cloth-lab/contact-sheet.py [view] [out.jpg]
import sys, os, json
from PIL import Image, ImageDraw
here = os.path.dirname(os.path.abspath(__file__)); shop = os.path.dirname(here)
view = sys.argv[1] if len(sys.argv) > 1 else "front"
out = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/shots-cloth/items-%s.jpg" % view
codes = [i["code"] for i in json.load(open(os.path.join(shop, "db/seed.json")))["items"] if i.get("cloth")]
W, H = 240, 320
sheet = Image.new("RGB", (8 * W, ((len(codes) + 7) // 8) * (H + 18)), (0, 0, 0)); d = ImageDraw.Draw(sheet)
for k, code in enumerate(codes):
    p = os.path.join(shop, "public/media/items", code, "3d-%s-480.webp" % view)
    x, y = (k % 8) * W, (k // 8) * (H + 18)
    if os.path.exists(p): sheet.paste(Image.open(p).convert("RGB").resize((W, H)), (x, y + 18))
    d.text((x + 4, y + 3), code, fill=(255, 255, 0))
sheet.save(out, quality=88); print(out)
