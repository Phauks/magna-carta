/*
 * The notification vocabulary this surface mirrors.
 *
 * It is written out in apps/web rather than imported from the notifications package — the
 * convention every web api module follows — so the thing worth pinning is that it says the same
 * words the server does. The categories are checked against the emitted OpenAPI contract, which is
 * the one place the two sides meet: a category added to the platform fails here rather than
 * reaching a member as a raw key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMAIL_CADENCE_OPTIONS,
  NOTIFICATION_CATEGORIES,
  notificationCategoryDescription,
  notificationCategoryLabel,
} from "$lib/notifications/category-vocabulary.ts";

interface ContractDocument {
  components: {
    schemas: {
      NotificationResolvedCategoryPreference: {
        properties: Record<string, { enum?: string[] }>;
      };
    };
  };
}

// The enums are inlined on the resolved-category schema rather than named components of their own,
// which is where the two sides actually meet: this is the shape the page reads.
const contract = JSON.parse(
  readFileSync(new URL("../../api-worker/openapi/openapi.json", import.meta.url), "utf8"),
) as ContractDocument;
const resolvedCategory =
  contract.components.schemas.NotificationResolvedCategoryPreference.properties;

describe("the notification vocabulary", () => {
  it("carries exactly the categories the contract does", () => {
    const declared = resolvedCategory.category?.enum;
    expect(declared, "the contract declares the category vocabulary").toBeDefined();
    expect([...NOTIFICATION_CATEGORIES]).toEqual(declared);
  });

  it("names and describes every one of them", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      // A label that fell back to the raw key is the failure this is here to catch.
      expect(notificationCategoryLabel(category)).not.toBe(category);
      expect(notificationCategoryDescription(category).length).toBeGreaterThan(0);
    }
  });

  it("offers exactly the cadences the contract does, off included", () => {
    // `off` is a choice a member makes, not the absence of one, so it is an option rather than an
    // empty select.
    const declared = resolvedCategory.email?.enum;
    expect(declared, "the contract declares the cadence vocabulary").toBeDefined();
    expect(EMAIL_CADENCE_OPTIONS.map((option) => option.value)).toEqual(declared);
  });

  it("falls back to the raw key rather than to nothing", () => {
    // A build behind the server meets a category it does not carry; a blank cell would read as a
    // category with no name rather than as one this page has not learned yet.
    expect(notificationCategoryLabel("something-new")).toBe("something-new");
    expect(notificationCategoryDescription("something-new")).toBe("");
  });
});
