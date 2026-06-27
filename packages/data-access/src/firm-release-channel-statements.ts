import type { FirmId } from "@magna-carta/identifiers/types";
import type { ReleaseChannel } from "@magna-carta/feature-flags/port";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// The firm's release channel lives in the control-plane firm registry — one row of truth for both
// write doors (firm-admin beta toggle and the platform alpha grant).

const FIRM_TABLE = "firm";

export function writeFirmReleaseChannelStatement(
  database: SqlDatabase,
  firmId: FirmId,
  channel: ReleaseChannel,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FIRM_TABLE} SET release_channel = ?2 WHERE id = ?1`)
    .bind(firmId, channel);
}

export function readFirmReleaseChannelStatement(
  database: SqlDatabase,
  firmId: FirmId,
): SqlStatement {
  return database.prepare(`SELECT release_channel FROM ${FIRM_TABLE} WHERE id = ?1`).bind(firmId);
}
