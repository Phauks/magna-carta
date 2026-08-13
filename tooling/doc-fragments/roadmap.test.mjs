import { describe, expect, it } from "vitest";
import {
  BANDS,
  LEDGER_STATUSES,
  bandForStatus,
  parseArea,
  publicEntries,
  renderNow,
  renderPublicRoadmap,
} from "./roadmap.mjs";

function area(...blocks) {
  return ["# Trust accounting", "", "<!-- Feature ledger fragment. -->", "", ...blocks].join("\n");
}

const shippedPublicNode = [
  "- id: trust.ledger",
  "  name: Client trust ledger",
  "  scope: Per-client trust ledger with a no-negative invariant.",
  "  status: shipped",
  "  audience: public",
  "  public-summary: Hold client money in trust with a running balance per client.",
  "",
].join("\n");

describe("parseArea", () => {
  it("reads a node's required keys and defaults the optional ones", () => {
    const [node] = parseArea(area(shippedPublicNode), "trust.md").nodes;
    expect(node.id).toBe("trust.ledger");
    expect(node.status).toBe("shipped");
    expect(node.audience).toBe("public");
    // publicName falls back to the internal name; the override exists for the areas whose internal
    // names are builder vocabulary, and paying for it on every node would be the same fact twice.
    expect(node.publicName).toBe("Client trust ledger");
    expect(node.awaitingOwner).toBeNull();
  });

  it("defaults audience to internal, which keeps every pre-existing node out of the public view", () => {
    const [node] = parseArea(
      area("- id: trust.internal", "  name: X", "  scope: Y.", "  status: shipped", ""),
      "trust.md",
    ).nodes;
    expect(node.audience).toBe("internal");
    expect(node.publicSummary).toBeNull();
  });

  it("takes the public group from the area header, defaulting to the title", () => {
    expect(parseArea(area(shippedPublicNode), "trust.md").publicGroup).toBe("Trust accounting");
    const withGroup = [
      "# Core Domain — Directory, Matters & Locations",
      "",
      "<!-- public-group: Clients and matters -->",
      "",
      shippedPublicNode,
    ].join("\n");
    expect(parseArea(withGroup, "core.md").publicGroup).toBe("Clients and matters");
  });

  it("refuses an unknown status rather than rendering the node into no band", () => {
    expect(() =>
      parseArea(area("- id: a", "  name: A", "  scope: B.", "  status: nearly", ""), "trust.md"),
    ).toThrow(/unknown status "nearly"/);
  });

  it("refuses a line that is neither a field nor a heading, rather than skipping it", () => {
    // The failure guarded is silent omission: a mistyped node would otherwise drop a capability out
    // of the published roadmap with nothing raised.
    expect(() => parseArea(area("  status shipped", ""), "trust.md")).toThrow(
      /neither a node field nor an area heading/,
    );
  });

  it("refuses the same key twice on one node", () => {
    expect(() =>
      parseArea(
        area("- id: a", "  name: A", "  scope: B.", "  status: shipped", "  status: cut", ""),
        "trust.md",
      ),
    ).toThrow(/"status" is set twice/);
  });

  it("refuses a field above the first node", () => {
    expect(() => parseArea(area("  name: orphan", ""), "trust.md")).toThrow(
      /sits above the first node/,
    );
  });
});

describe("bandForStatus", () => {
  it("maps every ledger status to a band, so no status can render nowhere", () => {
    for (const status of LEDGER_STATUSES) expect(BANDS).toContain(bandForStatus(status));
  });

  it("reads a part-delivered capability as still being built", () => {
    // `partial` is most often a shipped backend whose screen is not built, which from the seat of
    // somebody using the product is not done.
    expect(bandForStatus("partial")).toBe("Building Now");
    expect(bandForStatus("in-build")).toBe("Building Now");
  });

  it("publishes a cut promise rather than deleting it", () => {
    expect(bandForStatus("cut")).toBe("Not on the roadmap");
  });

  it("reads a parked capability as future, not as declined", () => {
    expect(bandForStatus("deferred")).toBe("Future");
  });
});

