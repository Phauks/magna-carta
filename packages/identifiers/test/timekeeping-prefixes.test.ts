import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";
import type {
  NarrativeTemplateId,
  NonBillableCategoryId,
  RateCardId,
  RateId,
  TimeEntryId,
  UtbmsCodeId,
} from "../src/types.ts";

describe("timekeeping identifier prefixes", () => {
  it("mints handles with the full-name prefixes and the branded aliases compile", () => {
    const timeEntryId: TimeEntryId = newIdentifier("timeEntry");
    const rateCardId: RateCardId = newIdentifier("rateCard");
    const rateId: RateId = newIdentifier("rate");
    const utbmsCodeId: UtbmsCodeId = newIdentifier("utbmsCode");
    const nonBillableCategoryId: NonBillableCategoryId = newIdentifier("nonBillableCategory");
    const narrativeTemplateId: NarrativeTemplateId = newIdentifier("narrativeTemplate");

    expect(timeEntryId).toMatch(/^timeEntry_[A-Za-z0-9_-]{21}$/);
    expect(rateCardId).toMatch(/^rateCard_[A-Za-z0-9_-]{21}$/);
    expect(rateId).toMatch(/^rate_[A-Za-z0-9_-]{21}$/);
    expect(utbmsCodeId).toMatch(/^utbmsCode_[A-Za-z0-9_-]{21}$/);
    expect(nonBillableCategoryId).toMatch(/^nonBillableCategory_[A-Za-z0-9_-]{21}$/);
    expect(narrativeTemplateId).toMatch(/^narrativeTemplate_[A-Za-z0-9_-]{21}$/);
  });

  it("registers each timekeeping prefix spelled out in full (prefix === key)", () => {
    expect(ENTITY_PREFIXES.timeEntry).toBe("timeEntry");
    expect(ENTITY_PREFIXES.rateCard).toBe("rateCard");
    expect(ENTITY_PREFIXES.rate).toBe("rate");
    expect(ENTITY_PREFIXES.utbmsCode).toBe("utbmsCode");
    expect(ENTITY_PREFIXES.nonBillableCategory).toBe("nonBillableCategory");
    expect(ENTITY_PREFIXES.narrativeTemplate).toBe("narrativeTemplate");
    expect(prefixFor("rateCard")).toBe("rateCard");
  });
});
