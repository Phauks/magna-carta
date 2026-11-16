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
// randomSource lets fixtures mint byte-deterministic ids. metadata carries non-privileged fields
// only (ids, verdicts, reasons) — never privileged content; omit or pass undefined for no metadata.
export interface DomainAuditInput {
  readonly event: string;
  readonly subjectId: string;
  readonly actorUserId: UserId | null;
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
  readonly metadata?: unknown;
}

// Composes the per-firm audit_log row for an effect batch, minting the audit-log id. metadata is
// optional — most events carry no metadata (the event, subject, actor, and instant are the record);
// pass metadata only for events that benefit from non-privileged extra context (verdicts, reasons).
// Every business domain (matters, file manager, locations, …) writes its audit rows through this
// one wrapper. (The divergent guarded auth-hook path is insertAuthAuditStatement, not this.)
export function domainAuditStatement(database: SqlDatabase, input: DomainAuditInput): SqlStatement {
  return insertAuditLogStatement(database, {
    id: newIdentifier("auditLog", input.randomSource),
    event: input.event,
    actorUserId: input.actorUserId,
    subjectId: input.subjectId,
    metadata: input.metadata ?? null,
    now: input.clock.now(),
  });
}

// THE CHANGE LOG READ: who changed which records, from the audit rows themselves, over a window of
// the row's own `created_at`. The caller names the events it covers (the Change Log report passes
// the directory, matters and trust-account maintenance events), so this read knows no domain's
// vocabulary and every domain keeps writing its own rows through domainAuditStatement above.
//
// METADATA NEVER LEAVES THIS READ. It is redacted at write time, but redacted means "no privileged
// content", not "fit to print on a report about people": a client-link row carries an entity handle,
// a decrypt row names a sealed field. The rows carry the event, the actor, the subject handle and the
// instant, and nothing else.
//
// Two statements, one window. The counts are an aggregate and are never short; the entries are the
// same rows newest first, capped with one probe row past the ceiling so a full list can be told from
// a truncated one. Both are bounded by the same `knownAtOrBefore` instant, so a row committed while
// the two run cannot land in one answer and not the other.
export const MAXIMUM_AUDIT_CHANGE_ENTRIES = 5000;

export interface AuditChangeWindow {
  readonly events: readonly string[];
  // The window on `created_at`: from (inclusive) to before (exclusive), each a stored instant.
  readonly fromInstant: string;
  readonly beforeInstant: string;
  // No row recorded after this instant is read (inclusive).
  readonly knownAtOrBefore: string;
}

export interface AuditChangeCount {
  readonly event: string;
  readonly actorUserId: UserId | null;
  readonly actorName: string | null;
  readonly count: number;
}

export interface AuditChangeEntry {
  readonly id: AuditLogId;
  readonly event: string;
  readonly actorUserId: UserId | null;
  readonly actorName: string | null;
  readonly subjectId: string | null;
  readonly at: string;
}

export interface AuditChanges {
  readonly counts: readonly AuditChangeCount[];
  readonly entries: readonly AuditChangeEntry[];
  readonly truncated: boolean;
}

export async function readAuditChanges(
  database: SqlDatabase,
  window: AuditChangeWindow,
): Promise<AuditChanges> {
  if (window.events.length === 0) return { counts: [], entries: [], truncated: false };
  const eventPlaceholders = window.events.map((_, index) => `?${String(index + 4)}`).join(", ");
  // Leads with the created_at index; the event list is a filter on the rows that walk finds.
  const where =
    `a.created_at >= ?1 AND a.created_at < ?2 AND a.created_at <= ?3 ` +
    `AND a.event IN (${eventPlaceholders})`;
  const bindings = [
    window.fromInstant,
    window.beforeInstant,
    window.knownAtOrBefore,
    ...window.events,
  ];
  // The actor's name is the member mirror's, and stays null for system rows and departed members.
  const actor = `LEFT JOIN member m ON m.user_id = a.actor_user_id`;

  const counted = await database
    .prepare(
      `SELECT a.event, a.actor_user_id, m.display_name AS actor_name, COUNT(*) AS change_count ` +
        `FROM ${AUDIT_LOG_TABLE} a ${actor} WHERE ${where} ` +
        `GROUP BY a.event, a.actor_user_id ORDER BY a.event, a.actor_user_id`,
    )
    .bind(...bindings)
    .all<{
      event: string;
      actor_user_id: UserId | null;
      actor_name: string | null;
      change_count: number;
    }>();

  const listed = await database
    .prepare(
      `SELECT a.id, a.event, a.actor_user_id, m.display_name AS actor_name, a.subject_id, a.created_at ` +
        `FROM ${AUDIT_LOG_TABLE} a ${actor} WHERE ${where} ` +
        `ORDER BY a.created_at DESC, a.id DESC LIMIT ${String(MAXIMUM_AUDIT_CHANGE_ENTRIES + 1)}`,
    )
    .bind(...bindings)
    .all<{
      id: AuditLogId;
      event: string;
      actor_user_id: UserId | null;
      actor_name: string | null;
      subject_id: string | null;
      created_at: string;
    }>();

  return {
    counts: counted.results.map((row) => ({
      event: row.event,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      count: row.change_count,
    })),
    entries: listed.results.slice(0, MAXIMUM_AUDIT_CHANGE_ENTRIES).map((row) => ({
      id: row.id,
      event: row.event,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      subjectId: row.subject_id,
      at: row.created_at,
    })),
    truncated: listed.results.length > MAXIMUM_AUDIT_CHANGE_ENTRIES,
  };
}
