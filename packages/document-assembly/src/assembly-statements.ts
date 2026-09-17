import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentAssemblyId,
  DocumentTemplateId,
  DocumentTemplateVersionId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";

// The assembly provenance record. Table name tracked against @magna-carta/database's per-firm schema by
// the schema-name-sync fitness test.
//
// NOTHING here holds a resolved merge value. The only field-level columns are the list of keys that
// were ABSENT — which by construction held nothing — and the NAMES of the Word merge fields the
// template still carried unconverted (never the frozen text those print, which is template content
// rather than provenance). The failure reason is a code from a closed set, so a client's identifying
// details can never reach this table however an assembly went.

export const DOCUMENT_ASSEMBLY_TABLE = "document_assembly";

export type AssemblyStatus = "queued" | "running" | "done" | "failed";
export type AssemblyOutcome = "succeeded" | "succeeded_with_absences" | "failed";

// What a job was asked to produce. The merge always emits a word-processing package; `pdf` asks the
// job to carry that package across the office-suite conversion edge before filing it. It is recorded
// rather than derived from the filed object because a job that FAILED still has to say what it was
// trying to make, and a caller polling before the document lands needs the answer to decide what it
// may hand the produced document to next.
export type AssemblyOutputFormat = "docx" | "pdf";

export const ASSEMBLY_OUTPUT_FORMATS: readonly AssemblyOutputFormat[] = ["docx", "pdf"];

export interface InsertDocumentAssemblyRow {
  readonly id: DocumentAssemblyId;
  readonly matterId: MatterId;
  readonly templateId: DocumentTemplateId;
  readonly templateVersionId: DocumentTemplateVersionId;
  readonly folderId: FolderId | null;
  readonly outputFormat: AssemblyOutputFormat;
  readonly engineVersion: number;
  readonly dictionaryVersion: number;
  readonly requestedBy: UserId | null;
  readonly createdAt: string;
}

export function insertDocumentAssemblyStatement(
  database: SqlDatabase,
  row: InsertDocumentAssemblyRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOCUMENT_ASSEMBLY_TABLE} (id, matter_id, template_id, template_version_id, folder_id, status, output_format, engine_version, dictionary_version, absent_field_count, absent_field_keys_json, frozen_field_count, frozen_field_names_json, requested_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8, 0, '[]', 0, '[]', ?9, ?10)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.templateId,
      row.templateVersionId,
      row.folderId,
      row.outputFormat,
      row.engineVersion,
      row.dictionaryVersion,
      row.requestedBy,
      row.createdAt,
    );
}

export function markAssemblyRunningStatement(
  database: SqlDatabase,
  assemblyId: DocumentAssemblyId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_ASSEMBLY_TABLE} SET status = 'running' WHERE id = ?1 AND status = 'queued'`,
    )
    .bind(assemblyId);
}

export interface CompleteDocumentAssemblyRow {
  readonly assemblyId: DocumentAssemblyId;
  readonly fileId: FileId;
  readonly fileVersionId: FileVersionId;
  readonly outcome: Extract<AssemblyOutcome, "succeeded" | "succeeded_with_absences">;
  // The KEYS that could not be resolved, never the values that could.
  readonly absentFieldKeys: readonly string[];
  // The NAMES of the Word fields nothing substituted — merge fields the template carried unconverted,
  // legacy form fields, and content controls nothing will fill in, none of which anything binds — so
  // this document renders each as the text the template already held. Names only, so a reader can find
  // each field in the document; the text itself stays in the template's manifest.
  readonly frozenFieldNames: readonly string[];
  readonly completedAt: string;
}

// A redelivered queue message must not file a second document, so completion is guarded on the row not
// already being `done`: the second delivery's update matches zero rows and the consumer's own
// already-filed check short-circuits before it produces any bytes.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function completeDocumentAssemblyStatement(
  database: SqlDatabase,
  row: CompleteDocumentAssemblyRow,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_ASSEMBLY_TABLE} SET status = 'done', outcome = ?2, file_id = ?3, file_version_id = ?4, absent_field_count = ?5, absent_field_keys_json = ?6, frozen_field_count = ?7, frozen_field_names_json = ?8, completed_at = ?9 WHERE id = ?1 AND status != 'done'`,
    )
    .bind(
      row.assemblyId,
      row.outcome,
      row.fileId,
      row.fileVersionId,
      row.absentFieldKeys.length,
      JSON.stringify([...row.absentFieldKeys]),
      row.frozenFieldNames.length,
      JSON.stringify([...row.frozenFieldNames]),
      row.completedAt,
    );
}

