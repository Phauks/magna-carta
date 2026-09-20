import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  decideIdempotency,
  type IdempotencyRecordRow,
} from "@magna-carta/data-access/idempotency-decision";
import { selectIdempotencyRecordStatement } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { captureTimeEntry } from "@magna-carta/timekeeping/time-entry-service";
import {
  entryNumberAllocationStatement,
  entryNumberBlockOpenStatements,
  isEntryNumberConflict,
  planEntryNumberBlock,
  TIME_ENTRY_NUMBERING_TABLES,
} from "@magna-carta/timekeeping/entry-numbering";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { roundDuration, computeAmountMinor } from "@magna-carta/timekeeping/rounding";
import {
  abandonedThresholdMinutesDefinition,
  incrementMinutesDefinition,
  roundingDirectionDefinition,
} from "@magna-carta/timekeeping/settings";
import { elapsedMinutes } from "../../timer/timer-runtime.ts";
import type { TimeEntryId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Timer routes: thin proxies to the per-timekeeper Durable Object (one instance per firm+user, so a
// timer never crosses firms), plus the two-phase stop-commit. The DO holds only transient timer state
// and never writes a business row; stop-commit reads the DO's committing result and writes the one
// time_entry through the data-access chokepoint, deriving both the idempotency key AND the entry handle
// from the live_run_id so two racing commits collapse to a single row.

const TRACK = "time:track" as const;

const StartRequest = z
  .object({
    matterId: identifierField("matter").nullable().optional(),
    label: z.string().nullable().optional(),
    narrative: z.string().nullable().optional(),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("TimerStartRequest");

const BindRequest = z
  .object({
    matterId: identifierField("matter"),
    label: z.string().nullable().optional(),
    narrative: z.string().nullable().optional(),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("TimerBindRequest");

const EmptyRequest = z.object({}).openapi("TimerEmptyRequest");

const StartAck = z
  .object({ liveRunId: z.string(), startedAt: z.string() })
  .openapi("TimerStartAck");

const TimerStateResponse = z
  .object({
    status: z.enum(["running", "paused", "committing", "abandoned", "idle"]),
    liveRunId: z.string().nullable(),
    startedAt: z.string().nullable(),
    matterId: z.string().nullable(),
    narrative: z.string().nullable(),
  })
  .openapi("TimerStateResponse");

const StopCommitAck = z
  .object({
    timeEntryId: z.string(),
    // The matter-scoped entry number drawn for the committed entry.
    entryNumber: z.string().optional(),
  })
  .openapi("TimerStopCommitAck");
const TimerAck = z.object({ ok: z.boolean() }).openapi("TimerAck");

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks time:track",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, or the timer has no bound matter to commit",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Responses for the stop-commit route, which enforces idempotency: "required".
const stopCommitErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;

// Responses for the timer mutation routes that do NOT enforce an idempotency key (idempotency:
// "optional"): 400 key-missing and 409 in-progress are omitted because the middleware never fires
// them for these operations.
const optionalIdempotencyErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  422: authErrors[422],
  429: authErrors[429],
} as const;

const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: TRACK,
    resource: "matter",
    audited: true,
    idempotency: "optional",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function stopCommitMeta_(): RouteMeta {
  return {
    operationId: "timer.stopCommit",
    surface: "app",
    authenticated: true,
    permission: TRACK,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const startMeta = writeMeta("timer.start");
const pauseMeta = writeMeta("timer.pause");
const resumeMeta = writeMeta("timer.resume");
const bindMeta = writeMeta("timer.bind");
const stopCommitMeta = stopCommitMeta_();
const discardMeta = writeMeta("timer.discard");
const readMeta: RouteMeta = {
  operationId: "timer.read",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const startRoute = defineOpenAPIRoute(startMeta, {
  method: "post",
  path: "/api/v1/timer/start",
  description:
    "Starts the timekeeper's live timer, stopping any timer already running (single-active). Mints a live run id and sets the abandoned alarm.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: StartRequest } }, required: true },
  },
  responses: {
    200: { description: "Applied", content: { "application/json": { schema: StartAck } } },
    401: optionalIdempotencyErrorResponses[401],
    403: optionalIdempotencyErrorResponses[403],
    404: optionalIdempotencyErrorResponses[404],
    422: optionalIdempotencyErrorResponses[422],
    429: optionalIdempotencyErrorResponses[429],
  },
});
const pauseRoute = defineOpenAPIRoute(pauseMeta, {
  method: "post",
  path: "/api/v1/timer/pause",
  description: "Pauses the running timer.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: EmptyRequest } }, required: true },
  },
  responses: {
    200: { description: "Applied", content: { "application/json": { schema: TimerAck } } },
    401: optionalIdempotencyErrorResponses[401],
    403: optionalIdempotencyErrorResponses[403],
    404: optionalIdempotencyErrorResponses[404],
    422: optionalIdempotencyErrorResponses[422],
    429: optionalIdempotencyErrorResponses[429],
  },
});
const resumeRoute = defineOpenAPIRoute(resumeMeta, {
  method: "post",
  path: "/api/v1/timer/resume",
  description: "Resumes a paused timer.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: EmptyRequest } }, required: true },
  },
  responses: {
    200: { description: "Applied", content: { "application/json": { schema: TimerAck } } },
    401: optionalIdempotencyErrorResponses[401],
    403: optionalIdempotencyErrorResponses[403],
    404: optionalIdempotencyErrorResponses[404],
    422: optionalIdempotencyErrorResponses[422],
    429: optionalIdempotencyErrorResponses[429],
  },
});
const bindRoute = defineOpenAPIRoute(bindMeta, {
  method: "post",
  path: "/api/v1/timer/bind",
  description: "Binds the running timer to a matter (required before commit).",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: BindRequest } }, required: true },
  },
  responses: {
    200: { description: "Applied", content: { "application/json": { schema: TimerAck } } },
    401: optionalIdempotencyErrorResponses[401],
    403: optionalIdempotencyErrorResponses[403],
    404: optionalIdempotencyErrorResponses[404],
    422: optionalIdempotencyErrorResponses[422],
    429: optionalIdempotencyErrorResponses[429],
  },
});
const stopCommitRoute = defineOpenAPIRoute(stopCommitMeta, {
  method: "post",
  path: "/api/v1/timer/stop-commit",
  description:
    "Stops the timer and commits its elapsed time as a draft entry. Refuses an unbound timer. Idempotent on the live run id — two racing commits collapse to one entry.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: EmptyRequest } }, required: true },
  },
  responses: {
    201: { description: "Applied", content: { "application/json": { schema: StopCommitAck } } },
    400: stopCommitErrorResponses[400],
    401: stopCommitErrorResponses[401],
    403: stopCommitErrorResponses[403],
    404: stopCommitErrorResponses[404],
    409: stopCommitErrorResponses[409],
    422: stopCommitErrorResponses[422],
    429: stopCommitErrorResponses[429],
  },
});
const discardRoute = defineOpenAPIRoute(discardMeta, {
  method: "post",
  path: "/api/v1/timer/discard",
  description: "Discards the running timer without committing.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: EmptyRequest } }, required: true },
  },
  responses: {
    200: { description: "Applied", content: { "application/json": { schema: TimerAck } } },
    401: optionalIdempotencyErrorResponses[401],
    403: optionalIdempotencyErrorResponses[403],
    404: optionalIdempotencyErrorResponses[404],
    422: optionalIdempotencyErrorResponses[422],
    429: optionalIdempotencyErrorResponses[429],
  },
});

