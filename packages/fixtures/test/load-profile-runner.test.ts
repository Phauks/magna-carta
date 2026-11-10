import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  baselineEnvironment,
  explainStatement,
  findFullScans,
  percentile,
  runMeasurements,
  writeBaselineFile,
  type Measurement,
} from "../src/load-profile/runner.ts";

describe("load-profile measurement runner", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs warmup + timed iterations and reports ordered statistics", async () => {
    let calls = 0;
    const measurement: Measurement<null> = {
      name: "noop",
      operation: () => {
        calls += 1;
        return Promise.resolve();
      },
    };
    const [result] = await runMeasurements(null, [measurement], {
      warmupIterations: 2,
      iterations: 10,
    });
    expect(calls).toBe(12);
    expect(result!.name).toBe("noop");
    expect(result!.iterations).toBe(10);
    expect(result!.minMs).toBeLessThanOrEqual(result!.medianMs);
    expect(result!.medianMs).toBeLessThanOrEqual(result!.p95Ms);
  });

  it("selects deterministic percentile values from sorted samples", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 0.5)).toBe(5);
    expect(percentile(ten, 0.95)).toBe(10);
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([3, 9], 0.5)).toBe(3);
    expect(percentile([3, 9], 0.95)).toBe(9);
  });

  it("passes prepared per-iteration state to the operation, untimed", async () => {
    const prepared: number[] = [];
    const operated: number[] = [];
    let counter = 0;
    const measurement: Measurement<null, number> = {
      name: "stateful",
      prepare: () => {
        counter += 1;
        prepared.push(counter);
        return Promise.resolve(counter);
      },
      operation: (_handle, state) => {
        operated.push(state);
        return Promise.resolve();
      },
    };
    await runMeasurements(null, [measurement], { warmupIterations: 1, iterations: 3 });
    expect(prepared).toEqual([1, 2, 3, 4]);
    expect(operated).toEqual([1, 2, 3, 4]);
  });

  it("captures query plans and flags full scans, honoring the allowlist", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("CREATE TABLE scanned (id TEXT PRIMARY KEY, payload TEXT)");
    const scanning = explainStatement(raw, "SELECT payload FROM scanned WHERE payload = ?1", ["x"]);
    const indexed = explainStatement(raw, "SELECT payload FROM scanned WHERE id = ?1", ["x"]);
    expect(findFullScans([{ label: "by-payload", details: scanning }])).toEqual(["by-payload"]);
    expect(findFullScans([{ label: "by-id", details: indexed }])).toEqual([]);
    expect(findFullScans([{ label: "by-payload", details: scanning }], ["by-payload"])).toEqual([]);
    raw.close();
  });

  it("does not flag covering-index scans as full table scans", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("CREATE TABLE scanned (id TEXT PRIMARY KEY, payload TEXT)");
    raw.exec("CREATE INDEX scanned_payload ON scanned (payload)");
    const covering = explainStatement(raw, "SELECT payload FROM scanned ORDER BY payload", []);
    // Guard the premise: the plan must really walk the covering index, not the table.
    expect(covering.some((detail) => detail.includes("USING COVERING INDEX"))).toBe(true);
    expect(findFullScans([{ label: "covering", details: covering }])).toEqual([]);
    raw.close();
  });

  it("flags a full-text table read with no match, and not one answered from its term index", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("CREATE VIRTUAL TABLE words USING fts5(body)");
    // Both read `SCAN`: the word says how SQLite drives a virtual table, not what the table does.
    const matched = explainStatement(raw, "SELECT rowid FROM words WHERE words MATCH ?1", ["x"]);
    const unmatched = explainStatement(raw, "SELECT rowid FROM words WHERE body = ?1", ["x"]);
    expect(matched.every((detail) => detail.startsWith("SCAN"))).toBe(true);
    expect(unmatched.every((detail) => detail.startsWith("SCAN"))).toBe(true);
    expect(findFullScans([{ label: "matched", details: matched }])).toEqual([]);
    expect(findFullScans([{ label: "unmatched", details: unmatched }])).toEqual(["unmatched"]);
    raw.close();
  });

  it("writes a stable, human-diffable baseline file", () => {
    const directory = mkdtempSync(join(tmpdir(), "mc-baseline-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "baseline.json");
    writeBaselineFile(path, {
      profileName: "ledgerVolume",
      profileVersion: 1,
      cacheKey: "abc123",
      environment: baselineEnvironment(),
      results: [
        { name: "zeta", iterations: 5, minMs: 1, medianMs: 2, p95Ms: 3 },
        { name: "alpha", iterations: 5, minMs: 1, medianMs: 2, p95Ms: 3 },
      ],
      bounds: [
        { name: "omega", statementCount: 2, rowsRead: 4, sourcesRead: 2, entriesReturned: 3 },
        { name: "beta", statementCount: 1, rowsRead: 2, sourcesRead: 1, entriesReturned: 2 },
      ],
    });
    const written = JSON.parse(readFileSync(path, "utf8")) as {
      environment: { nodeVersion: string; cpuCount: number };
      results: { name: string }[];
      bounds: { name: string }[];
    };
    // Results and bounds are sorted by name so re-measuring yields minimal diffs.
    expect(written.results.map((result) => result.name)).toEqual(["alpha", "zeta"]);
    expect(written.bounds.map((bound) => bound.name)).toEqual(["beta", "omega"]);
    // The machine is on the file, because the numbers above only mean something next to it: two
    // baselines from two machines are not comparable, and without this a reader cannot tell.
    expect(written.environment.nodeVersion).toBe(process.version);
    expect(written.environment.cpuCount).toBeGreaterThan(0);
  });
});
