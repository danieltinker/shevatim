// Test lab entry: mounts the engine from query parameters and exposes it for the Playwright script.
import { mountTzitzit } from "../components/cloth/engine";
import type { ClothSpec } from "../lib/types";

const q = new URLSearchParams(location.search);
const spec: ClothSpec = {
  shape: (q.get("shape") as ClothSpec["shape"]) || "hooded-poncho",
  texture: q.get("texture") || null,
  baseColor: q.get("base") || "#efe6d2",
  trim: (q.get("trim") as ClothSpec["trim"]) || "tassels",
  trimColor: q.get("trimColor") || "#efe6d2",
  stringColor: q.get("string") || "#f5f2ea",
  techelet: q.get("techelet") !== "0",
};
if (q.get("spec")) Object.assign(spec, JSON.parse(q.get("spec")!));
const el = document.getElementById("stage")!;
const live = q.get("live") === "1";
try {
  const handle = mountTzitzit(el, {
    spec, size: q.get("size") === "kid" ? "kid" : "adult",
    quality: (q.get("quality") as "low" | "high") || "high",
    paused: !live, settleSync: !live,
    onReady: () => { (window as unknown as { ready: boolean }).ready = true; },
  });
  (window as unknown as { handle: unknown }).handle = handle;
} catch (e) {
  (window as unknown as { error: string }).error = String(e);
  document.body.append(String(e));
}
