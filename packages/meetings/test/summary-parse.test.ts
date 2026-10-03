import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  exactOwner,
  parseSummaryAnswer,
  readCombinedSummaryAnswer,
  readSummaryAnswer,
  settlePartedSummary,
  statedDueOn,
  type DueDateContext,
  type SummaryAnswer,
  type SummaryParticipant,
} from "../src/summary-parse.ts";
import {
  estimatedTokens,
  SUMMARY_ACTION_ITEMS_MAXIMUM,
  SUMMARY_ANSWER_MAXIMUM_TOKENS,
  SUMMARY_INSTRUCTION_RESERVE_TOKENS,
  SUMMARY_PARTS_MAXIMUM,
  SUMMARY_RUN_ACTION_ITEMS_MAXIMUM,
  splitTranscriptIntoParts,
  spokenWords,
  summaryPartTokenBudget,
  summaryTranscriptMessage,
  transcriptClock,
  transcriptLine,
} from "../src/summary-prompt.ts";

const ALICE = "user_alice" as UserId;
const BOB = "user_bob" as UserId;
const PARTICIPANTS: readonly SummaryParticipant[] = [
  { displayName: "Alice Abernathy", userId: ALICE },
  { displayName: "Bob Bramble", userId: BOB },
  { displayName: "Gita Guest", userId: null },
];
// What each person said, as the model read it after each line's `HH:MM:SS Name:`.
const SPEECH: readonly string[] = [
  "We will file the response by 14 November 2026.",
  "I will send the signed declaration next Friday.",
  "Let us aim for the 14th.",
  "Serve it on 3/12.",
  "Serve the notice on 14/11.",
  "Filing by 2026-11-14 at the latest.",
  "We may file the reply by 14 June.",
  "Call me at 10:14 tomorrow.",
].map(spokenWords);
const CONTEXT: DueDateContext = { speech: SPEECH, earliestYear: 2025, latestYear: 2027 };

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

