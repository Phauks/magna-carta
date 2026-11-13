import { describe, expect, it } from "vitest";
import {
  findMarks,
  findQuery,
  matchingTurnIds,
  shownTurns,
  steppedMatch,
} from "../src/lib/magnus/conversation-find.ts";
import type { MagnusTurn } from "../src/lib/magnus/magnus-api.ts";

function turn(
  id: string,
  speaker: "member" | "magnus",
  content: string | null,
  extra: Partial<MagnusTurn> = {},
): MagnusTurn {
  return {
    id,
    sequence: 1,
    speaker,
    content,
    status: "complete",
    failureLabel: null,
    modelId: null,
    snapshotId: null,
    contextTruncated: false,
    effort: null,
    removedAt: null,
    supersededAt: null,
    replacesTurnId: null,
    createdAt: "2026-11-13T12:00:00.000Z",
    completedAt: "2026-11-13T12:00:00.000Z",
    ...extra,
  };
}

describe("finding words in a conversation", () => {
  it("marks every place the words stand, ignoring case", () => {
    expect(findMarks("Amend the Complaint, then amend again", "amend")).toEqual([
      { start: 0, end: 5 },
      { start: 26, end: 31 },
    ]);
  });

  it("finds nothing for nothing typed, and spaces alone are nothing", () => {
    expect(findQuery("   ")).toBe("");
    expect(findMarks("anything", "")).toEqual([]);
  });

  it("matches exactly when lowering the case would move the offsets", () => {
    const text = "İstanbul office, then istanbul again";
    const marks = findMarks(text, "istanbul");
    for (const mark of marks) expect(text.slice(mark.start, mark.end)).toBe("istanbul");
  });

  it("lists the matching turns in order and skips turns with no words", () => {
    const turns = [
      turn("a", "member", "the deadline to amend"),
      turn("b", "magnus", null, { status: "pending" }),
      turn("c", "magnus", "You may amend once as of right."),
      turn("d", "member", "thanks"),
    ];
    expect(matchingTurnIds(turns, "AMEND")).toEqual(["a", "c"]);
  });

  it("counts the same messages the transcript shows", () => {
    const turns = [
      turn("a", "member", "old question", { supersededAt: "2026-11-13T13:00:00.000Z" }),
      turn("b", "magnus", null, { removedAt: "2026-11-13T13:00:00.000Z" }),
      turn("c", "member", "kept"),
    ];
    expect(shownTurns(turns).map((shown) => shown.id)).toEqual(["c"]);
  });

  it("steps wrap at either end", () => {
    expect(steppedMatch(2, 3, 1)).toBe(0);
    expect(steppedMatch(0, 3, -1)).toBe(2);
    expect(steppedMatch(0, 0, 1)).toBe(0);
  });
});

describe("the order a transcript shows", () => {
  it("follows the sequence, so an answer sharing its question's timestamp never shows above it", () => {
    const answer = turn("b", "magnus", "the answer", { sequence: 1 });
    const question = turn("a", "member", "the question", { sequence: 0 });
    expect(shownTurns([answer, question]).map((shown) => shown.id)).toEqual(["a", "b"]);
  });
});
