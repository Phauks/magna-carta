import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FileId,
  FileVersionId,
  MatterId,
  SigningEventId,
  SigningFieldId,
  SigningRequestId,
  SigningSignerId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  SIGNING_EVENT_KINDS,
  type AttributionLevel,
  type SigningEventKind,
} from "@magna-carta/signing/esign";
import type {
  RequestStatus,
  SignerStatus,
  SigningFieldKind,
  SigningOrder,
} from "@magna-carta/signing/request";

// SQL statement builders for the four signing tables. This module composes statements and runs
// bounded reads; it holds no binding and crosses no firm, because the caller supplies the firm's own
// database handle. Every read is LIMITed.
//
// Rects are stored in hundredths of a point and converted here, so nothing above this module ever
// sees the stored scale.

export const SIGNING_REQUEST_TABLE = "signing_request";
export const SIGNING_SIGNER_TABLE = "signing_signer";
export const SIGNING_FIELD_TABLE = "signing_field";
export const SIGNING_EVENT_TABLE = "signing_event";

/** The most signers one request may name, and the most fields; both far past any real document. */
export const MAXIMUM_SIGNERS = 20;
export const MAXIMUM_FIELDS = 400;
/** The most activity lines one read returns. */
export const MAXIMUM_EVENTS = 1000;

export interface SigningRequestRow {
  readonly id: SigningRequestId;
  readonly matterId: MatterId;
  readonly fileId: FileId;
  readonly fileVersionId: FileVersionId;
  readonly documentHashSha256: string | null;
  readonly title: string;
  readonly subject: string;
  readonly message: string;
  readonly signingOrder: SigningOrder;
  readonly status: RequestStatus;
  readonly expiresAt: string;
  readonly remindEveryDays: number | null;
  readonly lastRemindedAt: string | null;
  readonly createdByUserId: UserId;
  readonly sentAt: string | null;
  readonly completedAt: string | null;
  readonly sealedAt: string | null;
  readonly voidedReason: string | null;
  readonly signedFileVersionId: FileVersionId | null;
  readonly certificateFileId: FileId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SigningSignerRow {
  readonly id: SigningSignerId;
  readonly requestId: SigningRequestId;
  readonly position: number;
  readonly name: string;
  readonly email: string;
  readonly attributionLevel: AttributionLevel;
  readonly userId: UserId | null;
  readonly status: SignerStatus;
  readonly notifiedAt: string | null;
  readonly openedAt: string | null;
  readonly signedAt: string | null;
  readonly declinedAt: string | null;
  readonly declineReason: string | null;
  readonly secretVersion: number;
  readonly consentDisclosureVersion: string | null;
  readonly consentedAt: string | null;
  readonly adoption: "typed" | "drawn" | "uploaded" | null;
  readonly signatureObjectKey: string | null;
  readonly initialsObjectKey: string | null;
}

export interface SigningFieldRow {
  readonly id: SigningFieldId;
  readonly requestId: SigningRequestId;
  readonly signerId: SigningSignerId;
  readonly kind: SigningFieldKind;
  readonly page: number;
  readonly rect: readonly [left: number, bottom: number, right: number, top: number];
  readonly required: boolean;
  readonly valueText: string | null;
}

export interface SigningEventRow {
  readonly id: SigningEventId;
  readonly requestId: SigningRequestId;
  readonly signerId: SigningSignerId | null;
  readonly kind: SigningEventKind;
  readonly at: string;
  readonly actor: string | null;
  readonly observedIp: string | null;
  readonly userAgent: string | null;
  readonly detail: string | null;
}

/** Points to the stored hundredths. */
export function toStoredScale(points: number): number {
  return Math.round(points * 100);
}

function fromStoredScale(stored: number): number {
  return stored / 100;
}

const REQUEST_COLUMNS =
  "id, matter_id, file_id, file_version_id, document_hash_sha256, title, subject, message, signing_order, status, expires_at, remind_every_days, last_reminded_at, created_by_user_id, sent_at, completed_at, sealed_at, voided_reason, signed_file_version_id, certificate_file_id, created_at, updated_at";

interface RequestDatabaseRow {
  id: string;
  matter_id: string;
  file_id: string;
  file_version_id: string;
  document_hash_sha256: string | null;
  title: string;
  subject: string;
  message: string;
  signing_order: string;
  status: string;
  expires_at: string;
  remind_every_days: number | null;
  last_reminded_at: string | null;
  created_by_user_id: string;
  sent_at: string | null;
  completed_at: string | null;
  sealed_at: string | null;
  voided_reason: string | null;
  signed_file_version_id: string | null;
  certificate_file_id: string | null;
  created_at: string;
  updated_at: string;
}

function requestFromRow(row: RequestDatabaseRow): SigningRequestRow {
  return {
    id: row.id as SigningRequestId,
    matterId: row.matter_id as MatterId,
    fileId: row.file_id as FileId,
    fileVersionId: row.file_version_id as FileVersionId,
    documentHashSha256: row.document_hash_sha256,
    title: row.title,
    subject: row.subject,
    message: row.message,
    signingOrder: row.signing_order as SigningOrder,
    status: row.status as RequestStatus,
    expiresAt: row.expires_at,
    remindEveryDays: row.remind_every_days,
    lastRemindedAt: row.last_reminded_at,
    createdByUserId: row.created_by_user_id as UserId,
    sentAt: row.sent_at,
    completedAt: row.completed_at,
    sealedAt: row.sealed_at,
    voidedReason: row.voided_reason,
    signedFileVersionId: row.signed_file_version_id as FileVersionId | null,
    certificateFileId: row.certificate_file_id as FileId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertRequestStatement(
  database: SqlDatabase,
  request: Pick<
    SigningRequestRow,
    | "id"
    | "matterId"
    | "fileId"
    | "fileVersionId"
    | "title"
    | "subject"
    | "message"
    | "signingOrder"
    | "expiresAt"
    | "remindEveryDays"
    | "createdByUserId"
    | "createdAt"
  >,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SIGNING_REQUEST_TABLE} (id, matter_id, file_id, file_version_id, title, subject, message, signing_order, status, expires_at, remind_every_days, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    )
    .bind(
      request.id,
      request.matterId,
      request.fileId,
      request.fileVersionId,
      request.title,
      request.subject,
      request.message,
      request.signingOrder,
      request.expiresAt,
      request.remindEveryDays,
      request.createdByUserId,
      request.createdAt,
      request.createdAt,
    );
}

/** A draft's settings. Matches nothing once the request has been sent. */
export function updateDraftSettingsStatement(
  database: SqlDatabase,
  id: SigningRequestId,
  settings: Pick<
    SigningRequestRow,
    "subject" | "message" | "signingOrder" | "expiresAt" | "remindEveryDays"
  >,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_REQUEST_TABLE} SET subject = ?, message = ?, signing_order = ?, expires_at = ?, remind_every_days = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
    )
    .bind(
      settings.subject,
      settings.message,
      settings.signingOrder,
      settings.expiresAt,
      settings.remindEveryDays,
      now,
      id,
    );
}

