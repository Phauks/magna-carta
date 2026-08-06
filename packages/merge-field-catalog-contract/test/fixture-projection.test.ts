import { DICTIONARY, lookupDictionaryEntry } from "@magna-carta/document-assembly/dictionary";
import { MERGE_FIELD_GROUPS as ENGINE_GROUPS } from "@magna-carta/document-assembly/catalog-groups";
import { mergeSubject } from "@magna-carta/document-assembly/catalog-subjects";
import { legalFormatsFor } from "@magna-carta/document-assembly/format";
import type { MergeValueType } from "@magna-carta/document-assembly/types";
import { describe, expect, it } from "vitest";
import { isCustomMergeKey } from "@magna-carta/document-assembly/custom-field-bindings";
import {
  FIXTURE_MERGE_FIELD_ENTRIES,
  FIXTURE_TEMPLATE_FIELD_MANIFESTS,
} from "../src/fixture-catalog.ts";
import {
  MERGE_FIELD_GROUPS,
  MERGE_FIELD_VALUE_TYPE_LABELS,
  type MergeFieldValueType,
} from "../src/types.ts";

// THE FIXTURE IS A PROJECTION, NOT AN INVENTION.
//
// This package is a contract and a stand-in. At twenty-nine keys a fixture free to describe fields the
// engine does not have was a harmless stand-in; at hundreds it is a second catalogue with its own way
// of being wrong — and it had already grown a practice area, a court case number, and a responsible
// attorney that nothing could fill in. These tests take that freedom away.
//
// The one thing that may not project is a firm's own `custom.<handle>` field: those exist per firm and
// by construction not in the platform's shipped list. They are held to the minted handle SHAPE instead,
// so a surface is laid out against a key of the real length.

const PLATFORM_ENTRIES = FIXTURE_MERGE_FIELD_ENTRIES.filter(
  (entry) => !isCustomMergeKey(entry.key),
);
const FIRM_ENTRIES = FIXTURE_MERGE_FIELD_ENTRIES.filter((entry) => isCustomMergeKey(entry.key));

describe("every fixture key exists in the real dictionary", () => {
  it("names no platform field the engine does not ship", () => {
    const invented = PLATFORM_ENTRIES.map((entry) => entry.key).filter(
      (key) => lookupDictionaryEntry(key) === undefined,
    );
    expect(
      invented,
      `the fixture catalog names fields the merge-field dictionary does not have: ${invented.join(", ")}. ` +
        `A fixture that can describe a field nothing fills in is a second catalogue, and this is the ` +
        `assertion that stops it being one.`,
    ).toEqual([]);
  });

  it("shapes every firm-defined fixture key like a minted handle", () => {
    expect(FIRM_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of FIRM_ENTRIES) {
      expect(isCustomMergeKey(entry.key), entry.key).toBe(true);
    }
  });

  it("agrees with the dictionary on every projected field's type, formats, and sensitivity", () => {
    for (const entry of PLATFORM_ENTRIES) {
      const real = lookupDictionaryEntry(entry.key);
      expect(real, entry.key).toBeDefined();
      expect(entry.valueType, entry.key).toBe(real?.valueType);
      expect(entry.sensitivity, entry.key).toBe(real?.sensitivity);
      expect(entry.formats, entry.key).toEqual([...legalFormatsFor(real?.valueType ?? "text")]);
      expect(entry.label, entry.key).toBe(real?.label);
      expect(entry.group, entry.key).toBe(real?.group);
      expect(entry.subject, entry.key).toBe(real?.subject);
      expect(entry.subjectLabel, entry.key).toBe(mergeSubject(real?.subject ?? "")?.label);
      expect(entry.prominence, entry.key).toBe(real?.prominence);
      expect(entry.exampleRenderings, entry.key).toEqual(real?.exampleRenderings);
    }
  });

  it("keeps the deliberately broken manifest naming a key the catalog really lacks", () => {
    // Every surface that must report an unrecognized placeholder needs a case to report. It has to be a
    // key the DICTIONARY lacks too, or the fixture would be describing a template that works.
    const probate = FIXTURE_TEMPLATE_FIELD_MANIFESTS.find(
      (manifest) => manifest.templateVersionId === "probate-petition-v2",
    );
    expect(probate?.unrecognizedKeys).toEqual(["matter.filingDeadline"]);
    expect(lookupDictionaryEntry("matter.filingDeadline")).toBeUndefined();
  });

  it("names only fixture-catalog keys in every other manifest placeholder", () => {
    const known = new Set(FIXTURE_MERGE_FIELD_ENTRIES.map((entry) => entry.key));
    for (const manifest of FIXTURE_TEMPLATE_FIELD_MANIFESTS) {
      for (const placeholder of manifest.placeholders) {
        if (manifest.unrecognizedKeys.includes(placeholder.key)) continue;
        expect(
          known.has(placeholder.key),
          `${manifest.templateVersionId}: ${placeholder.key}`,
        ).toBe(true);
      }
    }
  });

  it("asks for a format the field actually supports, wherever a placeholder names one", () => {
    const byKey = new Map(FIXTURE_MERGE_FIELD_ENTRIES.map((entry) => [entry.key, entry]));
    for (const manifest of FIXTURE_TEMPLATE_FIELD_MANIFESTS) {
      for (const placeholder of manifest.placeholders) {
        if (placeholder.format === undefined) continue;
        const entry = byKey.get(placeholder.key);
        expect(entry?.formats, `${manifest.templateVersionId}: ${placeholder.key}`).toContain(
          placeholder.format,
        );
      }
    }
  });
});

// TWO UNIONS DESCRIBING THE SAME THING AND DISAGREEING IS A DRIFT GENERATOR. The contract's value types
// used to carry `longText` and `address` where the engine had `image`, `list`, and `rate` — two
// catalogues answering the same question differently, which is exactly what this whole slice exists to
// stop. There is one list now, and this is the assertion on the pairing.
describe("the contract's vocabularies are pinned to the engine's", () => {
  it("declares exactly the engine's value types, with a label for each", () => {
    const engineTypes = new Set<MergeValueType>(DICTIONARY.map((entry) => entry.valueType));
    // Every type the engine can produce has a contract member and a label...
    for (const type of engineTypes) {
      expect(
        MERGE_FIELD_VALUE_TYPE_LABELS[type as MergeFieldValueType],
        `the contract has no label for the engine's "${type}"`,
      ).toBeTruthy();
    }
    // ...and every contract member is a type the engine's format table knows, so the contract cannot
    // grow a type nothing can ever render.
    for (const type of Object.keys(MERGE_FIELD_VALUE_TYPE_LABELS)) {
      expect(
        legalFormatsFor(type as MergeValueType),
        `the contract declares "${type}", which the engine's format table does not`,
      ).toBeDefined();
    }
  });

  it("declares exactly the engine's groups, in the engine's order", () => {
    expect(MERGE_FIELD_GROUPS.map((group) => group.key)).toEqual(
      ENGINE_GROUPS.map((group) => group.key),
    );
    expect(MERGE_FIELD_GROUPS.map((group) => group.label)).toEqual(
      ENGINE_GROUPS.map((group) => group.label),
    );
  });
});
