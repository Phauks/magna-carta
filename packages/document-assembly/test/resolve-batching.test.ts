import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { DICTIONARY } from "../src/dictionary.ts";
import { resolveMergeContext } from "../src/resolve.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";

// THE test that stops the N+1 from being reintroduced. The natural implementation of a merge engine is
// a per-field resolver, which is an N+1 generator pointed straight at a document with a hundred merge
// fields — so "a merge field never issues a query" is asserted here rather than left to care.
//
// The recording database counts prepared statements and records their SQL, so the assertion is on the
// number AND the identity of the reads, not merely on a total.

interface RecordedRead {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

const MATTER_ROW = {
  id: "matter_TESTMATTER000000000",
  title: "Acme Holdings v. Riverside",
  description: "A contract dispute.",
  status: "open",
  location_id: "location_TESTLOCATION0000",
  client_display_name: "Acme Holdings LLC",
  client_code: "ACME-001",
  matter_number: "2026-0042",
  opened_at: "2026-02-01T09:00:00.000Z",
  e_billing: 0,
};

const LOCATION_ROW = {
  id: "location_TESTLOCATION0000",
  name: "Riverside Office",
  jurisdiction: "CA",
  address_block: "1 Riverside Plaza",
  footer: "Riverside Office footer",
  remit_to: "Remit to Riverside",
};

// Two linked parties, so the collection read has something to return. The whole collection arrives in
// ONE read; the assertion below is that adding parties to a manifest never adds a read per party.
const PARTY_ROWS = [
  { role: "client", display_name: "Acme Holdings LLC", kind: "organisation" },
  { role: "opposing_party", display_name: "Riverside Partners", kind: "organisation" },
];

function recordingDatabase(): { database: SqlDatabase; reads: RecordedRead[] } {
  const reads: RecordedRead[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        bind(...bindings: unknown[]) {
          reads.push({ sql, bindings });
          return statement;
        },
        all() {
          const rows = sql.includes("matter_party")
            ? PARTY_ROWS
            : sql.includes(" location ")
              ? [LOCATION_ROW]
              : [MATTER_ROW];
          return Promise.resolve({ results: rows });
        },
      };
      return statement;
    },
  } as unknown as SqlDatabase;
  return { database, reads };
}

// A manifest naming `fieldCount` placeholders, cycling through every key the dictionary has so the
// manifest spans every source rather than hammering one.
function manifestOfSize(fieldCount: number): FieldManifest {
  const fields: ManifestField[] = [];
  for (let index = 0; index < fieldCount; index += 1) {
    const entry = DICTIONARY[index % DICTIONARY.length];
    if (entry === undefined) continue;
    fields.push({
      key: entry.key,
      // A distinct format per occurrence keeps these separate manifest entries rather than collapsing
      // into one, so the field count the resolver sees really is `fieldCount`.
      format: `${index}`,
      occurrences: 1,
      parts: ["word/document.xml"],
      forms: ["brace"],
    });
  }
  return manifestOf(fields);
}

// A manifest carrying nothing but the given placeholders — no blocks, no computed fields, no
// unconverted Word merge fields.
function manifestOf(fields: readonly ManifestField[]): FieldManifest {
  return {
    fields,
    totalOccurrences: fields.reduce((sum, field) => sum + field.occurrences, 0),
    unconvertedMergeFields: [],
    blocks: [],
    computedFields: [],
  };
}

const input = {
  matterId: "matter_TESTMATTER000000000" as MatterId,
  firmName: "Riverside Law LLP",
  assembledAt: "2026-03-14T12:00:00.000Z",
  currencyCode: "USD",
};

