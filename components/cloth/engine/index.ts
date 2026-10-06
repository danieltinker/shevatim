// Playable 3D tzitzit: mounts a WebGL canvas, simulates the garment with XPBD and draws it.
// Framework-free; the only dependency is three.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, DirectionalLight, HemisphereLight, Mesh, BufferGeometry, BufferAttribute,
  MeshPhysicalMaterial, MeshStandardMaterial, DoubleSide, FrontSide, Color, Vector3, TextureLoader, ACESFilmicToneMapping,
  PCFShadowMap, MirroredRepeatWrapping, SRGBColorSpace, DynamicDrawUsage,
} from "three";
import type { Texture } from "three";
import type { ClothSpec } from "../../../lib/types";
import { buildGarment } from "./garment";
import type { Garment, Sheet } from "./garment";
import { KIND_DEAD, KIND_STRING } from "./sim";
import { weaveNormal, plainFabric, neckMask, trimAtlas, cordAtlas, sequins } from "./textures";

export type { ClothSpec };
export interface MountOptions {
  spec: ClothSpec;
  size?: "adult" | "kid";
  /** "auto" (default) picks low on small/slow devices and steps down if the first frames are slow. */
  quality?: "low" | "high" | "auto";
  paused?: boolean;
  /** false: no pointer interaction (a plain turntable-less still). Default true. */
  interactive?: boolean;
  /** Settle synchronously before returning (used by the lab). Default: settled over a few frames, then onReady. */
  settleSync?: boolean;
  /** Called once, after the first simulated frame has been drawn. */
  onReady?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  /** The visitor touched the cloth or turned the camera. */
  onInteract?: () => void;
}
export interface TzitzitHandle {
  setSpec(spec: ClothSpec): void;
  setPaused(paused: boolean): void;
  /** Ease the cloth back to its settled pose and the camera back to the front (what a double tap does). */
  reset(): void;
  dispose(): void;
  /** PNG data URL of the current frame. */
  snapshot(): string;
  readonly canvas: HTMLCanvasElement;
  readonly quality: "low" | "high";
  /** Deterministic controls for the test lab. */
  readonly lab: {
    step(frames: number): void;
    setView(azimuth: number, elevation: number, zoom?: number, targetY?: number, targetX?: number): void;
    corner(i: number): number;
    tip(i: number): number;
    grab(particle: number, dx: number, dy: number, dz: number): void;
    release(): void;
    reset(): void;
    view(): { azimuth: number; elevation: number; zoom: number; grabbed: number; paused: boolean; pending: boolean; homing: boolean };
    bounds(): { top: number; bottom: number; halfW: number } | null;
    /** true once the fabric picture is applied (or failed to load) */
    textureReady(): boolean;
    /** Absolute camera for product stills: same distance for every item. */
    frame(azimuth: number, elevation: number, distance: number, targetY: number): void;
    render(): void;
    stats(): { particles: number; constraints: number; body: number; hood: number; strings: number; solverMsPerFrame: number; substeps: number; kinetic: number; strainPasses: number };
    bench(frames: number): number;
    /** Pointer gestures in client pixels, without real events (deterministic with step()). */
    down(x: number, y: number): number;
    move(x: number, y: number): void;
    up(): void;
    /** true while the cloth is being eased back to its settled pose */
    homing(): boolean;
    /** Client position of a particle. */
    screen(particle: number): [number, number];
    named(): Record<string, number>;
    /** How far the cloth is from its settled pose, and how strained it is. */
    diag(): { mean: number; max: number; strain: number; nominal: number; nan: boolean; shiftX: number; hood: number };
  };
}

const FOV = 30;

/** Things ClothSpec cannot say yet ride on the texture URL fragment, e.g. "/media/items/tz18/fabric-1024.webp#hood,goldband".
 *  hood / nohood: hood independent of the shape. goldband: a sequin band above the hem with any trim.
 *  offset: for prints — the swatch runs unbroken across the chest (mirror seams move to the sides) instead of mirroring at the centre. */
export function specFlags(spec: ClothSpec): { hood?: boolean; goldBand: boolean; offset: boolean } {
  const frag = (spec.texture && spec.texture.includes("#") ? spec.texture.split("#")[1] : "").split(",");
  return { hood: frag.includes("hood") ? true : frag.includes("nohood") ? false : undefined, goldBand: frag.includes("goldband") || spec.trim === "gold-fringe", offset: frag.includes("offset") };
}
const BLUE = new Color("#2F5FA8");

class Batch {
  pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; idx: Uint32Array;
  nv = 0; ni = 0;
  geo = new BufferGeometry();
  constructor(maxVerts: number, maxTris: number) {
    this.pos = new Float32Array(maxVerts * 3); this.nrm = new Float32Array(maxVerts * 3);
    this.uv = new Float32Array(maxVerts * 2); this.col = new Float32Array(maxVerts * 3); this.idx = new Uint32Array(maxTris * 3);
    for (const [name, arr, size] of [["position", this.pos, 3], ["normal", this.nrm, 3], ["uv", this.uv, 2], ["color", this.col, 3]] as const) {
      const a = new BufferAttribute(arr, size); a.setUsage(DynamicDrawUsage); this.geo.setAttribute(name, a);
    }
    const ia = new BufferAttribute(this.idx, 1); ia.setUsage(DynamicDrawUsage); this.geo.setIndex(ia);
  }
  begin(): void { this.nv = 0; this.ni = 0; }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number): number {
    const i = this.nv++;
    if (i * 3 + 2 >= this.pos.length) { this.nv--; return 0; }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = nx; this.nrm[i * 3 + 1] = ny; this.nrm[i * 3 + 2] = nz;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    return i;
  }
  quad(a: number, b: number, c: number, d: number): void { // a-b top, c-d bottom
    if (this.ni + 6 > this.idx.length) return;
    const k = this.ni; this.idx[k] = a; this.idx[k + 1] = b; this.idx[k + 2] = c; this.idx[k + 3] = b; this.idx[k + 4] = d; this.idx[k + 5] = c; this.ni += 6;
  }
  end(): void {
    const g = this.geo;
    for (const n of ["position", "normal", "uv", "color"]) (g.getAttribute(n) as BufferAttribute).needsUpdate = true;
    g.index!.needsUpdate = true;
    g.setDrawRange(0, this.ni);
  }
}

