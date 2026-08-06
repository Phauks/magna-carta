import { describe, expect, it } from "vitest";
import { DICTIONARY } from "../src/dictionary.ts";
import type { DictionaryEntry } from "../src/dictionary.ts";
import shippedKeys from "./fixtures/shipped-keys.json" with { type: "json" };

// THE GOLDEN KEY LIST.
//
// A stored template is a firm's document, registered against a catalogue that will keep growing for
// years, and a template binds a key by its NAME. So a shipped key is permanent: never renamed, never
// repurposed, never given a different source, never retyped, and never quietly handed a different
// default rendering — because the manifest records a format only when the author overrode it, so
// changing a default silently changes every document every existing template produces.
//
// This file is what turns those sentences into a property. `fixtures/shipped-keys.json` is a COMMITTED
// RECORD, not a generated artefact: a change to it is a reviewed act. Adding a key is a diff plus a
// review; changing one is a failure here naming the key and the property.
//
// The one permitted movement is on absence, and only in one direction: `blank` -> `placeholder` ->
// `fail`. A change that makes a hole harder to miss is safe; a change that makes it easier to miss is
// the failure this whole subsystem exists to prevent.

interface GoldenKey {
  readonly key: string;
  readonly valueType: string;
  readonly source: string;
  readonly defaultFormat: string;
  readonly absence: string;
  readonly sensitivity: string;
}

const GOLDEN: readonly GoldenKey[] = shippedKeys as readonly GoldenKey[];

const POLICY =
  "A shipped merge key is permanent: a template that was registered against it binds it by name, and a " +
  "firm that has filed two years of letters must not get different documents because the catalogue " +
  "moved under it. If this change is deliberate, update test/fixtures/shipped-keys.json in the same " +
  "commit and say why in the pull request.";

// `blank` is the least visible outcome and `fail` the most. An absence may only move UP this list.
const ABSENCE_VISIBILITY: Readonly<Record<string, number>> = { blank: 0, placeholder: 1, fail: 2 };

const BY_KEY: ReadonlyMap<string, DictionaryEntry> = new Map(
  DICTIONARY.map((entry) => [entry.key, entry]),
);

describe("key permanence (fitness)", () => {
  it("still ships every key the golden list records", () => {
    const missing = GOLDEN.map((golden) => golden.key).filter((key) => !BY_KEY.has(key));
    expect(
      missing,
      `these shipped keys have disappeared from the dictionary: ${missing.join(", ")}. ` +
        `Withdrawal is DEPRECATION, never removal — an entry gains status "deprecated" and keeps ` +
        `resolving, so registered templates keep working. ${POLICY}`,
    ).toEqual([]);
  });

  it("has added no key without adding it to the golden list", () => {
    const recorded = new Set(GOLDEN.map((golden) => golden.key));
    const added = DICTIONARY.map((entry) => entry.key).filter((key) => !recorded.has(key));
    expect(
      added,
      `these keys are in the dictionary but not in the golden list: ${added.join(", ")}. ` +
        `Adding a key is always safe — a template cannot bind what did not exist — but it is a ` +
        `DELIBERATE act, so it lands as a diff to test/fixtures/shipped-keys.json that a reviewer ` +
        `sees. A generated catalogue makes one wrong facet row wrong on every subject at once, and ` +
        `this diff is what shows all of them together. ${POLICY}`,
    ).toEqual([]);
  });

  it.each(["valueType", "source", "defaultFormat", "sensitivity"] as const)(
    "has changed no shipped key's %s",
    (property) => {
      const changed = GOLDEN.flatMap((golden) => {
        const entry = BY_KEY.get(golden.key);
        if (entry === undefined) return [];
        const now = entry[property];
        return now === golden[property] ? [] : [`${golden.key}: ${golden[property]} -> ${now}`];
      });
      expect(changed, `${changed.join("; ")}. ${POLICY}`).toEqual([]);
    },
  );

  it("has made no shipped key's absence LESS visible", () => {
    const loosened = GOLDEN.flatMap((golden) => {
      const entry = BY_KEY.get(golden.key);
      if (entry === undefined) return [];
      const before = ABSENCE_VISIBILITY[golden.absence] ?? 0;
      const after = ABSENCE_VISIBILITY[entry.absence] ?? 0;
      return after >= before ? [] : [`${golden.key}: ${golden.absence} -> ${entry.absence}`];
    });
    expect(
      loosened,
      `${loosened.join("; ")}. Absence may become MORE visible (blank -> placeholder -> fail) and ` +
        `never less: a change that makes a hole harder to miss is safe, and a change that makes it ` +
        `easier to miss files a document that reads as finished and is not. ${POLICY}`,
    ).toEqual([]);
  });

  // The one shipped key whose value type moved, and the reason the move is safe: `displayName` gained
  // the name parts so a template can ask for a surname-first or an initials rendering, and its DEFAULT
  // rendering is byte-for-byte the string it printed before. The golden list records the new type; this
  // asserts what made recording it acceptable.
  it("keeps every name-typed key defaulting to the rendering that prints the recorded name unchanged", () => {
    const names = DICTIONARY.filter((entry) => entry.valueType === "name");
    expect(names.length).toBeGreaterThan(0);
    for (const entry of names) {
      expect(entry.defaultFormat, entry.key).toBe("full");
    }
  });

  it("ships no deprecated key without naming what replaced it", () => {
    for (const entry of DICTIONARY) {
      expect(["current", "deprecated"], entry.key).toContain(entry.status);
      if (entry.status !== "deprecated") continue;
      // A deprecated entry still resolves, so a template bound to it still assembles. What it owes the
      // author is the replacement, in the field inspector, where they are looking.
      expect(entry.supersededBy, entry.key).toBeTruthy();
      expect(BY_KEY.has(entry.supersededBy ?? ""), entry.key).toBe(true);
    }
  });
});
