import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  exactOwner,
  parseSummaryAnswer,
  readSummaryAnswer,
  statedDueOn,
  type SummaryParticipant,
} from "../src/summary-parse.ts";
import {
  SUMMARY_ACTION_ITEMS_MAXIMUM,
  SUMMARY_PARTS_MAXIMUM,
  splitTranscriptIntoParts,
  summaryPartByteBudget,
  summaryTranscriptMessage,
  transcriptClock,
  transcriptLine,
  utf8ByteLength,
} from "../src/summary-prompt.ts";

const ALICE = "user_alice" as UserId;
const BOB = "user_bob" as UserId;
const PARTICIPANTS: readonly SummaryParticipant[] = [
  { displayName: "Alice Abernathy", userId: ALICE },
  { displayName: "Bob Bramble", userId: BOB },
  { displayName: "Gita Guest", userId: null },
];
const TRANSCRIPT = [
  "00:00:03 Alice Abernathy: We will file the response by 14 November 2026.",
  "00:01:10 Bob Bramble: I will send the signed declaration next Friday.",
].join("\n");

function answer(value: unknown): string {
  return JSON.stringify(value);
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: "File the response.", owner: null, dueOn: null, dueOnStated: null, ...overrides };
}

describe("reading a summary answer's structure", () => {
  it("reads a well-formed answer, trimming text at its ends and keeping the order", () => {
    const reading = readSummaryAnswer(
      answer({
        summary: "  The parties agreed a filing date.  ",
        actionItems: [item({ text: " First. " }), item({ text: "Second." })],
      }),
    );
    expect(reading).toEqual({
      ok: true,
      answer: {
        summary: "The parties agreed a filing date.",
        actionItems: [
          { text: "First.", owner: null, dueOn: null, dueOnStated: null },
          { text: "Second.", owner: null, dueOn: null, dueOnStated: null },
        ],
      },
    });
  });

  it("accepts one code fence wrapping the whole answer, and nothing more", () => {
    const body = answer({ summary: "Fenced.", actionItems: [] });
    expect(readSummaryAnswer("```json\n" + body + "\n```").ok).toBe(true);
    expect(readSummaryAnswer("```\n" + body + "\n```").ok).toBe(true);
    // Prose around the object, or a fence that does not wrap everything, is not the structure.
    expect(readSummaryAnswer("Here is the summary:\n" + body)).toEqual({
      ok: false,
      refusal: "not-json",
    });
    expect(readSummaryAnswer("```json\n" + body + "\n```\nHope this helps.")).toEqual({
      ok: false,
      refusal: "not-json",
    });
  });

  it("refuses malformed answers with a closed reason and never repairs them", () => {
    expect(readSummaryAnswer("   ")).toEqual({ ok: false, refusal: "empty" });
    expect(readSummaryAnswer("{ not json }")).toEqual({ ok: false, refusal: "not-json" });
    expect(readSummaryAnswer('{"summary": "cut off mid-answ')).toEqual({
      ok: false,
      refusal: "not-json",
    });
    // A missing key, an extra key, and a wrong type are all the wrong shape.
    expect(readSummaryAnswer(answer({ summary: "No items key." }))).toEqual({
      ok: false,
      refusal: "wrong-shape",
    });
    expect(
      readSummaryAnswer(answer({ summary: "Extra.", actionItems: [], confidence: 0.9 })),
    ).toEqual({ ok: false, refusal: "wrong-shape" });
    expect(
      readSummaryAnswer(answer({ summary: "Bad item.", actionItems: [item({ owner: 7 })] })),
    ).toEqual({ ok: false, refusal: "wrong-shape" });
    expect(
      readSummaryAnswer(
        answer({ summary: "Bad item.", actionItems: [item({ priority: "high" })] }),
      ),
    ).toEqual({ ok: false, refusal: "wrong-shape" });
    expect(readSummaryAnswer(answer([{ summary: "An array." }]))).toEqual({
      ok: false,
      refusal: "not-json",
    });
  });

  it("refuses an empty summary or item, and anything past the limits", () => {
    expect(readSummaryAnswer(answer({ summary: "  ", actionItems: [] }))).toEqual({
      ok: false,
      refusal: "summary-empty",
    });
    expect(readSummaryAnswer(answer({ summary: "x".repeat(12_001), actionItems: [] }))).toEqual({
      ok: false,
      refusal: "summary-too-long",
    });
    expect(
      readSummaryAnswer(
        answer({
          summary: "Many.",
          actionItems: Array.from({ length: SUMMARY_ACTION_ITEMS_MAXIMUM + 1 }, () => item()),
        }),
      ),
    ).toEqual({ ok: false, refusal: "too-many-action-items" });
    expect(
      readSummaryAnswer(answer({ summary: "S.", actionItems: [item({ text: " " })] })),
    ).toEqual({ ok: false, refusal: "action-item-empty" });
    expect(
      readSummaryAnswer(answer({ summary: "S.", actionItems: [item({ text: "y".repeat(501) })] })),
    ).toEqual({ ok: false, refusal: "action-item-too-long" });
  });
});

