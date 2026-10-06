#!/usr/bin/env python3
"""Builds db/seed.json (what the database is seeded with) and content/catalog.snapshot.json (the storefront's
first-paint copy of the catalogue) from the item table below. Names are working names: the owner renames
items in the back office. Prices are deliberately empty: nobody gave us prices."""
import json, os, re, datetime
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
NOW="2026-10-06T00:00:00Z"
def L(he,en,fr): return {"he":he,"en":en,"fr":fr}
CATS=[("tzitziyot",L("ציציות","Tzitziyot","Tsitsiyot")),("shirts",L("חולצות","Shirts","Hauts")),("pants",L("מכנסיים","Pants","Pantalons")),
      ("necklaces",L("שרשראות","Necklaces","Colliers")),("bracelets",L("צמידים","Bracelets","Bracelets")),("kippot",L("כיפות","Kippot","Kippot"))]
V_TZ=[{"key":"adult","label":L("מבוגר · מידה אחת","Adult · one size","Adulte · taille unique"),"price":None,"available":True},
      {"key":"kid","label":L("ילד · מידה אחת","Kid · one size","Enfant · taille unique"),"price":None,"available":True}]
V_SZ=[{"key":k,"label":L(k.upper(),k.upper(),k.upper()),"price":None,"available":True} for k in ("s","m","l","xl")]
D_TZ_H=L("ציצית בגזרת פונצ'ו עם קפוצ'ון וארבע כנפות.","A poncho-cut tzitzit with a hood and four corners.","Un tsitsit coupe poncho, avec capuche et quatre coins.")
D_TZ=L("ציצית בגזרת פונצ'ו עם ארבע כנפות.","A poncho-cut tzitzit with four corners.","Un tsitsit coupe poncho à quatre coins.")
D_LS=L("חולצה ארוכה עם הדפס קליגרפי על הגב ולאורך השרוולים.","Long-sleeve shirt with a calligraphy print on the back and down the sleeves.","Haut à manches longues, calligraphie imprimée au dos et le long des manches.")
D_TE=L("חולצת רשת רחבה עם ארבע כנפות וציציות.","A loose mesh tee with four corners and tzitzit.","Un t-shirt ample en maille, à quatre coins avec tsitsit.")
D_PA=L("מכנסיים עם לוגו שבטים מאחור.","Pants with the Shevatim mark on the back.","Pantalon avec le logo Shevatim au dos.")
E=L("","","")
def tz(n,he,en,fr,front,back=(),side=(),detail=(),hood=True,shape=None,base="#EFE8D8",trim="none",trimc="#EFE8D8"):
    return dict(code=f"tz{n:02d}",cat="tzitziyot",name=L(he,en,fr),desc=D_TZ_H if hood else D_TZ,variants=V_TZ,views=dict(front=front,back=back,side=side,detail=detail),order=["front","back","side","detail"],
                cloth=dict(shape=shape or ("hooded-poncho" if hood else "poncho"),texture=f"/media/items/tz{n:02d}/fabric-1024.webp",baseColor=base,trim=trim,trimColor=trimc,stringColor="#F2EEE4",techelet=True))
