/*
 * The docket's column model and the listing's query, pinned.
 *
 * These are the two places on the matters surface where a quiet mistake would be invisible on
 * screen and wrong in a way a person would act on: a column that prints a handle instead of a name,
 * a number column that reads blank on a consultation, a sort that puts the unnumbered first, and a
 * listing asked with a status the caller did not choose. Each case below is one of those.
 */
import { describe, expect, it } from "vitest";
import {
  matterColumns,
  matterNumberText,
  matterVocabulary,
  resolvedName,
  EMPTY_MATTER_VOCABULARY,
  MATTER_INITIAL_SORT,
  UNNUMBERED_DESIGNATION,
} from "../src/lib/matters/matter-columns.ts";
import { listMatters, type MatterSummary } from "../src/lib/matters/matters-api.ts";
import {
  matterStatusLabel,
  matterStatusPresentation,
  MATTER_STATUSES,
} from "../src/lib/matters/matter-status.ts";

function matter(overrides: Partial<MatterSummary> = {}): MatterSummary {
  return {
    id: "matter_one",
    title: "Pemberton v. Hale",
    status: "open",
    matterTypeId: "matterType_litigation",
    locationId: "location_reno",
    responsibleMemberId: "user_chase",
    clientDisplayName: "Pemberton Holdings",
    matterNumber: "2026-0147",
    createdAt: "2026-03-14T09:00:00.000Z",
    ...overrides,
  };
}

const VOCABULARY = matterVocabulary(
  [{ id: "matterType_litigation", name: "Litigation" }],
  [{ id: "location_reno", name: "Reno" }],
  [{ userId: "user_chase", displayName: "Marguerite Chase" }],
);

function columnById(id: string, vocabulary = VOCABULARY) {
  const column = matterColumns(vocabulary).find((candidate) => candidate.id === id);
  if (column === undefined) throw new Error(`No column "${id}" in the matters column model.`);
  return column;
}

describe("the matter-status register", () => {
  it("gives every lifecycle status a title-case label and a subtle tone", () => {
    for (const status of MATTER_STATUSES) {
      const presentation = matterStatusPresentation(status);
      expect(presentation.label).toBe(
        presentation.label.charAt(0).toUpperCase() + presentation.label.slice(1),
      );
      expect(presentation.variant).not.toBe("danger");
    }
  });

  it("keeps closed quiet: an archived matter is not a failure", () => {
    expect(matterStatusPresentation("closed").variant).toBe("neutral");
  });
});

describe("the number column", () => {
  it("prints the drawn number", () => {
    expect(matterNumberText(matter())).toBe("2026-0147");
  });

  it("names an unnumbered CONSULTATION for what it is rather than leaving a gap", () => {
    expect(matterNumberText(matter({ matterNumber: null, status: "prospective" }))).toBe(
      UNNUMBERED_DESIGNATION,
    );
  });

  it("does NOT call an open matter with no number a consultation", () => {
    // The designation is a lifecycle fact, not a synonym for "no number". An open row without one
    // is a gap in the record, and asserting it is a consultation would state a status it is not in.
    expect(matterNumberText(matter({ matterNumber: null, status: "open" }))).toBe("");
    expect(matterNumberText(matter({ matterNumber: null, status: "closed" }))).toBe("");
  });

  it("sorts the unnumbered as an absent value, so consultations never lead the docket", () => {
    // The grid sorts on `value`, not on the text: a null value sorts last in both directions,
    // which is exactly what an unnumbered matter should do.
    expect(columnById("matterNumber").value(matter({ matterNumber: null }))).toBeNull();
  });

  it("always shows: the row's identity is not a column a person can hide", () => {
    expect(columnById("matterNumber").anchored).toBe(true);
  });
});

describe("the vocabulary columns", () => {
  it("resolves a matter type and a Location to the firm's own names", () => {
    expect(columnById("practiceArea").value(matter())).toBe("Litigation");
    expect(columnById("location").value(matter())).toBe("Reno");
  });

  it("renders an unresolvable identifier as empty, never as the handle", () => {
    const unknown = matter({ matterTypeId: "matterType_retired" });
    expect(columnById("practiceArea").value(unknown)).toBe("");
    expect(columnById("practiceArea").value(matter({ matterTypeId: null }))).toBe("");
  });

  it("renders empty before the vocabularies land rather than showing identifiers", () => {
    expect(columnById("practiceArea", EMPTY_MATTER_VOCABULARY).value(matter())).toBe("");
  });

  it("resolvedName answers empty for a null identifier", () => {
    expect(resolvedName(new Map([["a", "A"]]), null)).toBe("");
    expect(resolvedName(new Map([["a", "A"]]), "a")).toBe("A");
  });

  it("starts Location hidden, since most firms run one office", () => {
    expect(columnById("location").hidden).toBe(true);
  });
});

