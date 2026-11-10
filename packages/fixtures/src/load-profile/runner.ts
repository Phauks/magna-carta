import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import type { DatabaseSync } from "node:sqlite";

// THE SANCTIONED WALL-CLOCK READ. The fixtures determinism rule bans wall-clock reads in DATA
// generation; the runner only OBSERVES — timing samples never feed generated rows.
// performance.now() is monotonic, which Date.now() is not (NTP steps would corrupt samples).
const nowMs = (): number => performance.now();

export interface Measurement<Handle, State = undefined> {
  readonly name: string;
  // Untimed per-iteration setup (e.g. post the entry a reverse-entry measurement consumes —
  // an entry cannot be reversed twice, so each iteration needs a fresh one).
  readonly prepare?: (handle: Handle) => Promise<State>;
  readonly operation: (handle: Handle, state: State) => Promise<void>;
}

export interface MeasurementResult {
  readonly name: string;
  readonly iterations: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
}

export interface RunnerOptions {
  readonly warmupIterations: number;
  readonly iterations: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

// Exported for direct verification in tests.
export function percentile(sortedSamples: readonly number[], fraction: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(fraction * sortedSamples.length) - 1),
  );
  return sortedSamples[index]!;
}

// The runner-side view of a measurement. Any Measurement<Handle, State> assigns to this
// regardless of State: prepare's result widens covariantly to unknown, and operation's state
// parameter narrows contravariantly from never. The runner pairs each prepare with its own
// operation in the same iteration, so the cast at the call site below is structurally sound.
export interface RunnableMeasurement<Handle> {
  readonly name: string;
  readonly prepare?: (handle: Handle) => Promise<unknown>;
  readonly operation: (handle: Handle, state: never) => Promise<void>;
}

// Warmup + timed iterations → min/median/p95. Numbers are RELATIVE — local node:sqlite is not
// production D1; they decide regressions, growth curves, and plan shapes, never absolute
// latencies.
export async function runMeasurements<Handle>(
  handle: Handle,
  measurements: readonly RunnableMeasurement<Handle>[],
  options: RunnerOptions,
): Promise<MeasurementResult[]> {
  const results: MeasurementResult[] = [];
  for (const measurement of measurements) {
    const samples: number[] = [];
    const total = options.warmupIterations + options.iterations;
    for (let iteration = 0; iteration < total; iteration += 1) {
      const state = measurement.prepare ? await measurement.prepare(handle) : undefined;
      const startedMs = nowMs();
      await measurement.operation(handle, state as never);
      const elapsedMs = nowMs() - startedMs;
      if (iteration >= options.warmupIterations) samples.push(elapsedMs);
    }
    samples.sort((left, right) => left - right);
    results.push({
      name: measurement.name,
      iterations: options.iterations,
      minMs: round(samples[0]!),
      medianMs: round(percentile(samples, 0.5)),
      p95Ms: round(percentile(samples, 0.95)),
    });
  }
  return results;
}

export interface QueryPlanRow {
  readonly detail: string;
}

export interface LabeledPlan {
  readonly label: string;
  readonly details: readonly string[];
}

// EXPLAIN QUERY PLAN for one statement. Plan shape is timing-noise-free: it catches missing
// indexes and N+1 patterns structurally (golden rule 10's mechanical no-N+1 detector).
export function explainStatement(
  raw: DatabaseSync,
  sql: string,
  bindings: readonly unknown[],
): string[] {
  const rows = raw
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(bindings as never[])) as unknown as QueryPlanRow[];
  return rows.map((row) => row.detail);
}

