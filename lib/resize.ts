// Makes the pre-sized copies of a picture in the browser, at the moment the owner chooses the file.
// Pictures are resized here (upload time), never when a page is viewed.
export const PICTURE_WIDTHS = [480, 960, 1600] as const;

export interface ResizedPicture {
  copies: { width: number; blob: Blob }[]; // width = the size label (480 / 960 / 1600)
  w: number;                               // real pixel width of the largest copy
  h: number;                               // real pixel height of the largest copy
}

type Source = { width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void };

async function openImage(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); // respects the phone's EXIF rotation
    } catch {
      try { bmp = await createImageBitmap(file); } catch { bmp = null; }
    }
    if (bmp) {
      const b = bmp;
      return { width: b.width, height: b.height, draw: (ctx, w, h) => ctx.drawImage(b, 0, 0, w, h), close: () => b.close() };
    }
  }
  // Older browsers: an <img> element (modern engines apply EXIF orientation to it by default).
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("not_an_image"));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Draws the chosen file to a canvas and returns webp copies 480 / 960 / 1600 wide.
 *  Never upscales: sizes wider than the source are skipped, except the smallest, which is always made
 *  (at the source's own width when the source is narrower than 480). Throws Error("not_an_image"). */
export async function resizePicture(file: Blob, widths: readonly number[] = PICTURE_WIDTHS): Promise<ResizedPicture> {
  let src: Source;
  try { src = await openImage(file); } catch { throw new Error("not_an_image"); }
  if (!src.width || !src.height) { src.close(); throw new Error("not_an_image"); }
  try {
    const sorted = [...widths].sort((a, b) => a - b);
    const wanted = sorted.filter((w, i) => i === 0 || w <= src.width);
    const copies: { width: number; blob: Blob }[] = [];
    let w = 0, h = 0;
    for (const label of wanted) {
      const cw = Math.min(label, src.width);
      const ch = Math.max(1, Math.round((src.height * cw) / src.width));
      const canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("not_an_image");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      src.draw(ctx, cw, ch);
      let blob = await toBlob(canvas, "image/webp", 0.84);
      // A browser that cannot write webp answers with a PNG: use a JPEG instead (far smaller for photographs;
      // browsers read pictures by their content, so it still displays).
      if (!blob || blob.type !== "image/webp") blob = (await toBlob(canvas, "image/jpeg", 0.86)) ?? blob;
      canvas.width = 0; canvas.height = 0;
      if (!blob) throw new Error("not_an_image");
      copies.push({ width: label, blob });
      w = cw; h = ch;
    }
    return { copies, w, h };
  } finally {
    src.close();
  }
}
