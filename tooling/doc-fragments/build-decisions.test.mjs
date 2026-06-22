import { describe, expect, it } from "vitest";
import { partitionPending } from "./build-decisions.mjs";

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
