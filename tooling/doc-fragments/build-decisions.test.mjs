import { describe, expect, it } from "vitest";
import { partitionPending, rebasePendingLinks } from "./build-decisions.mjs";

describe("partitionPending", () => {
  it("numbers only tracked fragments and skips untracked strays", () => {
    const present = ["usage-analytics.md", "stray-from-another-worktree.md"];
    const tracked = new Set(["usage-analytics.md"]);
    expect(partitionPending(present, tracked)).toEqual({
      number: ["usage-analytics.md"],
      skipped: ["stray-from-another-worktree.md"],
    });
  });

  it("numbers every fragment when all are tracked", () => {
    const present = ["a.md", "b.md"];
    const tracked = new Set(["a.md", "b.md"]);
    expect(partitionPending(present, tracked)).toEqual({ number: ["a.md", "b.md"], skipped: [] });
  });

  it("skips everything when nothing is tracked", () => {
    const present = ["a.md", "b.md"];
    expect(partitionPending(present, new Set())).toEqual({ number: [], skipped: ["a.md", "b.md"] });
  });

  it("preserves the directory order of the present files", () => {
    const present = ["c.md", "a.md", "b.md"];
    const tracked = new Set(["a.md", "b.md", "c.md"]);
    expect(partitionPending(present, tracked).number).toEqual(["c.md", "a.md", "b.md"]);
  });
});

describe("rebasePendingLinks", () => {
  it("climbs one level fewer once the decision is numbered", () => {
    expect(rebasePendingLinks("[spec](../../specs/x.md)", new Map())).toBe("[spec](../specs/x.md)");
  });

  it("repoints a sibling at its numbered file, and keeps one still pending reachable", () => {
    const numbered = new Map([["a-numbered-sibling", 391]]);
    expect(rebasePendingLinks("[s](a-numbered-sibling.md#why)", numbered)).toBe(
      "[s](0391-a-numbered-sibling.md#why)",
    );
    expect(rebasePendingLinks("[s](still-pending.md)", numbered)).toBe(
      "[s](pending/still-pending.md)",
    );
  });

  it("leaves absolute links and anchors alone", () => {
    expect(rebasePendingLinks("[x](https://example.com) [y](#top)", new Map())).toBe(
      "[x](https://example.com) [y](#top)",
    );
  });
});
