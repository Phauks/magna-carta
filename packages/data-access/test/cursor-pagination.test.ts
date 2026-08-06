import { describe, expect, it } from "vitest";
import {
  appendAscendingCursorPredicate,
  appendCursorPredicate,
  appendCursorPredicateOnColumn,
  decodeCursor,
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
