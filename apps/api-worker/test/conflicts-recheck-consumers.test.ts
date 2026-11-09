import { describe, expect, it } from "vitest";
import { CONFLICTS_PERSONNEL_TOPIC } from "@magna-carta/conflicts/recheck-cause";
import { CONFLICTS_RECHECK_REQUESTED_TOPIC } from "@magna-carta/conflicts/topics";
import { parseRecheckRunPayload } from "../src/background/conflicts/recheck-run-consumer.ts";

// The worker half of the automated re-check path: the two consumers, the context they run under, and
// the periodic re-scan. Everything here is either a SOURCE SCAN (for the rules that cannot be tested
// behaviourally) or a pure parse — the consumers' behaviour against a real database is proved in
// @magna-carta/conflicts, where the domain logic they call lives.
//
// The scan reads sources through import.meta.glob with ?raw rather than node:fs: these tests run
// inside workerd, which has no filesystem, so the files are inlined as text at build time. The same
// idiom the billing fitness scans use.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const WORKER_SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function sourceOf(suffix: string): string {
  const key = Object.keys(WORKER_SOURCES).find((path) => path.endsWith(suffix));
  // A missing file is a failure, not an empty scan. Every allowlist-shaped fitness function has the
  // same failure mode: the thing it names gets renamed, the scan passes over nothing, and the rule it
  // was holding quietly stops being held.
  if (key === undefined) throw new Error(`no worker source matched ${suffix}`);
  return WORKER_SOURCES[key]!;
}

function conflictsModulePaths(): string[] {
  return Object.keys(WORKER_SOURCES).filter(
    (path) => path.includes("/src/conflicts/") || path.includes("/src/background/conflicts/"),
  );
}

// An import of the disposition module by any spelling — the package export, a relative file, a
// dynamic import — plus a direct call of the writer, which catches a re-export laundering it.
const DISPOSITION_REACH =
  /(from\s+["'][^"']*disposition(\.ts)?["'])|(import\s*\(\s*["'][^"']*disposition)|(\brecordDisposition\s*\()/;

describe("the automated re-check consumers", () => {
  it("record no conclusion — no module here reaches the disposition writer", () => {
    // A run nobody asked for, under nobody's authority, writing a row that names a member as having
    // concluded something is the one failure this subsystem cannot recover from. The rule survives
    // review easily and dies in a refactor just as easily, so it is enforced on the source text.
    const offenders = conflictsModulePaths().filter((path) =>
      DISPOSITION_REACH.test(WORKER_SOURCES[path]!),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps request and run apart — the request consumer never runs a check", () => {
    // Separate consumers so a slow check cannot back-pressure the recording of causes; the recording
    // is what makes staleness visible and has to keep up with the write path. An import here would
    // collapse them back into one and the back-pressure would return silently.
    const source = sourceOf("/src/background/conflicts/recheck-request-consumer.ts");
    // An import of the check orchestrator, or a call of it. Naming it in a comment that states the
    // rule is not a violation of the rule — a scan that cannot tell those apart is a scan people
    // work around by deleting the comment.
    expect(/from\s+["'][^"']*run-check["']/.test(source)).toBe(false);
    expect(/\brunConflictsCheck\s*\(/.test(source)).toBe(false);
  });

  it("scans modules that exist, so a move cannot silently empty this test", () => {
    const scanned = conflictsModulePaths();
    expect(scanned.some((path) => path.endsWith("recheck-request-consumer.ts"))).toBe(true);
    expect(scanned.some((path) => path.endsWith("recheck-run-consumer.ts"))).toBe(true);
    expect(scanned.some((path) => path.endsWith("periodic-rescan.ts"))).toBe(true);
  });
});

describe("the drain signal", () => {
  it("carries the matter and nothing else", () => {
    // The run consumer re-reads the matter's open ledger rows when it gets there, so a message that
    // arrives twice, late, or after the backstop already drained the matter resolves to the truth in
    // the table rather than to whatever was true when it was written. That is only safe because the
    // message carries no cause list of its own.
    expect(parseRecheckRunPayload('{"matterId":"matter_one"}')).toEqual({ matterId: "matter_one" });
  });

  it("resolves an unusable payload to null rather than throwing", () => {
    // A payload that will never parse can only march a permanent error to the dead-letter queue if it
    // throws. Returning null lets the consumer ack it and count the drop.
    expect(parseRecheckRunPayload("not json")).toBeNull();
    expect(parseRecheckRunPayload('{"matterId":42}')).toBeNull();
    expect(parseRecheckRunPayload("{}")).toBeNull();
  });
});

describe("the producers and their subscribers share one spelling", () => {
  it("pins the personnel topic the member-provision mirror emits", () => {
    // The producer is a worker consumer rather than a domain package, so there is no package constant
    // for the resolver to import — this pins the two together instead. An unrecognized topic on the
    // per-firm bus is acked and ignored by design, so a drift here does not throw, it just stops
    // delivering, which is the failure this assertion exists to catch.
    expect(sourceOf("/src/background/member-provision-consumer.ts")).toContain(
      "CONFLICTS_PERSONNEL_TOPIC",
    );
    expect(CONFLICTS_PERSONNEL_TOPIC).toBe("member.provisioned");
  });

  it("registers the drain signal on the per-firm dispatch table", () => {
    expect(sourceOf("/src/background/costs/recoverable-charge-consumer.ts")).toContain(
      "CONFLICTS_RECHECK_REQUESTED_TOPIC",
    );
    expect(CONFLICTS_RECHECK_REQUESTED_TOPIC).toBe("conflicts.recheck.requested");
  });
});
