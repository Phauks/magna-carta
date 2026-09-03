import { describe, expect, it } from "vitest";
import { formatAndLintSteps } from "./format-lint-steps.mjs";

const formatterSees = (steps) =>
  steps
    .filter((step) => step.args[0] === "check")
    .flatMap((step) => step.args.slice(1).filter((argument) => !argument.startsWith("--")));

describe("the formatter never receives a path it cannot parse", () => {
  it("gives a screen-only change a lint step and no formatter step", () => {
    // The regression: `vp check` refuses when every path in the set is one it cannot format, so this
    // change set could not pass the gate at all before the split.
    const steps = formatAndLintSteps(["apps/web/src/routes/a/+page.svelte"]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.args[0]).toBe("lint");
    expect(formatterSees(steps)).toEqual([]);
  });

  it("keeps svelte out of the formatter's paths in a mixed change too", () => {
    const steps = formatAndLintSteps([
      "apps/web/src/lib/thing.ts",
      "apps/web/src/routes/a/+page.svelte",
    ]);
    expect(formatterSees(steps)).toEqual(["apps/web/src/lib/thing.ts"]);
    expect(steps.map((step) => step.args[0])).toEqual(["check", "lint"]);
  });

  it("asks for nothing when neither tool can read anything in the change", () => {
    expect(formatAndLintSteps(["crates/engine/src/main.rs", "assets/seal.png"])).toEqual([]);
  });

  it("tolerates a change whose every script file the formatter ignores", () => {
    // A regenerated OpenAPI client and nothing else: every path is on the formatter's ignore list, so
    // `vp check` would refuse before analysis for want of a target. The step carries the flag that
    // makes an unmatched set a no-op rather than a failure, and the paths still reach the linter.
    const steps = formatAndLintSteps([
      "packages/api-client/src/sdk.gen.ts",
      "packages/api-client/src/types.gen.ts",
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.args.slice(0, 2)).toEqual(["check", "--no-error-on-unmatched-pattern"]);
    expect(formatterSees(steps)).toEqual([
      "packages/api-client/src/sdk.gen.ts",
      "packages/api-client/src/types.gen.ts",
    ]);
  });
});
