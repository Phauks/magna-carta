/*
 * The hit list's column model. Two things here are worth a test rather than a reading:
 *
 *   - The tier ANCHORS the row and is never hideable, because a reviewer's queue is ordered by what
 *     kind of thing matched and a list that lost that ordering is a list nobody can triage.
 *   - The Party column names somebody, or says which of the two ways it could not. A conflicts hit
 *     always HAS a party, so a blank cell would read as a hit against nobody — the inverse of what
 *     the row means — and the distinction between an unresolved entity and an unnamed record is
 *     exactly the kind of thing that gets "tidied up" into one empty string.
 */
import { describe, expect, it } from "vitest";
import type { HitDetail } from "../src/lib/conflicts/conflicts-api.ts";
import {
  HIT_COLUMN_IDENTIFIERS,
  HIT_INITIAL_SORT,
  SURFACED_AGAINST_DIRECTORY,
  SURFACED_AGAINST_SUBJECT,
  adjudicationText,
  entityKindText,
  hitColumns,
  matchedOnText,
  partyCellTitle,
  partyText,
  surfacedAgainstText,
} from "../src/lib/conflicts/hit-columns.ts";

function hit(overrides: Partial<HitDetail> = {}): HitDetail {
  return {
    id: "conflictsHit_one",
    entityId: "directoryPerson_one",
    party: { kind: "person", displayName: "Dana Reyes" },
    sourceClass: "party",
    evidenceTier: 2,
    matchedFields: ["exact normalized name match", "trigram overlap"],
    graphPath: [],
    coParty: false,
    foundIn: null,
    createdAt: "2026-08-30T12:00:00.000Z",
    disposition: null,
    previouslyAnswered: null,
    ...overrides,
  };
}

describe("the column model", () => {
  it("anchors the tier and leads with it", () => {
    const columns = hitColumns();
    expect(columns[0]?.id).toBe(HIT_COLUMN_IDENTIFIERS.tier);
    expect(columns[0]?.anchored).toBe(true);
    expect(HIT_INITIAL_SORT.columnId).toBe(HIT_COLUMN_IDENTIFIERS.tier);
    expect(HIT_INITIAL_SORT.direction).toBe("ascending");
  });

  it("sorts the tier as the reader reads it, strongest first", () => {
    const tier = hitColumns().find((column) => column.id === HIT_COLUMN_IDENTIFIERS.tier);
    expect(tier?.value(hit({ evidenceTier: 1 }))).toBe("Tier 1");
    expect(tier?.value(hit({ evidenceTier: 4 }))).toBe("Tier 4");
  });

  it("names the party the hit is about", () => {
    const party = hitColumns().find((column) => column.id === HIT_COLUMN_IDENTIFIERS.party);
    expect(party).toBeDefined();
    expect(party?.hidden).toBeUndefined();
    expect(party?.value(hit())).toBe("Dana Reyes");
  });

  it("never renders a party as blank: the two ways of not naming one each say which", () => {
    /*
     * A conflicts hit always HAS a party — that is the whole content of the row — so a cell that
     * came back empty would read as a hit against nobody, which is the opposite of its meaning.
     * The two ways a name can be missing are different facts and the surface separates them:
     * the entity no longer resolves (a merge after the check, which the append-only log makes
     * reachable), or the Directory holds the record and nobody has named it.
     */
    const unresolved = hit({ party: null });
    expect(partyText(unresolved)).toBe("Entity not resolved");
    expect(partyCellTitle(unresolved)).toContain(unresolved.entityId);

    const unnamed = hit({ party: { kind: "person", displayName: null } });
    expect(partyText(unnamed)).toBe("Unnamed record");
    expect(partyCellTitle(unnamed)).toContain("has no name");

    // A named party needs no explanation, so it carries no hover at all.
    expect(partyCellTitle(hit())).toBeUndefined();
  });

  it("offers a set filter on every column a reviewer triages by", () => {
    const filtered = hitColumns()
      .filter((column) => column.filter === "set")
      .map((column) => column.id);
    expect(filtered).toContain(HIT_COLUMN_IDENTIFIERS.tier);
    expect(filtered).toContain(HIT_COLUMN_IDENTIFIERS.source);
    expect(filtered).toContain(HIT_COLUMN_IDENTIFIERS.surfacedAgainst);
    expect(filtered).toContain(HIT_COLUMN_IDENTIFIERS.adjudication);
  });
});

describe("what a cell says", () => {
  it("reads the entity kind off the handle's own type tag", () => {
    expect(entityKindText("directoryPerson_one")).toBe("Person");
    expect(entityKindText("directoryOrganization_one")).toBe("Organization");
    expect(entityKindText("somethingElse_one")).toBe("");
  });

  it("lists every channel that fired, not only the tier-setting one", () => {
    expect(matchedOnText(hit())).toBe("exact normalized name match; trigram overlap");
  });

  it("triages a co-party surfacing apart from the rest of the Directory", () => {
    expect(surfacedAgainstText(hit({ coParty: true }))).toBe(SURFACED_AGAINST_SUBJECT);
    expect(surfacedAgainstText(hit({ coParty: false }))).toBe(SURFACED_AGAINST_DIRECTORY);
  });

  it("states an unanswered hit rather than leaving it blank", () => {
    expect(adjudicationText(hit())).toBe("Unanswered");
  });

  it("states the reviewer's latest word where there is one", () => {
    const answered = hit({
      disposition: {
        id: "conflictsDisposition_one",
        kind: "waiver_obtained",
        rationale: "The client confirmed the waiver.",
        reviewerUserId: "user_one",
        waiver: {
          givenByEntityId: "directoryPerson_client",
          confirmedInWriting: true,
          documentFileId: "file_confirmation",
          givenOn: "2026-08-24",
        },
        shortfalls: [],
        createdAt: "2026-08-30T13:00:00.000Z",
      },
    });
    expect(adjudicationText(answered)).toBe("Waiver Obtained");
  });

  // The failure mode this column exists to prevent: a waiver the firm cannot evidence reading
  // exactly like one it can. It differs in TEXT, not only in tone, because this string is also the
  // value the column's set filter groups by.
  it("separates a waiver the platform cannot produce the record for", () => {
    const answered = hit({
      disposition: {
        id: "conflictsDisposition_two",
        kind: "waiver_obtained",
        rationale: "Consent given by telephone; the letter is going out today.",
        reviewerUserId: "user_one",
        waiver: {
          givenByEntityId: "directoryPerson_client",
          confirmedInWriting: false,
          documentFileId: null,
          givenOn: "2026-08-24",
        },
        shortfalls: ["consent-not-confirmed-in-writing", "confirmation-not-filed"],
        createdAt: "2026-08-30T13:00:00.000Z",
      },
    });
    expect(adjudicationText(answered)).not.toBe("Waiver Obtained");
    expect(adjudicationText(answered)).toBe("Waiver: Incomplete Record");
  });
});
