import { client } from "@magna-carta/api-client/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DirectorySearchHit } from "$lib/directory/directory-api.ts";
import type { MatterSummary } from "$lib/matters/matters-api.ts";
import type {
  AcrossMattersAnswer,
  AcrossMattersGroup,
} from "$lib/search/search-across-matters-api.ts";
import {
  OVERVIEW_LIMIT,
  SearchAcrossMatters,
  railPlaces,
  unsearchedPlaces,
  type SearchOverview,
} from "$lib/search/search-across-matters.svelte.ts";
import {
  ALL_PLACES,
  MATTERS_PLACE,
  PEOPLE_PLACE,
  isRecordPlace,
  placeFromAddress,
  searchAddress,
} from "$lib/search/search-address.ts";

const ORIGIN = "https://app.example";

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

function hit(id: string, matterId = "matter_a") {
  return {
    id,
    title: "2026-06-04T15:00:00.000Z",
    titleMarks: [],
    snippet: "The easement runs along the eastern boundary.",
    snippetMarks: [{ start: 4, end: 12 }],
    secondary: null,
    actorUserId: null,
    sortKey: "2026-06-04T15:00:00.000Z",
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

function overviewOf(
  groups: AcrossMattersGroup[],
  overrides: Partial<SearchOverview> = {},
): SearchOverview {
  return {
    query: "easement",
    matters: { rows: [matter("matter_a")], more: false, standing: "answered" },
    people: { rows: [], more: false, standing: "answered" },
    records: { query: "easement", broad: false, groups },
    ...overrides,
  };
}

const REGISTRY_ANSWER: AcrossMattersGroup[] = [
  group("files"),
  group("file-contents", { skipped: "one-matter-only" }),
  group("time"),
  group("costs"),
  group("billing", { skipped: "one-matter-only" }),
  group("parties", { skipped: "one-matter-only" }),
  group("calendar", { skipped: "one-matter-only" }),
  group("notes", { hits: [hit("note_1"), hit("note_2")], hasMore: true }),
  group("custody", { skipped: "one-matter-only" }),
  group("communications"),
];

describe("the address is the page's state", () => {
  it("carries the question and leaves every place unnamed", () => {
    expect(searchAddress("  Hargrove easement ")).toBe("/search?q=Hargrove+easement");
    expect(searchAddress("easement", ALL_PLACES)).toBe("/search?q=easement");
    expect(searchAddress("")).toBe("/search");
  });

  it("names a chosen place", () => {
    expect(searchAddress("easement", "notes")).toBe("/search?q=easement&in=notes");
    expect(searchAddress("easement", MATTERS_PLACE)).toBe("/search?q=easement&in=matters");
  });

  it("reads an absent or empty place as every place", () => {
    expect(placeFromAddress(null)).toBe(ALL_PLACES);
    expect(placeFromAddress("  ")).toBe(ALL_PLACES);
    expect(placeFromAddress("notes")).toBe("notes");
  });

  it("knows which places the search across matters answers", () => {
    expect(isRecordPlace("notes")).toBe(true);
    expect(isRecordPlace(ALL_PLACES)).toBe(false);
    expect(isRecordPlace(MATTERS_PLACE)).toBe(false);
    expect(isRecordPlace(PEOPLE_PLACE)).toBe(false);
  });
});

describe("the places beside the results", () => {
  it("is empty before anything has answered", () => {
    expect(railPlaces(null)).toEqual([]);
  });

  it("lists everything, then matters and people, then each place that answers across matters", () => {
    const places = railPlaces(overviewOf(REGISTRY_ANSWER));
    expect(places.map((place) => place.key)).toEqual([
      ALL_PLACES,
      MATTERS_PLACE,
      PEOPLE_PLACE,
      "files",
      "time",
      "costs",
      "notes",
      "communications",
    ]);
    expect(places.map((place) => place.label)).toEqual([
      "All Places",
      "Matters",
      "People",
      "Files",
      "Time",
      "Costs",
      "Notes",
      "Messaging",
    ]);
  });

  it("counts what is on screen and marks a place that holds more, never a total", () => {
    const places = railPlaces(overviewOf(REGISTRY_ANSWER));
    const notes = places.find((place) => place.key === "notes");
    expect(notes).toEqual({ key: "notes", label: "Notes", shown: 2, more: true });
    const all = places.find((place) => place.key === ALL_PLACES);
    // One matter and two notes are on screen; the mark says a place holds more.
    expect(all?.shown).toBe(3);
    expect(all?.more).toBe(true);
  });

  it("leaves out a place the reader may not read", () => {
    const places = railPlaces(
      overviewOf([group("notes", { skipped: "permission" }), group("files")]),
    );
    expect(places.map((place) => place.key)).not.toContain("notes");
  });

  it("shows no count for a read by name that was refused", () => {
    const places = railPlaces(
      overviewOf(REGISTRY_ANSWER, {
        people: { rows: [], more: false, standing: "no-access" },
      }),
    );
    expect(places.find((place) => place.key === PEOPLE_PLACE)?.shown).toBeNull();
  });

  it("still lists matters and people when the search across matters failed", () => {
    const places = railPlaces(overviewOf([], { records: null }));
    expect(places.map((place) => place.key)).toEqual([ALL_PLACES, MATTERS_PLACE, PEOPLE_PLACE]);
  });
});

describe("what the search did not look at", () => {
  it("names the places searched only inside a matter, from the server's own answer", () => {
    const unsearched = unsearchedPlaces(overviewOf(REGISTRY_ANSWER));
    expect(unsearched.map((place) => [place.label, place.mark])).toEqual([
      ["Inside Files", "In A Matter"],
      ["Billing", "In A Matter"],
      ["Parties", "In A Matter"],
      ["Calendar", "In A Matter"],
      ["Custodian", "In A Matter"],
      ["Discovery Sets", "Never"],
    ]);
  });

  it("names a place the reader's role does not reach, and says so instead of an empty result", () => {
    const unsearched = unsearchedPlaces(overviewOf([group("notes", { skipped: "permission" })]));
    expect(unsearched[0]).toMatchObject({ label: "Notes", mark: "No Access" });
    expect(unsearched[0]?.reason).toContain("Notes");
  });

  it("always names discovery review sets, which no search outside a set reaches", () => {
    expect(unsearchedPlaces(null).map((place) => place.key)).toEqual(["discovery-sets"]);
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

  function answering(calls: string[], records: AcrossMattersAnswer): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const address = addressOf(input);
      calls.push(address);
      if (address.startsWith("/api/v1/matters?")) {
        return Response.json({ data: [matter("matter_a")], nextCursor: null });
      }
      if (address.startsWith("/api/v1/directory/search?")) {
        return Response.json({ data: people, capped: false });
      }
      if (address.startsWith("/api/v1/search?")) {
        const parameters = new URL(address, "https://example.com").searchParams;
        const named = parameters.getAll("in");
        return Response.json({
          ...records,
          groups:
            named.length === 0
              ? records.groups
              : records.groups.filter((entry) => named.includes(entry.source)),
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
  }

  const records: AcrossMattersAnswer = {
    query: "easement",
    broad: false,
    groups: REGISTRY_ANSWER,
  };

  it("asks the matters listing, the directory and the search across matters once each", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    await search.run(answering(calls, records), "easement", ALL_PLACES);
    expect(calls.toSorted()).toEqual([
      "/api/v1/directory/search?q=easement",
      "/api/v1/matters?search=easement",
      `/api/v1/search?q=easement&limit=${OVERVIEW_LIMIT}`,
    ]);
    expect(search.overview?.matters.rows).toHaveLength(1);
    expect(search.overview?.records?.groups).toHaveLength(REGISTRY_ANSWER.length);
    expect(search.place).toBeNull();
    expect(search.busy).toBe(false);
  });

  it("asks only the chosen place again, and keeps the overview it already has", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    const fetchImpl = answering(calls, records);
    await search.run(fetchImpl, "easement", ALL_PLACES);
    calls.length = 0;
    await search.run(fetchImpl, "easement", "notes");
    expect(calls).toEqual(["/api/v1/search?q=easement&in=notes&limit=50"]);
    expect(search.place?.source).toBe("notes");
    expect(search.overview?.matters.rows).toHaveLength(1);
  });

  it("asks nothing more for matters or people, which the overview already read", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    const fetchImpl = answering(calls, records);
    await search.run(fetchImpl, "easement", ALL_PLACES);
    calls.length = 0;
    await search.run(fetchImpl, "easement", MATTERS_PLACE);
    expect(calls).toEqual([]);
    expect(search.place).toBeNull();
  });

  it("starts over for a new question", async () => {
    const calls: string[] = [];
    const search = new SearchAcrossMatters();
    const fetchImpl = answering(calls, records);
    await search.run(fetchImpl, "easement", ALL_PLACES);
    calls.length = 0;
    await search.run(fetchImpl, "drainage", ALL_PLACES);
    expect(calls).toHaveLength(3);
    expect(search.overview?.query).toBe("drainage");
  });

  it("clears everything when the field is emptied", async () => {
    const search = new SearchAcrossMatters();
    await search.run(answering([], records), "easement", ALL_PLACES);
    await search.run(answering([], records), "   ", ALL_PLACES);
    expect(search.overview).toBeNull();
    expect(search.failure).toBeNull();
  });

  it("keeps matters and people on screen when the search across matters is refused", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const address = addressOf(input);
      if (address.startsWith("/api/v1/matters?")) {
        return Response.json({ data: [matter("matter_a")], nextCursor: null });
      }
      if (address.startsWith("/api/v1/directory/search?")) {
        return new Response(JSON.stringify({ status: 403, title: "Forbidden" }), {
          status: 403,
          headers: { "content-type": "application/problem+json" },
        });
      }
      return new Response(JSON.stringify({ status: 500, title: "Fault" }), {
        status: 500,
        headers: { "content-type": "application/problem+json" },
      });
    }) as typeof fetch;
    const search = new SearchAcrossMatters();
    await search.run(fetchImpl, "easement", ALL_PLACES);
    expect(search.failure).not.toBeNull();
    expect(search.overview?.records).toBeNull();
    expect(search.overview?.matters.rows).toHaveLength(1);
    expect(search.overview?.people.standing).toBe("no-access");
  });
});
