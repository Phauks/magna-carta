/*
 * The arithmetic behind cropping a record's picture to a square: how large the image is drawn, how
 * far it may be dragged, and which part of the original the saved square is cut from.
 *
 * The picture is shown in a square frame and always covers it. At zoom 1 its shorter side fits the
 * frame exactly; zooming in enlarges it about the frame's centre; dragging moves it, never so far
 * that an edge of the image shows inside the frame. What the frame shows is what is saved. Kept pure
 * so the rule can be asserted without a canvas.
 */

/** The image's own size, in its pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** How far the picture has been dragged from centred, in frame pixels. */
export interface CropOffset {
  readonly x: number;
  readonly y: number;
}

export const MINIMUM_ZOOM = 1;
export const MAXIMUM_ZOOM = 4;
/** One press of Zoom In or Zoom Out. */
export const ZOOM_STEP = 0.25;
/** The side of the saved square, in pixels: sharp at every size the picture is drawn at. */
export const SAVED_PHOTO_SIDE = 512;

/** How many frame pixels one image pixel takes at this zoom. */
export function cropScale(image: ImageSize, frame: number, zoom: number): number {
  return Math.max(frame / image.width, frame / image.height) * zoom;
}

/** A zoom kept inside the range the controls offer. */
export function clampZoom(zoom: number): number {
  return Math.min(MAXIMUM_ZOOM, Math.max(MINIMUM_ZOOM, zoom));
}

/** An offset pulled back so the image still covers the frame. */
export function clampOffset(
  image: ImageSize,
  frame: number,
  zoom: number,
  offset: CropOffset,
): CropOffset {
  const scale = cropScale(image, frame, zoom);
  const slackX = Math.max(0, (image.width * scale - frame) / 2);
  const slackY = Math.max(0, (image.height * scale - frame) / 2);
  // `+ 0` folds a negative zero into zero, so a centred picture compares equal to the origin.
  return {
    x: Math.min(slackX, Math.max(-slackX, offset.x)) + 0,
    y: Math.min(slackY, Math.max(-slackY, offset.y)) + 0,
  };
}

/** The square of the original image the frame shows, in image pixels. */
export interface CropSource {
  readonly x: number;
  readonly y: number;
  readonly side: number;
}

export function cropSource(
  image: ImageSize,
  frame: number,
  zoom: number,
  offset: CropOffset,
): CropSource {
  const scale = cropScale(image, frame, zoom);
  const clamped = clampOffset(image, frame, zoom, offset);
  const side = frame / scale;
  return {
    x: (image.width - side) / 2 - clamped.x / scale,
    y: (image.height - side) / 2 - clamped.y / scale,
    side,
  };
}
