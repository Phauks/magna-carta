import { describe, expect, it } from "vitest";
import type { DetectionInput, RawDetection } from "../src/port.ts";
import { bandForScore, caveatsFor, normalize, reliabilityFor } from "../src/normalize.ts";

const FIRM = "firm_test" as DetectionInput["firmId"];
const LONG = "a".repeat(400); // over MIN_RELIABLE_CHARS

function input(over: Partial<DetectionInput> = {}): DetectionInput {
  return { text: LONG, firmId: FIRM, ...over };
}
function raw(over: Partial<RawDetection> = {}): RawDetection {
  return { score: 0.9, ...over };
}
const METADATA = { adapterId: "deferred", detectedAt: "2026-06-28T00:00:00.000Z" };

describe("bandForScore", () => {
  it("maps low scores to unlikely", () => {
    expect(bandForScore(0.1)).toBe("unlikely");
  });
  it("maps mid scores to mixed", () => {
    expect(bandForScore(0.5)).toBe("mixed");
  });
  it("maps high scores to likely", () => {
    expect(bandForScore(0.95)).toBe("likely");
  });
  it("treats UNLIKELY_MAX (0.2) as exclusive of unlikely", () => {
    expect(bandForScore(0.2)).toBe("mixed");
  });
  it("treats LIKELY_MIN (0.8) as inclusive of likely", () => {
    expect(bandForScore(0.8)).toBe("likely");
  });
});

describe("caveatsFor", () => {
  it("flags short text", () => {
    expect(caveatsFor(input({ text: "too short" }), raw())).toContain("text-too-short");
  });
  it("flags non-English language hints", () => {
    expect(caveatsFor(input({ languageHint: "fr-FR" }), raw())).toContain("non-target-language");
  });
  it("accepts English language hints without the language caveat", () => {
    expect(caveatsFor(input({ languageHint: "en-US" }), raw())).not.toContain(
      "non-target-language",
    );
  });
  it("flags low vendor confidence", () => {
    expect(caveatsFor(input(), raw({ vendorConfidence: 0.3 }))).toContain("low-vendor-confidence");
  });
  it("flags suspected paraphrase and mixed authorship from vendor signals", () => {
    const result = caveatsFor(
      input(),
      raw({ signals: { paraphraseSuspected: true, mixedAuthorship: true } }),
    );
    expect(result).toContain("possible-paraphrase-or-humanization");
    expect(result).toContain("mixed-or-edited-authorship");
  });
  it("returns no caveats for clean long English input", () => {
    expect(caveatsFor(input({ languageHint: "en" }), raw())).toEqual([]);
  });
});

describe("reliabilityFor", () => {
  it("is high with no caveats", () => {
    expect(reliabilityFor([])).toBe("high");
  });
  it("is low when text is too short", () => {
    expect(reliabilityFor(["text-too-short"])).toBe("low");
  });
  it("is low on low vendor confidence", () => {
    expect(reliabilityFor(["low-vendor-confidence"])).toBe("low");
  });
  it("is moderate for a non-fatal caveat", () => {
    expect(reliabilityFor(["non-target-language"])).toBe("moderate");
  });
});

describe("normalize", () => {
  it("produces a full report for clean high-score input", () => {
    const report = normalize(input({ languageHint: "en" }), raw({ score: 0.92 }), METADATA);
    expect(report.band).toBe("likely");
    expect(report.reliability).toBe("high");
    expect(report.caveats).toEqual([]);
    expect(report.score).toBe(0.92);
    expect(report.provenance.adapterId).toBe("deferred");
    expect(report.provenance.detectedAt).toBe("2026-06-28T00:00:00.000Z");
  });

  it("forces the headline band to inconclusive when reliability is low", () => {
    // A vendor 'likely' verdict on a 9-char snippet must NOT assert a direction.
    const report = normalize(input({ text: "too short" }), raw({ score: 0.99 }), METADATA);
    expect(report.reliability).toBe("low");
    expect(report.band).toBe("inconclusive");
    expect(report.caveats).toContain("text-too-short");
  });

  it("maps vendor segments to banded segment scores", () => {
    const report = normalize(
      input({ languageHint: "en" }),
      raw({ score: 0.5, segments: [{ startChar: 0, endChar: 50, score: 0.95 }] }),
      METADATA,
    );
    expect(report.segments).toEqual([{ startChar: 0, endChar: 50, score: 0.95, band: "likely" }]);
  });

  it("records the external service that saw the text", () => {
    const report = normalize(input({ languageHint: "en" }), raw(), {
      ...METADATA,
      egressedTo: "example-vendor",
    });
    expect(report.provenance.egressedTo).toBe("example-vendor");
  });

  it("keeps the score-derived band when reliability is only moderate", () => {
    // A non-English hint yields a non-fatal caveat → moderate reliability, which must NOT
    // be forced to inconclusive; the high score still reads as 'likely'.
    const report = normalize(input({ languageHint: "zh-CN" }), raw({ score: 0.92 }), METADATA);
    expect(report.reliability).toBe("moderate");
    expect(report.band).toBe("likely");
  });

  it("omits segments entirely when the raw detection has none", () => {
    const report = normalize(input({ languageHint: "en" }), raw(), METADATA);
    expect(report.segments).toBeUndefined();
  });
});
