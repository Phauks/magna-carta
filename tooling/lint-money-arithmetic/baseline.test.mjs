/*
 * The ratchet, in all four of its outcomes. baseline.mjs explains why a debt register beats an
 * allowance list; this proves the direction it turns — and in particular that a file whose count
 * FALLS fails, because that is the half a reader assumes is a warning and it is not.
 *
 * Run: `pnpm test tooling/lint-money-arithmetic`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BASELINE_NOTE,
  compareAgainstBaseline,
  parseBaseline,
  renderBaseline,
} from "./baseline.mjs";

const findings = (count) => Array.from({ length: count }, (unused, index) => ({ line: index + 1 }));
const REGISTER = fileURLToPath(new URL("./baseline.json", import.meta.url));

describe("the register as it is written down", () => {
  it("reads the committed one, which is the register this gate actually ratchets against", () => {
    const baseline = parseBaseline(readFileSync(REGISTER, "utf8"));
    expect(baseline.size).toBeGreaterThan(0);
    expect([...baseline.values()].every((count) => Number.isInteger(count) && count > 0)).toBe(
      true,
    );
  });

  it("refuses a count that is not a whole number of findings", () => {
    expect(() => parseBaseline('{"counts":{"a.ts":0}}')).toThrow();
    expect(() => parseBaseline('{"counts":{"a.ts":1.5}}')).toThrow();
    expect(() => parseBaseline('{"counts":{"a.ts":"two"}}')).toThrow();
    expect(() => parseBaseline('{"counts":{"a.ts":-1}}')).toThrow();
  });

  it("refuses a file with no counts rather than degrading to an empty register", () => {
    // An empty register would fail every file at once and be fixed by regenerating, which forgives
    // the debt it exists to hold.
    expect(() => parseBaseline("{}")).toThrow();
    expect(() => parseBaseline('{"counts":[]}')).toThrow();
  });

  it("renders sorted, drops anything that reached zero, and carries its own explanation", () => {
    const text = renderBaseline(
      new Map([
        ["z.ts", 2],
        ["a.ts", 1],
        ["gone.ts", 0],
      ]),
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(text).counts)).toEqual(["a.ts", "z.ts"]);
    expect(JSON.parse(text).note).toBe(BASELINE_NOTE);
  });

  it("round-trips: what it renders is what it parses", () => {
    const counts = new Map([
      ["a.ts", 3],
      ["b.ts", 1],
    ]);
    expect([...parseBaseline(renderBaseline(counts))]).toEqual([...counts]);
  });
});

describe("the four outcomes", () => {
  const baseline = new Map([
    ["recorded.ts", 3],
    ["paid-down.ts", 4],
    ["finished.ts", 2],
  ]);
  const known = new Set(["recorded.ts", "paid-down.ts", "finished.ts", "fresh.ts"]);

  it("passes a file at its recorded count", () => {
    const { overBudget, newlyClean } = compareAgainstBaseline(
      new Map([
        ["recorded.ts", findings(3)],
        ["paid-down.ts", findings(4)],
        ["finished.ts", findings(2)],
      ]),
      baseline,
      known,
    );
    expect(overBudget).toEqual([]);
    expect(newlyClean).toEqual([]);
  });

  it("fails a file that is not in the register at all, so new debt cannot arrive quietly", () => {
    const { overBudget } = compareAgainstBaseline(
      new Map([
        ["recorded.ts", findings(3)],
        ["paid-down.ts", findings(4)],
        ["finished.ts", findings(2)],
        ["fresh.ts", findings(1)],
      ]),
      baseline,
      known,
    );
    expect(overBudget).toHaveLength(1);
    expect(overBudget[0].file).toBe("fresh.ts");
    expect(overBudget[0].allowed).toBe(0);
  });

  it("fails a file that went over, naming both numbers", () => {
    const { overBudget } = compareAgainstBaseline(
      new Map([
        ["recorded.ts", findings(4)],
        ["paid-down.ts", findings(4)],
        ["finished.ts", findings(2)],
      ]),
      baseline,
      known,
    );
    expect(overBudget).toHaveLength(1);
    expect(overBudget[0].allowed).toBe(3);
    expect(overBudget[0].findings).toHaveLength(4);
  });

  it("FAILS a file that went under, so the ratchet cannot leave slack behind", () => {
    const { overBudget, newlyClean } = compareAgainstBaseline(
      new Map([
        ["recorded.ts", findings(3)],
        ["paid-down.ts", findings(1)],
        ["finished.ts", findings(2)],
      ]),
      baseline,
      known,
    );
    expect(overBudget).toEqual([]);
    expect(newlyClean).toHaveLength(1);
    expect(newlyClean[0]).toEqual({
      file: "paid-down.ts",
      allowed: 4,
      actual: 1,
      gone: false,
    });
  });

  it("asks for the line to be deleted once a file reaches zero", () => {
    const { newlyClean } = compareAgainstBaseline(
      new Map([
        ["recorded.ts", findings(3)],
        ["paid-down.ts", findings(4)],
      ]),
      baseline,
      known,
    );
    expect(newlyClean).toHaveLength(1);
    expect(newlyClean[0].file).toBe("finished.ts");
    expect(newlyClean[0].actual).toBe(0);
    expect(newlyClean[0].gone).toBe(false);
  });

  it("says so when the recorded file is gone from the tree entirely", () => {
    const { newlyClean } = compareAgainstBaseline(
      new Map([
        ["recorded.ts", findings(3)],
        ["paid-down.ts", findings(4)],
      ]),
      baseline,
      new Set(["recorded.ts", "paid-down.ts"]),
    );
    expect(newlyClean[0].gone).toBe(true);
  });

  it("reports in path order, so two runs read the same way", () => {
    const { overBudget } = compareAgainstBaseline(
      new Map([
        ["z.ts", findings(1)],
        ["a.ts", findings(1)],
      ]),
      new Map(),
      new Set(["z.ts", "a.ts"]),
    );
    expect(overBudget.map((one) => one.file)).toEqual(["a.ts", "z.ts"]);
  });
});
