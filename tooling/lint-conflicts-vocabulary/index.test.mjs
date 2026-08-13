import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  findAssertionPhrase,
  findVerdictField,
  isDispositionAllowance,
  scanText,
  scanTrees,
  SELF_TEST,
  statesTheProhibition,
} from "./index.mjs";

// The fixture proof for the conflicts-vocabulary gate: every banned phrase FAILS, the disposition
// allowance PASSES, and the exemption marker is narrow. Without this, a scan whose patterns quietly
// stopped matching would read as a permanently green governance step — the failure mode the gate is
// built to prevent, arriving through the gate itself.

const SCRIPT = fileURLToPath(new URL("./index.mjs", import.meta.url));

const BANNED_LINES = [
  "This matter is conflict-free.",
  "The matter is conflict free.",
  "No conflicts were found for this matter.",
  "The client is clear of conflicts.",
  "All conflicts cleared for the engagement.",
  "The conflicts check passed.",
  "All clear on this one.",
  "No conflict found in the corpus.",
];

describe("assertion phrases", () => {
  it.each(BANNED_LINES)("rejects %j", (line) => {
    expect(findAssertionPhrase(line)).not.toBeNull();
  });

  it("passes prose that states only what the search did", () => {
    for (const line of [
      "Nothing surfaced.",
      "Searched on 13 August 2026 (UTC), trigger comprehensive.",
      "Not searched: content (no corpus exists).",
      "3 candidates surfaced for review (tier 1: 1, tier 4: 2).",
      "Two sources could not be searched.",
    ]) {
      expect(findAssertionPhrase(line)).toBeNull();
    }
  });
});

describe("the disposition allowance", () => {
  it("permits `cleared` as a disposition kind", () => {
    const lines = [
      'export const DISPOSITION_KINDS = ["cleared", "waiver_obtained"] as const;',
      "if (disposition.kind === 'cleared') return;",
      "kind: z.enum(DISPOSITION_KINDS),",
    ];
    for (const line of lines) expect(isDispositionAllowance(line)).toBe(true);
  });

  it("does not permit a bare sentence about a matter being cleared", () => {
    const line = "The matter was cleared of conflicts on 3 March.";
    expect(isDispositionAllowance(line)).toBe(false);
    expect(findAssertionPhrase(line)).not.toBeNull();
  });
});

describe("verdict-shaped fields", () => {
  it.each([
    ["  clear: z.boolean(),", "clear"],
    ["  readonly clean: boolean;", "clean"],
    ['  "ok": true,', "ok"],
    ["  passed: z.boolean(),", "passed"],
    ["  conflictFree: z.boolean(),", "conflictFree"],
    ["  conflict_free: integer('conflict_free'),", "conflict_free"],
  ])("rejects the declaration %j", (line, expected) => {
    expect(findVerdictField(line)?.toLowerCase()).toBe(expected.toLowerCase());
  });

  it("leaves an ordinary word alone", () => {
    for (const line of [
      "  clearTimeout(handle);",
      "  clearedAt: text('cleared_at'),",
      "  okayToRetry: z.boolean(),",
      "  neverChecked: z.boolean(),",
      "  passedAt: text('passed_at'),",
      "if (ok) return;",
    ]) {
      expect(findVerdictField(line)).toBeNull();
    }
  });

  it("has no escape hatch — the marker does not exempt a field", () => {
    const line = "  clear: z.boolean(), // conflicts-vocabulary:allow — reason";
    expect(statesTheProhibition(line)).toBe(true);
    expect(findVerdictField(line)).toBe("clear");
  });
});

describe("the prohibition marker", () => {
  it("exempts a line that states the rule", () => {
    const line =
      "// never report a matter as conflict-free (conflicts-vocabulary:allow — states the rule)";
    expect(scanText("probe.ts", line)).toEqual([]);
  });

  it("does not exempt an unmarked copy of the same sentence", () => {
    const offenders = scanText("probe.ts", "// never report a matter as conflict-free");
    expect(offenders).toHaveLength(1);
    expect(offenders[0].rule).toBe("assertion");
  });
});

describe("the scan's own self-test", () => {
  it("holds every row the script checks on each run", () => {
    for (const [line, expectedPhrase, expectedField] of SELF_TEST) {
      const phrase =
        isDispositionAllowance(line) || statesTheProhibition(line)
          ? null
          : findAssertionPhrase(line);
      if (expectedPhrase === null) expect(phrase, line).toBeNull();
      else expect(phrase?.toLowerCase(), line).toBe(expectedPhrase.toLowerCase());
      expect(findVerdictField(line), line).toBe(expectedField);
    }
  });

  it("is not vacuous — it carries rows that must fire and rows that must not", () => {
    expect(SELF_TEST.filter(([, phrase, field]) => phrase !== null || field !== null).length,
    ).toBeGreaterThan(5);
    expect(
      SELF_TEST.filter(([, phrase, field]) => phrase === null && field === null).length,
    ).toBeGreaterThan(5);
  });
});

// The end-to-end proof: the script, invoked the way the gate invokes it, exits non-zero on a tree that
// contains a violation and zero on one that does not. Asserting the exit code directly is the point —
// a governance step is only as good as the code it returns.
describe("the script as the gate runs it", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "conflicts-vocabulary-"));
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it("fails a tree containing a banned phrase", () => {
    writeFileSync(join(fixtureRoot, "offender.ts"), 'const label = "This matter is conflict-free";');
    const { offenders } = scanTrees(fixtureRoot, ["."]);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].rule).toBe("assertion");
  });

  it("exits 0 over the repository as it stands", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.stdout + result.stderr).toContain("Conflicts vocabulary clean");
    expect(result.status).toBe(0);
  });

  it("exits 1 when a scanned file breaks the rule", () => {
    const scratch = join(fixtureRoot, "in-tree-probe.ts");
    const conflictsPackageProbe = fileURLToPath(
      new URL("../../packages/conflicts/src/probe-conflicts-vocabulary.ts", import.meta.url),
    );
    writeFileSync(conflictsPackageProbe, 'export const label = "the matter is conflict-free";\n');
    try {
      const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("probe-conflicts-vocabulary.ts");
      expect(result.stderr).toContain("vocabulary violation(s) found");
    } finally {
      rmSync(conflictsPackageProbe, { force: true });
      rmSync(scratch, { force: true });
    }
  });
});