const readRoute = defineOpenAPIRoute(readMeta, {
  method: "get",
  path: "/api/v1/timer/read",
  description:
    "Returns the timekeeper's current timer state. The client computes elapsed time from startedAt.",
  responses: {
    200: {
      description: "The timer state",
      content: { "application/json": { schema: TimerStateResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

// The deterministic time-entry handle for a live run: the same live_run_id always yields the same
// handle, so two routes (or two racing stop-commits) derive one primary key and the chokepoint
// collapse them to a single row. The live_run_id is already a timeEntry_<token> identifier minted by
// the DO; we reuse its token portion directly to form the committed entry's handle.
function deriveTimeEntryHandle(liveRunId: string): TimeEntryId {
  const token = liveRunId.includes("_") ? liveRunId.slice(liveRunId.indexOf("_") + 1) : liveRunId;
  return `timeEntry_${token}` as TimeEntryId;
}

type TimerApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function durableTimerStub(c: { env: Bindings }, firmId: string, userId: string) {
  const id = c.env.DURABLE_TIMER.idFromName(`${firmId}:${userId}`);
  return c.env.DURABLE_TIMER.get(id);
}

export function registerTimerRoutes(app: TimerApp, chokepoint: Chokepoint): void {
  // POST /api/v1/timer/start
  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const abandonedThreshold = await readFirmSetting(
        firm.firmDatabase,
        abandonedThresholdMinutesDefinition,
      );
      const stub = durableTimerStub(c, firmId, userId);
      const started = await stub.start({
        matterId: request.matterId ?? undefined,
        label: request.label ?? undefined,
        narrative: request.narrative ?? undefined,
        utbmsTaskCodeId: request.utbmsTaskCodeId ?? undefined,
        abandonedThresholdMinutes: abandonedThreshold,
      });
      return c.json({ liveRunId: started.liveRunId, startedAt: started.startedAt }, 200);
    },
  );

  // POST /api/v1/timer/pause
  app.openapi(
    { ...pauseRoute, middleware: chokepointMiddleware(chokepoint, pauseRoute) },
    async (c) => {
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).pause();
      return c.json({ ok: true }, 200);
    },
  );

  // POST /api/v1/timer/resume
  app.openapi(
    { ...resumeRoute, middleware: chokepointMiddleware(chokepoint, resumeRoute) },
    async (c) => {
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).resume();
      return c.json({ ok: true }, 200);
    },
  );

  // POST /api/v1/timer/bind
  app.openapi(
    { ...bindRoute, middleware: chokepointMiddleware(chokepoint, bindRoute) },
    async (c) => {
      const request = c.req.valid("json");
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).bind({
        matterId: request.matterId,
        label: request.label ?? undefined,
        narrative: request.narrative ?? undefined,
        utbmsTaskCodeId: request.utbmsTaskCodeId ?? undefined,
      });
      return c.json({ ok: true }, 200);
    },
  );

  // POST /api/v1/timer/discard
  app.openapi(
    { ...discardRoute, middleware: chokepointMiddleware(chokepoint, discardRoute) },
    async (c) => {
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).discard();
      return c.json({ ok: true }, 200);
    },
  );

  // GET /api/v1/timer/read
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const state = await durableTimerStub(
        c,
        requireChokepointFirmId(c),
        requireChokepointUserId(c),
      ).read();
      if (state === null) {
        return c.json(
          {
            status: "idle" as const,
            liveRunId: null,
            startedAt: null,
            matterId: null,
            narrative: null,
          },
          200,
        );
      }
      return c.json(
        {
          status: state.status,
          liveRunId: state.liveRunId,
          startedAt: state.startedAt,
          matterId: state.matterId ?? null,
          narrative: state.narrative ?? null,
        },
        200,
      );
    },
  );

  // POST /api/v1/timer/stop-commit — the two-phase commit
  // Phase 1: the DO's single-threaded compare-and-set flips the state to `committing` for the first
  // caller; concurrent callers see `already-committing` or `already-committed` and take the replay path.
  // Phase 2: all paths (committing, already-committing, already-committed) derive the SAME idempotency
  // key and time-entry handle from live_run_id and funnel through runIdempotentEffect, so the chokepoint
  // collapses racing commits to one row via its idempotency_key record.
  //
  // CRITICAL — racer path isolation: only the `committing` (winner) path calls stub.read() to compose
  // the entry. The `already-committing` and `already-committed` paths go straight to runIdempotentEffect
  // with the live_run_id key; the chokepoint replays the stored response body without touching live DO
  // state. This prevents a racer reading null state after the winner has already discarded the DO.
  app.openapi(
    { ...stopCommitRoute, middleware: chokepointMiddleware(chokepoint, stopCommitRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const stub = durableTimerStub(c, firmId, userId);

      const stop = await stub.stopAndCommit();

      if (stop.state === "no-run") {
        return problemJson(c, {
          type: "conflict",
          title: "No active timer",
          status: 409,
          detail: "The timer is not running. Start a timer before calling stop-commit.",
        });
      }

      if (stop.state === "unbound") {
        return problemJson(c, {
          type: "validation",
          title: "The timer is not bound to a matter",
          status: 422,
          detail: "Bind the timer to a matter before committing.",
        });
      }

      // At this point stop.liveRunId is non-null (committing, already-committing, or already-committed).
      const liveRunId = stop.liveRunId as string;
      const now = () => new Date().toISOString();

      // The replay paths (already-committing, already-committed) must NOT call stub.read() — the DO may
      // have already been discarded by the winner, and reading null state would hit the invariant below.
      // Instead, read the idempotency record directly: if the winner's commit has been stored, replay it;
      // if it is not yet present (the winner is still in-flight), return 409 so the caller retries.
      // This avoids running any effect in the racer path, which would collide with the winner's in-flight
      // batch and corrupt the idempotency record.
      if (stop.state === "already-committing" || stop.state === "already-committed") {
        const idempotencyKey = `timer-stop:${liveRunId}`;
        const { results } = await selectIdempotencyRecordStatement(
          firm.firmDatabase,
          idempotencyKey,
        ).all<IdempotencyRecordRow>();
        const decision = decideIdempotency(results[0], liveRunId);

        if (decision.kind === "execute") {
          // The winner is still in-flight and has not yet committed the idempotency record.
          // Return 409 so the client retries — the commit will complete and be replayable shortly.
          return problemJson(c, {
            type: "conflict",
            title: "Commit in progress",
            status: 409,
            detail: "A concurrent stop-commit is in progress for this timer. Retry in a moment.",
          });
        }
        if (decision.kind === "in-progress" || decision.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, { kind: decision.kind });
        }
        // decision.kind === "replay": return the stored 201.
        c.header("Idempotency-Replayed", "true");
        return c.json(
          JSON.parse(decision.responseBody ?? "{}") as z.infer<typeof StopCommitAck>,
          201,
        );
      }

      // stop.state === "committing": this is the winner. Read the live DO state to compose the entry.
      const state = await stub.read();

      // A committing DO is always matter-bound: the DO's stopAndCommit refuses an unbound timer
      // (returns 'unbound', handled above) and is single-threaded, so reaching this point with a
      // null or missing matterId is a programming error, not a user error.
      if (state === null) {
        throw new Error(
          "invariant: DO returned committing but state is null — concurrent discard on the committing path",
        );
      }
      const matterId = state.matterId;
      if (!matterId) {
        throw new Error(
          "invariant: committing timer has no bound matter after stopAndCommit returned committing",
        );
      }

      const nowString = now();
      const rawElapsed = elapsedMinutes(state, nowString);
      const narrative = state.narrative ?? "";
      const utbmsTaskCodeId = state.utbmsTaskCodeId;
      const startedAt = state.startedAt;
      const workDate = civilDateOf(startedAt);
      const timeEntryId = deriveTimeEntryHandle(liveRunId);

      // All commit paths derive the chokepoint key from the live run id (not the client-supplied
      // Idempotency-Key header) so that two callers with DIFFERENT header keys still collapse to one
      // entry — the live_run_id is the entropy and the idempotency anchor.
      const increment = await resolveScopedSetting(firm.firmDatabase, incrementMinutesDefinition, {
        matterId,
        userId,
      });
      const direction = await resolveScopedSetting(firm.firmDatabase, roundingDirectionDefinition, {
        matterId,
        userId,
      });
      const durationMinutes = roundDuration(rawElapsed, increment, direction);

      // Guard against sub-60-second runs rounding to zero (billing correctness): a timer run too short
      // to produce one minute of billable time must not commit a 0-minute entry. The caller can keep
      // timing or discard explicitly. The DO is NOT marked committed on this path so the run stays open.
      if (durationMinutes === 0) {
        return problemJson(c, {
          type: "validation",
          title: "Timer run too short to bill",
          status: 422,
          detail:
            "The timer run rounds to 0 minutes. Keep timing to accumulate a billable duration, or discard the run.",
        });
      }

      // Resolve the rate from the precedence chain. Mirrors the time-entries capture path: the first
      // non-archived rate card in the firm is the default when no card is specified (the common
      // single-card scenario). A missing card or no rate in force resolves to noRate; the entry is
      // still captured (billable=true, amount_minor=null) — the timekeeper can correct it before billing.
      const { results: memberRows } = await firm.firmDatabase
        .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1 LIMIT 1")
        .bind(userId)
        .all<{ role_id: string | null }>();

      const { results: cardRows } = await firm.firmDatabase
        .prepare("SELECT id FROM rate_card WHERE archived_at IS NULL ORDER BY created_at LIMIT 1")
        .all<{ id: string }>();
      const resolvedRateCardId = cardRows[0]?.id;

      const rateResolution = await resolveRate(firm.firmDatabase, {
        matterId,
        clientId: null,
        timekeeperUserId: userId,
        roleId: memberRows[0]?.role_id ?? null,
        workDate,
        rateCardId: resolvedRateCardId,
      });

      const captureRate =
        "noRate" in rateResolution
          ? ({ noRate: true } as const)
          : {
              rateE4: rateResolution.rateE4,
              rateCardId: rateResolution.rateCardId,
              rateSource: rateResolution.rateSource,
              currency: rateResolution.currency,
              amountMinor: computeAmountMinor(
                rateResolution.rateE4,
                durationMinutes,
                rateResolution.currency,
              ),
            };

      const currency = "noRate" in captureRate ? "USD" : captureRate.currency;

      // The entry-number draw wraps the idempotent effect (the time-entries capture arrangement):
      // the plan is read INSIDE the effect so a replayed commit never draws, and a losing
      // concurrent draw aborts on the allocation primary key and retries with a fresh number.
      const result = await drawWithBoundedRetry(
        firm.firmDatabase,
        TIME_ENTRY_NUMBERING_TABLES,
        {
          sequenceLabel: "time-entry number",
          alsoRetryable: isEntryNumberConflict,
          nonConvergenceError: ({ message }) => new Error(message),
        },
        async (observe) =>
          await runIdempotentEffect({
            database: firm.firmDatabase,
            key: `timer-stop:${liveRunId}`,
            fingerprint: liveRunId,
            now,
            effect: async () => {
              const plan = await planEntryNumberBlock(firm.firmDatabase, matterId, 1);
              observe({
                scopeKey: plan.scopeKey,
                observedValue: plan.observedValue,
                startValue: plan.startValue,
              });
              const entryNumber = plan.numbers[0];
              const captured = await captureTimeEntry(
                firm.firmDatabase,
                {
                  id: timeEntryId,
                  matterId,
                  timekeeperUserId: userId,
                  workDate,
                  rawDurationMinutes: rawElapsed,
                  durationMinutes,
                  narrative,
                  billable: true,
                  source: "timer",
                  liveRunId,
                  utbmsTaskCodeId,
                  entryNumber,
                  currency,
                  rate: captureRate,
                },
                { clock: { now }, actorUserId: userId },
              );
              return {
                write: {
                  statements: [
                    ...entryNumberBlockOpenStatements(firm.firmDatabase, plan),
                    ...captured.effect.statements,
                    // Last: time_entry_id is a foreign key, so the entry row must exist first.
                    entryNumberAllocationStatement(
                      firm.firmDatabase,
                      plan,
                      0,
                      captured.timeEntryId,
                      now(),
                    ),
                  ],
                  outboxMessages: captured.effect.outboxMessages,
                },
                responseCode: 201,
                responseBody: canonicalJsonStringify({
                  timeEntryId: captured.timeEntryId,
                  ...(entryNumber === undefined ? {} : { entryNumber }),
                }),
              };
            },
          }),
      );

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      // The commit is confirmed (executed or replayed). Write the tombstone before discarding so that
      // any late retry arriving after this point finds already-committed and replays the stored 201.
      await stub.markCommitted(liveRunId);
      // Clear the live timer state so a new run can start.
      await stub.discard();

      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof StopCommitAck>, 201);
    },
  );
}
