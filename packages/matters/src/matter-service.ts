import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
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
  MATTER_HELD_TOPIC,
  MATTER_OPENED_TOPIC,
  MATTER_RELEASED_TOPIC,
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
  OpenPreconditionError,
  openPreconditionGuardStatements,
  runOpenPreconditions,
  type OpenPrecondition,
} from "./open-preconditions.ts";
import {
  collectCloseAdvisories,
  type CloseAdvisory,
  type CloseAdvisoryNotice,
} from "./close-advisories.ts";
import {
  closeMatterStatement,
  graduateMatterStatement,
  holdMatterStatement,
  insertMatterStatement,
  isMatterNumberConflict,
  type MatterFields,
  type MatterRow,
  openMatterStatement,
  releaseMatterStatement,
  reopenMatterStatement,
  renumberMatterStatement,
  selectMatterStatement,
  updateMatterFieldsStatement,
  type MatterNumberingPurpose,
} from "./matter-statements.ts";
import { matterSequenceOf } from "./numbering/sequences.ts";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import {
  NumberingSchemeMissingError,
  planSchemeDraw,
  schemeDrawOpeningStatements,
} from "@magna-carta/sequence-numbering/scheme-draw";
import { insertMatterPartyStatement } from "@magna-carta/directory/statements";
import { MATTER_PARTY_CLIENT_ROLE } from "./matter-party.ts";
import {
  allocateCounterValueStatement,
  MATTER_NUMBERING_TABLES,
} from "./numbering/counter-statements.ts";
import type { RenderContext } from "@magna-carta/sequence-numbering/render";
import { URL_SAFE_PATTERN } from "@magna-carta/sequence-numbering/segments";
import {
  composeClearFileDestructionDateOnReopen,
  composeFileDestructionDateAtClose,
} from "./matter-file-retention.ts";
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
//
// The retry itself is @magna-carta/sequence-numbering's, not a copy: matters, custodian, and billing
// draw against the same counter/allocation mechanism, and the reasoning that makes it correct — a
// zero-row guarded UPDATE aborts nothing, so the allocation key is the backstop — has to live in one
// place or the copies drift. What matters supplies at the call site is its own retryable collision
// and the error it gives up with.

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
  // The opening rules other subsystems own — what a consultation must clear before the firm acts —
  // supplied by the composition root. Absent = the matter shell's own registry, which is empty: this
  // package never imports the conflicts engine or the intake procedure to find out whether a matter
  // may open.
  readonly openPreconditions?: readonly OpenPrecondition[];
  // The graduation rules: what an INTAKE must clear before it becomes a consultation — today the
  // firm's intake procedure, supplied by the composition root on the same terms. The same shape as
  // the open hook, because it is the same kind of door one rung earlier.
  readonly graduatePreconditions?: readonly OpenPrecondition[];
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
    physical_file_location_id: LocationId | null;
    responsible_member_id: UserId;
    client_display_name: string | null;
    client_code: string | null;
    matter_number: string | null;
    consultation_number: string | null;
    intake_number: string | null;
    opened_at: string | null;
    held_at: string | null;
    hold_reason: string | null;
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
    physicalFileLocationId: row.physical_file_location_id,
    responsibleMemberId: row.responsible_member_id,
    clientDisplayName: row.client_display_name,
    clientCode: row.client_code,
    matterNumber: row.matter_number,
    consultationNumber: row.consultation_number,
    intakeNumber: row.intake_number,
    openedAt: row.opened_at,
    heldAt: row.held_at,
    holdReason: row.hold_reason,
  };
}