describe("the responsible-attorney column", () => {
  it("names the attorney from the firm's roster rather than showing the identifier", () => {
    expect(columnById("responsibleAttorney").value(matter())).toBe("Marguerite Chase");
  });

  it("renders EMPTY for a member the roster does not name, never the user handle", () => {
    // Two real cases, treated alike: a matter carried by somebody the roster has no row for, and a
    // roster that has not landed. Neither is worth asserting in a cell, and printing `user_…` at a
    // person is the outcome this column exists to avoid.
    expect(
      columnById("responsibleAttorney").value(matter({ responsibleMemberId: "user_ghost" })),
    ).toBe("");
    expect(columnById("responsibleAttorney", EMPTY_MATTER_VOCABULARY).value(matter())).toBe("");
  });

  it("names a DEPARTED colleague, because a closed matter is still theirs", () => {
    const withDeparted = matterVocabulary(
      [],
      [],
      [{ userId: "user_gone", displayName: "Cormac Vale" }],
    );
    expect(
      columnById("responsibleAttorney", withDeparted).value(
        matter({ responsibleMemberId: "user_gone" }),
      ),
    ).toBe("Cormac Vale");
  });

  it("shows by default: whose matter it is is not a column a person has to go find", () => {
    expect(columnById("responsibleAttorney").hidden).toBeUndefined();
  });

  it("takes the set filter: a docket is narrowed by picking an attorney, not by typing one", () => {
    expect(columnById("responsibleAttorney").filter).toBe("set");
  });
});

describe("the status column", () => {
  it("carries the label, so the set filter offers what the column shows", () => {
    expect(columnById("status").value(matter({ status: "closed" }))).toBe(
      matterStatusLabel("closed"),
    );
  });

  it("takes the set filter: a docket is narrowed by picking a status, not by typing one", () => {
    expect(columnById("status").filter).toBe("set");
  });
});

describe("the created column", () => {
  it("is a date column over the instant the listing actually serves", () => {
    const column = columnById("createdAt");
    expect(column.type).toBe("date");
    expect(column.value(matter())).toBe("2026-03-14T09:00:00.000Z");
  });

  it("says Created, because the listing does not serve the opened date", () => {
    expect(columnById("createdAt").label).toBe("Created");
  });

  it("is what the docket sorts by, newest first", () => {
    expect(MATTER_INITIAL_SORT).toEqual({ columnId: "createdAt", direction: "descending" });
  });
});

/** The path the listing actually asked for, against a fetch that answers an empty page. */
async function requestedUrl(query: Parameters<typeof listMatters>[1]): Promise<string> {
  let seen = "";
  const fetchImpl = ((input: string) => {
    seen = input;
    return Promise.resolve(
      new Response(JSON.stringify({ data: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  await listMatters(fetchImpl, query);
  return seen;
}

describe("the listing query", () => {
  it("names no status for the working docket: the listing's own default is the caseload", async () => {
    expect(await requestedUrl({ scope: "caseload" })).toBe("/api/v1/matters");
  });

  it("asks for consultations explicitly, since the default read leaves them out", async () => {
    expect(await requestedUrl({ scope: "prospective" })).toContain("status=prospective");
  });

  it("sends the search to the server rather than narrowing rows on screen", async () => {
    expect(await requestedUrl({ scope: "caseload", search: "Pemberton" })).toContain(
      "search=Pemberton",
    );
  });

  it("drops a search that is only whitespace", async () => {
    expect(await requestedUrl({ scope: "caseload", search: "   " })).toBe("/api/v1/matters");
  });

  it("passes a cursor back opaquely", async () => {
    const url = await requestedUrl({ scope: "open", cursor: "opaque:cursor" });
    expect(url).toContain("cursor=opaque%3Acursor");
    expect(url).toContain("status=open");
  });
});
