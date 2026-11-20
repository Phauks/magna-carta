import { client } from "@magna-carta/api-client/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DirectorySearchHit } from "$lib/directory/directory-api.ts";
import type { MatterSummary } from "$lib/matters/matters-api.ts";
import type {
  AcrossMattersAnswer,
  AcrossMattersGroup,
} from "$lib/search/search-across-matters-api.ts";
import {
  NAMES_NOT_FILTERED_REASON,
  PEOPLE_NOT_SEARCHED_REASON,
  PLACE_LIMIT,
  SearchAcrossMatters,
  listedHits,
  panelPlaces,
  tickedPlacesHoldMore,
  type SearchAnswer,
} from "$lib/search/search-across-matters.svelte.ts";
import {
  CHOSEN_MATTERS_LIMIT,
  EVERYTHING,
  MATTERS_PLACE,
  MY_MATTERS,
  NO_FILTERS,
  PEOPLE_PLACE,
  askedKey,
  filtersFromAddress,
  isRecordPlace,
  placeTicked,
  searchAddress,
  type SearchFilters,
} from "$lib/search/search-address.ts";
import {
  UNNAMED_CLIENT,
  clientNamed,
  dateChoiceOf,
  daysOfChoice,
  filterCount,
  withMatter,
  withPlace,
  withoutMatter,
} from "$lib/search/search-filters.ts";

const CLIENT = "directoryPerson_hargrove";
const ORIGIN = "https://app.example";
const TODAY = "2026-11-19";

function group(source: string, overrides: Partial<AcrossMattersGroup> = {}): AcrossMattersGroup {
  return {
    source,
    section: source,
    answerShape: "listing",
    matchedFields: [],
    hits: [],
    hasMore: false,
    skipped: null,
    ...overrides,
  };
}

function hit(id: string, sortKey = "2026-06-04T15:00:00.000Z", matterId = "matter_a") {
  return {
    id,
    title: sortKey,
    titleMarks: [],
    snippet: "The easement runs along the eastern boundary.",
    snippetMarks: [{ start: 4, end: 12 }],
    secondary: null,
    actorUserId: null,
    sortKey,
    link: `/matters/${matterId}/notes?entry=${id}`,
    matter: { id: matterId, title: "Ashgrove easement dispute", number: "AM-0001" },
  };
}

function matter(id: string): MatterSummary {
  return {
    id,
    title: "Ashgrove easement dispute",
    status: "open",
    matterTypeId: null,
    locationId: null,
    responsibleMemberId: "user_a",
    clientDisplayName: "Devon Marchetti",
    clientEntityId: null,
    matterNumber: "AM-0001",
    consultationNumber: null,
    intakeNumber: null,
    createdAt: "2026-03-03T00:00:00.000Z",
  };
}

function filtered(part: Partial<SearchFilters> = {}): SearchFilters {
  return { ...NO_FILTERS, ...part };
}

function answerOf(
  groups: AcrossMattersGroup[],
  overrides: Partial<SearchAnswer> = {},
): SearchAnswer {
  return {
    query: "easement",
    filters: NO_FILTERS,
    matters: { rows: [], more: false, standing: "not-searched" },
    people: { rows: [], more: false, standing: "not-searched" },
    records: { query: "easement", broad: false, fewMattersLimit: 25, groups },
    ...overrides,
  };
}

const REGISTRY_ANSWER: AcrossMattersGroup[] = [
  group("files", { hits: [hit("file_1", "2026-08-01T00:00:00.000Z")] }),
  group("file-contents", { answerShape: "ranked" }),
  group("time", { hits: [hit("time_1", "2026-07-01")] }),
  group("costs"),
  group("billing"),
  group("parties"),
  group("calendar", { skipped: "one-matter-only" }),
  group("notes", {
    hits: [hit("note_1", "2026-07-14"), hit("note_2", "2026-06-04")],
    hasMore: true,
  }),
  group("custody"),
  group("communications"),
];

