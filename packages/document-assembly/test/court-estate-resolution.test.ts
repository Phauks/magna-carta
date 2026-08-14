import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import { resolveMergeContext } from "../src/resolve.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// The court and estate sources, and the capacity line that composes across them. The court-case
// record supplies WHERE and WHAT the case is; the estate record supplies the estate's stored
// styles and the decedent's name parts; and the capacity line is composed IN THE RESOLVER from the
// party's name, the recorded capacity, and the estate style — one absence for the whole phrase
// when any part is missing, never three markers and stray punctuation.

const MATTER_ID = "matter_TESTMATTER000000000" as MatterId;

const MATTER_ROW = {
  id: MATTER_ID,
  title: "Estate of Rowan Ashcroft",
  description: null,
  status: "open",
  location_id: null,
  client_display_name: "Devon Marchetti",
  client_code: null,
  matter_number: "2026-0142",
  opened_at: "2026-02-01T09:00:00.000Z",
  e_billing: 0,
};

const COURT_CASE_ROW = {
  court_name: "Second Judicial District Court",
  case_number: "PR26-00381",
  division: "Probate Division",
  department: "Department 6",
  filed_on: "2026-04-09",
  client_designation: "Petitioner",
  opposing_designation: "Respondent",
  judge_display_name: "Mira Calloway",
  judge_name_prefix: "Hon.",
  judge_name_given: "Mira",
  judge_name_middle: null,
  judge_name_family: "Calloway",
  judge_name_suffix: null,
};

const ESTATE_ROW = {
  estate_style: "the Estate of Rowan Ashcroft, Deceased",
  short_style: "the Ashcroft Estate",
  date_of_death: "2026-01-17",
  proceeding_type: "intestate",
  letters_issued_on: "2026-03-02",
  decedent_display_name: "Rowan Ashcroft",
  decedent_name_prefix: "Dr.",
  decedent_name_given: "Rowan",
  decedent_name_middle: "Tobias",
  decedent_name_family: "Ashcroft",
  decedent_name_suffix: null,
};

interface PartyRow {
  role: string;
  display_name: string | null;
  capacity?: string | null;
  kind: string;
}

interface Fixtures {
  parties?: readonly PartyRow[];
  courtCase?: boolean;
  estate?: boolean;
}

function recordingDatabase(fixtures: Fixtures) {
  const reads: { sql: string; bindings: readonly unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        bind(...bindings: unknown[]) {
          reads.push({ sql, bindings });
          return statement;
        },
        all: () =>
          Promise.resolve({
            results: sql.includes("matter_court_case")
              ? fixtures.courtCase === true
                ? [COURT_CASE_ROW]
                : []
              : sql.includes("matter_estate")
                ? fixtures.estate === true
                  ? [ESTATE_ROW]
                  : []
                : sql.includes("matter_party")
                  ? (fixtures.parties ?? [])
                  : [MATTER_ROW],
          }),
      };
      return statement;
    },
  } as unknown as SqlDatabase;
  return { database, reads };
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
    blocks: [],
    computedFields: [],
  };
}

const input = {
  matterId: MATTER_ID,
  firmName: "Marchetti & Vale LLP",
  assembledAt: "2026-08-07T12:00:00.000Z",
  currencyCode: "USD",
};

async function resolve(fixtures: Fixtures, keys: readonly string[]) {
  const { database, reads } = recordingDatabase(fixtures);
  const result = await resolveMergeContext(database, { ...input, manifest: manifestOf(keys) });
  if (!result.ok) throw new Error(`resolution failed: ${result.detail}`);
  return { context: result.context, sources: result.reads, reads };
}

// ---------------------------------------------------------------------------------------------
// The court and case subjects
// ---------------------------------------------------------------------------------------------

