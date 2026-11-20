/*
 * The screenshot a problem report carries: a picture of the screen behind the report dialog, with
 * whatever the sender covered painted out on this device before anything is sent.
 *
 * TAKEN AS THE DIALOG OPENS, WITHOUT THE DIALOG. The page is drawn to a canvas from its own DOM
 * (modern-screenshot, in the browser, no native code), skipping every dialog and overlay, so the
 * picture shows the screen the person was looking at when they pressed Report a Problem.
 *
 * COVERED MEANS GONE. A cover is painted into the pixels of the copy that is uploaded, not laid over
 * it, so nothing under a cover leaves the device. The uncovered original stays in memory only for
 * as long as the dialog is open.
 */
import { domToCanvas } from "modern-screenshot";

/** A rectangle the sender dragged over the picture, in the picture's own pixels. */
export interface Cover {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The largest picture the server keeps. A larger PNG is sent as a JPEG instead. */
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

/**
 * True for a node the picture must not include: a dialog, the shade behind one, or a menu or tooltip
 * still closing from the click that opened the dialog.
 */
function isDialogLayer(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  const role = node.getAttribute("role");
  return (
    role === "dialog" ||
    role === "alertdialog" ||
    role === "menu" ||
    role === "tooltip" ||
    node.hasAttribute("data-dialog-overlay") ||
    node.hasAttribute("data-dialog-content") ||
    node.hasAttribute("data-alert-dialog-overlay") ||
    node.hasAttribute("data-alert-dialog-content")
  );
}

/**
 * The screen as it stands, without any dialog, or null where the browser cannot draw it. Never
 * throws: a report without a picture is still a report.
 */
export async function captureScreen(): Promise<HTMLCanvasElement | null> {
  try {
    return await domToCanvas(document.body, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      filter: (node) => !isDialogLayer(node),
    });
  } catch {
    return null;
  }
}

/** The colour covers are painted in: the darkest text colour the theme defines. */
export function coverColour(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--mc-text-default")
    .trim();
  return value === "" ? "black" : value;
}

/** Draws the picture with its covers painted in, onto a canvas of the picture's own size. */
export function paintCovered(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  covers: readonly Cover[],
): void {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d");
  if (context === null) return;
  context.drawImage(source, 0, 0);
  context.fillStyle = coverColour();
  for (const cover of covers) context.fillRect(cover.x, cover.y, cover.width, cover.height);
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // In slices: a spread of a few megabytes of arguments would exceed the engine's call limit.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/**
 * The covered picture as base64, ready to upload: a PNG where it fits, a JPEG where it does not,
 * or null where neither fits under the server's limit.
 */
export async function coveredScreenshotBase64(
  source: HTMLCanvasElement,
  covers: readonly Cover[],
): Promise<string | null> {
  const painted = document.createElement("canvas");
  paintCovered(painted, source, covers);
  const png = await blobOf(painted, "image/png");
  if (png !== null && png.size <= MAX_SCREENSHOT_BYTES) return base64Of(png);
  const jpeg = await blobOf(painted, "image/jpeg", 0.85);
  if (jpeg !== null && jpeg.size <= MAX_SCREENSHOT_BYTES) return base64Of(jpeg);
  return null;
}

/** A dragged rectangle from two corners, in either order, clamped to the picture. */
export function coverBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: { width: number; height: number },
): Cover {
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit);
  const left = clamp(Math.min(start.x, end.x), bounds.width);
  const top = clamp(Math.min(start.y, end.y), bounds.height);
  const right = clamp(Math.max(start.x, end.x), bounds.width);
  const bottom = clamp(Math.max(start.y, end.y), bounds.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
