// Procedural textures: weave normal map, fallback fabric, neck cut-out mask, trims, cords, sequins.
import { CanvasTexture, RepeatWrapping, MirroredRepeatWrapping, SRGBColorSpace, NoColorSpace, LinearMipmapLinearFilter, LinearFilter, ClampToEdgeWrapping } from "three";
import type { Texture } from "three";
import type { NeckShape } from "./garment";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
}
function rng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Tileable normal map of a ribbed plain weave. One tile = 16 mm of cloth: four warp ribs, 1 mm weft threads. */
export function weaveNormal(aniso: number): Texture {
  const N = 128;
  const [c, g] = canvas(N, N);
  const h = new Float32Array(N * N);
  const r = rng(11);
  const jitter = Array.from({ length: 16 }, () => 0.75 + r() * 0.5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const rib = Math.pow(Math.abs(Math.sin((x / N) * Math.PI * 4)), 0.7);          // 4 ribs across
    const fine = 0.5 + 0.5 * Math.sin((x / N) * Math.PI * 32);                      // warp threads
    const weft = 0.5 + 0.5 * Math.sin((y / N) * Math.PI * 32 + (Math.floor((x / N) * 16) % 2) * Math.PI); // over/under
    h[y * N + x] = rib * 0.9 + fine * 0.25 * jitter[Math.floor((x / N) * 16)] + weft * 0.35 + r() * 0.12;
  }
  const img = g.createImageData(N, N);
  const s = 2.2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)]) * s;
    const dy = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * s;
    const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const o = (y * N + x) * 4;
    img.data[o] = (-dx * l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy * l * 0.5 + 0.5) * 255; img.data[o + 2] = (l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.anisotropy = aniso;
  return t;
}

/** Soft uneven yarn: used as the colour map when the item has no fabric picture. White-based; tinted by material colour. */
export function plainFabric(aniso: number): Texture {
  const N = 512;
  const [c, g] = canvas(N, N);
  g.fillStyle = "#f7f7f7"; g.fillRect(0, 0, N, N);
  const r = rng(5);
  for (let x = 0; x < N; x += 2) { // warp streaks of slightly different yarn
    const v = 226 + Math.floor(r() * 29);
    g.fillStyle = `rgba(${v},${v},${v},0.55)`; g.fillRect(x, 0, 1 + Math.floor(r() * 3), N);
  }
  for (let k = 0; k < 900; k++) { // slubs
    const v = r() < 0.5 ? 255 : 190;
    g.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.12})`;
    g.fillRect(r() * N, r() * N, 1 + r() * 2, 6 + r() * 40);
  }
  for (let k = 0; k < 40; k++) { // broad mottling
    const x = r() * N, y = r() * N, rad = 40 + r() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = r() < 0.5 ? 255 : 150;
    gr.addColorStop(0, `rgba(${v},${v},${v},0.07)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = MirroredRepeatWrapping;
  t.colorSpace = SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

/** Alpha mask over the whole body sheet (uv1): white cloth, black neck opening. */
export function neckMask(width: number, halfLen: number, neck: NeckShape): Texture {
  const W = 512, H = Math.round((512 * 2 * halfLen) / width);
  const [c, g] = canvas(W, H);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const X = (x: number): number => (x / width + 0.5) * W, Y = (t: number): number => (t / (2 * halfLen) + 0.5) * H;
  g.fillStyle = "#000";
  g.beginPath();
  if (neck.round) g.ellipse(X(0), Y(0), (neck.halfW / width) * W, (neck.front / (2 * halfLen)) * H, 0, Math.PI, 2 * Math.PI);
  else { g.moveTo(X(-neck.halfW), Y(0)); g.quadraticCurveTo(X(-neck.halfW * 0.5), Y(-neck.front * 0.6), X(0), Y(-neck.front)); g.quadraticCurveTo(X(neck.halfW * 0.5), Y(-neck.front * 0.6), X(neck.halfW), Y(0)); }
  g.ellipse(X(0), Y(0), (neck.halfW / width) * W, (neck.back / (2 * halfLen)) * H, 0, 0, Math.PI);
  g.closePath(); g.fill();
  const t = new CanvasTexture(c);
  t.flipY = false; t.channel = 1; t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.generateMipmaps = false; t.minFilter = LinearFilter;
  return t;
}

