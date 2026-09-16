/*
 * The immutability rules, driven against the three things that can happen to a deployed migration:
 * it is edited, it is taken away, or it is retired behind a baseline the runtime already reconciles.
 *
 * The runner beside this reads `main` out of git; these are the judgements it makes once it has.
 */
import { describe, expect, it } from "vitest";
import type { AllowedChange } from "./allowed-changes.mts";
import { immutabilityViolations } from "./immutability.mts";

const DEPLOYED = new Map([
  ["20260704T041516_baseline", "CREATE TABLE matter (id text PRIMARY KEY NOT NULL);\n"],
  ["20260914T120000_task-rungs", "ALTER TABLE task ADD COLUMN rung text;\n"],
]);

const NO_BASELINES: ReadonlySet<string> = new Set();
const NO_ALLOWANCES: readonly AllowedChange[] = [];

describe("immutabilityViolations", () => {
  it("passes a lineage that only gained migrations", () => {
    const current = new Map(DEPLOYED);
    current.set("20260915T180000_matter-notes", "CREATE TABLE matter_note (id text);\n");
    expect(
      immutabilityViolations(
        "per-firm",
        { deployed: DEPLOYED, current, reconciledByRuntime: NO_BASELINES },
        NO_ALLOWANCES,
      ),
    ).toEqual([]);
  });

  it("refuses an edit to a migration that has deployed", () => {
    const current = new Map(DEPLOYED);
    current.set("20260914T120000_task-rungs", "ALTER TABLE task ADD COLUMN rung text NOT NULL;\n");
    const violations = immutabilityViolations(
      "per-firm",
      { deployed: DEPLOYED, current, reconciledByRuntime: NO_BASELINES },
      NO_ALLOWANCES,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("the SQL behind 20260914T120000_task-rungs has changed");
  });

  it("refuses a rename, which reads as a removal from the ledger's point of view", () => {
    const current = new Map([
      ["20260704T041516_baseline", DEPLOYED.get("20260704T041516_baseline")!],
    ]);
    current.set("20260916T090000_task-rungs", "ALTER TABLE task ADD COLUMN rung text;\n");
    const violations = immutabilityViolations(
      "per-firm",
      { deployed: DEPLOYED, current, reconciledByRuntime: NO_BASELINES },
      NO_ALLOWANCES,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("20260914T120000_task-rungs is on main");
    expect(violations[0]).toContain("no longer contains it");
  });

  it("allows a retirement the runtime reconciles to a baseline", () => {
    // A baseline collapse is not an exception and needs no allowance entry: LEGACY_BASELINES already
    // teaches the runner to rewrite those ledger rows, and recording it twice would let the two
    // disagree.
    const current = new Map([
      ["20260916T000000_baseline", "-- the collapsed chain, as one migration\n"],
    ]);
    expect(
      immutabilityViolations(
        "per-firm",
        {
          deployed: DEPLOYED,
          current,
          reconciledByRuntime: new Set(DEPLOYED.keys()),
        },
        NO_ALLOWANCES,
      ),
    ).toEqual([]);
  });

  it("allows a recorded change, and only for the lineage it names", () => {
    const current = new Map(DEPLOYED);
    current.delete("20260914T120000_task-rungs");
    const allowance: AllowedChange = {
      lineage: "per-firm",
      tag: "20260914T120000_task-rungs",
      replacedBy: "20260916T090000_task-rungs",
      why: "no firm onboarded; both pools empty and recreatable",
      recorded: "2026-09-15",
    };
    expect(
      immutabilityViolations(
        "per-firm",
        { deployed: DEPLOYED, current, reconciledByRuntime: NO_BASELINES },
        [allowance],
      ),
    ).toEqual([]);
    // The same tag allowed on the OTHER lineage must not excuse it here — the two lineages are
    // separate databases and an allowance is a statement about one of them.
    expect(
      immutabilityViolations(
        "per-firm",
        { deployed: DEPLOYED, current, reconciledByRuntime: NO_BASELINES },
        [{ ...allowance, lineage: "control-plane" }],
      ),
    ).toHaveLength(1);
  });

  it("does not report a line-ending difference as an edit", () => {
    // An alarm that is never right is one people learn to ignore. The repository pins LF, but a
    // checkout configured otherwise would otherwise flag every migration in the lineage.
    const current = new Map(
      [...DEPLOYED].map(([tag, sql]) => [tag, sql.replace(/\n/gu, "\r\n")] as const),
    );
    expect(
      immutabilityViolations(
        "per-firm",
        { deployed: DEPLOYED, current: new Map(current), reconciledByRuntime: NO_BASELINES },
        NO_ALLOWANCES,
      ),
    ).toEqual([]);
  });
});
