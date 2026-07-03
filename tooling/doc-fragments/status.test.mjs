import { describe, expect, it } from "vitest";
import { cellToToken, parseStatus } from "./migrate-status.mjs";
import {
  parseFragment,
  parseStageToken,
  renderCell,
  renderIndex,
  renderStatus,
  renderTable,
  validateFragments,
} from "./status.mjs";

const fragment = (overrides = {}) => ({
  slice: "1·1 — Example",
  group: "phase-1",
  order: 1,
  stages: Object.fromEntries(
    ["research", "spec", "plan", "built", "ui", "load-profile", "tested"].map((key) => [
      key,
      { state: "todo" },
    ]),
  ),
  branch: "main",
  activeWork: null,
  next: null,
  links: { spec: null, plan: null, adrs: [] },
  blockedBy: [],
  notes: "A note.",
  ...overrides,
});

describe("parseStageToken", () => {
  it("parses state, attribution, and flags", () => {
    expect(parseStageToken('done by="Opus 4.8" awaiting gap')).toEqual({
      state: "done",
      by: "Opus 4.8",
      awaiting: true,
      gap: true,
    });
  });
  it("parses a bare state", () => {
    expect(parseStageToken("in-progress")).toEqual({ state: "in-progress" });
  });
  it("rejects an unknown state", () => {
    expect(() => parseStageToken("shipped")).toThrow(/unknown state/);
  });
  it("rejects an unknown flag", () => {
    expect(() => parseStageToken("done wobble")).toThrow(/unknown flag/);
  });
});

describe("renderCell", () => {
  it.each([
    [{ state: "done" }, "[x]"],
    [{ state: "todo" }, "[ ]"],
    [{ state: "in-progress" }, "[~]"],
    [{ state: "n/a" }, "[-]"],
    [{ state: "done", by: "Opus 4.8" }, "[x] Opus 4.8"],
    [{ state: "done", by: "Opus 4.8", awaiting: true }, "[x] Opus 4.8 ↻"],
    [{ state: "done", by: "Opus 4.8", gap: true }, "[x] Opus 4.8\\*"],
    [{ state: "done", gap: true }, "[x]\\*"],
  ])("%o → %s", (stage, expected) => {
    expect(renderCell(stage)).toBe(expected);
  });
});

describe("parseFragment", () => {
  const valid = [
    "---",
    "slice: 1·1 — Example",
    "group: phase-1",
    "order: 1",
    "research: n/a",
    'spec: done by="Opus 4.8"',
    "plan: done",
    "built: done gap",
    "ui: todo",
    "load-profile: n/a",
    "tested: todo",
    "branch: main",
    "blocked-by: 2·2, 2·3",
    "---",
    "",
    "A note.",
  ].join("\n");

  it("parses a well-formed fragment", () => {
    const parsed = parseFragment(valid);
    expect(parsed.slice).toBe("1·1 — Example");
    expect(parsed.stages.spec).toEqual({ state: "done", by: "Opus 4.8" });
    expect(parsed.stages.built).toEqual({ state: "done", gap: true });
    expect(parsed.blockedBy).toEqual(["2·2", "2·3"]);
    expect(parsed.notes).toBe("A note.");
  });
  it("rejects a missing required key", () => {
    expect(() => parseFragment(valid.replace("group: phase-1\n", ""))).toThrow(/group/);
  });
  it("rejects an unknown group", () => {
    expect(() => parseFragment(valid.replace("phase-1", "phase-9"))).toThrow(/unknown group/);
  });
  it("rejects a non-integer order", () => {
    expect(() => parseFragment(valid.replace("order: 1", "order: first"))).toThrow(/order/);
  });
  it("rejects a missing notes body", () => {
    expect(() => parseFragment(valid.replace("\nA note.", ""))).toThrow(/notes/);
  });
});

describe("validateFragments", () => {
  it("rejects a duplicate (group, order) slot", () => {
    expect(() => validateFragments([fragment(), fragment({ slice: "1·2 — Other" })])).toThrow(
      /duplicate/,
    );
  });
});

describe("renderStatus", () => {
  const sections = "# S\n\n## One\n\n{{table:phase-1}}\n\n## Two\n\n{{table:phase-2}}\n";
  it("injects each group's table at its token", () => {
    const out = renderStatus(sections, [fragment({ notes: "Row A." })]);
    expect(out).toContain("| 1·1 — Example |");
    expect(out).toContain("Row A.");
    expect(out).toContain("## Two\n\n| Slice |"); // empty group still renders a header
  });
  it("rejects an unknown table group token", () => {
    expect(() => renderStatus("{{table:phase-9}}", [])).toThrow(/unknown table group/);
  });

  // The redesign's reason for being: a cell's width must not depend on any other row, so one long
  // note can never re-pad — and thus re-diff — every other row (the oxfmt churn we escaped).
  it("renders a row byte-for-byte regardless of a sibling's note length", () => {
    const shortSibling = renderStatus(sections, [
      fragment({ order: 1, notes: "A." }),
      fragment({ order: 2, slice: "1·2 — Other", notes: "B." }),
    ]);
    const longSibling = renderStatus(sections, [
      fragment({ order: 1, notes: "A." }),
      fragment({ order: 2, slice: "1·2 — Other", notes: "B.".repeat(400) }),
    ]);
    const rowFor = (text, slice) => text.split("\n").find((line) => line.includes(slice));
    expect(rowFor(shortSibling, "1·1 — Example")).toBe(rowFor(longSibling, "1·1 — Example"));
  });
});

describe("renderIndex", () => {
  it("emits a normalized machine index", () => {
    const index = JSON.parse(renderIndex([fragment({ next: "do the thing" })]));
    expect(index.slices[0].slice).toBe("1·1 — Example");
    expect(index.slices[0].next).toBe("do the thing");
    expect(index.slices[0].stages.research).toEqual({ state: "todo" });
  });
});

describe("migration round-trip", () => {
  it("cellToToken is the inverse of renderCell", () => {
    for (const cell of [
      "[x]",
      "[ ]",
      "[~]",
      "[-]",
      "[x] Opus 4.8",
      "[x] Opus 4.8 ↻",
      "[x] Opus 4.8\\*",
    ]) {
      expect(renderCell(parseStageToken(cellToToken(cell)))).toBe(cell);
    }
  });
  it("parses a STATUS.md table into ordered fragments", () => {
    const md = [
      "## Phase 1 — Core",
      "",
      "| Slice | Research | Spec | Plan | Built | UI | Load profile | Tested | Notes |",
      "| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- |",
      "| 1·1 — A | [x] | [x] | [x] | [x] Opus 4.8\\* | [ ] | [-] | [ ] | First. |",
      "",
    ].join("\n");
    const [first] = parseStatus(md);
    expect(first).toMatchObject({ slice: "1·1 — A", group: "phase-1", order: 1, notes: "First." });
    expect(first.stages.built).toBe('done by="Opus 4.8" gap');
  });
});

// A generated table row emits width-independent (no padding to column max-width).
describe("renderTable", () => {
  it("does not pad cells to a column max-width", () => {
    const table = renderTable([
      fragment({ order: 1, slice: "1·1 — Short", notes: "x" }),
      fragment({ order: 2, slice: "1·2 — A much longer slice title here", notes: "y" }),
    ]);
    expect(table).toContain("| 1·1 — Short | [ ] |");
  });
});
