import { describe, expect, it } from "vitest";
import { loadAreas } from "./build-register.mjs";
import { escapeHtml, renderBuildRegisterArtifact } from "./register-artifact.mjs";
import { LEDGER_STATUSES, allNodes, parseArea, renderBuildRegister } from "./roadmap.mjs";

// The page and docs/now.md are two renderings of one ledger. Most of what is worth asserting here is
// therefore not "the page says 42" but "the page and the Markdown say the same thing", which is why
// the last block runs both renderers over the real roadmap.d/ and compares their numbers.

function area(title, ...blocks) {
  return [`# ${title}`, "", "<!-- Feature ledger fragment. -->", "", ...blocks].join("\n");
}

function node(fields) {
  return [
    ...Object.entries(fields).map(
      ([key, value], index) => `${index === 0 ? "- " : "  "}${key}: ${value}`,
    ),
    "",
  ].join("\n");
}

const trustLedger = node({
  id: "trust.ledger",
  name: "Client trust ledger",
  scope: "Per-client trust ledger with a no-negative invariant.",
  status: "shipped",
});

const trustReconciliation = node({
  id: "trust.ledger.reconciliation",
  name: "Three-way reconciliation",
  scope: "Bank, book and client ledgers proved against each other.",
  status: "partial",
  notes: "Backend only, no screen.",
});

const trustSweep = node({
  id: "trust.sweep",
  name: "Earned-fee sweep",
  scope: "Move earned fees from trust to operating.",
  status: "designed",
  "awaiting-owner":
    "Whether a sweep may be scheduled, or must always be a person pressing a button.",
});

const oneArea = () => [
  parseArea(area("Trust accounting", trustLedger, trustReconciliation, trustSweep), "trust.md"),
];

describe("renderBuildRegisterArtifact", () => {
  it("renders a page with a title, both themes and the filter script", () => {
    const page = renderBuildRegisterArtifact(oneArea());
    expect(page.startsWith("<title>Magna Carta Build Register</title>")).toBe(true);
    // The light palette is the definition of record on bare :root; the dark palette is redefined both
    // for the system preference and for an explicit choice, so a colour is never defined only inside a
    // media query. A page missing either dark block reads as the light page on a dark host.
    expect(page).toContain(":root{");
    expect(page).toContain('@media (prefers-color-scheme:dark){:root:not([data-theme="light"])');
    expect(page).toContain(':root[data-theme="dark"]{');
    expect(page.trimEnd().endsWith("</script>")).toBe(true);
    expect(page.endsWith("\n")).toBe(true);
  });

  it("gives every area a section whose id is the ledger file it came from", () => {
    const areas = oneArea();
    const page = renderBuildRegisterArtifact(areas);
    const emitted = [...page.matchAll(/<section class="area" id="area-([^"]+)">/g)].map(
      (match) => match[1],
    );
    // The per-area table links to these ids, so a section that is missing is a dead link and an area
    // that silently never rendered — the failure this whole document exists to make impossible.
    expect(emitted).toStrictEqual(areas.map((entry) => entry.name));
  });

  it("indents a node by the depth of its dotted id and chips it with its own status", () => {
    const page = renderBuildRegisterArtifact(oneArea());
    expect(page).toContain('<li class="n d1" data-s="shipped">');
    expect(page).toContain('<li class="n d2" data-s="partial">');
    expect(page).toContain('<span class="chip done">Shipped</span>');
    expect(page).toContain('<span class="chip part">Partial</span>');
  });

  it("renders notes and the owner question on the node they belong to", () => {
    const page = renderBuildRegisterArtifact(oneArea());
    expect(page).toContain('<p class="note">Backend only, no screen.</p>');
    expect(page).toContain(
      '<p class="ask"><strong>Waiting on you.</strong> Whether a sweep may be scheduled, or must always be a person pressing a button.</p>',
    );
  });

  it("splits the owner questions by whether anything is built behind them", () => {
    const page = renderBuildRegisterArtifact(oneArea());
    // One question, on a `designed` node: nothing is built behind it, so it is holding work still.
    expect(page).toContain("<h3>1 answer would let work start</h3>");
    expect(page).not.toContain("would change something that already runs");
  });

  it("says so plainly when no capability is blocked on the owner", () => {
    const areas = [parseArea(area("Trust accounting", trustLedger), "trust.md")];
    expect(renderBuildRegisterArtifact(areas)).toContain(
      "<p>No capability is blocked on an owner decision.</p>",
    );
  });

  it("writes a zero cell as a dot rather than a digit, so the numbers that exist stand out", () => {
    const page = renderBuildRegisterArtifact(oneArea());
    expect(page).toContain('<td class="zero">·</td>');
  });

  it("is a pure function of the ledger — same input, same bytes", () => {
    expect(renderBuildRegisterArtifact(oneArea())).toBe(renderBuildRegisterArtifact(oneArea()));
  });
});

describe("escapeHtml", () => {
  it("escapes the three characters that would otherwise be markup", () => {
    expect(escapeHtml("a & b <c> d")).toBe("a &amp; b &lt;c&gt; d");
  });

  it("escapes the ampersand first, so an escaped bracket is not double-escaped", () => {
    expect(escapeHtml("<handle>")).toBe("&lt;handle&gt;");
  });

  it("leaves quotes alone — no ledger value is ever placed in an attribute", () => {
    expect(escapeHtml('answer "what was true then"')).toBe('answer "what was true then"');
  });
});

describe("the two renderings of the real ledger", () => {
  const areas = loadAreas();
  const nodes = allNodes(areas);
  // Rendered without history on purpose: the history is reconstructed from git and belongs to the
  // Markdown, and the counts asserted below are the ledger's own, which both renderings share.
  const register = renderBuildRegister(areas);
  const page = renderBuildRegisterArtifact(areas);

  it("emit the same total", () => {
    expect(register).toContain(`**${nodes.length} capabilities across ${areas.length} areas.**`);
    expect(page).toContain(`<h1>${nodes.length} things, and where every one of them stands</h1>`);
    expect(page).toContain(`<span id="hits">${nodes.length} shown</span>`);
  });

  it("emit the same count for every one of the nine statuses", () => {
    for (const status of LEDGER_STATUSES) {
      const count = nodes.filter((entry) => entry.status === status).length;
      // The Markdown's per-status table row, and the page's filter button for the same status.
      expect(register).toContain(`| \`${status}\` | ${count} |`);
      expect(page).toContain(`data-s="${status}" aria-pressed="false">`);
      expect(page).toMatch(
        new RegExp(`data-s="${status}" aria-pressed="false">[^<]*<b>${count}</b>`),
      );
    }
  });

  it("emit the same per-area totals", () => {
    for (const entry of areas) {
      const shipped = entry.nodes.filter((candidate) => candidate.status === "shipped").length;
      expect(page).toContain(`<span class="ac">${shipped} of ${entry.nodes.length} shipped</span>`);
    }
  });

  it("list the same nodes as blocked on an owner decision", () => {
    const awaiting = nodes.filter((entry) => entry.awaitingOwner !== null);
    const listed = [...page.matchAll(/<li><strong>([^<]*)<\/strong> — /g)].length;
    expect(listed).toBe(awaiting.length);
    for (const entry of awaiting) {
      expect(register).toContain(`- **${entry.name}** (\`${entry.id}\`) — ${entry.awaitingOwner}`);
    }
  });

  it("give every node in the ledger a row on the page", () => {
    expect([...page.matchAll(/<li class="n d\d+" data-s=/g)]).toHaveLength(nodes.length);
  });
});