ITEMS=[
 tz(1,"ציצית לבנה עם פרנזים","White Fringe Tzitzit","Tsitsit blanc à franges",[6082,6091,6092,6086,6087],[6083,6084,6088],[6085,6089,6090],base="#F4F2EC",trim="fringe",trimc="#F4F2EC"),
 tz(2,"ציצית דקלים","Palm Tzitzit","Tsitsit palmiers",[6096,6097],[6094],[6095],base="#E9E2CC"),
 tz(3,"ציצית פסי שמיים","Sky Stripe Tzitzit","Tsitsit rayé ciel",[6100,6101,6102],[6098],[6099],base="#E6EEF0"),
 tz(4,"ציצית פסי אדמה","Earth Stripe Tzitzit","Tsitsit rayé terre",[6107],[6103,6104,6105],[6106],base="#E7E0D2"),
 tz(5,"ציצית פסי תכלת","Blue Stripe Tzitzit","Tsitsit rayé bleu",[6110,6111],[6108],[6109],base="#EEF2F2"),
 tz(6,"ציצית פסי חמרה","Clay Stripe Tzitzit","Tsitsit rayé argile",[6115,6116],[6112,6113],[6114],base="#EDE3D6"),
 tz(7,"ציצית קלאסית שמנת","Classic Cream Tzitzit","Tsitsit classique crème",[6119],[6117],[6118],hood=False,shape="classic",base="#EDE6CF"),
 tz(8,"ציצית עיטור שחור","Black Ornament Tzitzit","Tsitsit à ornements noirs",[6122,6123],[6120],[6121],base="#EFEDE6"),
 tz(9,"ציצית שמנת עם פרנזי זהב","Cream and Gold Fringe Tzitzit","Tsitsit crème à franges dorées",[6126,6127,6128],[6124],[6125],base="#EFE8D6",trim="gold-fringe",trimc="#B79A5B"),
 tz(10,"ציצית עיטור טורקיז","Turquoise Ornament Tzitzit","Tsitsit à ornements turquoise",[6131,6132,6133],[6129],[6130],base="#EEF0EA"),
 tz(11,"ציצית פסי זית","Olive Stripe Tzitzit","Tsitsit rayé olive",[6137,6138,6139],[6134,6135],[6136],base="#4B4F36"),
 tz(12,"ציצית מנטה","Mint Tzitzit","Tsitsit menthe",[6142,6143],[6140],[6141],base="#A9D6CC"),
 tz(13,"ציצית פשתן לבנה","White Linen Tzitzit","Tsitsit en lin blanc",[6191],[6190,6192],hood=False,base="#F1EFE8"),
 tz(14,"ציצית קצרה עם פרנזי יוטה","Cropped Jute Fringe Tzitzit","Tsitsit court à franges de jute",[6193],[6194],hood=False,shape="cropped",base="#E9DFC6",trim="fringe",trimc="#C2A46A"),
 tz(15,"ציצית עיטור שחור, גזרה פתוחה","Black Ornament Tzitzit, Open Cut","Tsitsit à ornements noirs, coupe ouverte",[6209],[6208],hood=False,base="#EFEDE6"),
 tz(16,"ציצית חאקי עם כיסים","Khaki Pocket Tzitzit","Tsitsit kaki à poches",[6212],[6210],[6211],hood=False,base="#8C8466",trim="fringe",trimc="#D9C9A0"),
 tz(17,"ציצית קצרה פסי שמנת","Cropped Cream Stripe Tzitzit","Tsitsit court rayé crème",[6216],[6217],hood=False,shape="cropped",base="#EDE6D2"),
 tz(18,"ציצית קצרה חאקי עם תחרה","Cropped Khaki Lace Tzitzit","Tsitsit court kaki à dentelle",[6226,6225],[6227],[6228],shape="cropped",base="#8A8468",trim="lace",trimc="#F1ECE0"),
 tz(19,"ציצית קצרה שמנת","Cropped Cream Tzitzit","Tsitsit court crème",[6230],[6229],hood=False,shape="cropped",base="#ECE4CC"),
 tz(20,"ציצית שמנת עם פאייטים וגדילים","Gold Sequin Tassel Tzitzit","Tsitsit à sequins dorés et pompons",[6231],[6232],[6233],base="#EDE5D0",trim="tassels",trimc="#EDE5D0"),
 tz(21,"ציצית חאקי ושמנת עם פרנזים","Khaki and Cream Fringe Tzitzit","Tsitsit kaki et crème à franges",[6234],[6235],hood=False,base="#D9CDAA",trim="fringe",trimc="#EDE5D0"),
 tz(22,"ציצית שנהב","Ivory Tzitzit","Tsitsit ivoire",[6236,6237],[6239],[6238],base="#EAE4D0"),
 tz(23,"ציצית קצרה משובצת","Cropped Check Tzitzit","Tsitsit court à carreaux",[6240],[6241],hood=False,shape="cropped",base="#F0EEE8"),
 tz(24,"ציצית משובצת","Check Tzitzit","Tsitsit à carreaux",[6271,6273],[6274],[6272],base="#F0EEE8"),
 tz(25,"ציצית רשת שחורה","Black Mesh Tzitzit","Tsitsit en maille noire",[6275],[6276],hood=False,shape="classic",base="#1E1F24"),
 tz(26,"ציצית ארץ ישראל","Land of Israel Tzitzit","Tsitsit Terre d’Israël",[6279],[6278],[6277],[6280],base="#DCE6EE",trim="fringe",trimc="#DCE6EE"),
 tz(27,"ציצית זיגזג שחור־לבן","Black and White Zigzag Tzitzit","Tsitsit zigzag noir et blanc",[6285,6281],[6287],[6283,6286,6282],hood=False,base="#EDEBE4",trim="fringe",trimc="#F1EFE8"),
 tz(28,"ציצית זית עם תחרה וכיסים","Olive Lace Pocket Tzitzit","Tsitsit olive à dentelle et poches",[7328,7434,7432,7433],[7326,7437,7438,7439],[7327],base="#6F6B55",trim="lace",trimc="#F1ECE0"),
 tz(29,"ציצית קצרה עם גדילים","Cropped Tassel Tzitzit","Tsitsit court à pompons",[7341],[7342],shape="cropped",base="#EFE8D6",trim="tassels",trimc="#EFE8D6"),
 tz(30,"ציצית פסים שחור־לבן","Black and White Stripe Tzitzit","Tsitsit rayé noir et blanc",["8445_2","8444_2","8446_2",7346],["8448_2",7343],["8447_2",7344,7345],base="#EDEBE4"),
 tz(31,"ציצית שמנת עם גדילי זהב","Cream Tzitzit with Gold Tassels","Tsitsit crème à pompons dorés",["8449_2","8452_2"],["8451_2","8454_2"],["8450_2","8453_2"],base="#EDE5D0",trim="tassels",trimc="#EDE5D0"),
 tz(32,"ציצית פסי שמנת עם גדילים","Cream Stripe Tassel Tzitzit","Tsitsit rayé crème à pompons",["8455_2"],["8457_2"],["8456_2"],base="#EBE4CF",trim="tassels",trimc="#EBE4CF"),
]
LS=[("שחור · כסף","Black / Silver","noir / argent",dict(back=[6174],side=[6175],front=[6176])),("לבן · אדום","White / Red","blanc / rouge",dict(back=[6177],side=[6178],front=[6179])),
 ("אקווה · אדום","Aqua / Red","aqua / rouge",dict(back=[6180],side=[6181],front=[6182])),("מרווה · שחור","Sage / Black","sauge / noir",dict(back=[6183],side=[6184],front=[6185])),
 ("לבן · שחור","White / Black","blanc / noir",dict(back=[6186],side=[6187],front=[6188])),("אלמוג · שחור","Coral / Black","corail / noir",dict(back=[6195],side=[6196],front=[6197])),
 ("אבן · לבן","Stone / White","pierre / blanc",dict(back=[6222],side=[6223],front=[6224])),("שמיים · לבן","Sky / White","ciel / blanc",dict(back=[6244,"8439_2"],side=[6243],front=[6242,"8438_2","8440_2"])),
 ("מוקה · שחור","Mocha / Black","moka / noir",dict(back=[6252],side=[6251,6250],front=[6249,6248])),("שחור · ורוד","Black / Pink","noir / rose",dict(back=[6256],side=[6255],front=[6254,6253])),
 ("אבן · חום","Stone / Brown","pierre / brun",dict(back=[6259],side=[6258],front=[6257])),("פחם · זהב","Charcoal / Gold","anthracite / or",dict(back=[6262],side=[6261],front=[6260])),
 ("לבן · כחול","White / Blue","blanc / bleu",dict(back=[6265],side=[6264],front=[6263])),("אפור · שחור","Grey / Black","gris / noir",dict(back=[6270],side=[6267],front=[6268])),
 ("אפור · לבן","Grey / White","gris / blanc",dict(back=[6289,6288],front=["8437_2"])),("שחור · חול","Black / Sand","noir / sable",dict(back=[7337],side=[7338],front=[7339])),
 ("שחור · צהוב","Black / Yellow","noir / jaune",dict(back=[7348,7347],side=[7349],front=[7350])),("ורוד שטוף · שחור","Washed Pink / Black","rose délavé / noir",dict(back=["8443_2"],side=["8442_2"],front=["8441_2"]))]
