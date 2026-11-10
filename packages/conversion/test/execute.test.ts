import { describe, expect, it } from "vitest";
import type { ConversionEdge } from "../src/format.ts";
import { type ConversionPort, adapterError, converted } from "../src/port.ts";
import { executePath, runConversion } from "../src/execute.ts";
import { makeImage } from "./support/vips.ts";
// Side-effect import: registers the libvips engine so runConversion's default resolver finds it.
import "../src/adapters/libvips/index.ts";

function makePng(): Promise<Uint8Array> {
  return makeImage(".png");
}

describe("executePath", () => {
  it("threads each hop's output bytes into the next and returns the final result", async () => {
    const calls: string[] = [];
    // A fake engine: appends the target's first char as a byte, reports application/<to>.
    const fake: ConversionPort = {
      convert(input) {
        calls.push(`${input.from}->${input.to}@${input.bytes.join(",")}`);
        const out = new Uint8Array([...input.bytes, input.to.charCodeAt(0)]);
        return Promise.resolve(converted(out, `application/${input.to}`));
      },
    };
    const path: ConversionEdge[] = [
      { from: "a", to: "b", engineId: "libvips", recipeRef: "b", weight: 1 },
      { from: "b", to: "c", engineId: "libvips", recipeRef: "c", weight: 1 },
    ];

    const result = await executePath(path, new Uint8Array([1]), () => fake);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mediaType).toBe("application/c");
      expect([...result.bytes]).toEqual([1, "b".charCodeAt(0), "c".charCodeAt(0)]);
    }
    // The second hop received the first hop's output (threading), and order is preserved.
    expect(calls).toEqual([`a->b@1`, `b->c@1,${"b".charCodeAt(0)}`]);
  });

  it("stops at the first failing hop and returns that failure", async () => {
    let secondHopRan = false;
    const fail: ConversionPort = {
      convert(input) {
        if (input.from === "a") return Promise.resolve(adapterError("boom"));
        secondHopRan = true;
        return Promise.resolve(converted(input.bytes, "x"));
      },
    };
    const path: ConversionEdge[] = [
      { from: "a", to: "b", engineId: "transcode", recipeRef: "b", weight: 1 },
      { from: "b", to: "c", engineId: "transcode", recipeRef: "c", weight: 1 },
    ];

    const result = await executePath(path, new Uint8Array([0]), () => fail);

    expect(result).toEqual({ ok: false, reason: "adapter-error", detail: "boom" });
    expect(secondHopRan).toBe(false);
  });
});

describe("runConversion", () => {
  it("runs a real single-hop libvips conversion (png -> webp)", async () => {
    const png = await makePng();
    const result = await runConversion("png", "webp", png);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mediaType).toBe("image/webp");
      expect(result.bytes[0]).toBe(0x52); // 'R' (RIFF/WebP)
    }
  });

  it("returns unsupported-edge when no path exists", async () => {
    const result = await runConversion("png", "mp4", new Uint8Array([0]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-edge");
  });

  it("returns engine-not-implemented when the direct path needs a deferred engine", async () => {
    const result = await runConversion("docx", "pdf", new Uint8Array([0]));
    expect(result).toEqual({ ok: false, reason: "engine-not-implemented" });
  });

  it("returns engine-not-implemented at the first deferred hop of a multi-hop path (wpd->odt->pdf)", async () => {
    const result = await runConversion("wpd", "pdf", new Uint8Array([0]));
    expect(result).toEqual({ ok: false, reason: "engine-not-implemented" });
  });
});
