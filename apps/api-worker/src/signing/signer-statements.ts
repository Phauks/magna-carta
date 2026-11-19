import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  SigningFieldId,
  SigningRequestId,
  SigningSignerId,
} from "@magna-carta/identifiers/types";
import type { RequestStatus, SignerStatus } from "@magna-carta/signing/request";
import { SIGNING_FIELD_TABLE, SIGNING_REQUEST_TABLE, SIGNING_SIGNER_TABLE } from "./statements.ts";

// The statements an outside signer's acts write, and the reads their lane and routes make. Kept apart
// from ./statements.ts, which is what a member's acts write, because these columns hold the link's
// digest and the access code's digest and nothing a member reads should come near them.

/** The most wrong codes a signer may enter against one code before asking for another. */
export const MAXIMUM_ACCESS_CODE_ATTEMPTS = 5;

export interface SignerLinkState {
  readonly tokenSecretHash: string | null;
  readonly secretVersion: number;
  readonly signerStatus: SignerStatus;
  readonly requestStatus: RequestStatus;
  readonly expiresAt: string;
}

/** What the lane checks a link against: the signer's digest and version, and the request's state. */
export async function readSignerLinkState(
  database: SqlDatabase,
  requestId: SigningRequestId,
  signerId: SigningSignerId,
): Promise<SignerLinkState | undefined> {
  const { results } = await database
    .prepare(
      `SELECT s.token_secret_hash, s.secret_version, s.status AS signer_status, r.status AS request_status, r.expires_at FROM ${SIGNING_SIGNER_TABLE} s JOIN ${SIGNING_REQUEST_TABLE} r ON r.id = s.request_id WHERE s.id = ? AND s.request_id = ? LIMIT 1`,
    )
    .bind(signerId, requestId)
    .all<{
      token_secret_hash: string | null;
      secret_version: number;
      signer_status: string;
      request_status: string;
      expires_at: string;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    tokenSecretHash: row.token_secret_hash,
    secretVersion: row.secret_version,
    signerStatus: row.signer_status as SignerStatus,
    requestStatus: row.request_status as RequestStatus,
    expiresAt: row.expires_at,
  };
}

export interface SignerProgress {
  readonly accessCodeHash: string | null;
  readonly accessCodeExpiresAt: string | null;
  readonly accessCodeAttempts: number;
  readonly identityVerifiedAt: string | null;
}

/** The signer's access-code progress; read only by the signer's own routes. */
export async function readSignerProgress(
  database: SqlDatabase,
  signerId: SigningSignerId,
): Promise<SignerProgress | undefined> {
  const { results } = await database
    .prepare(
      `SELECT access_code_hash, access_code_expires_at, access_code_attempts, identity_verified_at FROM ${SIGNING_SIGNER_TABLE} WHERE id = ? LIMIT 1`,
    )
    .bind(signerId)
    .all<{
      access_code_hash: string | null;
      access_code_expires_at: string | null;
      access_code_attempts: number;
      identity_verified_at: string | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    accessCodeHash: row.access_code_hash,
    accessCodeExpiresAt: row.access_code_expires_at,
    accessCodeAttempts: row.access_code_attempts,
    identityVerifiedAt: row.identity_verified_at,
  };
}

/** Record the digest of a signer's link secret, as the link is first mailed. */
// fitness:unguarded-write — the digest at one version is always the same, so a repeat writes the same value.
export function setSignerLinkStatement(
  database: SqlDatabase,
  signerId: SigningSignerId,
  secretHash: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET token_secret_hash = ?, updated_at = ? WHERE id = ? AND attribution_level != 'firm-authenticated'`,
    )
    .bind(secretHash, now, signerId);
}

/** A fresh code replaces the one before it and starts its tries again. */
// fitness:unguarded-write — a fresh code replaces the last by design; verification ends the window.
export function recordAccessCodeStatement(
  database: SqlDatabase,
  signerId: SigningSignerId,
  codeHash: string,
  expiresAt: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET access_code_hash = ?, access_code_expires_at = ?, access_code_attempts = 0, updated_at = ? WHERE id = ? AND identity_verified_at IS NULL`,
    )
    .bind(codeHash, expiresAt, now, signerId);
}

/** One wrong code, counted only while tries remain; guarded, so a burst cannot spend more. */
export function countAccessCodeAttemptStatement(
  database: SqlDatabase,
  signerId: SigningSignerId,
  attemptsRead: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET access_code_attempts = access_code_attempts + 1, updated_at = ? WHERE id = ? AND access_code_attempts = ? AND access_code_attempts < ?`,
    )
    .bind(now, signerId, attemptsRead, MAXIMUM_ACCESS_CODE_ATTEMPTS);
}

/** The right code: identity verified, and the code spent. */
export function markIdentityVerifiedStatement(
  database: SqlDatabase,
  signerId: SigningSignerId,
  attemptsRead: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET identity_verified_at = ?, access_code_hash = NULL, access_code_expires_at = NULL, updated_at = ? WHERE id = ? AND identity_verified_at IS NULL AND access_code_attempts = ?`,
    )
    .bind(now, now, signerId, attemptsRead);
}

/** The signer agreed to sign electronically, under one version of the disclosure. */
export function recordConsentStatement(
  database: SqlDatabase,
  signerId: SigningSignerId,
  disclosureVersion: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET consent_disclosure_version = ?, consented_at = ?, updated_at = ? WHERE id = ? AND consented_at IS NULL AND status IN ('notified', 'opened')`,
    )
    .bind(disclosureVersion, now, now, signerId);
}

/** The signature and initials the signer adopted, as object keys in the firm's bucket. */
export function recordAdoptionStatement(
  database: SqlDatabase,
  signerId: SigningSignerId,
  adoption: "typed" | "drawn" | "uploaded",
  signatureObjectKey: string,
  initialsObjectKey: string | null,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_SIGNER_TABLE} SET adoption = ?, signature_object_key = ?, initials_object_key = ?, updated_at = ? WHERE id = ? AND status IN ('notified', 'opened')`,
    )
    .bind(adoption, signatureObjectKey, initialsObjectKey, now, signerId);
}

/** A field's answer, written as the signer finishes, and only on a field of theirs. */
// fitness:unguarded-write — written only inside the finish batch, whose signer step is the guard.
export function setFieldValueStatement(
  database: SqlDatabase,
  fieldId: SigningFieldId,
  signerId: SigningSignerId,
  value: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SIGNING_FIELD_TABLE} SET value_text = ?, updated_at = ? WHERE id = ? AND signer_id = ?`,
    )
    .bind(value, now, fieldId, signerId);
}
