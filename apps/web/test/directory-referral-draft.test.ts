import { describe, expect, it } from "vitest";
import type { EntityReferral, ReferralSource } from "../src/lib/directory/referral-api.ts";
import {
  emptyReferralDraft,
  NO_SOURCE_VALUE,
  referralDraftChanged,
  referralDraftFrom,
  referralDraftIsEmpty,
  referralHeaderLine,
  referralHeaderText,
  referralPayload,
  referralSourceChoices,
} from "../src/lib/directory/referral-draft.ts";
import {
  emptyPersonDraft,
  personSectionCounts,
  personDraftSummary,
} from "../src/lib/directory/person-draft.ts";

const SOURCES: ReferralSource[] = [
  { id: "directoryReferralSource_website", name: "Website", position: 2, archived: false },
  {
    id: "directoryReferralSource_attorney",
    name: "Another Attorney",
    position: 1,
    archived: false,
  },
  { id: "directoryReferralSource_radio", name: "Radio", position: 3, archived: true },
];

const REFERRER = {
  entityId: "directoryPerson_okafor",
  displayName: "Daniel Okafor",
  mergedIntoId: null,
};

describe("the source choices", () => {
  it("offers none, then the live sources in the firm's order, and no retired one", () => {
    expect(referralSourceChoices(SOURCES, null)).toEqual([
      { value: NO_SOURCE_VALUE, label: "None" },
      { value: "directoryReferralSource_attorney", label: "Another Attorney" },
      { value: "directoryReferralSource_website", label: "Website" },
    ]);
  });

  it("keeps a retired source where the record already stands under it", () => {
    const choices = referralSourceChoices(SOURCES, "directoryReferralSource_radio");
    expect(choices.at(-1)).toEqual({
      value: "directoryReferralSource_radio",
      label: "Radio (retired)",
    });
  });
});

describe("the header line", () => {
  const both: EntityReferral = {
    source: { id: "directoryReferralSource_attorney", name: "Another Attorney", archived: false },
    referrer: REFERRER,
  };

  it("names the person, then the source in brackets", () => {
    const line = referralHeaderLine(both);
    expect(line?.referrer?.entityId).toBe("directoryPerson_okafor");
    expect(referralHeaderText(line!)).toBe("Referred by Daniel Okafor (Another Attorney)");
  });

  it("says the source alone, or the person alone, and nothing when neither is recorded", () => {
    expect(referralHeaderText(referralHeaderLine({ ...both, referrer: null })!)).toBe(
      "Referred by Another Attorney",
    );
    expect(referralHeaderText(referralHeaderLine({ ...both, source: null })!)).toBe(
      "Referred by Daniel Okafor",
    );
    expect(referralHeaderLine(null)).toBeNull();
  });

  it("opens the surviving record of a referrer who was merged away", () => {
    const line = referralHeaderLine({
      source: null,
      referrer: { ...REFERRER, mergedIntoId: "directoryPerson_survivor" },
    });
    expect(line?.referrer?.entityId).toBe("directoryPerson_survivor");
  });
});

describe("the draft", () => {
  it("reads a referral back and writes the same thing it read", () => {
    const referral: EntityReferral = {
      source: { id: "directoryReferralSource_website", name: "Website", archived: false },
      referrer: REFERRER,
    };
    const draft = referralDraftFrom(referral);
    expect(referralPayload(draft)).toEqual({
      sourceId: "directoryReferralSource_website",
      referrerEntityId: "directoryPerson_okafor",
    });
    expect(referralDraftChanged(draft, referral)).toBe(false);
    draft.referrer = null;
    expect(referralDraftChanged(draft, referral)).toBe(true);
  });

  it("asks for removal when both fields are empty", () => {
    const draft = emptyReferralDraft();
    expect(referralDraftIsEmpty(draft)).toBe(true);
    expect(referralPayload(draft)).toEqual({ sourceId: null, referrerEntityId: null });
  });

  it("counts toward New Person's About section and reads back as Referred By", () => {
    const person = emptyPersonDraft();
    person.referral = {
      sourceId: "directoryReferralSource_attorney",
      referrer: { identifier: "directoryPerson_okafor", name: "Daniel Okafor", kind: "person" },
    };
    expect(personSectionCounts(person).find((section) => section.id === "about")?.count).toBe(1);
    expect(personDraftSummary(person)).toContainEqual({
      label: "Referred By",
      value: "Daniel Okafor",
      mark: "referral",
    });
  });
});
