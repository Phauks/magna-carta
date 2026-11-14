// @vitest-environment node
/*
 * A rename lands, or is sent again once the window has passed, and never more than three times.
 *
 * The room refuses a rename inside the hand's window without saying which frame it refused, so the
 * roster is the only truth the browser can settle by: a row still showing the old name after the
 * window means the frame did not land.
 */
import { describe, expect, it } from "vitest";
import { cleanDisplayName, MeetingNaming } from "../src/lib/meetings/client/naming.ts";

function harness() {
  const sent: Record<string, unknown>[] = [];
  let row: { displayName: string; accountName: string | null } | null = {
    displayName: "Rosalind Chase",
    accountName: null,
  };
  let due: (() => void) | null = null;
  const naming = new MeetingNaming({
    send: (frame) => sent.push(frame),
    ownRow: () => row,
    after: (_milliseconds, run) => {
      due = run;
      return () => {
        due = null;
      };
    },
  });
  return {
    naming,
    sent,
    setRow: (next: typeof row) => {
      row = next;
    },
    tick: () => {
      const run = due;
      due = null;
      run?.();
    },
    pending: () => due !== null,
  };
}

describe("a rename", () => {
  it("is sent once and settles when the roster shows it", () => {
    const room = harness();
    room.naming.rename("Red Room");
    expect(room.sent).toEqual([{ type: "rename", displayName: "Red Room" }]);
    room.setRow({ displayName: "Red Room", accountName: "Rosalind Chase" });
    room.tick();
    expect(room.sent).toHaveLength(1);
    expect(room.pending()).toBe(false);
  });

  it("is sent again when the roster still shows the old name, and stops after three", () => {
    const room = harness();
    room.naming.rename("Red Room");
    room.tick();
    room.tick();
    room.tick();
    expect(room.sent).toHaveLength(3);
    expect(room.pending()).toBe(false);
  });

  it("puts the original back with null, settled when the roster calls it no rename", () => {
    const room = harness();
    room.setRow({ displayName: "Red Room", accountName: "Rosalind Chase" });
    room.naming.rename(null);
    expect(room.sent).toEqual([{ type: "rename", displayName: null }]);
    room.setRow({ displayName: "Rosalind Chase", accountName: null });
    room.tick();
    expect(room.sent).toHaveLength(1);
  });

  it("sends nothing more once the meeting is over for the page", () => {
    const room = harness();
    room.naming.rename("Red Room");
    room.naming.clear();
    room.tick();
    expect(room.sent).toHaveLength(1);
  });
});

describe("a typed name", () => {
  it("loses the spaces at either end and between words, and nothing left is no name", () => {
    expect(cleanDisplayName("  Red   Room ")).toBe("Red Room");
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName("x".repeat(100))).toHaveLength(80);
  });
});
