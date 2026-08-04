import { describe, expect, it } from "vitest";
import {
  createMockMergeFieldCatalogProvider,
  UnknownTemplateVersionError,
} from "../src/mock-catalog-provider.ts";
import {
  FIXTURE_MERGE_FIELD_CATALOG,
  FIXTURE_TEMPLATE_FIELD_MANIFESTS,
} from "../src/fixture-catalog.ts";
import { findCatalogEntry } from "../src/catalog-grouping.ts";

describe("the mock catalog provider", () => {
  it("answers the catalog", async () => {
    const provider = createMockMergeFieldCatalogProvider();
    const catalog = await provider.listMergeFields();
    expect(catalog.revision).toBe(FIXTURE_MERGE_FIELD_CATALOG.revision);
    expect(catalog.entries.length).toBeGreaterThan(0);
  });

  it("answers a template version's manifest", async () => {
    const provider = createMockMergeFieldCatalogProvider();
    const manifest = await provider.getTemplateFieldManifest("engagement-letter-v3");
    expect(manifest.templateName).toBe("Engagement letter");
    expect(manifest.placeholders.length).toBeGreaterThan(0);
  });

  it("refuses a template version it does not hold, rather than answering an empty manifest", async () => {
    const provider = createMockMergeFieldCatalogProvider();
    await expect(provider.getTemplateFieldManifest("no-such-template")).rejects.toBeInstanceOf(
      UnknownTemplateVersionError,
    );
  });

  it("lists every template version it can answer for", async () => {
    const provider = createMockMergeFieldCatalogProvider();
    const versions = await provider.listTemplateVersions();
    for (const version of versions) {
      await expect(provider.getTemplateFieldManifest(version.templateVersionId)).resolves.toEqual(
        expect.objectContaining({ templateVersionId: version.templateVersionId }),
      );
    }
  });

  it("takes an overridden catalog, so a story can show a firm with no custom fields", async () => {
    const provider = createMockMergeFieldCatalogProvider({
      catalog: {
        revision: "narrow",
        entries: FIXTURE_MERGE_FIELD_CATALOG.entries.filter((entry) => entry.group !== "custom"),
      },
    });
    const catalog = await provider.listMergeFields();
    expect(catalog.entries.some((entry) => entry.group === "custom")).toBe(false);
  });

  it("stays asynchronous under latency, so loading paths are exercised", async () => {
    const provider = createMockMergeFieldCatalogProvider({ latencyMilliseconds: 5 });
    let settled = false;
    const pending = provider.listMergeFields().then((catalog) => {
      settled = true;
      return catalog;
    });
    expect(settled).toBe(false);
    await pending;
    expect(settled).toBe(true);
  });
});

describe("the fixture manifests against the fixture catalog", () => {
  it("declares every unrecognized key it claims, and nothing it does not", () => {
    for (const manifest of FIXTURE_TEMPLATE_FIELD_MANIFESTS) {
      const actuallyUnrecognized = manifest.placeholders
        .map((placeholder) => placeholder.key)
        .filter((key) => findCatalogEntry(FIXTURE_MERGE_FIELD_CATALOG, key) === null);
      expect([...actuallyUnrecognized].toSorted()).toEqual(
        [...manifest.unrecognizedKeys].toSorted(),
      );
    }
  });

  it("proposes only keys the catalog carries — a proposal must be selectable", () => {
    for (const manifest of FIXTURE_TEMPLATE_FIELD_MANIFESTS) {
      for (const conversion of manifest.detectedConversions) {
        if (conversion.proposedKey === null) continue;
        expect(
          findCatalogEntry(FIXTURE_MERGE_FIELD_CATALOG, conversion.proposedKey),
        ).not.toBeNull();
      }
    }
  });

  it("carries a manifest with an unrecognized key and one with a proposal, so both paths render", () => {
    expect(
      FIXTURE_TEMPLATE_FIELD_MANIFESTS.some((manifest) => manifest.unrecognizedKeys.length > 0),
    ).toBe(true);
    expect(
      FIXTURE_TEMPLATE_FIELD_MANIFESTS.some((manifest) => manifest.detectedConversions.length > 0),
    ).toBe(true);
  });
});
