import { describe, expect, it } from "vitest";
import {
  appendAscendingCursorPredicate,
  appendCursorPredicate,
  appendCursorPredicateOnColumn,
  assembleCompositePage,
  compositeKeysetClause,
  decodeCompositeCursor,
  decodeCursor,
  encodeCompositeCursor,
  encodeCursor,
} from "../src/cursor-pagination.ts";

// The keyset helpers, and the one property the ascending counterpart exists to preserve: the wire
// contract does NOT fork. A cursor is the same opaque (sort key, id) pair whichever direction minted
// it, and only the comparison flips — so a client holding one never has to know which read made it.

describe("the cursor encoding is one contract in both directions", () => {
  it("round-trips byte-identically regardless of which read minted it", () => {
    const cursor = encodeCursor("2026-09-07", "matterDeadline_x");
    expect(decodeCursor(cursor)).toEqual({ createdAt: "2026-09-07", id: "matterDeadline_x" });
    // The encoding is the shipped btoa(JSON) shape, byte-for-byte, so a cursor minted by one deploy
    // still decodes on the next.
    expect(cursor).toBe(btoa(JSON.stringify({ c: "2026-09-07", i: "matterDeadline_x" })));
  });

  it("treats a malformed or tampered cursor as the first page", () => {
    expect(decodeCursor("not-base64-at-all")).toBeUndefined();
    expect(decodeCursor(btoa(JSON.stringify({ c: 5, i: null })))).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });
});

describe("the keyset predicates", () => {
  it("descend for a newest-first read and ascend for a soonest-first one", () => {
    const descendingConditions: string[] = [];
    const descendingBindings: unknown[] = [];
    appendCursorPredicate(descendingConditions, descendingBindings, {
      createdAt: "2026-09-07",
      id: "row_x",
    });
    expect(descendingConditions[0]).toContain("created_at < ?");

    const ascendingConditions: string[] = [];
    const ascendingBindings: unknown[] = [];
    appendAscendingCursorPredicate(ascendingConditions, ascendingBindings, {
      createdAt: "2026-09-07",
      id: "row_x",
    });
    expect(ascendingConditions[0]).toContain("created_at > ?");
    // Both push the same three bindings in the same order, so a caller cannot bind one and read the
    // other by mistake.
    expect(ascendingBindings).toEqual(descendingBindings);
  });

  it("is a no-op without a cursor, so a list statement reads the same on page one", () => {
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    appendAscendingCursorPredicate(conditions, bindings, undefined);
    appendCursorPredicateOnColumn(conditions, bindings, undefined, {
      sortColumn: "due_on",
      idColumn: "id",
      ascending: true,
    });
    expect(conditions).toEqual([]);
    expect(bindings).toEqual([]);
  });

  it("names a caller-supplied sort column for a table that does not order by created_at", () => {
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    appendCursorPredicateOnColumn(
      conditions,
      bindings,
      { createdAt: "2026-09-07", id: "matterDeadline_x" },
      { sortColumn: "due_on", idColumn: "id", ascending: true },
    );
    expect(conditions[0]).toBe("(due_on > ? OR (due_on = ? AND id > ?))");
    expect(bindings).toEqual(["2026-09-07", "2026-09-07", "matterDeadline_x"]);
  });
});

describe("an ascending page walk visits every row exactly once", () => {
  // A fixture set with a deliberate tie on the sort key: the id tiebreak is what makes the order
  // total, and a walk without it repeats or skips rows at the page boundary.
  const rows = [
    { due_on: "2026-09-01", id: "a" },
    { due_on: "2026-09-01", id: "b" },
    { due_on: "2026-09-02", id: "c" },
    { due_on: "2026-09-03", id: "d" },
    { due_on: "2026-09-03", id: "e" },
  ];

  it("walks the whole set in order with no duplicate and no gap", () => {
    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let page = 0; page < 10; page += 1) {
      const remaining = rows.filter(
        (row) =>
          cursor === undefined ||
          row.due_on > cursor.createdAt ||
          (row.due_on === cursor.createdAt && row.id > cursor.id),
      );
      const kept = remaining.slice(0, 2);
      seen.push(...kept.map((row) => row.id));
      if (remaining.length <= 2) break;
      const last = kept.at(-1);
      if (last === undefined) break;
      cursor = decodeCursor(encodeCursor(last.due_on, last.id));
    }
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
    expect(new Set(seen).size).toBe(rows.length);
  });
});

