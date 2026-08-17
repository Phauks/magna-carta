// The decisions behind `lint:test-collection`, as pure functions over already-collected data. The
// spawning half — four list-only runs of the test runner — lives in index.mjs.
//
// They are separated because the arithmetic is the part that can be wrong in a way nobody notices.
// This lint exists to PROVE the gate's test jobs cover the suite, and a proof whose own reasoning is
// unexercised is worth what the belief it replaced was worth: the workflow comment that claimed a
// mis-scoped path "fails loud" was confidently written, reviewed, and false for months. So every
// assertion below is driven from constructed inputs in collection.test.mjs — each one is shown to
// bite on the failure it names, and to stay quiet on the shapes that are legitimately fine.

/** Whitespace-insensitive, so a YAML folded block (`run: >-`) matches the single-line form. */
export const collapse = (text) => text.replaceAll(/\s+/g, " ").trim();

/**
 * Drop whole-line YAML comments before reading the workflow as a set of commands. The workflow is
 * heavily commented, and several of those comments quote the invocations they explain — counting or
 * matching against them would make a paragraph of prose look like a test job. Only lines whose first
 * non-space character is `#` are removed: an inline trailing comment stays, because stripping those
 * needs a YAML parse to tell a comment from a `#` inside a quoted string.
 */
export const withoutComments = (text) =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

/**
 * The invocations this lint holds verbatim, checked against the workflow that is supposed to run
 * them. Returns a message per invocation that no longer appears — editing one without the other is
 * the drift this catches.
 */
export function driftedInvocations(workflowText, invocations) {
  const workflow = collapse(withoutComments(workflowText));
  return invocations
    .filter((invocation) => !workflow.includes(collapse(invocation.command)))
    .map(
      (invocation) =>
        `  ${invocation.job}: this lint's copy of the invocation is not present in ` +
        `.github/workflows/gate.yml. The two must agree — update whichever is wrong.\n` +
        `    expected: ${collapse(invocation.command)}`,
    );
}

/** The marker every test-runner invocation in the workflow starts with. */
const RUNNER_MARKER = "pnpm exec vp test";

/**
 * The drift check above proves each invocation this lint knows about still exists. It cannot see the
 * other direction: a FOURTH test job added to the workflow and never registered here would collect a
 * share of the suite that the partition check silently attributes to nobody, and the lint would keep
 * reporting a sound split. So count the runner invocations in the workflow and require the two to
 * agree — the same closed-list discipline the project registry in vite.config.ts uses, for the same
 * reason: a list somebody has to remember to extend is a list that eventually is not extended.
 */
export function unregisteredInvocations(workflowText, invocations) {
  const found = collapse(withoutComments(workflowText)).split(RUNNER_MARKER).length - 1;
  if (found === invocations.length) return [];
  return [
    `  .github/workflows/gate.yml contains ${found} "${RUNNER_MARKER}" invocation(s), but this lint ` +
      `holds ${invocations.length}. A test job this lint does not know about takes a share of the ` +
      `suite that the coverage check below then credits to nobody — register it in GATE_INVOCATIONS, ` +
      `or remove the stale entry.`,
  ];
}

/**
 * Turn a workflow command into the argument list for a list-only run of the same selection: drop the
 * `pnpm exec vp test run` prefix, drop the shard split (`--shard=i/N` partitions whatever the rest of
 * the arguments collected, so it never changes WHICH files are in the set), unquote, and resolve
 * `$PWD` to this checkout the way the workflow's shell resolves it to the runner's.
 */
