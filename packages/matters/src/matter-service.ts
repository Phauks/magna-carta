import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type {
  CompletedIdempotencyRecord,
  SqlDatabase,
} from "@magna-carta/data-access/idempotency-statements";
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

const DEFAULT_MAX_ATTEMPTS = 5;

export interface ClockPort {
  now(): string;
  today(): string; // ISO civil date for the number draw
}

export interface MatterServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
  readonly maxAttempts?: number;
  // The route's idempotency record, threaded into the (final) committed batch so a number draw and
  // its idempotency guard land atomically. An idempotency-key conflict is NOT a draw conflict — it
  // propagates for the route to replay.
  readonly idempotencyRecord?: CompletedIdempotencyRecord;
}

// The strings the route assembles from the matter's Location, type, and client for the number draw
// (decided: the renderer never reads those tables). openedDate is filled by the service from the clock.
export type NumberContext = Omit<RenderContext, "openedDate">;

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
  const startValue = counter !== undefined && counter.kind === "counter" ? (counter.start ?? 1) : 1;
  return { segments, startValue };
}

// A single committed batch for the non-number-drawing mutations. The idempotency record (if any)
// rides the same commit; an idempotency-key conflict propagates for the route to replay.
async function commitOnce(
  database: BatchDatabase,
  write: EffectWrite,
  options: MatterServiceOptions,
): Promise<void> {
  await commitEffectBatch(database, write, {
    now: () => options.clock.now(),
    idempotencyRecord: options.idempotencyRecord,
  });
}

// The bounded-retry number draw: read the active scheme + counter, render, and commit the
// ensure-row + guarded increment + matter write as one batch. A collision (a concurrent winner or a
// parked manual number on the rendered value) aborts the batch on the matter_number UNIQUE index.
// Because the in-batch increment rolls back with it, the counter is then advanced OUT OF BAND so the
// retry renders a fresh number — a no-op when a concurrent winner already advanced it.
async function commitNumberDraw(
  database: BatchDatabase,
  options: MatterServiceOptions,
  numberContext: NumberContext,
  buildMatterStatements: (matterNumber: string, now: string) => EffectWrite["statements"][number][],
  events: (matterNumber: string) => EffectWrite["outboxMessages"][number][],
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const scheme = await loadActiveScheme(database);
    const context: RenderContext = { openedDate: options.clock.today(), ...numberContext };
    const scopeKey = deriveScopeKey(scheme.segments, context);
    const observed = (await readCounterValue(database, scopeKey)) ?? scheme.startValue;
    const matterNumber = renderMatterNumber(scheme.segments, context, observed);
    const write: EffectWrite = {
      statements: [
        ensureCounterRowStatement(database, scopeKey, scheme.startValue),
        guardedIncrementStatement(database, scopeKey, observed),
        ...buildMatterStatements(matterNumber, options.clock.now()),
      ],
      outboxMessages: events(matterNumber),
    };
    try {
      await commitOnce(database, write, options);
      return matterNumber;
    } catch (caught) {
      if (!isMatterNumberConflict(caught)) throw caught;
      lastError = caught;
      // Advance past the taken value out of band (the in-batch increment rolled back). Guarded on
      // the observed value, so a concurrent winner that already advanced the counter no-ops here.
      await ensureCounterRowStatement(database, scopeKey, scheme.startValue).run();
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
): Promise<CreatedMatter> {
  requireNonEmptyTitle(input.title);
  const matterId = newIdentifier("matter", options.randomSource);
  const fields = fieldsFromInput(input);

  if (input.status === "prospective") {
    // A consultation: no number, no counter touched.
    const now = options.clock.now();
    await commitOnce(
      database,
      {
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
      },
      options,
    );
    return { matterId, matterNumber: null };
  }

  // status === "open": draw the number at creation (the existing-client common case).
  const matterNumber = await commitNumberDraw(
    database,
    options,
    input.numberContext ?? {},
    (number, now) => [
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
    (number) => [
      { topic: "matter.created", payload: { matterId } },
      { topic: "matter.opened", payload: { matterId, matterNumber: number } },
    ],
  );
  return { matterId, matterNumber };
}

export interface OpenMatterInput {
  readonly numberContext?: NumberContext;
}

export async function openMatter(
  database: BatchDatabase,
  matterId: MatterId,
  input: OpenMatterInput,
  options: MatterServiceOptions,
): Promise<{ matterNumber: string }> {
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
  const matterNumber = await commitNumberDraw(
    database,
    options,
    input.numberContext ?? {},
    (number, now) => [
      openMatterStatement(database, matterId, number, now),
      auditStatement(database, options, "matter.opened", matterId),
    ],
    (number) => [{ topic: "matter.opened", payload: { matterId, matterNumber: number } }],
  );
  return { matterNumber };
}

export async function closeMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
): Promise<void> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  const failures = await runClosePreconditions({ matterId, database });
  if (failures.length > 0) throw new ClosePreconditionError(failures);
  const now = options.clock.now();
  await commitOnce(
    database,
    {
      statements: [
        closeMatterStatement(database, matterId, now),
        auditStatement(database, options, "matter.closed", matterId),
      ],
      outboxMessages: [{ topic: "matter.closed", payload: { matterId } }],
    },
    options,
  );
}

export async function reopenMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
): Promise<void> {
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
  // Restore the pre-close status: a numbered matter reopens to open, an unnumbered consultation to
  // prospective (the number, if any, is frozen and untouched).
  const status = matter.matterNumber !== null ? "open" : "prospective";
  const now = options.clock.now();
  await commitOnce(
    database,
    {
      statements: [
        reopenMatterStatement(database, matterId, status, now),
        auditStatement(database, options, "matter.reopened", matterId),
      ],
      outboxMessages: [{ topic: "matter.reopened", payload: { matterId } }],
    },
    options,
  );
}

export async function updateMatter(
  database: BatchDatabase,
  matterId: MatterId,
  patch: MatterFieldsInput,
  options: MatterServiceOptions,
): Promise<void> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  const merged = fieldsFromInput(patch, matter);
  requireNonEmptyTitle(merged.title);
  const now = options.clock.now();
  await commitOnce(
    database,
    {
      statements: [
        updateMatterFieldsStatement(database, matterId, merged, now),
        auditStatement(database, options, "matter.updated", matterId),
      ],
      outboxMessages: [{ topic: "matter.updated", payload: { matterId } }],
    },
    options,
  );
}

export async function renumberMatter(
  database: BatchDatabase,
  matterId: MatterId,
  matterNumber: string,
  options: MatterServiceOptions,
): Promise<void> {
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
  const nowInstant = options.clock.now();
  const write: EffectWrite = {
    statements: [
      renumberMatterStatement(database, matterId, matterNumber, nowInstant),
      auditStatement(database, options, "matter.renumbered", matterId),
    ],
    outboxMessages: [{ topic: "matter.renumbered", payload: { matterId, matterNumber } }],
  };
  try {
    // A manual number is the caller's choice — a collision is terminal, not retryable.
    await commitEffectBatch(database, write, {
      now: () => options.clock.now(),
      idempotencyRecord: options.idempotencyRecord,
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
