import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";
import {
  IdempotencyConflictError,
  runDomainEffect,
} from "@magna-carta/data-access/run-domain-effect";
import {
  runIdempotentEffect,
  type IdempotentEffectResult,
} from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { matterAuditStatement } from "./audit.ts";
import { runClosePreconditions, ClosePreconditionError } from "./close-preconditions.ts";
import {
  closeMatterStatement,
  insertMatterStatement,
  isMatterNumberConflict,
  type MatterFields,
  type MatterRow,
  openMatterStatement,
  reopenMatterStatement,
  renumberMatterStatement,
  selectActiveSchemeStatement,
  selectMatterStatement,
  updateMatterFieldsStatement,
} from "./matter-statements.ts";
import {
  ensureCounterRowStatement,
  guardedIncrementStatement,
  readCounterValue,
} from "./numbering/counter-statements.ts";
import { deriveScopeKey, renderMatterNumber, type RenderContext } from "./numbering/render.ts";
import {
  type NumberSegment,
  numberingSchemeSchema,
  URL_SAFE_PATTERN,
} from "./numbering/segments.ts";
import { MatterValidationError } from "./validation.ts";

// The matter shell on the ledger pattern, extended for number allocation: where a number is drawn,
// the read-render-commit runs under a bounded retry. A concurrent draw makes one batch lose the
// matter_number UNIQUE race and roll back; the retry re-reads the now-advanced counter and renders
// the next number. The UNIQUE index is the load-bearing backstop, not the guarded increment alone.
//
// Idempotency rides the SAME single primitive every mutating route uses (runIdempotentEffect): each
// mutation's write + its idempotency record commit in one atomic batch, and the response body is
// built in the effect closure — the only place the generated handle (matterId) and the drawn number
// are known before the commit. A number draw nests the retry AROUND runIdempotentEffect: a
// matter_number collision rolls the whole batch back (record included) and rethrows, so the loop
// advances the counter out of band and re-runs the effect; an idempotency-key collision (a concurrent
// duplicate of the SAME request) is handled inside runIdempotentEffect, which replays the winner.
// When no Idempotency-Key is supplied (fixtures, internal callers), runIdempotentEffect simply commits
// with no record — so the draw and lifecycle logic are identical whether or not a key is present.

const DEFAULT_MAX_ATTEMPTS = 5;

export interface ClockPort {
  now(): string;
  today(): string; // ISO civil date for the number draw
}

// The route's idempotency context, threaded into the committed batch through runIdempotentEffect.
// key === undefined means "no Idempotency-Key" — execute once, store no record. The route supplies
// the chokepoint's already-firm-scoped derived key and the request fingerprint.
export interface MatterIdempotencyContext {
  readonly key: string | undefined;
  readonly fingerprint: string;
  readonly newRecordId?: () => IdempotencyRecordId; // injectable for deterministic fixtures
}

export interface MatterServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
  readonly maxAttempts?: number;
  // Absent = an internal/fixture caller with no Idempotency-Key (execute once, no record).
  readonly idempotency?: MatterIdempotencyContext;
}

// The strings the route assembles from the matter's Location, type, and client for the number draw
// (decided: the renderer never reads those tables). openedDate is filled by the service from the clock.
export type NumberContext = Omit<RenderContext, "openedDate">;

// Raised when a required-idempotency mutation hits a concurrent in-progress request (→ 409) or a key
// reused with a different payload (→ 422). Only reachable when an Idempotency-Key is supplied; the
// route maps `kind` through the shared idempotency-conflict problem mapping.
export class MatterIdempotencyConflictError extends Error {
  constructor(readonly kind: "in-progress" | "fingerprint-mismatch") {
    super(`matter mutation idempotency conflict: ${kind}`);
    this.name = "MatterIdempotencyConflictError";
  }
}

const auditStatement = matterAuditStatement;

function requireNonEmptyTitle(title: string): void {
  if (title.trim().length === 0) {
    throw new MatterValidationError("empty-matter-title", "a matter needs a title");
  }
}

