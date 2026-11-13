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
import { railDateGroup, railRowLine } from "../src/lib/magnus/magnus-vocabulary.ts";
import {
  ANSWER_SLOW_AFTER_MILLISECONDS,
  CONVERSATION_SORTS,
  TURN_FAILURE_LABELS,
  TURN_FAILURE_SENTENCES,
  conversationDisplayName,
  conversationStartedLine,
  turnFailureSentence,
  type MagnusAttachment,
  type MagnusConversation,
  type MagnusTurn,
} from "../src/lib/magnus/magnus-api.ts";
import {
  CONVERSATION_SORT_LABELS,
  answeringModelLine,
  attachmentName,
  attachmentStatusSentence,
  composerDisclosureLine,
  offeredSorts,
  sortControlLabel,
} from "../src/lib/magnus/magnus-vocabulary.ts";

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
    folderId: null,
    pinnedAt: null,
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
    effort: null,
    removedAt: null,
    supersededAt: null,
    replacesTurnId: null,
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

describe("how the rail is ordered", () => {
  it("offers date, name and matter in the workspace, and no matter order inside a matter", () => {
    expect(offeredSorts({ onMatter: false })).toEqual(["date", "name", "matter"]);
    expect(offeredSorts({ onMatter: true })).toEqual(["date", "name"]);
  });

  it("names every order the wire accepts", () => {
    for (const sort of CONVERSATION_SORTS) {
      expect(CONVERSATION_SORT_LABELS[sort].length).toBeGreaterThan(0);
    }
    expect(sortControlLabel("date")).toBe("Sort: Date");
  });
});

describe("what the composer says about what leaves the platform", () => {
  it("says only-what-you-type until a file is attached, then counts the files", () => {
    expect(composerDisclosureLine({ onMatter: false, attachmentCount: 0 })).toBe(
      "Magnus reads only what you type in this conversation.",
    );
    expect(composerDisclosureLine({ onMatter: false, attachmentCount: 1 })).toContain(
      "the one file attached",
    );
    expect(composerDisclosureLine({ onMatter: false, attachmentCount: 3 })).toContain(
      "the 3 files attached",
    );
  });

  it("inside a matter, still says the matter itself is not read", () => {
    const line = composerDisclosureLine({ onMatter: true, attachmentCount: 2 });
    expect(line).toContain("does not let Magnus read the matter");
  });

  it("says so when the conversation also reads the author's other conversations on the matter", () => {
    const line = composerDisclosureLine({
      onMatter: true,
      attachmentCount: 0,
      readsEarlierConversations: true,
    });
    expect(line).toContain("your own other conversations on this matter");
  });

  it("names the model that answers, and says when the firm's choice is gone", () => {
    expect(answeringModelLine({ modelId: "anthropic/model", zeroDataRetention: true })).toBe(
      "Answered by anthropic/model, which keeps nothing that is sent to it.",
    );
    expect(answeringModelLine(null)).toContain("no longer carried");
    expect(answeringModelLine(undefined)).toBe("");
  });
});

describe("what an attachment says about what the model saw", () => {
  const attachment = (
    textStatus: MagnusAttachment["textStatus"],
    overrides: Partial<MagnusAttachment> = {},
  ): MagnusAttachment => ({
    fileId: "file-1",
    name: "lease.pdf",
    matterId: "matter-1",
    attachedAt: STARTED_AT,
    textStatus,
    textBytes: null,
    ...overrides,
  });

  it("has words for every status the wire can carry, and none says something went wrong", () => {
    for (const status of ["pending", "sent", "cut", "unreadable"] as const) {
      const sentence = attachmentStatusSentence(attachment(status, { textBytes: 4096 }));
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence.toLowerCase()).not.toContain("something went wrong");
      expect(sentence).not.toContain("—");
    }
  });

  it("states how much of a cut file reached the model", () => {
    expect(attachmentStatusSentence(attachment("cut", { textBytes: 65536 }))).toContain("64 KB");
  });

  it("names a deleted file honestly rather than by a name that no longer resolves", () => {
    const deleted = attachment("unreadable", { name: null });
    expect(attachmentName(deleted)).toBe("A deleted file");
    expect(attachmentStatusSentence(deleted)).toContain("deleted");
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

describe("the rail's headings and row lines", () => {
  // A Friday at noon, local time: the week began on Monday the 9th.
  const now = new Date(2026, 10, 13, 12, 0);
  const at = (day: number, hour = 9) => new Date(2026, 10, day, hour, 30).toISOString();

  it("groups today, the earlier days of this week, and older months", () => {
    expect(railDateGroup(at(13), now)).toBe("Today");
    expect(railDateGroup(at(9), now)).toBe("Earlier This Week");
    expect(railDateGroup(at(8), now)).toBe("November 2026");
    expect(railDateGroup(new Date(2026, 9, 28, 9).toISOString(), now)).toBe("October 2026");
  });

  it("names the matter by number, or General, before when it started", () => {
    expect(railRowLine("2026-0152", at(13), now)).toMatch(/^2026-0152 · \d{1,2}:30/);
    expect(railRowLine(null, at(3), now)).toMatch(/^General · Nov 3, 2026$/);
  });
});
