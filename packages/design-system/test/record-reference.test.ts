import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_NUMBER_DESCRIPTION,
  renderReference,
  subjectIsEmpty,
  SUBJECT_SEPARATOR,
} from "../src/lib/components/record-reference/record-reference-model.ts";
import {
  DRAFT_NUMBER_RENEWAL_MILLISECONDS,
  DraftNumber,
  type DraftNumberKeeper,
  type HeldDraftNumber,
} from "../src/lib/components/record-reference/draft-number.svelte.ts";

/*
 * What a record reference reads as, and how a draft number is held.
 *
 * What is rendered belongs to the stories, which run in a real browser with axe. What is pinned here
 * is the decision underneath: how a number is taken depending on how firmly the record holds it, and
 * the lifecycle every create panel shares — hold, keep in step with its scope, give back on cancel.
 */

describe("how firmly a record holds its number", () => {
  it("shows a drawn number as the record's own", () => {
    expect(renderReference({ kind: "Matter", number: "2026-0147" })).toEqual({
      shape: "identified",
      kind: "Matter",
      number: "2026-0147",
      draft: false,
    });
  });

  it("shows a tentative number as plainly as a permanent one", () => {
    // A consultation number is not a lesser number: the record really carries it, it survives the
    // matter opening rather than being replaced by it, and a document filed under it still
    // resolves.
    expect(
      renderReference({ kind: "Consultation", number: "2026-C-0042", standing: "tentative" }),
    ).toEqual({ shape: "identified", kind: "Consultation", number: "2026-C-0042", draft: false });
  });

  it("marks a draft number as one", () => {
    expect(renderReference({ kind: "Check", number: "CC2026-00012", standing: "draft" })).toEqual({
      shape: "identified",
      kind: "Check",
      number: "CC2026-00012",
      draft: true,
    });
    expect(DRAFT_NUMBER_DESCRIPTION).toMatch(/^Draft number\./);
  });

  it("defaults to drawn", () => {
    const withoutStanding = renderReference({ kind: "Bill", number: "2026-0147" });
    const withDrawn = renderReference({ kind: "Bill", number: "2026-0147", standing: "drawn" });
    expect(withoutStanding).toEqual(withDrawn);
  });
});

describe("when there is no number to show", () => {
  it("names the kind alone, whatever the standing", () => {
    // The sentence "A number is drawn when this is saved." is gone (owner, 2026-11-14): a panel
    // creating a record shows the number it holds, and until one is held it names the kind.
    for (const standing of ["drawn", "tentative", "draft"] as const) {
      expect(renderReference({ kind: "Bill", number: null, standing })).toEqual({
        shape: "unnumbered",
        kind: "Bill",
      });
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
    expect(subjectIsEmpty({ facts: ["All matters"] })).toBe(false);
  });

  it("joins with one mark", () => {
    expect(SUBJECT_SEPARATOR).toBe("·");
  });
});

/** A keeper that answers from a script and records what it was asked. */
function keeperOf(answers: (token: string | null) => Promise<HeldDraftNumber | null>): {
  keeper: DraftNumberKeeper;
  asked: (string | null)[];
  released: string[];
} {
  const asked: (string | null)[] = [];
  const released: string[] = [];
  return {
    keeper: {
      hold: (token) => {
        asked.push(token);
        return answers(token);
      },
      release: async (token) => {
        released.push(token);
      },
    },
    asked,
    released,
  };
}

function deferred(): {
  promise: Promise<HeldDraftNumber | null>;
  settle: (value: HeldDraftNumber | null) => void;
} {
  let settle!: (value: HeldDraftNumber | null) => void;
  const promise = new Promise<HeldDraftNumber | null>((resolve) => (settle = resolve));
  return { promise, settle };
}

describe("the draft number a panel holds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the kind before it carries a number", () => {
    expect(new DraftNumber("Packet").reference).toEqual({
      kind: "Packet",
      number: null,
      standing: "draft",
    });
  });

  it("holds a number and hands its token to the save", async () => {
    const draft = new DraftNumber("Check");
    const { keeper } = keeperOf(async () => ({ token: "t1", number: "CC2026-00012" }));
    await draft.hold(keeper);
    expect(draft.reference).toEqual({ kind: "Check", number: "CC2026-00012", standing: "draft" });
    expect(draft.token).toBe("t1");
    draft.taken();
  });

  it("asks again with the token it holds, so the same number is kept", async () => {
    const draft = new DraftNumber("Call");
    const { keeper, asked } = keeperOf(async () => ({ token: "t1", number: "2026-09-08-0042" }));
    await draft.hold(keeper);
    await draft.hold(keeper);
    expect(asked).toEqual([null, "t1"]);
    draft.taken();
  });

  it("gives back the number a superseded ask was handed", async () => {
    // Somebody writing up Tuesday's call on Thursday changes the date before the first answer lands.
    const draft = new DraftNumber("Call");
    const slow = deferred();
    let call = 0;
    const { keeper, released } = keeperOf(async () => {
      call += 1;
      return call === 1 ? slow.promise : { token: "t2", number: "2026-09-08-0001" };
    });
    const first = draft.hold(keeper);
    await draft.hold(keeper);
    slow.settle({ token: "t1", number: "2026-09-10-0001" });
    await first;
    expect(draft.reference.number).toBe("2026-09-08-0001");
    expect(released).toEqual(["t1"]);
    draft.taken();
  });

  it("gives the number back when the panel is cancelled", async () => {
    const draft = new DraftNumber("Packet");
    const { keeper, released } = keeperOf(async () => ({ token: "t1", number: "CUS-00007" }));
    await draft.hold(keeper);
    draft.release();
    expect(released).toEqual(["t1"]);
    expect(draft.reference.number).toBeNull();
    expect(draft.token).toBeUndefined();
  });

  it("does not give back a number the save took", async () => {
    const draft = new DraftNumber("Packet");
    const { keeper, released } = keeperOf(async () => ({ token: "t1", number: "CUS-00007" }));
    await draft.hold(keeper);
    draft.taken();
    draft.release();
    expect(released).toEqual([]);
  });

  it("renews the hold while the panel stays open", async () => {
    vi.useFakeTimers();
    const draft = new DraftNumber("Check");
    const { keeper, asked } = keeperOf(async () => ({ token: "t1", number: "CC2026-00012" }));
    await draft.hold(keeper);
    await vi.advanceTimersByTimeAsync(DRAFT_NUMBER_RENEWAL_MILLISECONDS);
    expect(asked).toEqual([null, "t1"]);
    draft.taken();
    await vi.advanceTimersByTimeAsync(DRAFT_NUMBER_RENEWAL_MILLISECONDS);
    expect(asked).toEqual([null, "t1"]);
  });

  it("leaves the panel usable when nothing can be held", async () => {
    const draft = new DraftNumber("Matter");
    const { keeper } = keeperOf(async () => null);
    await draft.hold(keeper);
    expect(draft.reference.number).toBeNull();
    expect(draft.token).toBeUndefined();
  });
});