async function loadMatter(database: SqlDatabase, id: MatterId): Promise<MatterRow | undefined> {
  const { results } = await selectMatterStatement(database, id).all<{
    id: MatterId;
    title: string;
    description: string | null;
    status: MatterRow["status"];
    matter_type_id: MatterTypeId | null;
    location_id: LocationId | null;
    responsible_member_id: UserId;
    client_display_name: string | null;
    client_code: string | null;
    matter_number: string | null;
    opened_at: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    matterTypeId: row.matter_type_id,
    locationId: row.location_id,
    responsibleMemberId: row.responsible_member_id,
    clientDisplayName: row.client_display_name,
    clientCode: row.client_code,
    matterNumber: row.matter_number,
    openedAt: row.opened_at,
  };
}

interface ActiveScheme {
  readonly segments: readonly NumberSegment[];
  readonly startValue: number;
}

async function loadActiveScheme(database: SqlDatabase): Promise<ActiveScheme> {
  const { results } = await selectActiveSchemeStatement(database).all<{ segments: string }>();
  const row = results[0];
  if (row === undefined) {
    throw new MatterValidationError("scheme-missing", "no active numbering scheme is configured");
  }
  const segments = numberingSchemeSchema.parse(JSON.parse(row.segments));
  const counter = segments.find((segment) => segment.kind === "counter");
  // numberingSchemeSchema guarantees exactly one counter; the start defaults to 1.
  const startValue = counter?.start ?? 1;
  return { segments, startValue };
}

// What a built mutation contributes to its batch plus the value it returns to the caller (and stores
// as the idempotency response body — so a replay returns the identical value).
interface BuiltMutation<T> {
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
  readonly value: T;
}

// The replay marker carried on every mutation result: true when the response came from a stored
// idempotency record rather than this call's execution (the route sets Idempotency-Replayed).
export interface ReplayFlag {
  readonly idempotentReplay: boolean;
}

function finishMatterResult<T>(result: IdempotentEffectResult): T & ReplayFlag {
  switch (result.kind) {
    case "executed":
    case "replayed": {
      const value = JSON.parse(result.responseBody ?? "{}") as T;
      return { ...value, idempotentReplay: result.kind === "replayed" };
    }
    case "in-progress":
      throw new MatterIdempotencyConflictError("in-progress");
    case "fingerprint-mismatch":
      throw new MatterIdempotencyConflictError("fingerprint-mismatch");
  }
}

// A non-drawing mutation: build the write + value, commit [record, write] in one batch through the
// shared idempotency primitive.
async function runMatterEffect<T>(
  database: BatchDatabase,
  options: MatterServiceOptions,
  responseCode: number,
  build: () => BuiltMutation<T>,
): Promise<T & ReplayFlag> {
  try {
    const { value, idempotentReplay } = await runDomainEffect(
      database,
      options.idempotency,
      { now: () => options.clock.now() },
      "matter",
      () => {
        const built = build();
        // The matters value IS its wire body, so responseBody = value and fromBody is identity.
        return {
          statements: built.statements,
          outboxMessages: built.outboxMessages,
          responseCode,
          responseBody: built.value,
          value: built.value,
          fromBody: (body: unknown) => body as T,
        };
      },
    );
    return { ...(value as object), idempotentReplay } as T & ReplayFlag;
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new MatterIdempotencyConflictError(error.kind);
    }
    throw error;
  }
}

