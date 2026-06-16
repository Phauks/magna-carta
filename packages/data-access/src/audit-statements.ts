import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { AuditLogId, UserId } from "@magna-carta/identifiers/types";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";
import { refuseUnredactedMetadata } from "./metadata-redaction.ts";

// Per-firm append-only audit log. Written in the same effect batch as the mutation it records, so an
// audit row the request's own commit cannot carry means the request must not succeed (the divergence
// from guarded hook-driven writes lives in auth-audit-statements.ts). metadata is redacted JSON —
// ids and non-privileged fields ONLY, NEVER privileged content. actor_user_id is null for
// system-originated events (e.g. provisioning); subject_id is the entity the event is about.

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. audit_log exists only in the per-firm database — the caller supplies that handle.
export const AUDIT_LOG_TABLE = "audit_log";

export interface AuditLogInput {
  readonly id: AuditLogId;
  readonly event: string; // e.g. 'matter.opened', 'location.created', 'file.version_committed'
  readonly actorUserId: UserId | null; // null for system-originated events
  readonly subjectId: string | null; // the entity acted on; null where there is no single subject
  readonly metadata: unknown; // ids + non-privileged fields ONLY; null/undefined = no metadata
  readonly now: string; // ISO-8601 instant
}

export function insertAuditLogStatement(database: SqlDatabase, input: AuditLogInput): SqlStatement {
  let metadata: string | null = null;
  if (input.metadata !== null && input.metadata !== undefined) {
    refuseUnredactedMetadata(input.metadata, AUDIT_LOG_TABLE);
    metadata = canonicalJsonStringify(input.metadata);
  }
  return database
    .prepare(
      `INSERT INTO ${AUDIT_LOG_TABLE} (id, event, actor_user_id, subject_id, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(input.id, input.event, input.actorUserId, input.subjectId, metadata, input.now);
}

// What a domain operation needs to write an audit row for an effect batch: the event, its subject,
// and the caller-supplied clock + actor (the service reads no clock and trusts no ambient identity).
// randomSource lets fixtures mint byte-deterministic ids.
export interface DomainAuditInput {
  readonly event: string;
  readonly subjectId: string;
  readonly actorUserId: UserId | null;
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for an effect batch, minting the audit-log id and leaving
// metadata null — the event, subject, actor, and instant are the record; a future audit subsystem
// enriches it. Every business domain (matters, file manager, locations, …) writes its audit rows
// through this one wrapper. (The divergent guarded auth-hook path is insertAuthAuditStatement, not
// this.)
export function domainAuditStatement(database: SqlDatabase, input: DomainAuditInput): SqlStatement {
  return insertAuditLogStatement(database, {
    id: newIdentifier("auditLog", input.randomSource),
    event: input.event,
    actorUserId: input.actorUserId,
    subjectId: input.subjectId,
    metadata: null,
    now: input.clock.now(),
  });
}