describe("the address is the page's state", () => {
  it("carries the question alone when nothing is filtered", () => {
    expect(searchAddress("  Hargrove easement ")).toBe("/search?q=Hargrove+easement");
    expect(searchAddress("")).toBe("/search");
  });

  it("carries every filter, places and matters one parameter each", () => {
    const address = searchAddress("easement", {
      places: ["notes", "files"],
      reach: { kind: "matters", matterIds: ["matter_a", "matter_b"] },
      days: { from: "2026-06-01", to: "2026-11-16" },
      by: "user_a",
    });
    expect(address).toBe(
      "/search?q=easement&in=notes&in=files&matter=matter_a&matter=matter_b" +
        "&from=2026-06-01&to=2026-11-16&by=user_a",
    );
    expect(searchAddress("easement", { reach: MY_MATTERS })).toBe("/search?q=easement&scope=mine");
    expect(searchAddress("easement", { reach: { kind: "client", entityId: CLIENT } })).toBe(
      `/search?q=easement&client=${CLIENT}`,
    );
  });

  it("reads every filter back as it was written", () => {
    const filters: SearchFilters = {
      places: ["notes", MATTERS_PLACE],
      reach: { kind: "matters", matterIds: ["matter_a"] },
      days: { from: "2026-06-01" },
      by: "user_a",
    };
    const address = new URL(searchAddress("easement", filters), ORIGIN);
    expect(filtersFromAddress(address.searchParams)).toEqual(filters);
  });

  it("reads anything it does not know as no filter, never as an error", () => {
    const parameters = new URLSearchParams("q=easement&scope=theirs&from=2026-02-30&by=&in=");
    expect(filtersFromAddress(parameters)).toEqual(NO_FILTERS);
  });

  it("names each chosen matter once, and no more of them than the server takes", () => {
    const ids = Array.from({ length: CHOSEN_MATTERS_LIMIT + 3 }, (_, index) => `matter_${index}`);
    const parameters = new URLSearchParams(
      [...ids, "matter_0"].map((id) => `matter=${id}`).join("&"),
    );
    const reach = filtersFromAddress(parameters).reach;
    expect(reach.kind === "matters" ? reach.matterIds : []).toHaveLength(CHOSEN_MATTERS_LIMIT);
  });

  it("ticks every record place and no names until the reader changes them", () => {
    expect(placeTicked(NO_FILTERS, "notes")).toBe(true);
    expect(placeTicked(NO_FILTERS, MATTERS_PLACE)).toBe(false);
    expect(placeTicked(NO_FILTERS, PEOPLE_PLACE)).toBe(false);
    expect(placeTicked(filtered({ places: [MATTERS_PLACE] }), "notes")).toBe(false);
    expect(isRecordPlace(PEOPLE_PLACE)).toBe(false);
  });

  it("asks the server again for matters, days and a person, and not for a tick", () => {
    expect(askedKey(filtered({ places: ["notes"] }))).toBe(askedKey(NO_FILTERS));
    expect(askedKey(filtered({ by: "user_a" }))).not.toBe(askedKey(NO_FILTERS));
    expect(askedKey(filtered({ days: { from: "2026-06-01" } }))).not.toBe(askedKey(NO_FILTERS));
    expect(
      askedKey(filtered({ reach: { kind: "matters", matterIds: ["matter_b", "matter_a"] } })),
    ).toBe(askedKey(filtered({ reach: { kind: "matters", matterIds: ["matter_a", "matter_b"] } })));
  });
});

