import { describe, expect, it } from "vitest";
import {
  ASSET_AGGREGATE_SUBJECT,
  ASSET_LIST_FIELD,
  ASSET_SUBJECT_BY_CLASS,
  assetItemFieldsFor,
  assetListItem,
  assetSubjectValues,
} from "../src/asset-bindings.ts";
import { MERGE_SUBJECTS } from "../src/catalog/subjects.ts";
import { DICTIONARY, lookupDictionaryEntry } from "../src/dictionary.ts";
import type { MatterAssetMergeRow } from "../src/merge-statements.ts";

// The asset subjects, and the ONE rule that makes them different from every other subject in the
// catalogue: they are collection-only.

const ASSET_SUBJECTS = MERGE_SUBJECTS.filter((subject) => subject.kind === "assetClass");

function assetRow(overrides: Partial<MatterAssetMergeRow> = {}): MatterAssetMergeRow {
  return {
    id: "matterAsset_TESTASSET00000000000",
    class: "realProperty",
    description: "14 Cavendish Row",
    type_name: "Single-family residence",
    estate_treatment: "probateEstate",
    disposition: "retained",
    value_amount_minor: null,
    value_currency: null,
    value_as_of_date: null,
    value_basis: null,
    street: "14 Cavendish Row",
    city: "Reno",
    region: "NV",
    postal: "89501",
    county: "Washoe",
    parcel_number: "012-345-67",
    legal_description: "Lot 4, Block 2",
    institution_name: null,
    account_suffix: null,
    make: null,
    model: null,
    model_year: null,
    vehicle_identification_number: null,
    caliber_or_gauge: null,
    serial_number: null,
    entity_name: null,
    jurisdiction_of_organization: null,
    entity_form: null,
    carrier_name: null,
    face_amount_minor: null,
    face_currency: null,
    principal_amount_minor: null,
    principal_currency: null,
    maturity_on: null,
    platform_name: null,
    account_handle: null,
    ...overrides,
  };
}

describe("asset subjects are collection-only (fitness)", () => {
  // THE RULE. An estate with two houses is the NORMAL case, so a scalar `realProperty.parcelNumber`
  // would resolve to an absence naming the count on most real matters — the ambiguity rule producing
  // a technically correct answer that is useless every time. The register honours the rule by not
  // creating slots it would have to refuse, and this is what makes that structural.
  it("declares exactly one key per asset subject, and it is the collection", () => {
    for (const subject of ASSET_SUBJECTS) {
      const keys = DICTIONARY.filter((entry) => entry.subject === subject.key).map(
        (entry) => entry.key,
      );
      expect(keys, subject.key).toEqual([`${subject.key}.${ASSET_LIST_FIELD}`]);
    }
  });

  it("declares no scalar facet on any asset subject", () => {
    const scalars = DICTIONARY.filter(
      (entry) =>
        ASSET_SUBJECTS.some((subject) => subject.key === entry.subject) &&
        entry.valueType !== "list",
    ).map((entry) => entry.key);
    expect(
      scalars,
      `these asset keys are scalars: ${scalars.join(", ")}. A matter with two houses would make ` +
        `every one of them an absence naming the count, which is a slot that should not exist ` +
        `rather than a slot that refuses.`,
    ).toEqual([]);
  });

  it("ships eleven asset subjects — ten platform classes plus the aggregate", () => {
    expect(ASSET_SUBJECTS).toHaveLength(11);
    expect(Object.keys(ASSET_SUBJECT_BY_CLASS)).toHaveLength(10);
    const subjectKeys = new Set(ASSET_SUBJECTS.map((subject) => subject.key));
    for (const subject of Object.values(ASSET_SUBJECT_BY_CLASS)) {
      expect(subjectKeys.has(subject), subject).toBe(true);
    }
    expect(subjectKeys.has(ASSET_AGGREGATE_SUBJECT)).toBe(true);
  });

  it("resolves every asset key from the one asset source, and an empty register to an empty list", () => {
    for (const subject of ASSET_SUBJECTS) {
      const entry = lookupDictionaryEntry(`${subject.key}.${ASSET_LIST_FIELD}`);
      expect(entry?.source, subject.key).toBe("asset");
      // An empty list is a CORRECT document, not an absence.
      expect(entry?.absence, subject.key).toBe("blank");
    }
    const values = assetSubjectValues([], ASSET_SUBJECTS);
    for (const subject of ASSET_SUBJECTS) {
      expect(values.get(`${subject.key}.${ASSET_LIST_FIELD}`)).toEqual({ kind: "list", items: [] });
    }
  });
});