describe("the three-part keyset", () => {
  // The set this exists for: a value history where two assertions share a date and are ordered by
  // which was recorded later. Collapsing the middle column would put `b` — a correction — after the
  // figure it corrects on some pages and before it on others, depending only on identifier order.
  const rows = [
    { as_of_date: "2026-03-14", recorded_at: "2026-03-20T00:00:00.000Z", id: "b" },
    { as_of_date: "2026-03-14", recorded_at: "2026-03-15T00:00:00.000Z", id: "a" },
    { as_of_date: "2026-02-01", recorded_at: "2026-02-02T00:00:00.000Z", id: "d" },
    { as_of_date: "2026-02-01", recorded_at: "2026-02-02T00:00:00.000Z", id: "c" },
    { as_of_date: "2026-01-01", recorded_at: "2026-01-02T00:00:00.000Z", id: "e" },
  ];

  function after(cursor: ReturnType<typeof decodeCompositeCursor>) {
    return rows.filter(
      (row) =>
        cursor === undefined ||
        row.as_of_date < cursor.primary ||
        (row.as_of_date === cursor.primary && row.recorded_at < cursor.secondary) ||
        (row.as_of_date === cursor.primary &&
          row.recorded_at === cursor.secondary &&
          row.id < cursor.id),
    );
  }

  it("walks the whole set in order with no duplicate and no gap, page size 2", () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page += 1) {
      const remaining = after(decodeCompositeCursor(cursor ?? undefined));
      const built = assembleCompositePage(
        remaining.slice(0, 3),
        2,
        (row) => ({ primary: row.as_of_date, secondary: row.recorded_at, id: row.id }),
        (row) => row.id,
      );
      seen.push(...built.data);
      cursor = built.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(["b", "a", "d", "c", "e"]);
  });

  it("separates two rows that agree on the first two columns", () => {
    // `d` and `c` share both the as-of date and the recorded instant, so only the identifier tells
    // them apart. Without the third comparison the second page would re-serve `d` forever.
    const cursor = decodeCompositeCursor(
      encodeCompositeCursor("2026-02-01", "2026-02-02T00:00:00.000Z", "d"),
    );
    expect(after(cursor).map((row) => row.id)).toEqual(["c", "e"]);
  });

  it("spells the comparison out in a form the (primary, secondary) index can seek on", () => {
    const bindings: unknown[] = [];
    const clause = compositeKeysetClause(
      bindings,
      decodeCompositeCursor(encodeCompositeCursor("2026-02-01", "2026-02-02T00:00:00.000Z", "d")),
      { primary: "as_of_date", secondary: "recorded_at", id: "id" },
      false,
    );
    expect(clause).toContain("as_of_date < ?");
    expect(clause).toContain("as_of_date = ? AND recorded_at < ?");
    expect(clause).toContain("as_of_date = ? AND recorded_at = ? AND id < ?");
    expect(bindings).toHaveLength(6);
  });

  it("emits nothing and binds nothing without a cursor", () => {
    const bindings: unknown[] = [];
    expect(
      compositeKeysetClause(bindings, undefined, { primary: "a", secondary: "b", id: "id" }, true),
    ).toBe("");
    expect(bindings).toHaveLength(0);
  });

  it("does not fork the wire contract: a three-part cursor still decodes as its two-part prefix", () => {
    // The older reader gets a COARSER boundary, never a wrong one — it stops at the as-of date
    // rather than inside it, so it may re-serve rows it has seen and can never skip one.
    const token = encodeCompositeCursor("2026-02-01", "2026-02-02T00:00:00.000Z", "d");
    expect(decodeCursor(token)).toEqual({ createdAt: "2026-02-01", id: "d" });
  });

  it("treats a two-part cursor and a tampered token as the first page", () => {
    expect(decodeCompositeCursor(encodeCursor("2026-02-01", "d"))).toBeUndefined();
    expect(decodeCompositeCursor("not-base64-at-all")).toBeUndefined();
  });
});
