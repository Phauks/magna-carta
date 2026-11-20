import { describe, expect, it } from "vitest";
import { matchBankLines } from "../src/matching.ts";

const bank = (id: string, postedOn: string, amountMinor: number, pending = false) => ({
  id,
  postedOn,
  amountMinor,
  pending,
});
const book = (id: string, effectiveOn: string, amountMinor: number) => ({
  id,
  effectiveOn,
  amountMinor,
});

describe("matchBankLines", () => {
  it("marks a line In Books when an entry of the same amount is within the window", () => {
    const result = matchBankLines(
      [bank("b1", "2026-11-10", 50_000)],
      [book("k1", "2026-11-08", 50_000)],
    );
    expect(result.get("b1")).toEqual({ status: "inBooks", bookLineId: "k1" });
  });

  it("leaves a line Not in Books when the only entry is outside the window or the wrong sign", () => {
    const result = matchBankLines(
      [bank("b1", "2026-11-20", 50_000), bank("b2", "2026-11-20", -2_500)],
      [book("k1", "2026-11-01", 50_000), book("k2", "2026-11-20", 2_500)],
    );
    expect(result.get("b1")).toEqual({ status: "notInBooks" });
    expect(result.get("b2")).toEqual({ status: "notInBooks" });
  });

  it("uses each book entry once, so two equal deposits need two entries", () => {
    const result = matchBankLines(
      [bank("b1", "2026-11-10", 10_000), bank("b2", "2026-11-11", 10_000)],
      [book("k1", "2026-11-10", 10_000)],
    );
    expect(result.get("b1")).toEqual({ status: "inBooks", bookLineId: "k1" });
    expect(result.get("b2")).toEqual({ status: "notInBooks" });
  });

  it("takes the closest entry in date", () => {
    const result = matchBankLines(
      [bank("b1", "2026-11-10", 10_000)],
      [book("k1", "2026-11-04", 10_000), book("k2", "2026-11-11", 10_000)],
    );
    expect(result.get("b1")).toEqual({ status: "inBooks", bookLineId: "k2" });
  });

  it("never adds entries together to explain a deposit", () => {
    const result = matchBankLines(
      [bank("b1", "2026-11-17", 318_000)],
      [book("k1", "2026-11-16", 118_000), book("k2", "2026-11-16", 200_000)],
    );
    expect(result.get("b1")).toEqual({ status: "notInBooks" });
  });

  it("reports a pending line as Pending and lets it take no entry", () => {
    const result = matchBankLines(
      [bank("b1", "2026-11-10", 10_000, true), bank("b2", "2026-11-12", 10_000)],
      [book("k1", "2026-11-10", 10_000)],
    );
    expect(result.get("b1")).toEqual({ status: "pending" });
    expect(result.get("b2")).toEqual({ status: "inBooks", bookLineId: "k1" });
  });
});
