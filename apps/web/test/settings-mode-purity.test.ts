/*
 * The mode-purity fitness check — the CI teeth the section registry's mode-purity invariant
 * promises (src/lib/settings/settings-sections.ts): a section's commitMode binds every setting
 * on its page, mode follows scope, and a page never mixes instant-apply controls with
 * draft-then-save controls. Runs under node against the pure-data registries; no browser, no
 * storage.
 *
 * IT CHECKS THE SURFACE, NOT ONE REGISTRY. SETTING_DEFINITIONS is empty — every settings row now
 * has a server behind it and declares itself beside the draft that reads and writes it — so a check
 * over that array alone would pass by having nothing to check. The definitions are gathered from
 * where they actually live, and the non-vacuity guard below is what stops this file quietly
 * becoming decoration again if the next surface forgets to add itself here.
 */

import { describe, expect, it } from "vitest";
import { WEEK_STARTS_ON_DEFINITION } from "../src/lib/calendar/calendar-settings-draft.svelte.ts";
import { FILE_SAFETY_DEFINITIONS } from "../src/lib/file-manager/scan-policy-draft.svelte.ts";
import { BILLING_DEFINITIONS } from "../src/lib/settings/firm-time-policy-draft.svelte.ts";
import { MEETINGS_DEFINITIONS } from "../src/lib/settings/meeting-settings-draft.svelte.ts";
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from "../src/lib/settings/settings-definitions.ts";
import { SETTINGS_SECTIONS, type SettingsSection } from "../src/lib/settings/settings-sections.ts";

// Every definition the settings surface renders through a shared SettingsRow, wherever it is
// declared. Beta Access and Firm Profile are deliberately absent: each declares its one definition
// inside its own page component, which a node test cannot import, and each is a single row on a
// page whose mode the section registry already fixes.
const SURFACE_DEFINITIONS: readonly SettingDefinition[] = [
  ...SETTING_DEFINITIONS,
  WEEK_STARTS_ON_DEFINITION,
  ...FILE_SAFETY_DEFINITIONS,
  ...BILLING_DEFINITIONS,
  ...MEETINGS_DEFINITIONS,
];

function sectionForDefinition(sectionId: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === sectionId);
}

describe("settings mode purity", () => {
  // The guard against vacuity: every assertion below iterates SURFACE_DEFINITIONS, so an empty
  // gather would make all of them pass by checking nothing.
  it("gathers the settings surface (so the assertions below are not vacuous)", () => {
    expect(SURFACE_DEFINITIONS.length).toBeGreaterThanOrEqual(7);
    expect(new Set(SURFACE_DEFINITIONS.map((definition) => definition.sectionId))).toEqual(
      new Set(["calendar", "file-safety", "billing", "meetings"]),
    );
  });

  it("every definition id is unique across the surface", () => {
    const ids = SURFACE_DEFINITIONS.map((definition) => definition.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("every definition attaches to a registered section", () => {
    for (const definition of SURFACE_DEFINITIONS) {
      expect(
        sectionForDefinition(definition.sectionId),
        `definition "${definition.id}" names unknown section "${definition.sectionId}"`,
      ).toBeDefined();
    }
  });

  it("no definition attaches to a read-only section", () => {
    for (const definition of SURFACE_DEFINITIONS) {
      const section = sectionForDefinition(definition.sectionId);
      expect(
        section?.readOnly,
        `definition "${definition.id}" attaches to read-only section "${definition.sectionId}"`,
      ).toBeUndefined();
    }
  });

  it("mode follows scope on every section that has definitions", () => {
    for (const section of SETTINGS_SECTIONS) {
      const definitions = SURFACE_DEFINITIONS.filter(
        (definition) => definition.sectionId === section.id,
      );
      if (definitions.length === 0) continue;
      const expectedMode = section.scope === "firm" ? "draft" : "instant";
      expect(
        section.commitMode,
        `section "${section.id}" (scope "${section.scope}") with definitions must be "${expectedMode}"`,
      ).toBe(expectedMode);
    }
  });

  it("confirm appears only on definitions whose section is draft mode", () => {
    // A confirmation step needs a save flow to live in; an instant-apply control has none.
    for (const definition of SURFACE_DEFINITIONS) {
      if (definition.confirm !== true) continue;
      const section = sectionForDefinition(definition.sectionId);
      expect(
        section?.commitMode,
        `definition "${definition.id}" has confirm but its section is not draft mode`,
      ).toBe("draft");
    }
  });

  it("every default value is representable by its definition", () => {
    for (const definition of SURFACE_DEFINITIONS) {
      switch (definition.kind) {
        case "select": {
          const optionValues = (definition.options ?? []).map((option) => option.value);
          expect(
            optionValues.length,
            `definition "${definition.id}" (${definition.kind}) declares no options`,
          ).toBeGreaterThan(0);
          expect(
            optionValues,
            `definition "${definition.id}" default "${String(definition.defaultValue)}" is not among its options`,
          ).toContain(definition.defaultValue);
          break;
        }
        case "switch":
          expect(
            typeof definition.defaultValue,
            `definition "${definition.id}" (switch) default must be boolean`,
          ).toBe("boolean");
          break;
        case "text":
          expect(
            typeof definition.defaultValue,
            `definition "${definition.id}" (text) default must be a string`,
          ).toBe("string");
          break;
        case "number": {
          expect(
            typeof definition.defaultValue,
            `definition "${definition.id}" (number) default must be a number`,
          ).toBe("number");
          // Both bounds are required, not merely honoured when present: an unbounded numeric field
          // renders as one that takes anything and is refused by the server, which teaches the
          // wrong thing about what the firm may choose.
          expect(
            definition.minimum,
            `definition "${definition.id}" (number) declares no minimum`,
          ).toBeTypeOf("number");
          expect(
            definition.maximum,
            `definition "${definition.id}" (number) declares no maximum`,
          ).toBeTypeOf("number");
          expect(
            definition.defaultValue,
            `definition "${definition.id}" default falls outside its own bounds`,
          ).toBeGreaterThanOrEqual(definition.minimum as number);
          expect(
            definition.defaultValue,
            `definition "${definition.id}" default falls outside its own bounds`,
          ).toBeLessThanOrEqual(definition.maximum as number);
          break;
        }
      }
    }
  });

  it("every firm section with definitions declares an edit permission area", () => {
    for (const section of SETTINGS_SECTIONS) {
      if (section.scope !== "firm") continue;
      const definitions = SURFACE_DEFINITIONS.filter(
        (definition) => definition.sectionId === section.id,
      );
      if (definitions.length === 0) continue;
      expect(
        section.editPermissionArea,
        `firm section "${section.id}" has definitions but no editPermissionArea`,
      ).toBeDefined();
    }
  });
});
