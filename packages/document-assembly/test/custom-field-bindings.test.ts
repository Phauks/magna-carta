import { effectiveNumberScale } from "@magna-carta/custom-fields/number-scale";
import { CUSTOM_FIELD_KINDS } from "@magna-carta/custom-fields/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_FIELD_HANDLE_PREFIX,
  CUSTOM_FIELD_HANDLE_TOKEN_LENGTH,
  CUSTOM_KEY_PREFIX,
  customFieldDictionaryEntries,
  customFieldHandleOf,
  customMergeKeyFor,
  mergeValueForCustomField,
  type CustomFieldDefinitionRow,
  type CustomFieldValueRow,
} from "../src/custom-field-bindings.ts";
import { dictionaryForFirm, expressionScopeFor, lookupDictionaryEntry } from "../src/dictionary.ts";
import { lex } from "../src/expression/lex.ts";
import { formatMergeValue } from "../src/format.ts";

// A firm's own fields, as merge fields. The properties that matter are the ones a firm can break by
// doing something ordinary: renaming a field, archiving one, declaring a scale, or minting a handle with
// a hyphen in it.

const random = seededRandomSource(20260805);

function handle(): string {
  return newIdentifier("customField", random);
}

function definition(overrides: Partial<CustomFieldDefinitionRow> = {}): CustomFieldDefinitionRow {
  return {
    handle: handle(),
    name: "Retainer cap",
    kind: "currency",
    numberScale: null,
    archived: false,
    ...overrides,
  };
}

describe("a custom merge key names a handle, never a name", () => {
  it("round-trips a minted handle through the key form", () => {
    const identity = handle();
    const key = customMergeKeyFor(identity);
    expect(key).toBe(`${CUSTOM_KEY_PREFIX}${identity}`);
    expect(customFieldHandleOf(key)).toBe(identity);
  });

  it("restates the minted handle's shape exactly — the lexer's copy of it cannot drift", () => {
    // The lexer holds the same shape as a lexical rule, because the expression folder stays free of
    // platform imports so its checker can run in a browser. This is the pin that keeps the restatement
    // honest: a change to the alphabet or the token length in @magna-carta/identifiers fails here.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const identity = handle();
      expect(identity.startsWith(CUSTOM_FIELD_HANDLE_PREFIX)).toBe(true);
      expect(identity.slice(CUSTOM_FIELD_HANDLE_PREFIX.length)).toHaveLength(
        CUSTOM_FIELD_HANDLE_TOKEN_LENGTH,
      );
      expect(customFieldHandleOf(customMergeKeyFor(identity))).toBe(identity);
    }
  });

  it("refuses a key that only looks like one, so a bad key never becomes a bound parameter", () => {
    expect(customFieldHandleOf("custom.retainerCap")).toBeUndefined();
    expect(customFieldHandleOf("custom.customField_tooShort")).toBeUndefined();
    expect(customFieldHandleOf("matter.number")).toBeUndefined();
    expect(customFieldHandleOf("custom.customField_' OR 1=1 --")).toBeUndefined();
  });

  it("lexes a hyphen-bearing handle as ONE atom, and still lexes a subtraction beside it", () => {
    // A handle's alphabet includes the hyphen, which is also the subtraction operator. The atom's end is
    // fixed by its length, so the two can never be confused however an author spaces the expression.
    const hyphenated = "custom.customField_a-b_cDeFgHiJkLmNoPqRs";
    expect(
      hyphenated.slice(CUSTOM_KEY_PREFIX.length + CUSTOM_FIELD_HANDLE_PREFIX.length),
    ).toHaveLength(CUSTOM_FIELD_HANDLE_TOKEN_LENGTH);

    const alone = lex(hyphenated);
    expect(alone.ok).toBe(true);
    if (!alone.ok) return;
    expect(alone.value[0]).toMatchObject({ kind: "name", text: hyphenated });
    expect(alone.value[1]?.kind).toBe("end");

    const subtracted = lex(`${hyphenated}-5`);
    expect(subtracted.ok).toBe(true);
    if (!subtracted.ok) return;
    expect(subtracted.value.map((token) => token.text)).toEqual([hyphenated, "-", "5", ""]);
  });
});

