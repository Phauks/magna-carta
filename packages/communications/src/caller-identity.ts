// The kept answer to "whose number is this, according to the telephone network".
//
// A caller-name lookup is billed per query, so the answer is stored the first time a member pays for
// it and read back for nothing every time the same number is typed again. This module holds the read
// and the write; asking the network is @magna-carta/caller-lookup's, and deciding WHEN to ask is the
// route's, which asks only when a member presses for it.
//
// WHAT THE AUDIT ROW SAYS. That a member spent the firm's money on a lookup, when, and through which
// engine — and not the number or the name. The same line communication-service.ts holds for the
// call log: who the firm was talking to is the content the record exists to hold, and the audit log
// is a compliance record with its own readers and its own retention.
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

const CALLER_IDENTITY_TABLE = "caller_identity";

/** A number in the two parts the store is keyed by. Digits only, no plus. */
export interface CallerIdentityNumber {
  readonly countryCallingCode: string;
  readonly nationalNumber: string;
}

/** What the network said, in the vocabulary of @magna-carta/caller-lookup's port. */
export interface CallerIdentityAnswer {
  readonly callerName: string | null;
  readonly lineType: string | null;
  readonly carrierName: string | null;
}

export interface StoredCallerIdentity extends CallerIdentityAnswer {
  readonly source: string;
  readonly lookedUpByUserId: string;
  readonly lookedUpAt: string;
}

interface CallerIdentityRow {
  readonly caller_name: string | null;
  readonly line_type: string | null;
  readonly carrier_name: string | null;
  readonly source: string;
  readonly looked_up_by_user_id: string;
  readonly looked_up_at: string;
}

/** The kept answer for a number, or null when nobody has paid to ask about it yet. */
export async function readCallerIdentity(
  database: SqlDatabase,
  number: CallerIdentityNumber,
): Promise<StoredCallerIdentity | null> {
  const row = await database
    .prepare(
      `SELECT caller_name, line_type, carrier_name, source, looked_up_by_user_id, looked_up_at
         FROM ${CALLER_IDENTITY_TABLE}
        WHERE country_calling_code = ?1 AND national_number = ?2`,
    )
    .bind(number.countryCallingCode, number.nationalNumber)
    .first<CallerIdentityRow>();
  if (row === null) return null;
  return {
    callerName: row.caller_name,
    lineType: row.line_type,
    carrierName: row.carrier_name,
    source: row.source,
    lookedUpByUserId: row.looked_up_by_user_id,
    lookedUpAt: row.looked_up_at,
  };
}

export interface RecordCallerIdentityOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

/**
 * Keeps what the network said about a number, replacing any older answer for it.
 *
 * An upsert rather than an insert: a second lookup of the same number is only ever made on purpose
 * (the surface offers none while an answer is held), and when it is, the newer answer is the one
 * worth showing. Two members pressing at the same instant both write the same number's row, and the
 * later write simply wins — there is nothing to reconcile between two answers to one question.
 */
export function recordCallerIdentity(
  database: SqlDatabase,
  number: CallerIdentityNumber,
  answer: CallerIdentityAnswer,
  source: string,
  options: RecordCallerIdentityOptions,
): { stored: StoredCallerIdentity; effect: EffectWrite } {
  const now = options.clock.now();
  const stored: StoredCallerIdentity = {
    callerName: answer.callerName,
    lineType: answer.lineType,
    carrierName: answer.carrierName,
    source,
    lookedUpByUserId: options.actorUserId,
    lookedUpAt: now,
  };
  return {
    stored,
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${CALLER_IDENTITY_TABLE}
               (country_calling_code, national_number, caller_name, line_type, carrier_name, source,
                looked_up_by_user_id, looked_up_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT (country_calling_code, national_number) DO UPDATE SET
               caller_name = excluded.caller_name,
               line_type = excluded.line_type,
               carrier_name = excluded.carrier_name,
               source = excluded.source,
               looked_up_by_user_id = excluded.looked_up_by_user_id,
               looked_up_at = excluded.looked_up_at`,
          )
          .bind(
            number.countryCallingCode,
            number.nationalNumber,
            answer.callerName,
            answer.lineType,
            answer.carrierName,
            source,
            options.actorUserId,
            now,
          ),
        insertAuditLogStatement(database, {
          id: newIdentifier("auditLog", options.randomSource),
          event: "communications.callerIdentity.lookedUp",
          actorUserId: options.actorUserId,
          // No single subject: the row is keyed by a number, and the number is exactly what this
          // log is kept free of.
          subjectId: null,
          metadata: { source, lineType: answer.lineType, nameFound: answer.callerName !== null },
          now,
        }),
      ],
      outboxMessages: [],
    },
  };
}
