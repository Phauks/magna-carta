import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alreadyHeldSentence,
  isRepeatLink,
  rolesAlreadyHeld,
} from "../src/lib/components/record-parties/linkable-entities.ts";
import {
  PARTIES_TAB_KEY,
  openingTabForParties,
} from "../src/lib/components/record-parties/parties-tab.ts";
import type { RecordParty } from "../src/lib/components/record-parties/types.ts";

/*
 * RecordParties' package-local contract.
 *
 * What is rendered belongs to the stories. What is asserted here is what a rendered tab cannot show:
 * the rule that one person may be on a record twice in two roles and never twice in one, which tab a
 * record with people on it opens on, and the cascade — the directory-linking family's three recipes
 * dress the surfaces they sit in and each other, so they only work while they are imported after
 * them and in their own order, and that is silent when wrong.
 */

const PACKAGE_ROOT = join(import.meta.dirname, "..");

const party = (
  identifier: string,
  entityIdentifier: string,
  role: string,
  roleLabel: string,
): RecordParty => ({
  identifier,
  entityIdentifier,
  name: entityIdentifier,
  kind: "person",
  role,
  roleLabel,
});

const PARTIES: readonly RecordParty[] = [
  party("link-1", "directoryOrganization_acme", "client", "Client"),
  party("link-2", "directoryPerson_jane", "executor", "Executor"),
  party("link-3", "directoryPerson_jane", "beneficiary", "Beneficiary"),
];

describe("what the record already holds about an entity", () => {
  it("lists every role the entity holds, as readers see them, in the record's order", () => {
    expect(rolesAlreadyHeld(PARTIES, "directoryPerson_jane")).toEqual(["Executor", "Beneficiary"]);
  });

  it("is empty for an entity not on the record", () => {
    expect(rolesAlreadyHeld(PARTIES, "directoryPerson_nobody")).toEqual([]);
  });

  it("falls back to the stored role where no label was given", () => {
    expect(
      rolesAlreadyHeld([{ ...PARTIES[1]!, roleLabel: undefined }], "directoryPerson_jane"),
    ).toEqual(["executor"]);
  });

  it("refuses only the same entity in the same role", () => {
    expect(isRepeatLink(PARTIES, "directoryPerson_jane", "executor")).toBe(true);
    expect(isRepeatLink(PARTIES, "directoryPerson_jane", "witness")).toBe(false);
    expect(isRepeatLink(PARTIES, "directoryPerson_nobody", "executor")).toBe(false);
  });

  it("treats a second link as the repeat on a record whose links carry no role", () => {
    const unroled: RecordParty[] = [
      {
        identifier: "link-9",
        entityIdentifier: "directoryPerson_jane",
        name: "Jane",
        kind: "person",
      },
    ];
    expect(isRepeatLink(unroled, "directoryPerson_jane", null)).toBe(true);
    expect(isRepeatLink(unroled, "directoryPerson_kim", null)).toBe(false);
  });

  it("words what is held once, for one role and for several", () => {
    expect(alreadyHeldSentence([])).toBeNull();
    expect(alreadyHeldSentence(["Executor"])).toBe("Already on this record as Executor.");
    expect(alreadyHeldSentence(["Executor", "Beneficiary"])).toBe(
      "Already on this record as Executor and Beneficiary.",
    );
    expect(alreadyHeldSentence(["Executor", "Beneficiary", "Witness"])).toBe(
      "Already on this record as Executor, Beneficiary and Witness.",
    );
  });
});

describe("which tab a record with people on it opens on", () => {
  it("opens on the parties tab when the record carries somebody", () => {
    expect(openingTabForParties(1)).toBe(PARTIES_TAB_KEY);
  });

  it("leaves the choice alone when the record carries nobody", () => {
    expect(openingTabForParties(0)).toBeUndefined();
    expect(openingTabForParties(0, "history")).toBe("history");
  });
});

describe("the cascade the family depends on", () => {
  const stylesheet = readFileSync(join(PACKAGE_ROOT, "src/lib/styles/components.css"), "utf8");
  const positionOf = (recipe: string): number => {
    const at = stylesheet.indexOf(`/${recipe}.css"`);
    expect(at, `${recipe}.css is imported by components.css`).toBeGreaterThan(-1);
    return at;
  };

  it("imports the identity mark before the picker and the tab that render it", () => {
    expect(positionOf("entity-identity")).toBeLessThan(positionOf("entity-picker"));
    expect(positionOf("entity-identity")).toBeLessThan(positionOf("record-parties"));
  });

  it("imports the picker after the combobox it dresses, and the tab after the window it sits in", () => {
    expect(positionOf("combobox")).toBeLessThan(positionOf("entity-picker"));
    expect(positionOf("record-window")).toBeLessThan(positionOf("record-parties"));
    expect(positionOf("entity-picker")).toBeLessThan(positionOf("record-parties"));
  });
});
