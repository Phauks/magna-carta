import { describe, expect, it } from "vitest";
import {
  AWAITING_NUMBER_SENTENCE,
  PREVIEW_NOTE,
  renderReference,
  subjectIsEmpty,
  SUBJECT_SEPARATOR,
} from "../src/lib/components/record-reference/record-reference-model.ts";
import type { ReferenceStanding } from "../src/lib/components/record-reference/types.ts";

/*
 * What a record reference reads as.
 *
 * What is rendered belongs to the stories, which run in a real browser with axe. What is pinned
 * here is the decision underneath: how a number is taken depending on how firmly the record holds
 * it, and what a panel says when there is no number yet. Both were living in one file — the call
 * log, which is the only surface that had been asked for them — while every other panel that mints
 * a number showed nothing, so they are asserted directly rather than inferred from the one panel
 * that happens to agree today.
 */

const EVERY_STANDING: readonly ReferenceStanding[] = ["drawn", "tentative", "preview"];

describe("how firmly a record holds its number", () => {
  it("shows a drawn number as the record's own", () => {
    expect(renderReference({ kind: "Matter", number: "2026-0147" })).toEqual({
      shape: "identified",
      kind: "Matter",
      number: "2026-0147",
      note: null,
    });
  });

  it("shows a tentative number as plainly as a permanent one", () => {
    // A consultation number is not a lesser number: the record really carries it, it survives the
    // matter opening rather than being replaced by it, and a document filed under it still
    // resolves. Marking it as provisional in the one line a reader looks for a number in would say
    // the opposite of what is true.
    expect(
      renderReference({ kind: "Consultation", number: "2026-C-0042", standing: "tentative" }),
    ).toEqual({ shape: "identified", kind: "Consultation", number: "2026-C-0042", note: null });
  });

  it("says a previewed number is drawn by the save", () => {
    // Nothing has been taken. A record saved first takes this number and this one moves on, so the
    // panel states that rather than letting a reader believe it has been held for them.
    expect(
      renderReference({ kind: "Call", number: "2026-09-08-0042", standing: "preview" }),
    ).toEqual({
      shape: "identified",
      kind: "Call",
      number: "2026-09-08-0042",
      note: PREVIEW_NOTE,
    });
  });

  it("defaults to drawn", () => {
    const withoutStanding = renderReference({ kind: "Invoice", number: "2026-0147" });
    const withDrawn = renderReference({ kind: "Invoice", number: "2026-0147", standing: "drawn" });
    expect(withoutStanding).toEqual(withDrawn);
  });
});

describe("when there is no number to show", () => {
  it("promises one only where the save is what draws it", () => {
    expect(renderReference({ kind: "Call", number: null, standing: "preview" })).toEqual({
      shape: "awaiting",
      sentence: AWAITING_NUMBER_SENTENCE,
    });
  });

  it("names the kind alone for a number that is simply not known", () => {
    // A record still loading has a number; this panel does not have it yet. Saying a save would
    // draw one would be a claim about a record that already has its own, so the honest answer is
    // what kind of record is being acted on and nothing more.
    for (const standing of ["drawn", "tentative"] as const) {
      expect(renderReference({ kind: "Invoice", number: null, standing })).toEqual({
        shape: "unnumbered",
        kind: "Invoice",
      });
    }
  });

  it("never renders silence", () => {
    for (const standing of EVERY_STANDING) {
      const rendered = renderReference({ kind: "Packet", number: null, standing });
      expect(rendered.shape === "awaiting" ? rendered.sentence : rendered.kind).not.toBe("");
    }
  });
});

describe("the subject line", () => {
  it("renders nothing when it has nothing to say", () => {
    expect(subjectIsEmpty({})).toBe(true);
    expect(subjectIsEmpty({ facts: [] })).toBe(true);
  });

  it("has something to say with either half", () => {
    expect(subjectIsEmpty({ reference: { kind: "Matter", number: null } })).toBe(false);
    expect(subjectIsEmpty({ facts: ["Every matter"] })).toBe(false);
  });

  it("joins with one mark", () => {
    // The panels this replaces used a middle dot in five places and an em dash in a sixth, for the
    // same join. It is a constant because it was a per-call-site choice.
    expect(SUBJECT_SEPARATOR).toBe("·");
  });
});