describe("a due date is kept only when what somebody said states it", () => {
  it("keeps a date whose quoted words, spoken on one line, name its day and month one way", () => {
    expect(statedDueOn("2026-11-14", "by 14 November 2026", CONTEXT)).toBe("2026-11-14");
    expect(statedDueOn("2026-11-14", "on 14/11", CONTEXT)).toBe("2026-11-14");
    expect(statedDueOn("2026-11-14", "by 2026-11-14", CONTEXT)).toBe("2026-11-14");
    // "may" the verb is not the month; "June" is.
    expect(statedDueOn("2026-06-14", "We may file the reply by 14 June", CONTEXT)).toBe(
      "2026-06-14",
    );
  });

  it("never reads a date out of a clock time — the line's own prefix, or a time somebody said", () => {
    // The prefix is not speech: a quote of it is not found among what was said.
    expect(statedDueOn("2026-11-03", "00:14:03", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-10-14", "00:00:03 Alice Abernathy: We will file", CONTEXT)).toBeNull();
    // A time somebody said is found, and is still not a date.
    expect(statedDueOn("2026-10-14", "at 10:14", CONTEXT)).toBeNull();
  });

  it("drops a quote that runs across two lines", () => {
    expect(statedDueOn("2026-11-14", "14 November 2026.\nI will send", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-11-14", "November 2026. I will send", CONTEXT)).toBeNull();
  });

  it("drops a date whose month, or year, the words do not state", () => {
    // No month at all.
    expect(statedDueOn("2031-02-14", "the 14th", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-11-14", "the 14th", CONTEXT)).toBeNull();
    // The wrong month by name.
    expect(statedDueOn("2026-12-14", "by 14 November 2026", CONTEXT)).toBeNull();
    // The wrong year, quoted.
    expect(statedDueOn("2027-11-14", "by 14 November 2026", CONTEXT)).toBeNull();
    // No year quoted, and a year the summary could not mean.
    expect(statedDueOn("2031-06-14", "by 14 June", CONTEXT)).toBeNull();
    // The wrong day.
    expect(statedDueOn("2026-11-15", "by 14 November 2026", CONTEXT)).toBeNull();
  });

  it("drops a date in figures that reads two ways", () => {
    // 3/12 is the 3rd of December or the 12th of March: neither reading is kept.
    expect(statedDueOn("2026-12-03", "on 3/12", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-03-12", "on 3/12", CONTEXT)).toBeNull();
  });

  it("drops a relative phrase, a quote nobody said, and anything that is not a date", () => {
    expect(statedDueOn("2026-10-09", "next Friday", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-11-14", "by the 14th of November", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-11-14", null, CONTEXT)).toBeNull();
    expect(statedDueOn("2026-11-14", "  ", CONTEXT)).toBeNull();
    expect(statedDueOn("2026-02-30", "by 14 November 2026", CONTEXT)).toBeNull();
    expect(statedDueOn("14/11/2026", "by 14 November 2026", CONTEXT)).toBeNull();
    expect(statedDueOn(null, "by 14 November 2026", CONTEXT)).toBeNull();
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
      { participants: PARTICIPANTS, ...CONTEXT },
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

describe("a long transcript's parts, combined", () => {
  const part = (count: number, label: string): SummaryAnswer => ({
    summary: `Part ${label}.`,
    actionItems: Array.from({ length: count }, (_, index) => ({
      text: `Item ${label}${String(index)}.`,
      owner: index === 0 ? "Alice Abernathy" : null,
      dueOn: index === 0 ? "2026-11-14" : null,
      dueOnStated: index === 0 ? "by 14 November 2026" : null,
    })),
  });

  it("reads the combining call's answer as the summary alone, strictly", () => {
    expect(readCombinedSummaryAnswer(answer({ summary: " The whole meeting. " }))).toEqual({
      ok: true,
      summary: "The whole meeting.",
    });
    // The combining call never carries action items: a list there is the wrong shape.
    expect(readCombinedSummaryAnswer(answer({ summary: "S.", actionItems: [] }))).toEqual({
      ok: false,
      refusal: "wrong-shape",
    });
    expect(readCombinedSummaryAnswer("The whole meeting.")).toEqual({
      ok: false,
      refusal: "not-json",
    });
  });

  it("keeps every part's action items as the part gave them, in order, held to the transcript", () => {
    const settled = settlePartedSummary(
      "The whole meeting.",
      Array.from({ length: SUMMARY_PARTS_MAXIMUM }, (_, index) =>
        part(SUMMARY_ACTION_ITEMS_MAXIMUM, String(index)),
      ),
      { participants: PARTICIPANTS, ...CONTEXT },
    );
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.summary.summaryText).toBe("The whole meeting.");
    expect(settled.summary.actionItems).toHaveLength(SUMMARY_RUN_ACTION_ITEMS_MAXIMUM);
    expect(settled.summary.actionItems[0]).toEqual({
      text: "Item 00.",
      ownerUserId: ALICE,
      dueOn: "2026-11-14",
    });
    expect(settled.summary.actionItems[SUMMARY_ACTION_ITEMS_MAXIMUM]?.text).toBe("Item 10.");
    // More than a run may hold is refused, never cut.
    expect(
      settlePartedSummary(
        "S.",
        Array.from({ length: SUMMARY_PARTS_MAXIMUM + 1 }, (_, index) =>
          part(SUMMARY_ACTION_ITEMS_MAXIMUM, String(index)),
        ),
        { participants: PARTICIPANTS, ...CONTEXT },
      ),
    ).toEqual({ ok: false, refusal: "too-many-action-items" });
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

  it("reckons tokens so no script is undercounted: a non-ASCII byte is a whole token", () => {
    // ASCII at a token per one and a half bytes.
    expect(estimatedTokens("abc")).toBe(2);
    expect(estimatedTokens("00:14:03 ")).toBe(6);
    // Two-byte and three-byte characters at a token a byte — a byte-level tokenizer can make no more.
    expect(estimatedTokens("é")).toBe(2);
    const devanagari = "नमस्ते दुनिया";
    expect(estimatedTokens(devanagari)).toBeGreaterThanOrEqual(
      new TextEncoder().encode(devanagari).byteLength - 1,
    );
  });

  it("budgets a call from the catalog's context window, the answer's room, the instruction and the participants", () => {
    expect(summaryPartTokenBudget(128_000, 100)).toBe(
      128_000 - SUMMARY_ANSWER_MAXIMUM_TOKENS - SUMMARY_INSTRUCTION_RESERVE_TOKENS - 100,
    );
    expect(summaryPartTokenBudget(1_000, 0)).toBe(0);
  });

  it("cuts a long transcript into parts at line boundaries, in order, inside the budget", () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `line ${String(index).padStart(2, "0")} ${"w".repeat(20)}`,
    );
    const budget = 150;
    const parts = splitTranscriptIntoParts(lines, budget);
    expect(parts).not.toBeNull();
    expect(parts!.length).toBeGreaterThan(1);
    expect(parts!.flat()).toEqual(lines);
    for (const part of parts!) {
      expect(estimatedTokens(`${part.join("\n")}\n`)).toBeLessThanOrEqual(budget);
    }
    // A line longer than the whole budget is cut at a character boundary, never dropped.
    const long = "é".repeat(150);
    const cut = splitTranscriptIntoParts([long], 101);
    expect(cut!.flat().join("")).toBe(long);
  });

  it("keeps a transcript in a non-Latin script inside the budget, counted in the model's own tokens", () => {
    // Every token is at least one byte, so a part's bytes bound its tokens from above.
    const lines = Array.from({ length: 8 }, (_, index) =>
      transcriptLine(index * 1_000, "अनीता", "हम सोमवार तक जवाब दाखिल करेंगे और घोषणा भेजेंगे।"),
    );
    const budget = 500;
    const parts = splitTranscriptIntoParts(lines, budget);
    expect(parts).not.toBeNull();
    expect(parts!.flat()).toEqual(lines);
    for (const part of parts!) {
      expect(new TextEncoder().encode(`${part.join("\n")}\n`).byteLength).toBeLessThanOrEqual(
        budget,
      );
    }
  });

  it("refuses a transcript that would need more parts than one run may make", () => {
    const lines = Array.from({ length: SUMMARY_PARTS_MAXIMUM + 1 }, () => "x".repeat(90));
    expect(splitTranscriptIntoParts(lines, 100)).toBeNull();
    expect(splitTranscriptIntoParts(lines.slice(1), 100)).toHaveLength(SUMMARY_PARTS_MAXIMUM);
    expect(splitTranscriptIntoParts(["anything"], 0)).toBeNull();
  });
});
