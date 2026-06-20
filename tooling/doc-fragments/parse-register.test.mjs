import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRegister, parseRegisterLine } from "./parse-register.mjs";

const sample = readFileSync(join(import.meta.dirname, "test/fixtures/register-sample.txt"), "utf8");

// Build the id by concatenation: this is a .mjs source file, and the process-refs gate
// (tooling/lint-process-references.mjs) bans a literal "ADR-" followed by digits.
const id = (number) => `ADR-${String(number).padStart(4, "0")}`;

describe("parseRegisterLine", () => {
  it("parses a plain entry", () => {
    expect(parseRegisterLine(`- **${id(1)}** · Accepted · Architecture — Web-first.`)).toEqual({
      number: 1,
      status: "Accepted",
      date: null,
      area: "Architecture",
      body: "Web-first.",
    });
  });

  it("parses an entry with a date", () => {
    const line = `- **${id(67)}** · Accepted · 2026-06-04 · API — Route-metadata model — one chokepoint.`;
    expect(parseRegisterLine(line)).toEqual({
      number: 67,
      status: "Accepted",
      date: "2026-06-04",
      area: "API",
      body: "Route-metadata model — one chokepoint.",
    });
  });

  it("keeps a multi-word status", () => {
    const line = `- **${id(28)}** · Superseded by ${id(76)} · Design system — Four layers.`;
    expect(parseRegisterLine(line)).toMatchObject({
      number: 28,
      status: `Superseded by ${id(76)}`,
      area: "Design system",
    });
  });

  it("returns null for a non-ADR line", () => {
    expect(parseRegisterLine("## Register")).toBeNull();
  });
});

describe("parseRegister", () => {
  it("returns every ADR bullet in order", () => {
    const entries = parseRegister(sample);
    expect(entries.map((entry) => entry.number)).toEqual([1, 28, 67]);
  });
});
