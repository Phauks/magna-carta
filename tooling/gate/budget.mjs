// How long a gate step is given before it is treated as not finishing at all.
//
// THE FAILURE THIS EXISTS FOR. A check that never returns is indistinguishable, from the outside, from
// a check that is merely slow. There is no error, no exit code, no file named — only a command that has
// not come back, which reads as a tired machine. In September 2026 a single character in one
// seventy-line source file (a literal U+FFFD in a used, u-flagged regex, which the linter's analysis
// never terminates on) made the whole-repository lint unrunnable. It was diagnosed five separate times
// as container uptime, and the gate of record stayed unrunnable end to end for six days while every
// scoped check stayed green — because the scoped check lints the diff, and nothing had touched that
// file since it landed. The cost was never the character. It was that nothing said which step was
// running when the machine went quiet.
//
// WHY THE NUMBERS ARE GENEROUS. What is being caught does not terminate at all, so ANY finite budget
// detects it; the budget's size only decides how long you wait for the answer. The one way this
// mechanism can be actively harmful is by firing on an honest slow step — that would make the gate lie
// in the other direction, and it would teach people to reach for `--skip`, which is worse than not
// having the timeout. So every budget below is set well past the slowest legitimate run of that
// dimension on the slowest machine anybody runs it on, and there is a scale knob for when that is still
// not enough.

// PER STEP, not per dimension. The step is what hangs and the step is what can be named, so the
// budget is applied to each step a dimension runs; a dimension of seven steps can therefore legitimately
// take longer in total than its number here. Capping the dimension instead would kill honest work in a
// long dimension to catch a hang in one of its steps, and would report the dimension rather than the
// step — losing exactly the fact that makes the report useful.

/** Minutes per step, by the dimension the step belongs to. A dimension not named here takes the default. */
export const DIMENSION_BUDGET_MINUTES = {
  // Measured in seconds on ordinary hardware; the ceiling is for a cold cache on a slow disk.
  format: 20,
  // Fifty-odd lint scripts plus the repo-wide fitness sweep, run concurrently.
  governance: 30,
  // Network-bound: fetching the pinned scanner and the advisory database, either of which can crawl.
  audit: 15,
  // Rust to WebAssembly from cold, which is a real compile rather than a cache read.
  wasm: 30,
  // tsc -b over both solutions plus two svelte-check passes over four thousand files.
  typecheck: 30,
  // Four regenerate-and-diff round trips.
  contracts: 20,
  // The whole repository is ~30s warm here. The ceiling is for cold, and for a much slower machine.
  lint: 30,
  // cargo fmt, clippy and test from an empty target directory.
  rust: 60,
  // Docker image builds plus an acceptance suite, per changed container.
  containers: 90,
  "test-collection": 20,
  // Deliberately the same 90 minutes the test runner's single-flight lock already treats as past the
  // slowest full run (tooling/test-single-flight/lock.mjs). Two numbers that answer the same question
  // should not disagree.
  tests: 90,
};

/** For a dimension with no entry above — a new one arrives budgeted rather than unbounded. */
export const DEFAULT_BUDGET_MINUTES = 30;

/** The environment variable that scales every budget, for a machine slower than any of these assume. */
export const SCALE_VARIABLE = "MAGNA_CARTA_GATE_TIMEOUT_SCALE";

/**
 * Read the scale from the environment. Returns a positive multiplier, or `null` when timeouts are
 * switched off entirely.
 *
 * A mistyped value THROWS rather than falling back to 1. Someone who writes `SCALE=1O` (letter O) has
 * told us they believe the budgets are now ten times larger; silently running the original budgets
 * would fail their step and blame their code for it.
 */
export function resolveScale(value) {
  if (value === undefined || value === "") return 1;
  const text = String(value).trim().toLowerCase();
  if (text === "off" || text === "none" || text === "0") return null;
  const scale = Number(text);
  if (!Number.isFinite(scale) || scale < 0) {
    throw new Error(
      `${SCALE_VARIABLE}=${String(value)} is not a positive number. Use a multiplier such as 2, or "off" to remove the budgets entirely.`,
    );
  }
  return scale;
}

/**
 * The budget for one dimension, in milliseconds, or `null` when timeouts are off.
 *
 * Off is a real answer and not a failure mode: a profiling run, or a machine so slow the scale knob is
 * the wrong tool, is better served by an unbounded gate than by a gate that kills honest work.
 */
export function budgetFor(dimension, { scale = 1 } = {}) {
  if (scale === null) return null;
  const minutes = DIMENSION_BUDGET_MINUTES[dimension] ?? DEFAULT_BUDGET_MINUTES;
  return Math.round(minutes * scale * 60 * 1000);
}

/** How a budget is said out loud, for the message a timeout prints. */
export function describeBudget(milliseconds) {
  const minutes = milliseconds / 60000;
  return minutes >= 1
    ? `${String(Math.round(minutes))} min`
    : `${String(Math.round(milliseconds / 1000))}s`;
}
