import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMUM_QUERY_LENGTH,
  addRowKind,
  addRowSentence,
  addRowValue,
  newControlName,
  offerableEntities,
  runEntitySearch,
  searchRequestFor,
  tooShortSentence,
} from "../src/lib/components/entity-picker/picker-search.ts";
import type {
  EntityPickerAnswer,
  PickableEntity,
} from "../src/lib/components/entity-picker/types.ts";

/*
 * EntityPicker's package-local contract.
 *
 * What is rendered belongs to the stories, which run in a real browser with axe. What is asserted
 * here is the part a rendered field cannot show: the rules that decide whether a query is asked at
 * all, what a failed search becomes, and what may be offered — all of which are settled behaviour
 * rather than presentation, and all of which every earlier hand-rolled picker carried a private copy
 * of.
 */

const entity = (identifier: string, name: string): PickableEntity => ({
  identifier,
  name,
  kind: "person",
});

const HITS: readonly PickableEntity[] = [
  entity("directoryPerson_1", "Pemberton, Ada"),
  entity("directoryPerson_2", "Pemberton, Bartholomew"),
  entity("directoryOrganization_3", "Pemberton Holdings"),
];

describe("whether typed text is a question the directory can be asked", () => {
  it("is nothing when nothing, or only whitespace, was typed", () => {
    expect(searchRequestFor("", DEFAULT_MINIMUM_QUERY_LENGTH)).toEqual({ kind: "nothing" });
    expect(searchRequestFor("   ", DEFAULT_MINIMUM_QUERY_LENGTH)).toEqual({ kind: "nothing" });
  });

  it("is too short below the floor, and says how much is missing", () => {
    expect(searchRequestFor("Pe", DEFAULT_MINIMUM_QUERY_LENGTH)).toEqual({
      kind: "too-short",
      missing: 1,
    });
    expect(searchRequestFor("P", DEFAULT_MINIMUM_QUERY_LENGTH)).toEqual({
      kind: "too-short",
      missing: 2,
    });
  });

  it("asks the trimmed query once it clears the floor", () => {
    expect(searchRequestFor("  Pem ", DEFAULT_MINIMUM_QUERY_LENGTH)).toEqual({
      kind: "ask",
      query: "Pem",
    });
  });

  it("does not count surrounding whitespace toward the floor", () => {
    expect(searchRequestFor(" Pe ", DEFAULT_MINIMUM_QUERY_LENGTH).kind).toBe("too-short");
  });

  it("words the shortfall once, for one character and for more", () => {
    expect(tooShortSentence(1)).toBe("Type one more character to search the directory.");
    expect(tooShortSentence(2)).toBe("Type 2 more characters to search the directory.");
  });
});

describe("what one search becomes", () => {
  const answer: EntityPickerAnswer = { hits: HITS, capped: false };

  it("is the answer when the search answered", async () => {
    const outcome = await runEntitySearch(async () => answer, "Pem", new AbortController().signal);
    expect(outcome).toEqual({ kind: "answered", answer });
  });

  it("is failed when the search rejected, never an empty answer", async () => {
    const outcome = await runEntitySearch(
      async () => {
        throw new Error("Couldn't search the directory.");
      },
      "Pem",
      new AbortController().signal,
    );
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("is failed when the search threw before it was even asynchronous", async () => {
    const outcome = await runEntitySearch(
      () => {
        throw new Error("no fetch");
      },
      "Pem",
      new AbortController().signal,
    );
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("is superseded when a newer question aborted it before it answered", async () => {
    const controller = new AbortController();
    const outcome = await runEntitySearch(
      async () => {
        controller.abort();
        return answer;
      },
      "Pem",
      controller.signal,
    );
    expect(outcome).toEqual({ kind: "superseded" });
  });

  it("is superseded, not failed, when an aborted search rejected", async () => {
    const controller = new AbortController();
    const outcome = await runEntitySearch(
      async () => {
        controller.abort();
        throw new Error("aborted");
      },
      "Pem",
      controller.signal,
    );
    expect(outcome).toEqual({ kind: "superseded" });
  });
});

describe("what the picker may offer", () => {
  it("offers every hit, in the order given, when nothing is excluded", () => {
    expect(offerableEntities(HITS, [])).toEqual(HITS);
  });

  it("leaves out an excluded handle and keeps the rest in order", () => {
    expect(offerableEntities(HITS, ["directoryPerson_2"]).map((hit) => hit.identifier)).toEqual([
      "directoryPerson_1",
      "directoryOrganization_3",
    ]);
  });

  it("excludes by handle and never by name", () => {
    const twin = entity("directoryPerson_9", "Pemberton, Ada");
    expect(offerableEntities([...HITS, twin], ["directoryPerson_1"])).toContainEqual(twin);
  });

  it("does not mutate the hits it was handed", () => {
    const before = structuredClone(HITS);
    offerableEntities(HITS, ["directoryPerson_1"]);
    expect(HITS).toEqual(before);
  });
});

describe("making what the field cannot find", () => {
  it("carries the kind wanted in a reserved value no handle produces, and reads it back", () => {
    expect(addRowKind(addRowValue("person"))).toBe("person");
    expect(addRowKind(addRowValue("organization"))).toBe("organization");
    expect(addRowKind("directoryPerson_1")).toBeNull();
    expect(addRowKind("mc-entity-picker:add:court")).toBeNull();
    expect(addRowValue("person")).toContain(":");
  });

  it("says which record the row will make, naming the typed value when there is one", () => {
    expect(addRowSentence("organization", " Northwind Couriers ")).toBe(
      'Add "Northwind Couriers" as an organization',
    );
    expect(addRowSentence("person", "Ada Pemberton")).toBe('Add "Ada Pemberton" as a person');
    expect(addRowSentence("person", "")).toBe("Add a person");
  });

  it("names the New control by what it makes", () => {
    expect(newControlName(["person"])).toBe("New person");
    expect(newControlName(["organization"])).toBe("New organization");
    expect(newControlName(["person", "organization"])).toBe("New person or organization");
  });
});