/**
 * Clearing a draft's fields and signers before writing them again. Only a draft: nothing a signer
 * was ever shown is deleted, and the WHERE holds that line even if the caller's read was stale.
 */
export function clearDraftStatements(database: SqlDatabase, id: SigningRequestId): SqlStatement[] {
  const draft = `request_id = ? AND EXISTS (SELECT 1 FROM ${SIGNING_REQUEST_TABLE} WHERE id = ? AND status = 'draft')`;
  return [
    database.prepare(`DELETE FROM ${SIGNING_FIELD_TABLE} WHERE ${draft}`).bind(id, id),
    database.prepare(`DELETE FROM ${SIGNING_SIGNER_TABLE} WHERE ${draft}`).bind(id, id),
  ];
}

export function insertSignerStatement(
  database: SqlDatabase,
  signer: Pick<
    SigningSignerRow,
    "id" | "requestId" | "position" | "name" | "email" | "attributionLevel" | "userId"
  >,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SIGNING_SIGNER_TABLE} (id, request_id, position, name, email, attribution_level, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
    )
    .bind(
      signer.id,
      signer.requestId,
      signer.position,
      signer.name,
      signer.email,
      signer.attributionLevel,
      signer.userId,
      now,
      now,
    );
}

export function insertFieldStatement(
  database: SqlDatabase,
  field: Omit<SigningFieldRow, "valueText">,
  now: string,
): SqlStatement {
  const [left, bottom, right, top] = field.rect;
  return database
    .prepare(
      `INSERT INTO ${SIGNING_FIELD_TABLE} (id, request_id, signer_id, kind, page, rect_left_e2, rect_bottom_e2, rect_right_e2, rect_top_e2, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      field.id,
      field.requestId,
      field.signerId,
      field.kind,
      field.page,
      toStoredScale(left),
      toStoredScale(bottom),
      toStoredScale(right),
      toStoredScale(top),
      field.required ? 1 : 0,
      now,
      now,
    );
}

export function insertEventStatement(database: SqlDatabase, event: SigningEventRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SIGNING_EVENT_TABLE} (id, request_id, signer_id, kind, at, actor, observed_ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      event.requestId,
      event.signerId,
      event.kind,
      event.at,
      event.actor,
      event.observedIp,
      event.userAgent,
      event.detail,
    );
}

/** Send a draft: records the hash of the bytes sent. Matches nothing unless still a draft. */
export function markSentStatement(
  database: SqlDatabase,
  id: SigningRequestId,
  documentHashSha256: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_REQUEST_TABLE} SET status = 'sent', document_hash_sha256 = ?, sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
    )
    .bind(documentHashSha256, now, now, id);
}

/** Move a request from one status to another, guarded on the status it was read in. */
export function updateRequestStatusStatement(
  database: SqlDatabase,
  id: SigningRequestId,
  from: RequestStatus,
  to: RequestStatus,
  now: string,
  voidedReason: string | null = null,
): SqlStatement {
  const completed = to === "completed" ? ", completed_at = ?" : "";
  const values: unknown[] = [to, voidedReason, now];
  if (to === "completed") values.push(now);
  values.push(id, from);
  return database
    .prepare(
      `UPDATE ${SIGNING_REQUEST_TABLE} SET status = ?, voided_reason = COALESCE(?, voided_reason), updated_at = ?${completed} WHERE id = ? AND status = ?`,
    )
    .bind(...values);
}

export function markRemindedStatement(
  database: SqlDatabase,
  id: SigningRequestId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_REQUEST_TABLE} SET last_reminded_at = ?, updated_at = ? WHERE id = ? AND status = 'sent'`,
    )
    .bind(now, now, id);
}