describe("an action item's owner is a member only on an exact match", () => {
  it("links the exact name of a member", () => {
    expect(exactOwner("Alice Abernathy", PARTICIPANTS)).toBe(ALICE);
    expect(exactOwner("Bob Bramble", PARTICIPANTS)).toBe(BOB);
  });

  it("leaves a near match unowned — case, a first name, extra spacing, a title", () => {
    for (const near of [
      "alice abernathy",
      "Alice",
      "Alice  Abernathy",
      " Alice Abernathy",
      "Ms Alice Abernathy",
      "Alice Abernathy.",
    ]) {
      expect(exactOwner(near, PARTICIPANTS), near).toBeNull();
    }
  });

  it("never links a guest, nobody, or a name two members share", () => {
    expect(exactOwner("Gita Guest", PARTICIPANTS)).toBeNull();
    expect(exactOwner(null, PARTICIPANTS)).toBeNull();
    expect(exactOwner("", PARTICIPANTS)).toBeNull();
    const twins: SummaryParticipant[] = [
      { displayName: "Sam Lee", userId: "user_one" as UserId },
      { displayName: "Sam Lee", userId: "user_two" as UserId },
    ];
    expect(exactOwner("Sam Lee", twins)).toBeNull();
    // The same member on two stays is still one member.
    expect(exactOwner("Alice Abernathy", [...PARTICIPANTS, PARTICIPANTS[0]!])).toBe(ALICE);
  });
});

describe("a due date is kept only when the transcript states it", () => {
  it("keeps a real date whose quoted words are in the transcript and carry its day", () => {
    expect(statedDueOn("2026-11-14", "by 14 November 2026", TRANSCRIPT)).toBe("2026-11-14");
  });

  it("drops a date the transcript does not state", () => {
    // A relative phrase carries no day of the month.
    expect(statedDueOn("2026-10-09", "next Friday", TRANSCRIPT)).toBeNull();
    // Words that are not in the transcript.
    expect(statedDueOn("2026-11-14", "by the 14th of November", TRANSCRIPT)).toBeNull();
    // Words that are, naming a different day.
    expect(statedDueOn("2026-11-15", "by 14 November 2026", TRANSCRIPT)).toBeNull();
    // No quote, an impossible date, a date in another shape.
    expect(statedDueOn("2026-11-14", null, TRANSCRIPT)).toBeNull();
    expect(statedDueOn("2026-02-30", "by 14 November 2026", TRANSCRIPT)).toBeNull();
    expect(statedDueOn("14/11/2026", "by 14 November 2026", TRANSCRIPT)).toBeNull();
    expect(statedDueOn(null, "by 14 November 2026", TRANSCRIPT)).toBeNull();
  });

  it("reads a final answer into the summary to write, owners and dates held to the transcript", () => {
    const parsed = parseSummaryAnswer(
      answer({
        summary: "The response date was agreed.",
        actionItems: [
          item({
            text: "File the response.",
            owner: "Alice Abernathy",
            dueOn: "2026-11-14",
            dueOnStated: "by 14 November 2026",
          }),
          item({
            text: "Send the signed declaration.",
            owner: "Bob",
            dueOn: "2026-10-09",
            dueOnStated: "next Friday",
          }),
        ],
      }),
      { participants: PARTICIPANTS, transcriptText: TRANSCRIPT },
    );
    expect(parsed).toEqual({
      ok: true,
      summary: {
        summaryText: "The response date was agreed.",
        actionItems: [
          { text: "File the response.", ownerUserId: ALICE, dueOn: "2026-11-14" },
          { text: "Send the signed declaration.", ownerUserId: null, dueOn: null },
        ],
      },
    });
  });
});

describe("what the model is sent", () => {
  it("renders a line as HH:MM:SS Name: text, on one line whatever the name or words hold", () => {
    expect(transcriptClock(0)).toBe("00:00:00");
    expect(transcriptClock(3_723_999)).toBe("01:02:03");
    expect(transcriptClock(11 * 3_600_000 + 59 * 60_000 + 59_000)).toBe("11:59:59");
    expect(transcriptLine(65_000, "Alice\nAbernathy", "first line\nsecond line")).toBe(
      "00:01:05 Alice Abernathy: first line second line",
    );
    expect(transcriptLine(0, " ", "words")).toBe("00:00:00 Unnamed participant: words");
  });

  it("names the participants and the part in the one member message", () => {
    const message = summaryTranscriptMessage({
      participants: ["Alice Abernathy", "Bob Bramble", "Alice Abernathy"],
      lines: ["00:00:03 Alice Abernathy: Hello."],
      part: { number: 2, of: 3 },
    });
    expect(message).toBe(
      [
        "Participants, spelled exactly as the transcript spells them:",
        "- Alice Abernathy",
        "- Bob Bramble",
        "",
        "Transcript, part 2 of 3:",
        "00:00:03 Alice Abernathy: Hello.",
      ].join("\n"),
    );
  });

  it("budgets a call from the catalog's context window at three bytes a token", () => {
    expect(summaryPartByteBudget(131_000)).toBe((131_000 - 8_192 - 2_048) * 3);
    expect(summaryPartByteBudget(1_000)).toBe(0);
  });

  it("cuts a long transcript into parts at line boundaries, in order, inside the budget", () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `line ${String(index).padStart(2, "0")} ${"w".repeat(20)}`,
    );
    const budget = 200;
    const parts = splitTranscriptIntoParts(lines, budget);
    expect(parts).not.toBeNull();
    expect(parts!.flat()).toEqual(lines);
    for (const part of parts!) {
      expect(part.reduce((total, line) => total + utf8ByteLength(line) + 1, 0)).toBeLessThanOrEqual(
        budget,
      );
    }
    // A line longer than the whole budget is cut at a character boundary, never dropped.
    const long = "é".repeat(150);
    const cut = splitTranscriptIntoParts([long], 101);
    expect(cut!.flat().join("")).toBe(long);
  });

  it("refuses a transcript that would need more parts than one run may make", () => {
    const lines = Array.from({ length: SUMMARY_PARTS_MAXIMUM + 1 }, () => "x".repeat(90));
    expect(splitTranscriptIntoParts(lines, 100)).toBeNull();
    expect(splitTranscriptIntoParts(lines.slice(1), 100)).toHaveLength(SUMMARY_PARTS_MAXIMUM);
    expect(splitTranscriptIntoParts(["anything"], 0)).toBeNull();
  });
});
