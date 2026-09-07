/*
 * What the Magnus surface says about a conversation and about a turn that did not get an answer.
 *
 * Two rules are pinned here because both are the kind that a later edit softens without meaning to.
 *
 * NOTHING GENERATES A TITLE. The title is member-supplied only, so a conversation nobody named
 * reads by the instant it started, never by a machine's guess at what it was about. A test is the
 * cheapest way to keep a "helpful" summary out of that slot.
 *
 * NO FAILURE READS "SOMETHING WENT WRONG". Every one of the five closed labels a settled turn can
 * carry gets a sentence a member can act on, and the sweep below is over the whole set rather than
 * a sample, so a sixth label added to the wire cannot ship without words.
 */
import { describe, expect, it } from "vitest";
import {
  ANSWER_SLOW_AFTER_MILLISECONDS,
  TURN_FAILURE_LABELS,
  TURN_FAILURE_SENTENCES,
  conversationDisplayName,
  conversationStartedLine,
  turnFailureSentence,
  type MagnusConversation,
  type MagnusTurn,
} from "../src/lib/magnus/magnus-api.ts";

const STARTED_AT = "2026-03-04T14:05:00.000Z";

function conversation(title: string | null, updatedAt: string = STARTED_AT): MagnusConversation {
  return {
    id: "conversation-1",
    title,
    createdBy: "member-1",
    matterId: null,
    state: "active",
    createdAt: STARTED_AT,
    updatedAt,
  };
}

function turn(overrides: Partial<MagnusTurn> = {}): MagnusTurn {
  return {
    id: "turn-1",
    sequence: 2,
    speaker: "magnus",
    content: null,
    status: "failed",
    failureLabel: null,
    modelId: null,
    snapshotId: null,
    contextTruncated: false,
    createdAt: STARTED_AT,
    completedAt: STARTED_AT,
    ...overrides,
  };
}

describe("what a conversation is called", () => {
  it("is the member's own title when they gave one", () => {
    expect(conversationDisplayName(conversation("Lien priority question"))).toBe(
      "Lien priority question",
    );
  });

  it("falls back to the start instant, never to a generated summary", () => {
    const name = conversationDisplayName(conversation(null));
    expect(name).not.toBe("");
    // The instant renders in the reader's own zone, so the exact string is the platform's
    // formatter's business; what this pins is that the fallback states a MOMENT.
    expect(name).toMatch(/2026/u);
  });

  it("treats a title of blank space as no title at all", () => {
    expect(conversationDisplayName(conversation("   "))).toMatch(/2026/u);
  });
});

describe("the line beneath a conversation's name", () => {
  it("is withheld on an unnamed conversation, whose name IS the instant it started", () => {
    // The ordinary case: nothing generates a title, so this is the common row and it must not
    // state one fact twice.
    expect(conversationStartedLine(conversation(null))).toBeNull();
    expect(conversationStartedLine(conversation("   "))).toBeNull();
  });

  it("states the start on a named conversation, which the name does not carry", () => {
    const line = conversationStartedLine(conversation("Lien priority question"));
    expect(line).not.toBeNull();
    expect(line).toMatch(/2026/u);
  });

  it("is unaffected by a later touch, because the fact it states is the start", () => {
    // `updatedAt` moves on a rename, an archive or a delete and NOT on a turn, so it is not the
    // conversation's last activity and the line never offers it as one.
    const renamedLater = conversation(null, "2026-04-01T09:00:00.000Z");
    expect(conversationStartedLine(renamedLater)).toBeNull();
  });
});

describe("how long a pending answer waits before it says so", () => {
  it("is longer than a read's stall, because a model answer takes seconds", () => {
    expect(ANSWER_SLOW_AFTER_MILLISECONDS).toBeGreaterThan(15_000);
  });
});

describe("what a settled failure says", () => {
  it("has words for every label the wire can carry", () => {
    for (const label of TURN_FAILURE_LABELS) {
      expect(TURN_FAILURE_SENTENCES[label].length).toBeGreaterThan(0);
    }
    expect(Object.keys(TURN_FAILURE_SENTENCES).toSorted()).toEqual(
      [...TURN_FAILURE_LABELS].toSorted(),
    );
  });

  it("never says something went wrong", () => {
    for (const label of TURN_FAILURE_LABELS) {
      expect(TURN_FAILURE_SENTENCES[label].toLowerCase()).not.toContain("something went wrong");
    }
  });

  it("says the five causes five different ways", () => {
    const said = new Set(Object.values(TURN_FAILURE_SENTENCES));
    expect(said.size).toBe(TURN_FAILURE_LABELS.length);
  });

  it("carries no em dash, which is not the house voice for what a member reads", () => {
    for (const label of TURN_FAILURE_LABELS) {
      expect(TURN_FAILURE_SENTENCES[label]).not.toContain("—");
    }
  });

  it("reads a turn's own label, and says nothing about one that settled with an answer", () => {
    expect(turnFailureSentence(turn({ failureLabel: "ceiling-reached" }))).toBe(
      TURN_FAILURE_SENTENCES["ceiling-reached"],
    );
    expect(turnFailureSentence(turn({ status: "complete", content: "An answer." }))).toBeNull();
  });
});