describe("what the filter panel decides", () => {
  const every = ["notes", "files", "time", MATTERS_PLACE, PEOPLE_PLACE];

  it("writes the places out in full once one is unticked, and says nothing once back to the start", () => {
    const unticked = withPlace(NO_FILTERS, every, "files", false);
    expect(unticked).toEqual(["notes", "time"]);
    expect(withPlace(filtered({ places: unticked }), every, "files", true)).toBeNull();
    expect(withPlace(NO_FILTERS, every, MATTERS_PLACE, true)).toEqual([
      "notes",
      "files",
      "time",
      MATTERS_PLACE,
    ]);
  });

  it("adds a chosen matter once, never past the limit, and goes back to every matter at none", () => {
    const one = withMatter(EVERYTHING, "matter_a");
    expect(one).toEqual({ kind: "matters", matterIds: ["matter_a"] });
    expect(withMatter(one, "matter_a")).toEqual(one);
    const full = {
      kind: "matters" as const,
      matterIds: Array.from({ length: CHOSEN_MATTERS_LIMIT }, (_, index) => `matter_${index}`),
    };
    expect(withMatter(full, "matter_more")).toEqual(full);
    expect(withoutMatter(one, "matter_a")).toEqual(EVERYTHING);
  });

  it("counts the named date choices from the reader's today, and reads them back", () => {
    expect(daysOfChoice("any", TODAY)).toBeNull();
    expect(daysOfChoice("last-30-days", TODAY)).toEqual({ from: "2026-10-21", to: TODAY });
    expect(daysOfChoice("this-year", TODAY)).toEqual({ from: "2026-01-01" });
    expect(dateChoiceOf(null, TODAY)).toBe("any");
    expect(dateChoiceOf({ from: "2026-10-21", to: TODAY }, TODAY)).toBe("last-30-days");
    expect(dateChoiceOf({ from: "2026-01-01" }, TODAY)).toBe("this-year");
    expect(dateChoiceOf({ from: "2026-06-01", to: "2026-06-30" }, TODAY)).toBe("between");
  });

  it("counts the filters set, for the phone's Filters button", () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(
      filterCount({ places: ["notes"], reach: MY_MATTERS, days: { from: TODAY }, by: "user_a" }),
    ).toBe(4);
  });

  it("names the client an address carries, and fills the field even where it cannot", () => {
    expect(
      clientNamed(CLIENT, {
        kind: "ok",
        value: {
          data: [
            {
              entityId: CLIENT,
              displayName: "Ruth Hargrove",
              entityKind: "person",
              mergedIntoId: null,
            },
          ],
        },
      }),
    ).toEqual({ identifier: CLIENT, name: "Ruth Hargrove", kind: "person" });
    expect(clientNamed("directoryOrganization_x", { kind: "ok", value: { data: [] } })).toEqual({
      identifier: "directoryOrganization_x",
      name: UNNAMED_CLIENT,
      kind: "organization",
    });
  });
});

describe("the panel's Places list", () => {
  it("is empty before anything has answered", () => {
    expect(panelPlaces(null, NO_FILTERS)).toEqual([]);
  });

  it("lists each record place in the server's order, then matters and people by name", () => {
    const keys = panelPlaces(answerOf(REGISTRY_ANSWER), NO_FILTERS).map((place) => place.key);
    expect(keys).toEqual([
      ...REGISTRY_ANSWER.map((entry) => entry.source),
      MATTERS_PLACE,
      PEOPLE_PLACE,
    ]);
  });

  it("counts what answered and marks a place that holds more, never a total", () => {
    const notes = panelPlaces(answerOf(REGISTRY_ANSWER), NO_FILTERS).find(
      (place) => place.key === "notes",
    );
    expect(notes).toMatchObject({ shown: 2, more: true, mark: null });
  });

  it("marks a place the search did not reach, and writes out the reasons a reader can act on", () => {
    const places = panelPlaces(
      answerOf([
        group("calendar", { skipped: "one-matter-only" }),
        group("file-contents", { skipped: "too-many-matters" }),
        group("files", { skipped: "no-author" }),
        group("billing", { skipped: "permission" }),
      ]),
      NO_FILTERS,
    );
    const byKey = new Map(places.map((place) => [place.key, place]));
    expect(byKey.get("calendar")).toMatchObject({
      mark: "In A Matter",
      shown: null,
      writtenOut: false,
    });
    expect(byKey.get("file-contents")).toMatchObject({ mark: "Fewer Matters", writtenOut: true });
    expect(byKey.get("file-contents")?.reason).toContain("25 matters or fewer");
    expect(byKey.get("files")).toMatchObject({ mark: "No Author" });
    expect(byKey.get("billing")).toMatchObject({ mark: "No Access" });
  });

  it("says why matters and people are not found by name under a date, a person or some matters", () => {
    const dated = filtered({ places: [MATTERS_PLACE, PEOPLE_PLACE], days: { from: TODAY } });
    const named = panelPlaces(answerOf([]), dated);
    expect(named.map((place) => place.reason)).toEqual([
      NAMES_NOT_FILTERED_REASON,
      NAMES_NOT_FILTERED_REASON,
    ]);
    const mine = filtered({ places: [PEOPLE_PLACE], reach: MY_MATTERS });
    expect(panelPlaces(answerOf([]), mine).at(-1)?.reason).toBe(PEOPLE_NOT_SEARCHED_REASON);
  });
});

