import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.ts";
import { lookupDictionaryEntry } from "../src/dictionary.ts";
import { checkExpression } from "../src/expression/check.ts";
import { expressionScopeFor } from "../src/dictionary.ts";
import { NEUTRAL_PRONOUNS, PRONOUN_FORMS } from "../src/expression/pronoun.ts";
import { declensionFromColumns } from "../src/pronoun-bindings.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import { resolveMergeContext } from "../src/resolve.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// Pronouns in an assembled document.
//
// The property that matters is not that a recorded set renders — it is that EVERY OTHER CASE renders
// something a person can read and nobody is wronged by. A pronoun that comes out wrong is not a
// formatting defect; it is a filed document that misgenders someone, so the unrecorded case, the
// organisation case, and the ambiguous case all get the neutral set and none of them get a guess.

const MATTER_ID = "matter_TESTMATTER000000000" as MatterId;

const MATTER_ROW = {
  id: MATTER_ID,
  title: "In re Ashcroft",
  description: null,
  status: "open",
  location_id: null,
  client_display_name: "Rowan Ashcroft",
  client_code: "ASH-001",
  matter_number: "2026-0042",
  opened_at: "2026-02-01T09:00:00.000Z",
  e_billing: 0,
};

interface PartyRow {
  role: string;
  display_name: string | null;
  kind: string;
  pronoun_subject?: string | null;
  pronoun_object?: string | null;
  pronoun_possessive_determiner?: string | null;
  pronoun_possessive_pronoun?: string | null;
  pronoun_reflexive?: string | null;
  pronoun_verb_number?: string | null;
}

// A complete set, spelled out the way the write path stores one.
function stated(
  subject: string,
  object: string,
  possessiveDeterminer: string,
  possessivePronoun: string,
  reflexive: string,
  verbNumber: "singular" | "plural",
): Partial<PartyRow> {
  return {
    pronoun_subject: subject,
    pronoun_object: object,
    pronoun_possessive_determiner: possessiveDeterminer,
    pronoun_possessive_pronoun: possessivePronoun,
    pronoun_reflexive: reflexive,
    pronoun_verb_number: verbNumber,
  };
}

const SHE = stated("she", "her", "her", "hers", "herself", "singular");
const XE = stated("xe", "xem", "xyr", "xyrs", "xemself", "singular");

function recordingDatabase(parties: readonly PartyRow[]) {
  const database = {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement;
        },
        all: () =>
          Promise.resolve({ results: sql.includes("matter_party") ? parties : [MATTER_ROW] }),
      };
      return statement;
    },
  } as unknown as SqlDatabase;
  return database;
}

function manifestOf(keys: readonly string[]): FieldManifest {
  const fields: ManifestField[] = keys.map((key) => ({
    key,
    format: null,
    occurrences: 1,
    parts: ["word/document.xml"],
    forms: ["brace"],
  }));
  return {
    fields,
    totalOccurrences: fields.length,
    unconvertedMergeFields: [],
    legacyFormFields: [],
    unboundContentControls: [],
    blocks: [],
    computedFields: [],
  };
}

async function resolve(parties: readonly PartyRow[], keys: readonly string[]) {
  const result = await resolveMergeContext(recordingDatabase(parties), {
    matterId: MATTER_ID,
    firmName: "Riverside Law LLP",
    assembledAt: "2026-03-14T12:00:00.000Z",
    currencyCode: "USD",
    manifest: manifestOf(keys),
  });
  if (!result.ok) throw new Error(`resolution failed: ${result.detail}`);
  return result.context;
}

function readPackageOrThrow(bytes: Uint8Array) {
  const read = readPackage(bytes);
  if (!read.ok) throw new Error(read.detail);
  return read.value;
}

// The manifest normalization ACTUALLY produced, rather than one a test hand-fed. This is what proves
// the read plan: a template that calls the pronoun helper never writes the `pronouns` key on the
// page, so if the checker did not record it the party read would be planned without it and the
// document would silently print the neutral set for a person who stated one.
function registrationOf(document: string) {
  const result = normalizeTemplate(readPackageOrThrow(buildDocx({ document })));
  if (result.failures.length > 0) {
    throw new Error(result.failures.map((failure) => failure.detail).join("; "));
  }
  return result;
}

