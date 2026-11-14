import { describe, expect, it } from "vitest";
import { compareWithBaseline, countViolations, readableParts } from "./rules.mjs";

describe("what the scan reads", () => {
  it("reads string literals and skips comments and identifiers", () => {
    expect(readableParts('const corpus = "Ready";', false)).toEqual(["Ready"]);
    expect(readableParts("// The platform — a comment", false)).toEqual([]);
  });

  it("reads markup text but not expressions", () => {
    expect(countViolations("<p>{corpus.name} is ready</p>", true)).toEqual({});
    expect(countViolations("<p>The platform is ready</p>", true)).toEqual({ machinery: 1 });
  });

  it("treats a Svelte script block as code, not markup", () => {
    const source = "<script>\n  const corpus = load();\n</script>\n<p>Ready</p>";
    expect(countViolations(source, true)).toEqual({});
  });
});

describe("each rule bites", () => {
  it.each([
    ["em-dash", '"Saved the file — you can close this now"'],
    ["nothing-answered", '"Nothing answered, so nothing changed."'],
    ["is-where", '"An email address is where the invitation goes."'],
    ["machinery", '"Every corpus is read."'],
    ["old-soon-wording", '"Not built yet. Waiting on the engine."'],
  ])("%s", (rule, line) => {
    expect(countViolations(line, false)[rule]).toBe(1);
  });

  it("passes the house style's own examples", () => {
    expect(countViolations('"Couldn\'t connect. Nothing was saved. Try again."', false)).toEqual(
      {},
    );
    expect(countViolations('"Not built yet: recording payments."', false)).toEqual({});
  });
});

describe("the baseline only shrinks", () => {
  it("fails a rise and reports a fall", () => {
    const baseline = { "a.ts": { "em-dash": 2 }, "b.ts": { machinery: 1 } };
    const current = { "a.ts": { "em-dash": 3 }, "c.ts": { "is-where": 1 } };
    const { rose, fell } = compareWithBaseline(current, baseline);
    expect(rose).toEqual([
      { file: "a.ts", rule: "em-dash", was: 2, now: 3 },
      { file: "c.ts", rule: "is-where", was: 0, now: 1 },
    ]);
    expect(fell).toEqual([{ file: "b.ts", rule: "machinery", was: 1, now: 0 }]);
  });
});