const SIGNER_STATUS_COLUMN: Partial<Record<SignerStatus, string>> = {
  notified: "notified_at",
  opened: "opened_at",
  signed: "signed_at",
  declined: "declined_at",
};

/** Move a signer from one status to another, stamping when, guarded on the status it was read in. */
export function updateSignerStatusStatement(
  database: SqlDatabase,
  id: SigningSignerId,
  from: SignerStatus,
  to: SignerStatus,
  now: string,
  declineReason: string | null = null,
): SqlStatement {
  const column = SIGNER_STATUS_COLUMN[to];
  const stamp = column === undefined ? "" : `, ${column} = ?`;
  const values: unknown[] = [to, declineReason, now];
  if (column !== undefined) values.push(now);
  values.push(id, from);
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET status = ?, decline_reason = COALESCE(?, decline_reason), updated_at = ?${stamp} WHERE id = ? AND status = ?`,
    )
    .bind(...values);
}

export async function readRequest(
  database: SqlDatabase,
  id: SigningRequestId,
): Promise<SigningRequestRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM ${SIGNING_REQUEST_TABLE} WHERE id = ? LIMIT 1`)
    .bind(id)
    .all<RequestDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : requestFromRow(row);
}

/** The requests on one file, newest first. */
export async function listRequestsForFile(
  database: SqlDatabase,
  fileId: FileId,
  limit = 50,
): Promise<SigningRequestRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${REQUEST_COLUMNS} FROM ${SIGNING_REQUEST_TABLE} WHERE file_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(fileId, Math.min(Math.max(limit, 1), 200))
    .all<RequestDatabaseRow>();
  return results.map(requestFromRow);
}

interface SignerDatabaseRow {
  id: string;
  request_id: string;
  position: number;
  name: string;
  email: string;
  attribution_level: string;
  user_id: string | null;
  status: string;
  notified_at: string | null;
  opened_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  secret_version: number;
  consent_disclosure_version: string | null;
  consented_at: string | null;
  adoption: string | null;
  signature_object_key: string | null;
  initials_object_key: string | null;
}

export async function readSigners(
  database: SqlDatabase,
  requestId: SigningRequestId,
): Promise<SigningSignerRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, request_id, position, name, email, attribution_level, user_id, status, notified_at, opened_at, signed_at, declined_at, decline_reason, secret_version, consent_disclosure_version, consented_at, adoption, signature_object_key, initials_object_key FROM ${SIGNING_SIGNER_TABLE} WHERE request_id = ? ORDER BY position LIMIT ?`,
    )
    .bind(requestId, MAXIMUM_SIGNERS)
    .all<SignerDatabaseRow>();
  return results.map((row) => ({
    id: row.id as SigningSignerId,
    requestId: row.request_id as SigningRequestId,
    position: row.position,
    name: row.name,
    email: row.email,
    attributionLevel: row.attribution_level as AttributionLevel,
    userId: row.user_id as UserId | null,
    status: row.status as SignerStatus,
    notifiedAt: row.notified_at,
    openedAt: row.opened_at,
    signedAt: row.signed_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason,
    secretVersion: row.secret_version,
    consentDisclosureVersion: row.consent_disclosure_version,
    consentedAt: row.consented_at,
    adoption: row.adoption as SigningSignerRow["adoption"],
    signatureObjectKey: row.signature_object_key,
    initialsObjectKey: row.initials_object_key,
  }));
}

interface FieldDatabaseRow {
  id: string;
  request_id: string;
  signer_id: string;
  kind: string;
  page: number;
  rect_left_e2: number;
  rect_bottom_e2: number;
  rect_right_e2: number;
  rect_top_e2: number;
  required: number;
  value_text: string | null;
}

export async function readFields(
  database: SqlDatabase,
  requestId: SigningRequestId,
): Promise<SigningFieldRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, request_id, signer_id, kind, page, rect_left_e2, rect_bottom_e2, rect_right_e2, rect_top_e2, required, value_text FROM ${SIGNING_FIELD_TABLE} WHERE request_id = ? ORDER BY page, rect_top_e2 DESC, rect_left_e2, id LIMIT ?`,
    )
    .bind(requestId, MAXIMUM_FIELDS)
    .all<FieldDatabaseRow>();
  return results.map((row) => ({
    id: row.id as SigningFieldId,
    requestId: row.request_id as SigningRequestId,
    signerId: row.signer_id as SigningSignerId,
    kind: row.kind as SigningFieldKind,
    page: row.page,
    rect: [
      fromStoredScale(row.rect_left_e2),
      fromStoredScale(row.rect_bottom_e2),
      fromStoredScale(row.rect_right_e2),
      fromStoredScale(row.rect_top_e2),
    ],
    required: row.required === 1,
    valueText: row.value_text,
  }));
}

