/*
 * One Save of a record's Contact card, pinned: only what changed is sent, a preference can be taken
 * away as well as given, one line is preferred at most, and the writes go in a safe order.
 */
import { describe, expect, it } from "vitest";
import type { ContactDraft, ContactRow } from "../src/lib/directory/contact-draft.ts";
import {
  firstRefusedLine,
  lineFromRow,
  newLine,
  planContactEdits,
  withPreferred,
} from "../src/lib/directory/contact-edit-plan.ts";

function row(id: string, address: string, preferred = false, permitted = true): ContactRow {
  return {
    id,
    kind: "email",
    value: address,
    use: "Work",
    isPrimary: false,
    state: {
      permitted,
      preferred,
      note: null,
      verificationStatus: "unverified",
      verifiedAt: null,
      verificationDetail: null,
    },
  };
}

function email(address: string): ContactDraft {
  return { kind: "email", address, use: "work" };
}

describe("saving the Contact card", () => {
  it("sends nothing for a card left as it was", () => {
    const lines = [lineFromRow(row("e1", "a@example.com", true), email("a@example.com"))];
    expect(planContactEdits(lines)).toEqual([]);
  });

  it("takes the preference away when its switch is turned off", () => {
    const lines = withPreferred(
      [lineFromRow(row("e1", "a@example.com", true), email("a@example.com"))],
      0,
      false,
    );
    expect(planContactEdits(lines)).toEqual([
      { kind: "update", row: lines[0]?.row, body: { preference: { preferred: false } } },
    ]);
  });

  it("keeps one line preferred, and sends the one losing it first", () => {
    const start = [
      lineFromRow(row("e1", "a@example.com", true), email("a@example.com")),
      lineFromRow(row("e2", "b@example.com"), email("b@example.com")),
    ];
    const lines = withPreferred(start, 1, true);
    expect(lines.map((line) => line.preferred)).toEqual([false, true]);
    const plan = planContactEdits(lines);
    expect(plan.map((edit) => (edit.kind === "add" ? "add" : edit.row.id))).toEqual(["e1", "e2"]);
  });

  it("sends a corrected value with only the fields, and removals before everything else", () => {
    const corrected = {
      ...lineFromRow(row("e1", "a@example.com"), email("a@example.com")),
      draft: email("a@example.org"),
    };
    const removed = {
      ...lineFromRow(row("e2", "b@example.com"), email("b@example.com")),
      removed: true,
    };
    const plan = planContactEdits([corrected, removed]);
    expect(plan[0]).toEqual({ kind: "remove", row: removed.row });
    expect(plan[1]).toEqual({
      kind: "update",
      row: corrected.row,
      body: { address: "a@example.org", contactUse: "work" },
    });
  });

  it("adds a new line with its switches and drops a new line left empty", () => {
    const added = { ...newLine(email("c@example.com")), preferred: true };
    const empty = newLine(email(""));
    expect(planContactEdits([added, empty])).toEqual([
      { kind: "add", draft: added.draft, preference: { preferred: true, permitted: true } },
    ]);
    expect(firstRefusedLine([added, empty])).toBeNull();
  });

  it("refuses a line that is not an email address", () => {
    expect(firstRefusedLine([newLine(email("not an address"))])).toBe(0);
  });
});