// The scheme in force for a purpose is the shared draw planner's to load; only the translation of
// "nothing in force" into this package's own refusal happens here, because the sentence a person
// sees belongs to the route that answers them and that route maps MatterValidationError codes.
function schemeMissingAsMatterRefusal(error: unknown): never {
  if (error instanceof NumberingSchemeMissingError) {
    throw new MatterValidationError("scheme-missing", "no active numbering scheme is configured");
  }
  throw error;
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

// The number draw over the shared idempotency primitive: read the active scheme + counter, render,
// and commit the ensure-row + guarded increment + matter write + allocation row as one batch. A
// collision (a concurrent winner on the counter value, or a parked manual number on the rendered
// value) aborts the batch and rethrows; the shared bounded retry advances the counter out of band —
// the in-batch increment rolled back with everything else — and re-runs this closure, so the retry
// renders a fresh number. An idempotency-key collision is handled inside runIdempotentEffect.
async function runMatterDraw<T>(
  database: BatchDatabase,
  options: MatterServiceOptions,
  matterId: MatterId,
  purpose: MatterNumberingPurpose,
  numberContext: NumberContext,
  build: (matterNumber: string, now: string) => BuiltMutation<T>,
  responseCode: number,
): Promise<T & ReplayFlag> {
  const sequence = matterSequenceOf(purpose);
  return await drawWithBoundedRetry(
    database,
    MATTER_NUMBERING_TABLES,
    {
      sequenceLabel: sequence.label,
      maxAttempts: options.maxAttempts,
      // Matters' own second collision: the rendered STRING is unique per firm, so a drawn number can
      // land on one a court or a legacy system already assigned by hand. That number drew no
      // allocation row, so only this run's own partial index can see it, and the retry steps past it.
      alsoRetryable: sequence.isOwnConflict,
      // Unlike custodian, matters has no named refusal for this: the counter would have to lose five
      // consecutive races, which is not a state a person can be told anything useful about. It stays
      // an unexpected fault, reported and correlated by the standard pipeline. The mapper still has
      // to be written out, so that stays a decision rather than an inherited default.
      nonConvergenceError: ({ message }) => new Error(message),
    },
    async (observe) => {
      const result = await runIdempotentEffect({
        database,
        key: options.idempotency?.key,
        fingerprint: options.idempotency?.fingerprint ?? "",
        newRecordId: options.idempotency?.newRecordId,
        now: () => options.clock.now(),
        effect: async () => {
          const context: RenderContext = { openedDate: options.clock.today(), ...numberContext };
          // All three sequences count in the same tables; the purpose's prefix on the scope key is
          // what keeps them separate runs, and the planner applies it.
          const plan = await planSchemeDraw(
            database,
            purpose,
            MATTER_NUMBERING_TABLES,
            context,
          ).catch(schemeMissingAsMatterRefusal);
          // Reported before the batch is composed, so a losing attempt can advance THIS scope's
          // counter out of band — the in-batch increment rolls back with everything else.
          observe({
            scopeKey: plan.scopeKey,
            observedValue: plan.observedValue,
            startValue: plan.startValue,
          });
          const now = options.clock.now();
          const built = build(plan.number, now);
          return {
            write: {
              statements: [
                ...schemeDrawOpeningStatements(database, MATTER_NUMBERING_TABLES, plan),
                ...built.statements,
                // Last: matter_id is a foreign key, so the matter row this draw belongs to has to
                // exist by the time the allocation lands (createMatter inserts it in this batch).
                allocateCounterValueStatement(
                  database,
                  plan.scopeKey,
                  plan.observedValue,
                  matterId,
                  now,
                ),
              ],
              outboxMessages: built.outboxMessages,
            },
            responseCode,
            responseBody: canonicalJsonStringify(built.value),
          };
        },
      });
      return finishMatterResult<T>(result);
    },
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
    physicalFileLocationId:
      input.physicalFileLocationId !== undefined
        ? input.physicalFileLocationId
        : (existing?.physicalFileLocationId ?? null),
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
  /** Where the firm's paper file is kept, which is not the office the matter is run out of. */
  readonly physicalFileLocationId?: LocationId | null;
  readonly responsibleMemberId?: UserId;
  readonly clientDisplayName?: string | null;
  readonly clientCode?: string | null;
}

export interface CreateMatterInput extends MatterFieldsInput {
  readonly title: string;
  readonly responsibleMemberId: UserId;
  // Where the matter starts. An INTAKE draws nothing: it is the walk toward a consultation, and the
  // consultation number is drawn when the firm's intake procedure lets it through. A CONSULTATION
  // recorded outright draws its tentative number now; an OPEN matter draws the matter number now.
  readonly status: "intake" | "consultation" | "open";
  readonly numberContext?: NumberContext;
  /**
   * The directory entity the firm acts for on this matter. Given, the client's party link is
   * written in the same batch as the matter, so no matter is ever readable without its client — a
   * intake's conflict check needs a person, and billing and trust derive the client
   * from that link rather than from the display name. Absent only for the callers that predate the
   * directory link (fixtures, imports, the backfill that supplies the link afterwards).
   */
  readonly clientEntityId?: string | null;
}

/*
 * The client's own party row, alongside the matter it belongs to. The role is the one every reader
 * of matter_party derives the client from, and the row is written by the directory's own statement
 * so its shape cannot drift from the party the Parties page would link by hand.
 */
function clientPartyStatements(
  database: BatchDatabase,
  options: MatterServiceOptions,
  matterId: MatterId,
  clientEntityId: string | null | undefined,
  now: string,
): SqlStatement[] {
  if (clientEntityId === undefined || clientEntityId === null) return [];
  const matterPartyId = newIdentifier("matterParty", options.randomSource);
  return [
    insertMatterPartyStatement(database, {
      id: matterPartyId,
      matterId,
      entityId: clientEntityId,
      role: MATTER_PARTY_CLIENT_ROLE,
      capacity: null,
      createdAt: now,
    }),
    auditStatement(database, options, "matter.client_linked", matterId, {
      matterPartyId,
      entityId: clientEntityId,
    }),
  ];
}

export interface CreatedMatter {
  readonly matterId: MatterId;
  readonly matterNumber: string | null;
  // The tentative number a consultation is created with; null on a matter created straight to open.
  readonly consultationNumber: string | null;
  // The number an intake is created with; null on a matter created at any later rung.
  readonly intakeNumber: string | null;
}

export async function createMatter(
  database: BatchDatabase,
  input: CreateMatterInput,
  options: MatterServiceOptions,
): Promise<CreatedMatter & ReplayFlag> {
  requireNonEmptyTitle(input.title);
  const matterId = newIdentifier("matter", options.randomSource);
  const fields = fieldsFromInput(input);

  if (input.status === "intake") {
    // An intake in flight, and it draws its own number now (owner ruling, 2026-09-14: "everything
    // should have a number, intake would have a number as well"). It touches neither of the other
    // runs: an enquiry that goes nowhere — a caller who never rings back — consumes no consultation
    // number and no matter number, which is what keeps each of those runs readable. The row exists
    // from the first call so the client is in the conflicts corpus and every intake step has a
    // matter to be answered on; now it also has a name somebody can quote while they are still on
    // the telephone.
    return runMatterDraw<CreatedMatter>(
      database,
      options,
      matterId,
      "intake",
      input.numberContext ?? {},
      (intakeNumber, now) => ({
        statements: [
          insertMatterStatement(database, {
            id: matterId,
            ...fields,
            status: "intake",
            matterNumber: null,
            consultationNumber: null,
            intakeNumber,
            numberedAt: null,
            openedAt: null,
            createdAt: now,
          }),
          auditStatement(database, options, "matter.created", matterId),
          ...clientPartyStatements(database, options, matterId, input.clientEntityId, now),
        ],
        outboxMessages: [{ topic: MATTER_CREATED_TOPIC, payload: { matterId } }],
        value: { matterId, matterNumber: null, consultationNumber: null, intakeNumber },
      }),
      201,
    );
  }

  if (input.status === "consultation") {
    // A consultation: it draws its own tentative number, from the consultation sequence, and touches
    // the MATTER counter not at all. The two runs are deliberately separate — a consultation that
    // never becomes a matter must consume no matter number, because a gap in that run reads as a
    // lost file — and the tentative number survives opening rather than being replaced by it.
    return runMatterDraw<CreatedMatter>(
      database,
      options,
      matterId,
      "consultation",
      input.numberContext ?? {},
      (consultationNumber, now) => ({
        statements: [
          insertMatterStatement(database, {
            id: matterId,
            ...fields,
            status: "consultation",
            matterNumber: null,
            consultationNumber,
            // Never an intake: this matter was recorded as a consultation outright, so no enquiry
            // was ever written down to be numbered.
            intakeNumber: null,
            numberedAt: null,
            openedAt: null,
            createdAt: now,
          }),
          auditStatement(database, options, "matter.created", matterId),
          ...clientPartyStatements(database, options, matterId, input.clientEntityId, now),
        ],
        outboxMessages: [{ topic: MATTER_CREATED_TOPIC, payload: { matterId } }],
        value: { matterId, matterNumber: null, consultationNumber, intakeNumber: null },
      }),
      201,
    );
  }

  // status === "open": draw the number at creation (the existing-client common case).
  return runMatterDraw<CreatedMatter>(
    database,
    options,
    matterId,
    "matter",
    input.numberContext ?? {},
    (number, now) => ({
      statements: [
        insertMatterStatement(database, {
          id: matterId,
          ...fields,
          status: "open",
          matterNumber: number,
          // Never an intake and never a consultation, so there is neither number to carry: this
          // matter was opened outright, and inventing one after the fact would put a number on a
          // rung that never ran.
          consultationNumber: null,
          intakeNumber: null,
          numberedAt: now,
          openedAt: now,
          createdAt: now,
        }),
        auditStatement(database, options, "matter.created", matterId),
        ...clientPartyStatements(database, options, matterId, input.clientEntityId, now),
      ],
      outboxMessages: [
        { topic: MATTER_CREATED_TOPIC, payload: { matterId } },
        { topic: MATTER_OPENED_TOPIC, payload: { matterId, matterNumber: number } },
      ],
      value: { matterId, matterNumber: number, consultationNumber: null, intakeNumber: null },
    }),
    201,
  );
}

export interface GraduateMatterInput {
  readonly numberContext?: NumberContext;
}

// Intake -> consultation: the firm's intake procedure has let the matter through, and it draws its
// consultation number. The same shape as the open, one rung earlier: the rules run before the draw
// and are skipped on an idempotent retry; the draw rides the bounded-retry allocator; the row is
// re-read after the commit to prove this call is the one that graduated it.
export async function graduateMatter(
  database: BatchDatabase,
  matterId: MatterId,
  input: GraduateMatterInput,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId; consultationNumber: string } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (
    matter.status !== "intake" &&
    !(await isIdempotentRetry(database, options.idempotency?.key))
  ) {
    throw new MatterValidationError(
      "matter-not-intake",
      `matter ${matterId} is ${matter.status}, not an intake`,
    );
  }
  const context = { matterId, database };
  const preconditions = options.graduatePreconditions;
  if (matter.status === "intake" && preconditions !== undefined && preconditions.length > 0) {
    const failures = await runOpenPreconditions(context, preconditions);
    if (failures.length > 0) throw new OpenPreconditionError(failures);
  }
  const guards =
    preconditions === undefined ? [] : openPreconditionGuardStatements(context, preconditions);
  const drawn = await runMatterDraw<{ matterId: MatterId; consultationNumber: string }>(
    database,
    options,
    matterId,
    "consultation",
    input.numberContext ?? {},
    (consultationNumber, now) => ({
      statements: [
        ...guards,
        graduateMatterStatement(database, matterId, consultationNumber, now),
        auditStatement(database, options, "matter.graduated", matterId),
      ],
      outboxMessages: [],
      value: { matterId, consultationNumber },
    }),
    200,
  );
  const committed = await loadMatter(database, matterId);
  if (committed?.consultationNumber !== drawn.consultationNumber) {
    throw new MatterValidationError(
      "matter-not-intake",
      `matter ${matterId} was graduated or closed concurrently; it is ${committed?.status ?? "gone"}`,
    );
  }
  return drawn;
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
  // consultation, so refusing here would 409 the caller on its own completed work instead of replaying
  // the number it already drew. Only a genuinely new request — which carries its own key — is refused.
  // An INTAKE is refused too: it has not yet cleared the firm's procedure, and graduating is the door
  // it goes through first.
  if (
    matter.status !== "consultation" &&
    !(await isIdempotentRetry(database, options.idempotency?.key))
  ) {
    throw new MatterValidationError(
      "matter-not-consultation",
      `matter ${matterId} is ${matter.status}, not a consultation`,
    );
  }
  // The opening rules, run before the draw and skipped on the same idempotent retry the lifecycle
  // check above skips: the mutation this key names already opened the matter, and a rule refusing
  // now would 409 the caller on its own completed work. Everything a rule reads is read here, before
  // the batch is composed — D1 has no interactive transaction — and the guards a rule supplies ride
  // the batch itself.
  const openContext = { matterId, database };
  const openPreconditions = options.openPreconditions;
  if (
    matter.status === "consultation" &&
    openPreconditions !== undefined &&
    openPreconditions.length > 0
  ) {
    const failures = await runOpenPreconditions(openContext, openPreconditions);
    if (failures.length > 0) throw new OpenPreconditionError(failures);
  }
  const guards =
    openPreconditions === undefined
      ? []
      : openPreconditionGuardStatements(openContext, openPreconditions);
  // The consultation number the matter already carries is untouched here: opening ADDS the permanent
  // number, it does not rewrite the tentative one, so a document filed under the tentative number
  // still resolves after the matter opens.
  const drawn = await runMatterDraw<{ matterId: MatterId; matterNumber: string }>(
    database,
    options,
    matterId,
    "matter",
    input.numberContext ?? {},
    (number, now) => ({
      statements: [
        ...guards,
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
      "matter-not-consultation",
      `matter ${matterId} was opened or closed concurrently; it is ${committed?.status ?? "gone"}`,
    );
  }
  return drawn;
}

/**
 * What the person closing a matter states as they close it. `fileDestroyOn` is the date the
 * matter's paper file may be destroyed after — no earlier than the firm's minimum retention after
 * the close — or null for none. Absent writes nothing, which is what a caller with no person behind
 * it (a fixture, an import) means.
 */
export interface CloseMatterInput {
  readonly fileDestroyOn?: string | null;
}

export async function closeMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
  input: CloseMatterInput = {},
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
  // Validated against the instant the close is about to stamp, and written in the close's own batch
  // so a refused date refuses the close rather than closing a matter whose date was lost.
  const destructionDate =
    input.fileDestroyOn === undefined || matter.status === "closed"
      ? []
      : await composeFileDestructionDateAtClose(
          database,
          matterId,
          input.fileDestroyOn,
          options.clock.now(),
          options,
        );
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
          ...destructionDate,
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

// The hold: an open matter the firm has stopped working without closing it, or a consultation it
// has parked without deciding on. Nothing is drawn and nothing is surrendered — whichever number
// the matter wears stands — so unlike open and close there is no counter to protect and no
// precondition registry to run: the one thing a hold must carry is its reason, and the one thing
// it must not do is overwrite a close that landed between the read and the commit, which the
// statement's own status guard refuses in the batch. An intake is not held: it is the walk toward
// a consultation and has nothing yet to pause.
export const HOLD_REASON_MAX_LENGTH = 500;

const HOLDABLE_STATUSES: ReadonlySet<MatterRow["status"]> = new Set(["open", "consultation"]);

export interface HoldMatterInput {
  readonly reason: string;
}

export async function holdMatter(
  database: BatchDatabase,
  matterId: MatterId,
  input: HoldMatterInput,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId } & ReplayFlag> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new MatterValidationError(
      "empty-hold-reason",
      "a hold carries the reason for it, in the firm's own words",
    );
  }
  if (reason.length > HOLD_REASON_MAX_LENGTH) {
    throw new MatterValidationError(
      "empty-hold-reason",
      `a hold reason is at most ${String(HOLD_REASON_MAX_LENGTH)} characters; put the account of it on the matter's notes`,
    );
  }
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  // Same replay rule as every other lifecycle step: a retry under an already-seen key is the request
  // that put the matter on hold, so the stored response is replayed rather than refused.
  if (
    !HOLDABLE_STATUSES.has(matter.status) &&
    !(await isIdempotentRetry(database, options.idempotency?.key))
  ) {
    throw new MatterValidationError(
      "matter-not-open",
      `matter ${matterId} is ${matter.status}; only an active matter or a consultation goes on hold`,
    );
  }
  const result = await runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
    const now = options.clock.now();
    return {
      statements: [
        guarded(holdMatterStatement(database, matterId, reason, now), "matter.hold"),
        auditStatement(database, options, "matter.held", matterId),
      ],
      outboxMessages: [{ topic: MATTER_HELD_TOPIC, payload: { matterId } }],
      value: { matterId },
    };
  });
  // The guard matched zero rows if a close (or another hold) landed in between; the batch committed
  // an audit row over nothing. Confirm what the row actually says, the way the open confirms its
  // number, so the caller never hears "held" about a matter that is closed.
  if (!result.idempotentReplay) {
    const committed = await loadMatter(database, matterId);
    if (committed?.status !== "hold") {
      throw new MatterValidationError(
        "matter-not-open",
        `matter ${matterId} changed concurrently; it is ${committed?.status ?? "gone"}, not on hold`,
      );
    }
  }
  return result;
}

