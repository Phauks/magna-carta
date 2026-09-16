import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectCatalog, nextBaseline } from "./index.mjs";
import {
  RULE_NAMES,
  SELF_TEST,
  applyBaseline,
  familiesUnderTest,
  familyInSpecifier,
  findCountMismatches,
  findCoverageProblems,
  findUnknownRules,
  importBindings,
  runSelfTest,
  storyAsserts,
  storyFamily,
} from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about the resolution and the ratchet's mechanics rather than about a rule.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const baseline = JSON.parse(
  readFileSync(fileURLToPath(new URL("./baseline.json", import.meta.url)), "utf8"),
);

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      expect(
        findCoverageProblems(scenario.input)
          .map((one) => one.rule)
          .toSorted((one, two) => one.localeCompare(two)),
      ).toEqual([...scenario.expect].toSorted((one, two) => one.localeCompare(two)));
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it scans", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("reading which family a file is about", () => {
  it("finds the family in a specifier however many levels it climbs", () => {
    expect(familyInSpecifier("../lib/components/top-bar/top-bar.svelte")).toBe("top-bar");
    expect(familyInSpecifier("../../src/lib/components/print-sheet/projection.ts")).toBe(
      "print-sheet",
    );
    expect(familyInSpecifier("../lib/formatters/index.ts")).toBeUndefined();
  });

  it("binds default, namespace and renamed named imports alike", () => {
    const bindings = importBindings(
      "import Root from './a.svelte';\n" +
        "import * as TopBar from './b/index.ts';\n" +
        "import { Cell as GridCell } from './c/index.ts';\n",
    );
    expect(bindings.get("Root")).toBe("./a.svelte");
    expect(bindings.get("TopBar")).toBe("./b/index.ts");
    expect(bindings.get("GridCell")).toBe("./c/index.ts");
  });

  it("prefers the file name, then defineMeta, and credits no incidental import", () => {
    const families = ["badge", "field-label", "form"];
    expect(storyFamily({ base: "badge", source: "" }, families)).toBe("badge");
    expect(
      storyFamily(
        {
          base: "maturity-badge",
          source:
            "import Root from '../lib/components/badge/badge.svelte';\n" +
            "const { Story } = defineMeta({ component: Root });",
        },
        families,
      ),
    ).toBe("badge");
    // The Form story renders FieldLabel inside its own composition. It is Form's entry, and
    // FieldLabel gets no credit from it — which is why field-label is in the register.
    expect(
      storyFamily(
        {
          base: "form",
          source: "import L from '../lib/components/field-label/field-label.svelte';",
        },
        families,
      ),
    ).toBe("form");
    expect(
      storyFamily({ base: "gallery", source: "import L from '../lib/components/form/x.svelte';" }, [
        "form",
      ]),
    ).toBeUndefined();
  });

  it("reads assertions from the storybook/test import alone", () => {
    expect(storyAsserts({ source: "import { expect } from 'storybook/test';" })).toBe(true);
    expect(storyAsserts({ source: "// expect nothing" })).toBe(false);
  });

  it("credits a unit test only to the families it actually imports", () => {
    const reached = familiesUnderTest(
      [
        {
          file: "test/print-sheet.test.ts",
          source: "import { project } from '../src/lib/components/print-sheet/projection.ts';",
        },
      ],
      ["print-sheet", "toast"],
    );
    expect([...reached.keys()]).toEqual(["print-sheet"]);
  });
});

describe("the debt register", () => {
  it("carries known debt, refuses new debt, and reports debt that is gone", () => {
    const split = applyBaseline(
      [
        { rule: "catalog-entry", family: "known", detail: "" },
        { rule: "catalog-entry", family: "fresh", detail: "" },
      ],
      { "catalog-entry": { count: 2, entries: ["known", "mended"] } },
    );
    expect(split.carried.map((one) => one.family)).toEqual(["known"]);
    expect(split.added.map((one) => one.family)).toEqual(["fresh"]);
    expect(split.fixed.map((one) => one.family)).toEqual(["mended"]);
  });

  it("refuses a register whose count disagrees with its entries", () => {
    expect(findCountMismatches({ "catalog-entry": { count: 7, entries: ["one"] } })).toEqual([
      { rule: "catalog-entry", count: 7, actual: 1 },
    ]);
  });

  it("refuses a register against a rule this gate does not run", () => {
    expect(findUnknownRules({ "retired-rule": { count: 0, entries: [] } })).toEqual([
      "retired-rule",
    ]);
  });

  it("keeps each register's prose when it re-records the entries", () => {
    const next = nextBaseline(
      { "catalog-entry": { note: "why this debt exists", count: 1, entries: ["old"] } },
      [{ rule: "catalog-entry", family: "new", detail: "" }],
    );
    expect(next["catalog-entry"]).toEqual({
      note: "why this debt exists",
      count: 1,
      entries: ["new"],
    });
  });
});

describe("the committed register, against this catalog", () => {
  it("names only rules the gate runs, and its counts match its entries", () => {
    expect(findUnknownRules(baseline)).toEqual([]);
    expect(findCountMismatches(baseline)).toEqual([]);
    expect(Object.keys(baseline).toSorted((one, two) => one.localeCompare(two))).toEqual(
      [...RULE_NAMES].toSorted((one, two) => one.localeCompare(two)),
    );
  });

  it("holds every finding this catalog has, and none it does not", () => {
    const catalog = collectCatalog(ROOT);
    expect(catalog.families.length).toBeGreaterThan(0);
    expect(catalog.stories.length).toBeGreaterThan(0);
    const { added, fixed } = applyBaseline(findCoverageProblems(catalog), baseline);
    expect({ added, fixed }).toEqual({ added: [], fixed: [] });
  });

  it("carries a reason on every register, because a bare list of names explains nothing", () => {
    for (const [rule, register] of Object.entries(baseline)) {
      expect(register.note, rule).toEqual(expect.any(String));
      expect(register.note.length, rule).toBeGreaterThan(40);
    }
  });
});
