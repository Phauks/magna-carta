import { describe, expect, it } from "vitest";
import { allowFlagsForFixPass, UNSAFE_AUTOFIX_RULES } from "./unsafe-autofix-rules.mjs";

describe("the fix-pass exclusions", () => {
  it("cover the two rewrites that broke real files", () => {
    const rules = UNSAFE_AUTOFIX_RULES.map((entry) => entry.rule);
    // `.sort()` -> `.toSorted()` is invalid under `lib: ES2022`; `=== false` -> `!x` rewrites the
    // deliberate spelling in the worker's access-control route metadata.
    expect(rules).toContain("unicorn/no-array-sort");
    expect(rules).toContain("typescript/no-unnecessary-boolean-literal-compare");
  });

  it("names every rule plugin-qualified, the form the linter's --allow accepts", () => {
    for (const entry of UNSAFE_AUTOFIX_RULES) {
      expect(entry.rule).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
    }
  });

  it("carries a reason for each exclusion, so removing one is a decision and not a guess", () => {
    for (const entry of UNSAFE_AUTOFIX_RULES) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it("renders one -A flag pair per rule", () => {
    expect(
      allowFlagsForFixPass([{ rule: "unicorn/no-array-sort", reason: "x" }, { rule: "a/b" }]),
    ).toEqual(["-A", "unicorn/no-array-sort", "-A", "a/b"]);
  });

  it("renders the real list as flags the linter can take verbatim", () => {
    const flags = allowFlagsForFixPass();
    expect(flags).toHaveLength(UNSAFE_AUTOFIX_RULES.length * 2);
    expect(flags.filter((flag) => flag === "-A")).toHaveLength(UNSAFE_AUTOFIX_RULES.length);
  });
});