export async function releaseMatter(
  database: BatchDatabase,
  matterId: MatterId,
  options: MatterServiceOptions,
): Promise<{ matterId: MatterId } & ReplayFlag> {
  const matter = await loadMatter(database, matterId);
  if (matter === undefined) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (matter.status !== "hold" && !(await isIdempotentRetry(database, options.idempotency?.key))) {
    throw new MatterValidationError(
      "matter-not-held",
      `matter ${matterId} is ${matter.status}, not on hold`,
    );
  }
  // A release returns the matter to where the hold found it. opened_at is the honest signal: it is
  // stamped when a matter opens and never before, so a held matter without one was a consultation
  // when it was parked, and goes back to being one. The same signal the reopen reads.
  const restored = matter.openedAt !== null ? "open" : "consultation";
  const result = await runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
    const now = options.clock.now();
    return {
      statements: [
        guarded(releaseMatterStatement(database, matterId, restored, now), "matter.release"),
        auditStatement(database, options, "matter.released", matterId),
      ],
      outboxMessages: [{ topic: MATTER_RELEASED_TOPIC, payload: { matterId } }],
      value: { matterId },
    };
  });
  if (!result.idempotentReplay) {
    const committed = await loadMatter(database, matterId);
    if (committed?.status !== restored) {
      throw new MatterValidationError(
        "matter-not-held",
        `matter ${matterId} changed concurrently; it is ${committed?.status ?? "gone"}, not released`,
      );
    }
  }
  return result;
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
  // Restore the pre-close status from the honest signals — held_at, left standing by a close so a
  // matter closed while on hold returns to that hold with its reason; opened_at, set only when a
  // matter was actually opened; and the consultation number, drawn only when an intake graduated
  // (or a consultation was recorded outright). A consultation handed a manual number via
  // renumberMatter has a matter number but was never opened, so it reopens to consultation; an
  // intake closed before it graduated reopens to intake. Every number is frozen and untouched.
  const status =
    matter.heldAt !== null
      ? "hold"
      : matter.openedAt !== null
        ? "open"
        : matter.consultationNumber !== null
          ? "consultation"
          : "intake";
  // The paper file is a working file again, so the date it could be destroyed after goes with the
  // close it was stated at (matter-file-retention.ts); the next close asks for one again.
  const clearDestructionDate = await composeClearFileDestructionDateOnReopen(
    database,
    matterId,
    options,
  );
  return runMatterEffect<{ matterId: MatterId }>(database, options, 200, () => {
    const now = options.clock.now();
    return {
      statements: [
        reopenMatterStatement(database, matterId, status, now),
        auditStatement(database, options, "matter.reopened", matterId),
        ...clearDestructionDate,
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
  // No matter number exists before a matter is active (the owner's ruling): a number set by hand
  // is a court's number, a legacy number or a correction on a matter the firm has taken on, never a
  // way to number an intake or a consultation ahead of its opening. A matter that has been active
  // is one that opened (opened_at) or already wears a number; closed counts, since it opened first.
  if (matter.openedAt === null && matter.matterNumber === null) {
    throw new MatterValidationError(
      "matter-not-open",
      `matter ${matterId} is ${matter.status} and has never been active; a matter number is drawn when it opens`,
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