export function listArgumentsFor(command, root) {
  return (
    command
      // Collapse the workflow expressions first, so the shard argument stays a single whitespace-free
      // token and cannot leave `matrix.shard` behind as a stray positional filter.
      .replaceAll(/\$\{\{[^}]*\}\}/g, "0")
      .split(/\s+/)
      .slice(5)
      .filter((token) => !token.startsWith("--shard="))
      // Dequote the way the workflow's shell does. Quotes appear both around a whole token
      // ("$PWD/packages") and inside one (--project='!storybook'), and no argument here legitimately
      // contains a quote character, so stripping them all is the faithful reading.
      .map((token) => token.replaceAll(/["']/g, ""))
      .map((token) => token.replaceAll("$PWD", root.replace(/[/\\]$/, "")))
  );
}

/**
 * The same command, resolved into something a human can paste and run. `test-node` carries FOURTEEN
 * positional paths and the workflow wraps them across five indented YAML lines, which is exactly the
 * shape that gets hand-copied short — and a short path list does not fail, it silently runs a subset
 * and reports a confident green (the same property that made the original mis-scoped filter invisible).
 * A truncation after the tenth path drops apps/{recovery,scan,search,sign}-worker: 7 files and 41
 * tests, which then reads as the gate collecting 7 fewer files than this lint asserts. Printing the
 * invocations means nobody has to retype them to reproduce a count.
 */
export function runnableCommand(command, root) {
  return (
    command
      .replaceAll(/\$\{\{[^}]*\}\}/g, "0")
      .replaceAll(/\s+/g, " ")
      .split(" ")
      // Drop the shard split rather than printing `--shard=0/0`, which is not a runnable spelling. The
      // whole-job count is what a reconciliation wants anyway: one shard's count is not the job's.
      .filter((token) => !token.startsWith("--shard="))
      .join(" ")
      // Quotes are KEPT — the printed form is meant to be pasted, and an unquoted path breaks the
      // moment a checkout lives under a directory with a space in it.
      .replaceAll("$PWD", root.replace(/[/\\]$/, ""))
      .trim()
  );
}

/**
 * Key a collected entry on the repo-relative path PLUS the project that claimed it, so the same file
 * registered by two projects counts as two entries and every diagnostic names something actionable.
 */
export function specificationKey(entry, normalizedRoot) {
  return `${entry.file.replaceAll("\\", "/").replace(normalizedRoot, "")} [${entry.projectName}]`;
}

/**
 * The three properties the gate's split must have, given the unfiltered whole-suite collection and a
 * Map of job name -> Set of specification keys.
 *
 *   1. the whole-suite collection clears the committed floor — a config change that silently drops
 *      whole swathes of the suite fails loudly instead of speeding CI up;
 *   2. the union of the jobs equals that collection — no registered file runs nowhere;
 *   3. the jobs are pairwise disjoint — no file is paid for twice.
 *
 * Returns a list of human-readable failures; empty means the split is sound.
 */
export function reconcile({ wholeSuite, collected, floor }) {
  const failures = [];

  if (wholeSuite.size < floor) {
    failures.push(
      `  the whole-suite invocation collected ${wholeSuite.size} test files, below the committed floor ` +
        `of ${floor}. Either whole suites stopped resolving (find out which — that is the ` +
        `failure this floor exists for), or suites were deliberately removed and the floor in ` +
        `tooling/lint-test-collection/index.mjs needs lowering, with a reason.`,
    );
  }

  const union = new Set();
  const duplicates = [];
  for (const [job, files] of collected) {
    for (const file of files) {
      if (union.has(file)) duplicates.push(`${file} — also collected by ${job}`);
      union.add(file);
    }
  }

  const uncovered = [...wholeSuite]
    .filter((file) => !union.has(file))
    .sort((left, right) => left.localeCompare(right));
  if (uncovered.length > 0) {
    failures.push(
      `  ${uncovered.length} registered test file(s) are collected by NO gate job — they run nowhere, and ` +
        `nothing else fails on their absence. Add their path to a job in .github/workflows/gate.yml ` +
        `(and to the matching invocation in this lint):\n` +
        uncovered.map((file) => `      ${file}`).join("\n"),
    );
  }

  const strays = [...union]
    .filter((file) => !wholeSuite.has(file))
    .sort((left, right) => left.localeCompare(right));
  if (strays.length > 0) {
    failures.push(
      `  ${strays.length} file(s) are collected by a gate job but not by the unfiltered whole-suite run. ` +
        `That should be impossible — a filter can only narrow. Investigate before changing anything:\n` +
        strays.map((file) => `      ${file}`).join("\n"),
    );
  }

  if (duplicates.length > 0) {
    failures.push(
      `  ${duplicates.length} file(s) are collected by more than one gate job — the split is meant to be a ` +
        `partition, so this is runtime paid for twice:\n` +
        duplicates.map((file) => `      ${file}`).join("\n"),
    );
  }

  return failures;
}
