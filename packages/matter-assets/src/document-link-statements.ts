import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FileId,
  MatterAssetDocumentId,
  MatterAssetId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterAssetDocumentKind } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test. `file` is read here only to check the file belongs to the asset's matter; nothing in
// this package writes it, and no byte of a document ever passes through this module.
export const MATTER_ASSET_DOCUMENT_TABLE = "matter_asset_document";
const FILE_TABLE = "file";

export interface MatterAssetDocumentRow {
  readonly id: MatterAssetDocumentId;
  readonly asset_id: MatterAssetId;
  readonly file_id: FileId;
  readonly kind: MatterAssetDocumentKind;
  readonly note: string | null;
  readonly linked_at: string;
  readonly linked_by: UserId | null;
}

const DOCUMENT_COLUMNS = "id, asset_id, file_id, kind, note, linked_at, linked_by";

export function insertMatterAssetDocumentStatement(
  database: SqlDatabase,
  row: {
    readonly id: MatterAssetDocumentId;
    readonly assetId: MatterAssetId;
    readonly fileId: FileId;
    readonly kind: MatterAssetDocumentKind;
    readonly note: string | null;
    readonly linkedBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_DOCUMENT_TABLE} (${DOCUMENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(row.id, row.assetId, row.fileId, row.kind, row.note, row.now, row.linkedBy);
}

// Unlinking removes the LINK ROW and touches the file not at all: a link is a filing decision, not a
// record of a historical event, and a deed attached to the wrong house should be detachable. The
// valuation history, by contrast, is not.
export function deleteMatterAssetDocumentStatement(
  database: SqlDatabase,
  id: MatterAssetDocumentId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_ASSET_DOCUMENT_TABLE} WHERE id = ?1`).bind(id);
}

export function selectMatterAssetDocumentStatement(
  database: SqlDatabase,
  id: MatterAssetDocumentId,
): SqlStatement {
  return database
    .prepare(`SELECT ${DOCUMENT_COLUMNS} FROM ${MATTER_ASSET_DOCUMENT_TABLE} WHERE id = ?1`)
    .bind(id);
}

export function selectMatterAssetDocumentsStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM ${MATTER_ASSET_DOCUMENT_TABLE} WHERE asset_id = ?1 ` +
        `ORDER BY linked_at DESC, id DESC`,
    )
    .bind(assetId);
}

// The reverse read the design's many-to-many shape exists for: which assets does this one file
// evidence. One brokerage statement legitimately answers with four accounts.
export function selectMatterAssetsForFileStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM ${MATTER_ASSET_DOCUMENT_TABLE} WHERE file_id = ?1 ` +
        `ORDER BY linked_at DESC, id DESC`,
    )
    .bind(fileId);
}

export async function readMatterAssetDocument(
  database: SqlDatabase,
  id: MatterAssetDocumentId,
): Promise<MatterAssetDocumentRow | undefined> {
  const { results } = await selectMatterAssetDocumentStatement(
    database,
    id,
  ).all<MatterAssetDocumentRow>();
  return results[0];
}

export async function readMatterAssetDocuments(
  database: SqlDatabase,
  assetId: MatterAssetId,
): Promise<MatterAssetDocumentRow[]> {
  const { results } = await selectMatterAssetDocumentsStatement(
    database,
    assetId,
  ).all<MatterAssetDocumentRow>();
  return results;
}

export async function readMatterAssetsForFile(
  database: SqlDatabase,
  fileId: FileId,
): Promise<MatterAssetDocumentRow[]> {
  const { results } = await selectMatterAssetsForFileStatement(
    database,
    fileId,
  ).all<MatterAssetDocumentRow>();
  return results;
}

// The matter a stored file is filed under, so the link path can refuse a file from another matter.
export async function readFileMatterId(
  database: SqlDatabase,
  fileId: FileId,
): Promise<MatterId | undefined> {
  const { results } = await database
    .prepare(`SELECT matter_id FROM ${FILE_TABLE} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(fileId)
    .all<{ matter_id: MatterId }>();
  return results[0]?.matter_id;
}
