import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, loadNoiseSuppressor, NoiseSuppressionError } from "../src/index.ts";

// The real engine through the WebAssembly edge, held to what the crate's own tests hold it to natively.
beforeAll(async () => {
  await ensureReady(
    readFileSync(
      fileURLToPath(new URL("../src/pkg/noise_suppression_core_bg.wasm", import.meta.url)),
    ),
  );
});

/** Low steady noise from a fixed sequence, the shape of a fan or a road: the same every run. */
function rumble(frames: number, samples: number, amplitude: number): Float32Array[] {
  let state = 7;
  let smoothed = 0;
  return Array.from({ length: frames }, () =>
    Float32Array.from({ length: samples }, () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const white = ((state >>> 8) / 2 ** 24) * 2 - 1;
      smoothed = 0.95 * smoothed + 0.05 * white;
      return amplitude * smoothed * 6;
    }),
  );
}

function energy(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return sum / samples.length;
}

describe("the noise suppressor through the WebAssembly edge", () => {
  it("works on 10 ms frames at 48 kHz", () => {
    const suppressor = loadNoiseSuppressor();
    expect(suppressor.frameSamples).toBe(480);
    suppressor.release();
  });

  it("takes a steady rumble out", () => {
    const suppressor = loadNoiseSuppressor();
    const output = new Float32Array(suppressor.frameSamples);
    let kept = 0;
    let heard = 0;
    for (const [index, frame] of rumble(400, suppressor.frameSamples, 0.03).entries()) {
      suppressor.process(frame, output);
      if (index >= 200) {
        kept += energy(output);
        heard += energy(frame);
      }
    }
    expect(kept).toBeLessThan(heard * 0.05);
    suppressor.release();
  });

  it("refuses a frame of the wrong length with its code alone", () => {
    const suppressor = loadNoiseSuppressor();
    expect(() => suppressor.process(new Float32Array(10), new Float32Array(480))).toThrow(
      new NoiseSuppressionError("frameLength"),
    );
    suppressor.release();
  });
});
