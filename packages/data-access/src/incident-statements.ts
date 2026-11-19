/*
 * A firm's problem reports (the per-firm `incident` table): the reads an answerer and a reporter make,
 * the answer's write, and the screenshot's one write.
 *
 * The reporter's words and the answerer's note are sealed under the firm key and are opened only
 * through `readProtected` (protected-fields.ts), which writes the decrypt audit row first. Everything
 * else on the row is redacted by construction: Error IDs, breadcrumb actions and routes, the build.
 */
import type { UserId } from "@magna-carta/identifiers/types";
import {
  composeProtectedWrite,
  readProtected,
  type ProtectedContext,
  type ProtectedReadContext,
} from "./protected-fields.ts";
import { incidentDescription, incidentStatusNote } from "./protected-field-registry.ts";
import { guarded, type GuardedStatement } from "./effect-batch.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

export const INCIDENT_TABLE = "incident";

// The outbox topics a report raises: one when it is filed, one each time it is answered. Exported
// here, beside the table, so the notification registry and the routes that commit them spell them
// from one place; an unrecognized topic on the per-firm bus is acked and ignored, so a second
// spelling would not throw, it would just stop delivering.
export const INCIDENT_CREATED_TOPIC = "incident.created";
export const INCIDENT_ANSWERED_TOPIC = "incident.answered";
export const INCIDENT_OUTBOX_TOPICS = [INCIDENT_CREATED_TOPIC, INCIDENT_ANSWERED_TOPIC] as const;

/** The states a report moves through. `open` is shown as Received. */
export const INCIDENT_STATUSES = ["open", "investigating", "fixed", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === "string" && (INCIDENT_STATUSES as readonly string[]).includes(value);
}

/** The most reports one list read returns, newest first. */
export const INCIDENT_LIST_LIMIT = 50;

// Read shape, snake_case as stored.
export type IncidentRow = {
  readonly id: string;
  readonly error_ids: string;
  readonly breadcrumbs: string;
  readonly description_ciphertext: string | null;
  readonly context: string;
  readonly screenshot_key: string | null;
  readonly status: string;
  readonly status_note_ciphertext: string | null;
  readonly status_changed_at: string | null;
  readonly status_changed_by: string | null;
  readonly reported_by: string;
  readonly created_at: string;
  readonly reporter_name: string | null;
  readonly answerer_name: string | null;
};

const SELECT =
  `SELECT incident.id, incident.error_ids, incident.breadcrumbs, incident.description_ciphertext, ` +
  `incident.context, incident.screenshot_key, incident.status, incident.status_note_ciphertext, ` +
  `incident.status_changed_at, incident.status_changed_by, incident.reported_by, incident.created_at, ` +
  `reporter.display_name AS reporter_name, answerer.display_name AS answerer_name ` +
  `FROM ${INCIDENT_TABLE} incident ` +
  `LEFT JOIN member reporter ON reporter.user_id = incident.reported_by ` +
  `LEFT JOIN member answerer ON answerer.user_id = incident.status_changed_by`;

/** Every report in the firm, newest first. */
export function selectIncidentsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(`${SELECT} ORDER BY incident.created_at DESC LIMIT ?1`)
    .bind(INCIDENT_LIST_LIMIT);
}

/** One member's own reports, newest first. */
export function selectIncidentsReportedByStatement(
  database: SqlDatabase,
  reportedBy: UserId,
): SqlStatement {
  return database
    .prepare(`${SELECT} WHERE incident.reported_by = ?1 ORDER BY incident.created_at DESC LIMIT ?2`)
    .bind(reportedBy, INCIDENT_LIST_LIMIT);
}

export function selectIncidentStatement(database: SqlDatabase, incidentId: string): SqlStatement {
  return database.prepare(`${SELECT} WHERE incident.id = ?1 LIMIT 1`).bind(incidentId);
}

export async function readIncident(
  database: SqlDatabase,
  incidentId: string,
): Promise<IncidentRow | undefined> {
  return (await selectIncidentStatement(database, incidentId).first<IncidentRow>()) ?? undefined;
}

/**
 * The read context a reporter opens their OWN report with. A reporter holds no
 * incidents:viewDescription, and should not: that permission opens everyone's reports. Their own
 * words, and the answer to them, are theirs to read, so the grant is added for that one row only,
 * here, where the row's author has been checked. The decrypt is audited like any other.
 */
export function reporterReadContext(
  context: ProtectedReadContext,
  row: Pick<IncidentRow, "reported_by">,
): ProtectedReadContext | null {
  if (context.actorUserId === null || row.reported_by !== context.actorUserId) return null;
  return {
    ...context,
    effectivePermissions: new Set([
      ...context.effectivePermissions,
      incidentDescription.permission,
    ]),
  };
}

/** The reporter's words. */
export function readIncidentDescription(
  context: ProtectedReadContext,
  row: IncidentRow,
): Promise<string | null> {
  return readProtected(context, incidentDescription, row, row.id);
}

/** The answerer's note, where one was left. */
export function readIncidentStatusNote(
  context: ProtectedReadContext,
  row: IncidentRow,
): Promise<string | null> {
  return readProtected(context, incidentStatusNote, row, row.id);
}

/**
 * The answer's write: the status, who set it and when, and the note sealed under the firm key (or
 * cleared, when the answer carries none). Sealed before the statement is built, as every protected
 * write is.
 */
export async function answerIncidentStatement(
  database: SqlDatabase,
  context: ProtectedContext,
  answer: {
    readonly incidentId: string;
    readonly status: IncidentStatus;
    readonly note: string | null;
    readonly answeredBy: UserId;
    readonly now: string;
  },
): Promise<SqlStatement> {
  const sealed =
    answer.note === null
      ? null
      : (await composeProtectedWrite(context, incidentStatusNote, answer.incidentId, answer.note))
          .ciphertextValue;
  return database
    .prepare(
      `UPDATE ${INCIDENT_TABLE} SET status = ?2, status_note_ciphertext = ?3, ` +
        `status_changed_at = ?4, status_changed_by = ?5 WHERE id = ?1`,
    )
    .bind(answer.incidentId, answer.status, sealed, answer.now, answer.answeredBy);
}

/**
 * The screenshot's one write: only where none is recorded yet, so a second upload cannot replace
 * what the answerer may already have looked at. Guarded: matching no row means another upload got
 * there first, and the caller refuses this one.
 */
export const INCIDENT_SCREENSHOT_GUARD = "incident-screenshot-already-attached";

export function recordIncidentScreenshotStatement(
  database: SqlDatabase,
  incidentId: string,
  objectKey: string,
): GuardedStatement {
  return guarded(
    database
      .prepare(
        `UPDATE ${INCIDENT_TABLE} SET screenshot_key = ?2 WHERE id = ?1 AND screenshot_key IS NULL`,
      )
      .bind(incidentId, objectKey),
    INCIDENT_SCREENSHOT_GUARD,
  );
}

/**
 * Where a report's screenshot is kept in the firm's bucket. Each upload has its own key, so two
 * uploads racing for one report never write the same object: the one whose row lands is kept, and
 * the other's object is removed.
 */
export function incidentScreenshotObjectKey(
  incidentId: string,
  uploadToken: string,
  extension: string,
): string {
  return `incidents/${incidentId}/screenshot-${uploadToken}.${extension}`;
}
