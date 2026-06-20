import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import {
  runIdempotentEffect,
  type IdempotentEffectResult,
} from "@magna-carta/data-access/run-idempotent-effect";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { IdempotencyRecordId, UserId } from "@magna-carta/identifiers/types";

// The options every custom-field mutation receives: a clock (the service reads no ambient time),
// the actor (null for system-originated writes), an optional deterministic random source (fixtures),
// and an optional idempotency context (absent = execute once, store no record).
export interface CustomFieldWriteOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
  readonly idempotency?: {
    readonly key: string | undefined;
    readonly fingerprint: string;
    readonly newRecordId?: () => IdempotencyRecordId;
  };
}

// Raised when a same-key retry loses the commit race: a concurrent in-progress request (→ 409) or
// a key reused with a different payload (→ 422). Only reachable when an Idempotency-Key is supplied;
// the route maps `kind` through the shared idempotency-conflict problem mapping.
export class CustomFieldIdempotencyConflictError extends Error {
  constructor(readonly kind: "in-progress" | "fingerprint-mismatch") {
    super(`custom-field mutation idempotency conflict: ${kind}`);
    this.name = "CustomFieldIdempotencyConflictError";
  }
}

// The replay marker carried on every mutation result: true when the response came from a stored
// idempotency record rather than this call's execution (the route sets Idempotency-Replayed).
export interface ReplayFlag {
  readonly idempotentReplay: boolean;
}

// What a built mutation contributes to its batch plus the value it returns to the caller (and
// stores as the idempotency response body so a replay returns the identical value).
export interface BuiltCustomFieldMutation<T> {
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
  readonly value: T;
}

function finishCustomFieldResult<T>(result: IdempotentEffectResult): T & ReplayFlag {
  switch (result.kind) {
    case "executed":
    case "replayed": {
      const value = JSON.parse(result.responseBody ?? "{}") as T;
      return { ...value, idempotentReplay: result.kind === "replayed" };
    }
    case "in-progress":
      throw new CustomFieldIdempotencyConflictError("in-progress");
    case "fingerprint-mismatch":
      throw new CustomFieldIdempotencyConflictError("fingerprint-mismatch");
  }
}

// The single seam every custom-field mutation commits through. When an idempotency context is
// present it routes the batch through runIdempotentEffect (writing the completed idempotency record
// + storing the response body in the same atomic commit, so a retry deduplicates). When absent it
// commits with no record. Mirrors runMatterEffect from packages/matters/src/matter-service.ts so
// the two never drift.
export async function runCustomFieldEffect<T>(
  database: BatchDatabase,
  options: CustomFieldWriteOptions,
  responseCode: number,
  build: () => BuiltCustomFieldMutation<T>,
): Promise<T & ReplayFlag> {
  const result = await runIdempotentEffect({
    database,
    key: options.idempotency?.key,
    fingerprint: options.idempotency?.fingerprint ?? "",
    newRecordId: options.idempotency?.newRecordId,
    now: () => options.clock.now(),
    effect: () => {
      const built = build();
      return Promise.resolve({
        write: { statements: built.statements, outboxMessages: built.outboxMessages },
        responseCode,
        responseBody: canonicalJsonStringify(built.value),
      });
    },
  });
  return finishCustomFieldResult<T>(result);
}