function registered(document: string): Uint8Array {
  const result = normalizeTemplate(readPackageOrThrow(buildDocx({ document })));
  if (result.failures.length > 0) {
    throw new Error(result.failures.map((failure) => failure.detail).join("; "));
  }
  return writePackage(result.parts);
}

function documentTextOf(bytes: Uint8Array): string {
  const xml = readPartText(readPackageOrThrow(bytes), "word/document.xml") ?? "";
  return xml.replace(/<[^>]+>/g, "");
}

async function assembledText(
  document: string,
  parties: readonly PartyRow[],
  keys: readonly string[],
): Promise<string> {
  const context = await resolve(parties, keys);
  const result = assemble(registered(document), context);
  if (!result.ok) throw new Error(`assembly failed: ${result.detail}`);
  return documentTextOf(result.bytes);
}

// ---------------------------------------------------------------------------------------------
// The stored shape
// ---------------------------------------------------------------------------------------------

describe("a stored pronoun set", () => {
  it("carries every grammatical position, so a template can render any of them", () => {
    const declension = declensionFromColumns({
      pronounSubject: "xe",
      pronounObject: "xem",
      pronounPossessiveDeterminer: "xyr",
      pronounPossessivePronoun: "xyrs",
      pronounReflexive: "xemself",
      pronounVerbNumber: "singular",
    });
    expect(declension).toEqual({
      subject: "xe",
      object: "xem",
      possessiveDeterminer: "xyr",
      possessivePronoun: "xyrs",
      reflexive: "xemself",
      agreement: "singular",
    });
  });

  // The reason the whole declension is stored rather than a label: nothing about "xe/xem" says the
  // reflexive is "xemself", so a label plus a table would either lack this set or render it wrong.
  it("holds a set no closed list of options would contain", async () => {
    const text = await assembledText(
      documentXml(
        paragraphOfRuns('{{= pronoun(client, "subject")}} represented '),
        paragraphOfRuns('{{= pronoun(client, "reflexive")}}.'),
      ),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person", ...XE }],
      ["client.pronouns"],
    );
    expect(text).toContain("xe represented");
    expect(text).toContain("xemself.");
  });

  // A row that somehow carries part of a set is NOT half a set. Mixing one set's subject with
  // another's object inside a sentence is invisible on the page and is the failure the field exists
  // to prevent, so a partial row reads as unrecorded and the neutral forms answer.
  it("is nothing at all when only some of it is recorded", () => {
    expect(
      declensionFromColumns({
        pronounSubject: "she",
        pronounObject: "her",
        pronounPossessiveDeterminer: null,
        pronounPossessivePronoun: null,
        pronounReflexive: null,
        pronounVerbNumber: "singular",
      }),
    ).toBeUndefined();
  });

  it("treats a blank string as unrecorded, not as an empty pronoun", () => {
    expect(
      declensionFromColumns({
        pronounSubject: "  ",
        pronounObject: "her",
        pronounPossessiveDeterminer: "her",
        pronounPossessivePronoun: "hers",
        pronounReflexive: "herself",
        pronounVerbNumber: "singular",
      }),
    ).toBeUndefined();
  });
});

