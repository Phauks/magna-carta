/*
 * Turning a typed name, a drawing or an uploaded picture into the PNG a signer adopts.
 *
 * THE INK IS THE DOCUMENT'S, NOT THE INTERFACE'S. A mark is stamped onto a white page, so it is drawn
 * in a dark ink read from the palette's fixed primitives rather than the theme's text colour, which
 * would be pale in a dark theme and vanish on paper. The background stays transparent.
 *
 * EVERY MARK IS TRIMMED TO ITS INK and kept to a bounded size, so what is sent is the mark and not a
 * wide empty canvas, and a large photograph cannot become a large upload.
 */

/** The largest mark the server takes, in bytes before encoding. */
export const MAXIMUM_MARK_BYTES = 200_000;

/** The widest and tallest a mark is kept at, in pixels. */
const MARK_WIDTH = 900;
const MARK_HEIGHT = 300;

/** The typed styles offered, as the CSS custom property of the face each one uses. */
export const TYPED_STYLES = [
  { key: "display", face: "--mc-font-display", label: "Serif" },
  { key: "sans", face: "--mc-font-sans", label: "Plain" },
] as const;

export type TypedStyle = (typeof TYPED_STYLES)[number]["key"];

/** The ink every mark is drawn in: a fixed dark blue from the palette's primitives. */
export function inkColour(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--mc-color-blue-900")
    .trim();
  return value === "" ? "black" : value;
}

function faceOf(style: TypedStyle): string {
  const property = TYPED_STYLES.find((entry) => entry.key === style)?.face ?? "--mc-font-display";
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return value === "" ? "serif" : value;
}

/** The CSS font a typed style is previewed in, so the preview and the PNG agree. */
export function typedFontFamily(style: TypedStyle): string {
  return faceOf(style);
}

/** The canvas cut down to the box that holds ink, with a little margin; null when it is blank. */
export function trimmedToInk(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const margin = 4;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out
    .getContext("2d")
    ?.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** The canvas as base64 PNG with no data-URL prefix, or null when it is over the size the server takes. */
export function pngBase64(canvas: HTMLCanvasElement): string | null {
  const encoded = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/u, "");
  return Math.floor((encoded.length * 3) / 4) > MAXIMUM_MARK_BYTES ? null : encoded;
}

/** A typed name drawn in a style, trimmed; null when there is nothing to draw. */
export async function typedMark(
  text: string,
  style: TypedStyle,
): Promise<HTMLCanvasElement | null> {
  if (text.trim() === "") return null;
  const family = faceOf(style);
  const font = `italic 400 120px ${family}`;
  try {
    await document.fonts.load(font, text);
  } catch {
    // The fallback face draws it instead; a mark is still made.
  }
  const canvas = document.createElement("canvas");
  canvas.width = MARK_WIDTH * 2;
  canvas.height = MARK_HEIGHT;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.font = font;
  context.fillStyle = inkColour();
  context.textBaseline = "middle";
  context.fillText(text.trim(), 20, MARK_HEIGHT / 2, MARK_WIDTH * 2 - 40);
  return trimmedToInk(canvas);
}

/** An uploaded picture, scaled to fit, with near-white made transparent so it sits on the page. */
export async function uploadedMark(file: File): Promise<HTMLCanvasElement | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, MARK_WIDTH / bitmap.width, MARK_HEIGHT / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const lightest = Math.min(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0);
    if (lightest > 225) data[index + 3] = 0;
  }
  context.putImageData(image, 0, 0);
  return trimmedToInk(canvas);
}
