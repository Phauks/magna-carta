import { describe, expect, it } from "vitest";
import { MERGE_FACETS, facetsForKind } from "../src/catalog/facets.ts";
import { MERGE_FIELD_GROUPS, mergeFieldGroupOrder } from "../src/catalog/groups.ts";
import {
  MERGE_SUBJECTS,
  normalizedRoleToken,
  subjectOfKey,
  type SubjectKind,
} from "../src/catalog/subjects.ts";
import { availabilityFor, availabilityNoteFor } from "../src/catalog/entry.ts";
import { customFieldDictionaryEntries } from "../src/custom-field-bindings.ts";
import { DICTIONARY, dictionaryForFirm, lookupDictionaryEntry } from "../src/dictionary.ts";
import { legalFormatsFor } from "../src/format.ts";

// The catalogue is GENERATED, so the risk moves from "is this row right" to "is the generator right" —
// and the tests move with it. A hand-written catalogue's single wrong row is seen by nobody; a
// generated one's wrong facet row is wrong on every subject of its kind at once, which is a real cost
// of the shape and is bought back here, where every subject is seen together.

const KINDS: readonly SubjectKind[] = [...new Set(MERGE_SUBJECTS.map((subject) => subject.kind))];

describe("the subject registry (fitness)", () => {
  it("gives no two subjects the same normalized token", () => {
    // A party subject is matched against `matter_party.role` by normalization, so two subjects that
    // normalize alike would both claim the same links and one of them would silently never resolve.
    // There is no way to see that from either row on its own. The rule is applied to EVERY subject, not
    // only the party ones, so a later kind cannot introduce the collision by a different door.
    const tokens = MERGE_SUBJECTS.map((subject) => normalizedRoleToken(subject.key));
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) expect(token.length).toBeGreaterThan(0);
  });

  it("reserves the whole top-level namespace, so no key escapes a declared subject", () => {
    for (const entry of DICTIONARY) {
      expect(subjectOfKey(entry.key), entry.key).toBeDefined();
      expect(entry.subject, entry.key).toBe(subjectOfKey(entry.key)?.key);
    }
  });

  it("puts every subject under a group the registry declares", () => {
    for (const subject of MERGE_SUBJECTS) {
      expect(mergeFieldGroupOrder(subject.group), subject.key).toBeGreaterThanOrEqual(0);
    }
  });

  it("orders the groups totally, with no duplicate key", () => {
    const keys = MERGE_FIELD_GROUPS.map((group) => group.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const group of MERGE_FIELD_GROUPS) expect(group.label.length).toBeGreaterThan(0);
  });

  it("gives every subject at least one key", () => {
    // A subject with no facet and no written-out fact is a heading with nothing under it — which is a
    // row somebody added and then never wired up, invisible from the row itself.
    for (const subject of MERGE_SUBJECTS) {
      const keys = DICTIONARY.filter((entry) => entry.subject === subject.key);
      const firmDefined = subject.kind === "firmDefined";
      expect(keys.length > 0 || firmDefined, subject.key).toBe(true);
    }
  });
});

describe("the cross product (fitness)", () => {
  it("produces every declared facet for every subject of its kind — a hole is a defect", () => {
    const holes: string[] = [];
    for (const subject of MERGE_SUBJECTS) {
      for (const facet of facetsForKind(subject.kind)) {
        const key = `${subject.key}.${facet.name}`;
        if (lookupDictionaryEntry(key) === undefined) holes.push(key);
      }
    }
    expect(
      holes,
      `these subject-facet combinations produced no entry: ${holes.join(", ")}. A facet declared for ` +
        `a kind applies to EVERY subject of that kind; a missing one is a generator defect, not a ` +
        `choice.`,
    ).toEqual([]);
  });

  it("gives a facet identical behaviour on every subject it applies to, except where an override says so", () => {
    // The whole reason to generate rather than write out: a facet's absence behaviour, value type, and
    // default rendering must not differ between two slots by accident. The one deliberate difference is
    // the client's name, which fails the assembly where its siblings show a marker.
    const declaredDifferences = new Set(["client.displayName"]);
    for (const facet of MERGE_FACETS) {
      for (const kind of facet.kinds) {
        for (const subject of MERGE_SUBJECTS.filter((candidate) => candidate.kind === kind)) {
          const key = `${subject.key}.${facet.name}`;
          const entry = lookupDictionaryEntry(key);
          expect(entry?.valueType, key).toBe(facet.valueType);
          expect(entry?.defaultFormat, key).toBe(facet.defaultFormat);
          expect(entry?.source, key).toBe(facet.source);
          if (declaredDifferences.has(key)) continue;
          expect(entry?.absence, key).toBe(facet.absence);
        }
      }
    }
  });

  it("declares at least one facet or written-out fact for every kind in use", () => {
    for (const kind of KINDS) {
      const subjects = MERGE_SUBJECTS.filter((subject) => subject.kind === kind);
      const anyKeys = subjects.some((subject) =>
        DICTIONARY.some((entry) => entry.subject === subject.key),
      );
      expect(anyKeys || kind === "firmDefined", kind).toBe(true);
    }
  });
});