// The bounded-retry number draw over the shared idempotency primitive: read the active scheme +
// counter, render, and commit the ensure-row + guarded increment + matter write as one batch. A
// collision (a concurrent winner or a parked manual number on the rendered value) aborts the batch on
// the matter_number UNIQUE index and rethrows; because the in-batch increment rolls back with it, the
// counter is advanced OUT OF BAND so the retry renders a fresh number — a no-op when a concurrent
// winner already advanced it. An idempotency-key collision is handled inside runIdempotentEffect.
async function runMatterDraw<T>(
  database: BatchDatabase,
  options: MatterServiceOptions,
  numberContext: NumberContext,
  build: (matterNumber: string, now: string) => BuiltMutation<T>,
  responseCode: number,
): Promise<T & ReplayFlag> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Set inside the effect closure (which always runs before any commit throw), so the catch can
    // advance the same scope's counter out of band.
    let scopeKey = "";
    let observed = 0;
    let startValue = 0;
    try {
      const result = await runIdempotentEffect({
        database,
        key: options.idempotency?.key,
        fingerprint: options.idempotency?.fingerprint ?? "",
        newRecordId: options.idempotency?.newRecordId,
        now: () => options.clock.now(),
        effect: async () => {
          const scheme = await loadActiveScheme(database);
          const context: RenderContext = { openedDate: options.clock.today(), ...numberContext };
          scopeKey = deriveScopeKey(scheme.segments, context);
          startValue = scheme.startValue;
          observed = (await readCounterValue(database, scopeKey)) ?? scheme.startValue;
          const matterNumber = renderMatterNumber(scheme.segments, context, observed);
          const built = build(matterNumber, options.clock.now());
          return {
            write: {
              statements: [
                ensureCounterRowStatement(database, scopeKey, startValue),
                guardedIncrementStatement(database, scopeKey, observed),
                ...built.statements,
              ],
              outboxMessages: built.outboxMessages,
            },
            responseCode,
            responseBody: canonicalJsonStringify(built.value),
          };
        },
      });
      return finishMatterResult<T>(result);
    } catch (caught) {
      if (!isMatterNumberConflict(caught)) throw caught;
      lastError = caught;
      // Advance past the taken value out of band (the in-batch increment rolled back). Guarded on
      // the observed value, so a concurrent winner that already advanced the counter no-ops here.
      await ensureCounterRowStatement(database, scopeKey, startValue).run();
      await guardedIncrementStatement(database, scopeKey, observed).run();
    }
  }
  throw new Error(
    `matter number allocation did not converge after ${maxAttempts} attempts: ${String(lastError)}`,
  );
}

function fieldsFromInput(input: MatterFieldsInput, existing?: MatterFields): MatterFields {
  return {
    title: input.title ?? existing?.title ?? "",
    description:
      input.description !== undefined ? input.description : (existing?.description ?? null),
    matterTypeId:
      input.matterTypeId !== undefined ? input.matterTypeId : (existing?.matterTypeId ?? null),
    locationId: input.locationId !== undefined ? input.locationId : (existing?.locationId ?? null),
    responsibleMemberId: input.responsibleMemberId ?? existing?.responsibleMemberId,
    clientDisplayName:
      input.clientDisplayName !== undefined
        ? input.clientDisplayName
        : (existing?.clientDisplayName ?? null),
    clientCode: input.clientCode !== undefined ? input.clientCode : (existing?.clientCode ?? null),
  } as MatterFields;
}

interface MatterFieldsInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly matterTypeId?: MatterTypeId | null;
  readonly locationId?: LocationId | null;
  readonly responsibleMemberId?: UserId;
  readonly clientDisplayName?: string | null;
  readonly clientCode?: string | null;
}

export interface CreateMatterInput extends MatterFieldsInput {
  readonly title: string;
  readonly responsibleMemberId: UserId;
  readonly status: "prospective" | "open";
  readonly numberContext?: NumberContext;
}

export interface CreatedMatter {
  readonly matterId: MatterId;
  readonly matterNumber: string | null;
}

export async function createMatter(
  database: BatchDatabase,
  input: CreateMatterInput,
  options: MatterServiceOptions,
): Promise<CreatedMatter & ReplayFlag> {
  requireNonEmptyTitle(input.title);
  const matterId = newIdentifier("matter", options.randomSource);
  const fields = fieldsFromInput(input);

  if (input.status === "prospective") {
    // A consultation: no number, no counter touched.
    return runMatterEffect<CreatedMatter>(database, options, 201, () => {
      const now = options.clock.now();
      return {
        statements: [
          insertMatterStatement(database, {
            id: matterId,
            ...fields,
            status: "prospective",
            matterNumber: null,
            numberedAt: null,
            openedAt: null,
            createdAt: now,
          }),
          auditStatement(database, options, "matter.created", matterId),
        ],
        outboxMessages: [{ topic: "matter.created", payload: { matterId } }],
        value: { matterId, matterNumber: null },
      };
    });
  }

  // status === "open": draw the number at creation (the existing-client common case).
  return runMatterDraw<CreatedMatter>(
    database,
    options,
    input.numberContext ?? {},
    (number, now) => ({
      statements: [
        insertMatterStatement(database, {
          id: matterId,
          ...fields,
          status: "open",
          matterNumber: number,
          numberedAt: now,
          openedAt: now,
          createdAt: now,
        }),
        auditStatement(database, options, "matter.created", matterId),
      ],
      outboxMessages: [
        { topic: "matter.created", payload: { matterId } },
        { topic: "matter.opened", payload: { matterId, matterNumber: number } },
      ],
      value: { matterId, matterNumber: number },
    }),
    201,
  );
}

