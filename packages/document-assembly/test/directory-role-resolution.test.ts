import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.ts";
import { DICTIONARY, lookupDictionaryEntry } from "../src/dictionary.ts";
import {
  DIRECTORY_ROLE_SOURCES,
  directoryRoleKeysFor,
  normalizedRoleToken,
} from "../src/directory-role-bindings.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, writePackage } from "../src/ooxml/package.ts";
import { resolveMergeContext } from "../src/resolve.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// The Directory role sources: the opposing party, opposing counsel, and the other roles a matter's
// party links model, read the way `client.*` is read.
//
// Two properties are load-bearing here and neither is visible from a single happy-path assertion. The
// first is that AMBIGUITY IS AN ANSWER: a matter with two parties in one role resolves the singular
// keys to nothing, with a reason naming how many candidates there were, rather than quietly picking the
// first. The second is that every role is answered from the ONE party read the merge context already
// issues — the batching rule applied to the source that most invites a query per role.

const MATTER_ID = "matter_TESTMATTER000000000" as MatterId;

const MATTER_ROW = {
  id: MATTER_ID,
  title: "Acme Holdings v. Riverside",
  description: null,
  status: "open",
  location_id: null,
  client_display_name: "Acme Holdings LLC",
  client_code: "ACME-001",
  matter_number: "2026-0042",
  opened_at: "2026-02-01T09:00:00.000Z",
  e_billing: 0,
};

interface PartyRow {
  role: string;
  display_name: string | null;
  kind: string;
}

