import { describe, expect, it } from "vitest";
import {
  assertValidAdrRecord,
  collectAdrRecords,
  parseAdrFile,
  registerLineFor,
  serializeAdrFile,
  summaryFor,
  validateAdrRecord,
} from "./adr-file.mjs";

// See the note in parse-register.test.mjs: build ids by concatenation to satisfy the
// process-refs gate (no literal "ADR-" + digits in source).
const id = (number) => `ADR-${String(number).padStart(4, "0")}`;

const record = {
  number: 67,
  slug: "route-metadata-model",
  status: "Accepted",
  date: "2026-06-04",
  area: "API",
  summary: null,
  body: "Route-metadata model — one chokepoint.",
};

describe("adr-file round trip", () => {
  it("serialize then parse is identity on known fields", () => {
    expect(parseAdrFile(serializeAdrFile(record))).toEqual(record);
  });

  it("omits summary from frontmatter when absent", () => {
    expect(serializeAdrFile(record)).not.toContain("summary:");
  });

  it("includes summary when present", () => {
    const out = serializeAdrFile({ ...record, summary: "Short line." });
    expect(out).toContain("summary: Short line.");
  });

  it("emits an empty date with no trailing space and round-trips", () => {
    const dateless = { ...record, date: "" };
    const out = serializeAdrFile(dateless);
    expect(out).toContain("\ndate:\n");
    expect(out).not.toContain("date: \n");
    expect(parseAdrFile(out)).toEqual(dateless);
  });
});

describe("registerLineFor", () => {
  it("renders the bullet from fields, defaulting summary to the body first line", () => {
    expect(registerLineFor(record)).toBe(
      `- **${id(67)}** · Accepted · 2026-06-04 · API — Route-metadata model — one chokepoint.`,
    );
  });

  it("omits the date field when null", () => {
    expect(registerLineFor({ ...record, date: null })).toBe(
      `- **${id(67)}** · Accepted · API — Route-metadata model — one chokepoint.`,
    );
  });

  it("prefers an explicit summary over the body", () => {
    const out = registerLineFor({ ...record, summary: "Short line." });
    expect(out).toBe(`- **${id(67)}** · Accepted · 2026-06-04 · API — Short line.`);
  });
});

describe("summaryFor", () => {
  it("falls back to the body's first line", () => {
    expect(summaryFor(record)).toBe("Route-metadata model — one chokepoint.");
  });

  it("prefers the explicit summary", () => {
    expect(summaryFor({ ...record, summary: "Short line." })).toBe("Short line.");
  });
});

// The degradation these guards exist to stop: four fragments were authored with a Markdown title in
// place of frontmatter, parsed into all-empty records, and rendered register bullets whose status
// and area were blank and whose decision text was the title. Nothing failed, so it shipped.
describe("parseAdrFile rejects a fragment that is not frontmatter-first", () => {
  const titleFirst = [
    "# Document-automation assembly engine — in-house OOXML merge in a Worker",
    "",
    "**Status:** Proposed",
    "**Date:** 2026-08-04",
    "**Area:** Document Automation",
    "",
    "## Context",
    "",
    "Prose.",
  ].join("\n");

  it("throws instead of returning an empty record", () => {
    expect(() => parseAdrFile(titleFirst, "pending/example.md")).toThrow(
      /missing the opening .* frontmatter fence/,
    );
  });

  it("names the file in the message", () => {
    expect(() => parseAdrFile(titleFirst, "pending/example.md")).toThrow(/pending\/example\.md/);
  });

  it("throws when the closing fence is missing", () => {
    expect(() => parseAdrFile("---\nslug: x\nstatus: Accepted\n")).toThrow(
      /missing the closing .* frontmatter fence/,
    );
  });

  it("throws on an unknown frontmatter key rather than silently dropping it", () => {
    const typo = "---\nslug: x\nstatuss: Accepted\narea: API\n---\n\nDecision.\n";
    expect(() => parseAdrFile(typo)).toThrow(/unknown frontmatter line "statuss: Accepted"/);
  });

  it("tolerates a blank line inside the frontmatter", () => {
    const spaced = "---\nslug: x\n\nstatus: Accepted\narea: API\n---\n\nDecision.\n";
    expect(parseAdrFile(spaced).status).toBe("Accepted");
  });
});

