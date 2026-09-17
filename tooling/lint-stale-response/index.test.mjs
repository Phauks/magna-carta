import { describe, expect, it } from "vitest";
import { exemptionReason, fileIsExempt, findHandRolledStaleGuards } from "./rules.mjs";

// The rule catches the pair — incremented AND compared — and nothing else. Each near-miss below is a
// real shape from the web app that must not be flagged.

describe("the pair that means a staleness guard", () => {
  it("catches the shape the four screens had", () => {
    const guards = findHandRolledStaleGuards(`
class Record {
  #generation = 0;
  reset() { this.#generation += 1; }
  async load() {
    const generation = this.#generation;
    const rows = await read();
    if (generation !== this.#generation) return;
    this.rows = rows;
  }
}`);
    expect(guards).toHaveLength(1);
    expect(guards[0]?.field).toBe("#generation");
  });

  it("catches it under any name — the fifth copy called it #latest and used ++", () => {
    const guards = findHandRolledStaleGuards(`
class Search {
  #latest = 0;
  async run() {
    const ticket = (this.#latest += 1);
    await search();
    if (ticket !== this.#latest) return;
  }
}`);
    expect(guards[0]?.field).toBe("#latest");
  });

  it("reports each field once however many times it is compared", () => {
    const guards = findHandRolledStaleGuards(`
class Many {
  bump() { this.#g += 1; }
  a() { if (x !== this.#g) return; }
  b() { if (y !== this.#g) return; }
}`);
    expect(guards).toHaveLength(1);
  });
});

describe("what it must leave alone", () => {
  const cases = {
    "a counter that is only incremented — a tally, not a guard": `
class Metrics { record() { this.#failures += 1; } }`,
    "a field that is only compared — reading somebody else's state": `
class View { showing(id) { return id === this.#subject; } }`,
    "an increment and a comparison of DIFFERENT fields": `
class Mixed {
  bump() { this.#attempts += 1; }
  showing(id) { return id === this.#subject; }
}`,
    "a local variable rather than a private field": `
function run() { let generation = 0; generation += 1; if (generation !== 2) return; }`,
    "the shared primitive's own consumers": `
class Record {
  readonly #latest = new LatestOnly();
  async load() {
    const attempt = this.#latest.begin();
    const rows = await read();
    if (!attempt.current) return;
  }
}`,
  };

  for (const [description, source] of Object.entries(cases)) {
    it(description, () => {
      expect(findHandRolledStaleGuards(source)).toEqual([]);
    });
  }
});

describe("the escape hatch", () => {
  it("exempts a file that states a reason", () => {
    expect(
      fileIsExempt("// stale-response:allow — this counter times a poll, it guards nothing"),
    ).toBe(true);
  });

  it("reads the reason, and reports a bare marker as none", () => {
    expect(exemptionReason("// stale-response:allow — it guards nothing")).toBe(
      "it guards nothing",
    );
    expect(exemptionReason("// stale-response:allow")).toBe("");
    expect(exemptionReason("// unrelated")).toBeNull();
  });
});
