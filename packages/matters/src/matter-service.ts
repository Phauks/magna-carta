import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import {
  selectIdempotencyRecordStatement,
  type SqlDatabase,
} from "@magna-carta/data-access/idempotency-statements";
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
import {
  MATTER_CLOSED_TOPIC,
  MATTER_CREATED_TOPIC,
  MATTER_OPENED_TOPIC,
  MATTER_RENUMBERED_TOPIC,
  MATTER_REOPENED_TOPIC,
  MATTER_UPDATED_TOPIC,
} from "./topics.ts";
import {
  closePreconditionGuardStatements,
  runClosePreconditions,
  ClosePreconditionError,
  type ClosePrecondition,
} from "./close-preconditions.ts";
import {
  collectCloseAdvisories,
  type CloseAdvisory,
  type CloseAdvisoryNotice,
} from "./close-advisories.ts";
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
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  guardedIncrementStatement,
  isNumberAllocationConflict,
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
// the read-render-commit runs under a bounded retry. A concurrent draw makes one batch lose a
// uniqueness race and roll back; the retry re-reads the now-advanced counter and renders the next
// number. Two constraints are load-bearing there, not the guarded increment alone:
//   - matter_number_allocation {scope_key, drawn_value} — the drawn COUNTER VALUE is unique per
//     scope. This is what catches the general race: a scheme may carry a variable segment that is
//     not marked scoping (a client code, staff initials), in which case two draws in the same scope
//     render DIFFERENT numbers from the same value and no matter_number index can see the collision.
//   - matter_number UNIQUE — the rendered STRING is unique per firm, which additionally catches a
//     rendered number that collides with a manually assigned (court/legacy) one drawing no counter.
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
  // The close rules other subsystems own, supplied by the composition root. Absent = the matter
  // shell's own registry, which is empty: this package never imports the subsystems whose money or
  // property a close has to answer for.
  readonly closePreconditions?: readonly ClosePrecondition[];
  // The informational notices other subsystems want a person to see when they close a matter,
  // supplied by the composition root. Absent = the matter shell's own registry, which is empty. An
  // advisory never blocks a close and has no path by which it could: `collectCloseAdvisories` returns
  // notices, and nothing here turns a notice into a refusal.
  readonly closeAdvisories?: readonly CloseAdvisory[];
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

