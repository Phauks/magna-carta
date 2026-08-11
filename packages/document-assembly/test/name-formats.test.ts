import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.ts";
import { formatMergeValue, legalFormatsFor, renderingAbsenceReason } from "../src/format.ts";
import { partyNameValue } from "../src/directory-role-bindings.ts";
import type { MergeContext, MergeValue } from "../src/types.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// The structured `name` value type, and the rule that decides what a format may do.
//
// A FORMAT CAN ONLY RENDER WHAT THE VALUE CARRIES. That is why a name is parts rather than a string:
// "Ashcroft, Rowan" is not derivable from "Rowan Ashcroft", and the two properties this file exists to
// hold are the two halves of that sentence —
//
//   1. THE DEFAULT RENDERING IS BYTE-IDENTICAL to the string the key printed before it carried parts.
//      A firm that has filed two years of letters must not get different documents because the value
//      type widened underneath them.
//   2. A RENDERING THE RECORD CANNOT SUPPORT IS A DECLARED ABSENCE WITH A REASON, never a fallback to a
//      different rendering. A document that quietly printed the whole name where a surname was asked
//      for looks finished and is wrong in a way nobody catches by reading it.

const OPTIONS = { timeZone: "UTC" } as const;

const FULLY_RECORDED: MergeValue = {
  kind: "name",
  display: "Rowan Ashcroft",
  prefix: "Dr.",
  given: "Rowan",
  middle: "Tobias",
  family: "Ashcroft",
  suffix: "Jr.",
  isOrganisation: false,
};

// What the matter's own row supplies: a display string and nothing else. The client's name arrives this
// way on every assembly that does not read the party collection.
const DISPLAY_ONLY: MergeValue = { kind: "name", display: "Rowan Ashcroft" };

const ORGANISATION: MergeValue = {
  kind: "name",
  display: "Riverside Partners LLC",
  isOrganisation: true,
};

describe("the name format table", () => {
  it("renders every declared format from a fully recorded person", () => {
    expect(formatMergeValue(FULLY_RECORDED, "full", OPTIONS)).toBe("Rowan Ashcroft");
    expect(formatMergeValue(FULLY_RECORDED, "formal", OPTIONS)).toBe("Dr. Rowan T. Ashcroft Jr.");
    expect(formatMergeValue(FULLY_RECORDED, "lastFirst", OPTIONS)).toBe("Ashcroft, Rowan");
    expect(formatMergeValue(FULLY_RECORDED, "initials", OPTIONS)).toBe("R.T.A.");
    expect(formatMergeValue(FULLY_RECORDED, "family", OPTIONS)).toBe("Ashcroft");
    expect(formatMergeValue(FULLY_RECORDED, "given", OPTIONS)).toBe("Rowan");
    expect(formatMergeValue(FULLY_RECORDED, "upper", OPTIONS)).toBe("ROWAN ASHCROFT");
  });

  it("leaves out a part the record does not carry rather than inventing one", () => {
    const noMiddle: MergeValue = { ...FULLY_RECORDED, middle: undefined, suffix: undefined };
    expect(formatMergeValue(noMiddle, "formal", OPTIONS)).toBe("Dr. Rowan Ashcroft");
    expect(formatMergeValue(noMiddle, "initials", OPTIONS)).toBe("R.A.");
  });

  it("declares a format for every rendering the table lists, and no rendering the table omits", () => {
    for (const format of legalFormatsFor("name")) {
      expect(formatMergeValue(FULLY_RECORDED, format, OPTIONS), format).toBeTruthy();
    }
    expect(legalFormatsFor("name")[0]).toBe("full");
  });
});

// The property the whole widening rests on. `full` is what `displayName` rendered when it was a plain
// text key, and it is what it renders now — for a person, for an organisation, and for a record that
// separates out no parts at all.
describe("the default rendering is byte-identical to the string the key always printed", () => {
  it.each([
    ["a fully recorded person", FULLY_RECORDED, "Rowan Ashcroft"],
    ["a record with only a display name", DISPLAY_ONLY, "Rowan Ashcroft"],
    ["an organisation", ORGANISATION, "Riverside Partners LLC"],
  ])("prints %s exactly as recorded", (_case, value, expected) => {
    expect(formatMergeValue(value, "full", OPTIONS)).toBe(expected);
    // And identically to what the plain-text rendering of the same recorded string produces, which is
    // the comparison that makes "byte-identical" mean something rather than restating the constant.
    expect(formatMergeValue(value, "full", OPTIONS)).toBe(
      formatMergeValue({ kind: "text", text: expected }, "plain", OPTIONS),
    );
  });
});

