import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyItemId,
  CustodyPacketId,
  CustodyScanId,
  FileId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { CustodyScanKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_SCAN_TABLE = "custody_scan";
export const FILE_TABLE = "file";

export interface CustodyScanRow {
  readonly id: CustodyScanId;
  readonly packet_id: CustodyPacketId;
  readonly item_id: CustodyItemId | null;
  readonly file_id: FileId;
  readonly kind: CustodyScanKind;
  readonly captured_at: string;
  readonly captured_by: UserId | null;
}

const SCAN_COLUMNS = "id, packet_id, item_id, file_id, kind, captured_at, captured_by";

export function insertCustodyScanStatement(
  database: SqlDatabase,
  row: {
    readonly id: CustodyScanId;
    readonly packetId: CustodyPacketId;
    readonly itemId: CustodyItemId | null;
    readonly fileId: FileId;
    readonly kind: CustodyScanKind;
    readonly capturedAt: string;
    readonly capturedBy: UserId | null;
    readonly createdAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_SCAN_TABLE} (id, packet_id, item_id, file_id, kind, captured_at, captured_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.packetId,
      row.itemId,
      row.fileId,
      row.kind,
      row.capturedAt,
      row.capturedBy,
      row.createdAt,
    );
}

export function selectCustodyScansStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${SCAN_COLUMNS} FROM ${CUSTODY_SCAN_TABLE} WHERE packet_id = ?1 ORDER BY captured_at DESC, id DESC`,
    )
    .bind(packetId);
}

export async function readCustodyScans(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyScanRow[]> {
  const { results } = await selectCustodyScansStatement(database, packetId).all<CustodyScanRow>();
  return results;
}

// Where a file is filed. The scan link checks this against the packet's filing target, so a file
// that belongs to another matter cannot be attached to a packet by handle alone. A file from another
// FIRM is unreachable by construction — the database handle is already firm-scoped — but the check
// still runs, because "unreachable by construction" is a property worth asserting rather than
// assuming.
export function selectFileMatterStatement(database: SqlDatabase, fileId: FileId): SqlStatement {
  return database.prepare(`SELECT id, matter_id FROM ${FILE_TABLE} WHERE id = ?1`).bind(fileId);
}

export async function readFileMatter(
  database: SqlDatabase,
  fileId: FileId,
): Promise<{ id: FileId; matter_id: MatterId } | undefined> {
  const { results } = await selectFileMatterStatement(database, fileId).all<{
    id: FileId;
    matter_id: MatterId;
  }>();
  return results[0];
}