// A full table scan reads `SCAN <table>` with NO `USING` clause. Anything with `USING` is an
// index walk — `SCAN <table> USING COVERING INDEX <index>` (covering-index walk, efficient) and
// `SEARCH <table> USING INDEX <index>` / `USING INTEGER PRIMARY KEY` must not be flagged.
// Table-wide aggregates (the fitness queries) scan by nature — allowlist them by label.
//
// A VIRTUAL TABLE always reads `SCAN`, because the word describes how SQLite drives it and not what
// the table does inside. What says whether the read is narrowed is the index string after the
// colon, which the table itself writes: a full-text table asked a `MATCH` reports its constraints
// there (`VIRTUAL TABLE INDEX 0:M3`) and is answering from its term index, while one read with no
// constraint at all reports nothing (`VIRTUAL TABLE INDEX 0:`) and is reading every row. Only the
// second is a full scan.
export function isFullScan(detail: string): boolean {
  if (!detail.startsWith("SCAN")) return false;
  const virtualTable = / VIRTUAL TABLE INDEX \d+:(.*)$/u.exec(detail);
  if (virtualTable !== null) return virtualTable[1] === "";
  return !detail.includes(" USING ");
}

export function findFullScans(
  plans: readonly LabeledPlan[],
  allowlist: readonly string[] = [],
): string[] {
  return plans
    .filter((plan) => !allowlist.includes(plan.label))
    .filter((plan) => plan.details.some(isFullScan))
    .map((plan) => plan.label);
}

// A keyset-paginated list whose filter and (created_at, id) sort are both served by one index reads
// `SEARCH … USING INDEX …` with NO sort step. If SQLite cannot serve ORDER BY from an index it
// materializes the rows and sorts them — the plan carries `USE TEMP B-TREE FOR ORDER BY`. That
// defeats keyset pagination at volume, so the list hot paths must never show it. Returns the labels
// of any plan that does, so a future sort regression (a dropped or reordered covering index) fails
// the smoke instead of silently degrading.
export function findTempBtreeSorts(plans: readonly LabeledPlan[]): string[] {
  return plans
    .filter((plan) =>
      plan.details.some((detail) => detail.includes("USE TEMP B-TREE FOR ORDER BY")),
    )
    .map((plan) => plan.label);
}

// The machine the numbers came off. Timings here are RELATIVE — they decide regressions and growth
// curves on ONE machine and mean nothing across two — so the file has to be able to say which machine
// it is, or a reader diffing two baselines cannot tell a regression from a different laptop.
export interface BaselineEnvironment {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
}

export function baselineEnvironment(): BaselineEnvironment {
  const processors = cpus();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: processors[0]?.model.trim() ?? "unknown",
    cpuCount: processors.length,
    totalMemoryBytes: totalmem(),
  };
}

// A count a read produced, rather than a time it took. Statements issued and rows read are the
// witnesses a timing cannot be: a per-row lookup added inside a projection changes neither any single
// statement's plan nor, at a small corpus, any measurable duration — but it changes these.
export interface MeasuredBound {
  readonly name: string;
  readonly statementCount: number;
  readonly rowsRead: number;
  readonly sourcesRead: number;
  readonly entriesReturned: number;
  // Counts a bound reports that are none of the four above — a per-channel breakdown, a corpus size.
  // Named rather than folded into one of the fixed fields, because a reader diffing two baselines has
  // to be able to tell what a number IS, and a count filed under a field it does not mean is worse
  // than no count at all.
  readonly counts?: Readonly<Record<string, number>>;
}

export interface BaselineFile {
  readonly profileName: string;
  readonly profileVersion: number;
  readonly cacheKey: string;
  readonly environment: BaselineEnvironment;
  readonly results: readonly MeasurementResult[];
  readonly bounds?: readonly MeasuredBound[];
}

// Small, sorted, committed, human-diffed — never CI-gated in this slice.
export function writeBaselineFile(path: string, baseline: BaselineFile): void {
  const sorted: BaselineFile = {
    ...baseline,
    results: [...baseline.results].sort((left, right) => left.name.localeCompare(right.name)),
    bounds:
      baseline.bounds === undefined
        ? undefined
        : [...baseline.bounds].sort((left, right) => left.name.localeCompare(right.name)),
  };
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}