// `failureReason` is an error CODE from a closed set — never a failing value, and never the text of a
// merge field. A merge failure reports which key failed; the keys go in the same absent-key column,
// because a key is a field name rather than anything a client supplied.
// fitness:unguarded-write — failing a job that already finished is a no-op on purpose — a late failure must not overwrite a completed run
export function failDocumentAssemblyStatement(
  database: SqlDatabase,
  assemblyId: DocumentAssemblyId,
  failureReason: string,
  namedKeys: readonly string[],
  completedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_ASSEMBLY_TABLE} SET status = 'failed', outcome = 'failed', failure_reason = ?2, absent_field_count = ?3, absent_field_keys_json = ?4, completed_at = ?5 WHERE id = ?1 AND status != 'done'`,
    )
    .bind(assemblyId, failureReason, namedKeys.length, JSON.stringify([...namedKeys]), completedAt);
}

export interface DocumentAssemblyRow {
  readonly id: DocumentAssemblyId;
  readonly matterId: MatterId;
  readonly templateId: DocumentTemplateId;
  readonly templateVersionId: DocumentTemplateVersionId;
  readonly folderId: FolderId | null;
  readonly outputFormat: AssemblyOutputFormat;
  readonly status: AssemblyStatus;
  readonly outcome: AssemblyOutcome | null;
  readonly failureReason: string | null;
  readonly fileId: FileId | null;
  readonly fileVersionId: FileVersionId | null;
  readonly absentFieldKeys: readonly string[];
  readonly frozenFieldNames: readonly string[];
  readonly createdAt: string;
  readonly completedAt: string | null;
}

interface DocumentAssemblyColumns {
  id: string;
  matter_id: string;
  template_id: string;
  template_version_id: string;
  folder_id: string | null;
  output_format: string;
  status: string;
  outcome: string | null;
  failure_reason: string | null;
  file_id: string | null;
  file_version_id: string | null;
  absent_field_keys_json: string;
  frozen_field_names_json: string;
  created_at: string;
  completed_at: string | null;
}

const SELECT_ASSEMBLY_COLUMNS = `SELECT id, matter_id, template_id, template_version_id, folder_id, output_format, status, outcome, failure_reason, file_id, file_version_id, absent_field_keys_json, frozen_field_names_json, created_at, completed_at FROM ${DOCUMENT_ASSEMBLY_TABLE}`;

function parseKeys(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function toDocumentAssemblyRow(row: DocumentAssemblyColumns): DocumentAssemblyRow {
  return {
    id: row.id as DocumentAssemblyId,
    matterId: row.matter_id as MatterId,
    templateId: row.template_id as DocumentTemplateId,
    templateVersionId: row.template_version_id as DocumentTemplateVersionId,
    folderId: row.folder_id as FolderId | null,
    // A row written before the column existed reads NULL through a driver that does not apply the
    // default to an already-stored row; every such assembly produced a word-processing package,
    // which is what the fallback says.
    outputFormat: row.output_format === "pdf" ? "pdf" : "docx",
    status: row.status as AssemblyStatus,
    outcome: row.outcome as AssemblyOutcome | null,
    failureReason: row.failure_reason,
    fileId: row.file_id as FileId | null,
    fileVersionId: row.file_version_id as FileVersionId | null,
    absentFieldKeys: parseKeys(row.absent_field_keys_json),
    frozenFieldNames: parseKeys(row.frozen_field_names_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// Read one assembly, scoped by its matter as well as its id. The matter predicate is not redundant with
// the tenancy boundary: within one firm it is what stops a caller who can reach one matter from polling
// an assembly that belongs to another.
export async function readDocumentAssembly(
  database: SqlDatabase,
  matterId: MatterId,
  assemblyId: DocumentAssemblyId,
): Promise<DocumentAssemblyRow | undefined> {
  const { results } = await database
    .prepare(`${SELECT_ASSEMBLY_COLUMNS} WHERE id = ?1 AND matter_id = ?2`)
    .bind(assemblyId, matterId)
    .all<DocumentAssemblyColumns>();
  const row = results[0];
  return row === undefined ? undefined : toDocumentAssemblyRow(row);
}