/** Trim atlas with alpha. Left half: one tassel. Right half: one tile of cut fringe or lace. White; tinted by material colour. */
export function trimAtlas(kind: "fringe" | "tassels" | "lace"): Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(3);
  // tassel (0..128)
  g.strokeStyle = "#fff"; g.lineCap = "round";
  g.lineWidth = 7; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 60); g.stroke();
  g.fillStyle = "#f4f4f4"; g.beginPath(); g.ellipse(64, 74, 22, 20, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#b9b9b9"; g.fillRect(42, 90, 44, 9);
  for (let k = 0; k < 26; k++) {
    const x0 = 44 + (k / 25) * 40, x1 = 64 + (x0 - 64) * (1.9 + r() * 0.5);
    const v = 190 + Math.floor(r() * 65);
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 3 + r() * 2.5;
    g.beginPath(); g.moveTo(x0, 96); g.quadraticCurveTo(x0, 170, x1, 226 + r() * 26); g.stroke();
  }
  // strip tile (128..256)
  if (kind === "lace") {
    g.strokeStyle = "#fff"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(128, 6); g.lineTo(256, 6); g.stroke();
    for (let k = 0; k < 2; k++) {
      const cx = 160 + k * 64;
      g.lineWidth = 5; g.beginPath(); g.arc(cx, 20, 30, 0, Math.PI); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(cx, 20, 17, 0, Math.PI); g.stroke();
      g.beginPath(); g.arc(cx, 60, 8, 0, Math.PI * 2); g.stroke();
      for (let a = 0.2; a < 3; a += 0.45) { g.beginPath(); g.moveTo(cx + Math.cos(a) * 17, 20 + Math.sin(a) * 17); g.lineTo(cx + Math.cos(a) * 30, 20 + Math.sin(a) * 30); g.stroke(); }
    }
    g.lineWidth = 4; g.beginPath(); g.arc(128, 20, 30, 0, Math.PI / 2); g.stroke(); g.beginPath(); g.arc(256, 20, 30, Math.PI / 2, Math.PI); g.stroke();
  } else {
    for (let k = 0; k < 12; k++) {
      const x0 = 133 + k * 10.4 + r() * 3, x1 = x0 + (r() - 0.5) * 16;
      const v = 185 + Math.floor(r() * 70);
      g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 3.5 + r() * 2.5;
      g.beginPath(); g.moveTo(x0, 0); g.quadraticCurveTo(x0 + (r() - 0.5) * 6, 120, x1, 170 + r() * 80); g.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.anisotropy = 4;
  return t;
}

/** Cord atlas. u 0..0.5: the wound/knotted third (v along the cord, top = 0). u 0.5..1: a loose twisted thread (white, tinted). */
export function cordAtlas(stringColor: string, techelet: boolean): Texture {
  const W = 64, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const blue = "#2F5FA8";
  // windings: thin slanted turns, in groups (7-8-11-13 in tradition; here four sections between five knots)
  const knots = [0.0, 0.2, 0.42, 0.68, 0.96];
  for (let y = 0; y < H; y += 5) {
    const f = y / H;
    let sec = 0; for (let k = 0; k < knots.length; k++) if (f >= knots[k]) sec = k;
    const turn = Math.floor(y / 5);
    const isBlue = techelet && (sec % 2 === 0 ? turn % 4 !== 3 : turn % 4 === 0 || turn % 4 === 1);
    g.fillStyle = isBlue ? blue : stringColor;
    g.beginPath(); g.moveTo(0, y + 3); g.lineTo(32, y - 2); g.lineTo(32, y + 3); g.lineTo(0, y + 8); g.closePath(); g.fill();
    g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, y + 4, 32, 1);
  }
  for (const k of knots) { // double knots: plain string colour, with a crease
    const y = k * H;
    g.fillStyle = stringColor; g.fillRect(0, y, 32, 20);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, y + 9, 32, 2); g.fillRect(0, y, 32, 1); g.fillRect(0, y + 19, 32, 1);
  }
  // loose thread: two-ply twist
  g.fillStyle = "#fff"; g.fillRect(32, 0, 32, H);
  g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 2;
  for (let y = -32; y < H + 32; y += 12) { g.beginPath(); g.moveTo(32, y + 18); g.lineTo(64, y); g.stroke(); }
  // round shading across both halves
  for (const x0 of [0, 32]) {
    const gr = g.createLinearGradient(x0, 0, x0 + 32, 0);
    gr.addColorStop(0, "rgba(0,0,0,0.5)"); gr.addColorStop(0.3, "rgba(0,0,0,0)"); gr.addColorStop(0.65, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = gr; g.fillRect(x0, 0, 32, H);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = ClampToEdgeWrapping; t.wrapT = RepeatWrapping; t.anisotropy = 4;
  return t;
}

/** Sequin band: colour map (gold discs on gold thread) — also used as a bump map for the glints. */
export function sequins(): Texture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = "#a08650"; g.fillRect(0, 0, 256, 64);
  const r = rng(9);
  for (let y = 0; y < 64; y += 3) { g.fillStyle = `rgba(255,220,140,${0.08 + r() * 0.15})`; g.fillRect(0, y, 256, 1); }
  for (let row = 0; row < 3; row++) for (let k = 0; k < 13; k++) {
    const x = k * 20 + (row % 2) * 10 + 6, y = 11 + row * 21;
    const v = r();
    const gr = g.createRadialGradient(x - 2, y - 2, 1, x, y, 9);
    gr.addColorStop(0, v > 0.62 ? "#ffffff" : "#f4e3b4"); gr.addColorStop(0.25, v > 0.62 ? "#fff6d6" : "#ead29a"); gr.addColorStop(0.7, v > 0.35 ? "#dcc07e" : "#bfa262"); gr.addColorStop(1, "#8a7340");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 8.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#4a3410"; g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.anisotropy = 4;
  return t;
}
