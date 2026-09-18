/*
 * The template library's column model, pinned.
 *
 * Each case is a place where a quiet mistake would look right on screen and be wrong in a way a
 * person would act on: a template offered to every matter rendering as a gap, a template whose
 * bytes never cleared the scan reading as ready to build from, or a filter that hides "Archived"
 * because nothing archived happens to be loaded.
 */
import { describe, expect, it } from "vitest";
import type { TemplateSummary } from "@magna-carta/api-client";
import {
  ANY_MATTER_TYPE,
  EMPTY_TEMPLATE_VOCABULARY,
  EVERY_OFFICE,
  templateColumns,
  templateStanding,
  templateVocabulary,
  TEMPLATE_STANDING_VALUES,
} from "../src/lib/templates/template-columns.ts";

const template = (overrides: Partial<TemplateSummary> = {}): TemplateSummary => ({
  templateId: "documentTemplate_1",
  name: "Engagement letter",
  description: null,
  matterTypeId: null,
  locationId: null,
  status: "active",
  currentVersionId: "documentTemplateVersion_1",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
  ...overrides,
});

const column = (id: string, vocabulary = EMPTY_TEMPLATE_VOCABULARY) => {
  const found = templateColumns(vocabulary).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no column ${id}`);
  return found;
};

describe("template standing", () => {
  it("is ready only when the template is active and has a clean current version", () => {
    expect(templateStanding(template())).toBe("ready");
    expect(templateStanding(template({ currentVersionId: null }))).toBe("checking");
    expect(templateStanding(template({ status: "archived" }))).toBe("archived");
    // An archived template with a version is still archived — withdrawn wins over ready.
    expect(
      templateStanding(
        template({ status: "archived", currentVersionId: "documentTemplateVersion_9" }),
      ),
    ).toBe("archived");
  });

  it("offers every standing in the filter whether or not a row carries it", () => {
    expect(column("standing").filterValues).toEqual(TEMPLATE_STANDING_VALUES);
    expect(TEMPLATE_STANDING_VALUES).toContain("Archived");
  });
});

describe("practice area and office", () => {
  const vocabulary = templateVocabulary(
    [{ id: "matterType_estate", name: "Estate planning" }],
    [{ id: "location_reno", name: "Reno" }],
  );

  it("names a bound handle from the firm's own lists", () => {
    const bound = template({ matterTypeId: "matterType_estate", locationId: "location_reno" });
    expect(column("matterType", vocabulary).value(bound)).toBe("Estate planning");
    expect(column("location", vocabulary).value(bound)).toBe("Reno");
  });

  it("says a template bound to nothing is offered everywhere, rather than leaving a gap", () => {
    expect(column("matterType", vocabulary).value(template())).toBe(ANY_MATTER_TYPE);
    expect(column("location", vocabulary).value(template())).toBe(EVERY_OFFICE);
  });

  it("renders a handle the firm's list no longer names as empty, never as the handle", () => {
    const orphan = template({ matterTypeId: "matterType_gone", locationId: "location_gone" });
    expect(column("matterType", vocabulary).value(orphan)).toBe("");
    expect(column("location", vocabulary).value(orphan)).toBe("");
  });

  it("declares the whole vocabulary to the set filter, the any/every value leading", () => {
    expect(column("matterType", vocabulary).filterValues).toEqual([
      ANY_MATTER_TYPE,
      "Estate planning",
    ]);
    expect(column("location", vocabulary).filterValues).toEqual([EVERY_OFFICE, "Reno"]);
  });
});

describe("the table's shape", () => {
  it("anchors the name and dates the two instants", () => {
    expect(column("name").anchored).toBe(true);
    // Prose is the row's second line, never a column that would truncate it.
    expect(templateColumns(EMPTY_TEMPLATE_VOCABULARY).some((c) => c.id === "description")).toBe(
      false,
    );
    expect(column("updatedAt").type).toBe("date");
    expect(column("createdAt").type).toBe("date");
    expect(column("createdAt").hidden).toBe(true);
  });
});
