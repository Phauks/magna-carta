import { describe, expect, it } from "vitest";
import type { DetectionInput, RawDetection } from "../src/port.ts";
import {
  bandForScore,
  caveatsFor,
  LOW_VENDOR_CONFIDENCE_MAX,
  MIN_RELIABLE_CHARACTERS,
  normalize,
  reliabilityFor,
} from "../src/normalize.ts";

const FIRM = "firm_test" as DetectionInput["firmId"];
const LONG = "a".repeat(400); // over MIN_RELIABLE_CHARACTERS

function input(over: Partial<DetectionInput> = {}): DetectionInput {
  return { text: LONG, firmId: FIRM, ...over };
}
function raw(over: Partial<RawDetection> = {}): RawDetection {
  return { score: 0.9, ...over };
}
const METADATA = {
  adapterId: "deferred",
  detectedAt: "2026-06-28T00:00:00.000Z",
  egressedTo: "test-vendor",
};

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
  it("returns inconclusive for NaN", () => {
    expect(bandForScore(NaN)).toBe("inconclusive");
  });
  it("returns inconclusive for Infinity", () => {
    expect(bandForScore(Infinity)).toBe("inconclusive");
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
  it("does not flag an empty-string language hint", () => {
    expect(caveatsFor(input({ languageHint: "" }), raw())).not.toContain("non-target-language");
  });
  it("does not flag an uppercase English hint (EN)", () => {
    expect(caveatsFor(input({ languageHint: "EN" }), raw())).not.toContain("non-target-language");
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
  it("is low for each accuracy-collapse caveat", () => {
    const collapseCaveats = [
      "text-too-short",
      "non-target-language",
      "possible-paraphrase-or-humanization",
      "mixed-or-edited-authorship",
    ] as const;
    for (const caveat of collapseCaveats) {
      expect(reliabilityFor([caveat]), `expected ${caveat} to be fatal`).toBe("low");
    }
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
    expect(report.provenance.egressedTo).toBe("test-vendor");
  });

  it("forces the headline band to inconclusive when reliability is low", () => {
    // A vendor 'likely' verdict on a 9-char snippet must NOT assert a direction.
    const report = normalize(input({ text: "too short" }), raw({ score: 0.99 }), METADATA);
    expect(report.reliability).toBe("low");
    expect(report.band).toBe("inconclusive");
    expect(report.caveats).toContain("text-too-short");
  });

  it("forces inconclusive for non-English text (accuracy-collapse vector)", () => {
    const report = normalize(input({ languageHint: "es" }), raw({ score: 0.92 }), METADATA);
    expect(report.band).toBe("inconclusive");
    expect(report.reliability).toBe("low");
  });

  it("forces inconclusive for suspected paraphrase/humanization (accuracy-collapse vector)", () => {
    const report = normalize(
      input(),
      raw({ score: 0.92, signals: { paraphraseSuspected: true } }),
      METADATA,
    );
    expect(report.band).toBe("inconclusive");
    expect(report.reliability).toBe("low");
  });

  it("forces inconclusive for mixed authorship (accuracy-collapse vector)", () => {
    const report = normalize(
      input(),
      raw({ score: 0.05, signals: { mixedAuthorship: true } }),
      METADATA,
    );
    expect(report.band).toBe("inconclusive");
    expect(report.reliability).toBe("low");
  });

  it("maps vendor segments to banded segment scores (high reliability, score-derived band)", () => {
    const report = normalize(
      input({ languageHint: "en" }),
      raw({ score: 0.5, segments: [{ startCharacter: 0, endCharacter: 50, score: 0.95 }] }),
      METADATA,
    );
    expect(report.segments).toEqual([
      { startCharacter: 0, endCharacter: 50, score: 0.95, band: "likely" },
    ]);
  });

  it("segment bands inherit the reliability override (low reliability → all segments inconclusive)", () => {
    // Short text → reliability low → headline AND segment bands both forced to inconclusive.
    const report = normalize(
      input({ text: "too short" }),
      raw({ score: 0.5, segments: [{ startCharacter: 0, endCharacter: 9, score: 0.95 }] }),
      METADATA,
    );
    expect(report.reliability).toBe("low");
    expect(report.segments).toEqual([
      { startCharacter: 0, endCharacter: 9, score: 0.95, band: "inconclusive" },
    ]);
  });

  it("records the external service that saw the text", () => {
    const report = normalize(input({ languageHint: "en" }), raw(), {
      ...METADATA,
      egressedTo: "example-vendor",
    });
    expect(report.provenance.egressedTo).toBe("example-vendor");
    expect(report.provenance.adapterId).toBe("deferred");
  });

  it("omits segments entirely when the raw detection has none", () => {
    const report = normalize(input({ languageHint: "en" }), raw(), METADATA);
    expect(report.segments).toBeUndefined();
  });

  it("returns an empty segments array when raw segments is []", () => {
    const report = normalize(input({ languageHint: "en" }), raw({ segments: [] }), METADATA);
    expect(report.segments).toEqual([]);
  });

  it("boundary: text of exactly MIN_RELIABLE_CHARACTERS is NOT flagged text-too-short", () => {
    const text = "a".repeat(MIN_RELIABLE_CHARACTERS);
    expect(caveatsFor(input({ text }), raw())).not.toContain("text-too-short");
  });

  it("boundary: text of MIN_RELIABLE_CHARACTERS - 1 IS flagged text-too-short", () => {
    const text = "a".repeat(MIN_RELIABLE_CHARACTERS - 1);
    expect(caveatsFor(input({ text }), raw())).toContain("text-too-short");
  });

  it("boundary: vendorConfidence === LOW_VENDOR_CONFIDENCE_MAX IS flagged low-vendor-confidence", () => {
    expect(caveatsFor(input(), raw({ vendorConfidence: LOW_VENDOR_CONFIDENCE_MAX }))).toContain(
      "low-vendor-confidence",
    );
  });

  it("boundary: vendorConfidence just above LOW_VENDOR_CONFIDENCE_MAX is NOT flagged", () => {
    expect(
      caveatsFor(input(), raw({ vendorConfidence: LOW_VENDOR_CONFIDENCE_MAX + 0.01 })),
    ).not.toContain("low-vendor-confidence");
  });

  it("passes through vendorModel and vendorVersion when present", () => {
    const report = normalize(
      input({ languageHint: "en" }),
      raw({ vendorModel: "acme-detect-v2", vendorVersion: "2024-11", score: 0.85 }),
      METADATA,
    );
    expect(report.provenance.vendorModel).toBe("acme-detect-v2");
    expect(report.provenance.vendorVersion).toBe("2024-11");
  });

  it("omits vendorModel and vendorVersion keys when absent", () => {
    const report = normalize(input({ languageHint: "en" }), raw(), METADATA);
    expect("vendorModel" in report.provenance).toBe(false);
    expect("vendorVersion" in report.provenance).toBe(false);
  });
});
