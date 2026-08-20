/*
 * Which formatter/linter invocations a change set earns, as a pure function so the split can be
 * tested without running the gate.
 *
 * The split is the point. Both tools hard-error on a path they cannot parse, and `vp check` refuses
 * outright when EVERY path handed to it is one the formatter cannot read. `.svelte` is exactly that
 * — the formatter has no Svelte parser — so a change set of nothing but screens, which is the shape
 * of every screen-only change, could not pass the gate at all. It stayed hidden because each screen
 * built so far shipped alongside a route or a transport module, and one formattable path in the set
 * makes the refusal disappear.
 */
import { partitionByTool } from "./changed-files.mjs";

/** The steps, in order. Empty when a change set has nothing either tool can read. */
export function formatAndLintSteps(files) {
  const { scripts, lintOnly } = partitionByTool(files);
  const steps = [];
  if (scripts.length > 0) {
    steps.push({
      name: `fmt + lint (${scripts.length} script file(s))`,
      cmd: "vp",
      args: ["check", ...scripts],
    });
  }
  if (lintOnly.length > 0) {
    // Lint only, never the formatter. `--no-error-on-unmatched-pattern` because a change whose paths
    // are all covered by the linter's ignorePatterns leaves it with nothing to do, and nothing to
    // lint is not a failure.
    steps.push({
      name: `lint (${lintOnly.length} svelte file(s))`,
      cmd: "vp",
      args: ["lint", "--no-error-on-unmatched-pattern", ...lintOnly],
    });
  }
  return steps;
}
