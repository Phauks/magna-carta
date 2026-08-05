import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  customFieldDictionaryEntries,
  customMergeKeyFor,
  type CustomFieldDefinitionRow,
} from "../src/custom-field-bindings.ts";
import { dictionaryForFirm } from "../src/dictionary.ts";
import { readCustomFieldCatalog, resolveMergeContext } from "../src/resolve.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";

// The batching rule, applied to the source that could most plausibly break it. A firm defines forty
// fields and a template binds all forty; the natural implementation resolves each one, which is exactly
// the N+1 the whole resolver is built to forbid. Asserted here on the reads themselves.

const MATTER_ID = "matter_TESTMATTER000000000" as MatterId;

const MATTER_ROW = {
  id: MATTER_ID,
  title: "Acme Holdings v. Riverside",
  description: null,
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
  footer: null,
  remit_to: null,
  letterhead_logo_object_key: "letterhead/location_TESTLOCATION0000/mark.png",
  letterhead_logo_width_emu: 914400,
};

// A handle of the shape the identifiers package mints: the prefix plus twenty-one characters.
function handleAt(index: number): string {
  return `customField_${String(index).padStart(21, "F")}`;
}

interface CustomFieldStoredRow {
  handle: string;
  kind: string;
  number_scale: number | null;
  archived: number;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  resolved_label: string | null;
}

function storedRow(overrides: Partial<CustomFieldStoredRow> & { handle: string }) {
  return {
    kind: "single-line",
    number_scale: null,
    archived: 0,
    value_text: null,
    value_number: null,
    value_date: null,
    resolved_label: null,
    ...overrides,
  };
}

function recordingDatabase(customFieldRows: readonly CustomFieldStoredRow[]) {
  const reads: { sql: string; bindings: readonly unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        bind(...bindings: unknown[]) {
          reads.push({ sql, bindings });
          return statement;
        },
        all() {
          if (sql.includes("custom_field_value")) {
            return Promise.resolve({ results: customFieldRows });
          }
          if (sql.includes("FROM custom_field")) {
            return Promise.resolve({
              results: customFieldRows.map((row) => ({
                id: row.handle,
                name: "A firm field",
                kind: row.kind,
                number_scale: row.number_scale,
                archived: row.archived,
              })),
            });
          }
          if (sql.includes("matter_party")) return Promise.resolve({ results: [] });
          if (sql.includes(" location ")) return Promise.resolve({ results: [LOCATION_ROW] });
          return Promise.resolve({ results: [MATTER_ROW] });
        },
      };
      // The catalogue read binds nothing, so it has to be recorded at prepare time too.
      if (!sql.includes("?1")) reads.push({ sql, bindings: [] });
      return statement;
    },
  } as unknown as SqlDatabase;
  return { database, reads };
}

function manifestOf(keys: readonly string[]): FieldManifest {
  const fields: ManifestField[] = keys.map((key, index) => ({
    key,
    format: `${index}`,
    occurrences: 1,
    parts: ["word/document.xml"],
    forms: ["brace"],
  }));
  return {
    fields,
    totalOccurrences: fields.length,
    unconvertedMergeFields: [],
    blocks: [],
    computedFields: [],
  };
}

function definitionsFor(rows: readonly CustomFieldStoredRow[]): CustomFieldDefinitionRow[] {
  return rows.map((row) => ({
    handle: row.handle,
    name: "A firm field",
    kind: row.kind as CustomFieldDefinitionRow["kind"],
    numberScale: row.number_scale,
    archived: row.archived === 1,
  }));
}

const input = {
  matterId: MATTER_ID,
  firmName: "Riverside Law LLP",
  assembledAt: "2026-03-14T12:00:00.000Z",
  currencyCode: "USD",
};