describe("the firm's catalogue widens the dictionary", () => {
  it("contributes one entry per active field, described by its NAME and keyed by its HANDLE", () => {
    const field = definition({ name: "Settlement authority", kind: "currency" });
    const entries = customFieldDictionaryEntries([field]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.key).toBe(customMergeKeyFor(field.handle));
    expect(entries[0]?.description).toBe("Settlement authority");
    expect(entries[0]?.source).toBe("customField");
    expect(entries[0]?.valueType).toBe("money");

    // A rename changes the label and nothing a template stores.
    const renamed = customFieldDictionaryEntries([{ ...field, name: "Authority cap" }]);
    expect(renamed[0]?.key).toBe(entries[0]?.key);
  });

  it("contributes NOTHING for an archived field, which is what makes drift fail loudly", () => {
    const field = definition({ archived: true });
    expect(customFieldDictionaryEntries([field])).toEqual([]);
    const dictionary = dictionaryForFirm(customFieldDictionaryEntries([field]));
    expect(lookupDictionaryEntry(customMergeKeyFor(field.handle), dictionary)).toBeUndefined();
  });

  it("binds every kind the engine ships to a value type with at least one rendering", () => {
    const fields = CUSTOM_FIELD_KINDS.map((kind) => definition({ kind }));
    const entries = customFieldDictionaryEntries(fields);
    expect(entries).toHaveLength(CUSTOM_FIELD_KINDS.length);
    for (const entry of entries) {
      expect(entry.absence, entry.key).toBe("placeholder");
      expect(entry.sensitivity, entry.key).toBe("ordinary");
      expect(entry.defaultFormat.length, entry.key).toBeGreaterThan(0);
    }
  });

  it("puts a firm's fields into the dictionary without displacing a shipped key", () => {
    const field = definition();
    const dictionary = dictionaryForFirm(customFieldDictionaryEntries([field]));
    expect(lookupDictionaryEntry("matter.number", dictionary)?.source).toBe("matter");
    expect(lookupDictionaryEntry(customMergeKeyFor(field.handle), dictionary)?.source).toBe(
      "customField",
    );
    // The platform's own catalogue is unchanged: the widening is per firm, not global.
    expect(lookupDictionaryEntry(customMergeKeyFor(field.handle))).toBeUndefined();
  });

  it("puts a firm's fields into the expression scope, so a calculation can read one", () => {
    const field = definition({ kind: "currency" });
    const scope = expressionScopeFor(dictionaryForFirm(customFieldDictionaryEntries([field])));
    expect(scope.get(customMergeKeyFor(field.handle))?.type).toBe("money");
    // An image has no expression type at all, so its key is simply not a name a calculation can use.
    expect(scope.get("location.letterheadLogo")).toBeUndefined();
  });
});

describe("a stored value renders at the scale its field declared", () => {
  function valueRow(overrides: Partial<CustomFieldValueRow>): CustomFieldValueRow {
    return {
      handle: handle(),
      kind: "number",
      numberScale: null,
      valueText: null,
      valueNumber: null,
      valueDate: null,
      resolvedLabel: null,
      ...overrides,
    };
  }

  it("reads the SAME integer as a different number on a different kind", () => {
    // The rule the custom-fields engine states and this consumer must not restate differently: 500 is
    // five hundred on a number field and five dollars on a currency field.
    const plain = mergeValueForCustomField(valueRow({ kind: "number", valueNumber: 500 }), "USD");
    const currency = mergeValueForCustomField(
      valueRow({ kind: "currency", valueNumber: 500 }),
      "USD",
    );
    expect(plain).toEqual({ kind: "number", value: 500, scale: 0 });
    expect(currency).toEqual({ kind: "money", amountMinor: 500, currencyCode: "USD" });
    expect(formatMergeValue(plain!, "plain", { timeZone: "UTC" })).toBe("500");
    expect(formatMergeValue(currency!, "currency", { timeZone: "UTC" })).toBe("$5.00");
  });

  it("honours a declared number scale by moving the point, never by dividing", () => {
    const scaled = mergeValueForCustomField(
      valueRow({ kind: "number", numberScale: 3, valueNumber: 1234 }),
      "USD",
    );
    expect(scaled).toEqual({ kind: "number", value: 1234, scale: 3 });
    expect(formatMergeValue(scaled!, "plain", { timeZone: "UTC" })).toBe("1.234");
    expect(effectiveNumberScale("number", 3)).toBe(3);
  });

  it("refuses to call a currency field money when its declared scale is not the currency's", () => {
    // A "cent" that is not a hundredth belongs to no currency. The value renders as the exact decimal it
    // is rather than as an amount that would look like money and be wrong.
    const odd = mergeValueForCustomField(
      valueRow({ kind: "currency", numberScale: 3, valueNumber: 1234 }),
      "USD",
    );
    expect(odd).toEqual({ kind: "number", value: 1234, scale: 3 });
  });

  it("renders a picklist and a reference by their LABEL, never by the handle they store", () => {
    expect(
      mergeValueForCustomField(valueRow({ kind: "picklist", resolvedLabel: "Contingency" }), "USD"),
    ).toEqual({ kind: "text", text: "Contingency" });
    expect(
      mergeValueForCustomField(
        valueRow({ kind: "contact-reference", resolvedLabel: "Amara Okafor" }),
        "USD",
      ),
    ).toEqual({ kind: "text", text: "Amara Okafor" });
  });

  it("treats a time field as text, because there is no time-of-day type to compute with", () => {
    expect(mergeValueForCustomField(valueRow({ kind: "time", valueDate: "14:30" }), "USD")).toEqual(
      {
        kind: "text",
        text: "14:30",
      },
    );
    expect(
      mergeValueForCustomField(valueRow({ kind: "date", valueDate: "2026-03-14" }), "USD"),
    ).toEqual({ kind: "date", isoDate: "2026-03-14" });
  });

  it("reports a field with no stored value as nothing at all, which the resolver reads as an absence", () => {
    expect(mergeValueForCustomField(valueRow({ kind: "single-line" }), "USD")).toBeUndefined();
    expect(mergeValueForCustomField(valueRow({ kind: "checkbox" }), "USD")).toBeUndefined();
    expect(mergeValueForCustomField(valueRow({ kind: "checkbox", valueNumber: 0 }), "USD")).toEqual(
      { kind: "boolean", value: false },
    );
  });
});
