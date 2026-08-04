import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { DocumentTemplateFieldMappingId, UserId } from "@magna-carta/identifiers/types";
import { mergeFieldNameResolverFor, type MergeFieldNameResolver } from "./normalize.ts";

// The firm's field-mapping library — the store behind the merge-field name resolver.
//
// The engine never guesses what a Word field name means: a `ClientName` that becomes
// `client.displayName` because it looked close is a silent binding decision on privileged content. So
// the meaning is the FIRM'S knowledge, confirmed once and reused: converting a template's merge fields
// confirms each mapping the conversion landed on, and every later detection consults the library first,
// so the second import of documents from the same source arrives already mapped.
//
// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The table exists only in the per-firm database, so the caller supplies that handle and no query
// here can reach across firms.

export const DOCUMENT_TEMPLATE_FIELD_MAPPING_TABLE = "document_template_field_mapping";

export interface DocumentTemplateFieldMappingRow {
  readonly id: DocumentTemplateFieldMappingId;
  readonly fieldName: string;
  readonly mergeKey: string;
  readonly timesApplied: number;
  readonly confirmedBy: UserId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface FieldMappingColumns {
  id: string;
  field_name: string;
  merge_key: string;
  times_applied: number;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_MAPPING_COLUMNS = `SELECT id, field_name, merge_key, times_applied, confirmed_by, created_at, updated_at FROM ${DOCUMENT_TEMPLATE_FIELD_MAPPING_TABLE}`;

function toRow(row: FieldMappingColumns): DocumentTemplateFieldMappingRow {
  return {
    id: row.id as DocumentTemplateFieldMappingId,
    fieldName: row.field_name,
    mergeKey: row.merge_key,
    timesApplied: row.times_applied,
    confirmedBy: row.confirmed_by as UserId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The whole library in ONE read, keyed by field name. Read whole rather than looked up per field for
// the same reason the merge context is batched: a template with a hundred merge fields must not cost a
// hundred queries, and a firm's library is tens to low hundreds of rows — smaller than the template
// package the same registration is already holding in memory.
export async function readFieldMappingLibrary(database: SqlDatabase): Promise<Map<string, string>> {
  const { results } = await database
    .prepare(
      `SELECT field_name, merge_key FROM ${DOCUMENT_TEMPLATE_FIELD_MAPPING_TABLE} ORDER BY field_name ASC`,
    )
    .all<{ field_name: string; merge_key: string }>();
  return new Map(results.map((row) => [row.field_name, row.merge_key]));
}

// The resolver a registration hands to the normalization pass: the firm's confirmed mappings, falling
// back to the identity mapping for a name nobody has confirmed.
export async function fieldMappingResolverFor(
  database: SqlDatabase,
): Promise<MergeFieldNameResolver> {
  return mergeFieldNameResolverFor(await readFieldMappingLibrary(database));
}

export async function listFieldMappings(
  database: SqlDatabase,
  params: { readonly limit: number; readonly afterFieldName?: string },
): Promise<DocumentTemplateFieldMappingRow[]> {
  const bindings: unknown[] = [];
  let where = "";
  if (params.afterFieldName !== undefined) {
    bindings.push(params.afterFieldName);
    where = ` WHERE field_name > ?1`;
  }
  bindings.push(params.limit);
  const { results } = await database
    .prepare(`${SELECT_MAPPING_COLUMNS}${where} ORDER BY field_name ASC LIMIT ?${bindings.length}`)
    .bind(...bindings)
    .all<FieldMappingColumns>();
  return results.map(toRow);
}

export async function readFieldMapping(
  database: SqlDatabase,
  mappingId: DocumentTemplateFieldMappingId,
): Promise<DocumentTemplateFieldMappingRow | undefined> {
  const { results } = await database
    .prepare(`${SELECT_MAPPING_COLUMNS} WHERE id = ?1`)
    .bind(mappingId)
    .all<FieldMappingColumns>();
  const row = results[0];
  return row === undefined ? undefined : toRow(row);
}

export interface ConfirmFieldMappingRow {
  readonly fieldName: string;
  readonly mergeKey: string;
}

export interface FieldMappingOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Record what a conversion confirmed. Re-confirming a name UPDATES the mapping rather than inserting a
// second answer to the same question — a firm that changes its mind about what `FileNo` means says so
// by converting again, and the library holds one meaning per name by construction (the unique index)
// rather than by the caller remembering to check first.
export function confirmFieldMappingStatements(
  database: SqlDatabase,
  mappings: readonly ConfirmFieldMappingRow[],
  options: FieldMappingOptions,
): SqlStatement[] {
  const now = options.clock.now();
  return mappings.map((mapping) =>
    database
      .prepare(
        `INSERT INTO ${DOCUMENT_TEMPLATE_FIELD_MAPPING_TABLE} (id, field_name, merge_key, times_applied, confirmed_by, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5) ON CONFLICT (field_name) DO UPDATE SET merge_key = ?3, times_applied = times_applied + 1, confirmed_by = ?4, updated_at = ?5`,
      )
      .bind(
        newIdentifier("documentTemplateFieldMapping", options.randomSource),
        mapping.fieldName,
        mapping.mergeKey,
        options.actorUserId,
        now,
      ),
  );
}

// A mapping is a statement the firm made, so withdrawing it is a delete rather than an archive: nothing
// downstream depends on the row (a registered template version's bytes and manifest are immutable, and
// the mapping only ever acted at the moment of conversion), so keeping a tombstone would preserve
// nothing and only make the library harder to read.
export function deleteFieldMappingEffect(
  database: SqlDatabase,
  mappingId: DocumentTemplateFieldMappingId,
  options: FieldMappingOptions,
): EffectWrite {
  return {
    statements: [
      database
        .prepare(`DELETE FROM ${DOCUMENT_TEMPLATE_FIELD_MAPPING_TABLE} WHERE id = ?1`)
        .bind(mappingId),
      domainAuditStatement(database, {
        event: "documentTemplateFieldMapping.deleted",
        subjectId: mappingId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
      }),
    ],
    outboxMessages: [],
  };
}
