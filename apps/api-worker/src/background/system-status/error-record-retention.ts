/*
 * The error record's retention pass, on the daily Cron. One bounded statement against the control
 * plane: every record older than the retention window goes. The record exists so an Error ID a
 * member quotes can be looked up while it still matters; a month is longer than anyone waits to
 * report a failure, and keeping it longer would make the table a history of every refusal ever
 * answered, which nobody asked for.
 */
import {
  deleteErrorRecordsBeforeStatement,
  ERROR_RECORD_RETENTION_DAYS,
} from "@magna-carta/data-access/error-record-statements";
import type { Bindings } from "../../bindings.ts";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Delete records past the window. Returns how many went. */
export async function runErrorRecordRetentionSweep(
  env: Pick<Bindings, "DB_CONTROL">,
  now: number = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - ERROR_RECORD_RETENTION_DAYS * DAY_MILLISECONDS).toISOString();
  const { meta } = await deleteErrorRecordsBeforeStatement(env.DB_CONTROL, cutoff).run();
  return meta.changes;
}
