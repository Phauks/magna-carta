import { describe, expect, it } from "vitest";
import { collectDefinitions, countReferences, isTestPath, runSelfTest } from "./index.mjs";
import { ALLOWLIST, DEFINITION_PATTERN, SELF_TEST, findUnwiredWrites } from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about the scan's own collection edges rather than about the rule.

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      const found = findUnwiredWrites(
        scenario.definitions,
        new Map(Object.entries(scenario.references)),
        new Map(Object.entries(scenario.allowlist)),
      );
      expect(found.map((problem) => problem.rule).toSorted()).toEqual(
        [...scenario.expect].toSorted(),
      );
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it scans", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("what counts as a definition", () => {
  const sourcesOf = (contents) => new Map([["packages/x/src/y.ts", contents]]);

  it("finds an exported write, sync and async, and records its line", () => {
    const definitions = collectDefinitions(
      sourcesOf(
        "// a header\nexport function insertThingStatement() {}\nexport async function writeOther() {}\n",
      ),
      ["packages"],
    );
    expect(definitions).toEqual([
      { name: "insertThingStatement", file: "packages/x/src/y.ts", line: 2 },
      { name: "writeOther", file: "packages/x/src/y.ts", line: 3 },
    ]);
  });

  it("ignores a read, and ignores a verb that is only a prefix of a longer word", () => {
    // `created` is not `create` + a capital, and `readThing` is not a write at all. Both would be
    // noise on a gate whose whole value is that it fires rarely.
    expect(
      collectDefinitions(
        sourcesOf("export function readThing() {}\nexport function createdAtOf() {}\n"),
        ["packages"],
      ),
    ).toEqual([]);
  });

  it("ignores a non-exported write and an indented one", () => {
    expect(
      collectDefinitions(
        sourcesOf("function insertPrivate() {}\n  export function insertNested() {}\n"),
        ["packages"],
      ),
    ).toEqual([]);
  });

  it("only takes definitions from the definition roots, though references come from everywhere", () => {
    const sources = new Map([
      ["tooling/thing/index.mjs", "export function insertToolThing() {}\n"],
      ["packages/x/src/y.ts", "export function insertRealThing() {}\n"],
    ]);
    expect(collectDefinitions(sources, ["apps", "packages"]).map((one) => one.name)).toEqual([
      "insertRealThing",
    ]);
  });

  it("the shared pattern is stateless between calls", () => {
    // A `g` regex carries lastIndex, and a scan that forgot to reset it would silently miss the
    // first definition of every file after the first.
    DEFINITION_PATTERN.lastIndex = 11;
    expect(
      collectDefinitions(sourcesOf("export function insertOne() {}\n"), ["packages"]),
    ).toHaveLength(1);
  });
});

describe("what counts as a reference", () => {
  const definitions = [{ name: "insertThing", file: "packages/x/src/y.ts", line: 1 }];

  it("does not count the definition's own line", () => {
    const counts = countReferences(
      new Map([["packages/x/src/y.ts", "export function insertThing() {}\n"]]),
      definitions,
    );
    expect(counts.get("insertThing")).toBe(0);
  });

  it("counts a same-file reference from a composing helper", () => {
    const counts = countReferences(
      new Map([
        [
          "packages/x/src/y.ts",
          "export function insertThing() {}\nexport function batch() {\n  return [insertThing()];\n}\n",
        ],
      ]),
      definitions,
    );
    expect(counts.get("insertThing")).toBe(1);
  });

  it("counts a reference from another file, import and call alike", () => {
    const counts = countReferences(
      new Map([
        ["packages/x/src/y.ts", "export function insertThing() {}\n"],
        ["apps/api-worker/src/route.ts", 'import { insertThing } from "x";\ninsertThing();\n'],
      ]),
      definitions,
    );
    expect(counts.get("insertThing")).toBe(2);
  });

  it("does not count a longer identifier that contains the name", () => {
    const counts = countReferences(
      new Map([
        ["packages/x/src/y.ts", "export function insertThing() {}\n"],
        ["apps/api-worker/src/route.ts", "insertThingElse();\nmyInsertThing();\n"],
      ]),
      definitions,
    );
    expect(counts.get("insertThing")).toBe(0);
  });
});

describe("test paths, which are the whole point of the scan", () => {
  it("recognizes both layouts the repository uses", () => {
    expect(isTestPath("packages/notifications/test/preferences.test.ts")).toBe(true);
    expect(isTestPath("apps/api-worker/test/support/test-auth.ts")).toBe(true);
    expect(isTestPath("packages/x/src/thing.test.ts")).toBe(true);
    expect(isTestPath("apps/api-worker/test/directory-e2e.test.ts")).toBe(true);
    expect(isTestPath("packages/x/src/__mocks__/thing.ts")).toBe(true);
  });

  it("does not mistake production code for a test", () => {
    expect(isTestPath("apps/api-worker/src/routes/firm/firm-notification-policy.ts")).toBe(false);
    expect(isTestPath("packages/notifications/src/preferences.ts")).toBe(false);
    // A directory whose name merely starts with "test" is not the test directory.
    expect(isTestPath("packages/x/src/testing-utilities.ts")).toBe(false);
  });
});

describe("the allowlist", () => {
  it("gives every entry a non-empty reason", () => {
    // The reason IS the review this gate exists to force. An entry without one suppresses a finding
    // and records nothing about why, which is the state the gate was built to make impossible.
    for (const [name, reason] of ALLOWLIST) {
      expect(reason.trim(), name).not.toBe("");
    }
  });
});
