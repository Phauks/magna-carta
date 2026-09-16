import { describe, expect, it } from "vitest";
import { collectFindings, HARD_RULES, SELF_TEST, verdict } from "./rules.mjs";

describe("the self-test the scan runs on every invocation", () => {
  it.each(SELF_TEST)("$what", ({ run }) => {
    expect(run()).toBe(true);
  });
});

describe("reading the linter's report", () => {
  it("keeps the file, line, rule code and the cycle note a finding needs to be acted on", () => {
    const [finding] = collectFindings({
      diagnostics: [
        {
          filename: "apps/web/src/lib/calendar/entry-window.svelte",
          code: "import(no-cycle)",
          message: "Dependency cycle detected",
          note: "These paths form a cycle:",
          labels: [{ span: { line: 146, column: 36 } }],
        },
      ],
    });
    expect(finding).toEqual({
      code: "import(no-cycle)",
      file: "apps/web/src/lib/calendar/entry-window.svelte",
      line: 146,
      message: "Dependency cycle detected",
      note: "These paths form a cycle:",
    });
  });

  it("refuses a report with no diagnostics array rather than reading it as a clean tree", () => {
    expect(() => collectFindings({ ok: true })).toThrow(/reporter/);
  });
});

describe("the ratchet", () => {
  it("fails a count above the baseline and says the baseline does not rise", () => {
    expect(verdict({ name: "import/no-cycle", baseline: 36, count: 37 })).toMatchObject({
      ok: false,
    });
    expect(verdict({ name: "import/no-cycle", baseline: 36, count: 37 }).reason).toContain(
      "does not rise",
    );
  });

  it("fails a count below the baseline, naming the number to record", () => {
    expect(verdict({ name: "import/no-cycle", baseline: 36, count: 30 }).reason).toContain(
      "set the baseline to 30",
    );
  });

  it("passes only at the baseline", () => {
    expect(verdict({ name: "import/no-cycle", baseline: 36, count: 36 }).ok).toBe(true);
  });
});

describe("the rule table", () => {
  it("gives every rule a fixture, so a rule that stops firing cannot pass as a clean tree", () => {
    for (const rule of HARD_RULES) {
      expect(Object.keys(rule.fixture).length).toBeGreaterThan(0);
    }
  });

  it("gives every rule the report code its findings are partitioned by", () => {
    for (const rule of HARD_RULES) {
      expect(rule.code).toBe(`${rule.name.split("/")[0]}(${rule.name.split("/")[1]})`);
    }
  });

  it("records a reason for every rule's level, so a baseline is never just a number", () => {
    for (const rule of HARD_RULES) {
      expect(rule.why.length).toBeGreaterThan(80);
    }
  });
});
