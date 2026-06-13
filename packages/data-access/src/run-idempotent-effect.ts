import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";
import { commitEffectBatch, type BatchDatabase, type EffectWrite } from "./effect-batch.ts";
import { decideIdempotency, type IdempotencyRecordRow } from "./idempotency-decision.ts";
import {
  isIdempotencyKeyConflict,
  selectIdempotencyRecordStatement,
} from "./idempotency-statements.ts";

export type IdempotentEffectResult =
  | { kind: "executed"; responseCode: number; responseBody: string | null }
  | { kind: "replayed"; responseCode: number; responseBody: string | null }
  | { kind: "in-progress" } // map to 409 at the HTTP boundary
  | { kind: "fingerprint-mismatch" }; // map to 422 at the HTTP boundary

export interface IdempotentEffectOptions {
  database: BatchDatabase;
  // undefined = an optional route called without an Idempotency-Key: execute with no record.
  key: string | undefined;
  fingerprint: string;
  // The handler's effect. The default shape is SPECULATIVE: it prepares statements and describes
  // outbox messages but commits nothing — the commit happens here, in one atomic batch. An effect
  // MAY instead perform its own guarded, individually-idempotent commits along the way (the firm
  // provisioner's resumable steps), PROVIDED the response-bearing write rides the final atomic
  // batch with the idempotency record: a crash before that batch stores no record, so a retry
  // re-executes the effect and its own guards resume the remaining work.
  effect: () => Promise<{ write: EffectWrite; responseCode: number; responseBody: string | null }>;
  now?: () => string;
  newRecordId?: () => IdempotencyRecordId; // injectable for deterministic tests/fixtures
}

// The idempotency write path, realized for D1 (no interactive transactions):
//   pre-check -> speculative effect -> ONE batch [completed record, business writes, outbox rows].
// A concurrent duplicate hits the record's UNIQUE(key) and the WHOLE batch rolls back — the loser
// re-reads and replays the winner's stored response. Crash-between-effect-and-record is impossible
// by construction: they are one commit.
export async function runIdempotentEffect(
  options: IdempotentEffectOptions,
): Promise<IdempotentEffectResult> {
  const now = options.now ?? (() => new Date().toISOString());

  if (options.key === undefined) {
    const outcome = await options.effect();
    await commitEffectBatch(options.database, outcome.write, { now });
    return {
      kind: "executed",
      responseCode: outcome.responseCode,
      responseBody: outcome.responseBody,
    };
  }

  // Pre-check: replay / 409 / 422 without running the effect. Also the fast path for retries.
  const existing = await readRecord(options.database, options.key);
  const decision = decideIdempotency(existing, options.fingerprint);
  if (decision.kind !== "execute") return resultFromDecision(decision);

  // A THROWN effect (vs. a returned failure responseCode) propagates with nothing committed and NO
  // record stored — no response existed to replay, so a retry safely re-executes. The
  // "replay the failure" rule binds only stored failure responses the handler actually produced.
  const outcome = await options.effect();
  try {
    await commitEffectBatch(options.database, outcome.write, {
      now,
      idempotencyRecord: {
        id: (options.newRecordId ?? (() => newIdentifier("idempotencyRecord")))(),
        key: options.key,
        fingerprint: options.fingerprint,
        responseCode: outcome.responseCode,
        responseBody: outcome.responseBody,
        createdAt: now(),
      },
    });
  } catch (caught) {
    if (!isIdempotencyKeyConflict(caught)) throw caught;
    // Lost the race: our batch fully rolled back. Re-read and serve the winner's outcome.
    const winner = await readRecord(options.database, options.key);
    return resultFromDecision(decideIdempotency(winner, options.fingerprint));
  }
  return {
    kind: "executed",
    responseCode: outcome.responseCode,
    responseBody: outcome.responseBody,
  };
}

async function readRecord(
  database: BatchDatabase,
  key: string,
): Promise<IdempotencyRecordRow | undefined> {
  const { results } = await selectIdempotencyRecordStatement(
    database,
    key,
  ).all<IdempotencyRecordRow>();
  return results[0];
}

function resultFromDecision(
  decision: ReturnType<typeof decideIdempotency>,
): IdempotentEffectResult {
  switch (decision.kind) {
    case "replay":
      return {
        kind: "replayed",
        responseCode: decision.responseCode,
        responseBody: decision.responseBody,
      };
    case "in-progress":
      return { kind: "in-progress" };
    case "fingerprint-mismatch":
      return { kind: "fingerprint-mismatch" };
    case "execute":
      // Re-read after a UNIQUE conflict found no record: the winner vanished (e.g. TTL purge between
      // conflict and re-read) — astronomically unlikely; fail loud rather than re-run the effect.
      throw new Error(
        "idempotency record disappeared between the UNIQUE conflict and the re-read — refusing to re-run the effect",
      );
  }
}
