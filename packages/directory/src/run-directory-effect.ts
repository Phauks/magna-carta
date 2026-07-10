import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import {
  IdempotencyConflictError,
  runDomainEffect,
} from "@magna-carta/data-access/run-domain-effect";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";

// The route's idempotency context, threaded into the committed batch through runIdempotentEffect.
// Absent (an internal/fixture caller with no Idempotency-Key) means "execute once, store no record".
// The route supplies the chokepoint's already-firm-scoped derived key and the request fingerprint.
export interface DirectoryIdempotencyContext {
  readonly key: string;
  readonly fingerprint: string;
  readonly newRecordId?: () => IdempotencyRecordId; // injectable for deterministic fixtures
}

// Raised on a same-key retry that loses the commit race: a concurrent in-progress request (→ 409) or
// a key reused with a different payload (→ 422). Only reachable when an Idempotency-Key is supplied;
// the route maps `kind` through the shared idempotency-conflict problem mapping. The COMMON replay /
// conflict path is answered by the chokepoint idempotency middleware before a handler runs — this
// fires only on the rare handler-level commit race runIdempotentEffect re-decides.
export class DirectoryIdempotencyConflictError extends Error {
  constructor(readonly kind: "in-progress" | "fingerprint-mismatch") {
    super(`directory mutation idempotency conflict: ${kind}`);
    this.name = "DirectoryIdempotencyConflictError";
  }
}

// What a directory mutation contributes to its batch: the prepared business statements, the outbox
// messages, the response code + body stored on the idempotency record, the value this call returns,
// and a parser that recovers that value from a stored body on a replay. responseBody is the route's
// serialized shape (e.g. createPerson's `{ id }`), so the stored replay matches the wire response;
// fromBody recovers the bare value (the id) from it so a replayed retry returns the WINNER's value,
// not this loser's freshly-minted one.
export interface BuiltDirectoryMutation<T> {
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
  readonly responseCode: number;
  readonly responseBody: unknown;
  readonly value: T;
  readonly fromBody: (body: unknown) => T;
}

// The single seam every directory mutation commits through. WHEN an idempotency context is present it
// routes the batch through runIdempotentEffect (writing the completed idempotency record + storing the
// response body in the SAME atomic commit, so a retry dedups), and WHEN absent it commits with no
// record — the load profile, the migration, and the fixture callers keep working unchanged. Mirrors
// the matters service's runMatterEffect so the two never drift.
export async function runDirectoryEffect<T>(
  database: BatchDatabase,
  idempotency: DirectoryIdempotencyContext | undefined,
  clock: { now(): string },
  build: () => BuiltDirectoryMutation<T>,
): Promise<T> {
  try {
    const { value } = await runDomainEffect(database, idempotency, clock, "directory", build);
    return value;
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new DirectoryIdempotencyConflictError(error.kind);
    }
    throw error;
  }
}
