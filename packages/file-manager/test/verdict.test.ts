import { describe, expect, it } from "vitest";
import {
  coarseScanReason,
  computeVerdict,
  DEFAULT_SCAN_POLICY,
  SCAN_REASONS,
  ScanFaultError,
  scanDetailFor,
} from "../src/verdict.ts";
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

describe("scanDetailFor", () => {
  // One home for what a committing verdict writes into `scan_detail`. It exists because there were
  // two: the file path badged a clean-with-active-content version and the template path wrote null
  // for every clean verdict, so the same bytes were recorded differently depending on which door
  // they came through — and templates are the door that matters most, being what a firm runs against
  // privileged data.
  it("badges a clean verdict whose bytes still carry executable content", () => {
    expect(scanDetailFor({ verdict: "clean", activeContent: true })).toBe("active-content");
  });

  it("writes nothing for a clean verdict with nothing to say about it", () => {
    expect(scanDetailFor({ verdict: "clean", activeContent: false })).toBeNull();
  });

  it("carries the reason a version went uninspected", () => {
    expect(scanDetailFor({ verdict: "unscanned", reason: "encrypted" })).toBe("encrypted");
    expect(scanDetailFor({ verdict: "unscanned", reason: "no-engine" })).toBe("no-engine");
  });

  it("carries a flagged reason for the caller that records one anyway", () => {
    expect(scanDetailFor({ verdict: "flagged", reason: "Eicar-Test-Signature" })).toBe(
      "Eicar-Test-Signature",
    );
  });
});

describe("coarseScanReason — what a read surface may say about a scan", () => {
  it("collapses an engine-supplied signature name to the one closed token", () => {
    // The exposure this exists to close: quarantineVersion persists `scanDetail ?? reason`, and a
    // malware quarantine passes the signature, so the column holds text the platform never authored.
    expect(coarseScanReason(null, "quarantined", "Win.Trojan.Fake-1234")).toEqual({
      scanReason: "scan-flagged",
      activeContent: false,
    });
    expect(coarseScanReason("flagged", "clean", "Eicar-Test-Signature")).toEqual({
      scanReason: "scan-flagged",
      activeContent: false,
    });
  });

  it("reports every platform-authored token unchanged", () => {
    for (const token of SCAN_REASONS) {
      expect(coarseScanReason(null, "quarantined", token)).toEqual({
        scanReason: token,
        activeContent: false,
      });
    }
  });

  it("reports active content as the badge it is, not as a reason the file was refused", () => {
    expect(coarseScanReason("clean", "clean", "active-content")).toEqual({
      scanReason: null,
      activeContent: true,
    });
  });

  it("keeps the prefix of a composed withdrawal detail and drops what the engine added", () => {
    expect(coarseScanReason(null, "quarantined", "content-drift: Win.Trojan.Fake-1234")).toEqual({
      scanReason: "content-drift",
      activeContent: false,
    });
    expect(
      coarseScanReason(null, "quarantined", "content-unverifiable: replacement bytes not scanned"),
    ).toEqual({ scanReason: "content-unverifiable", activeContent: false });
  });

  it("says nothing about a row that is neither flagged nor quarantined", () => {
    // An unrecognized detail on a clean, unflagged row is not evidence of anything, and answering
    // "scan-flagged" there would invent an alarm the platform cannot substantiate.
    expect(coarseScanReason("clean", "clean", "seeded sample text")).toEqual({
      scanReason: null,
      activeContent: false,
    });
    expect(coarseScanReason(null, "clean", null)).toEqual({
      scanReason: null,
      activeContent: false,
    });
  });

  it("never returns a string outside the closed vocabulary", () => {
    const details = [
      null,
      "active-content",
      "oversize",
      "Win.Trojan.Fake-1234",
      "content-drift: anything at all",
      "YARA_rule_name_with_free_text",
      "Rejected by the malware scan (seeded quarantined sample).",
    ];
    for (const detail of details) {
      for (const status of ["clean", "pending", "quarantined"] as const) {
        const { scanReason } = coarseScanReason("flagged", status, detail);
        expect(
          scanReason === null || (SCAN_REASONS as readonly string[]).includes(scanReason),
        ).toBe(true);
      }
    }
  });
});