// True when this key has already been seen — the caller is retrying the SAME request, not making a
// new one. A lifecycle precondition ("already closed") must not fire on a retry: the mutation the
// key names is the one that put the matter in that state, and runIdempotentEffect replays its stored
// response (or reports in-progress / fingerprint-mismatch). Only a genuinely new request — a second
// click, which carries its own key — is refused.
async function isIdempotentRetry(database: SqlDatabase, key: string | undefined): Promise<boolean> {
  if (key === undefined) return false;
  const { results } = await selectIdempotencyRecordStatement(database, key).all();
  return results.length > 0;
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
// counter, render, and commit the ensure-row + guarded increment + matter write + allocation row as
// one batch. A collision (a concurrent winner on the counter value, or a parked manual number on the
// rendered value) aborts the batch and rethrows; because the in-batch increment rolls back with it,
// the counter is advanced OUT OF BAND so the retry renders a fresh number — a no-op when a concurrent
// winner already advanced it. An idempotency-key collision is handled inside runIdempotentEffect.
async function runMatterDraw<T>(
  database: BatchDatabase,
  options: MatterServiceOptions,
  matterId: MatterId,
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
          const now = options.clock.now();
          const built = build(matterNumber, now);
          return {
            write: {
              statements: [
                ensureCounterRowStatement(database, scopeKey, startValue),
                guardedIncrementStatement(database, scopeKey, observed),
                ...built.statements,
                // Last: matter_id is a foreign key, so the matter row this draw belongs to has to
                // exist by the time the allocation lands (createMatter inserts it in this batch).
                allocateCounterValueStatement(database, scopeKey, observed, matterId, now),
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
      if (!isMatterNumberConflict(caught) && !isNumberAllocationConflict(caught)) throw caught;
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
        outboxMessages: [{ topic: MATTER_CREATED_TOPIC, payload: { matterId } }],
        value: { matterId, matterNumber: null },
      };
    });
  }

  // status === "open": draw the number at creation (the existing-client common case).
  return runMatterDraw<CreatedMatter>(
    database,
    options,
    matterId,
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
        { topic: MATTER_CREATED_TOPIC, payload: { matterId } },
        { topic: MATTER_OPENED_TOPIC, payload: { matterId, matterNumber: number } },
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
  // Skipped on an idempotent retry: the mutation this key names is the one that moved the matter off
  // prospective, so refusing here would 409 the caller on its own completed work instead of replaying
  // the number it already drew. Only a genuinely new request — which carries its own key — is refused.
  if (
    matter.status !== "prospective" &&
    !(await isIdempotentRetry(database, options.idempotency?.key))
  ) {
    throw new MatterValidationError(
      "matter-not-prospective",
      `matter ${matterId} is ${matter.status}, not prospective`,
    );
  }
  const drawn = await runMatterDraw<{ matterId: MatterId; matterNumber: string }>(
    database,
    options,
    matterId,
    input.numberContext ?? {},
    (number, now) => ({
      statements: [
        openMatterStatement(database, matterId, number, now),
        auditStatement(database, options, "matter.opened", matterId),
      ],
      outboxMessages: [{ topic: MATTER_OPENED_TOPIC, payload: { matterId, matterNumber: number } }],
      value: { matterId, matterNumber: number },
    }),
    200,
  );
  // The precondition above is a read, and D1 has no interactive transaction — a concurrent open or
  // close can land between it and the commit, in which case the guarded UPDATE matched zero rows and
  // this call changed nothing. A matter number is frozen at assignment and unique across the firm, so
  // the row carrying the number this call drew is the exact proof that this call is the one that
  // opened it; anything else means another writer got there first and the caller must be told so
  // rather than handed a number that is on no matter.
  const committed = await loadMatter(database, matterId);
  if (committed?.matterNumber !== drawn.matterNumber) {
    throw new MatterValidationError(
      "matter-not-prospective",
      `matter ${matterId} was opened or closed concurrently; it is ${committed?.status ?? "gone"}`,
    );
  }
  return drawn;
}

export async function closeMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId; notices: readonly CloseAdvisoryNotice[] } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  // closed_at is the instant retention and archival clocks run from. A re-close would move it — a
  // January close re-run in June silently ages out five months of retention — and would emit a
  // second matter.closed event to every downstream consumer. Refuse; closeMatterStatement carries
  // the matching in-batch guard for a close that races another close.
  if (
    matter.status === "closed" &&
    !(await isIdempotentRetry(database, options.idempotency?.key))
  ) {
    throw new MatterValidationError(
      "matter-already-closed",
      `matter ${matterId} is already closed; its close date and events stand`,
    );
  }
  const context = { matterId, database };
  const preconditions = options.closePreconditions;
  const failures = await runClosePreconditions(context, preconditions);
  if (failures.length > 0) throw new ClosePreconditionError(failures);
  // The check above is a read, and D1 has no interactive transaction to hold it still: a writer that
  // lands between it and the commit — a trust deposit onto this matter's client ledger — would
  // otherwise close a matter the check had honestly cleared. Each precondition's guard re-asserts its
  // condition INSIDE the close batch, where the answer is the committed one; a guard that fires
  // aborts the whole batch, so the close, its audit row, its outbox message, and its idempotency
  // record roll back together and nothing records a close that did not happen.
  const guards = closePreconditionGuardStatements(context, preconditions);
  // Read alongside the preconditions and carried on the response. Advisories are INFORMATION, so
  // there is no guard, no in-batch re-assertion, and no arm on which a notice becomes a refusal — a
  // notice that went stale between this read and the commit was still true of the matter the person
  // was looking at, and the subsystem it came from is where the state actually lives.
  const notices = await collectCloseAdvisories(context, options.closeAdvisories);
  try {
    return await runMatterEffect<{
      matterId: MatterId;
      notices: readonly CloseAdvisoryNotice[];
    }>(database, options, 200, () => {
      const now = options.clock.now();
      return {
        statements: [
          ...guards,
          closeMatterStatement(database, matterId, now),
          auditStatement(database, options, "matter.closed", matterId),
        ],
        outboxMessages: [{ topic: MATTER_CLOSED_TOPIC, payload: { matterId } }],
        value: { matterId, notices },
      };
    });
  } catch (caught) {
    // A guard aborts as a constraint violation, which is the same shape as any other failed batch.
    // Rather than matching on a database message, ask the preconditions again: if one now refuses,
    // that is what happened, and the caller gets the same actionable refusal it would have got a
    // moment earlier. Anything else is a real fault and travels on untouched.
    const raced = await runClosePreconditions(context, preconditions);
    if (raced.length > 0) throw new ClosePreconditionError(raced);
    throw caught;
  }
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
  // Same replay rule as the open and close preconditions: a retry under an already-seen key is the
  // request that reopened the matter, so the stored response is replayed rather than the caller being
  // told its own reopen never happened.
  if (
    matter.status !== "closed" &&
    !(await isIdempotentRetry(database, options.idempotency?.key))
  ) {
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
      outboxMessages: [{ topic: MATTER_REOPENED_TOPIC, payload: { matterId } }],
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
      outboxMessages: [{ topic: MATTER_UPDATED_TOPIC, payload: { matterId } }],
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
          // A renumber overwrites the previous number in place. Nothing else retains it, so without
          // this the displaced number is destroyed and a court filing or invoice quoting it a year
          // later resolves to nothing. A matter number is an identifier, not privileged content.
          auditStatement(database, options, "matter.renumbered", matterId, {
            previousMatterNumber: matter.matterNumber,
            matterNumber,
          }),
        ],
        outboxMessages: [
          {
            topic: MATTER_RENUMBERED_TOPIC,
            payload: { matterId, matterNumber, previousMatterNumber: matter.matterNumber },
          },
        ],
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
