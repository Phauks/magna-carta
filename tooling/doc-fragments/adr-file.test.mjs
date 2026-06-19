import { describe, expect, it } from "vitest";
import { parseAdrFile, registerLineFor, serializeAdrFile } from "./adr-file.mjs";

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
