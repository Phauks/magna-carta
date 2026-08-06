import type { MagnusConversationId, MagnusTurnId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { MEMBER_TURN_MAX_BYTES, contentByteLength } from "../src/limits.ts";
import type { TurnRow } from "../src/types.ts";
import { buildConversationWindow, WINDOW_MAX_BYTES, WINDOW_MAX_TURNS } from "../src/window.ts";

const CONVERSATION = "magnusConversation_00000000000000000" as MagnusConversationId;

function turn(sequence: number, speaker: "member" | "magnus", content: string | null): TurnRow {
  return {
    id: `magnusTurn_${String(sequence).padStart(21, "0")}` as MagnusTurnId,
    conversationId: CONVERSATION,
    sequence,
    speaker,
    content,
    status: content === null ? "pending" : "complete",
    failureLabel: null,
    modelId: null,
    snapshotId: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    completedAt: null,
  };
}

// A conversation of alternating turns, ending on a member turn.
function conversation(pairs: number, contentLength = 10): TurnRow[] {
  const turns: TurnRow[] = [];
  for (let index = 0; index < pairs; index++) {
    turns.push(turn(index * 2, "member", `m${"x".repeat(contentLength)}${index}`));
    turns.push(turn(index * 2 + 1, "magnus", `a${"y".repeat(contentLength)}${index}`));
  }
  turns.push(turn(pairs * 2, "member", "the newest question"));
  return turns;
}

describe("the conversation window", () => {
  it("keeps a short conversation whole and reports no truncation", () => {
    const window = buildConversationWindow(conversation(2));
    expect(window.messages).toHaveLength(5);
    expect(window.truncated).toBe(false);
  });

  it("always ends on the member's newest turn — the question being answered", () => {
    const window = buildConversationWindow(conversation(3));
    const last = window.messages[window.messages.length - 1];
    expect(last?.role).toBe("member");
    expect(last?.content).toBe("the newest question");
  });

  it("drops everything after the newest member turn — an already-answered tail is not this request", () => {
    const turns = [...conversation(1), turn(99, "magnus", "an answer that arrived late")];
    const window = buildConversationWindow(turns);
    expect(window.messages[window.messages.length - 1]?.content).toBe("the newest question");
  });

  it("truncates on the TURN cap, dropping the oldest", () => {
    const window = buildConversationWindow(conversation(40));
    expect(window.messages).toHaveLength(WINDOW_MAX_TURNS);
    expect(window.truncated).toBe(true);
    expect(window.messages[window.messages.length - 1]?.content).toBe("the newest question");
  });

  it("truncates on the BYTE cap independently, before the turn cap binds", () => {
    // Five turns, each a quarter of the byte cap: the turn cap is nowhere near, the byte cap is.
    const quarter = "z".repeat(Math.floor(WINDOW_MAX_BYTES / 4));
    const turns = [
      turn(0, "member", quarter),
      turn(1, "magnus", quarter),
      turn(2, "member", quarter),
      turn(3, "magnus", quarter),
      turn(4, "member", quarter),
    ];
    const window = buildConversationWindow(turns);
    expect(window.messages.length).toBeLessThan(5);
    expect(window.messages.length).toBeLessThanOrEqual(WINDOW_MAX_TURNS);
    expect(window.truncated).toBe(true);
    const total = window.messages.reduce((sum, message) => sum + message.content.length, 0);
    expect(total).toBeLessThanOrEqual(WINDOW_MAX_BYTES);
  });

  it("reports truncated exactly when content was dropped, and not otherwise", () => {
    expect(buildConversationWindow(conversation(1)).truncated).toBe(false);
    expect(buildConversationWindow(conversation(WINDOW_MAX_TURNS)).truncated).toBe(true);
  });

  it("reports truncated when the CALLER's own read was capped, even if every turn handed in fits", () => {
    // The case that would otherwise pass for a whole conversation: a bounded read filled up, so
    // older turns certainly exist, and nothing in the rows themselves can say so.
    const fits = conversation(1);
    expect(buildConversationWindow(fits).truncated).toBe(false);
    expect(buildConversationWindow(fits, { readWasCapped: true }).truncated).toBe(true);
  });

  it("keeps the newest member turn even when it alone fills the byte budget", () => {
    // A question at the per-turn cap, with plenty of history behind it. Dropping the question would
    // send the model a conversation with no question in it.
    const big = "q".repeat(MEMBER_TURN_MAX_BYTES);
    const turns = [...conversation(5), turn(200, "member", big)];
    const window = buildConversationWindow(turns);
    expect(window.messages[window.messages.length - 1]?.content).toBe(big);
  });

  it("skips a pending turn rather than counting it against the window", () => {
    const turns = [...conversation(1), turn(50, "magnus", null)];
    const window = buildConversationWindow(turns);
    expect(window.messages.every((message) => message.content !== "")).toBe(true);
    expect(window.messages[window.messages.length - 1]?.content).toBe("the newest question");
  });

  it("returns nothing when there is no member turn to answer", () => {
    const window = buildConversationWindow([turn(0, "magnus", "an orphan answer")]);
    expect(window.messages).toHaveLength(0);
  });

  it("orders by sequence, not by array order or timestamp", () => {
    const turns = [
      turn(2, "member", "third"),
      turn(0, "member", "first"),
      turn(1, "magnus", "second"),
    ];
    const window = buildConversationWindow(turns);
    expect(window.messages.map((message) => message.content)).toEqual(["first", "second", "third"]);
  });

  it("uses the platform's role vocabulary, never a vendor's", () => {
    const window = buildConversationWindow(conversation(1));
    expect(new Set(window.messages.map((message) => message.role))).toEqual(
      new Set(["member", "assistant"]),
    );
  });
});

describe("the per-turn caps", () => {
  it("measures UTF-8 bytes, not characters — the cap means the same thing in every script", () => {
    expect(contentByteLength("abc")).toBe(3);
    expect(contentByteLength("日本語")).toBe(9);
  });
});