describe("the list of records", () => {
  it("is every ticked place's records as one list, newest first by the date each lists by", () => {
    const listed = listedHits(answerOf(REGISTRY_ANSWER), NO_FILTERS);
    expect(listed.map((entry) => entry.hit.id)).toEqual(["file_1", "note_1", "time_1", "note_2"]);
    expect(listed[0]?.place).toBe("files");
  });

  it("leaves out an unticked place, and says more is there only for a ticked one", () => {
    const onlyFiles = filtered({ places: ["files"] });
    expect(listedHits(answerOf(REGISTRY_ANSWER), onlyFiles).map((entry) => entry.hit.id)).toEqual([
      "file_1",
    ]);
    expect(tickedPlacesHoldMore(answerOf(REGISTRY_ANSWER), onlyFiles)).toBe(false);
    expect(tickedPlacesHoldMore(answerOf(REGISTRY_ANSWER), NO_FILTERS)).toBe(true);
  });
});

describe("one question, three reads", () => {
  const people: DirectorySearchHit[] = [];

  // Two of the three reads spell their path and one goes through the generated client, which
  // hands fetch a Request with a whole address. Both are read down to the path and its query.
  function addressOf(input: RequestInfo | URL): string {
    const url = new URL(input instanceof Request ? input.url : String(input), ORIGIN);
    return `${url.pathname}${url.search}`;
  }

  beforeEach(() => {
    client.setConfig({ baseUrl: ORIGIN });
  });

  afterEach(() => {
    client.setConfig({ baseUrl: "" });
  });

  const records: AcrossMattersAnswer = {
    query: "easement",
    broad: false,
    fewMattersLimit: 25,
    groups: REGISTRY_ANSWER,
  };

  function answering(calls: string[]): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const address = addressOf(input);
      calls.push(address);
      if (address.startsWith("/api/v1/matters?")) {
        return Response.json({ data: [matter("matter_a"), matter("matter_b")], nextCursor: null });
      }
      if (address.startsWith("/api/v1/directory/search?")) {
        return Response.json({ data: people, capped: false });
      }
      if (address.startsWith("/api/v1/search?")) return Response.json(records);
      return new Response(null, { status: 404 });
    }) as typeof fetch;
  }

  it("asks only the search across matters, every place at once, when names are not ticked", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    await search.run(answering(calls), "easement", NO_FILTERS);
    expect(calls).toEqual([`/api/v1/search?q=easement&limit=${PLACE_LIMIT}`]);
    expect(search.answer?.records?.groups).toHaveLength(REGISTRY_ANSWER.length);
    expect(search.answer?.matters.standing).toBe("not-searched");
    expect(search.busy).toBe(false);
  });

  it("asks for matters and people by name when ticked, and asks nothing for a tick it already has", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    const fetchImpl = answering(calls);
    await search.run(fetchImpl, "easement", NO_FILTERS);
    calls.length = 0;
    await search.run(fetchImpl, "easement", filtered({ places: ["notes", MATTERS_PLACE] }));
    expect(calls).toEqual(["/api/v1/matters?search=easement"]);
    expect(search.answer?.matters.rows).toHaveLength(2);
    calls.length = 0;
    await search.run(fetchImpl, "easement", filtered({ places: [MATTERS_PLACE] }));
    expect(calls).toEqual([]);
    await search.run(fetchImpl, "easement", filtered({ places: [PEOPLE_PLACE] }));
    expect(calls).toEqual(["/api/v1/directory/search?q=easement"]);
  });

  it("sends the chosen matters, days and person, and finds no names under a date or a person", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    await search.run(
      answering(calls),
      "easement",
      filtered({
        places: [MATTERS_PLACE, PEOPLE_PLACE, "notes"],
        reach: { kind: "matters", matterIds: ["matter_a", "matter_b"] },
        days: { from: "2026-06-01", to: "2026-06-30" },
        by: "user_a",
      }),
    );
    expect(calls).toEqual([
      `/api/v1/search?q=easement&limit=${PLACE_LIMIT}&matterId=matter_a&matterId=matter_b` +
        "&by=user_a&from=2026-06-01&to=2026-06-30",
    ]);
  });

  it("keeps only the chosen matters among the matters found by name", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    await search.run(
      answering(calls),
      "easement",
      filtered({ places: [MATTERS_PLACE], reach: { kind: "matters", matterIds: ["matter_b"] } }),
    );
    expect(search.answer?.matters.rows.map((row) => row.id)).toEqual(["matter_b"]);
  });

  it("asks the reader's own matters of both reads, and no people", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    await search.run(
      answering(calls),
      "easement",
      filtered({ places: [MATTERS_PLACE, PEOPLE_PLACE], reach: MY_MATTERS }),
    );
    expect(calls.toSorted()).toEqual([
      "/api/v1/matters?search=easement&mine=true",
      `/api/v1/search?q=easement&limit=${PLACE_LIMIT}&mine=true`,
    ]);
    expect(search.answer?.people.standing).toBe("not-searched");
  });

  it("asks again when the matters, days or person change, and starts over for a new question", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    const fetchImpl = answering(calls);
    await search.run(fetchImpl, "easement", NO_FILTERS);
    await search.run(fetchImpl, "easement", filtered({ days: { from: "2026-06-01" } }));
    await search.run(fetchImpl, "easement", filtered({ days: { from: "2026-06-01" } }));
    await search.run(fetchImpl, "boundary", filtered({ days: { from: "2026-06-01" } }));
    expect(calls).toHaveLength(3);
  });

  it("clears everything when the field is emptied", async () => {
    const search = new SearchAcrossMatters();
    await search.run(answering([]), "easement", NO_FILTERS);
    await search.run(answering([]), "  ", NO_FILTERS);
    expect(search.answer).toBeNull();
    expect(search.failure).toBeNull();
  });

  it("keeps matters on screen when the search across matters is refused", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const address = addressOf(input);
      if (address.startsWith("/api/v1/matters?")) {
        return Response.json({ data: [matter("matter_a")], nextCursor: null });
      }
      return new Response(JSON.stringify({ status: 500, title: "Fault" }), {
        status: 500,
        headers: { "content-type": "application/problem+json" },
      });
    }) as typeof fetch;
    const search = new SearchAcrossMatters();
    await search.run(fetchImpl, "easement", filtered({ places: [MATTERS_PLACE] }));
    expect(search.failure).not.toBeNull();
    expect(search.answer?.records).toBeNull();
    expect(search.answer?.matters.rows).toHaveLength(1);
  });
});