describe("resolution issues one read per source, never one per field", () => {
  it("reads exactly the matter and the location for a manifest spanning every source", async () => {
    const { database, reads } = recordingDatabase();
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOfSize(DICTIONARY.length),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `protectedIdentifier` is in the list because the manifest names protected keys, but it issues no
    // statement of its own: a sealed value is decrypted through the chokepoint reader, which this
    // manifest was resolved without. The three PREPARED reads are still matter, party, and location.
    expect(result.reads).toEqual(["matter", "party", "protectedIdentifier", "location"]);
    expect(reads).toHaveLength(3);
  });

  it("costs a 150-field template exactly the reads its SOURCES need, not the reads its fields would", async () => {
    // The comparison is against a manifest naming every source once. Read count is bounded by the
    // number of distinct sources, and nothing about the field count moves it — which is the whole
    // claim, and the one a per-field resolver would silently break.
    const oneFieldPerSource = recordingDatabase();
    await resolveMergeContext(oneFieldPerSource.database, {
      ...input,
      manifest: manifestOfSize(DICTIONARY.length),
    });

    const large = recordingDatabase();
    await resolveMergeContext(large.database, { ...input, manifest: manifestOfSize(150) });

    expect(large.reads.length).toBe(oneFieldPerSource.reads.length);
    expect(large.reads.map((read) => read.sql)).toEqual(
      oneFieldPerSource.reads.map((read) => read.sql),
    );
    // And the absolute bound: three reads for a template with a hundred and fifty merge fields — the
    // matter, its party collection, and its office.
    expect(large.reads).toHaveLength(3);
  });

  // THE READ BUDGET, stated against the catalogue rather than against a number somebody typed. Cost
  // tracks the number of SOURCES a manifest touches, so a catalogue that doubles its keys without
  // adding a source costs exactly what it cost before — and a source added without a batched read shows
  // up here rather than in a code review.
  it("costs the whole catalogue exactly the reads its distinct sources issue", async () => {
    const { database, reads } = recordingDatabase();
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOfSize(DICTIONARY.length),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The sources the catalogue declares, minus the three that issue no statement of their own: the
    // firm's name arrives as a caller input, the document's own date is produced rather than read, and a
    // sealed identifier is decrypted one at a time through the chokepoint reader rather than batched.
    const ISSUES_NO_STATEMENT = new Set(["firm", "system", "protectedIdentifier"]);
    const readingSources = new Set(
      DICTIONARY.map((entry) => entry.source).filter((source) => !ISSUES_NO_STATEMENT.has(source)),
    );
    expect(reads).toHaveLength(readingSources.size);
  });

  // A SUBJECT COSTS NO READ. Every party subject is answered by a pass over rows the one party read
  // already returned, so naming all of them costs what naming one costs — the property that lets the
  // subject registry grow without the read count following it.
  it("costs the same reads for every party subject as for one", async () => {
    const partyKeys = DICTIONARY.filter((entry) => entry.source === "party").map(
      (entry) => entry.key,
    );
    const many = recordingDatabase();
    await resolveMergeContext(many.database, {
      ...input,
      manifest: manifestOf(
        partyKeys.map((key) => ({
          key,
          format: null,
          occurrences: 1,
          parts: [],
          forms: ["brace" as const],
        })),
      ),
    });
    const one = recordingDatabase();
    await resolveMergeContext(one.database, {
      ...input,
      manifest: manifestOf([
        {
          key: "opposingParty.displayName",
          format: null,
          occurrences: 1,
          parts: [],
          forms: ["brace"],
        },
      ]),
    });
    expect(many.reads.map((read) => read.sql)).toEqual(one.reads.map((read) => read.sql));
    expect(many.reads).toHaveLength(2);
  });

  it("reads nothing at all for a manifest that names only firm and system fields", async () => {
    const { database, reads } = recordingDatabase();
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([
        { key: "firm.name", format: null, occurrences: 40, parts: [], forms: ["brace"] },
        { key: "system.today", format: null, occurrences: 40, parts: [], forms: ["brace"] },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reads).toEqual([]);
    expect(reads).toEqual([]);
    expect(result.context.values.get("firm.name")).toEqual({
      kind: "text",
      text: "Riverside Law LLP",
    });
  });

  it("reads no location for a manifest that names no location field", async () => {
    const { database, reads } = recordingDatabase();
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([
        { key: "matter.number", format: null, occurrences: 1, parts: [], forms: ["brace"] },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reads).toEqual(["matter"]);
    expect(reads).toHaveLength(1);
  });

  it("serves the client party from the matter read rather than a second one", async () => {
    const { database, reads } = recordingDatabase();
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([
        { key: "client.displayName", format: null, occurrences: 1, parts: [], forms: ["brace"] },
        { key: "client.code", format: null, occurrences: 1, parts: [], forms: ["brace"] },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(reads).toHaveLength(1);
    // The matter's own row records the client's name as a STRING, so the value carries only its
    // display part — which is exactly what the default rendering prints, and exactly why a rendering
    // that needs a separated part is a declared absence rather than a guess made from the string.
    expect(result.context.values.get("client.displayName")).toEqual({
      kind: "name",
      display: "Acme Holdings LLC",
    });
  });
});

describe("resolution outcomes", () => {
  it("reports the keys the matter cannot supply, and nothing about the ones it can", async () => {
    const { database } = recordingDatabase();
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([
        { key: "matter.number", format: null, occurrences: 1, parts: [], forms: ["brace"] },
        { key: "matter.description", format: null, occurrences: 1, parts: [], forms: ["brace"] },
        { key: "location.footer", format: null, occurrences: 1, parts: [], forms: ["brace"] },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.absentKeys).toEqual([]);
  });

  it("counts a null column as an absence", async () => {
    const reads: RecordedRead[] = [];
    const database = {
      prepare(sql: string) {
        const statement = {
          bind(...bindings: unknown[]) {
            reads.push({ sql, bindings });
            return statement;
          },
          all: () =>
            Promise.resolve({
              results: [{ ...MATTER_ROW, matter_number: null, location_id: null }],
            }),
        };
        return statement;
      },
    } as unknown as SqlDatabase;

    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([
        { key: "matter.number", format: null, occurrences: 1, parts: [], forms: ["brace"] },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.absentKeys).toEqual(["matter.number"]);
  });

  it("fails typed when the matter is not there, rather than assembling against nothing", async () => {
    const database = {
      prepare() {
        const statement = {
          bind: () => statement,
          all: () => Promise.resolve({ results: [] }),
        };
        return statement;
      },
    } as unknown as SqlDatabase;

    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([
        { key: "matter.number", format: null, occurrences: 1, parts: [], forms: ["brace"] },
      ]),
    });
    expect(result).toMatchObject({ ok: false, reason: "matter-not-found" });
  });
});