for i,(he,en,fr,v) in enumerate(LS,1):
    ITEMS.append(dict(code=f"ls{i:02d}",cat="shirts",name=L(f"חולצת ״זה מעשה שלי״ · {he}",f"“My Story” Long Sleeve · {en}",f"Manches longues « Mon histoire » · {fr}"),desc=D_LS,variants=V_SZ,views=v,order=["back","front","side"],cloth=None))
TE=[("טאופ","Taupe","taupe",dict(front=[6206,6207])),("שמנת","Cream","crème",dict(back=[6213],side=[6214],front=[6215])),("שמיים","Sky","ciel",dict(back=[7320],side=[7321],front=[7322])),
 ("לבן","White","blanc",dict(side=[7324],front=[7325])),("חול","Sand","sable",dict(back=[7329],side=[7330],front=[7332,7331])),("שחור","Black","noir",dict(back=[7334,7333],side=[7335],front=[7336]))]
for i,(he,en,fr,v) in enumerate(TE,1):
    ITEMS.append(dict(code=f"te{i:02d}",cat="tzitziyot",name=L(f"טי ציצית רשת · {he}",f"Mesh Tzitzit Tee · {en}",f"T-shirt tsitsit en maille · {fr}"),desc=D_TE,variants=V_TZ,views=v,order=["front","back","side"],cloth=None))