export interface OpenMatterInput {
  readonly numberContext?: NumberContext;
}

export async function openMatter(
  database: BatchDatabase,
  matterId: MatterId,
  input: OpenMatterInput,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId; matterNumber: string } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (matter.status !== "prospective") {
    throw new MatterValidationError(
      "matter-not-prospective",
      `matter ${matterId} is ${matter.status}, not prospective`,
    );
  }
  return runMatterDraw<{ matterId: MatterId; matterNumber: string }>(
    database,
    options,
    input.numberContext ?? {},
    (number, now) => ({
      statements: [
        openMatterStatement(database, matterId, number, now),
        auditStatement(database, options, "matter.opened", matterId),
      ],
      outboxMessages: [{ topic: "matter.opened", payload: { matterId, matterNumber: number } }],
      value: { matterId, matterNumber: number },
    }),
    200,
  );
}

export async function closeMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  const failures = await runClosePreconditions({ matterId, database });
  if (failures.length > 0) throw new ClosePreconditionError(failures);
  return runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
    const now = options.clock.now();
    return {
      statements: [
        closeMatterStatement(database, matterId, now),
        auditStatement(database, options, "matter.closed", matterId),
      ],
      outboxMessages: [{ topic: "matter.closed", payload: { matterId } }],
      value: { matterId },
    };
  });
}

export async function reopenMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (matter.status !== "closed") {
    throw new MatterValidationError(
      "matter-not-closed",
      `matter ${matterId} is ${matter.status}, not closed`,
    );
  }
  // Restore the pre-close status from the honest signal — opened_at, set only when a matter was
  // actually opened. A consultation handed a manual number via renumberMatter has a number but was
  // never opened, so it reopens to prospective; the number, if any, is frozen and untouched.
  const status = matter.openedAt !== null ? "open" : "prospective";
  return runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
    const now = options.clock.now();
    return {
      statements: [
        reopenMatterStatement(database, matterId, status, now),
        auditStatement(database, options, "matter.reopened", matterId),
      ],
      outboxMessages: [{ topic: "matter.reopened", payload: { matterId } }],
      value: { matterId },
    };
  });
}

export async function updateMatter(
  database: BatchDatabase,
  matterId: MatterId,
  patch: MatterFieldsInput,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  const merged = fieldsFromInput(patch, matter);
  requireNonEmptyTitle(merged.title);
  return runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
    const now = options.clock.now();
    return {
      statements: [
        updateMatterFieldsStatement(database, matterId, merged, now),
        auditStatement(database, options, "matter.updated", matterId),
      ],
      outboxMessages: [{ topic: "matter.updated", payload: { matterId } }],
      value: { matterId },
    };
  });
}

export async function renumberMatter(
  database: BatchDatabase,
  matterId: MatterId,
  matterNumber: string,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (!URL_SAFE_PATTERN.test(matterNumber)) {
    throw new MatterValidationError(
      "matter-number-not-url-safe",
      `matter number is not URL-safe: ${matterNumber}`,
    );
  }
  try {
    // A manual number is the caller's choice — a collision is terminal, not retryable.
    return await runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
      const now = options.clock.now();
      return {
        statements: [
          renumberMatterStatement(database, matterId, matterNumber, now),
          auditStatement(database, options, "matter.renumbered", matterId),
        ],
        outboxMessages: [{ topic: "matter.renumbered", payload: { matterId, matterNumber } }],
        value: { matterId },
      };
    });
  } catch (caught) {
    if (isMatterNumberConflict(caught)) {
      throw new MatterValidationError(
        "matter-number-taken",
        `matter number already in use: ${matterNumber}`,
      );
    }
    throw caught;
  }
}