describe("presentation metadata on every entry (fitness)", () => {
  it("gives every entry a label, a group, a subject, a prominence, and a status", () => {
    for (const entry of DICTIONARY) {
      expect(entry.label.length, entry.key).toBeGreaterThan(0);
      expect(mergeFieldGroupOrder(entry.group), entry.key).toBeGreaterThanOrEqual(0);
      expect(entry.subject.length, entry.key).toBeGreaterThan(0);
      expect(["primary", "secondary"], entry.key).toContain(entry.prominence);
      expect(["current", "deprecated"], entry.key).toContain(entry.status);
    }
  });

  it("gives every entry one example rendering per legal format its type has", () => {
    // The examples are produced by running an invented value through the REAL format table, so a
    // missing one means a format the formatter cannot actually produce — a format-table row with no
    // rendering behind it, which is exactly what a hand-written example list would hide.
    for (const entry of DICTIONARY) {
      const formats = legalFormatsFor(entry.valueType);
      for (const format of formats) {
        expect(
          entry.exampleRenderings[format],
          `${entry.key} has no example rendering for its legal format "${format}"`,
        ).toBeTruthy();
      }
      expect(Object.keys(entry.exampleRenderings).length, entry.key).toBe(formats.length);
    }
  });

  it("shows the same invented sample rendered differently, never a different sample per format", () => {
    // A name's seven renderings are seven ways of writing ONE person. If two of them named different
    // people the picker's format chooser would teach the wrong thing about what a format does.
    const entry = lookupDictionaryEntry("opposingCounsel.displayName");
    expect(entry?.exampleRenderings).toEqual({
      full: "Rowan Ashcroft",
      formal: "Dr. Rowan T. Ashcroft Jr.",
      lastFirst: "Ashcroft, Rowan",
      initials: "R.T.A.",
      family: "Ashcroft",
      given: "Rowan",
      upper: "ROWAN ASHCROFT",
    });
  });

  it("derives availability from the source and the subject's optionality rather than declaring it", () => {
    for (const entry of DICTIONARY) {
      expect(["automatic", "conditional", "manual", "unavailable"], entry.key).toContain(
        availabilityFor(entry),
      );
      expect(availabilityNoteFor(entry).length, entry.key).toBeGreaterThan(10);
    }
    // A matter always has a client and always has a number; it need not have an opposing party or
    // belong to an office, and a template naming one of those is showing a conditional absence rather
    // than a broken binding.
    expect(availabilityFor(lookupDictionaryEntry("matter.number")!)).toBe("automatic");
    expect(availabilityFor(lookupDictionaryEntry("client.displayName")!)).toBe("automatic");
    expect(availabilityFor(lookupDictionaryEntry("opposingParty.displayName")!)).toBe(
      "conditional",
    );
    expect(availabilityFor(lookupDictionaryEntry("location.name")!)).toBe("conditional");
    expect(availabilityNoteFor(lookupDictionaryEntry("location.name")!)).toContain("no office");
  });

  it("carries the subject's search words on every one of its keys", () => {
    // Someone typing "defendant" is naming the SUBJECT and someone typing "surname" is naming the
    // FACET; both have to find the same row, which is why the synonyms are the union rather than a
    // per-key list three hundred rows long.
    expect(lookupDictionaryEntry("opposingParty.displayName")?.synonyms).toContain("defendant");
    expect(lookupDictionaryEntry("opposingParty.all")?.synonyms).toContain("defendant");
    expect(lookupDictionaryEntry("client.socialSecurityNumber")?.synonyms).toContain("SSN");
  });
});

describe("the firm's own fields join the same catalogue", () => {
  const firmEntries = customFieldDictionaryEntries([
    {
      handle: "customField_ABCDEFGHIJKLMNOPQRSTU",
      name: "Retainer cap",
      kind: "currency",
      numberScale: 2,
      archived: false,
    },
  ]);

  it("carries the presentation metadata every platform entry carries", () => {
    const entry = firmEntries[0];
    expect(entry?.label).toBe("Retainer cap");
    expect(entry?.subject).toBe("custom");
    expect(mergeFieldGroupOrder(entry?.group ?? "")).toBeGreaterThanOrEqual(0);
    expect(entry?.status).toBe("current");
    for (const format of legalFormatsFor("money")) {
      expect(entry?.exampleRenderings[format], format).toBeTruthy();
    }
  });

  it("cannot displace a platform key", () => {
    const combined = dictionaryForFirm(firmEntries);
    const keys = combined.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(combined.length).toBe(DICTIONARY.length + firmEntries.length);
  });
});
