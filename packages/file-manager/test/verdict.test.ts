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
