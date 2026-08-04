import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_TABLE } from "./matter-statements.ts";

// A SYSTEM matter is a platform-owned row that exists to satisfy a structural requirement rather
// than to hold a client engagement. It is excluded from every matter list, carries no number, and is
// never billed. There is exactly one per firm per key, enforced by the partial unique index on
// matter.system_key.
//
// The one key today is the custody holding matter. A scanned copy of an original the firm holds for
// someone with no matter still has to be an ordinary File Manager file — that is the only path to
// one quarantine gate, one hold mechanism, one preview pipeline, and one set of consumer behaviours
// — and `file.matter_id` is NOT NULL. Filing those scans onto one marked system matter answers the
// requirement honestly, at the cost of one row per firm; the alternative, relaxing file.matter_id to
// nullable, would weaken an invariant seven subsystems depend on for one consumer's convenience.
export const SYSTEM_MATTER_KEYS = {
  custodyHolding: "custody-holding",
} as const;

export type SystemMatterKey = (typeof SYSTEM_MATTER_KEYS)[keyof typeof SYSTEM_MATTER_KEYS];

// The titles a firm sees if a system matter ever surfaces in a diagnostic view. Plain, so nobody has
// to guess what the row is for.
const SYSTEM_MATTER_TITLES: Record<SystemMatterKey, string> = {
  [SYSTEM_MATTER_KEYS.custodyHolding]: "Custody holding",
};

export function selectSystemMatterStatement(
  database: SqlDatabase,
  systemKey: SystemMatterKey,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${MATTER_TABLE} WHERE system_key = ?1`).bind(systemKey);
}

export async function readSystemMatterId(
  database: SqlDatabase,
  systemKey: SystemMatterKey,
): Promise<MatterId | undefined> {
  const { results } = await selectSystemMatterStatement(database, systemKey).all<{
    id: MatterId;
  }>();
  return results[0]?.id;
}

// Creates the system matter. A plain INSERT rather than ON CONFLICT DO NOTHING, deliberately: the
// caller composes this into a batch that also writes the row REFERENCING the new matter, so a
// silently-skipped insert would leave that reference pointing at a matter id nobody ever stored.
// Letting the partial unique index abort the loser's whole batch is the honest outcome — the loser
// retries, reads the winner's row, and references it. isSystemMatterConflict names that outcome so a
// caller's bounded retry can tell it apart from a real failure. Status is 'open' and no number is
// drawn: a system matter never touches the numbering counter, so it can never consume a value a real
// matter would have had.
export function insertSystemMatterStatement(
  database: SqlDatabase,
  row: {
    readonly id: MatterId;
    readonly systemKey: SystemMatterKey;
    readonly responsibleMemberId: UserId;
    readonly createdAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TABLE} (id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?5, ?5, ?5)`,
    )
    .bind(
      row.id,
      SYSTEM_MATTER_TITLES[row.systemKey],
      row.responsibleMemberId,
      row.systemKey,
      row.createdAt,
    );
}

// A concurrent first use of the same system key landed first. Retryable: the retry's read finds the
// winner's row and composes no insert at all.
export function isSystemMatterConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MATTER_TABLE}.system_key`)
  );
}

export interface EnsureSystemMatterOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly responsibleMemberId: UserId;
  readonly randomSource?: RandomSource;
}

// Resolves the firm's system matter for a key, returning the id plus the statements that create it
// when it does not exist yet. The statements ride the caller's own effect batch, so the row and
// whatever needed it commit together or not at all; when the matter already exists the statement
// list is empty and the call costs one indexed read.
export async function ensureSystemMatter(
  database: SqlDatabase,
  systemKey: SystemMatterKey,
  options: EnsureSystemMatterOptions,
): Promise<{ matterId: MatterId; effect: EffectWrite }> {
  const existing = await readSystemMatterId(database, systemKey);
  if (existing !== undefined) {
    return { matterId: existing, effect: { statements: [], outboxMessages: [] } };
  }
  const matterId = newIdentifier("matter", options.randomSource);
  const now = options.clock.now();
  return {
    matterId,
    effect: {
      statements: [
        insertSystemMatterStatement(database, {
          id: matterId,
          systemKey,
          responsibleMemberId: options.responsibleMemberId,
          createdAt: now,
        }),
        domainAuditStatement(database, {
          event: "matter.systemProvisioned",
          subjectId: matterId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { systemKey },
        }),
      ],
      outboxMessages: [],
    },
  };
}
