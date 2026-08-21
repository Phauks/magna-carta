import { describe, expect, it } from "vitest";
import {
  mergeFieldCatalogFromResponse,
  type MergeFieldsResponse,
  type MergeFieldsResponseEntry,
} from "../src/lib/document-assembly/merge-field-catalog-source.ts";

// The projection from what the merge-fields endpoint returns to what the field-input surfaces consume.
//
// The rule it exists to hold: A FIELD NOBODY CAN READ IS WORSE THAN A FIELD READ CONSERVATIVELY. A
// server that has gained a value type or an availability this build was not compiled against must not
// make the whole catalog unreadable, and must not silently drop the field either — the alternative to
// seeing it is a person retyping the value by hand into a filed document.

function responseEntry(
  overrides: Partial<MergeFieldsResponseEntry> = {},
): MergeFieldsResponseEntry {
  return {
    key: "client.displayName",
    label: "Client's name",
    group: "client",
    subject: "client",
    subjectLabel: "Client",
    prominence: "primary",
    valueType: "name",
    defaultFormat: "full",
    formats: ["full", "lastFirst", "upper"],
    description: "The client's name as it should appear in a document.",
    synonyms: ["customer"],
    exampleRenderings: {
      full: "Rowan Ashcroft",
      lastFirst: "Ashcroft, Rowan",
      upper: "ROWAN ASHCROFT",
    },
    availability: "automatic",
    availabilityNote: "Filled from the parties linked to the matter.",
    sensitivity: "ordinary",
    absence: "fail",
    status: "current",
    supersededBy: null,
    ...overrides,
  };
}

function responseOf(entries: readonly MergeFieldsResponseEntry[]): MergeFieldsResponse {
  return { revision: "2-1a2b3c4d", fields: entries };
}

describe("the merge-field catalog from the endpoint's payload", () => {
  it("carries the revision through, so a cached catalog can revalidate rather than refetch", () => {
    expect(mergeFieldCatalogFromResponse(responseOf([responseEntry()])).revision).toBe(
      "2-1a2b3c4d",
    );
  });

  it("shows the sample for the field's DEFAULT rendering, not the first one listed", () => {
    const entry = mergeFieldCatalogFromResponse(
      responseOf([responseEntry({ defaultFormat: "lastFirst" })]),
    ).entries[0];
    expect(entry?.exampleRendering).toBe("Ashcroft, Rowan");
    // And every rendering is still carried, so a format chooser can show what each one does.
    expect(entry?.exampleRenderings.upper).toBe("ROWAN ASHCROFT");
  });

  it("keeps a field whose value type this build does not know, reading it as text", () => {
    const entry = mergeFieldCatalogFromResponse(
      responseOf([responseEntry({ valueType: "somethingNewer" })]),
    ).entries[0];
    expect(entry?.key).toBe("client.displayName");
    expect(entry?.valueType).toBe("text");
  });

  it("asks a person to fill in a field whose availability this build does not know", () => {
    // The conservative direction: an unknown availability gets an input control rather than being shown
    // as something that fills itself and then silently does not.
    const entry = mergeFieldCatalogFromResponse(
      responseOf([responseEntry({ availability: "somethingNewer" })]),
    ).entries[0];
    expect(entry?.availability).toBe("manual");
  });

  it("narrows prominence, sensitivity, and status without dropping the field", () => {
    const entry = mergeFieldCatalogFromResponse(
      responseOf([
        responseEntry({
          prominence: "somethingNewer",
          sensitivity: "somethingNewer",
          status: "somethingNewer",
        }),
      ]),
    ).entries[0];
    expect(entry?.prominence).toBe("primary");
    // Never `protected` by guess: claiming a field is sealed when the server did not say so would warn
    // about an audited decrypt that is not going to happen.
    expect(entry?.sensitivity).toBe("ordinary");
    expect(entry?.status).toBe("current");
  });

  it("reads a protected, deprecated, secondary field exactly as the server described it", () => {
    const entry = mergeFieldCatalogFromResponse(
      responseOf([
        responseEntry({
          prominence: "secondary",
          sensitivity: "protected",
          status: "deprecated",
          supersededBy: "client.socialSecurityNumberLastFour",
        }),
      ]),
    ).entries[0];
    expect(entry?.prominence).toBe("secondary");
    expect(entry?.sensitivity).toBe("protected");
    expect(entry?.status).toBe("deprecated");
    expect(entry?.supersededBy).toBe("client.socialSecurityNumberLastFour");
  });
});
