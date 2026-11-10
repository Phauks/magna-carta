import { describe, expect, it } from "vitest";
import {
  CAPTION_FRAME_BUDGET_PER_SECOND,
  CAPTION_INTERIM_INTERVAL_MILLISECONDS,
  CAPTION_SILENCE_CLOSE_MILLISECONDS,
  CAPTION_TEXT_MAXIMUM_CHARACTERS,
  captionAudioMilliseconds,
  captionSilenceDeadline,
  captionText,
  freshCaptionFrameBudget,
  interimDueAt,
  spendCaptionFrameBudget,
} from "../src/caption-sessions.ts";

// THE CAPTION ARITHMETIC — when a session closes, how fast words may go out, and what the words may be.
//
// What would be a real failure if it stopped holding: a quiet speaker's session closes three seconds
// after they stopped and not before; one speaker's interims go out at most once a window; the room's
// budget lets interims wait and never holds a final back; and a caption carries one clean line of
// bounded length, cut between characters.

describe("when a quiet speaker's session closes", () => {
  it("is three seconds after they stopped", () => {
    expect(CAPTION_SILENCE_CLOSE_MILLISECONDS).toBe(3_000);
    expect(captionSilenceDeadline(10_000)).toBe(13_000);
  });
});

describe("one speaker's interim captions", () => {
  it("go at once for a speaker who has sent none, and otherwise when the window closes", () => {
    expect(interimDueAt(null, 1_000)).toBe(1_000);
    expect(interimDueAt(1_000, 1_100)).toBe(1_000 + CAPTION_INTERIM_INTERVAL_MILLISECONDS);
    expect(interimDueAt(1_000, 1_000 + CAPTION_INTERIM_INTERVAL_MILLISECONDS + 1)).toBe(
      1_000 + CAPTION_INTERIM_INTERVAL_MILLISECONDS + 1,
    );
  });
});

describe("the room's caption budget", () => {
  it("lets a second's worth through, then holds interims and never a final", () => {
    let budget = freshCaptionFrameBudget(0);
    for (let index = 0; index < CAPTION_FRAME_BUDGET_PER_SECOND; index += 1) {
      const spent = spendCaptionFrameBudget(budget, 0, false);
      expect(spent.allowed).toBe(true);
      budget = spent.budget;
    }
    expect(spendCaptionFrameBudget(budget, 0, false).allowed).toBe(false);
    const final = spendCaptionFrameBudget(budget, 0, true);
    expect(final.allowed).toBe(true);
    expect(final.budget.tokens).toBeGreaterThanOrEqual(0);
  });

  it("refills by the time that passed, never past one second's worth", () => {
    const empty = { tokens: 0, measuredAt: 0 };
    expect(spendCaptionFrameBudget(empty, 99, false).allowed).toBe(false);
    expect(spendCaptionFrameBudget(empty, 100, false).allowed).toBe(true);
    const later = spendCaptionFrameBudget(empty, 60_000, false);
    expect(later.budget.tokens).toBe(CAPTION_FRAME_BUDGET_PER_SECOND - 1);
  });
});

describe("the words a caption carries", () => {
  it("are one clean line, with control, bidirectional and invisible characters gone", () => {
    expect(captionText("  good\nmorning\u202Eeveryone\u200B.  ")).toBe("good morning everyone .");
    expect(captionText("\u0007\u0000")).toBe("");
  });

  it("are cut at the limit between characters, never inside a surrogate pair or an accent", () => {
    const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
    for (const character of ["\u{1D400}", "e\u0301"]) {
      const cut = captionText(character.repeat(CAPTION_TEXT_MAXIMUM_CHARACTERS + 5));
      expect(Array.from(graphemes.segment(cut))).toHaveLength(CAPTION_TEXT_MAXIMUM_CHARACTERS);
      expect(cut.endsWith(character)).toBe(true);
    }
    expect(captionText("short")).toBe("short");
  });
});

describe("the audio a caption is metered on", () => {
  it("counts milliseconds of mono 16-bit 48 kHz", () => {
    expect(captionAudioMilliseconds(96_000)).toBe(1_000);
    expect(captionAudioMilliseconds(1_920)).toBe(20);
  });
});
