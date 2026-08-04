import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import {
  IdempotencyConflictError,
  runDomainEffect,
} from "@magna-carta/data-access/run-domain-effect";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";

// The route's idempotency context, threaded into the committed batch through runConflictsEffect.
// Absent (an internal/fixture caller with no Idempotency-Key) means "execute once, store no record".
// The route supplies the chokepoint's already-firm-scoped derived key and the request fingerprint.
export interface ConflictsIdempotencyContext {
  readonly key: string;
  readonly fingerprint: string;
  readonly newRecordId?: () => IdempotencyRecordId; // injectable for deterministic fixtures
}

// Raised on a same-key retry that loses the commit race: a concurrent in-progress request (→ 409) or
// a key reused with a different payload (→ 422). Only reachable when an Idempotency-Key is supplied;
// the route maps `kind` through the shared idempotency-conflict problem mapping.
export class ConflictsIdempotencyConflictError extends Error {
  constructor(readonly kind: "in-progress" | "fingerprint-mismatch") {
    super(`conflicts mutation idempotency conflict: ${kind}`);
    this.name = "ConflictsIdempotencyConflictError";
  }
}

// What a conflicts mutation contributes to its batch: the prepared business statements, the outbox
// messages, the response code + body stored on the idempotency record, the value this call returns,
// and a parser that recovers that value from a stored body on a replay.
export interface BuiltConflictsMutation<T> {
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
  readonly responseCode: number;
  readonly responseBody: unknown;
  readonly value: T;
  readonly fromBody: (body: unknown) => T;
}

// The single seam every conflicts mutation commits through. A thin delegate over runDomainEffect —
// mirrors runDirectoryEffect so the two packages never drift. Do NOT reimplement the idempotency seam
// here; this wrapper exists only to rename the domain-generic error into a conflicts-named one so a
// caller's instanceof check stays package-local.
export async function runConflictsEffect<T>(
  database: BatchDatabase,
  idempotency: ConflictsIdempotencyContext | undefined,
  clock: { now(): string },
  build: () => BuiltConflictsMutation<T>,
): Promise<T> {
  try {
    const { value } = await runDomainEffect(database, idempotency, clock, "conflicts", build);
    return value;
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new ConflictsIdempotencyConflictError(error.kind);
    }
    throw error;
  }
}
