// The unwired-write rule, as a pure function over already-collected definitions and references. No
// filesystem here — the impure runner is index.mjs and the fixture test is index.test.mjs, mirroring
// the split in tooling/lint-ledger-staleness/rules.mjs.
//
// WHAT THIS EXISTS FOR. A write-shaped function nobody calls is a capability nobody can reach. It
// compiles, it typechecks, its own tests pass by driving it directly, and the product behaves as
// though the feature were never built — quietly, because the read side keeps working and returns the
// default forever. Two subsystems shipped that way and were found by hand: an email auto-file engine
// evaluating a candidate set nothing could add to, and three notification settings (the firm's in-app
// floor, the retention window, the digest hour) read on every fan-out and every sweep and writable by
// nothing. Neither had a failing test, because in both cases the tests inserted the rows themselves.
//
// THE DESIGN CONSTRAINT, same as the ledger scan's: failing loudly and RARELY. A gate that cries wolf
// is worse than none. So the rule is the narrowest form of the question that still catches both known
// cases, and the two obvious widenings were measured against the whole tree and REJECTED:
//
//   - "no reference outside the DEFINING FILE" — 9 hits against 4, and all 5 extra are the same
//     correct idiom: a statement composed into an ordered batch by a helper beside it, where the
//     helper is what production imports because the ordering is the invariant
//     (`publishCompactedSplitStatements`, `replaceDocumentSplitStatements`). Counting a same-file
//     composition as "unwired" would make the gate fire on the pattern the repository uses for every
//     write whose ordering matters.
//   - "any exported function, not only write-shaped ones" — a package's public surface legitimately
//     exceeds what this monorepo calls today (types, predicates, readers a future surface will use),
//     and there is no cheap way to tell a deliberate API from a dead one. The write verbs are the
//     narrowing that makes the answer mean something: a write nobody performs is a decision nobody
//     can record, which is a different class of defect from an unused helper.
//
// The allowlist is the escape hatch, one entry per name with a REQUIRED reason, on the same
// marker-plus-reason idiom as `ledger-staleness:allow` and `fitness:allow-no-dimensions`. An entry
// with no reason is itself a failure, and an entry naming a function that is now called is reported
// too — a stale suppression is how a gate goes quiet without anyone deciding it should.

// The verb prefixes that make a function a WRITE. Taken from the naming the repository already uses
// for statement builders and domain writes; a verb absent here is a verb the scan says nothing about.
export const WRITE_VERBS = [
  "create",
  "insert",
  "write",
  "record",
  "enqueue",
  "grant",
  "revoke",
  "suspend",
  "resume",
  "promote",
];

// `export function insertThing` / `export async function writeThing`. Anchored to the line start, so
// a re-export or a nested declaration is not a definition site.
export const DEFINITION_PATTERN = new RegExp(
  String.raw`^export\s+(?:async\s+)?function\s+((?:${WRITE_VERBS.join("|")})[A-Z]\w*)`,
  "gm",
);

// Names that are allowed to have no production caller, each with the reason it is allowed. The
// reason is not decoration: it is the review this gate exists to force, written down once so the
// next reader does not have to re-derive it.
export const ALLOWLIST = new Map([
  [
    "createPost",
    "the community board's write path, in packages/community; the board's own worker that calls it" +
      " is the next pull request in the same stream (docs/active-work/claude/project-thread-fa00rq.md)," +
      " and this entry goes when that lands",
  ],
  [
    "createMemoryLogger",
    "a test double — the in-memory logger every package's tests assert against, and production wires" +
      " the real one in apps/api-worker/src/http/app.ts",
  ],
  [
    "createDocumentAssemblyPort",
    "a port factory over `assemble`, which apps/api-worker/src/background/assemblies/assembly-consumer.ts imports" +
      " directly; the capability is fully reachable and only this wrapper is unused",
  ],
  [
    "insertPlatformOperatorStatement",
    "platform_operator rows are seeded by hand into the control plane — the platform-wide" +
      " authorization axis has no self-service grant surface by decision, so the only callers are" +
      " the seed and its test",
  ],
  [
    "insertPlatformStaffStatement",
    "platform_staff rows are seeded by hand into the control plane, in parallel with" +
      " platform_operator and for the same reason: help-desk principals are provisioned outside the" +
      " product, and a firm-facing route that minted one would be the wrong shape entirely",
  ],
]);

