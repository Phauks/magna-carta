import { describe, expect, it } from "vitest";
import {
  exemptionReason,
  findBareExemptions,
  findCallSites,
  findInconsistentGuards,
  findLocalInterleaveHelpers,
  findUncheckedInterleaves,
  findUnwrappedGuardShaped,
  readStatementBuilders,
} from "./rules.mjs";

// Every rule is measured twice: against the shape it exists to catch, and against the nearest shape
// it must leave alone. A fitness function nobody has watched fail is a fitness function nobody knows
// is still running.

describe("reading statement builders", () => {
  it("calls an UPDATE whose WHERE carries more than the row's identity guard-shaped", () => {
    const [builder] = readStatementBuilders(`
export function transitionStatement(database, id, from) {
  return database.prepare(\`UPDATE fee_entry SET status = ?3 WHERE id = ?1 AND status = ?2\`).bind(id, from);
}
`);
    expect(builder).toMatchObject({ name: "transitionStatement", guardShaped: true });
  });

  it("does not call an UPDATE keyed only on the primary key guard-shaped", () => {
    const [builder] = readStatementBuilders(`
export function renameStatement(database, id, name) {
  return database.prepare(\`UPDATE matter SET title = ?2 WHERE id = ?1\`).bind(id, name);
}
`);
    expect(builder.guardShaped).toBe(false);
  });

  it("does not call an INSERT guard-shaped however many ANDs its values contain", () => {
    const [builder] = readStatementBuilders(`
export function insertStatement(database, row) {
  return database.prepare(\`INSERT INTO a (x) SELECT 1 WHERE b = 1 AND c = 2\`).bind(row);
}
`);
    expect(builder.guardShaped).toBe(false);
  });
});

describe("finding call sites", () => {
  it("sees through the line breaks the formatter introduces", () => {
    const source = `
const effect = [
  guarded(
    transitionStatement(database, id, from),
    STATUS_GUARD,
  ),
];`;
    expect(findCallSites(source, "transitionStatement", "a.ts")[0]?.guarded).toBe(true);
  });

  it("does not count a bare call as guarded", () => {
    const source = "const effect = [transitionStatement(database, id, from)];";
    expect(findCallSites(source, "transitionStatement", "a.ts")[0]?.guarded).toBe(false);
  });

  it("does not mistake the declaration for a call of itself", () => {
    const source = "export function transitionStatement(database) { return database; }";
    expect(findCallSites(source, "transitionStatement", "a.ts")).toHaveLength(0);
  });
});

describe("rule 1 — a builder guarded anywhere is guarded everywhere", () => {
  const builders = [{ name: "transitionStatement", guardShaped: true }];

  it("fails the call site that skipped the guard its siblings apply", () => {
    const problems = findInconsistentGuards(
      builders,
      new Map([
        [
          "transitionStatement",
          [
            { file: "a.ts", line: 10, guarded: true },
            { file: "b.ts", line: 20, guarded: false },
          ],
        ],
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "inconsistent-guard", file: "b.ts", line: 20 });
  });

  it("says nothing when no call site guards it — that is the backlog, not a regression", () => {
    expect(
      findInconsistentGuards(
        builders,
        new Map([["transitionStatement", [{ file: "a.ts", line: 10, guarded: false }]]]),
      ),
    ).toEqual([]);
  });

  it("says nothing when every call site guards it", () => {
    expect(
      findInconsistentGuards(
        builders,
        new Map([["transitionStatement", [{ file: "a.ts", line: 10, guarded: true }]]]),
      ),
    ).toEqual([]);
  });
});

describe("rule 2 — an exemption states a reason", () => {
  it("reads the reason off a marker that gives one", () => {
    expect(exemptionReason("// fitness:unguarded-write — the row is immutable once written")).toBe(
      "the row is immutable once written",
    );
  });

  it("fails a bare marker", () => {
    const problems = findBareExemptions([
      { file: "a.ts", source: "// fitness:unguarded-write\nconst x = 1;" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("bare-exemption");
  });

  it("passes a marker carrying its reason", () => {
    expect(
      findBareExemptions([{ file: "a.ts", source: "// fitness:unguarded-write — because X" }]),
    ).toEqual([]);
  });
});

describe("rule 3 — interleaveAt is checked", () => {
  it("fails a test that never reads whether the point fired", () => {
    const problems = findUncheckedInterleaves([
      {
        file: "a.test.ts",
        source: "const racing = interleaveAt(database, beforeCommit(), writer);",
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("unchecked-interleave");
  });

  it("passes when the test asserts it fired", () => {
    expect(
      findUncheckedInterleaves([
        {
          file: "a.test.ts",
          source:
            "const racing = interleaveAt(database, beforeCommit(), writer);\nexpect(racing.interleaved).toBe(true);",
        },
      ]),
    ).toEqual([]);
  });

  it("says nothing about a test that uses runInterleaved, which cannot pass vacuously", () => {
    expect(
      findUncheckedInterleaves([
        { file: "a.test.ts", source: "await runInterleaved({ database });" },
      ]),
    ).toEqual([]);
  });
});

describe("rule 4 — nobody re-implements the harness", () => {
  const localCopy = `
function raceBeforeFirstCommit(database, before) {
  return {
    prepare: (sql) => database.prepare(sql),
    batch: async (statements) => {
      if (!fired) { fired = true; await before(); }
      return database.batch(statements);
    },
  };
}`;

  it("catches a hand-rolled interleaving database", () => {
    const problems = findLocalInterleaveHelpers([{ file: "a.test.ts", source: localCopy }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("local-interleave-helper");
  });

  it("leaves a file that imports the shared harness alone", () => {
    expect(
      findLocalInterleaveHelpers([
        {
          file: "a.test.ts",
          source: `import { runInterleaved } from "@magna-carta/data-access/interleave";${localCopy}`,
        },
      ]),
    ).toEqual([]);
  });

  it("leaves an ordinary passthrough database alone", () => {
    expect(
      findLocalInterleaveHelpers([
        {
          file: "a.test.ts",
          source:
            "const spy = { prepare: (sql) => database.prepare(sql), batch: async (s) => database.batch(s) };",
        },
      ]),
    ).toEqual([]);
  });
});

describe("the backlog census", () => {
  it("counts a guard-shaped builder nothing wraps, and not one that is wrapped", () => {
    const builders = [
      { name: "wrapped", guardShaped: true },
      { name: "bare", guardShaped: true },
      { name: "notGuardShaped", guardShaped: false },
    ];
    const sites = new Map([
      ["wrapped", [{ file: "a.ts", line: 1, guarded: true }]],
      ["bare", [{ file: "a.ts", line: 2, guarded: false }]],
      ["notGuardShaped", [{ file: "a.ts", line: 3, guarded: false }]],
    ]);
    expect(findUnwrappedGuardShaped(builders, sites).map((one) => one.name)).toEqual(["bare"]);
  });
});