function recordingDatabase(parties: readonly PartyRow[]) {
  const reads: { sql: string; bindings: readonly unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        bind(...bindings: unknown[]) {
          reads.push({ sql, bindings });
          return statement;
        },
        all: () =>
          Promise.resolve({ results: sql.includes("matter_party") ? parties : [MATTER_ROW] }),
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
  firmName: "Riverside Law LLP",
  assembledAt: "2026-03-14T12:00:00.000Z",
  currencyCode: "USD",
};

async function resolve(parties: readonly PartyRow[], keys: readonly string[]) {
  const { database, reads } = recordingDatabase(parties);
  const result = await resolveMergeContext(database, { ...input, manifest: manifestOf(keys) });
  if (!result.ok) throw new Error(`resolution failed: ${result.detail}`);
  return { context: result.context, sources: result.reads, reads };
}

// ---------------------------------------------------------------------------------------------
// The dictionary the roles contribute
// ---------------------------------------------------------------------------------------------

describe("the Directory role sources as dictionary entries", () => {
  it("puts every role's three keys in the shipped dictionary, all on the party read", () => {
    for (const source of DIRECTORY_ROLE_SOURCES) {
      for (const key of directoryRoleKeysFor(source)) {
        const entry = lookupDictionaryEntry(key);
        expect(entry, key).toBeDefined();
        expect(entry?.source, key).toBe("party");
        expect(entry?.sensitivity, key).toBe("ordinary");
      }
    }
  });

  // The role a party is stored under is free text, and the merge key is matched against it by
  // normalization — so two sources whose keys normalize alike would both claim the same links and one of
  // them would silently never resolve. There is no way to see that from either entry on its own.
  it("gives no two roles the same normalized token", () => {
    const tokens = DIRECTORY_ROLE_SOURCES.map((source) => normalizedRoleToken(source.key));
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) expect(token.length).toBeGreaterThan(0);
  });

  it("declares the singular keys as visible markers and each collection as a blank", () => {
    // Pronouns are the one deliberate exception, and it is named rather than folded into the loop.
    // Most people never state a set, so a marker would put "[CLIENT PRONOUNS]" on the face of every
    // ordinary letter and teach a firm that markers are noise — which is the failure the marker rule
    // exists to prevent, arrived at from the other side. The pronoun helpers, not this key, are
    // where an unstated set gets an answer.
    const BLANK_BY_DESIGN = new Set(["pronouns"]);
    for (const source of DIRECTORY_ROLE_SOURCES) {
      for (const facet of source.scalarFacets) {
        expect(lookupDictionaryEntry(`${source.key}.${facet}`)?.absence, source.key).toBe(
          BLANK_BY_DESIGN.has(facet) ? "blank" : "placeholder",
        );
      }
      // An empty collection is the correct document, not a hole in one: a repeat over no opposing
      // parties produces nothing, exactly as `matter.parties` does on a matter with no links.
      expect(lookupDictionaryEntry(`${source.key}.all`)?.absence).toBe("blank");
      expect(lookupDictionaryEntry(`${source.key}.all`)?.valueType).toBe("list");
    }
  });

  // The one party subject whose name the party read does NOT answer: the matter's own row carries its
  // client's display name, so the client party costs no second read — and a template naming only the
  // client's name must therefore not drag one in. Its absence is the shipped `fail` where every sibling
  // shows a marker, because a retainer agreement naming no client is not a document at all.
  it("leaves the client's name to the matter read, with its stricter absence kept", () => {
    const client = DIRECTORY_ROLE_SOURCES.find((source) => source.key === "client");
    expect(client).toBeDefined();
    expect(client?.scalarFacets).not.toContain("displayName");
    expect(directoryRoleKeysFor(client!)).not.toContain("client.displayName");
    expect(lookupDictionaryEntry("client.displayName")?.absence).toBe("fail");
    expect(lookupDictionaryEntry("client.displayName")?.source).toBe("party");
  });

  it("keeps the shipped dictionary free of duplicate keys once the roles are folded in", () => {
    const keys = DICTIONARY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

describe("resolving a single party in a role", () => {
  it("names the one opposing party the matter links", async () => {
    const { context } = await resolve(
      [
        { role: "client", display_name: "Acme Holdings LLC", kind: "organisation" },
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
      ],
      ["opposingParty.displayName", "opposingParty.kind"],
    );
    expect(context.values.get("opposingParty.displayName")).toEqual({
      kind: "name",
      display: "Riverside Partners",
      isOrganisation: true,
    });
    expect(context.values.get("opposingParty.kind")).toEqual({
      kind: "text",
      text: "organisation",
    });
    expect(context.absentKeys).toEqual([]);
  });

  // The role column is free text and firms write the same role differently. What is matched is the
  // letters and digits of the name, because the separator is precisely the part two firms recording the
  // same role do not agree on.
  it.each(["opposing_party", "Opposing Party", "OPPOSING-PARTY", "opposingParty"])(
    "matches a party stored under the role %s",
    async (role) => {
      const { context } = await resolve(
        [{ role, display_name: "Riverside Partners", kind: "organisation" }],
        ["opposingParty.displayName"],
      );
      expect(context.values.get("opposingParty.displayName")).toEqual({
        kind: "name",
        display: "Riverside Partners",
        isOrganisation: true,
      });
    },
  );

  it("does not let one role's links answer another role's key", async () => {
    const { context } = await resolve(
      [{ role: "witness", display_name: "Dana Okafor", kind: "person" }],
      ["opposingParty.displayName", "witness.displayName"],
    );
    expect(context.values.get("witness.displayName")).toEqual({
      kind: "name",
      display: "Dana Okafor",
      isOrganisation: false,
    });
    expect(context.values.has("opposingParty.displayName")).toBe(false);
  });
});

describe("ambiguity is an answer, not a coin toss", () => {
  it("resolves nothing for two parties in one role, and says how many there were", async () => {
    const { context } = await resolve(
      [
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
        { role: "opposing_party", display_name: "Halverson Mills LLC", kind: "organisation" },
        { role: "opposing_party", display_name: "Teller Grain Co", kind: "organisation" },
      ],
      ["opposingParty.displayName", "opposingParty.kind"],
    );
    expect(context.values.has("opposingParty.displayName")).toBe(false);
    expect(context.absentKeys).toEqual(["opposingParty.displayName", "opposingParty.kind"]);
    const reason = context.absenceReasons.get("opposingParty.displayName") ?? "";
    expect(reason).toContain("3 parties");
    expect(reason).toContain("opposing party");
    // The way out is named in the reason itself — the person reading it should not have to know the
    // repeat form exists.
    expect(reason).toContain("opposingParty.all");
    // A reason names counts and roles, NEVER the candidates it refused to choose between.
    for (const name of ["Riverside Partners", "Halverson Mills LLC", "Teller Grain Co"]) {
      expect(reason).not.toContain(name);
    }
  });

  it("says the matter links nobody in the role when it links nobody", async () => {
    const { context } = await resolve(
      [{ role: "client", display_name: "Acme Holdings LLC", kind: "organisation" }],
      ["opposingCounsel.displayName"],
    );
    expect(context.absentKeys).toEqual(["opposingCounsel.displayName"]);
    expect(context.absenceReasons.get("opposingCounsel.displayName")).toBe(
      "This matter links no party in the opposing counsel role.",
    );
  });

  // A link that is there whose Directory entry is soft-deleted or nameless is a different fact from
  // "no such party", and saying which one saves a search that finds the link and concludes the merge
  // field is broken.
  it("distinguishes a nameless linked entity from an unlinked role", async () => {
    const { context } = await resolve(
      [{ role: "guardian", display_name: null, kind: "unknown" }],
      ["guardian.displayName", "guardian.kind"],
    );
    expect(context.absenceReasons.get("guardian.displayName")).toContain("supplies no name");
    // The link itself still answers what it can: the party is there, and what kind it is is known.
    expect(context.values.get("guardian.kind")).toEqual({ kind: "text", text: "unknown" });
    expect(context.absenceReasons.has("guardian.kind")).toBe(false);
  });

  it("carries no reason for a key that resolved", async () => {
    const { context } = await resolve(
      [{ role: "witness", display_name: "Dana Okafor", kind: "person" }],
      ["witness.displayName"],
    );
    expect([...context.absenceReasons.keys()]).toEqual([]);
  });
});

describe("a role's whole collection", () => {
  it("carries every party in that role and nobody else", async () => {
    const { context } = await resolve(
      [
        { role: "client", display_name: "Acme Holdings LLC", kind: "organisation" },
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
        { role: "Opposing Party", display_name: "Halverson Mills LLC", kind: "organisation" },
        { role: "witness", display_name: "Dana Okafor", kind: "person" },
      ],
      ["opposingParty.all"],
    );
    const collection = context.values.get("opposingParty.all");
    expect(collection?.kind).toBe("list");
    if (collection?.kind !== "list") return;
    expect(collection.items.map((item) => item.fields.get("displayName"))).toEqual([
      { kind: "text", text: "Riverside Partners" },
      { kind: "text", text: "Halverson Mills LLC" },
    ]);
  });

  it("is an empty collection, not an absence, when the matter links nobody in the role", async () => {
    const { context } = await resolve(
      [{ role: "client", display_name: "Acme Holdings LLC", kind: "organisation" }],
      ["guardian.all"],
    );
    expect(context.values.get("guardian.all")).toEqual({ kind: "list", items: [] });
    expect(context.absentKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The batching rule
// ---------------------------------------------------------------------------------------------

describe("role resolution costs one read, however many roles a template names", () => {
  it("reads the matter and its parties once for every key every role contributes", async () => {
    const everyRoleKey = DIRECTORY_ROLE_SOURCES.flatMap((source) => directoryRoleKeysFor(source));
    const { reads, sources } = await resolve(
      [
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
        { role: "opposing_counsel", display_name: "Prentiss and Dowd LLP", kind: "organisation" },
        { role: "guardian", display_name: "Marisol Ashcroft", kind: "person" },
        { role: "witness", display_name: "Dana Okafor", kind: "person" },
      ],
      [...everyRoleKey, "matter.parties"],
    );
    // The estate read rides along because every role's key set now includes the capacity line,
    // which composes over the estate's stored style — one estate read for all of them, not one per
    // role. The party collection itself is still exactly one read.
    expect(sources).toEqual(["matter", "estate", "party"]);
    expect(reads).toHaveLength(3);
    expect(reads.filter((read) => read.sql.includes("matter_party"))).toHaveLength(1);
  });

  it("costs the same reads as one role key alone", async () => {
    const parties = [
      { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
    ];
    // The one-key side names a capacity line too, so both sides carry the estate read the phrase
    // composes over — the comparison stays about ROLE COUNT, which is the thing that must be free.
    const one = await resolve(parties, ["opposingParty.displayName", "opposingParty.capacityLine"]);
    const many = await resolve(
      parties,
      DIRECTORY_ROLE_SOURCES.flatMap((source) => directoryRoleKeysFor(source)),
    );
    expect(many.reads.map((read) => read.sql)).toEqual(one.reads.map((read) => read.sql));
  });

  it("reads no parties at all for a template that names no role and walks no collection", async () => {
    const { reads, sources } = await resolve(
      [{ role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" }],
      ["matter.number", "client.displayName"],
    );
    expect(sources).toEqual(["matter"]);
    expect(reads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// What the document ends up saying
// ---------------------------------------------------------------------------------------------

function registered(document: string): Uint8Array {
  const result = normalizeTemplate(readPackageOrThrow(buildDocx({ document })));
  if (result.failures.length > 0) {
    throw new Error(result.failures.map((failure) => failure.detail).join("; "));
  }
  return writePackage(result.parts);
}

function readPackageOrThrow(bytes: Uint8Array) {
  const read = readPackage(bytes);
  if (!read.ok) throw new Error(read.detail);
  return read.value;
}

function documentTextOf(bytes: Uint8Array): string {
  const xml = readPartText(readPackageOrThrow(bytes), "word/document.xml") ?? "";
  return xml.replace(/<[^>]+>/g, "");
}

describe("a document assembled against the roles", () => {
  it("prints the one opposing party and walks the whole collection", async () => {
    const template = registered(
      documentXml(
        paragraphOfRuns("Defendant: {{opposingParty.displayName}}"),
        paragraphOfRuns("{{#each witness.all}}"),
        paragraphOfRuns("{{loop.index}}. {{witness.all.displayName}}"),
        paragraphOfRuns("{{/each}}"),
      ),
    );
    const { context } = await resolve(
      [
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
        { role: "witness", display_name: "Dana Okafor", kind: "person" },
        { role: "witness", display_name: "Elias Renn", kind: "person" },
      ],
      ["opposingParty.displayName", "witness.all"],
    );
    const result = assemble(template, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = documentTextOf(result.bytes);
    expect(text).toContain("Defendant: Riverside Partners");
    expect(text).toContain("1. Dana Okafor");
    expect(text).toContain("2. Elias Renn");
  });

  // The reason reaches the assembly result rather than stopping at the resolver, which is the whole
  // point of carrying it: the marker on the page says a value is missing, and only the reason says the
  // question could not be answered as asked.
  it("shows a marker for an ambiguous role and reports why, with the count", async () => {
    const template = registered(
      documentXml(paragraphOfRuns("Defendant: {{opposingParty.displayName}}")),
    );
    const { context } = await resolve(
      [
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
        { role: "opposing_party", display_name: "Halverson Mills LLC", kind: "organisation" },
      ],
      ["opposingParty.displayName"],
    );
    const result = assemble(template, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The apostrophe in the label is XML-escaped in the emitted part, which is what a reader turns
    // back into an apostrophe — asserting over the escaped form is asserting over the bytes that ship.
    expect(documentTextOf(result.bytes)).toContain("Defendant: [OPPOSING PARTY&apos;S NAME]");
    expect(result.absences).toHaveLength(1);
    expect(result.absences[0]?.rendered).toBe("placeholder");
    expect(result.absences[0]?.reason).toContain("2 parties");
  });

  // A condition over an unresolved value fails the assembly — the asymmetry the block model is built on,
  // because a missing clause is invisible. An ambiguous role must fail the same way, and the failure has
  // to say what an author can act on.
  it("fails a condition over an ambiguous role, naming the ambiguity rather than only the key", async () => {
    // A condition that READS the value, not the bare-key form: `{{#if opposingParty.kind}}` is rewritten
    // to `has(...)`, which is total by design and answers no. A comparison has to have the value.
    const template = registered(
      documentXml(
        paragraphOfRuns('{{#if opposingParty.kind == "organisation"}}'),
        paragraphOfRuns("The opposing party is a company."),
        paragraphOfRuns("{{/if}}"),
      ),
    );
    const { context } = await resolve(
      [
        { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
        { role: "opposing_party", display_name: "Halverson Mills LLC", kind: "organisation" },
      ],
      ["opposingParty.kind"],
    );
    const result = assemble(template, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expression-unresolved");
    expect(result.detail).toContain("2 parties");
    expect(result.detail).toContain("has(opposingParty.kind)");
  });
});
