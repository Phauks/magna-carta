import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { captureTimeEntry } from "@magna-carta/timekeeping/time-entry-service";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { roundDuration, computeAmountMinor } from "@magna-carta/timekeeping/rounding";
import {
  abandonedThresholdMinutesDefinition,
  incrementMinutesDefinition,
  roundingDirectionDefinition,
} from "@magna-carta/timekeeping/settings";
import { elapsedMinutes } from "../timer/timer-runtime.ts";
import type { TimeEntryId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

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

const StopCommitAck = z.object({ timeEntryId: z.string() }).openapi("TimerStopCommitAck");
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

const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
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
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const startMeta = writeMeta("timer.start");
const pauseMeta = writeMeta("timer.pause");
const resumeMeta = writeMeta("timer.resume");
const bindMeta = writeMeta("timer.bind");
const stopCommitMeta = writeMeta("timer.stopCommit");
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

function proxyRoute(
  meta: RouteMeta,
  action: string,
  description: string,
  body: z.ZodTypeAny,
  ackSchema: z.ZodTypeAny,
  code: 200 | 201,
) {
  return defineOpenAPIRoute(meta, {
    method: "post",
    path: `/api/v1/timer/${action}`,
    description,
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: body } }, required: true },
    },
    responses: {
      [code]: { description: "Applied", content: { "application/json": { schema: ackSchema } } },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  });
}

const startRoute = proxyRoute(
  startMeta,
  "start",
  "Starts the timekeeper's live timer, stopping any timer already running (single-active). Mints a live run id and sets the abandoned alarm.",
  StartRequest,
  StartAck,
  200,
);
const pauseRoute = proxyRoute(pauseMeta, "pause", "Pauses the running timer.", EmptyRequest, TimerAck, 200);
const resumeRoute = proxyRoute(resumeMeta, "resume", "Resumes a paused timer.", EmptyRequest, TimerAck, 200);
const bindRoute = proxyRoute(
  bindMeta,
  "bind",
  "Binds the running timer to a matter (required before commit).",
  BindRequest,
  TimerAck,
  200,
);
const stopCommitRoute = proxyRoute(
  stopCommitMeta,
  "stop-commit",
  "Stops the timer and commits its elapsed time as a draft entry. Refuses an unbound timer. Idempotent on the live run id — two racing commits collapse to one entry.",
  EmptyRequest,
  StopCommitAck,
  201,
);
const discardRoute = proxyRoute(
  discardMeta,
  "discard",
  "Discards the running timer without committing.",
  EmptyRequest,
  TimerAck,
  200,
);

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
          { status: "idle" as const, liveRunId: null, startedAt: null, matterId: null, narrative: null },
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
  // caller; concurrent callers see `already-committing` and take the replay path.
  // Phase 2: both paths derive the SAME idempotency key and time-entry handle from live_run_id, so
  // the chokepoint collapses racing commits to one row via its idempotency_key record.
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

      // At this point stop.liveRunId is non-null (committing, already-committing, or already-committed)
      const liveRunId = stop.liveRunId as string;
      const timeEntryId = deriveTimeEntryHandle(liveRunId);

      // Read the current state to get the binding (matter, narrative, etc.) and compute elapsed.
      // The DO preserves the binding on the committing state, so read() is safe here.
      const state = await stub.read();
      const now = () => new Date().toISOString();
      const nowString = now();

      const rawElapsed =
        state !== null ? elapsedMinutes(state, nowString) : 0;

      const matterId = state?.matterId;
      const narrative = state?.narrative ?? "";
      const utbmsTaskCodeId = state?.utbmsTaskCodeId;
      const startedAt = state?.startedAt ?? nowString;
      const workDate = startedAt.slice(0, 10);

      // All five outcomes (committing, already-committing, already-committed, and future-proof variants)
      // go through runIdempotentEffect with the same key derived from liveRunId. The committing path
      // executes the effect; the replay paths return the stored response without a second write.
      // The chokepoint key is derived from the live run id (not the request's Idempotency-Key) so that
      // two racing callers with DIFFERENT request keys still collapse to one entry — the live_run_id is
      // the entropy and the idempotency anchor, not the client-supplied header.
      const increment = await resolveScopedSetting(firm.firmDatabase, incrementMinutesDefinition, {
        matterId,
        userId,
      });
      const direction = await resolveScopedSetting(firm.firmDatabase, roundingDirectionDefinition, {
        matterId,
        userId,
      });
      const durationMinutes = roundDuration(rawElapsed, increment, direction);

      // Resolve the rate from the precedence chain. A missing rate resolves to noRate; the entry is
      // still captured (billable=true, amount_minor=null) — the timekeeper can correct it before billing.
      const { results: memberRows } = await firm.firmDatabase
        .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1 LIMIT 1")
        .bind(userId)
        .all<{ role_id: string | null }>();

      const rateResolution = await resolveRate(firm.firmDatabase, {
        matterId: matterId ?? "",
        clientId: null,
        timekeeperUserId: userId,
        roleId: memberRows[0]?.role_id ?? null,
        workDate,
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

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: `timer-stop:${liveRunId}`,
        fingerprint: liveRunId,
        now,
        effect: async () => {
          const captured = await captureTimeEntry(
            firm.firmDatabase,
            {
              id: timeEntryId,
              matterId: matterId ?? "",
              timekeeperUserId: userId,
              workDate,
              rawDurationMinutes: rawElapsed,
              durationMinutes,
              narrative,
              billable: true,
              source: "timer",
              liveRunId,
              utbmsTaskCodeId,
              currency,
              rate: captureRate,
            },
            { clock: { now }, actorUserId: userId },
          );
          return {
            write: captured.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ timeEntryId: captured.timeEntryId }),
          };
        },
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      // The commit is confirmed (executed or replayed) — clear the DO so a new timer can start.
      await stub.discard();

      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof StopCommitAck>,
        201,
      );
    },
  );
}