// Every problem, given the definitions found and the reference counts collected for them.
//
// `definitions` is a list of `{ name, file, line }`; `referenceCounts` a Map from name to the number
// of non-test references anywhere outside that definition's own line. `allowlist` is injected so the
// whole rule runs against a fixture in the test rather than against a paraphrase of itself.
export function findUnwiredWrites(definitions, referenceCounts, allowlist = ALLOWLIST) {
  const problems = [];
  const defined = new Set(definitions.map((definition) => definition.name));

  for (const definition of definitions) {
    const allowed = allowlist.get(definition.name);
    const references = referenceCounts.get(definition.name) ?? 0;

    if (allowed !== undefined && allowed.trim() === "") {
      problems.push({
        rule: "empty-allowance",
        name: definition.name,
        file: definition.file,
        line: definition.line,
        detail:
          "is allowlisted with no reason — state why nothing calls it, or take it off the list",
      });
      continue;
    }
    if (references > 0) continue;
    if (allowed !== undefined) continue;

    problems.push({
      rule: "unwired-write",
      name: definition.name,
      file: definition.file,
      line: definition.line,
      detail:
        "is exported and nothing outside a test calls it — the capability it performs cannot be" +
        " reached from the product. Wire it, delete it, or allowlist it with the reason it has no caller",
    });
  }

  // A suppression that has outlived its cause. Reported at the allowlist rather than at a file,
  // because that is where the edit goes.
  for (const [name, reason] of allowlist) {
    if (!defined.has(name)) {
      problems.push({
        rule: "stale-allowance",
        name,
        file: null,
        line: null,
        detail: `is allowlisted ("${reason}") but no exported write by that name exists any more`,
      });
      continue;
    }
    if ((referenceCounts.get(name) ?? 0) > 0) {
      problems.push({
        rule: "stale-allowance",
        name,
        file: null,
        line: null,
        detail: `is allowlisted ("${reason}") but something now calls it — drop the entry`,
      });
    }
  }

  return problems;
}

const definition = (name, file = "packages/x/src/y.ts", line = 1) => ({ name, file, line });

// The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
// through the same entry point. Each is a shape that was actually seen or actually considered.
export const SELF_TEST = [
  {
    name: "an exported write with no non-test reference is reported",
    definitions: [definition("writeFirmPolicyStatement")],
    references: {},
    allowlist: {},
    expect: ["unwired-write"],
  },
  {
    name: "one production reference is enough — the gate asks whether it is reachable, not how often",
    definitions: [definition("writeFirmPolicyStatement")],
    references: { writeFirmPolicyStatement: 1 },
    allowlist: {},
    expect: [],
  },
  {
    name: "a same-file composition counts: the composer is what production imports",
    definitions: [definition("insertIndexSplitStatement")],
    references: { insertIndexSplitStatement: 3 },
    allowlist: {},
    expect: [],
  },
  {
    name: "an allowlisted name with a reason is silent",
    definitions: [definition("createMemoryLogger")],
    references: {},
    allowlist: { createMemoryLogger: "a test double" },
    expect: [],
  },
  {
    name: "an allowlisted name with a BLANK reason fails on the blank reason",
    definitions: [definition("createMemoryLogger")],
    references: {},
    allowlist: { createMemoryLogger: "   " },
    expect: ["empty-allowance"],
  },
  {
    name: "an allowlist entry for a name that no longer exists is reported",
    definitions: [],
    references: {},
    allowlist: { insertRetiredStatement: "was hand-seeded" },
    expect: ["stale-allowance"],
  },
  {
    name: "an allowlist entry whose function now HAS a caller is reported, so the gate cannot go quiet",
    definitions: [definition("createEmailAutoFileRule")],
    references: { createEmailAutoFileRule: 2 },
    allowlist: { createEmailAutoFileRule: "no management surface yet" },
    expect: ["stale-allowance"],
  },
  {
    name: "several unwired writes are reported one by one, never rolled up",
    definitions: [definition("writeOne"), definition("writeTwo"), definition("writeThree")],
    references: { writeTwo: 4 },
    allowlist: {},
    expect: ["unwired-write", "unwired-write"],
  },
];