describe("the read plan", () => {
  it("plans the party read from a template that only CALLS the helper", async () => {
    const registration = registrationOf(
      documentXml(paragraphOfRuns('{{= pronoun(client, "subject")}} appeared.')),
    );
    // The key is in the manifest even though it appears nowhere in the document's text.
    expect(registration.manifest.computedFields[0]?.keys).toEqual(["client.pronouns"]);

    const result = await resolveMergeContext(
      recordingDatabase([
        { role: "client", display_name: "Rowan Ashcroft", kind: "person", ...SHE },
      ]),
      {
        matterId: MATTER_ID,
        firmName: "Riverside Law LLP",
        assembledAt: "2026-03-14T12:00:00.000Z",
        currencyCode: "USD",
        manifest: registration.manifest,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reads).toContain("party");

    const assembled = assemble(writePackage(registration.parts), result.context);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(documentTextOf(assembled.bytes)).toContain("she appeared.");
  });
});

// ---------------------------------------------------------------------------------------------
// The unrecorded case, which is the common case
// ---------------------------------------------------------------------------------------------

describe("a person whose pronouns nobody recorded", () => {
  it("is written they/them rather than blank, marked, or guessed", async () => {
    const text = await assembledText(
      documentXml(
        paragraphOfRuns('{{= pronoun(client, "subject")}} signed '),
        paragraphOfRuns('{{= pronoun(client, "possessiveDeterminer")}} declaration.'),
      ),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person" }],
      ["client.pronouns"],
    );
    expect(text).toContain("they signed");
    expect(text).toContain("their declaration.");
    expect(text).not.toContain("[");
  });

  // The name is the one thing a pronoun must never be worked out from. "Rowan" tells us nothing, and
  // neither would a name that a reader would happily guess about.
  it("is written they/them however the person is named", async () => {
    for (const displayName of ["Rowan Ashcroft", "Elizabeth Marchetti", "Dr. Robert Vale"]) {
      const text = await assembledText(
        documentXml(paragraphOfRuns('{{= pronoun(client, "subject")}} appeared.')),
        [{ role: "client", display_name: displayName, kind: "person" }],
        ["client.pronouns"],
      );
      expect(text, displayName).toContain("they appeared.");
    }
  });

  // A courtesy title is a recorded fact about how someone is addressed, not a statement of pronouns.
  it("is written they/them for a person recorded with a gendered courtesy title", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns('{{= pronoun(client, "object")}}')),
      [{ role: "client", display_name: "Mrs. Elizabeth Marchetti", kind: "person" }],
      ["client.pronouns"],
    );
    expect(text).toContain("them");
  });

  it("prints nothing at all where the pronouns FIELD is named, rather than a marker", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns("Pronouns: {{client.pronouns}}|")),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person" }],
      ["client.pronouns"],
    );
    expect(text).toContain("Pronouns: |");
  });

  it("prints the stated set where the field IS recorded", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns("Pronouns: {{client.pronouns}}")),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person", ...SHE }],
      ["client.pronouns"],
    );
    expect(text).toContain("Pronouns: she/her");
  });

  it("is written they/them for an organisation, which has no pronouns to state", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns('{{= pronoun(opposingParty, "subject")}} filed.')),
      [{ role: "opposing_party", display_name: "Riverside Partners LLC", kind: "organisation" }],
      ["opposingParty.pronouns"],
    );
    expect(text).toContain("they filed.");
  });

  // Two clients means no single client to speak about. The neutral set names nobody, so the sentence
  // is not wrong about a person — and the ambiguity is still reported through the name key, which is
  // where a firm reads it.
  it("is written they/them when the matter resolves no single person in the role", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns('{{= pronoun(opposingParty, "subject")}} answered.')),
      [
        { role: "opposing_party", display_name: "Dana Okafor", kind: "person", ...SHE },
        { role: "opposing_party", display_name: "Elias Renn", kind: "person" },
      ],
      ["opposingParty.pronouns"],
    );
    expect(text).toContain("they answered.");
  });
});

// ---------------------------------------------------------------------------------------------
// Verb agreement
// ---------------------------------------------------------------------------------------------

