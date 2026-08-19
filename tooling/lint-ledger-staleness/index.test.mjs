import { describe, expect, it } from "vitest";
import { SELF_TEST, allowance, findStaleness } from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about the scan's own edges rather than about a ledger node.

const treeOf = (paths) => (path) => paths.includes(path);

function node(fields) {
  return {
    id: "area.node",
    name: "Node",
    scope: "",
    status: "not-started",
    area: "fixture.md",
    line: 1,
    audience: "internal",
    notes: null,
    evidence: null,
    spec: null,
    adrs: [],
    awaitingOwner: null,
    slices: [],
    ...fields,
  };
}

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      const found = findStaleness(
        scenario.nodes,
        treeOf(scenario.tree),
        new Set(scenario.decisions ?? []),
        new Map(Object.entries(scenario.slices ?? {})),
        new Map(Object.entries(scenario.specFlags ?? {})),
      );
      expect(found.map((problem) => problem.rule).toSorted()).toEqual(
        [...scenario.expect].toSorted(),
      );
    });
  }
});

describe("path extraction", () => {
  it("does not treat prose containing a slash as a path", () => {
    const found = findStaleness(
      [node({ status: "designed", scope: "Export in LEDES XML 2.0/2.1 with UTBMS codes." })],
      treeOf([]),
    );
    expect(found).toEqual([]);
  });

  it("stops a path at trailing punctuation", () => {
    const found = findStaleness(
      [node({ status: "shipped", evidence: "built in packages/trust." })],
      treeOf(["packages/trust"]),
    );
    expect(found).toEqual([]);
  });

  it("ignores documentation and fragment directories, which are named by prefix", () => {
    // "status.d/2-1" and "docs/decisions/0027" are how the ledger cites those trees, and neither is a
    // filename. Scanning them was measured at 45 false positives, which is why only code roots count.
    const found = findStaleness(
      [
        node({
          status: "shipped",
          evidence: "status.d/2-1 and docs/decisions/0027 and changelog.d/x.md",
        }),
      ],
      treeOf([]),
    );
    expect(found).toEqual([]);
  });

  it("matches a citation at a different depth than the one that claims it", () => {
    const found = findStaleness(
      [
        node({ id: "a", status: "designed", evidence: "crates/search-core" }),
        node({ id: "b", status: "shipped", evidence: "crates/search-core/src/lib.rs" }),
      ],
      treeOf(["crates/search-core", "crates/search-core/src/lib.rs"]),
    );
    expect(found).toEqual([]);
  });
});

describe("the allowance", () => {
  it("reads the reason after an em dash, a hyphen or a colon", () => {
    for (const marker of [
      "ledger-staleness:allow — because",
      "ledger-staleness:allow - because",
      "ledger-staleness:allow: because",
    ]) {
      expect(allowance(node({ notes: marker }))?.reason).toBe("because");
    }
  });

  it("treats a marker with no reason as empty rather than absent", () => {
    expect(allowance(node({ notes: "ledger-staleness:allow" }))).toEqual({ reason: "" });
  });

  it("is absent when the node has no notes at all", () => {
    expect(allowance(node({}))).toBeNull();
  });
});

describe("the status groups", () => {
  it("reads no claim about code from researching, deferred or cut", () => {
    for (const status of ["researching", "deferred", "cut"]) {
      const found = findStaleness(
        [
          node({ id: "parent", status, evidence: "packages/nobody-claims-this" }),
          node({ id: "parent.child", status: "shipped" }),
        ],
        treeOf(["packages/nobody-claims-this"]),
      );
      expect(found, status).toEqual([]);
    }
  });

  it("counts a grandchild, not only a direct child, as code beneath a pre-code parent", () => {
    const found = findStaleness(
      [
        node({ id: "a", status: "designed" }),
        node({ id: "a.b", status: "designed" }),
        node({ id: "a.b.c", status: "shipped" }),
      ],
      treeOf([]),
    );
    expect(found.map((problem) => problem.node.id)).toEqual(["a", "a.b"]);
  });

  it("reads a slice's built stage, and only that stage", () => {
    // `ui`, `tested` and the rest describe work around the code rather than whether it exists, so a
    // slice whose build has not begun contradicts nothing however far its other stages have run.
    const nodes = [
      node({ id: "trust.reconciliation", status: "not-started", slices: ["3-2"] }),
      node({ id: "trust.holds", status: "shipped", slices: ["3-2"] }),
    ];
    expect(findStaleness(nodes, treeOf([]), new Set(), new Map([["3-2", "todo"]]))).toEqual([]);
    expect(findStaleness(nodes, treeOf([]), new Set(), new Map([["3-2", "n/a"]]))).toEqual([]);
    for (const state of ["in-progress", "done"]) {
      const found = findStaleness(nodes, treeOf([]), new Set(), new Map([["3-2", state]]));
      expect(
        found.map((problem) => problem.rule),
        state,
      ).toEqual(["slice-already-delivered"]);
    }
  });

  it("takes a sibling's code as corroboration only when it is under the same slice", () => {
    const found = findStaleness(
      [
        node({ id: "trust.reconciliation", status: "not-started", slices: ["3-2"] }),
        node({ id: "trust.holds", status: "shipped", slices: ["0-3-ledger-core"] }),
      ],
      treeOf([]),
      new Set(),
      new Map([
        ["3-2", "in-progress"],
        ["0-3-ledger-core", "done"],
      ]),
    );
    expect(found).toEqual([]);
  });

  it("does not read an area root's peers as its siblings", () => {
    // A one-segment id is an area root; the other roots are other areas, not work beside it.
    const found = findStaleness(
      [
        node({ id: "portal", status: "not-started", slices: ["2-1"] }),
        node({ id: "documents", status: "shipped", slices: ["2-1"] }),
      ],
      treeOf([]),
      new Set(),
      new Map([["2-1", "done"]]),
    );
    expect(found).toEqual([]);
  });

  it("does not let a sibling with a shared id prefix count as a descendant", () => {
    // `financial.billing.ledes` must not be read as the parent of `financial.billing.ledes-other`.
    const found = findStaleness(
      [
        node({ id: "financial.billing.ledes", status: "not-started" }),
        node({ id: "financial.billing.ledes-other", status: "shipped" }),
      ],
      treeOf([]),
    );
    expect(found).toEqual([]);
  });
});
