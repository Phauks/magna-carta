import { describe, expect, it } from "vitest";
import { assemble, packageIntegrityViolations } from "../src/assemble.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import type { MergeContext, MergeValue } from "../src/types.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// Two fixture templates in the shapes the profession actually files: a pleading caption and a
// probate petition opening. Each registers through the real normalization pass and assembles
// against a fully recorded context, and each is asserted over the EMITTED PARTS — the text of the
// rewritten document.xml and the package-integrity check — because a document that looks right in a
// string assertion and will not open in Word is the failure this engine exists to prevent.

function registeredTemplate(document: string): Uint8Array {
  const read = readPackage(buildDocx({ document }));
  if (!read.ok) throw new Error(read.detail);
  const normalized = normalizeTemplate(read.value);
  if (normalized.failures.length > 0) {
    throw new Error(normalized.failures.map((failure) => failure.detail).join("; "));
  }
  return writePackage(normalized.parts);
}

function contextOf(values: Record<string, MergeValue>): MergeContext {
  return {
    values: new Map(Object.entries(values)),
    absentKeys: [],
    absenceReasons: new Map(),
    timeZone: "America/Los_Angeles",
  };
}

const text = (value: string): MergeValue => ({ kind: "text", text: value });

describe("the pleading-caption fixture", () => {
  // The shape a caption actually takes: the court's name, the two designation words as THIS court
  // uses them, the case number, and the client's name in the caption's upper rendering.
  const caption = registeredTemplate(
    documentXml(
      paragraphOfRuns("IN THE {{court.name:upper}}"),
      paragraphOfRuns("{{client.displayName:upper}}, {{case.clientDesignation}},"),
      paragraphOfRuns("v."),
      paragraphOfRuns("{{opposingParty.displayName:upper}}, {{case.opposingDesignation}}."),
      paragraphOfRuns("Case No. {{case.number}} - Dept. {{case.department}}"),
    ),
  );

  it("assembles a caption from the recorded designations, never from a guessed side", () => {
    const result = assemble(
      caption,
      contextOf({
        "court.name": text("Second Judicial District Court"),
        "client.displayName": {
          kind: "name",
          display: "Devon Marchetti",
          given: "Devon",
          family: "Marchetti",
          isOrganisation: false,
        },
        "opposingParty.displayName": {
          kind: "name",
          display: "Halverson Mills LLC",
          isOrganisation: true,
        },
        "case.clientDesignation": text("Petitioner"),
        "case.opposingDesignation": text("Respondent"),
        "case.number": text("PR26-00381"),
        "case.department": text("Department 6"),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absences).toEqual([]);
    const output = readPackage(result.bytes);
    if (!output.ok) throw new Error(output.detail);
    expect(packageIntegrityViolations(output.value)).toEqual([]);
    const documentText = (readPartText(output.value, "word/document.xml") ?? "").replace(
      /<[^>]*>/g,
      "",
    );
    expect(documentText).toContain("IN THE SECOND JUDICIAL DISTRICT COURT");
    // The `upper` name rendering — the caption form — applies to a person and an organisation
    // alike, from the same key the letter body writes in its default rendering.
    expect(documentText).toContain("DEVON MARCHETTI, Petitioner,");
    expect(documentText).toContain("HALVERSON MILLS LLC, Respondent.");
    expect(documentText).toContain("Case No. PR26-00381");
  });

  it("shows the case-number marker on a draft prepared before filing", () => {
    const result = assemble(
      caption,
      contextOf({
        "court.name": text("Second Judicial District Court"),
        "client.displayName": { kind: "name", display: "Devon Marchetti" },
        "opposingParty.displayName": { kind: "name", display: "Halverson Mills LLC" },
        "case.clientDesignation": text("Petitioner"),
        "case.opposingDesignation": text("Respondent"),
        "case.department": text("Department 6"),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absences.map((absence) => absence.key)).toContain("case.number");
    const output = readPackage(result.bytes);
    if (!output.ok) throw new Error(output.detail);
    const documentText = (readPartText(output.value, "word/document.xml") ?? "").replace(
      /<[^>]*>/g,
      "",
    );
    expect(documentText).toContain("Case No. [CASE NUMBER]");
  });
});

describe("the probate-petition fixture", () => {
  // The estate's stored style, the decedent's name in three renderings, and the composed capacity
  // line — the opening a probate petition actually prints.
  const petition = registeredTemplate(
    documentXml(
      paragraphOfRuns("In the Matter of {{estate.style}}"),
      paragraphOfRuns(
        "The decedent, {{estate.decedent}}, also written {{estate.decedent:lastFirst}} and {{estate.decedent:upper}}, died on {{estate.dateOfDeath:legal}}.",
      ),
      paragraphOfRuns("Petitioner: {{client.capacityLine}}."),
    ),
  );

  const DECEDENT: MergeValue = {
    kind: "name",
    display: "Rowan Ashcroft",
    prefix: "Dr.",
    given: "Rowan",
    middle: "Tobias",
    family: "Ashcroft",
    isOrganisation: false,
  };

  it("prints the stored style, three renderings of one decedent, and one composed capacity line", () => {
    const result = assemble(
      petition,
      contextOf({
        "estate.style": text("the Estate of Rowan Ashcroft, Deceased"),
        "estate.decedent": DECEDENT,
        "estate.dateOfDeath": { kind: "date", isoDate: "2026-01-17" },
        "client.capacityLine": text(
          "Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased",
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absences).toEqual([]);
    const output = readPackage(result.bytes);
    if (!output.ok) throw new Error(output.detail);
    expect(packageIntegrityViolations(output.value)).toEqual([]);
    const documentText = (readPartText(output.value, "word/document.xml") ?? "").replace(
      /<[^>]*>/g,
      "",
    );
    expect(documentText).toContain("In the Matter of the Estate of Rowan Ashcroft, Deceased");
    expect(documentText).toContain(
      "The decedent, Rowan Ashcroft, also written Ashcroft, Rowan and ROWAN ASHCROFT, died on the 17th day of January, 2026.",
    );
    expect(documentText).toContain(
      "Petitioner: Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased.",
    );
  });

  it("refuses no rendering silently: a decedent recorded without parts is a marked gap, not a fallback", () => {
    const result = assemble(
      petition,
      contextOf({
        "estate.style": text("the Estate of Rowan Ashcroft, Deceased"),
        "estate.decedent": { kind: "name", display: "Rowan Ashcroft" },
        "estate.dateOfDeath": { kind: "date", isoDate: "2026-01-17" },
        "client.capacityLine": text(
          "Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased",
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The default rendering still prints; the surname-first rendering is a declared absence with a
    // reason naming the missing part — never the whole name where a surname was asked for.
    const lastFirst = result.absences.find(
      (absence) => absence.key === "estate.decedent" && absence.reason !== undefined,
    );
    expect(lastFirst?.reason).toContain("family name");
    const output = readPackage(result.bytes);
    if (!output.ok) throw new Error(output.detail);
    const documentText = (readPartText(output.value, "word/document.xml") ?? "").replace(
      /<[^>]*>/g,
      "",
    );
    // The apostrophe arrives XML-escaped in the raw part text.
    expect(documentText).toContain(
      "The decedent, Rowan Ashcroft, also written [DECEDENT&apos;S NAME]",
    );
  });
});