ITEMS.append(dict(code="te07",cat="shirts",name=L("טי מנורה","Menorah Tee","T-shirt Ménorah"),desc=L("טי עם טלאי מנורה רקום בכתב יד על הגב.","A tee with a hand-lettered menorah patch on the back.","Un t-shirt avec un écusson ménorah calligraphié au dos."),variants=V_SZ,views=dict(back=[7813,7814]),order=["back"],cloth=None))
ITEMS.append(dict(code="pa01",cat="pants",name=L("מכנסי שבטים · זית","Shevatim Pants · Olive","Pantalon Shevatim · olive"),desc=D_PA,variants=V_SZ,views=dict(front=[6200],back=[6198],side=[6199]),order=["front","back","side"],cloth=None))
ITEMS.append(dict(code="pa02",cat="pants",name=L("מכנסי שבטים · לבן","Shevatim Pants · White","Pantalon Shevatim · blanc"),desc=D_PA,variants=V_SZ,views=dict(front=[6204],back=[6202,6201,6205],side=[6203]),order=["front","back","side"],cloth=None))
ITEMS.append(dict(code="ne01",cat="necklaces",name=L("שרשרת צדפים","Shell Necklace","Collier de coquillages"),desc=L("שרשרת חרוזים וצדפים עם תליון קונכייה.","A bead and shell necklace with a conch pendant.","Un collier de perles et de coquillages, avec un pendentif conque."),variants=[],views=dict(detail=[6526,6525,6527,6528]),order=["detail"],cloth=None))
ITEMS.append(dict(code="br01",cat="bracelets",name=L("צמיד צדפים","Shell Bracelet","Bracelet de coquillages"),desc=L("צמיד חרוזים וצדפים.","A bead and shell bracelet.","Un bracelet de perles et de coquillages."),variants=[],views=dict(detail=["clip:c_jewelry"]),order=["detail"],cloth=None))
TRIBES=dict(reuven=["ls02","ls06","tz06","ls10","ls03"],shimon=["tz11","tz28","tz16","tz18","ls04"],levi=["tz01","tz13","tz24","tz23","te04"],yehuda=["tz10","tz12","ls08","te03","tz05"],
 dan=["tz26","tz03","ls13","ls14","tz22"],naftali=["ls18","tz04","tz32","te01","ls11"],gad=["tz30","tz08","tz27","tz15","ls05"],asher=["tz20","tz09","tz31","tz29","te05"],
 yissachar=["ls01","ls16","te06","tz25","ls12"],zevulun=["tz07","ne01","br01","te02","pa02"],yosef=["tz02","ls17","ls09","pa01","tz21"],binyamin=["tz14","tz17","tz19","ls07","ls15"])