describe("a rendering the record cannot support is an absence with a reason", () => {
  it.each(["lastFirst", "initials", "family", "given"])(
    "refuses %s on a record that separates out no parts, naming the missing part",
    (format) => {
      expect(formatMergeValue(DISPLAY_ONLY, format, OPTIONS)).toBeUndefined();
      const reason = renderingAbsenceReason(DISPLAY_ONLY, format);
      expect(reason).toBeTruthy();
      expect(reason).toContain("no");
      expect(reason).toContain("recorded separately");
      // Never the fallback: the reason exists precisely because the whole display name would have
      // looked plausible in its place.
      expect(reason).not.toContain("Rowan Ashcroft");
    },
  );

  it.each(["lastFirst", "initials", "family", "given"])(
    "refuses %s on an organisation, and says it is an organisation",
    (format) => {
      expect(formatMergeValue(ORGANISATION, format, OPTIONS)).toBeUndefined();
      expect(renderingAbsenceReason(ORGANISATION, format)).toContain("organisation");
    },
  );

  it("renders full, formal, and upper for an organisation rather than refusing them", () => {
    expect(formatMergeValue(ORGANISATION, "full", OPTIONS)).toBe("Riverside Partners LLC");
    expect(formatMergeValue(ORGANISATION, "formal", OPTIONS)).toBe("Riverside Partners LLC");
    expect(formatMergeValue(ORGANISATION, "upper", OPTIONS)).toBe("RIVERSIDE PARTNERS LLC");
    for (const format of ["full", "formal", "upper"]) {
      expect(renderingAbsenceReason(ORGANISATION, format), format).toBeUndefined();
    }
  });

  it("says nothing about a rendering that worked", () => {
    expect(renderingAbsenceReason(FULLY_RECORDED, "lastFirst")).toBeUndefined();
    expect(renderingAbsenceReason({ kind: "text", text: "anything" }, "upper")).toBeUndefined();
  });
});

describe("the party read supplies the parts", () => {
  it("carries the recorded parts through from the row the party read already returns", () => {
    expect(
      partyNameValue({
        displayName: "Rowan Ashcroft",
        role: "witness",
        capacity: null,
        kind: "person",
        entityId: "directoryPerson_AAAAAAAAAAAAAAAAAAAAA",
        namePrefix: "Dr.",
        nameGiven: "Rowan",
        nameMiddle: null,
        nameFamily: "Ashcroft",
        nameSuffix: null,
        pronounSubject: null,
        pronounObject: null,
        pronounPossessiveDeterminer: null,
        pronounPossessivePronoun: null,
        pronounReflexive: null,
        pronounVerbNumber: null,
      }),
    ).toEqual({
      kind: "name",
      display: "Rowan Ashcroft",
      isOrganisation: false,
      prefix: "Dr.",
      given: "Rowan",
      family: "Ashcroft",
    });
  });

  it("records nothing about person-or-organisation when the Directory entry behind the link is gone", () => {
    const value = partyNameValue({
      displayName: "A name the link still carries",
      role: "witness",
      capacity: null,
      kind: "unknown",
      entityId: "directoryPerson_AAAAAAAAAAAAAAAAAAAAA",
      namePrefix: null,
      nameGiven: null,
      nameMiddle: null,
      nameFamily: null,
      nameSuffix: null,
      pronounSubject: null,
      pronounObject: null,
      pronounPossessiveDeterminer: null,
      pronounPossessivePronoun: null,
      pronounReflexive: null,
      pronounVerbNumber: null,
    });
    expect(value).toEqual({ kind: "name", display: "A name the link still carries" });
  });
});

// The end of the chain: a template that asks for a rendering the firm's record cannot produce gets a
// visible marker AND the sentence that says what to do about it, in the absence list the caller shows.
describe("a document asking for an unsupportable rendering", () => {
  function templateBytes(text: string): Uint8Array {
    const read = readPackage(buildDocx({ document: documentXml(paragraphOfRuns(text)) }));
    if (!read.ok) throw new Error(`fixture unreadable: ${read.reason}`);
    const normalized = normalizeTemplate(read.value);
    if (normalized.failures.length > 0) {
      throw new Error(`fixture failed normalization: ${JSON.stringify(normalized.failures)}`);
    }
    return writePackage(normalized.parts);
  }

  it("shows the marker and reports the reason naming the missing part", () => {
    const context: MergeContext = {
      values: new Map<string, MergeValue>([["client.displayName", DISPLAY_ONLY]]),
      absentKeys: [],
      absenceReasons: new Map(),
      timeZone: "UTC",
    };
    const result = assemble(templateBytes("Filed by {{client.displayName:lastFirst}}"), context);
    // `client.displayName` is the one entry declared `fail`, so an unrenderable value stops the
    // assembly rather than filing a retainer that names nobody.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-required-field");
    expect(result.keys).toEqual(["client.displayName"]);
  });

  it("reports the reason as an absence when the field is not required", () => {
    const result = assemble(templateBytes("Served on {{witness.displayName:family}}"), {
      values: new Map<string, MergeValue>([
        ["witness.displayName", { kind: "name", display: "Dana Okafor" }],
      ]),
      absentKeys: [],
      absenceReasons: new Map(),
      timeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const produced = readPackage(result.bytes);
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    expect(readPartText(produced.value, "word/document.xml")).toContain("[WITNESS&apos;S NAME]");
    expect(result.absences).toHaveLength(1);
    expect(result.absences[0]?.key).toBe("witness.displayName");
    expect(result.absences[0]?.rendered).toBe("placeholder");
    expect(result.absences[0]?.reason).toContain("family name");
  });
});
