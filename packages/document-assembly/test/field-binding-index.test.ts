import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { DocumentTemplateVersionId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  insertTemplateFieldBindingStatements,
  selectTemplateVersionsBindingKeyStatement,
} from "../src/template-statements.ts";
import type { FieldManifest, ManifestField } from "../src/types.ts";
import { manifestKeys } from "../src/types.ts";

// The field-binding index: which registered template versions bind which merge keys.
//
// The property that makes an index acceptable here rather than a scan is IMMUTABILITY. These rows are
// derived from a template version and written in the same batch as it, and a template version never
// changes — so there is no update path, no reconciliation, and no way for the index to disagree with
// the manifest it came from. What is asserted below is that the derivation is exact: one row per
// DISTINCT key, from every site the manifest records, and not one row more.

const VERSION_ID = "documentTemplateVersion_AAAAAAAAAA" as DocumentTemplateVersionId;

function recordingDatabase(): { database: SqlDatabase; statements: SqlStatement[] } {
  const statements: SqlStatement[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          statement.bindings = bindings;
          statements.push(statement as unknown as SqlStatement);
          return statement;
        },
        all: () => Promise.resolve({ results: [] }),
      };
      return statement;
    },
  } as unknown as SqlDatabase;
  return { database, statements };
}

function bindingsOf(statements: readonly SqlStatement[]): readonly string[] {
  return statements.map(
    (statement) => (statement as unknown as { bindings: unknown[] }).bindings[1] as string,
  );
}

function manifestOf(fields: readonly ManifestField[], extras: Partial<FieldManifest> = {}) {
  return {
    fields,
    totalOccurrences: fields.reduce((sum, field) => sum + field.occurrences, 0),
    unconvertedMergeFields: [],
    blocks: [],
    computedFields: [],
    ...extras,
  } satisfies FieldManifest;
}

function field(key: string, format: string | null = null): ManifestField {
  return { key, format, occurrences: 1, parts: ["word/document.xml"], forms: ["brace"] };
}

describe("the binding index a registration writes", () => {
  it("writes one row per distinct key, however many placeholders name it", () => {
    const { database, statements } = recordingDatabase();
    const written = insertTemplateFieldBindingStatements(database, VERSION_ID, [
      "matter.number",
      "matter.number",
      "client.displayName",
    ]);
    expect(written).toHaveLength(2);
    expect(bindingsOf(statements)).toEqual(["client.displayName", "matter.number"]);
  });

  it("writes 150 rows for a version declaring 150 distinct keys, and no more", () => {
    const keys = Array.from({ length: 150 }, (_index, index) => `custom.field${index}`);
    const { database } = recordingDatabase();
    // Each key twice, so the deduplication is doing work rather than the input being clean.
    expect(
      insertTemplateFieldBindingStatements(database, VERSION_ID, [...keys, ...keys]),
    ).toHaveLength(150);
  });

  it("writes nothing for a template that declares no fields", () => {
    const { database } = recordingDatabase();
    expect(insertTemplateFieldBindingStatements(database, VERSION_ID, [])).toEqual([]);
  });

  // "Which templates break if this key goes away" has to mean ALL of them, not only the ones that
  // print it — a condition that reads a key and a calculation that folds one are bindings too.
  it("indexes the keys a block condition and a calculation read, not only the printed ones", () => {
    const manifest = manifestOf([field("matter.number")], {
      blocks: [
        {
          kind: "if",
          source: "has(opposingParty.displayName)",
          resultType: "boolean",
          part: "word/document.xml",
          keys: ["opposingParty.displayName"],
          depth: 0,
        },
      ],
      computedFields: [
        {
          source: "upper(client.displayName)",
          format: null,
          resultType: "text",
          part: "word/document.xml",
          keys: ["client.displayName"],
          occurrences: 1,
        },
      ],
    });
    const { database, statements } = recordingDatabase();
    insertTemplateFieldBindingStatements(database, VERSION_ID, manifestKeys(manifest));
    expect(bindingsOf(statements)).toEqual([
      "client.displayName",
      "matter.number",
      "opposingParty.displayName",
    ]);
  });
});

describe("reading the index", () => {
  it("asks for the versions binding one key, by that key alone", () => {
    const { database, statements } = recordingDatabase();
    selectTemplateVersionsBindingKeyStatement(database, "custom.customField_ABCDEFGHIJKLMNOPQRSTU");
    const statement = statements[0] as unknown as { sql: string; bindings: unknown[] };
    // An index seek on `merge_key`, never a scan over stored manifests — which is the whole reason the
    // table exists rather than the `instr()` search it replaced.
    expect(statement.sql).toContain("WHERE merge_key = ?1");
    expect(statement.sql).not.toContain("instr");
    expect(statement.bindings).toEqual(["custom.customField_ABCDEFGHIJKLMNOPQRSTU"]);
  });
});