home={c:t for t,cs in TRIBES.items() for c in cs}
def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower().replace('“','').replace('”','').replace('·','')).strip('-')
items=[]; sources={}
def _load(name):
    f=os.path.join(ROOT,"db",name)
    return json.load(open(f)) if os.path.exists(f) else {}
CLOTH_OVR=_load("cloth-overrides.json")      # written by the 3D work: per-item corrections of the cloth spec
PICS_FINAL=_load("pictures-final.json")      # written by the picture work: the real photographs that may be published
MEDIA=os.path.join(ROOT,"public","media","items")
for i,it in enumerate(ITEMS):
    pics=[]; src={}
    for view in it["order"]:
        files=it["views"].get(view) or []
        if not files: continue
        src[view]=[(f if str(f).startswith('clip:') else f"IMG_{f}.jpg") for f in files]
    sources[it["code"]]=src
    code=it["code"]
    if it["cloth"] is not None:
        if code in CLOTH_OVR: it["cloth"]=CLOTH_OVR[code]
        for name,view in (("3d-front","front"),("3d-back","back"),("3d-threeq","side")):
            if os.path.exists(os.path.join(MEDIA,code,f"{name}-1600.webp")):
                pics.append(dict(base=f"/media/items/{code}/{name}",sizes=[480,960,1600],ext="webp",w=1200,h=1600,kind="render",view=view))
    for p in PICS_FINAL.get(code,[]):
        if os.path.exists(os.path.join(MEDIA,code,os.path.basename(p["base"])+"-1600.webp")):
            pics.append(dict(base=p["base"],sizes=p.get("sizes",[480,960,1600]),ext=p.get("ext","webp"),w=p.get("w",1200),h=p.get("h",1600),kind=p.get("kind","product"),view=p.get("view")))
    items.append(dict(id=it["code"],code=it["code"],slug=slug(it["name"]["en"])+"-"+it["code"],category=it["cat"],name=it["name"],description=it["desc"],price=None,variants=it["variants"],pictures=pics,
        tribe=home.get(it["code"]),status="published",soldOut=False,cloth=it["cloth"],sort=i*10,updatedAt=NOW))
cats=[dict(key=k,name=n,sort=i*10,visible=True) for i,(k,n) in enumerate(CATS)]
coll=dict(id="midbar",slug="midbar",name=L("מדבר","Midbar","Midbar"),description=L("הקולקציה הראשונה של שבטים נולדה במדבר יהודה: שנים־עשר שבטים, לכל שבט חמישה פריטים.","The first Shevatim collection was born in the Judean desert: twelve tribes, five pieces for each.","La première collection Shevatim est née dans le désert de Judée : douze tribus, cinq pièces pour chacune."),
          status="published",isCurrent=True,cover=None,slots=TRIBES,sort=0)
settings=dict(whatsapp="",email="",instagram="",calLink="",announcement=L("ההרשמה לקולקציית מדבר פתוחה","Reservations for the Midbar collection are open","Les réservations pour la collection Midbar sont ouvertes"),
              reservationsOpen=True,slotsPerTribe=5,heroLine=L("שנים־עשר שבטים. חוט אחד.","Twelve tribes. One thread.","Douze tribus. Un seul fil."))
catalog=dict(version="seed-1",categories=cats,items=items,collections=[coll],settings=settings)
os.makedirs(os.path.join(ROOT,"db"),exist_ok=True)
json.dump(catalog,open(os.path.join(ROOT,"db","seed.json"),"w"),ensure_ascii=False,indent=1)
json.dump(catalog,open(os.path.join(ROOT,"content","catalog.snapshot.json"),"w"),ensure_ascii=False)
json.dump(sources,open(os.path.join(ROOT,"db","picture-sources.json"),"w"),ensure_ascii=False,indent=1)
print(len(items),"items",sum(len(i["pictures"]) for i in items),"pictures"); 
missing=[f for s in sources.values() for fs in s.values() for f in fs if not f.startswith('clip:') and not os.path.exists('/home/claude/media-src/img/'+f)]
print("missing sources:",missing)