describe("the court and case subjects", () => {
  it("fills both subjects from the one court-case read", async () => {
    const { context, reads } = await resolve({ courtCase: true }, [
      "court.name",
      "court.judge",
      "case.number",
      "case.filedOn",
      "case.division",
      "case.department",
      "case.clientDesignation",
      "case.opposingDesignation",
    ]);
    expect(reads).toHaveLength(1);
    expect(context.values.get("court.name")).toEqual({
      kind: "text",
      text: "Second Judicial District Court",
    });
    expect(context.values.get("court.judge")).toEqual({
      kind: "name",
      display: "Mira Calloway",
      isOrganisation: false,
      prefix: "Hon.",
      given: "Mira",
      family: "Calloway",
    });
    expect(context.values.get("case.number")).toEqual({ kind: "text", text: "PR26-00381" });
    expect(context.values.get("case.filedOn")).toEqual({ kind: "date", isoDate: "2026-04-09" });
    expect(context.values.get("case.clientDesignation")).toEqual({
      kind: "text",
      text: "Petitioner",
    });
    expect(context.values.get("case.opposingDesignation")).toEqual({
      kind: "text",
      text: "Respondent",
    });
  });

  it("treats a matter with no court case as a conditional absence, not a defect", async () => {
    const { context } = await resolve({}, ["case.number", "court.name"]);
    expect(context.absentKeys).toEqual(["case.number", "court.name"]);
    expect([...context.absenceReasons.keys()]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The estate subject
// ---------------------------------------------------------------------------------------------

describe("the estate subject", () => {
  it("fills every estate key from the one estate read, with the decedent as a name with parts", async () => {
    const { context, reads } = await resolve({ estate: true }, [
      "estate.style",
      "estate.shortStyle",
      "estate.decedent",
      "estate.dateOfDeath",
      "estate.proceedingType",
      "estate.lettersIssuedOn",
    ]);
    expect(reads).toHaveLength(1);
    expect(context.values.get("estate.style")).toEqual({
      kind: "text",
      text: "the Estate of Rowan Ashcroft, Deceased",
    });
    expect(context.values.get("estate.shortStyle")).toEqual({
      kind: "text",
      text: "the Ashcroft Estate",
    });
    expect(context.values.get("estate.decedent")).toEqual({
      kind: "name",
      display: "Rowan Ashcroft",
      isOrganisation: false,
      prefix: "Dr.",
      given: "Rowan",
      middle: "Tobias",
      family: "Ashcroft",
    });
    expect(context.values.get("estate.dateOfDeath")).toEqual({
      kind: "date",
      isoDate: "2026-01-17",
    });
  });

  it("treats a matter with no estate record as a conditional absence", async () => {
    const { context } = await resolve({}, ["estate.style", "estate.decedent"]);
    expect(context.absentKeys).toEqual(["estate.decedent", "estate.style"]);
  });
});

// ---------------------------------------------------------------------------------------------
// The capacity facet and the composed capacity line
// ---------------------------------------------------------------------------------------------

describe("capacity and the composed capacity line", () => {
  const ADMINISTRATOR: PartyRow = {
    role: "client",
    display_name: "Devon Marchetti",
    capacity: "Administrator",
    kind: "person",
  };

  it("resolves the recorded capacity as its own facet", async () => {
    const { context } = await resolve({ parties: [ADMINISTRATOR] }, ["client.capacity"]);
    expect(context.values.get("client.capacity")).toEqual({
      kind: "text",
      text: "Administrator",
    });
  });

  it("composes the whole phrase in the resolver when every part is recorded", async () => {
    const { context } = await resolve({ parties: [ADMINISTRATOR], estate: true }, [
      "client.capacityLine",
    ]);
    expect(context.values.get("client.capacityLine")).toEqual({
      kind: "text",
      text: "Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased",
    });
  });

  it("answers a missing part with ONE absence for the whole phrase, naming the part", async () => {
    const { context } = await resolve(
      { parties: [{ ...ADMINISTRATOR, capacity: null }], estate: true },
      ["client.capacityLine"],
    );
    expect(context.values.has("client.capacityLine")).toBe(false);
    const reason = context.absenceReasons.get("client.capacityLine");
    expect(reason).toContain("capacity on the party link");
    expect(reason).not.toContain("estate style");
  });

  it("names every missing part when the whole matter records none of them", async () => {
    // The three-part absence case — what a hand-written template would render as
    // ", as  of " with three separate markers and stray punctuation. Composed in the resolver, it
    // is one marker and one sentence naming all three gaps.
    const { context } = await resolve(
      { parties: [{ role: "client", display_name: null, capacity: null, kind: "unknown" }] },
      ["client.capacityLine"],
    );
    expect(context.values.has("client.capacityLine")).toBe(false);
    const reason = context.absenceReasons.get("client.capacityLine");
    expect(reason).toContain("the party's name");
    expect(reason).toContain("a capacity on the party link");
    expect(reason).toContain("an estate style on the matter");
  });

  it("stays one marker end to end — the assembled document never prints stray punctuation", async () => {
    const built = buildDocx({
      document: documentXml(paragraphOfRuns("{{client.capacityLine}}")),
    });
    const readResult = readPackage(built);
    if (!readResult.ok) throw new Error(readResult.detail);
    const normalized = normalizeTemplate(readResult.value);
    expect(normalized.failures).toEqual([]);
    const registered = writePackage(normalized.parts);

    const { context } = await resolve(
      { parties: [{ ...ADMINISTRATOR, capacity: null }], estate: true },
      ["client.capacityLine"],
    );
    const merged = assemble(registered, context);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const output = readPackage(merged.bytes);
    if (!output.ok) throw new Error(output.detail);
    const text = readPartText(output.value, "word/document.xml") ?? "";
    // One marker, spelled from the entry's label (apostrophe XML-escaped in the raw part) — and
    // none of the fragments a template-side concatenation would leave behind.
    expect(text).toContain("[CLIENT&apos;S CAPACITY LINE]");
    expect(text).not.toContain(", as ");
  });
});
