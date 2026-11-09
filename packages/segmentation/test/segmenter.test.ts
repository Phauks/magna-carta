import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPersonSegmenter, ensureReady, SegmentationError } from "../src/index.ts";

// The same fixtures the crate's own reference test reads: one portrait at the model's input size and
// the mask Google's reference interpreter produced for it, a byte per pixel. Through the WebAssembly
// edge, the answer has to be the one the crate gives natively.
function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(`../../../crates/segmentation-core/tests/fixtures/${name}`, import.meta.url),
      ),
    ),
  );
}

beforeAll(async () => {
  await ensureReady(
    readFileSync(fileURLToPath(new URL("../src/pkg/segmentation_core_bg.wasm", import.meta.url))),
  );
});

describe("the person segmenter through the WebAssembly edge", () => {
  it("reports the model's input size", () => {
    const segmenter = loadPersonSegmenter();
    expect(segmenter.frame).toEqual({ width: 256, height: 144 });
    segmenter.release();
  });

  it("matches the reference mask on every pixel", () => {
    const segmenter = loadPersonSegmenter();
    const rgb = Float32Array.from(fixture("portrait-256x144.rgb"), (value) => value / 255);
    const reference = fixture("portrait-256x144.mask");
    const mask = segmenter.segment(rgb);
    expect(mask.length).toBe(reference.length);
    let disagreements = 0;
    let largest = 0;
    for (const [index, ours] of mask.entries()) {
      const theirs = (reference[index] ?? 0) / 255;
      largest = Math.max(largest, Math.abs(ours - theirs));
      if (ours > 0.5 !== theirs > 0.5) disagreements += 1;
    }
    expect(disagreements).toBe(0);
    expect(largest).toBeLessThanOrEqual(0.5 / 255 + 1e-4);
    segmenter.release();
  });

  it("refuses a frame of the wrong size with its code", () => {
    const segmenter = loadPersonSegmenter();
    let caught: unknown;
    try {
      segmenter.segment(new Float32Array(10));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SegmentationError);
    expect((caught as SegmentationError).code).toBe("frameSize");
    segmenter.release();
  });
});
