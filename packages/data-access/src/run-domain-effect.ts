import { canonicalJsonStringify } from "./canonical.ts";
import type { BatchDatabase, EffectWrite } from "./effect-batch.ts";
import { runIdempotentEffect, type IdempotentEffectResult } from "./run-idempotent-effect.ts";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";

// The route's idempotency context. key === undefined means "no Idempotency-Key" — execute once, store
// no record. The route supplies the chokepoint's already-firm-scoped derived key and the fingerprint.
export interface DomainIdempotencyContext {
  readonly key: string | undefined;
  readonly fingerprint: string;
  readonly newRecordId?: () => IdempotencyRecordId;
}

// Raised on a same-key retry that loses the commit race: a concurrent in-progress request (→ 409) or a
// key reused with a different payload (→ 422). Carries the domain so a package wrapper can rethrow its
// own domain-named error and preserve route instanceof checks.
export class IdempotencyConflictError extends Error {
  constructor(
    readonly domain: string,
    readonly kind: "in-progress" | "fingerprint-mismatch",
  ) {
    super(`${domain} mutation idempotency conflict: ${kind}`);
    this.name = "IdempotencyConflictError";
  }
}

// What a built mutation contributes to its batch: the statements + outbox, the response code and wire
// body stored on the idempotency record, the value the caller receives on an executed commit, and a
// parser that recovers that value from the stored body on a replay. When a package's value already IS
// its wire body, fromBody is the identity.
export interface BuiltEffect<T> {
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
  readonly responseCode: number;
  readonly responseBody: unknown;
  readonly value: T;
  readonly fromBody: (body: unknown) => T;
}

export interface DomainEffectOutcome<T> {
  readonly value: T;
  readonly idempotentReplay: boolean;
}

// The single non-drawing-mutation seam shared by every domain package. Commits [idempotency record,
// business write] in one atomic batch through runIdempotentEffect when a key is present, or commits
// with no record when absent. On an executed commit it returns the freshly-built value; on a replay it
// recovers the winner's value from the stored body via fromBody, so a retry returns what the first
// commit recorded rather than this loser's freshly-minted value.
export async function runDomainEffect<T>(
  database: BatchDatabase,
  idempotency: DomainIdempotencyContext | undefined,
  clock: { now(): string },
  domain: string,
  build: () => BuiltEffect<T>,
): Promise<DomainEffectOutcome<T>> {
  // build() runs eagerly, before runIdempotentEffect decides execute-vs-replay, because the replayed
  // branch below needs built.fromBody to recover the winner's value from the stored body — and on a
  // replay the effect closure never runs, so fromBody has to be captured up front. The cost: on a
  // replay or conflict outcome the built statements are discarded unexecuted, and any id a build()
  // mints (e.g. an audit-log id) is a wasted draw. Harmless with default crypto-random ids; a caller
  // that threads one deterministic, sequential RandomSource across several idempotent calls and hits a
  // replay would see that discarded draw shift its later ids — pass such callers independent sources.
  const built = build();
  const result: IdempotentEffectResult = await runIdempotentEffect({
    database,
    key: idempotency?.key,
    fingerprint: idempotency?.fingerprint ?? "",
    newRecordId: idempotency?.newRecordId,
    now: () => clock.now(),
    effect: () =>
      Promise.resolve({
        write: { statements: built.statements, outboxMessages: built.outboxMessages },
        responseCode: built.responseCode,
        responseBody: canonicalJsonStringify(built.responseBody),
      }),
  });

  switch (result.kind) {
    case "executed":
      return { value: built.value, idempotentReplay: false };
    case "replayed":
      return { value: built.fromBody(JSON.parse(result.responseBody ?? "{}")), idempotentReplay: true };
    case "in-progress":
      throw new IdempotencyConflictError(domain, "in-progress");
    case "fingerprint-mismatch":
      throw new IdempotencyConflictError(domain, "fingerprint-mismatch");
  }
}
