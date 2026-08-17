import { describe, expect, it } from "vitest";
import {
  BANDS,
  LEDGER_STATUSES,
  ROLL_UPS,
  bandForStatus,
  parseArea,
  publicEntries,
  reachOf,
  renderBuildRegister,
  renderPublicRoadmap,
  rollUpIds,
  rollUps,
  wholePercentages,
  workUnits,
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

// The public rendering is kept and exercised, and is deliberately not written to disk by the build:
// there are no users yet, so it has no audience. These tests hold its behaviour intact for the day
// it does — see the comment at the top of roadmap.mjs.
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

describe("ROLL_UPS", () => {
  it("puts every ledger status in exactly one roll-up, so the shares can sum to the whole", () => {
    // A status missing from this table would not fail — it would quietly make a percentage column
    // wrong, which is the failure mode a reader cannot see.
    const counted = ROLL_UPS.flatMap((rollUp) => rollUp.statuses);
    expect(counted.toSorted()).toEqual(LEDGER_STATUSES.toSorted());
  });
});

describe("wholePercentages", () => {
  it("sums to exactly 100, where rounding each share on its own does not", () => {
    // Three equal thirds round to 33 each and print a column that adds to 99.
    expect(wholePercentages([1, 1, 1], 3)).toEqual([34, 33, 33]);
    expect(wholePercentages([241, 182, 15, 24, 13, 8, 178, 39, 2], 702)).toHaveLength(9);
    const shares = wholePercentages([241, 182, 15, 24, 13, 8, 178, 39, 2], 702);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("returns zeros rather than dividing by zero on an empty ledger", () => {
    expect(wholePercentages([0, 0], 0)).toEqual([0, 0]);
  });
});

describe("renderBuildRegister", () => {
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

  it("leads with the counts, which are what the whole document is read for", () => {
    const rendered = renderBuildRegister(areas);
    expect(rendered.indexOf("## Where the program stands")).toBeLessThan(
      rendered.indexOf("## Waiting on you"),
    );
    expect(rendered).toContain("**3 capabilities across 1 areas.**");
  });

  it("states what is blocked on the owner, and states the question", () => {
    expect(renderBuildRegister(areas)).toContain(
      "- **Bank charges on a trust account** (`trust.charges`) — **Not built.** Whether a bank charge may ever be met from the pooled balance.",
    );
  });

  it("separates a question holding a build from one refining what already runs", () => {
    const withBoth = [
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
            "  status: shipped",
            "  awaiting-owner: Whether a closed period may be superseded more than once.",
            "",
          ].join("\n"),
        ),
        "trust.md",
      ),
    ];
    const rendered = renderBuildRegister(withBoth);
    expect(rendered).toContain("**1 answer would let work start.**");
    expect(rendered).toContain("**1 would change something that already runs.**");
    // The split is derived from the node's own status, so the shipped capability's question sits
    // below the designed one however the ledger happens to order them.
    expect(rendered.indexOf("Bank charges on a trust account** (`trust.charges`)")).toBeLessThan(
      rendered.indexOf("Three-way reconciliation** (`trust.recon`)"),
    );
  });

  it("omits a heading rather than printing a zero when every question is one kind", () => {
    const rendered = renderBuildRegister(areas);
    expect(rendered).toContain("**1 answer would let work start.**");
    expect(rendered).not.toContain("would change something that already runs");
  });

  it("lists what is in build and what is queued, from status alone", () => {
    const rendered = renderBuildRegister(areas);
    expect(rendered).toMatch(/## Being built now[\S\s]*Three-way reconciliation/);
    expect(rendered).toMatch(/## Next up[\S\s]*Bank charges on a trust account/);
  });

  it("counts each of the nine statuses in its own column, never banded together", () => {
    // Banding was the previous rendering's largest loss of signal: `partial` (a backend with no
    // screen on it) and `in-build` (being written right now) landed under one heading.
    const rendered = renderBuildRegister(areas);
    expect(rendered).toContain(
      "| Trust accounting | 1 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 33% |",
    );
    for (const status of LEDGER_STATUSES) expect(rendered).toContain(`| \`${status}\` |`);
    for (const band of BANDS) expect(rendered).not.toContain(band);
  });

  it("names the gap between shipped and shipped-plus-partial, which is the interface debt", () => {
    const withPartial = [
      parseArea(
        area(
          shippedPublicNode,
          [
            "- id: trust.recon",
            "  name: Three-way reconciliation",
            "  scope: Bank, book and client-ledger reconciliation.",
            "  status: partial",
            "",
          ].join("\n"),
        ),
        "trust.md",
      ),
    ];
    expect(renderBuildRegister(withPartial)).toContain(
      "**Shipped alone is 1 of 2 (50%). Shipped plus partial is 2 (100%).**",
    );
  });

  it("lists every node including what shipped, because this is the register and not a digest", () => {
    const rendered = renderBuildRegister(areas);
    expect(rendered).toMatch(/## The register[\S\s]*Client trust ledger/);
    expect(rendered).toContain(
      "- `trust.ledger` · `shipped` · **Client trust ledger** — Per-client trust ledger with a no-negative invariant.",
    );
  });

  it("keeps a whole subtree, indented by the depth of its id", () => {
    // An earlier rendering kept only the shallowest node of each subtree. A parent's status is a
    // roll-up and its children are the actual units of work, so collapsing them hid exactly the
    // detail this document exists to show.
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
    const rendered = renderBuildRegister(deep);
    expect(rendered).toContain("- `board` · `designed` · **Board** — A board.");
    expect(rendered).toContain("  - `board.voting` · `designed` · **Voting** — Votes on a board.");
    expect(rendered).toContain(
      "    - `board.voting.ranking` · `designed` · **Ranking** — Ranked votes.",
    );
  });

  it("carries a node's note, which is where a parked or partial status says why", () => {
    const noted = [
      parseArea(
        area(
          [
            "- id: trust.sweep",
            "  name: Interest sweep",
            "  scope: Sweeping trust interest to the bar foundation.",
            "  status: deferred",
            "  notes: Parked until a second jurisdiction is opened.",
            "",
          ].join("\n"),
        ),
        "trust.md",
      ),
    ];
    expect(renderBuildRegister(noted)).toContain(
      "_Note: Parked until a second jurisdiction is opened._",
    );
  });

  it("says so plainly when a section is empty", () => {
    const empty = [parseArea(area(shippedPublicNode), "trust.md")];
    // "No capability", not "nothing": the ledger holds capabilities, and account-side work can be
    // blocking the owner while this section is legitimately empty.
    const rendered = renderBuildRegister(empty);
    expect(rendered).toContain("_No capability is blocked on an owner decision._");
    expect(rendered).toContain("_No capability is marked `in-build`._");
    expect(rendered).toContain("_No capability is marked `planned` or `designed`._");
  });

  it("draws no trend line when the reconstruction of the ledger's past is not there to draw one from", () => {
    const rendered = renderBuildRegister(areas);
    expect(rendered).toContain("**This is where we are, not where we were.**");
    expect(rendered).not.toContain("## Where we have been");
  });
});

// One read commit of a two-node ledger. The letter stands in for a commit hash, which only has to be
// forty hex characters to be a valid key.
function snapshot(letter, date, shipped, cut, areaCounts) {
  const statuses = Object.fromEntries(LEDGER_STATUSES.map((status) => [status, 0]));
  return {
    commit: letter.repeat(40),
    date,
    read: true,
    total: shipped + cut,
    statuses: { ...statuses, shipped, cut },
    areas: areaCounts,
  };
}

describe("renderBuildRegister — where we have been", () => {
  const areas = [
    parseArea(
      area(shippedPublicNode, "- id: trust.recon\n  name: Recon\n  scope: Recon.\n  status: cut\n"),
      "trust.md",
    ),
  ];

  const history = {
    format: 1,
    generatedBy: "vp run register-build",
    snapshots: [
      snapshot("a", "2026-07-14", 1, 1, [{ name: "trust.md", total: 2, shipped: 1 }]),
      {
        commit: "b".repeat(40),
        date: "2026-07-18",
        read: false,
        reason: 'roadmap.d/trust.md: line 4: "trust.ledger" has unknown status "built"',
      },
      snapshot("c", "2026-07-28", 3, 1, [{ name: "trust.md", total: 4, shipped: 3 }]),
    ],
  };

  const rendered = renderBuildRegister(areas, history);

  it("says how much of the history it could read, in the first sentence of the section", () => {
    expect(rendered).toContain("## Where we have been");
    expect(rendered).toContain("**2 of 3 commits read, 2026-07-14 to 2026-07-28 — 14 days.**");
  });

  it("prints one row per read commit, with every status in its own column", () => {
    expect(rendered).toContain(
      "| 2026-07-14 | `aaaaaaaa` | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | — | — | 0 |",
    );
    expect(rendered).toContain(
      "| 2026-07-28 | `cccccccc` | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 4 | +2 | +2 | 1 |",
    );
  });

  it("lists a commit it could not parse as a gap, with the reason, and interpolates nothing", () => {
    expect(rendered).toContain("**1 of the 3 commits do not parse under today's ledger schema**");
    // The reason is stated once for the group of commits that share it, and the commits are listed
    // under it — so a run that all failed on one character reads as one fact rather than as many.
    expect(rendered).toContain("**1 commit, 2026-07-18 to 2026-07-18**");
    // The reason is prose now rather than a table cell, so it is wrapped across lines like every
    // other sentence in the document — compare it against the unwrapped text.
    expect(rendered.replaceAll(/\s+/gu, " ")).toContain(
      'roadmap.d/trust.md: line 4: "trust.ledger" has unknown status "built"',
    );
    expect(rendered).toContain("`bbbbbbbb` (2026-07-18)");
    // The reconstruction never invents the missing row: the unread commit has no counts anywhere.
    expect(rendered).not.toContain("| 2026-07-18 | `bbbbbbbb` | 2 |");
  });

  it("states the rate as a rate and derives no completion date from it", () => {
    expect(rendered).toContain("**+2 shipped since the ledger began**");
    expect(rendered).toContain("**1.0 capabilities shipped a week**");
    expect(rendered).toContain(
      "**No completion date is derived from any of this, and none can be.**",
    );
  });

  it("shows what moved per area, under the area's own title", () => {
    expect(rendered).toContain("| Trust accounting | 2 | 4 | 1 | 3 | +2 |");
    expect(rendered).toContain("**Fastest since the first snapshot:** Trust accounting (+2)");
  });

  it("replaces the old claim that no trend can be drawn, and keeps the limits that are still true", () => {
    expect(rendered).not.toContain("**This is where we are, not where we were.**");
    expect(rendered).toContain("**Where we are, and where we have been.**");
    expect(rendered).toContain(
      "shows when a node's **status** changed and never when the work happened",
    );
  });

  it("renders nothing about the past when every commit in the series went unread", () => {
    const allUnread = { ...history, snapshots: [history.snapshots[1]] };
    expect(renderBuildRegister(areas, allUnread)).not.toContain("## Where we have been");
  });
});

describe("rollUpIds and workUnits", () => {
  const ledger = parseArea(
    area(
      ["- id: trust", "  name: Trust", "  scope: The money spine.", "  status: partial", ""].join(
        "\n",
      ),
      [
        "- id: trust.ledger",
        "  name: Ledger",
        "  scope: Double-entry ledger.",
        "  status: shipped",
        "  surface: internal",
        "",
      ].join("\n"),
      [
        "- id: trust.reconciliation",
        "  name: Reconciliation",
        "  scope: Three-way reconciliation.",
        "  status: not-started",
        "",
      ].join("\n"),
    ),
    "trust.md",
  ).nodes;

  it("reads parenthood off the dotted id, which is where the hierarchy is encoded", () => {
    expect([...rollUpIds(ledger)]).toEqual(["trust"]);
  });

  it("leaves a node whose id merely shares a prefix alone", () => {
    // "trust" is a parent of "trust.ledger"; it is not a parent of "trustee-report", and a
    // startsWith test on the raw string would have said it was.
    const withSibling = parseArea(
      area(
        ["- id: trust", "  name: A", "  scope: One.", "  status: not-started", ""].join("\n"),
        ["- id: trustee-report", "  name: B", "  scope: Two.", "  status: not-started", ""].join(
          "\n",
        ),
      ),
      "trust.md",
    ).nodes;
    expect([...rollUpIds(withSibling)]).toEqual([]);
  });

  it("splits the ledger into the parents and the units of work, losing nothing", () => {
    expect(workUnits(ledger).map((node) => node.id)).toEqual([
      "trust.ledger",
      "trust.reconciliation",
    ]);
    expect(rollUps(ledger).map((node) => node.id)).toEqual(["trust"]);
  });

  it("counts a parent as a parent even when no node between them exists", () => {
    // The ledger does not require every intermediate id to be present, so parenthood is tested
    // against every ancestor rather than only the immediate one.
    const skipped = parseArea(
      area(
        ["- id: trust", "  name: A", "  scope: One.", "  status: partial", ""].join("\n"),
        [
          "- id: trust.reconciliation.three-way",
          "  name: B",
          "  scope: Two.",
          "  status: not-started",
          "",
        ].join("\n"),
      ),
      "trust.md",
    ).nodes;
    expect([...rollUpIds(skipped)]).toEqual(["trust"]);
  });
});

describe("surface", () => {
  const node = (surface) =>
    parseArea(
      area(
        [
          "- id: trust.ledger",
          "  name: Ledger",
          "  scope: Double-entry ledger.",
          "  status: shipped",
          `  surface: ${surface}`,
          "",
        ].join("\n"),
      ),
      "trust.md",
    ).nodes[0];

  it("carries a recorded reach, which no status can express", () => {
    expect(node("awaiting-screen").surface).toBe("awaiting-screen");
  });

  it("refuses a value outside the vocabulary rather than rendering an unknown reach", () => {
    expect(() => node("soon")).toThrow(/unknown surface "soon"/);
  });

  it("defaults to null, so an unclassified node is never counted as reachable", () => {
    const [unset] = parseArea(area(shippedPublicNode), "trust.md").nodes;
    expect(unset.surface).toBeNull();
  });

  it("reads a key written with no value as absent, not as an empty answer", () => {
    // `surface:` with nothing after it parses to "". Kept, it slips past every rule that tests for
    // presence at once: the vocabulary check skips it as falsy, the lint requiring a surface on a
    // built leaf sees one, and the reach table counts the node in no column at all.
    const [blank] = parseArea(
      area(
        [
          "- id: trust.ledger",
          "  name: Ledger",
          "  scope: Double-entry ledger.",
          "  status: shipped",
          "  surface:",
          "  audience:",
          "  public-name:",
          "",
        ].join("\n"),
      ),
      "trust.md",
    ).nodes;
    expect(blank.surface).toBeNull();
    expect(blank.audience).toBe("internal");
    expect(blank.publicName).toBe("Ledger");
  });
});

const at = (status, surface = null) => ({ status, surface });

describe("reachOf", () => {
  it("reads a status with nothing built as not built, whatever else is set", () => {
    for (const status of ["not-started", "researching", "designed", "planned"]) {
      expect(reachOf(at(status))).toBe("not-built");
    }
  });

  it("reads a parked capability as parked rather than as unbuilt", () => {
    expect(reachOf(at("deferred"))).toBe("parked");
    expect(reachOf(at("cut"))).toBe("parked");
  });

  it("returns the recorded reach where one is recorded", () => {
    expect(reachOf(at("shipped", "screen"))).toBe("screen");
    expect(reachOf(at("partial", "awaiting-screen"))).toBe("awaiting-screen");
    expect(reachOf(at("shipped", "internal"))).toBe("internal");
  });

  it("says built-but-unclassified rather than guessing at a reach nobody recorded", () => {
    expect(reachOf(at("shipped"))).toBe("built");
  });
});
