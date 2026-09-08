import { describe, expect, it } from "vitest";
import {
  ALLOWANCES,
  ALLOWED_RAW_DATE_INPUTS,
  applyAllowances,
  findElapsedTime,
  findHandCutToday,
  findHandWrittenValidators,
  findInlineViewerZone,
  findRawDateInputs,
  findSecondDisplay,
  findShapeLiterals,
  findStaleAllowances,
  stripComments,
} from "./rules.mjs";

const APP = "apps/web/src/lib/thing.ts";

describe("comments are blanked, not removed", () => {
  it("keeps the text the same length so every reported line is the real line", () => {
    const source = "const a = 1;\n// 2 hours ago\nconst b = /^\\d{4}-\\d{2}-\\d{2}$/;\n";
    const blanked = stripComments(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split("\n")).toHaveLength(source.split("\n").length);
    // The literal is on line 3 of the file and must be reported there.
    expect(findShapeLiterals(APP, source)[0].line).toBe(3);
  });

  it("reads nothing in a comment, so ordinary English cannot fail a build", () => {
    const source = "// The date is 2026-02-30 and the zone is /^[+-]\\d{2}:?\\d{2}$/ ago.\n";
    expect(findShapeLiterals(APP, source)).toEqual([]);
    expect(findElapsedTime(APP, source)).toEqual([]);
  });

  it("does not read a URL as the start of a comment", () => {
    expect(stripComments('const u = "https://example.test/a";\n')).toContain("example.test");
  });
});

describe("one shape for each of the four things a date can be", () => {
  it("catches each shape written out as a literal", () => {
    const cases = [
      ["const a = /^\\d{4}-\\d{2}-\\d{2}$/;", "the civil date"],
      ["const a = /^\\d{4}-\\d{2}-\\d{2}$/u;", "the civil date"],
      ["const a = /^([01]\\d|2[0-3]):[0-5]\\d$/;", "the wall-clock time"],
      ["const a = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/;", "the canonical"],
      ["const a = /^[+-]\\d{2}:?\\d{2}$/;", "the fixed-offset"],
    ];
    for (const [source, expected] of cases) {
      const found = findShapeLiterals(APP, source);
      expect(found, source).toHaveLength(1);
      expect(found[0].detail, source).toContain(expected);
    }
  });

  it("reports a full instant once, not also as the civil date inside it", () => {
    const source = "const a = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/;";
    expect(findShapeLiterals(APP, source)).toHaveLength(1);
  });

  it("says nothing about the one home, which is where the shapes are defined", () => {
    const source = "export const CIVIL_DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/u;";
    expect(findShapeLiterals("packages/civil-time/src/civil-date.ts", source)).toEqual([]);
    expect(findShapeLiterals(APP, source)).toHaveLength(1);
  });
});

describe("one answer to 'is this a real day' and 'is this a zone'", () => {
  it("catches the calendar round trip in both shapes the copies took", () => {
    expect(
      findHandWrittenValidators(APP, "if (r.getUTCFullYear() !== year) return false;"),
    ).toHaveLength(1);
    expect(
      findHandWrittenValidators(APP, "return p.toISOString().slice(0, 10) === value;"),
    ).toHaveLength(1);
  });

  it("catches a formatter constructed to probe a zone", () => {
    const source =
      'try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { return false; }';
    const found = findHandWrittenValidators(APP, source);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("FIXED OFFSET");
  });

  it("says nothing about the one home", () => {
    const source = "if (roundTrip.getUTCFullYear() !== year) return false;";
    expect(findHandWrittenValidators("packages/civil-time/src/civil-date.ts", source)).toEqual([]);
  });
});

describe("one 'today' and one reading of the viewer's zone", () => {
  it("catches a civil date cut out of an ISO string", () => {
    expect(findHandCutToday(APP, "const t = new Date().toISOString().slice(0, 10);")).toHaveLength(
      1,
    );
  });

  it("catches the viewer's zone resolved inline", () => {
    const source = "const z = Intl.DateTimeFormat().resolvedOptions().timeZone;";
    expect(findInlineViewerZone(APP, source)).toHaveLength(1);
    expect(findInlineViewerZone("packages/civil-time/src/time-zone.ts", source)).toEqual([]);
  });
});

