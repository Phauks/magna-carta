import { describe, expect, it } from "vitest";
import { onTrunk, runSelfTest } from "./index.mjs";
import {
  SELF_TEST,
  classify,
  decide,
  isExemption,
  isFragment,
  isShippingSource,
  readExemption,
} from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about where the gate is running rather than about what changed.

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      expect(decide({ onTrunk: scenario.onTrunk, changed: scenario.changed }).outcome).toBe(
        scenario.expect,
      );
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it looks at a diff", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("what counts as first-party source", () => {
  it("takes code under the four roots that ship", () => {
    expect(isShippingSource("apps/api-worker/src/http/routes/billing/billing.ts")).toBe(true);
    expect(isShippingSource("apps/web/src/routes/matters/+page.svelte")).toBe(true);
    expect(isShippingSource("packages/design-system/src/lib/button.ts")).toBe(true);
    expect(isShippingSource("crates/pdf-core/src/lib.rs")).toBe(true);
    expect(isShippingSource("containers/tantivy/src/main.rs")).toBe(true);
    expect(isShippingSource("packages/database/drizzle/per-firm/20260101T000000_a.sql")).toBe(true);
  });

  it("leaves documentation, tooling, workflows and the fragment directories alone", () => {
    expect(isShippingSource("docs/conventions/dates.md")).toBe(false);
    expect(isShippingSource("CLAUDE.md")).toBe(false);
    expect(isShippingSource("packages/design-system/CLAUDE.md")).toBe(false);
    expect(isShippingSource("tooling/lint-status.mjs")).toBe(false);
    expect(isShippingSource(".github/workflows/assemble-docs.yml")).toBe(false);
    expect(isShippingSource("changelog.d/a-thing-happened.md")).toBe(false);
    expect(isShippingSource("status.d/slice-3-2.md")).toBe(false);
  });

  it("leaves manifests, lockfiles and configuration alone — the hole the header names", () => {
    expect(isShippingSource("package.json")).toBe(false);
    expect(isShippingSource("apps/web/package.json")).toBe(false);
    expect(isShippingSource("apps/api-worker/wrangler.jsonc")).toBe(false);
    expect(isShippingSource("crates/pdf-core/Cargo.toml")).toBe(false);
    expect(isShippingSource("pnpm-lock.yaml")).toBe(false);
  });

  it("leaves generated output alone even inside a source root", () => {
    expect(isShippingSource("packages/pdf/src/pkg/pdf_core.js")).toBe(false);
    expect(isShippingSource("apps/web/dist/index.js")).toBe(false);
    expect(isShippingSource("crates/pdf-core/target/debug/build.rs")).toBe(false);
  });
});

describe("what counts as a fragment, and what counts as an exemption", () => {
  it("takes a .md directly in changelog.d/ and nothing else", () => {
    expect(isFragment("changelog.d/a-thing-happened.md")).toBe(true);
    expect(isFragment("changelog.d/README.md")).toBe(false);
    expect(isFragment("changelog.d/exemptions/a-rename.md")).toBe(false);
    expect(isFragment("docs/decisions/pending/a-decision.md")).toBe(false);
  });

  it("keeps the exemption out of the assembler's reach by putting it a directory down", () => {
    // The assembler folds every `.md` directly inside changelog.d/ into the rendered changelog. An
    // exemption in a child directory is invisible to it, which is the point of the layout.
    expect(isExemption("changelog.d/exemptions/a-rename.md")).toBe(true);
    expect(isFragment("changelog.d/exemptions/a-rename.md")).toBe(false);
  });

  it("sorts a change set into the three groups the decision is made from", () => {
    const groups = classify([
      "packages/billing/src/invoice.ts",
      "changelog.d/an-invoice-can-be-voided.md",
      "changelog.d/exemptions/a-rename.md",
      "docs/conventions/dates.md",
    ]);
    expect(groups.source).toEqual(["packages/billing/src/invoice.ts"]);
    expect(groups.fragments).toEqual(["changelog.d/an-invoice-can-be-voided.md"]);
    expect(groups.exemptions).toEqual(["changelog.d/exemptions/a-rename.md"]);
  });
});

describe("the escape hatch", () => {
  it("reads a reason out of the frontmatter", () => {
    expect(readExemption("---\nreason: a revert of work that never reached main\n---\n")).toEqual({
      reason: "a revert of work that never reached main",
      problem: null,
    });
  });

  it("refuses an exemption that does not say why, which is the whole of the review it forces", () => {
    expect(readExemption("just trust me\n").problem).not.toBeNull();
    expect(readExemption("---\ncategory: Changed\n---\n").problem).not.toBeNull();
    expect(readExemption("---\nreason:    \n---\n").problem).not.toBeNull();
  });
});

describe("where the gate is running", () => {
  it("stands down on a push to main and in the merge queue", () => {
    expect(onTrunk({ base: "aaa", head: "bbb", eventName: "push" })).toBe(true);
    expect(onTrunk({ base: "aaa", head: "bbb", eventName: "merge_group" })).toBe(true);
  });

  it("stands down when the trunk already contains HEAD, whatever the event says", () => {
    // Run by hand on main, or on a branch with no commits of its own: the merge base IS HEAD, and
    // there is no change a changelog could be demanded of.
    expect(onTrunk({ base: "aaa", head: "aaa", eventName: undefined })).toBe(true);
  });

  it("does its job on a pull request", () => {
    expect(onTrunk({ base: "aaa", head: "bbb", eventName: "pull_request" })).toBe(false);
  });
});