describe("validateAdrRecord", () => {
  it("passes a well-formed record", () => {
    expect(validateAdrRecord(record)).toEqual([]);
  });

  it("reports every empty required field at once", () => {
    const empty = { ...record, slug: "", status: "", area: "" };
    const problems = validateAdrRecord(empty, "pending/example.md");
    expect(problems).toHaveLength(3);
    expect(problems.every((problem) => problem.startsWith("pending/example.md:"))).toBe(true);
  });

  it("rejects a status outside the lifecycle", () => {
    expect(validateAdrRecord({ ...record, status: "Draft" }).join("\n")).toMatch(
      /does not start with a lifecycle word/,
    );
  });

  it("accepts a qualified status", () => {
    expect(validateAdrRecord({ ...record, status: "Accepted (amended 2026-06-17)" })).toEqual([]);
    expect(validateAdrRecord({ ...record, status: '"Proposed — owner decision pending"' })).toEqual(
      [],
    );
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(validateAdrRecord({ ...record, date: "4 August 2026" }).join("\n")).toMatch(
      /is not YYYY-MM-DD/,
    );
  });

  it("allows an absent date", () => {
    expect(validateAdrRecord({ ...record, date: "" })).toEqual([]);
  });

  it("rejects a body whose first line is a heading, since the register would print it", () => {
    const heading = { ...record, body: "# A title\n\nProse." };
    expect(validateAdrRecord(heading).join("\n")).toMatch(
      /would render the body's Markdown heading/,
    );
  });

  it("allows a heading deeper in the body when a summary is given", () => {
    const sectioned = {
      ...record,
      summary: "Short line.",
      body: "Opening.\n\n## Context\n\nProse.",
    };
    expect(validateAdrRecord(sectioned)).toEqual([]);
  });

  it("rejects a record with nothing to render", () => {
    expect(validateAdrRecord({ ...record, body: "" }).join("\n")).toMatch(
      /nothing to render in the register/,
    );
  });
});

describe("assertValidAdrRecord", () => {
  it("returns the record when valid", () => {
    expect(assertValidAdrRecord(record)).toBe(record);
  });

  it("throws with every problem in the message", () => {
    expect(() => assertValidAdrRecord({ ...record, status: "", area: "" })).toThrow(
      /status is empty[\s\S]*area is empty/,
    );
  });
});

const wellFormed = "---\nslug: good\nstatus: Accepted\narea: API\n---\n\nA decision.\n";
const titleFirst = "# A title\n\n**Status:** Proposed\n";
const missingArea = "---\nslug: thin\nstatus: Accepted\n---\n\nA decision.\n";

describe("collectAdrRecords", () => {
  it("returns a record per key when every entry is sound", () => {
    const { records, problems } = collectAdrRecords([
      { key: "good.md", context: "pending/good.md", markdown: wellFormed },
    ]);
    expect(problems).toEqual([]);
    expect(records.get("good.md").slug).toBe("good");
  });

  it("reports every offender rather than stopping at the first", () => {
    const { problems } = collectAdrRecords([
      { key: "a.md", context: "pending/a.md", markdown: titleFirst },
      { key: "b.md", context: "pending/b.md", markdown: missingArea },
      { key: "c.md", context: "pending/c.md", markdown: wellFormed },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/pending\/a\.md/);
    expect(problems.join("\n")).toMatch(/pending\/b\.md/);
  });

  it("withholds an invalid record so a caller cannot fold it by accident", () => {
    const { records } = collectAdrRecords([
      { key: "a.md", context: "pending/a.md", markdown: missingArea },
      { key: "c.md", context: "pending/c.md", markdown: wellFormed },
    ]);
    expect([...records.keys()]).toEqual(["c.md"]);
  });

  it("keys by context when no key is given", () => {
    const { records } = collectAdrRecords([{ context: "pending/good.md", markdown: wellFormed }]);
    expect(records.has("pending/good.md")).toBe(true);
  });
});