describe("a firm's own fields cost ONE read, however many a template binds", () => {
  it("resolves forty custom fields with a single custom-field read", async () => {
    const rows = Array.from({ length: 40 }, (_unused, index) =>
      storedRow({ handle: handleAt(index), value_text: `value ${index}` }),
    );
    const { database, reads } = recordingDatabase(rows);
    const dictionary = dictionaryForFirm(customFieldDictionaryEntries(definitionsFor(rows)));
    const result = await resolveMergeContext(database, {
      ...input,
      dictionary,
      manifest: manifestOf(rows.map((row) => customMergeKeyFor(row.handle))),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reads).toEqual(["customField"]);
    expect(reads).toHaveLength(1);
    // Every handle rides in the ONE statement, as bound parameters — never in the SQL text.
    expect(reads[0]?.bindings).toHaveLength(41);
    expect(reads[0]?.sql).not.toContain("customField_");
    expect(result.context.values.size).toBe(40);
  });

  it("issues no custom-field read at all for a template that binds none", async () => {
    const { database, reads } = recordingDatabase([]);
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf(["matter.number"]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reads).toEqual(["matter"]);
    expect(reads).toHaveLength(1);
  });

  it("reports an archived field as an ABSENCE rather than as its last stored value", async () => {
    const live = storedRow({ handle: handleAt(1), value_text: "still current" });
    const archived = storedRow({
      handle: handleAt(2),
      archived: 1,
      value_text: "what it used to hold",
    });
    const { database } = recordingDatabase([live, archived]);
    const result = await resolveMergeContext(database, {
      ...input,
      dictionary: dictionaryForFirm(customFieldDictionaryEntries(definitionsFor([live, archived]))),
      manifest: manifestOf([customMergeKeyFor(live.handle), customMergeKeyFor(archived.handle)]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.values.get(customMergeKeyFor(live.handle))).toEqual({
      kind: "text",
      text: "still current",
    });
    expect(result.context.absentKeys).toEqual([customMergeKeyFor(archived.handle)]);
  });

  it("reads a value at the scale its field declared", async () => {
    const rows = [
      storedRow({ handle: handleAt(3), kind: "currency", value_number: 250000 }),
      storedRow({ handle: handleAt(4), kind: "number", number_scale: 2, value_number: 250000 }),
    ];
    const { database } = recordingDatabase(rows);
    const result = await resolveMergeContext(database, {
      ...input,
      dictionary: dictionaryForFirm(customFieldDictionaryEntries(definitionsFor(rows))),
      manifest: manifestOf(rows.map((row) => customMergeKeyFor(row.handle))),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.values.get(customMergeKeyFor(handleAt(3)))).toEqual({
      kind: "money",
      amountMinor: 250000,
      currencyCode: "USD",
    });
    expect(result.context.values.get(customMergeKeyFor(handleAt(4)))).toEqual({
      kind: "number",
      value: 250000,
      scale: 2,
    });
  });

  it("reads the firm's catalogue without touching a single matter's data", async () => {
    const rows = [storedRow({ handle: handleAt(5) })];
    const { database, reads } = recordingDatabase(rows);
    const catalog = await readCustomFieldCatalog(database);
    expect(catalog.map((row) => row.handle)).toEqual([handleAt(5)]);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.sql).not.toContain("custom_field_value");
  });
});

describe("the letterhead logo is fetched only when a template draws one", () => {
  const logoKey = "location.letterheadLogo";

  it("fetches the object once and reports the box the office set", async () => {
    const { database } = recordingDatabase([]);
    const fetched: string[] = [];
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([logoKey]),
      readImageAsset: (objectKey) => {
        fetched.push(objectKey);
        // A one-pixel PNG header is enough: only the intrinsic size is read.
        return Promise.resolve(pngHeader(400, 100));
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetched).toEqual([LOCATION_ROW.letterhead_logo_object_key]);
    const value = result.context.values.get(logoKey);
    expect(value?.kind).toBe("image");
    if (value?.kind !== "image") return;
    expect(value.widthEmu).toBe(914400);
    // The height follows from the asset's own proportions — the office set only a width.
    expect(value.heightEmu).toBe(914400 / 4);
  });

  it("fetches nothing when the template names no logo", async () => {
    const { database } = recordingDatabase([]);
    const fetched: string[] = [];
    await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf(["location.name"]),
      readImageAsset: (objectKey) => {
        fetched.push(objectKey);
        return Promise.resolve(undefined);
      },
    });
    expect(fetched).toEqual([]);
  });

  it("reports an absence when the object has gone, rather than losing the letterhead silently", async () => {
    const { database } = recordingDatabase([]);
    const result = await resolveMergeContext(database, {
      ...input,
      manifest: manifestOf([logoKey]),
      readImageAsset: () => Promise.resolve(undefined),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.absentKeys).toEqual([logoKey]);
  });
});

// The eight-byte signature plus an IHDR declaring a size — all the engine reads out of a PNG.
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