describe("a value and its date are declared together, or not at all", () => {
  it("declares `value` and `valueAsOf` on every asset subject, neither without the other", () => {
    for (const subject of ASSET_SUBJECTS) {
      const names = assetItemFieldsFor(subject.key).map((field) => field.name);
      expect(names.includes("value"), subject.key).toBe(names.includes("valueAsOf"));
      expect(names, subject.key).toContain("value");
    }
  });

  it("sets neither on an item whose asset has no resolved figure", () => {
    const item = assetListItem(assetRow(), "realProperty");
    expect(item.fields.has("value")).toBe(false);
    expect(item.fields.has("valueAsOf")).toBe(false);
    expect(item.fields.has("valueBasis")).toBe(false);
    // The rest of the row is still there — an unvalued asset is an ordinary row on a schedule.
    expect(item.fields.get("parcelNumber")).toEqual({ kind: "text", text: "012-345-67" });
  });

  it("sets both together when the figure resolved", () => {
    const item = assetListItem(
      assetRow({
        value_amount_minor: 700_000_00,
        value_currency: "USD",
        value_as_of_date: "2026-02-14",
        value_basis: "appraisal",
      }),
      "realProperty",
    );
    expect(item.fields.get("value")).toEqual({
      kind: "money",
      amountMinor: 700_000_00,
      currencyCode: "USD",
    });
    expect(item.fields.get("valueAsOf")).toEqual({ kind: "date", isoDate: "2026-02-14" });
  });
});

describe("no protected value is ever a facet", () => {
  // `accountSuffix` is the facet; the full number has no key at all. A merge field that decrypted an
  // identifier into an assembled document would write the secret into a file whose confidentiality is
  // then the file's problem, and the audit row would say a decrypt happened without saying where the
  // value went.
  it("declares no asset item field that could carry a full sealed identifier", () => {
    const forbidden = /accountNumber|policyNumber|certificateNumber|taxIdentifier|ciphertext/i;
    for (const subject of ASSET_SUBJECTS) {
      for (const field of assetItemFieldsFor(subject.key)) {
        expect(forbidden.test(field.name), `${subject.key}.all.${field.name}`).toBe(false);
      }
    }
  });

  it("marks every asset entry `ordinary`, because none of them routes through the decrypt path", () => {
    for (const entry of DICTIONARY.filter((candidate) => candidate.source === "asset")) {
      expect(entry.sensitivity, entry.key).toBe("ordinary");
    }
  });

  it("projects only a four-character suffix on a financial account item", () => {
    const item = assetListItem(
      assetRow({
        class: "financialAccount",
        account_suffix: "4417",
        institution_name: "First National",
      }),
      "financialAccount",
    );
    expect(item.fields.get("accountSuffix")).toEqual({ kind: "text", text: "4417" });
    for (const name of item.fields.keys()) {
      expect(name).not.toMatch(/accountNumber/i);
    }
  });
});

describe("class items carry their own attributes, and the aggregate carries only the common set", () => {
  it("puts each asset under its class subject AND under the aggregate, from one list of rows", () => {
    const rows = [
      assetRow(),
      assetRow({ id: "matterAsset_TRUCK0000000000000000", class: "vehicle", make: "Ford" }),
    ];
    const values = assetSubjectValues(
      rows,
      ASSET_SUBJECTS.filter((subject) =>
        ["assets", "realProperty", "vehicle", "firearm"].includes(subject.key),
      ),
    );
    expect((values.get("assets.all") as { items: unknown[] }).items).toHaveLength(2);
    expect((values.get("realProperty.all") as { items: unknown[] }).items).toHaveLength(1);
    expect((values.get("vehicle.all") as { items: unknown[] }).items).toHaveLength(1);
    // A class with no assets is an empty list, which is a correct document.
    expect((values.get("firearm.all") as { items: unknown[] }).items).toHaveLength(0);
  });

  it("gives the aggregate no class-specific field", () => {
    const names = assetItemFieldsFor(ASSET_AGGREGATE_SUBJECT).map((field) => field.name);
    // The columns a house has and the columns a car has are not fields one list can carry.
    expect(names).not.toContain("parcelNumber");
    expect(names).not.toContain("vehicleIdentificationNumber");
    expect(names).toContain("description");
  });

  it("declares a policy's face amount as a term of the contract, beside the dated value", () => {
    const names = assetItemFieldsFor("insurancePolicy").map((field) => field.name);
    expect(names).toContain("faceAmount");
    expect(names).toContain("value");
    expect(names).toContain("valueAsOf");
  });
});
