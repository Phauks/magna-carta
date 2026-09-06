/*
 * The pure half of LoadingRegion, pinned: the sentences a region derives from a caller's label, and
 * the constants the app shell and the stories depend on by name.
 */
import { describe, expect, it } from "vitest";
import {
  SETTLED_EVENT,
  STALLED_AFTER_MILLISECONDS,
  finishedSentence,
  stalledSentence,
} from "../src/lib/components/loading-region/loading-region.ts";
import {
  SAMPLE_PEOPLE,
  sampleCivilDate,
  sampleDate,
  sampleIndices,
  sampleInstant,
  sampleMatter,
  samplePerson,
} from "../src/lib/loading-fixtures/index.ts";

describe("the sentences a region derives from its label", () => {
  it("says the read finished, in the label's own words", () => {
    expect(finishedSentence("Reading the names on this record")).toBe(
      "Finished reading the names on this record.",
    );
    expect(finishedSentence("Looking for near matches")).toBe("Finished looking for near matches.");
  });

  it("says a stalled read is still going, and that it is late", () => {
    expect(stalledSentence("Reading the matters this record is on")).toBe(
      "Still reading the matters this record is on. This is taking longer than it should.",
    );
  });

  it("keeps the threshold past any read the product makes on purpose", () => {
    expect(STALLED_AFTER_MILLISECONDS).toBeGreaterThanOrEqual(10_000);
    expect(SETTLED_EVENT).toBe("mc-loading-settled");
  });
});

describe("the sample vocabulary", () => {
  it("is stable by index and wraps rather than running out", () => {
    expect(samplePerson(0)).toBe(samplePerson(0));
    expect(samplePerson(SAMPLE_PEOPLE.length)).toBe(samplePerson(0));
    expect(sampleIndices(3)).toEqual([0, 1, 2]);
  });

  it("carries each date in the three shapes a fixture needs, on the same day", () => {
    expect(sampleDate(0)).toBe("Mar 4, 2026");
    expect(sampleCivilDate(0)).toBe("2026-03-04");
    expect(sampleInstant(0).startsWith("2026-03-04T")).toBe(true);
  });

  it("is plainly invented: every address is on example.com", () => {
    for (const person of SAMPLE_PEOPLE) expect(person.email.endsWith("@example.com")).toBe(true);
    expect(sampleMatter(0).client).toBe(samplePerson(0).name);
  });
});
