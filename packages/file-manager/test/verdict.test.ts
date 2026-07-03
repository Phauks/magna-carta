import { describe, expect, it } from "vitest";
import { computeVerdict, DEFAULT_SCAN_POLICY, ScanFaultError } from "../src/verdict.ts";
import type { RawScanResult } from "../src/scan-port.ts";

const base: RawScanResult = {
  engineVersion: "engine/1",
  clam: { state: "clean" },
  heuristic: { kind: "none" },
  matches: [],
  timings: { clamdMs: 1, yaraMs: 1 },
};

describe("computeVerdict (default policy = extended/75)", () => {
  it("clamd signature -> flagged with the signature", () => {
    expect(
      computeVerdict(
        { ...base, clam: { state: "infected", signature: "Eicar" } },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "Eicar" });
  });
  it("a high-confidence yara match in-tier -> flagged", () => {
    expect(
      computeVerdict(
        { ...base, matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }] },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "R" });
  });
  it("a suspicious match below the floor does NOT count", () => {
    expect(
      computeVerdict(
        { ...base, matches: [{ ruleId: "S", tier: "extended", score: 40, isSuspicious: true }] },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "clean", activeContent: false });
  });
  it("a full-only match is out of an extended policy's tier", () => {
    expect(
      computeVerdict(
        { ...base, matches: [{ ruleId: "F", tier: "full", score: 90, isSuspicious: false }] },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "clean", activeContent: false });
  });
  it("structural attack -> flagged", () => {
    expect(
      computeVerdict(
        { ...base, heuristic: { kind: "structural", reason: "decompression-bomb" } },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "decompression-bomb" });
  });
  it("encrypted -> unscanned/encrypted", () => {
    expect(
      computeVerdict({ ...base, heuristic: { kind: "encrypted" } }, DEFAULT_SCAN_POLICY),
    ).toEqual({ verdict: "unscanned", reason: "encrypted" });
  });
  it("no-engine (null version, unavailable) -> unscanned/no-engine", () => {
    expect(
      computeVerdict(
        { ...base, engineVersion: null, clam: { state: "unavailable" } },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "unscanned", reason: "no-engine" });
  });
  it("a DEPLOYED engine going unavailable throws (retry, never clean)", () => {
    expect(() =>
      computeVerdict({ ...base, clam: { state: "unavailable" } }, DEFAULT_SCAN_POLICY),
    ).toThrow(ScanFaultError);
  });
  it("active content rides a clean verdict", () => {
    expect(
      computeVerdict({ ...base, heuristic: { kind: "active-content" } }, DEFAULT_SCAN_POLICY),
    ).toEqual({ verdict: "clean", activeContent: true });
  });
});

// The precedence comment in verdict.ts calls the ordering "the behaviour-preservation core — do not
// reorder", but the single-signal cases above each fire in isolation and so cannot catch a reorder.
// These cross-signal cases pin the order itself. The load-bearing ones combine a definitive signal
// (clamd hit / counting match / structural / encrypted) with a DEPLOYED engine reporting unavailable:
// if the unavailable branch were moved above them it would throw ScanFaultError → retry → dead-letter
// instead of acting on the malware/encrypted fact, so each asserts the verdict (or non-throw) wins.
describe("computeVerdict — precedence ordering (do not reorder)", () => {
  it("a clamd signature outranks a counting YARA match (returns the signature, not the rule)", () => {
    expect(
      computeVerdict(
        {
          ...base,
          clam: { state: "infected", signature: "Eicar" },
          matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }],
        },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "Eicar" });
  });

  it("a counting YARA match outranks a structural heuristic (returns the rule, not the reason)", () => {
    expect(
      computeVerdict(
        {
          ...base,
          matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }],
          heuristic: { kind: "structural", reason: "decompression-bomb" },
        },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "R" });
  });

  it("a counting YARA match outranks clamd-unavailable: flags, never throws (deployed engine)", () => {
    expect(
      computeVerdict(
        {
          ...base,
          clam: { state: "unavailable" },
          matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }],
        },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "R" });
  });

  it("a structural heuristic outranks clamd-unavailable: flags, never throws (deployed engine)", () => {
    expect(
      computeVerdict(
        {
          ...base,
          clam: { state: "unavailable" },
          heuristic: { kind: "structural", reason: "archive-nesting" },
        },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "flagged", reason: "archive-nesting" });
  });

  it("encrypted outranks clamd-unavailable: unscanned/encrypted, never throws (deployed engine)", () => {
    expect(
      computeVerdict(
        { ...base, clam: { state: "unavailable" }, heuristic: { kind: "encrypted" } },
        DEFAULT_SCAN_POLICY,
      ),
    ).toEqual({ verdict: "unscanned", reason: "encrypted" });
  });
});