describe("verb agreement", () => {
  // The helper never inflects: the author writes both forms, the recorded agreement picks one. That
  // is total for every verb in English, including the irregular ones a dictionary would get wrong.
  it("takes the singular form for a set that agrees singularly", async () => {
    const text = await assembledText(
      documentXml(
        paragraphOfRuns('{{= pronoun(client, "subject")}} '),
        paragraphOfRuns('{{= pronounVerb(client, "is", "are")}} the petitioner and '),
        paragraphOfRuns('{{= pronounVerb(client, "signs", "sign")}} below.'),
      ),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person", ...SHE }],
      ["client.pronouns"],
    );
    expect(text).toContain("she is the petitioner and signs below.");
  });

  it("takes the plural form for singular they, which is the whole difficulty", async () => {
    const text = await assembledText(
      documentXml(
        paragraphOfRuns('{{= pronoun(client, "subject")}} '),
        paragraphOfRuns('{{= pronounVerb(client, "is", "are")}} the petitioner and '),
        paragraphOfRuns('{{= pronounVerb(client, "signs", "sign")}} below.'),
      ),
      [
        {
          role: "client",
          display_name: "Rowan Ashcroft",
          kind: "person",
          ...stated("they", "them", "their", "theirs", "themself", "plural"),
        },
      ],
      ["client.pronouns"],
    );
    expect(text).toContain("they are the petitioner and sign below.");
  });

  it("takes the plural form for a person who stated nothing, matching the neutral set", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns('{{= pronounVerb(client, "has", "have")}} appeared.')),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person" }],
      ["client.pronouns"],
    );
    expect(text).toContain("have appeared.");
  });

  // A neopronoun set that agrees singularly proves the flag is stored rather than derived: nothing
  // about the letters of "xe" distinguishes it from "they".
  it("takes the singular form for a neopronoun set that agrees singularly", async () => {
    const text = await assembledText(
      documentXml(paragraphOfRuns('{{= pronounVerb(client, "was", "were")}} served.')),
      [{ role: "client", display_name: "Rowan Ashcroft", kind: "person", ...XE }],
      ["client.pronouns"],
    );
    expect(text).toContain("was served.");
  });
});

// ---------------------------------------------------------------------------------------------
// What the checker refuses, while an author is still looking at the template
// ---------------------------------------------------------------------------------------------

describe("the checker", () => {
  const scope = expressionScopeFor();
  const checkOf = (source: string) =>
    checkExpression(source, { scope, required: "formattableScalar", format: null });

  it("accepts a person subject the firm's fields can name", () => {
    const outcome = checkOf('pronoun(client, "reflexive")');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The subject's pronoun key joins the read plan, so the party read is planned before any XML is
    // touched — the batching rule applied to a helper that never prints the key.
    expect(outcome.value.keys).toEqual(["client.pronouns"]);
    expect(outcome.value.resultType).toBe("text");
  });

  it("refuses a subject the firm's fields cannot name, and lists the ones they can", () => {
    const outcome = checkOf('pronoun(defendant, "subject")');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe("expression-unknown-key");
    expect(outcome.failure.detail).toContain("client");
  });

  it("refuses a misspelled grammatical position rather than leaving it to assembly", () => {
    const outcome = checkOf('pronoun(client, "possessive")');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.detail).toContain("possessiveDeterminer");
  });

  it("refuses a computed subject, because a pronoun is a fact about WHOSE it is", () => {
    const outcome = checkOf('pronoun(upper(client.displayName), "subject")');
    expect(outcome.ok).toBe(false);
  });

  it("refuses a computed grammatical position, so a typo cannot reach a filed page", () => {
    const outcome = checkOf("pronoun(client, matter.title)");
    expect(outcome.ok).toBe(false);
  });

  it("accepts every position the language declares", () => {
    for (const form of PRONOUN_FORMS) {
      expect(checkOf(`pronoun(client, "${form}")`).ok, form).toBe(true);
    }
  });

  it("names the member subjects as well as the party subjects", () => {
    expect(checkOf('pronoun(responsibleAttorney, "possessivePronoun")').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

describe("the pronouns field", () => {
  it("is blank when unrecorded on every subject that carries it, never a marker", () => {
    for (const subject of ["client", "opposingParty", "witness", "responsibleAttorney"]) {
      const entry = lookupDictionaryEntry(`${subject}.pronouns`);
      expect(entry, subject).toBeDefined();
      expect(entry?.absence, subject).toBe("blank");
      expect(entry?.sensitivity, subject).toBe("ordinary");
    }
  });

  it("declares the neutral set as the plural-agreeing they/them", () => {
    expect(NEUTRAL_PRONOUNS).toEqual({
      subject: "they",
      object: "them",
      possessiveDeterminer: "their",
      possessivePronoun: "theirs",
      reflexive: "themselves",
      agreement: "plural",
    });
  });
});
