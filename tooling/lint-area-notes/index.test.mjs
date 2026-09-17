import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectAreas, nextBaseline } from "./index.mjs";
import {
  RULE_NAMES,
  SELF_TEST,
  applyBaseline,
  findAreaNoteProblems,
  findCountMismatches,
  findUnknownRules,
  openingProse,
  runSelfTest,
  titleNamesArea,
  titleOf,
} from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about the ratchet's own mechanics rather than about a rule.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const baseline = JSON.parse(
  readFileSync(fileURLToPath(new URL("./baseline.json", import.meta.url)), "utf8"),
);

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      expect(
        findAreaNoteProblems(scenario.areas)
          .map((one) => one.rule)
          .toSorted((one, two) => one.localeCompare(two)),
      ).toEqual([...scenario.expect].toSorted((one, two) => one.localeCompare(two)));
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it scans", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("reading a note", () => {
  it("takes the title from the first non-empty line and only when it is a level-one heading", () => {
    expect(titleOf("\n\n# @magna-carta/trust — CLAUDE.md\n\nbody\n")).toBe(
      "@magna-carta/trust — CLAUDE.md",
    );
    expect(titleOf("## Not the title\n\n# Too late\n")).toBeUndefined();
  });

  it("counts prose and skips structure, so a heading-and-bullets note reads as empty", () => {
    expect(openingProse("# Title\n\n## Section\n\n- one\n- two\n\n| a | b |\n")).toBe("");
    expect(openingProse("# Title\n\n```ts\nconst x = 1;\n```\n\nReal prose here.\n")).toBe(
      "Real prose here.",
    );
  });

  it("accepts a title in ordinary words and refuses a neighbour's name", () => {
    const area = { directory: "packages/matter-search", name: "@magna-carta/matter-search" };
    expect(titleNamesArea("Matter search — CLAUDE.md", area)).toBe(true);
    expect(titleNamesArea("@magna-carta/matter-search", area)).toBe(true);
    expect(titleNamesArea("@magna-carta/billing — CLAUDE.md", area)).toBe(false);
  });
});

describe("the debt register", () => {
  it("carries known debt, refuses new debt, and reports debt that is gone", () => {
    const problems = findAreaNoteProblems([
      { directory: "packages/known", name: "@magna-carta/known" },
      { directory: "packages/fresh", name: "@magna-carta/fresh" },
    ]);
    const split = applyBaseline(problems, {
      "missing-note": { count: 2, entries: ["packages/known", "packages/mended"] },
    });
    expect(split.carried.map((one) => one.directory)).toEqual(["packages/known"]);
    expect(split.added.map((one) => one.directory)).toEqual(["packages/fresh"]);
    expect(split.fixed.map((one) => one.directory)).toEqual(["packages/mended"]);
  });

  it("refuses a register whose count disagrees with its entries", () => {
    expect(
      findCountMismatches({ "missing-note": { count: 9, entries: ["packages/one"] } }),
    ).toEqual([{ rule: "missing-note", count: 9, actual: 1 }]);
  });

  it("refuses a register against a rule this gate does not run", () => {
    expect(findUnknownRules({ "retired-rule": { count: 0, entries: [] } })).toEqual([
      "retired-rule",
    ]);
  });

  it("keeps each register's prose when it re-records the entries", () => {
    const next = nextBaseline(
      { "missing-note": { note: "why this debt exists", count: 1, entries: ["packages/old"] } },
      [{ rule: "missing-note", directory: "packages/new", detail: "" }],
    );
    expect(next["missing-note"]).toEqual({
      note: "why this debt exists",
      count: 1,
      entries: ["packages/new"],
    });
  });
});

describe("the committed register, against this repository", () => {
  it("names only rules the gate runs, and its counts match its entries", () => {
    expect(findUnknownRules(baseline)).toEqual([]);
    expect(findCountMismatches(baseline)).toEqual([]);
    expect(Object.keys(baseline).toSorted((one, two) => one.localeCompare(two))).toEqual(
      [...RULE_NAMES].toSorted((one, two) => one.localeCompare(two)),
    );
  });

  it("holds every finding this repository has, and none it does not", () => {
    const areas = collectAreas(ROOT);
    expect(areas.length).toBeGreaterThan(0);
    const { added, fixed } = applyBaseline(findAreaNoteProblems(areas), baseline);
    expect({ added, fixed }).toEqual({ added: [], fixed: [] });
  });

  it("carries a reason on every register, because a bare list of paths explains nothing", () => {
    for (const [rule, register] of Object.entries(baseline)) {
      expect(register.note, rule).toEqual(expect.any(String));
      expect(register.note.length, rule).toBeGreaterThan(40);
    }
  });
});
