/*
 * Problem reports a firm shares with Magna Carta, kept in the control plane: the firm's switch
 * (`firm.shares_problem_reports`) and one row per report sent while it was on
 * (`shared_problem_report`). A row holds the report's address and its redacted facts only. The
 * words and the picture stay in the firm's own database and bucket and are opened one report at a
 * time, through the audited read in incident-statements.ts.
 */
import type { FirmId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

export const SHARED_PROBLEM_REPORT_TABLE = "shared_problem_report";

/** The most shared reports one list read returns, newest first. */
export const SHARED_PROBLEM_REPORT_LIST_LIMIT = 100;

export function selectFirmSharesProblemReportsStatement(
  database: SqlDatabase,
  firmId: FirmId,
): SqlStatement {
  return database.prepare("SELECT shares_problem_reports FROM firm WHERE id = ?1").bind(firmId);
}

/** Whether the firm shares its problem reports. A firm with no row shares nothing. */
export async function firmSharesProblemReports(
  database: SqlDatabase,
  firmId: FirmId,
): Promise<boolean> {
  const row = await selectFirmSharesProblemReportsStatement(database, firmId).first<{
    shares_problem_reports: number;
  }>();
  return row?.shares_problem_reports === 1;
}

/**
 * Turning the switch. Off also withdraws every report shared so far, in the same batch, so the
 * operator's list never shows a report the firm has stopped sharing.
 */
export function setFirmSharesProblemReportsStatements(
  database: SqlDatabase,
  firmId: FirmId,
  shares: boolean,
): SqlStatement[] {
  const set = database
    .prepare("UPDATE firm SET shares_problem_reports = ?2 WHERE id = ?1")
    .bind(firmId, shares ? 1 : 0);
  if (shares) return [set];
  return [
    set,
    database.prepare(`DELETE FROM ${SHARED_PROBLEM_REPORT_TABLE} WHERE firm_id = ?1`).bind(firmId),
  ];
}

export interface SharedProblemReportInput {
  readonly incidentId: string;
  readonly firmId: FirmId;
  readonly sentAt: string;
  readonly route: string | null;
  readonly errorIdCount: number;
  readonly status: string;
}

/** Shares one report. Only where the firm's switch is on at the moment of the write. */
export function insertSharedProblemReportStatement(
  database: SqlDatabase,
  report: SharedProblemReportInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${SHARED_PROBLEM_REPORT_TABLE} ` +
        "(incident_id, firm_id, sent_at, route, error_id_count, status) " +
        "SELECT ?1, ?2, ?3, ?4, ?5, ?6 FROM firm WHERE id = ?2 AND shares_problem_reports = 1",
    )
    .bind(
      report.incidentId,
      report.firmId,
      report.sentAt,
      report.route,
      report.errorIdCount,
      report.status,
    );
}

/** Keeps a shared report's status current when the firm answers it. A no-op for an unshared one. */
// fitness:unguarded-write — matching no row means the report was never shared, which is the outcome the caller wants.
export function updateSharedProblemReportStatusStatement(
  database: SqlDatabase,
  firmId: FirmId,
  incidentId: string,
  status: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHARED_PROBLEM_REPORT_TABLE} SET status = ?3 WHERE firm_id = ?1 AND incident_id = ?2`,
    )
    .bind(firmId, incidentId, status);
}

// Read shape, snake_case as stored.
export interface SharedProblemReportRow {
  readonly incident_id: string;
  readonly firm_id: string;
  readonly firm_name: string;
  readonly bucket_name: string | null;
  readonly sent_at: string;
  readonly route: string | null;
  readonly error_id_count: number;
  readonly status: string;
}

const SELECT =
  `SELECT shared.incident_id, shared.firm_id, COALESCE(firm.display_name, firm.name) AS firm_name, firm.bucket_name, ` +
  `shared.sent_at, shared.route, shared.error_id_count, shared.status ` +
  `FROM ${SHARED_PROBLEM_REPORT_TABLE} shared JOIN firm ON firm.id = shared.firm_id ` +
  `WHERE firm.shares_problem_reports = 1`;

/** Every shared report, newest first. */
export function selectSharedProblemReportsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(`${SELECT} ORDER BY shared.sent_at DESC LIMIT ?1`)
    .bind(SHARED_PROBLEM_REPORT_LIST_LIMIT);
}

/** One shared report, only while the firm still shares. */
export function selectSharedProblemReportStatement(
  database: SqlDatabase,
  firmId: FirmId,
  incidentId: string,
): SqlStatement {
  return database
    .prepare(`${SELECT} AND shared.firm_id = ?1 AND shared.incident_id = ?2 LIMIT 1`)
    .bind(firmId, incidentId);
}
