/*
 * The arithmetic of a replaced or blurred background, apart from any browser: turning a small camera
 * frame into what the segmentation model reads, steadying the mask it answers from one frame to the
 * next, fitting a chosen picture to the camera's shape, and the two shaders that draw the result.
 *
 * Kept free of `self`, `document` and WebGL objects so it runs under a unit test. The worker in
 * background-effects.worker.ts is the only thing that calls it per frame.
 */

/** What the room's background is doing, as the worker draws it. */
export type BackgroundMode = "none" | "blur" | "image";

/**
 * Fill `out` with the model's input from a canvas's RGBA bytes: red, green and blue in 0 to 1,
 * row-major, alpha dropped. `out` is reused across frames, so nothing is allocated thirty times a
 * second.
 */
export function toModelInput(rgba: Uint8ClampedArray, out: Float32Array): void {
  const pixels = out.length / 3;
  if (rgba.length < pixels * 4) {
    throw new RangeError("the frame is smaller than the model input");
  }
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const from = pixel * 4;
    const to = pixel * 3;
    out[to] = (rgba[from] ?? 0) / 255;
    out[to + 1] = (rgba[from + 1] ?? 0) / 255;
    out[to + 2] = (rgba[from + 2] ?? 0) / 255;
  }
}

/**
 * How much of the previous mask each new one keeps. A mask taken fresh every frame shimmers at the
 * edge of somebody's hair, because the model's answer for a pixel that is half person moves a little
 * with sensor noise. Keeping a share of the last answer steadies that edge; keeping too much drags a
 * ghost behind a hand that moves. A third is the point where neither is noticeable at thirty frames
 * a second.
 */
export const MASK_PERSISTENCE = 1 / 3;

/**
 * Blend a new mask into the running one and write it as bytes for the GPU.
 *
 * `running` holds the steadied mask between frames and is updated in place. A running mask of a
 * different length (the first frame) simply takes the new one.
 */
export function steadyMask(
  running: Float32Array,
  next: Float32Array,
  bytes: Uint8Array,
  first: boolean,
): void {
  const keep = first ? 0 : MASK_PERSISTENCE;
  const take = 1 - keep;
  for (let index = 0; index < next.length; index += 1) {
    const value = (running[index] ?? 0) * keep + (next[index] ?? 0) * take;
    running[index] = value;
    bytes[index] = Math.round(Math.min(1, Math.max(0, value)) * 255);
  }
}

/**
 * Where a picture is read from so that it fills the camera's frame without being stretched: scale
 * and offset applied to the frame's texture coordinates, as `[scaleX, scaleY, offsetX, offsetY]`.
 *
 * The picture is cropped evenly on whichever side is too long, the way a photograph is trimmed to fit
 * a frame. A picture the same shape as the camera is read whole.
 */
export function coverFit(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): readonly [number, number, number, number] {
  if (imageWidth <= 0 || imageHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return [1, 1, 0, 0];
  }
  const imageShape = imageWidth / imageHeight;
  const frameShape = frameWidth / frameHeight;
  if (imageShape > frameShape) {
    // The picture is wider than the frame: read a centred band of its width.
    const scale = frameShape / imageShape;
    return [scale, 1, (1 - scale) / 2, 0];
  }
  // The picture is taller than the frame (or the same shape): read a centred band of its height.
  const scale = imageShape / frameShape;
  return [1, scale, 0, (1 - scale) / 2];
}

/** The mode as the fragment shader reads it. */
export function modeCode(mode: BackgroundMode): number {
  if (mode === "blur") return 1;
  if (mode === "image") return 2;
  return 0;
}

/**
 * One triangle that covers the whole canvas. Texture coordinates run from the TOP left, which is
 * the order a camera frame, a picture and the mask are all uploaded in, so nothing is flipped.
 */
export const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 frameCoordinate;
void main() {
  frameCoordinate = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * The composite: the person from the camera frame, over either a blurred copy of the room or the
 * chosen picture, mixed by the mask.
 *
 * THE BLUR DOES NOT BLUR THE PERSON INTO THE ROOM. Each tap of the blur is weighted by how much of
 * the room it sampled, so the outline of somebody's shoulders does not spread into a halo around
 * them. Taps are read from a low level of the frame's mipmap chain, which is what lets eighteen taps
 * look like a wide blur.
 */
export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D cameraFrame;
uniform sampler2D personMask;
uniform sampler2D backgroundImage;
uniform int mode;
uniform vec4 imageFit;
uniform vec2 blurReach;
in vec2 frameCoordinate;
out vec4 colour;

float personAt(vec2 at) {
  return smoothstep(0.3, 0.7, texture(personMask, at).r);
}

vec3 blurredRoom(vec2 at) {
  vec3 total = vec3(0.0);
  float weight = 0.0;
  for (int ring = 1; ring <= 2; ring++) {
    for (int step = 0; step < 9; step++) {
      float angle = float(step) * 0.6981317;
      vec2 offset = vec2(cos(angle), sin(angle)) * blurReach * float(ring);
      vec2 tap = clamp(at + offset, vec2(0.0), vec2(1.0));
      float room = 1.0 - personAt(tap) + 0.001;
      total += textureLod(cameraFrame, tap, 4.0).rgb * room;
      weight += room;
    }
  }
  return total / weight;
}

void main() {
  vec4 camera = texture(cameraFrame, frameCoordinate);
  if (mode == 0) {
    colour = camera;
    return;
  }
  float person = personAt(frameCoordinate);
  vec3 room;
  if (mode == 1) {
    room = blurredRoom(frameCoordinate);
  } else {
    room = texture(backgroundImage, frameCoordinate * imageFit.xy + imageFit.zw).rgb;
  }
  colour = vec4(mix(room, camera.rgb, person), 1.0);
}
`;