describe("one display of a date, a time or a moment", () => {
  it("catches a formatter built outside the display home", () => {
    const source = 'new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(at);';
    expect(findSecondDisplay(APP, source)).toHaveLength(1);
    expect(
      findSecondDisplay("packages/design-system/src/lib/formatters/instant.ts", source),
    ).toEqual([]);
  });

  it("catches the toLocale date family", () => {
    expect(findSecondDisplay(APP, "at.toLocaleDateString();")).toHaveLength(1);
    expect(findSecondDisplay(APP, "at.toLocaleTimeString();")).toHaveLength(1);
    expect(findSecondDisplay(APP, "new Date(v).toLocaleString();")).toHaveLength(1);
  });

  it("leaves number formatting alone — that is money's question, not this one", () => {
    expect(findSecondDisplay(APP, "const size = `${bytes.toLocaleString()} bytes`;")).toEqual([]);
  });

  it("leaves the calendar grid's own civil-date module alone", () => {
    const source = 'new Intl.DateTimeFormat(locale, { weekday: "long" });';
    const home = "packages/design-system/src/lib/components/calendar-grid/civil-date.ts";
    expect(findSecondDisplay(home, source)).toEqual([]);
  });
});

describe("elapsed time is banned outright", () => {
  it("catches the API and the prose", () => {
    expect(findElapsedTime(APP, "new Intl.RelativeTimeFormat(locale);")).toHaveLength(1);
    expect(findElapsedTime(APP, "return `${String(minutes)} minutes ago`;")).toHaveLength(1);
    expect(findElapsedTime(APP, 'return "just now";')).toHaveLength(1);
  });

  it("leaves ordinary English alone", () => {
    expect(findElapsedTime(APP, 'const note = "the step before this one";')).toEqual([]);
    expect(findElapsedTime(APP, 'const chicago = "Chicago";')).toEqual([]);
  });
});

describe("the date field is one component, and the exceptions are closed", () => {
  it("fails a native date input on a surface that is not recorded", () => {
    const found = findRawDateInputs("apps/web/src/lib/new-screen.svelte", '<Input type="date" />');
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("DatePicker");
  });

  it("passes one that is recorded", () => {
    expect(findRawDateInputs(ALLOWED_RAW_DATE_INPUTS[0], '<Input type="date" />')).toEqual([]);
  });

  it("fails an allowance that no longer holds a date input", () => {
    const sources = new Map(ALLOWED_RAW_DATE_INPUTS.map((file) => [file, '<Input type="date" />']));
    expect(findStaleAllowances(sources)).toEqual([]);
    sources.set(ALLOWED_RAW_DATE_INPUTS[0], "<Input />");
    const stale = findStaleAllowances(sources);
    expect(stale).toHaveLength(1);
    expect(stale[0].file).toBe(ALLOWED_RAW_DATE_INPUTS[0]);
  });

  it("checks every allowance rather than every other one", () => {
    // A global regex reused across `.test()` calls carries lastIndex and skips alternate files —
    // which read as six allowances going stale at once the first time this ran.
    const sources = new Map(ALLOWED_RAW_DATE_INPUTS.map((file) => [file, '<Input type="date" />']));
    expect(findStaleAllowances(sources)).toEqual([]);
  });
});

describe("the recorded allowances", () => {
  it("drops exactly the finding each one names, and nothing else", () => {
    // Every allowance is exercised, so none of them reports itself stale; the one finding that is
    // NOT covered — same rule, different file — has to survive.
    const covered = ALLOWANCES.map((allowance, index) => ({
      rule: allowance.rule,
      file: allowance.file,
      line: index + 1,
      detail: "covered",
    }));
    const real = { rule: ALLOWANCES[0].rule, file: APP, line: 1, detail: "not covered" };
    const { problems } = applyAllowances([...covered, real]);
    expect(problems).toEqual([real]);
  });

  it("covers a rule for ONE file, never for the rule everywhere", () => {
    // The allowance is a pair. A finding of the same rule in another file is untouched, which is
    // what keeps a recorded exception from quietly becoming a switched-off rule.
    const elsewhere = {
      rule: ALLOWANCES[0].rule,
      file: "apps/web/src/lib/other.ts",
      line: 3,
      detail: "e",
    };
    const covered = ALLOWANCES.map((allowance) => ({ ...allowance, line: 1, detail: "c" }));
    const { problems } = applyAllowances([...covered, elsewhere]);
    expect(problems).toEqual([elsewhere]);
  });

  it("fails an allowance that covered nothing this run", () => {
    const { problems } = applyAllowances([]);
    expect(problems).toHaveLength(ALLOWANCES.length);
    expect(problems.every((one) => one.rule === "stale-allowance")).toBe(true);
  });

  it("keeps every allowance to a named file and a named rule, with a reason", () => {
    for (const allowance of ALLOWANCES) {
      expect(allowance.file).toMatch(/^(apps|packages)\//);
      expect(allowance.rule.length).toBeGreaterThan(0);
      expect(allowance.reason.length).toBeGreaterThan(40);
    }
  });
});