describe("renderPublicRoadmap", () => {
  const areas = [
    parseArea(
      area(
        shippedPublicNode,
        [
          "- id: trust.reconciliation",
          "  name: Three-way reconciliation",
          "  scope: Bank, book and client-ledger reconciliation.",
          "  status: in-build",
          "  audience: public",
          "  public-name: Trust reconciliation",
          "  public-summary: Reconcile the trust account against the bank and the client ledgers.",
          "",
        ].join("\n"),
        [
          "- id: trust.internal-plumbing",
          "  name: Ledger posting engine",
          "  scope: Internal double-entry posting machinery.",
          "  status: in-build",
          "",
        ].join("\n"),
      ),
      "trust.md",
    ),
  ];

  it("publishes only the nodes opted in, so a ledger node is not a promise", () => {
    const rendered = renderPublicRoadmap(areas);
    expect(rendered).toContain("Trust reconciliation");
    expect(rendered).not.toContain("Ledger posting engine");
  });

  it("derives the band from status rather than from anything an author typed", () => {
    const rendered = renderPublicRoadmap(areas);
    expect(rendered).toMatch(/## Building Now[\S\s]*Trust reconciliation/);
    expect(rendered).toMatch(/## Completed[\S\s]*Client trust ledger/);
  });

  it("moves an entry between bands on the status flip alone", () => {
    const shipped = [
      parseArea(area(shippedPublicNode.replace("status: shipped", "status: in-build")), "trust.md"),
    ];
    expect(renderPublicRoadmap(shipped)).toMatch(/## Building Now[\S\s]*Client trust ledger/);
  });

  it("lists a completed entry by name only, leaving the detail to the changelog", () => {
    const rendered = renderPublicRoadmap(areas);
    expect(rendered).toContain("- Client trust ledger\n");
    expect(rendered).not.toContain("- **Client trust ledger**");
  });

  it("omits a band with nothing in it rather than printing an empty heading", () => {
    expect(renderPublicRoadmap(areas)).not.toContain("## Not on the roadmap");
  });

  it("states no date anywhere, including its own", () => {
    // A generation timestamp would also break the diff gate every day, which is the mechanism that
    // keeps this document honest.
    expect(renderPublicRoadmap(areas)).not.toMatch(/\b(19|20)\d{2}\b|\bQ[1-4]\b/);
  });

  it("carries no internal vocabulary into the published document", () => {
    const rendered = renderPublicRoadmap(areas);
    for (const forbidden of ["ADR-", "roadmap.d", "status:", "in-build", "@magna-carta/"]) {
      expect(rendered).not.toContain(forbidden);
    }
  });
});

describe("publicEntries", () => {
  it("carries the area's public group onto every entry", () => {
    const areas = [parseArea(area(shippedPublicNode), "trust.md")];
    expect(publicEntries(areas)).toEqual([
      {
        id: "trust.ledger",
        name: "Client trust ledger",
        summary: "Hold client money in trust with a running balance per client.",
        group: "Trust accounting",
        band: "Completed",
      },
    ]);
  });
});

describe("renderNow", () => {
  const areas = [
    parseArea(
      area(
        [
          "- id: trust.charges",
          "  name: Bank charges on a trust account",
          "  scope: Bank fees against a pooled trust account.",
          "  status: designed",
          "  awaiting-owner: Whether a bank charge may ever be met from the pooled balance.",
          "",
        ].join("\n"),
        [
          "- id: trust.recon",
          "  name: Three-way reconciliation",
          "  scope: Bank, book and client-ledger reconciliation.",
          "  status: in-build",
          "",
        ].join("\n"),
        shippedPublicNode,
      ),
      "trust.md",
    ),
  ];

  it("leads with what is blocked on the owner, and states the question", () => {
    const rendered = renderNow(areas);
    expect(rendered.indexOf("## Waiting on you")).toBeLessThan(rendered.indexOf("## Being built"));
    expect(rendered).toContain(
      "- **Bank charges on a trust account** (trust.md) — Whether a bank charge may ever be met from the pooled balance.",
    );
  });

  it("lists what is in build and what is queued, from status alone", () => {
    const rendered = renderNow(areas);
    expect(rendered).toMatch(/## Being built now[\S\s]*Three-way reconciliation/);
    expect(rendered).toMatch(/## Next up[\S\s]*Bank charges on a trust account/);
  });

  it("does not repeat what shipped, which is the changelog's fact", () => {
    expect(renderNow(areas)).not.toContain("Client trust ledger");
  });

  it("counts every node in the tally, so the total is the ledger's own", () => {
    expect(renderNow(areas)).toContain("| Trust accounting | 1 | 1 | 0 | 1 | 0 | 3 |");
  });

  it("states a subtree once, at its shallowest node", () => {
    // A parent and nine children under one heading is nine lines saying what one line said, which is
    // what turns a one-screen digest back into something nobody reads.
    const deep = [
      parseArea(
        area(
          ["- id: board", "  name: Board", "  scope: A board.", "  status: designed", ""].join(
            "\n",
          ),
          [
            "- id: board.voting",
            "  name: Voting",
            "  scope: Votes on a board.",
            "  status: designed",
            "",
          ].join("\n"),
          [
            "- id: board.voting.ranking",
            "  name: Ranking",
            "  scope: Ranked votes.",
            "  status: designed",
            "",
          ].join("\n"),
        ),
        "community.md",
      ),
    ];
    const rendered = renderNow(deep);
    expect(rendered).toContain("**Board**");
    expect(rendered).not.toContain("**Voting**");
    expect(rendered).not.toContain("**Ranking**");
  });

  it("says so plainly when a section is empty", () => {
    const empty = [parseArea(area(shippedPublicNode), "trust.md")];
    expect(renderNow(empty)).toContain("_Nothing is blocked on an owner decision._");
  });
});
