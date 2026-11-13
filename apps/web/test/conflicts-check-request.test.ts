/*
 * What the New Check panel composes, asserted over plain values.
 *
 * The panel has two panes on one draft, and every claim it makes — what the commit will send, why
 * it cannot be sent yet, and whether there is anything to lose — is one function away from those
 * values. That is the whole reason the composition lives outside the
 * components: these are the assertions that would otherwise need a browser and a mounted dialog.
 */
import { describe, expect, it } from "vitest";
import {
  OPENING_DRAFT,
  chosenMatterLine,
  composeCheck,
  sourcesFor,
  triggerFor,
  type CheckDraftValues,
  type CheckSurface,
} from "../src/lib/conflicts/check-request.ts";
import { RUN_CHECK_PERMISSION } from "../src/lib/conflicts/conflicts-api.ts";
import { OPERATOR_TRIGGERS } from "../src/lib/conflicts/conflicts-vocabulary.ts";

const draft = (over: Partial<CheckDraftValues> = {}): CheckDraftValues => ({
  ...OPENING_DRAFT,
  subjectEntityIds: ["entity-1"],
  ...over,
});

const surface = (over: Partial<CheckSurface> = {}): CheckSurface => ({
  matterId: null,
  matterEngaged: false,
  permissions: [RUN_CHECK_PERMISSION],
  ...over,
});

describe("a check does not need a matter", () => {
  it("composes a request from parties alone", () => {
    const { refusal, request } = composeCheck(draft(), surface());
    expect(refusal).toBeNull();
    expect(request?.subjectEntityIds).toEqual(["entity-1"]);
    expect(request?.matterId).toBeUndefined();
  });

  it("refuses only when nobody is named and no matter is filed against either", () => {
    const nobody = draft({ subjectEntityIds: [] });
    expect(composeCheck(nobody, surface()).refusal).toBe("Name at least one party.");
    // A matter brings its own parties, so a check filed against one may name none of its own.
    expect(composeCheck(nobody, surface({ matterId: "matter-1" })).refusal).toBeNull();
  });

  it("refuses an account that may not run one, before the server has to", () => {
    const composed = composeCheck(draft(), surface({ permissions: ["conflicts:read"] }));
    expect(composed.refusal).toContain(RUN_CHECK_PERMISSION);
    expect(composed.request).toBeNull();
  });

  it("composes while the session is still landing, rather than refusing on an unknown", () => {
    expect(composeCheck(draft(), surface({ permissions: null })).refusal).toBeNull();
  });

  it("reads a matter by its number where it has one, and by its title where it has none", () => {
    expect(chosenMatterLine({ id: "m", matterNumber: "2026-0001", title: "Acme" })).toBe(
      "2026-0001 · Acme",
    );
    expect(chosenMatterLine({ id: "m", matterNumber: null, title: "Acme" })).toBe("Acme");
  });
});

describe("the trigger is derived, never asked", () => {
  it("files a check with no matter as preliminary", () => {
    expect(triggerFor(surface())).toBe("preliminary");
  });

  it("files a check against a matter the firm has not taken on as preliminary", () => {
    expect(triggerFor(surface({ matterId: "matter-1", matterEngaged: false }))).toBe("preliminary");
  });

  it("files a check against a matter the firm has taken on as comprehensive", () => {
    expect(triggerFor(surface({ matterId: "matter-1", matterEngaged: true }))).toBe(
      "comprehensive",
    );
  });

  it("never derives a trigger that would claim the firm's system caught something", () => {
    for (const matterEngaged of [true, false]) {
      for (const matterId of ["matter-1", null]) {
        expect(OPERATOR_TRIGGERS).toContain(triggerFor(surface({ matterId, matterEngaged })));
      }
    }
  });
});

describe("what is searched", () => {
  it("always asks for the party class, which is the firm-wide floor", () => {
    expect(sourcesFor(draft({ searchRelationships: false, searchOwnPeople: false }))).toEqual([
      "party",
    ]);
  });

  it("asks for Firm Employees whether or not a matter is named", () => {
    // With no matter the engine looks for the firm's own people among everyone the check reached.
    expect(sourcesFor(draft())).toContain("imputation");
    expect(composeCheck(draft(), surface()).request?.scope.sources).toContain("imputation");
    expect(sourcesFor(draft({ searchOwnPeople: false }))).not.toContain("imputation");
  });

  it("drops the relationship walk when it is turned off", () => {
    expect(sourcesFor(draft({ searchRelationships: false }))).not.toContain("graph");
  });
});

describe("nothing limits the search", () => {
  it("sends where to search and how to compare names, and no number at all", () => {
    const { request } = composeCheck(draft(), surface());
    expect(request?.scope).toEqual({
      sources: ["party", "graph", "imputation"],
      strictness: "balanced",
      places: {
        messaging: ["calls", "texts", "email"],
        tasks: ["consultations", "open", "closed", "archived"],
        magnus: true,
        files: ["consultations", "open", "closed", "archived"],
      },
    });
    expect(Object.keys(OPENING_DRAFT)).toEqual([
      "subjectEntityIds",
      "searchRelationships",
      "searchOwnPeople",
      "nameMatching",
      "trigramMatching",
      "messaging",
      "tasks",
      "magnus",
      "files",
    ]);
  });

  it("sends trigram matching off only when a balanced check turns it off", () => {
    expect(composeCheck(draft({ trigramMatching: false }), surface()).request?.scope).toMatchObject(
      {
        strictness: "balanced",
        trigramMatching: false,
      },
    );
    // Over-inclusive always runs it, so the request does not carry a choice the server ignores.
    const overInclusive = composeCheck(
      draft({ nameMatching: "over_inclusive", trigramMatching: false }),
      surface(),
    ).request?.scope;
    expect(overInclusive).not.toHaveProperty("trigramMatching");
  });

  it("asks for only the messaging channels, task and file statuses left on", () => {
    const { request } = composeCheck(
      draft({ messaging: ["texts"], tasks: [], magnus: false, files: ["closed"] }),
      surface(),
    );
    expect(request?.scope.places).toEqual({
      messaging: ["texts"],
      tasks: [],
      magnus: false,
      files: ["closed"],
    });
  });

  it("counts a change to Files as a started check", () => {
    expect(composeCheck({ ...OPENING_DRAFT, files: ["open"] }, surface()).started).toBe(true);
  });
});

describe("the close guard's answer", () => {
  it("has nothing to lose while every field sits on its opening value", () => {
    expect(composeCheck(OPENING_DRAFT, surface()).started).toBe(false);
  });

  it("has something to lose the moment a party is named", () => {
    expect(composeCheck(draft(), surface()).started).toBe(true);
  });

  it("has something to lose when only a setting was moved", () => {
    const moved = { ...OPENING_DRAFT, nameMatching: "over_inclusive" } as const;
    expect(composeCheck(moved, surface()).started).toBe(true);
    expect(composeCheck({ ...OPENING_DRAFT, magnus: false }, surface()).started).toBe(true);
    expect(composeCheck({ ...OPENING_DRAFT, tasks: ["open"] }, surface()).started).toBe(true);
  });
});