function hash2(x: number, y: number): number { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function mountTzitzit(container: HTMLElement, opts: MountOptions): TzitzitHandle {
  if (typeof window === "undefined" || typeof document === "undefined") throw new Error("tzitzit: no DOM");
  const kid = opts.size === "kid";
  const cores = navigator.hardwareConcurrency || 8;
  const small = Math.min(window.innerWidth, window.innerHeight) < 480;
  let quality: "low" | "high" =
    opts.quality === "low" || opts.quality === "high" ? opts.quality
      : cores <= 4 || (small && cores <= 6) ? "low" : "high";
  const autoQuality = !opts.quality || opts.quality === "auto";

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;outline:none;cursor:grab;-webkit-tap-highlight-color:transparent;user-select:none";
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
  } catch (e) {
    throw new Error("tzitzit: webgl unavailable");
  }
  container.appendChild(canvas);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = quality === "high";
  renderer.shadowMap.type = PCFShadowMap;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 0.75, 0.2, 30);
  // studio lights turn with the camera, as if the garment were on a turntable under fixed lamps
  const rig = new Group();
  scene.add(rig);
  const key = new DirectionalLight(0xfff0dc, 2.9);
  key.position.set(-1.5, 3.1, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.camera.left = -0.95; key.shadow.camera.right = 0.95; key.shadow.camera.top = 1.05; key.shadow.camera.bottom = -1.05;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 8;
  key.shadow.bias = -0.0016; key.shadow.normalBias = 0.004; key.shadow.radius = 3;
  key.target.position.set(0, 1.1, 0);
  const fill = new DirectionalLight(0xdfe2f2, 0.6);
  fill.position.set(2.4, 1.2, 2.0); fill.target.position.set(0, 1.1, 0);
  const rim = new DirectionalLight(0xdfe8ff, 1.5);
  rim.position.set(1.4, 2.4, -2.8); rim.target.position.set(0, 1.1, 0);
  const hemi = new HemisphereLight(0xfff4e4, 0x6a5e50, 0.85);
  rig.add(key, key.target, fill, fill.target, rim, rim.target, hemi);

  const weaveTex = weaveNormal(aniso);
  const plainTex = plainFabric(aniso);
  const loader = new TextureLoader();
  loader.setCrossOrigin("anonymous");

  // ---- per-spec state ----
  let spec = opts.spec;
  let G!: Garment;
  let root = new Group();
  let disposables: { dispose(): void }[] = [];
  let bodyMesh!: Mesh; let hoodMesh: Mesh | null = null;
  let strings!: Batch; let trim: Batch | null = null; let gold: { geo: BufferGeometry; rows: number[][] } | null = null;
  let trimEdges: { sheet: Sheet; pts: Int32Array; inner: Int32Array; dir: Float32Array; tassel: boolean; strip: boolean }[] = [];
  let fabricReady = false;
  let buildId = 0;
  const strandOff: number[] = [];

  function sheetGeometry(sh: Sheet, uvOf: (i: number, j: number) => [number, number], colOf: (i: number, j: number) => number): BufferGeometry {
    const g = new BufferGeometry();
    const { ru, rv } = sh;
    const pa = new BufferAttribute(sh.rpos, 3); pa.setUsage(DynamicDrawUsage);
    const na = new BufferAttribute(sh.rnrm, 3); na.setUsage(DynamicDrawUsage);
    const uv = new Float32Array(ru * rv * 2), uv1 = new Float32Array(ru * rv * 2), col = new Float32Array(ru * rv * 3);
    for (let j = 0; j < rv; j++) for (let i = 0; i < ru; i++) {
      const k = j * ru + i;
      const [u, v] = uvOf(i, j);
      uv[k * 2] = u; uv[k * 2 + 1] = v;
      uv1[k * 2] = i / (ru - 1); uv1[k * 2 + 1] = j / (rv - 1);
      const c = colOf(i, j);
      col[k * 3] = c; col[k * 3 + 1] = c; col[k * 3 + 2] = c;
    }
    const idx = new Uint32Array((ru - 1) * (rv - 1) * 6);
    let n = 0;
    for (let j = 0; j < rv - 1; j++) for (let i = 0; i < ru - 1; i++) {
      const a = j * ru + i, b = a + 1, c = a + ru, d = c + 1;
      idx[n++] = a; idx[n++] = b; idx[n++] = c; idx[n++] = b; idx[n++] = d; idx[n++] = c;
    }
    g.setAttribute("position", pa); g.setAttribute("normal", na);
    g.setAttribute("uv", new BufferAttribute(uv, 2)); g.setAttribute("uv1", new BufferAttribute(uv1, 2));
    g.setAttribute("tzDepth", new BufferAttribute(Float32Array.from({ length: ru * rv }, (_, k) => ((k / ru) | 0) / (rv - 1)), 1)); // 0 at the sheet's first edge, 1 at its last
    const ca = new BufferAttribute(col, 3); ca.setUsage(DynamicDrawUsage);
    g.setAttribute("color", ca);
    g.setIndex(new BufferAttribute(idx, 1));
    g.userData.base = Float32Array.from({ length: ru * rv }, (_, k) => col[k * 3]);
    return g;
  }

  /** cavity: how much light is left on the inside face once everything is added up (1 = as lit). The inside of the
   *  hood is a deep, closed pocket: no shadow map makes it dark enough, so it is taken down to near black by hand,
   *  and the hood reads as empty instead of showing a grey, head-shaped lining.
   *  rim > 0: the inside starts at that brightness at the sheet's first edge (the hood's face opening) and falls to
   *  `cavity` over the first `depth` of the sheet, so the lining is still cloth where the light reaches it. */
  function clothMaterial(map: Texture, tint: Color, mask: Texture | null, cavity = 1, rim = 0, depth = 0.5): MeshPhysicalMaterial {
    const m = new MeshPhysicalMaterial({
      map, color: tint, roughness: 0.96, metalness: 0, side: DoubleSide, vertexColors: true,
      normalMap: weaveTex, sheen: 0.55, sheenRoughness: 0.75, sheenColor: new Color(0xfff4e6),
      specularIntensity: 0.12,
    });
    m.normalScale.set(0.62, 0.62); // plain cloth shows its ribs; a fabric picture brings its own texture (see the loader)
    if (mask) { m.alphaMap = mask; m.alphaTest = 0.5; }
    const inside = quality === "high" ? "0.84" : "0.64"; // without a shadow map the inside has to be darkened by hand
    m.customProgramCacheKey = () => "tz-" + inside + "-" + cavity + "-" + rim + "-" + depth;
    m.onBeforeCompile = (shader) => { // the inside of the cloth is a touch darker
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb *= ${inside};`);
      if (cavity < 1 && rim > 0) {
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float tzDepth;\nvarying float vTzDepth;").replace("#include <begin_vertex>", "#include <begin_vertex>\n vTzDepth = tzDepth;");
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vTzDepth;")
          .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n if (!gl_FrontFacing) gl_FragColor.rgb *= mix(${rim.toFixed(3)}, ${cavity.toFixed(3)}, smoothstep(0.0, ${depth.toFixed(3)}, vTzDepth));`);
      } else if (cavity < 1) shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `#include <opaque_fragment>\n if (!gl_FrontFacing) gl_FragColor.rgb *= ${cavity.toFixed(3)};`);
    };
    return m;
  }

  function build(): void {
    const id = ++buildId;
    for (const d of disposables) d.dispose();
    disposables = [];
    scene.remove(root);
    root = new Group();
    scene.add(root);
    const flags = specFlags(spec);
    G = buildGarment({ shape: spec.shape, trim: flags.goldBand && spec.trim === "none" ? "gold-fringe" : spec.trim, hood: flags.hood }, quality, kid);
    const { body, hood, width, halfLen } = G;
    const mask = neckMask(width, halfLen, G.neck);
    const tint = new Color(spec.baseColor || "#efe8d8");
    const bodyMat = clothMaterial(plainTex, tint.clone(), mask, 0.45); // seen through the neck or a sleeve, the inside of the garment is in its own shade
    const hoodMat = clothMaterial(plainTex, tint.clone(), null, 0.03, 0.8, 0.42);
    // real scale: one swatch = 50 cm; weave tile = 16 mm
    weaveTex.repeat.set(0.5 / 0.016, 0.5 / 0.016);
    const hxr = width / (body.ru - 1), hyr = (2 * halfLen) / (body.rv - 1);
    const uOff = flags.offset ? 0.5 : 0;
    const bodyGeo = sheetGeometry(body, (i, j) => [(-width / 2 + i * hxr) / 0.5 + uOff, (j * hyr - halfLen) / 0.5], (i, j) => {
      const x = i * hxr, y = j * hyr;
      let c = 0.93 + 0.1 * vnoise(x * 9, y * 5) - 0.05 * vnoise(x * 31, y * 2.5);
      const e = Math.min(i, j, body.ru - 1 - i, body.rv - 1 - j);
      if (e <= 1) c *= 1.05; else if (e === 2) c *= 0.7; else if (e === 3) c *= 0.93; // folded hem: a doubled band, then the stitch line
      const ci = Math.min(i, body.ru - 1 - i), cj = Math.min(j, body.rv - 1 - j);
      if (ci <= 4 && cj <= 4 && (ci === 4 || cj === 4)) c *= 0.84; // corner reinforcement patch outline
      return c;
    });
    bodyMesh = new Mesh(bodyGeo, bodyMat);
    bodyMesh.frustumCulled = false; bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
    root.add(bodyMesh);
    disposables.push(bodyGeo, bodyMat, mask);
    hoodMesh = null;
    if (hood) {
      const hu = G.hoodArc / (hood.ru - 1), hv = G.hoodDepth / (hood.rv - 1);
      const hoodGeo = sheetGeometry(hood, (i, j) => [(j * hv) / 0.5 + 0.13, (i * hu - G.hoodArc / 2) / 0.5], (i, j) => {
        let c = 0.92 + 0.1 * vnoise(i * hu * 9 + 3, j * hv * 6);
        if (j <= 1) c *= 1.05; else if (j === 2) c *= 0.72;
        return c;
      });
      hoodMesh = new Mesh(hoodGeo, hoodMat);
      hoodMesh.frustumCulled = false; hoodMesh.castShadow = true; hoodMesh.receiveShadow = true;
      root.add(hoodMesh);
      disposables.push(hoodGeo, hoodMat);
    }
    // fabric picture
    fabricReady = !spec.texture;
    if (spec.texture) {
      loader.load(spec.texture, (t) => {
        if (id !== buildId) { t.dispose(); return; }
        t.wrapS = t.wrapT = MirroredRepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = aniso;
        for (const m of [bodyMat, hoodMat]) { m.map = t; m.color.set(0xffffff); m.normalScale.set(0.4, 0.4); m.needsUpdate = true; }
        disposables.push(t);
        fabricReady = true; needsDraw = true;
      }, undefined, () => { fabricReady = true; needsDraw = true; });
    }
    // strings
    const cord = cordAtlas(spec.stringColor || "#f4f1e8", !!spec.techelet);
    strings = new Batch(4 * (30 * 2 + 4 * 2 * 20 * 2) + 64 + 2400, 4 * (30 + 4 * 2 * 20) * 2 + 64 + 2400);
    const strMat = new MeshStandardMaterial({ map: cord, vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
    const strMesh = new Mesh(strings.geo, strMat);
    strMesh.frustumCulled = false; strMesh.castShadow = true;
    root.add(strMesh);
    disposables.push(strings.geo, strMat, cord);
    strandOff.length = 0;
    for (let k = 0; k < 64; k++) { const a = hash2(k, 3.3) * Math.PI * 2; strandOff.push(Math.cos(a), (hash2(k, 9.1) - 0.5) * 0.3, Math.sin(a)); }

    // trims
    trim = null; gold = null; trimEdges = [];
    if (spec.trim !== "none" || flags.goldBand) {
      const kind = spec.trim === "gold-fringe" || spec.trim === "none" ? "fringe" : spec.trim;
      const atlas = trimAtlas(kind);
      const edge = (sh: Sheet, pts: number[], inner: number[], tassel: boolean, strip: boolean): void => {
        trimEdges.push({ sheet: sh, pts: Int32Array.from(pts), inner: Int32Array.from(inner), dir: new Float32Array(pts.length * 3), tassel, strip });
      };
      const { ru, rv } = body;
      const row = (j: number, jn: number): [number[], number[]] => { const a: number[] = [], b: number[] = []; for (let i = 0; i < ru; i++) { a.push(j * ru + i); b.push(jn * ru + i); } return [a, b]; };
      const colm = (i: number, inn: number): [number[], number[]] => { const a: number[] = [], b: number[] = []; for (let j = 0; j < rv; j++) { a.push(j * ru + i); b.push(j * ru + inn); } return [a, b]; };
      const isT = spec.trim === "tassels";
      edge(body, ...row(0, 1), isT, !isT);
      edge(body, ...row(rv - 1, rv - 2), isT, !isT);
      if (spec.trim === "fringe" || spec.trim === "lace") { edge(body, ...colm(0, 1), false, true); edge(body, ...colm(ru - 1, ru - 2), false, true); }
      if (hood && isT) {
        const a: number[] = [], b: number[] = [];
        for (let i = 0; i < hood.ru; i++) { a.push(i); b.push(hood.ru + i); }
        edge(hood, a, b, true, false);
      }
      let nPts = 0; for (const e of trimEdges) nPts += e.pts.length;
      trim = new Batch(nPts * 8 + 16, nPts * 4 + 16);
      const tMat = new MeshStandardMaterial({ map: atlas, color: new Color(spec.trimColor || "#efe8d8"), alphaTest: 0.35, side: DoubleSide, roughness: 1, metalness: 0, vertexColors: true });
      const tMesh = new Mesh(trim.geo, tMat);
      tMesh.frustumCulled = false; tMesh.castShadow = false;
      root.add(tMesh);
      disposables.push(trim.geo, tMat, atlas);
      if (flags.goldBand) {
        const seq = sequins();
        const rows = [[2, 3, 4, 5], [rv - 3, rv - 4, rv - 5, rv - 6]];
        const geo = new BufferGeometry();
        const nV = rows.length * 4 * ru;
        const pos = new BufferAttribute(new Float32Array(nV * 3), 3); pos.setUsage(DynamicDrawUsage);
        const nrm = new BufferAttribute(new Float32Array(nV * 3), 3); nrm.setUsage(DynamicDrawUsage);
        const uv = new Float32Array(nV * 2);
        const idx: number[] = [];
        for (let p = 0; p < rows.length; p++) for (let r = 0; r < 4; r++) for (let i = 0; i < ru; i++) {
          const k = (p * 4 + r) * ru + i;
          uv[k * 2] = (i * hxr) / 0.12; uv[k * 2 + 1] = r / 3;
          if (r < 3 && i < ru - 1) { const a = k, b = k + 1, c = k + ru, d = c + 1; if (p === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
        }
        geo.setAttribute("position", pos); geo.setAttribute("normal", nrm); geo.setAttribute("uv", new BufferAttribute(uv, 2)); geo.setIndex(idx);
        const gMat = new MeshStandardMaterial({ map: seq, bumpMap: seq, bumpScale: 3, color: new Color("#fff1cf"), metalness: 0.4, roughness: 0.3, emissive: new Color("#ffe2a8"), emissiveMap: seq, emissiveIntensity: 0.3, side: FrontSide });
        const gMesh = new Mesh(geo, gMat);
        gMesh.frustumCulled = false; gMesh.receiveShadow = true;
        root.add(gMesh);
        gold = { geo, rows };
        disposables.push(geo, gMat, seq);
      }
    }
    fitCamera(true);
  }

  // ---- camera ----
  let az = 0, el = 0.06, zoom = 1, azV = 0, elV = 0;
  let baseDist = 3, targetY = 1.1, targetX = 0, fixedDist = 0;
  let aspect = 0.75;
  let bounds: { top: number; bottom: number; halfW: number } | null = null;
  function measure(): void { // actual extent of the settled garment, strings included
    const s = G.sim; let top = -1e9, bottom = 1e9, hw = 0;
    for (let i = 0; i < s.n; i++) {
      if (s.w[i] === 0) continue;
      const y = s.pos[i * 3 + 1], x = Math.abs(s.pos[i * 3]);
      if (y > top) top = y; if (y < bottom) bottom = y; if (x > hw) hw = x;
    }
    bounds = { top, bottom, halfW: hw };
  }
  function fitCamera(resetView: boolean): void {
    const strLen = 0.36 * (kid ? 1.2 : 1);
    const top = (bounds ? bounds.top : G.topY) + 0.07, bottom = (bounds ? bounds.bottom : G.hemY - strLen) - 0.06;
    const h = top - bottom, w = (bounds ? bounds.halfW * 2 : G.width) + 0.1;
    const t = Math.tan((FOV * Math.PI) / 360);
    baseDist = Math.max(h / 2 / t, w / 2 / (t * aspect)) * 1.03 * (kid ? 1 / 0.7 : 1);
    targetY = (top + bottom) / 2;
    if (resetView) { az = 0; el = 0.06; zoom = 1; azV = elV = 0; targetX = 0; }
  }
  const camPos = new Vector3();
  function placeCamera(): void {
    const d = fixedDist > 0 ? fixedDist : baseDist * zoom;
    camPos.set(targetX + d * Math.sin(az) * Math.cos(el), targetY + d * Math.sin(el), d * Math.cos(az) * Math.cos(el));
    camera.position.copy(camPos);
    camera.lookAt(targetX, targetY, 0);
    camera.updateMatrixWorld();
    rig.rotation.y = az;
  }

  // ---- per-frame geometry ----
  const tmpP: number[] = [];
  function addRibbon(pts: number[], n: number, halfW: (s: number) => number, u0: number, u1: number, vScale: number, r: number, g: number, b: number): void {
    let prevA = -1, prevB = -1;
    for (let k = 0; k < n; k++) {
      const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
      const kp = k > 0 ? k - 1 : k, kn = k < n - 1 ? k + 1 : k;
      let tx = pts[kn * 3] - pts[kp * 3], ty = pts[kn * 3 + 1] - pts[kp * 3 + 1], tz = pts[kn * 3 + 2] - pts[kp * 3 + 2];
      let cx = camPos.x - x, cy = camPos.y - y, cz = camPos.z - z;
      const cl = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz); cx *= cl; cy *= cl; cz *= cl;
      let sx = ty * cz - tz * cy, sy = tz * cx - tx * cz, sz = tx * cy - ty * cx;
      const sl = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1); sx *= sl; sy *= sl; sz *= sl;
      const s = k / (n - 1), w = halfW(s);
      const a = strings.vert(x - sx * w, y - sy * w, z - sz * w, cx - sx * 0.7, cy - sy * 0.7 + 0.25, cz - sz * 0.7, u0, s * vScale, r, g, b);
      const c = strings.vert(x + sx * w, y + sy * w, z + sz * w, cx + sx * 0.7, cy + sy * 0.7 + 0.25, cz + sz * 0.7, u1, s * vScale, r, g, b);
      if (prevA >= 0) strings.quad(prevA, prevB, a, c);
      prevA = a; prevB = c;
      tx = ty = tz = 0;
    }
  }
  const sCol = new Color(), rimCol = new Color();
  function updateStrings(): void {
    const p = G.sim.pos;
    const px = (2 * baseDist * zoom * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, canvas.clientHeight || 600); // metres per CSS pixel
    const ks = kid ? 1 / 0.7 : 1;
    const thin = Math.max(0.00095 * ks, px * 0.62), thick = Math.max(0.0029 * ks, px * 1.5);
    sCol.set(spec.stringColor || "#f4f1e8");
    strings.begin();
    let so = 0;
    for (const ch of G.chains) {
      // wound third: linear subdivision ×4, bulging at the five knots
      const src = [ch.attach, ...ch.wound];
      let n = 0;
      for (let k = 0; k < src.length - 1; k++) for (let q = 0; q < 4; q++) {
        const a = src[k] * 3, b = src[k + 1] * 3, f = q / 4;
        tmpP[n * 3] = p[a] + (p[b] - p[a]) * f; tmpP[n * 3 + 1] = p[a + 1] + (p[b + 1] - p[a + 1]) * f; tmpP[n * 3 + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * f; n++;
      }
      const e = src[src.length - 1] * 3;
      tmpP[n * 3] = p[e]; tmpP[n * 3 + 1] = p[e + 1]; tmpP[n * 3 + 2] = p[e + 2]; n++;
      addRibbon(tmpP, n, (s) => { let m = 1; for (const kn of [0.02, 0.22, 0.44, 0.7, 0.98]) { const d = Math.abs(s - kn); if (d < 0.035) m = 1.28; } return thick * m * (s < 0.04 ? 0.7 : 1); }, 0.02, 0.48, 1, 1, 1, 1);
      // loose two thirds: each simulated strand drawn as two threads that drift apart towards the tips
      for (let si = 0; si < ch.strands.length; si++) {
        const st = [src[src.length - 1], ...ch.strands[si]];
        for (let pair = 0; pair < 2; pair++) {
          const ox = strandOff[so * 3], oy = strandOff[so * 3 + 1], oz = strandOff[so * 3 + 2]; so = (so + 1) % 60;
          let m = 0;
          for (let k = 0; k < st.length - 1; k++) for (let q = 0; q < 2; q++) {
            const i0 = st[Math.max(0, k - 1)] * 3, i1 = st[k] * 3, i2 = st[k + 1] * 3, i3 = st[Math.min(st.length - 1, k + 2)] * 3, f = q / 2;
            const f2 = f * f, f3 = f2 * f;
            const w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
            const s = (k + f) / (st.length - 1), off = (0.0012 + 0.0075 * s * s) * ks * (pair ? 1 : -0.6);
            tmpP[m * 3] = p[i0] * w0 + p[i1] * w1 + p[i2] * w2 + p[i3] * w3 + ox * off;
            tmpP[m * 3 + 1] = p[i0 + 1] * w0 + p[i1 + 1] * w1 + p[i2 + 1] * w2 + p[i3 + 1] * w3 + oy * off - (pair ? 0 : 0.006 * s);
            tmpP[m * 3 + 2] = p[i0 + 2] * w0 + p[i1 + 2] * w1 + p[i2 + 2] * w2 + p[i3 + 2] * w3 + oz * off; m++;
          }
          const le = st[st.length - 1] * 3, off = (0.0012 + 0.0075) * ks * (pair ? 1 : -0.6);
          tmpP[m * 3] = p[le] + ox * off; tmpP[m * 3 + 1] = p[le + 1] + oy * off - (pair ? 0 : 0.006); tmpP[m * 3 + 2] = p[le + 2] + oz * off; m++;
          const blue = spec.techelet && si === 0 && pair === 0;
          const c = blue ? BLUE : sCol;
          addRibbon(tmpP, m, () => thin, 0.52, 0.98, 5, c.r, c.g, c.b);
        }
      }
    }
    // rolled, overlocked hem: a thin cord along every free edge gives the sheet visible thickness
    rimCol.set(spec.baseColor || "#efe8d8").multiplyScalar(0.94);
    const rimW = Math.max(0.0024 * ks, px * 0.75);
    const rim = (sh: Sheet, start: number, stride: number, n: number, len: number): void => {
      const rp = sh.rpos;
      for (let k = 0; k < n; k++) { const a = (start + k * stride) * 3; tmpP[k * 3] = rp[a]; tmpP[k * 3 + 1] = rp[a + 1]; tmpP[k * 3 + 2] = rp[a + 2]; }
      addRibbon(tmpP, n, () => rimW, 0.52, 0.98, len / 0.012, rimCol.r, rimCol.g, rimCol.b);
    };
    const bd = G.body;
    rim(bd, 0, 1, bd.ru, G.width); rim(bd, (bd.rv - 1) * bd.ru, 1, bd.ru, G.width);
    rim(bd, 0, bd.ru, bd.rv, 2 * G.halfLen); rim(bd, bd.ru - 1, bd.ru, bd.rv, 2 * G.halfLen);
    if (G.hood) rim(G.hood, 0, 1, G.hood.ru, G.hoodArc);
    // finished edge around the neck opening: the same cord laid along the cut line on the (membrane-filled) sheet
    {
      const nk = G.neck, rp = bd.rpos, N = 56;
      const hxr = G.width / (bd.ru - 1), hyr = (2 * G.halfLen) / (bd.rv - 1);
      for (let k = 0; k < N; k++) {
        const f = k / (N - 1);
        let x: number, t: number;
        if (f < 0.62) { // front: V (quadratic, as in the mask) or round
          const u = f / 0.62;
          if (nk.round) { const a = Math.PI * (1 - u); x = nk.halfW * Math.cos(a); t = -nk.front * Math.sin(a); }
          else if (u < 0.5) { const q = u * 2; x = -nk.halfW * (1 - q) * (1 - q) - nk.halfW * 0.5 * 2 * q * (1 - q); t = -nk.front * 0.6 * 2 * q * (1 - q) - nk.front * q * q; }
          else { const q = (u - 0.5) * 2; x = nk.halfW * 0.5 * 2 * q * (1 - q) + nk.halfW * q * q; t = -nk.front * (1 - q) * (1 - q) - nk.front * 0.6 * 2 * q * (1 - q); }
        } else { const a = Math.PI * ((f - 0.62) / 0.38); x = nk.halfW * Math.cos(a); t = nk.back * Math.sin(a); }
        const gx = Math.min(bd.ru - 1.001, Math.max(0, (x + G.width / 2) / hxr)), gy = Math.min(bd.rv - 1.001, Math.max(0, (t + G.halfLen) / hyr));
        const i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
        const a = (j0 * bd.ru + i0) * 3, b = a + 3, c = a + bd.ru * 3, d = c + 3;
        for (let m = 0; m < 3; m++) tmpP[k * 3 + m] = (rp[a + m] * (1 - fx) + rp[b + m] * fx) * (1 - fy) + (rp[c + m] * (1 - fx) + rp[d + m] * fx) * fy;
      }
      addRibbon(tmpP, N, () => rimW * 1.25, 0.52, 0.98, 50, rimCol.r, rimCol.g, rimCol.b);
    }
    strings.end();
  }

  function updateTrim(first: boolean): void {
    if (!trim) return;
    trim.begin();
    const ks = kid ? 1 / 0.7 : 1;
    for (const e of trimEdges) {
      const rp = e.sheet.rpos, rn = e.sheet.rnrm, n = e.pts.length, dir = e.dir;
      for (let k = 0; k < n; k++) { // lagging hang direction per hem point
        const a = e.pts[k] * 3, b = e.inner[k] * 3;
        let ox = rp[a] - rp[b], oy = rp[a + 1] - rp[b + 1], oz = rp[a + 2] - rp[b + 2];
        const ol = 1 / (Math.sqrt(ox * ox + oy * oy + oz * oz) || 1);
        const gw = e.tassel ? 1.25 : 0.8;
        ox = ox * ol * 0.6; oy = oy * ol * 0.6 - gw; oz = oz * ol * 0.6;
        const l = 1 / Math.sqrt(ox * ox + oy * oy + oz * oz); ox *= l; oy *= l; oz *= l;
        const f = first ? 1 : 0.16;
        dir[k * 3] += (ox - dir[k * 3]) * f; dir[k * 3 + 1] += (oy - dir[k * 3 + 1]) * f; dir[k * 3 + 2] += (oz - dir[k * 3 + 2]) * f;
      }
      if (e.strip) {
        const len = (spec.trim === "lace" ? 0.06 : e.tassel ? 0.012 : 0.032) * ks;
        let pa = -1, pb = -1;
        const step = spec.trim === "lace" ? 2 : 1; // lace scallops are larger than fringe strands
        for (let k = 0; k < n; k += step) {
          const a = e.pts[k] * 3;
          const u = 0.52 + 0.46 * ((k / step) % 2);
          const shade = 0.82 + 0.3 * hash2(k, 1.7);
          const va = trim.vert(rp[a], rp[a + 1], rp[a + 2], rn[a], rn[a + 1], rn[a + 2], u, 1, shade, shade, shade);
          const vb = trim.vert(rp[a] + dir[k * 3] * len, rp[a + 1] + dir[k * 3 + 1] * len, rp[a + 2] + dir[k * 3 + 2] * len, rn[a], rn[a + 1], rn[a + 2], u, e.tassel ? 0.55 : 0.02, shade, shade, shade);
          if (pa >= 0) {
            // wind the quad so its face agrees with the cloth normal (double-sided shading flips normals of back faces)
            const q = e.pts[k - step] * 3;
            const ex = rp[a] - rp[q], ey = rp[a + 1] - rp[q + 1], ez = rp[a + 2] - rp[q + 2];
            const dx = dir[k * 3], dy = dir[k * 3 + 1], dz = dir[k * 3 + 2];
            const fx = ey * dz - ez * dy, fy = ez * dx - ex * dz, fz = ex * dy - ey * dx;
            if (fx * rn[a] + fy * rn[a + 1] + fz * rn[a + 2] >= 0) trim.quad(pa, va, pb, vb); else trim.quad(va, pa, vb, pb);
          }
          pa = va; pb = vb;
        }
      }
      if (e.tassel) {
        const len = 0.058 * ks, hw = 0.014 * ks;
        for (let k = 2; k < n - 1; k += 3) {
          const a = e.pts[k] * 3;
          const x = rp[a], y = rp[a + 1], z = rp[a + 2];
          const dx = dir[k * 3], dy = dir[k * 3 + 1], dz = dir[k * 3 + 2];
          let cx = camPos.x - x, cy = camPos.y - y, cz = camPos.z - z;
          const cl = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz); cx *= cl; cy *= cl; cz *= cl;
          let sx = dy * cz - dz * cy, sy = dz * cx - dx * cz, sz = dx * cy - dy * cx;
          const sl = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1); sx *= sl * hw; sy *= sl * hw; sz *= sl * hw;
          const L = len * (0.85 + 0.3 * hash2(k, 4.2)), sh = 0.86 + 0.24 * hash2(k, 7.7);
          const nx = rn[a] * 0.5 + cx * 0.5, ny = rn[a + 1] * 0.5 + cy * 0.5 + 0.2, nz = rn[a + 2] * 0.5 + cz * 0.5;
          const v0 = trim.vert(x - sx, y - sy, z - sz, nx, ny, nz, 0.02, 1, sh, sh, sh);
          const v1 = trim.vert(x + sx, y + sy, z + sz, nx, ny, nz, 0.48, 1, sh, sh, sh);
          const v2 = trim.vert(x - sx + dx * L, y - sy + dy * L, z - sz + dz * L, nx, ny, nz, 0.02, 0.01, sh, sh, sh);
          const v3 = trim.vert(x + sx + dx * L, y + sy + dy * L, z + sz + dz * L, nx, ny, nz, 0.48, 0.01, sh, sh, sh);
          trim.quad(v0, v1, v2, v3);
        }
      }
    }
    trim.end();
  }

  function updateGold(): void {
    if (!gold) return;
    const { ru, rpos, rnrm } = G.body;
    const pos = gold.geo.getAttribute("position") as BufferAttribute, nrm = gold.geo.getAttribute("normal") as BufferAttribute;
    const pa = pos.array as Float32Array, na = nrm.array as Float32Array;
    let k = 0;
    for (const rows of gold.rows) for (const r of rows) for (let i = 0; i < ru; i++) {
      const s = (r * ru + i) * 3;
      pa[k] = rpos[s] + rnrm[s] * 0.0035; pa[k + 1] = rpos[s + 1] + rnrm[s + 1] * 0.0035; pa[k + 2] = rpos[s + 2] + rnrm[s + 2] * 0.0035;
      na[k] = rnrm[s]; na[k + 1] = rnrm[s + 1]; na[k + 2] = rnrm[s + 2]; k += 3;
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
  }

  // cheap ambient occlusion from fold curvature: valleys darker, ridges a touch lighter (the shadow map adds the cast shadows)
  function shadeFolds(sh: Sheet, mesh: Mesh): void {
    const attr = mesh.geometry.getAttribute("color") as BufferAttribute, col = attr.array as Float32Array;
    const base = mesh.geometry.userData.base as Float32Array, fold = sh.fold;
    const gain = quality === "high" ? 0.0055 : 0.011;
    for (let k = 0, n = base.length; k < n; k++) {
      let o = fold[k] * gain;
      o = o > 0.26 ? 0.26 : o < -0.05 ? -0.05 : o;
      const c = base[k] * (1 - o);
      col[k * 3] = c; col[k * 3 + 1] = c * (1 - o * 0.06); col[k * 3 + 2] = c * (1 - o * 0.14); // occluded light is warmer
    }
    attr.needsUpdate = true;
  }
  let firstGeom = true;
  function syncGeometry(): void {
    G.body.update(); G.hood?.update();
    if (G.hood) { // weld the back seam of the hood so no gap shows
      const { ru, rv, rpos, rnrm } = G.hood;
      for (let i = 0; i < ru >> 1; i++) {
        const a = ((rv - 1) * ru + i) * 3, b = ((rv - 1) * ru + (ru - 1 - i)) * 3;
        for (let k = 0; k < 3; k++) {
          const m = (rpos[a + k] + rpos[b + k]) * 0.5; rpos[a + k] = m; rpos[b + k] = m;
          const nn = (rnrm[a + k] + rnrm[b + k]) * 0.5; rnrm[a + k] = nn; rnrm[b + k] = nn;
        }
      }
    }
    (bodyMesh.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (bodyMesh.geometry.getAttribute("normal") as BufferAttribute).needsUpdate = true;
    if (hoodMesh) {
      (hoodMesh.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (hoodMesh.geometry.getAttribute("normal") as BufferAttribute).needsUpdate = true;
    }
    shadeFolds(G.body, bodyMesh);
    if (G.hood && hoodMesh) shadeFolds(G.hood, hoodMesh);
    updateStrings(); updateTrim(firstGeom); updateGold();
    firstGeom = false;
  }

  // ---- simulation driving ----
  let simTime = 0;
  let windOn = true;
  function updateWind(t: number): void {
    const s = G.sim;
    if (!windOn) { s.windX = s.windY = s.windZ = 0; s.windGust = 0; return; }
    // a lazy indoor draught that wanders, with an occasional soft gust
    const base = 0.12 + 0.07 * Math.sin(t * 0.23) + 0.04 * Math.sin(t * 0.61 + 1.3);
    const gust = Math.pow(Math.max(0, Math.sin(t * 0.17 + 0.6) * Math.sin(t * 0.071 + 2.1)), 3) * 1.6;
    const a = 0.9 * Math.sin(t * 0.11) + 0.5 * Math.sin(t * 0.29 + 0.7);
    const sp = base + gust * 0.35;
    s.windX = Math.sin(a) * sp; s.windZ = Math.cos(a) * sp * 0.9; s.windY = 0.03 * Math.sin(t * 0.4);
    s.windPhase = t * 0.9; s.windGust = gust;
  }
  // ---- always back to a garment that hangs straight ----
  // Cloth without self-collision can end up wrapped around the ghost body, slid off the shoulders, or with its hood
  // slumped off the head form, and no amount of waiting undoes that. So the pose is watched: two seconds after every
  // release (a little later if the cloth is still swinging), and once a second for as long as the garment is on
  // screen. If the cloth is far from its settled pose, sits off-axis, has lost its hood, is over-stretched, or the
  // numbers broke, every particle is eased back. The thresholds sit well above what the indoor draught does.
  const HOME_MEAN = 0.04;     // m, mean distance of the cloth from the settled pose that counts as "not back"
  const HOME_HOOD = 0.03;     // m, the same for the hood alone (a slumped hood is small in the overall mean)
  const HOME_SHIFT = 0.015;   // m, mean sideways offset: the garment sits off-axis on the shoulders
  const HOME_STRAIN = 1.12;   // a thread 12 % longer than in the settled garment is not a state cloth rests in
  const HOME_AFTER = 2.0;     // s after release: first look
  const HOME_LATEST = 3.2;    // s after release: stop waiting for the swing to die down
  const HOME_TIME = 0.6;      // s, the ease itself
  let sinceRelease = -1, nextCheck = 0, idleClock = 0, strikes = 0;
  let homing = false, homeT = 0, homeDur = HOME_TIME, homeCam = false;
  let homeFrom = new Float64Array(0);
  const camFrom = { az: 0, el: 0, zoom: 1, tx: 0 };
  const prefersStill = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function released(): void { sinceRelease = 0; nextCheck = HOME_AFTER; strikes = 0; }
  function poseIsOff(): boolean {
    const s = G.sim, hd = G.hood;
    const mean = s.meanFromRest(), strain = s.maxStrain();
    const hoodMean = hd ? s.meanFromRest(hd.start, hd.start + hd.nu * hd.nv) : 0;
    let sx = 0, cnt = 0;
    for (let i = 0, n = G.body.nu * G.body.nv; i < n; i++) if (s.w[i] > 0) { sx += s.pos[i * 3] - s.rest[i * 3]; cnt++; }
    const shift = cnt ? Math.abs(sx / cnt) : 0;
    return !(mean <= HOME_MEAN && hoodMean <= HOME_HOOD && shift <= HOME_SHIFT && strain <= HOME_STRAIN); // written so that NaN counts as off
  }
  function startHome(withCamera: boolean, dur = HOME_TIME): void {
    const s = G.sim;
    s.grabIdx = -1; sinceRelease = -1;
    if (homeFrom.length !== s.pos.length) homeFrom = new Float64Array(s.pos.length);
    homeFrom.set(s.pos);
    homing = true; homeT = 0; homeDur = dur; homeCam = withCamera;
    if (withCamera) { camFrom.az = az; camFrom.el = el; camFrom.zoom = zoom; camFrom.tx = targetX; azV = elV = 0; }
    needsDraw = true;
  }
  function homeStep(dt: number): void {
    const s = G.sim, pos = s.pos, rest = s.rest, prev = s.prev, from = homeFrom;
    homeT += dt;
    const u = homeDur > 0 ? Math.min(1, homeT / homeDur) : 1;
    const f = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep: leaves and arrives without a jerk
    for (let i = 0, n = s.n * 3; i < n; i++) {
      const a = from[i];
      const v = a === a && Math.abs(a) < 1e3 ? a + (rest[i] - a) * f : rest[i];
      pos[i] = v; prev[i] = v;
    }
    s.vel.fill(0);
    if (homeCam) {
      const turns = Math.round(camFrom.az / (Math.PI * 2)) * Math.PI * 2;
      az = camFrom.az + (turns - camFrom.az) * f; el = camFrom.el + (0.06 - camFrom.el) * f;
      zoom = camFrom.zoom + (1 - camFrom.zoom) * f; targetX = camFrom.tx * (1 - f);
    }
    if (u >= 1) { homing = false; s.reset(); if (homeCam) fitCamera(true); }
  }
  /** Called once per simulated frame while nothing is being eased. */
  function watch(dt: number): void {
    const s = G.sim;
    if (s.kinetic !== s.kinetic) { if (grabbing) endGrab(); startHome(false, 0); return; } // NaN: back at once
    if (s.grabIdx >= 0) return;
    if (sinceRelease >= 0) { // just let go: look at two seconds, wait a little longer if it still swings
      sinceRelease += dt;
      if (sinceRelease < nextCheck) return;
      if (!poseIsOff()) { sinceRelease = -1; idleClock = 0; strikes = 0; return; }
      if (s.kinetic > 0.004 && sinceRelease < HOME_LATEST && s.maxStrain() <= 1.5) { nextCheck = sinceRelease + 0.2; return; }
      startHome(false, prefersStill() ? 0 : HOME_TIME);
      return;
    }
    // nobody is touching it: once a second; off twice in a row (not just a passing gust) and it is eased back
    idleClock += dt;
    if (idleClock < 1) return;
    idleClock = 0;
    if (!poseIsOff()) { strikes = 0; return; }
    if (++strikes >= 2) { strikes = 0; startHome(false, prefersStill() ? 0 : HOME_TIME); }
  }
  function stepFrames(n: number): void {
    for (let k = 0; k < n; k++) {
      simTime += 1 / 60;
      if (homing) homeStep(1 / 60);
      else { updateWind(simTime); G.sim.frame(1 / 60); }
      G.body.update(); G.hood?.update();
      if (!homing) watch(1 / 60);
    }
  }
  let settleLeft = 0;
  const SETTLE_FRAMES = 200;
  function settleChunk(budgetMs: number): boolean {
    const s = G.sim;
    const t0 = performance.now();
    const saveD = s.damping, saveSub = s.substeps;
    windOn = false; updateWind(0);
    while (settleLeft > 0 && performance.now() - t0 < budgetMs) {
      // heavy damping first (kills the fall), then free settling
      s.damping = settleLeft > SETTLE_FRAMES * 0.3 ? 8 : 2;
      s.substeps = Math.min(saveSub, 10);
      s.frame(1 / 60);
      if (settleLeft % 2 === 0) { G.body.update(); G.hood?.update(); }
      settleLeft--;
    }
    s.damping = saveD; s.substeps = saveSub; windOn = true;
    if (settleLeft <= 0) { s.zeroVelocities(); s.saveRest(); G.body.update(); G.hood?.update(); measure(); fitCamera(true); return true; }
    return false;
  }

  // ---- loop ----
  let paused = !!opts.paused, disposed = false, contextLost = false, raf = 0, lastT = 0, needsDraw = true, ready = false;
  let slowFrames = 0, measured = 0;
  function draw(): void {
    placeCamera();
    syncGeometry();
    renderer.render(scene, camera);
    needsDraw = false;
  }
  function tick(now: number): void {
    raf = 0;
    if (disposed || contextLost) return;
    if (settleLeft > 0) {
      if (!settleChunk(9)) { schedule(); return; }
      lastT = now;
    }
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0);
    lastT = now;
    let active = false;
    if (!paused) {
      simTime += dt;
      let frames = 0;
      if (homing) homeStep(dt);
      else { updateWind(simTime); frames = G.sim.advance(dt); if (frames > 0) watch(frames / 60); }
      active = true;
      if (autoQuality && quality === "high" && ready && frames > 0 && measured < 90) {
        measured++;
        if (dt > 0.03 || G.sim.lastSolveMs > 7) slowFrames++;
        if (measured === 90 && slowFrames > 45) { quality = "low"; renderer.shadowMap.enabled = false; rebuild(); }
      }
    }
    // camera inertia
    if (!orbiting && (Math.abs(azV) > 1e-4 || Math.abs(elV) > 1e-4)) {
      az += azV * dt; el = clampEl(el + elV * dt);
      const k = Math.exp(-dt * 3.2); azV *= k; elV *= k; active = true;
    }
    if (active || needsDraw || grabbing) {
      if (fabricReady || now - mountT > 3500) {
        draw();
        if (!ready) { ready = true; opts.onReady?.(); }
      }
    }
    if (!paused || needsDraw || grabbing || Math.abs(azV) > 1e-4 || !ready) schedule();
  }
  function schedule(): void { if (!raf && !disposed && !contextLost) raf = requestAnimationFrame(tick); }
  const mountT = performance.now();

  function rebuild(): void {
    bounds = null; homing = false; sinceRelease = -1;
    build();
    settleLeft = SETTLE_FRAMES; firstGeom = true;
    if (opts.settleSync) settleChunk(1e9);
    needsDraw = true; schedule();
  }

  // ---- size ----
  function resize(): void {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    const pr = Math.min(quality === "low" ? 1.5 : 2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    aspect = w / h; camera.aspect = aspect; camera.updateProjectionMatrix();
    fitCamera(false);
    needsDraw = true; schedule();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  // ---- interaction ----
  const clampEl = (v: number): number => Math.max(-0.22, Math.min(0.6, v));
  const v3 = new Vector3();
  let orbiting = false, grabbing = false, pid = -1, lastX = 0, lastY = 0, lastMoveT = 0, grabNdcZ = 0, downX = 0, downY = 0, lastTapT = 0, lastTapX = 0, lastTapY = 0;
  function pick(clientX: number, clientY: number, touch: boolean): number {
    const r = canvas.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const s = G.sim, p = s.pos;
    let best = -1, bestScore = 1e9;
    const rad = (touch ? 30 : 20), radStr = touch ? 34 : 24;
    for (let i = 0; i < s.n; i++) {
      if (s.kind[i] === KIND_DEAD) continue;
      v3.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).project(camera);
      const sx = (v3.x * 0.5 + 0.5) * r.width, sy = (-v3.y * 0.5 + 0.5) * r.height;
      const d = Math.hypot(sx - mx, sy - my);
      const lim = s.kind[i] === KIND_STRING ? radStr : rad;
      if (d > lim) continue;
      const score = v3.z * 40 + (d / lim) * 0.02 - (s.kind[i] === KIND_STRING ? 0.01 : 0);
      if (score < bestScore) { bestScore = score; best = i; grabNdcZ = v3.z; }
    }
    return best;
  }
  // How far a held point may be taken from where it rests: 18 % of the stage height, and never more than 30 cm of
  // cloth. The stage always frames the garment the same way, so a phone and a desktop allow the same pull; the limit
  // is soft (the cloth follows the finger for the first two thirds, then lags) rather than a wall.
  let grabMax = 0.3, grabDown = 0.3;
  function beginGrab(hit: number, clientX: number, clientY: number): void {
    const s = G.sim, r = s.rest;
    if (homing) { homing = false; s.zeroVelocities(); }
    const t = Math.tan((FOV * Math.PI) / 360);
    grabMax = Math.min(0.3, 0.18 * 2 * baseDist * t);
    // what hangs below the held point (the strings under a corner, say) must not be pushed out of the bottom of the stage
    const gx = r[hit * 3];
    let low = r[hit * 3 + 1];
    for (let i = 0; i < s.n; i++) if (s.w[i] > 0 && Math.abs(r[i * 3] - gx) < 0.2 && r[i * 3 + 1] < low) low = r[i * 3 + 1];
    const d = fixedDist > 0 ? fixedDist : baseDist * zoom;
    grabDown = Math.max(0.05, Math.min(grabMax, low - (targetY - d * t) - 0.015));
    grabbing = true; s.grabIdx = hit; sinceRelease = -1;
    setGrabTarget(clientX, clientY);
  }
  function endGrab(): void {
    if (G.sim.grabIdx >= 0) released();
    G.sim.grabIdx = -1; grabbing = false; provisional = false;
    canvas.style.cursor = "grab"; canvas.style.touchAction = "pan-y";
  }
  function setGrabTarget(clientX: number, clientY: number): void {
    const r = canvas.getBoundingClientRect();
    // the hand stays inside the stage: a pull towards a corner ends at the frame, the cloth is not cut by its edge
    const nx = Math.max(-0.9, Math.min(0.9, ((clientX - r.left) / r.width) * 2 - 1));
    const ny = Math.max(-0.92, Math.min(0.93, -(((clientY - r.top) / r.height) * 2 - 1)));
    v3.set(nx, ny, grabNdcZ).unproject(camera);
    const s = G.sim, g = s.grabIdx * 3;
    let dx = v3.x - s.rest[g], dy = v3.y - s.rest[g + 1], dz = v3.z - s.rest[g + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), knee = grabMax * 0.6;
    if (d > knee) { const room = grabMax - knee, k = (knee + room * (1 - Math.exp(-(d - knee) / room))) / d; dx *= k; dy *= k; dz *= k; }
    if (dy < -grabDown) dy = -grabDown;
    s.grabX = s.rest[g] + dx; s.grabY = s.rest[g + 1] + dy; s.grabZ = s.rest[g + 2] + dz;
  }
  // A finger that lands on the cloth may be about to scroll the page. The hit is remembered, and the cloth is taken
  // only once the finger has moved sideways or has rested for a moment; a vertical swipe is left to the browser.
  const TOUCH_SLOP = 10, TOUCH_HOLD_MS = 180;
  let pend: { id: number; hit: number; z: number; timer: number } | null = null;
  // A slow frame can deliver the finger's first movement after the hold timer has already fired. Events carry the
  // time they happened, so a hold-grab stays provisional until a movement proves the finger really was resting.
  let downStamp = 0, provisional = false;
  function clearPend(): void { if (pend) { window.clearTimeout(pend.timer); pend = null; } }
  function takeCloth(hit: number, clientX: number, clientY: number, pointerId: number, touch: boolean): void {
    beginGrab(hit, clientX, clientY); provisional = false;
    try { canvas.setPointerCapture(pointerId); } catch { /* ignore */ }
    canvas.style.cursor = "grabbing";
    if (touch) canvas.style.touchAction = "none";
    if (paused) setPaused(false);
    opts.onInteract?.();
    schedule();
  }
  // two fingers: pinch to zoom
  const touches = new Map<number, { x: number; y: number }>();
  let pinching = false, pinchD0 = 1, pinchZoom0 = 1;
  const touchSpread = (): number => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  function onDown(e: PointerEvent): void {
    if (e.pointerType === "touch") touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pid !== -1 && ready && e.pointerType === "touch" && touches.size === 2) {
      clearPend();
      if (grabbing) endGrab();
      orbiting = false; pinching = true; azV = elV = 0;
      pinchD0 = touchSpread(); pinchZoom0 = zoom;
      e.preventDefault();
      return;
    }
    if (pid !== -1 || !ready || (e.pointerType === "mouse" && e.button !== 0)) return;
    const touch = e.pointerType !== "mouse";
    const hit = pick(e.clientX, e.clientY, touch);
    pid = e.pointerId; lastX = downX = e.clientX; lastY = downY = e.clientY; lastMoveT = performance.now();
    if (hit >= 0 && e.pointerType === "touch") {
      const id = e.pointerId;
      clearPend();
      pend = {
        id, hit, z: grabNdcZ,
        timer: window.setTimeout(() => {
          if (!pend || pend.id !== id || disposed) return;
          const p = pend; pend = null;
          if (Math.abs(lastY - downY) > 6) return; // drifting vertically: that is a slow scroll, not a hold
          grabNdcZ = p.z; takeCloth(p.hit, lastX, lastY, id, true); provisional = true;
        }, TOUCH_HOLD_MS),
      };
      downStamp = e.timeStamp;
      return; // nothing prevented: the browser may still scroll
    }
    if (hit >= 0) {
      takeCloth(hit, e.clientX, e.clientY, e.pointerId, false);
      e.preventDefault();
      return;
    } else {
      orbiting = true; azV = elV = 0;
      if (!touch) { try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    }
    opts.onInteract?.();
    schedule();
  }
  function onMove(e: PointerEvent): void {
    if (e.pointerType === "touch" && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinching) {
      if (touches.size >= 2) { zoom = Math.max(0.55, Math.min(1.25, (pinchZoom0 * pinchD0) / touchSpread())); needsDraw = true; schedule(); }
      e.preventDefault();
      return;
    }
    if (e.pointerId !== pid) return;
    const now = performance.now(), dt = Math.max(1, now - lastMoveT) / 1000;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; lastMoveT = now;
    if (pend && pend.id === e.pointerId) {
      const mx = Math.abs(e.clientX - downX), my = Math.abs(e.clientY - downY);
      if (my > TOUCH_SLOP && my >= mx) { clearPend(); return; } // a vertical swipe: the page scrolls
      if (mx > TOUCH_SLOP && mx > my) { const p = pend; clearPend(); grabNdcZ = p.z; takeCloth(p.hit, e.clientX, e.clientY, e.pointerId, true); }
      return;
    }
    if (grabbing && provisional) {
      const mx = Math.abs(e.clientX - downX), my = Math.abs(e.clientY - downY);
      if (e.timeStamp - downStamp >= TOUCH_HOLD_MS || (mx > TOUCH_SLOP && mx > my)) provisional = false;
      else if (my > TOUCH_SLOP && my >= mx) { endGrab(); sinceRelease = -1; return; } // it was a swipe all along: let go, the page scrolls
    }
    if (grabbing) { setGrabTarget(e.clientX, e.clientY); e.preventDefault(); }
    else if (orbiting) {
      const k = 0.0075;
      az -= dx * k; azV = (-dx * k) / dt * 0.6;
      if (e.pointerType === "mouse") { el = clampEl(el + dy * k * 0.7); elV = 0; }
      needsDraw = true;
    }
    schedule();
  }
  function onUp(e: PointerEvent): void {
    touches.delete(e.pointerId);
    if (pinching) { if (touches.size < 2) { pinching = false; pid = -1; } return; }
    if (e.pointerId !== pid) return;
    pid = -1;
    clearPend();
    if (grabbing) endGrab();
    if (orbiting && performance.now() - lastMoveT > 80) azV = 0;
    orbiting = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // double tap / double click: back to the settled pose
    const now = performance.now();
    if (e.type === "pointerup" && Math.hypot(e.clientX - downX, e.clientY - downY) < 8) {
      if (now - lastTapT < 340 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30) { resetPose(); lastTapT = 0; }
      else { lastTapT = now; lastTapX = e.clientX; lastTapY = e.clientY; }
    }
    schedule();
  }
  function resetPose(immediate = false): void {
    clearPend();
    if (grabbing) endGrab();
    if (immediate || paused || prefersStill()) { homing = false; sinceRelease = -1; G.sim.reset(); fitCamera(true); firstGeom = true; }
    else startHome(true);
    needsDraw = true; schedule();
  }
  function onTouchStart(e: TouchEvent): void { if ((grabbing || pinching || e.touches.length > 1) && e.cancelable) e.preventDefault(); } // keep the page from scrolling while the cloth is held
  function onTouchMove(e: TouchEvent): void { if ((grabbing || pinching) && e.cancelable) e.preventDefault(); }
  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page; pinch / ctrl-wheel zooms
    e.preventDefault();
    zoom = Math.max(0.55, Math.min(1.25, zoom * Math.exp(e.deltaY * 0.004)));
    needsDraw = true; schedule();
  }
  function onLost(e: Event): void { e.preventDefault(); contextLost = true; if (raf) cancelAnimationFrame(raf); raf = 0; opts.onContextLost?.(); }
  function onRestored(): void { contextLost = false; needsDraw = true; lastT = performance.now(); opts.onContextRestored?.(); schedule(); }
  if (opts.interactive !== false) {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("wheel", onWheel, { passive: false });
  }
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  function setPaused(p: boolean): void {
    paused = p;
    if (!p) { lastT = performance.now(); schedule(); }
  }

  build();
  settleLeft = SETTLE_FRAMES;
  resize();
  if (opts.settleSync) settleChunk(1e9);
  lastT = performance.now();
  schedule();

  return {
    canvas,
    get quality() { return quality; },
    setSpec(next: ClothSpec): void {
      if (disposed) return;
      const same = JSON.stringify(next) === JSON.stringify(spec);
      spec = next;
      if (!same) rebuild();
    },
    setPaused,
    reset(): void { if (!disposed && settleLeft <= 0) resetPose(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearPend();
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("touchstart", onTouchStart); canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const d of disposables) d.dispose();
      weaveTex.dispose(); plainTex.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
      canvas.remove();
    },
    snapshot(): string {
      if (disposed || contextLost) return "";
      draw(); // draw and read back in the same task: no preserveDrawingBuffer needed
      return canvas.toDataURL("image/png");
    },
    lab: {
      step(frames: number): void { if (settleLeft > 0) settleChunk(1e9); stepFrames(frames); needsDraw = true; },
      setView(a: number, e: number, z = 1, ty?: number, tx?: number): void { az = a; el = e; zoom = z; fitCamera(false); if (ty !== undefined) targetY = ty; targetX = tx ?? 0; needsDraw = true; },
      corner(i: number): number { return G.chains[i % 4].attach; },
      tip(i: number): number { const s = G.chains[i % 4].strands[0]; return s[s.length - 1]; },
      grab(particle: number, dx: number, dy: number, dz: number): void {
        const s = G.sim; s.grabIdx = particle;
        s.grabX = s.rest[particle * 3] + dx; s.grabY = s.rest[particle * 3 + 1] + dy; s.grabZ = s.rest[particle * 3 + 2] + dz;
      },
      release(): void { if (G.sim.grabIdx >= 0) released(); G.sim.grabIdx = -1; },
      reset(): void { resetPose(true); },
      view() { return { azimuth: az, elevation: el, zoom, grabbed: G.sim.grabIdx, paused, pending: !!pend, homing }; },
      bounds() { if (settleLeft > 0) settleChunk(1e9); return bounds; },
      textureReady() { return fabricReady; },
      frame(a: number, e: number, d: number, ty: number): void { if (settleLeft > 0) settleChunk(1e9); az = a; el = e; zoom = 1; fixedDist = d; targetY = ty; targetX = 0; needsDraw = true; },
      render(): void { draw(); },
      stats() {
        return { ...G.counts, solverMsPerFrame: G.sim.lastSolveMs, substeps: G.sim.substeps, kinetic: G.sim.kinetic, strainPasses: G.sim.strainPasses };
      },
      bench(frames: number): number {
        const t0 = performance.now();
        for (let k = 0; k < frames; k++) G.sim.frame(1 / 60);
        return (performance.now() - t0) / frames;
      },
      down(x: number, y: number): number { placeCamera(); const hit = pick(x, y, false); if (hit >= 0) beginGrab(hit, x, y); return hit; },
      move(x: number, y: number): void { if (G.sim.grabIdx >= 0) setGrabTarget(x, y); },
      up(): void { endGrab(); },
      homing(): boolean { return homing; },
      screen(i: number): [number, number] {
        placeCamera();
        const r = canvas.getBoundingClientRect(), p = G.sim.pos;
        v3.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).project(camera);
        return [r.left + (v3.x * 0.5 + 0.5) * r.width, r.top + (-v3.y * 0.5 + 0.5) * r.height];
      },
      named(): Record<string, number> {
        const nu = G.body.nu, nv = G.body.nv, out: Record<string, number> = {};
        out.hemFront = nu >> 1; out.chest = Math.round(nv * 0.27) * nu + (nu >> 1) + 4; out.cornerFR = nu + nu - 2; out.sideR = Math.round(nv * 0.2) * nu + nu - 2;
        if (G.hood) { const h = G.hood; out.hoodRim = h.start + (h.nu >> 1); out.hoodSide = h.start + (h.nu >> 2); out.hoodBack = h.start + (h.nv >> 1) * h.nu + (h.nu >> 1); }
        return out;
      },
      diag() {
        const s = G.sim, p = s.pos, r = s.rest;
        let sum = 0, cnt = 0, max = 0, nan = false, sx = 0, hs = 0, hc = 0;
        for (let i = 0; i < s.n; i++) {
          if (s.w[i] === 0 || s.kind[i] !== 0) continue;
          const dx = p[i * 3] - r[i * 3], dy = p[i * 3 + 1] - r[i * 3 + 1], dz = p[i * 3 + 2] - r[i * 3 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d !== d) nan = true;
          sum += d; cnt++; sx += dx; if (d > max) max = d;
          if (G.hood && i >= G.hood.start) { hs += d; hc++; }
        }
        // nominal: against the thread's nominal length (the settled garment itself has threads at 1.46 around the neck seam);
        // strain: against the length each thread has in the settled garment, which is what "stretched" means to the eye
        let nominal = 0;
        for (let c = 0; c < s.nc; c++) {
          if (s.cGrp[c] !== 0 || s.cComp[c] > 1e-6 || s.cLen[c] < 0.015) continue;
          const a = s.cA[c] * 3, b = s.cB[c] * 3;
          const l = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]) / s.cLen[c];
          if (l > nominal) nominal = l;
        }
        return { mean: sum / cnt, max, strain: s.maxStrain(), nominal, nan, shiftX: sx / cnt, hood: hc ? hs / hc : 0 };
      },
    },
  };
}