interface EventDatabaseRow {
  id: string;
  request_id: string;
  signer_id: string | null;
  kind: string;
  at: string;
  actor: string | null;
  observed_ip: string | null;
  user_agent: string | null;
  detail: string | null;
}

/** The request's activity, oldest first; steps sharing an instant in the order they happen. */
export async function readEvents(
  database: SqlDatabase,
  requestId: SigningRequestId,
): Promise<SigningEventRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, request_id, signer_id, kind, at, actor, observed_ip, user_agent, detail FROM ${SIGNING_EVENT_TABLE} WHERE request_id = ? ORDER BY at, id LIMIT ?`,
    )
    .bind(requestId, MAXIMUM_EVENTS)
    .all<EventDatabaseRow>();
  const rank = (kind: string) => SIGNING_EVENT_KINDS.indexOf(kind as SigningEventKind);
  const ordered = results.toSorted(
    (first, second) => first.at.localeCompare(second.at) || rank(first.kind) - rank(second.kind),
  );
  return ordered.map((row) => ({
    id: row.id as SigningEventId,
    requestId: row.request_id as SigningRequestId,
    signerId: row.signer_id as SigningSignerId | null,
    kind: row.kind as SigningEventKind,
    at: row.at,
    actor: row.actor,
    observedIp: row.observed_ip,
    userAgent: row.user_agent,
    detail: row.detail,
  }));
}

// The two file tables this module reads and never writes, by their names in the per-firm schema.
const FILE_TABLE = "file";
const FILE_VERSION_TABLE = "file_version";

/** A file's current clean version, as a request is drafted on it. */
export interface FileForSigning {
  readonly fileId: FileId;
  readonly matterId: MatterId;
  readonly name: string;
  readonly versionId: FileVersionId;
  readonly r2Key: string;
  readonly sha256: string | null;
  readonly contentType: string | null;
}

/** A live file whose current version is clean, or undefined. */
export async function readFileForSigning(
  database: SqlDatabase,
  fileId: FileId,
): Promise<FileForSigning | undefined> {
  const { results } = await database
    .prepare(
      `SELECT f.id AS file_id, f.matter_id, f.name, v.id AS version_id, v.r2_key, v.content_sha256, COALESCE(v.sniffed_content_type, v.declared_content_type) AS content_type FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ? AND f.deleted_at IS NULL AND v.status = 'clean' LIMIT 1`,
    )
    .bind(fileId)
    .all<{
      file_id: string;
      matter_id: string;
      name: string;
      version_id: string;
      r2_key: string;
      content_sha256: string | null;
      content_type: string | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    fileId: row.file_id as FileId,
    matterId: row.matter_id as MatterId,
    name: row.name,
    versionId: row.version_id as FileVersionId,
    r2Key: row.r2_key,
    sha256: row.content_sha256,
    contentType: row.content_type,
  };
}

/** The r2 key of the exact version a request was drafted on. */
export async function readVersionObjectKey(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<string | undefined> {
  const { results } = await database
    .prepare(`SELECT r2_key FROM ${FILE_VERSION_TABLE} WHERE id = ? AND status = 'clean' LIMIT 1`)
    .bind(versionId)
    .all<{ r2_key: string }>();
  return results[0]?.r2_key;
}

/** A member's display name, written as the actor on what they do to a request. */
export async function readMemberName(database: SqlDatabase, userId: UserId): Promise<string> {
  const { results } = await database
    .prepare("SELECT display_name FROM member WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .all<{ display_name: string }>();
  return results[0]?.display_name ?? "A firm member";
}
