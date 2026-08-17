import { describe, expect, it } from "vitest";
import { renderDecisionDesk } from "./decision-desk.mjs";
import { parseArea } from "./roadmap.mjs";

function area(...blocks) {
  return ["# Trust accounting", "", "<!-- Feature ledger fragment. -->", "", ...blocks].join("\n");
}

const node = (fields) =>
  [
    `- id: ${fields.id}`,
    `  name: ${fields.name}`,
    `  scope: ${fields.scope ?? "One factual line."}`,
    `  status: ${fields.status}`,
    ...(fields.surface === undefined ? [] : [`  surface: ${fields.surface}`]),
    ...(fields.awaiting === undefined ? [] : [`  awaiting-owner: ${fields.awaiting}`]),
    "",
  ].join("\n");

const ledger = [
  parseArea(
    area(
      node({
        id: "trust.charges",
        name: "Bank charges on a trust account",
        status: "not-started",
        awaiting: "Whether a bank charge may ever be met from the pooled balance.",
      }),
      node({
        id: "trust.periods",
        name: "Closed periods",
        status: "shipped",
        surface: "awaiting-screen",
        awaiting: "Whether a closed period may be superseded more than once.",
      }),
      node({
        id: "trust.ledger",
        name: "The ledger itself",
        status: "shipped",
        surface: "internal",
      }),
    ),
    "trust.md",
  ),
];

const page = renderDecisionDesk(ledger);

describe("renderDecisionDesk", () => {
  it("carries only the questions, not the whole ledger", () => {
    // The register is where every node is listed. A desk that also listed the 700 nodes nobody is
    // being asked about would be the register with boxes on it, which is not a place to decide.
    expect(page).toContain("Bank charges on a trust account");
    expect(page).toContain("Closed periods");
    expect(page).not.toContain("The ledger itself");
  });

  it("states the question as the ledger wrote it", () => {
    expect(page).toContain("Whether a bank charge may ever be met from the pooled balance.");
  });

  it("separates a question holding a build from one changing something that runs", () => {
    const blocking = page.indexOf("Nothing is built behind these");
    const changing = page.indexOf("These are not holding a build still");
    expect(blocking).toBeGreaterThan(-1);
    expect(changing).toBeGreaterThan(blocking);
    // The unbuilt one is above the boundary, the built one below it — the ordering is the point,
    // not decoration: it is what tells the reader which answers cost time by being withheld.
    expect(page.indexOf("Bank charges on a trust account")).toBeLessThan(changing);
    expect(page.indexOf("Closed periods")).toBeGreaterThan(changing);
  });

  it("labels each card with whether anything is built behind it", () => {
    expect(page).toContain("Not built");
    expect(page).toContain("Built \u00b7 no screen yet");
  });

  it("labels a roll-up parent as a group rather than as unclassified reach", () => {
    // The lint refuses `surface:` on a parent — its reach is its children's — so asking for one
    // would be a prompt nothing could satisfy.
    const withParent = [
      parseArea(
        area(
          node({
            id: "trust",
            name: "Trust accounting",
            status: "partial",
            awaiting: "Whether the whole subsystem waits on outside counsel.",
          }),
          node({ id: "trust.ledger", name: "Ledger", status: "shipped", surface: "internal" }),
        ),
        "trust.md",
      ),
    ];
    const rendered = renderDecisionDesk(withParent);
    expect(rendered).toContain("A group of capabilities");
    expect(rendered).not.toContain("reach not classified");
  });

  it("does not tell a reader that code exists behind a parked question", () => {
    const parked = [
      parseArea(
        area(
          node({
            id: "trust.escheat",
            name: "Escheat",
            status: "deferred",
            awaiting: "Whether unclaimed funds move on a schedule.",
          }),
        ),
        "trust.md",
      ),
    ];
    const rendered = renderDecisionDesk(parked);
    expect(rendered).toContain("Parked");
    expect(rendered).not.toContain("Code exists behind every one of these");
  });

  it("escapes a quote in a value it puts in an attribute", () => {
    // escapeHtml leaves quotes alone on purpose, for element content. A name carrying one would
    // close the attribute early and turn the rest of the sentence into markup.
    const quoted = [
      parseArea(
        area(
          node({
            id: "trust.quote",
            name: 'The "held" balance',
            status: "not-started",
            awaiting: "Whether it is called held.",
          }),
        ),
        "trust.md",
      ),
    ];
    const rendered = renderDecisionDesk(quoted);
    expect(rendered).toContain('data-name="The &quot;held&quot; balance"');
  });

  it("gives every question an answer box keyed by the node's own id", () => {
    // The id is what carries an answer back to the right capability. A block that named questions
    // by their heading would break the first time a heading was reworded.
    expect(page).toContain('data-node="trust.charges"');
    expect(page).toContain('data-node="trust.periods"');
    expect(page.match(/data-answer=""/g)).toHaveLength(2);
  });

  it("says plainly that nothing leaves the page on its own", () => {
    expect(page).toContain("no network of any kind");
  });

  it("states no date anywhere, including its own", () => {
    expect(page).not.toMatch(/\b20\d\d\b/);
    expect(page).not.toMatch(/\bQ[1-4]\b/);
  });

  it("renders a ledger with nothing open rather than an empty page", () => {
    const quiet = [
      parseArea(
        area(node({ id: "trust.ledger", name: "Ledger", status: "shipped", surface: "internal" })),
        "trust.md",
      ),
    ];
    const rendered = renderDecisionDesk(quiet);
    expect(rendered).toContain("Nothing is waiting under this heading.");
    expect(rendered).toContain("0 questions the build is waiting on you to answer");
  });
});
