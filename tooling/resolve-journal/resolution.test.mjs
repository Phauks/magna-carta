/*
 * The resolution rules, driven against the merge shapes that actually happened.
 *
 * These are pure functions over journal entries, so the fixtures are the whole story: a branch
 * merged late, two branches merged at once, a lineage already inverted on disk.
 */
import { describe, expect, it } from "vitest";
import { applyOrderIsIntegrationOrder, resolveJournal } from "./resolution.mjs";
import { nextTagAbove, slugOf, stampOf } from "./stamp.mjs";

/** A journal entry in drizzle's shape. */
function entry(idx, tag) {
  return { idx, version: "6", when: 0, tag, breakpoints: true };
}

const NOW = new Date("2026-09-15T18:00:00Z");
const tagsOf = (entries) => [...entries].sort((a, b) => a.idx - b.idx).map((each) => each.tag);

describe("nextTagAbove", () => {
  it("uses the wall clock when the clock is already above the head", () => {
    expect(nextTagAbove("20260101T000000_baseline", "matter-notes", NOW)).toBe(
      "20260915T180000_matter-notes",
    );
  });

  it("steps one second past a head the clock cannot clear", () => {
    // A head stamped from a machine running ahead, or a second re-stamp inside the same second.
    // Sorting above the head is the only thing that has to be true, so the clock gives way to it.
    expect(nextTagAbove("20261231T235959_later", "matter-notes", NOW)).toBe(
      "20270101T000000_matter-notes",
    );
    expect(nextTagAbove("20260915T180000_other", "matter-notes", NOW)).toBe(
      "20260915T180001_matter-notes",
    );
  });

  it("stamps from an empty lineage without a head to clear", () => {
    expect(nextTagAbove("", "baseline", NOW)).toBe("20260915T180000_baseline");
  });

  it("keeps the slug intact, however many words it has", () => {
    expect(slugOf("20260811T224252_self-serve-registration-and-invitations")).toBe(
      "self-serve-registration-and-invitations",
    );
    expect(stampOf(NOW)).toBe("20260915T180000");
  });
});

describe("resolveJournal", () => {
  it("re-stamps a branch's migration above a head that moved while the branch was open", () => {
    // The September 2026 shape exactly: cut on the 11th, merged after a migration dated the 14th
    // had landed. Resolving the conflict by keeping both entries leaves the branch's migration
    // applying FIRST, because apply order is by tag.
    const common = [entry(0, "20260704T041516_baseline")];
    const trunk = [...common, entry(1, "20260914T120000_task-rungs")];
    const branch = [...common, entry(1, "20260911T090000_matter-notes")];

    const { entries, renames } = resolveJournal({ trunk, sides: [branch, trunk], now: NOW });

    expect(renames).toEqual([
      { from: "20260911T090000_matter-notes", to: "20260915T180000_matter-notes" },
    ]);
    expect(tagsOf(entries)).toEqual([
      "20260704T041516_baseline",
      "20260914T120000_task-rungs",
      "20260915T180000_matter-notes",
    ]);
    expect(applyOrderIsIntegrationOrder(entries)).toBe(true);
  });

  it("leaves a branch migration alone when it already sorts above the head", () => {
    const trunk = [entry(0, "20260704T041516_baseline")];
    const branch = [...trunk, entry(1, "20260914T120000_matter-notes")];
    const { entries, renames } = resolveJournal({ trunk, sides: [branch, trunk], now: NOW });
    expect(renames).toEqual([]);
    expect(tagsOf(entries)).toEqual(["20260704T041516_baseline", "20260914T120000_matter-notes"]);
  });

  it("gives idx densely, trunk first, whatever idx the sides claimed", () => {
    // Both sides appended at idx 1 — the naive union's other half, two entries sharing an idx that
    // names a meta/ snapshot.
    const trunk = [entry(0, "20260704T041516_baseline"), entry(1, "20260914T120000_task-rungs")];
    const branch = [entry(0, "20260704T041516_baseline"), entry(1, "20260911T090000_matter-notes")];
    const { entries } = resolveJournal({ trunk, sides: [branch, trunk], now: NOW });
    expect(entries.map((each) => each.idx)).toEqual([0, 1, 2]);
  });

  it("keeps several branch migrations in the order they were integrated in", () => {
    // A later migration may depend on an earlier one, so integration order is what survives; the
    // tags are made to agree with it rather than the other way round. Both land in the same second
    // here, which is why the second one has to step past the first.
    const trunk = [entry(0, "20260704T041516_baseline"), entry(1, "20260914T120000_task-rungs")];
    const branch = [
      entry(0, "20260704T041516_baseline"),
      entry(1, "20260911T090000_matter-notes"),
      entry(2, "20260912T090000_matter-note-index"),
    ];
    const { entries, renames } = resolveJournal({ trunk, sides: [branch, trunk], now: NOW });
    expect(renames.map((each) => each.to)).toEqual([
      "20260915T180000_matter-notes",
      "20260915T180001_matter-note-index",
    ]);
    expect(tagsOf(entries).slice(-2)).toEqual([
      "20260915T180000_matter-notes",
      "20260915T180001_matter-note-index",
    ]);
    expect(applyOrderIsIntegrationOrder(entries)).toBe(true);
  });

  it("repairs a single inverted journal with no conflict to resolve", () => {
    // The repair case: the bad merge already landed on the branch, so there is one journal and it
    // is wrong. `main` still says which tags are immutable, so the answer is the same one.
    const trunk = [entry(0, "20260704T041516_baseline")];
    const inverted = [
      entry(0, "20260704T041516_baseline"),
      entry(1, "20260914T120000_task-rungs"),
      entry(2, "20260911T090000_matter-notes"),
    ];
    const { entries, renames } = resolveJournal({ trunk, sides: [inverted], now: NOW });
    expect(renames).toEqual([
      { from: "20260911T090000_matter-notes", to: "20260915T180000_matter-notes" },
    ]);
    expect(applyOrderIsIntegrationOrder(entries)).toBe(true);
  });

  it("refuses to drop a migration that is on main", () => {
    // A tag on main has deployed, so a resolution that loses it would leave the journal disagreeing
    // with every database in the fleet. There is no resolution to reach here, only a repair.
    const trunk = [entry(0, "20260704T041516_baseline"), entry(1, "20260914T120000_task-rungs")];
    expect(() =>
      resolveJournal({ trunk, sides: [[entry(0, "20260704T041516_baseline")]], now: NOW }),
    ).toThrow(/on main but in none of the journals/u);
  });
});

describe("applyOrderIsIntegrationOrder", () => {
  it("names the property the whole tool exists to establish", () => {
    expect(
      applyOrderIsIntegrationOrder([entry(0, "20260101T000000_a"), entry(1, "20260102T000000_b")]),
    ).toBe(true);
    expect(
      applyOrderIsIntegrationOrder([entry(0, "20260102T000000_b"), entry(1, "20260101T000000_a")]),
    ).toBe(false);
  });
});
