import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { authDenied } from "@magna-carta/telemetry/events";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../bindings.ts";
import type { createAuth } from "../auth.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointIdempotency } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { constantTimeStringEquals } from "../constant-time.ts";
import { isFirmActivationConflict, isUserEmailConflict } from "../control-plane-conflicts.ts";
import {
  provisionFirm,
  type FirmProvisionerDependencies,
  type ProvisionFirmOutcome,
} from "../firm-provisioner.ts";
import { resourceProviderForEnv } from "../firm-provisioner-wiring.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";
import { scheduleRequestPathSweep } from "../request-path-sweep.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const ProvisionFirmRequest = z
  .object({
    // Canonicalized HERE (trim + Unicode NFC, rejecting names that trim to empty): the
    // provisioner's resume identity is the byte-exact UNIQUE firm.name, so 'Acme Legal ' or an
    // NFD variant must resume the existing row, never insert a second firm. The route owns this
    // normalization — firm-provisioner.ts documents the dependency on its resume-identity note.
    name: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.normalize("NFC")),
    owner: z.object({
      email: z.email(),
      name: z.string().min(1),
    }),
  })
  .openapi("ProvisionFirmRequest");

const ProvisionFirmResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.literal("active"),
    owner: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  })
  .openapi("ProvisionFirmResponse");

// The guard reads the telemetry-stashed logger + correlationId (set by the middleware ahead of it)
// from context, so its env is the full AppVariables, not a one-off shape.
type FirmsEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};

// The platform-admin guard: a Worker-secret header check, the single-operator reality for now — a
// real platform-admin principal model is a later seam. Fail closed: an unset/empty
// PLATFORM_ADMIN_KEY rejects every request, and a missing key, a wrong key, and an unconfigured
// deployment all answer the SAME 401 problem (no probe surface).
// This stays a ROUTE-SPECIFIC middleware (NOT the chokepoint's RBAC): firms.provision is the
// documented public-surface exception, so the chokepoint skips its session/firm/RBAC gates and this
// secret guard does the auth. chokepoint/register.ts composes it BEFORE the chokepoint enforcement
// middleware, so it runs first — a missing/wrong secret 401s before the chokepoint's idempotency and
// rate-limit gates ever run, and nothing about the route is discoverable without the secret.
export const platformAdminGuard: MiddlewareHandler<FirmsEnv> = async (c, next) => {
  const configuredKey = c.env.PLATFORM_ADMIN_KEY;
  const presentedKey = c.req.header("X-Platform-Admin-Key");
  // The CLIENT sees one opaque 401 for all three causes (no enumeration oracle — see the route
  // comment); this branch decides only what the OPERATOR sees. The order preserves the original
  // short-circuit, so the constant-time compare still runs only when a non-empty key was presented.
  let denialCause: "unconfigured" | "missing-header" | "mismatch" | undefined;
  if (configuredKey === undefined || configuredKey === "") {
    denialCause = "unconfigured";
  } else if (presentedKey === undefined || presentedKey === "") {
    denialCause = "missing-header";
  } else if (!(await constantTimeStringEquals(presentedKey, configuredKey))) {
    denialCause = "mismatch";
  }
  if (denialCause !== undefined) {
    const errorId = newErrorId();
    // The standard telemetry pipeline (slice 0·6) — the structural replacement for slice 0·4's
    // interim console.error seam. The auth.denied event records the cause label + route + the SAME
    // Error ID the client receives (so an operator can tell a deployment misconfiguration
    // 'unconfigured' apart from a denied caller). The allowlist IS the redaction: the event has no
    // slot for the presented or configured key, so neither can ever be logged. The request-scoped
    // logger and correlation id were stashed by the telemetry middleware ahead of this guard.
    c.get("logger")?.log(
      authDenied(
        { correlationId: c.get("correlationId") ?? "", now: new Date().toISOString() },
        { cause: denialCause, route: c.req.routePath, errorId },
      ),
    );
    return problemJson(c, {
      type: "unauthenticated",
      title: "Authentication required",
      status: 401,
      detail: "Sign in to call this endpoint.",
      errorId,
    });
  }
  await next();
};

// The route metadata. surface: "public" is the documented platform-admin exception (a
// header-token guard, no session cookie) — so the chokepoint skips its session/firm/RBAC gates and
// the platformAdminGuard above does the auth, while the chokepoint still owns the rate-limit gate
// AND the (platform-scoped) idempotency gate. The earlier route-mounted requireIdempotencyKey +
// platformScopedControlPlaneIdempotency are GONE — the chokepoint applies idempotency once.
export const provisionFirmMeta: RouteMeta = {
  operationId: "firms.provision",
  surface: "public",
  authenticated: true,
  permission: "firm:provision",
  resource: "firm",
  audited: true,
  idempotency: "required",
  rateLimit: "auth",
};

export const provisionFirmRoute = defineOpenAPIRoute(provisionFirmMeta, {
  method: "post",
  path: "/api/v1/firms",
  description:
    "Provisions a tenant firm (platform-admin only): firm row, bucket, owner user with the " +
    "Owner/Admin role — resumable; re-invoking with the same name no-ops completed steps and " +
    "returns the existing firm. The firm's per-firm database is the firmId-addressed database " +
    "that self-migrates on first access, so it needs no provisioning step.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: ProvisionFirmRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The provisioned (or, on an idempotent re-invoke, existing) active firm",
      content: { "application/json": { schema: ProvisionFirmResponse } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "Missing or wrong X-Platform-Admin-Key",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description:
        "An active firm already holds this name with a different owner, a request with this " +
        "Idempotency-Key is still in progress, or a concurrent provisioning of the same name " +
        "completed first (retry to observe it)",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The owner email already belongs to another user, or the Idempotency-Key was reused " +
        "with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Sentinel for the name-conflict outcome: thrown INSIDE the idempotent effect so nothing commits
// (the conflict response is deliberately not stored — a later retry re-evaluates the name).
class FirmNameConflictError extends Error {
  constructor() {
    super("an active firm already holds this name with a different owner");
  }
}

// Registers POST /api/v1/firms through the chokepoint, with the platform-admin secret guard as
// route-specific middleware (running before the chokepoint's idempotency/rate-limit gates). The
// handler runs only past all of them. The auth accessor is injected by app.ts (the per-env Better
// Auth cache) for the owner's post-commit activation email — types only, no module cycle.
export function registerFirmsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  app.openapi(
    {
      ...provisionFirmRoute,
      middleware: chokepointMiddleware(chokepoint, provisionFirmRoute, [
        platformAdminGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const request = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);

      const dependencies: FirmProvisionerDependencies = {
        controlPlaneDatabase: c.env.DB_CONTROL,
        resourceProvider: resourceProviderForEnv(c.env),
        rootKekBase64: c.env.ROOT_KEK,
      };

      // Captured from the effect closure: the post-commit activation email must only go out when
      // THIS request executed the activation (never on replay, never for an already-active no-op).
      let outcome: ProvisionFirmOutcome | undefined;
      let result;
      try {
        result = await runIdempotentEffect({
          database: c.env.DB_CONTROL,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          // The provisioner runs its guarded steps 1-4 with their OWN commits inside the effect
          // (resource creation and the firm-database migration cannot ride one control-plane
          // batch); only the final activation batch + the idempotency record commit atomically
          // here. A crash mid-provisioning therefore stores NO record — the retry re-executes and
          // the provisioner's state guards resume the remaining steps (see firm-provisioner.ts).
          effect: async () => {
            outcome = await provisionFirm(dependencies, {
              name: request.name,
              owner: request.owner,
            });
            if (outcome.kind === "name-conflict") throw new FirmNameConflictError();
            if (outcome.kind === "already-active") {
              return {
                write: { statements: [], outboxMessages: [] },
                responseCode: 201,
                responseBody: canonicalJsonStringify({
                  id: outcome.firmId,
                  name: request.name,
                  status: "active",
                  owner: outcome.owner,
                }),
              };
            }
            return {
              write: outcome.finalWrite,
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                id: outcome.firmId,
                name: request.name,
                status: "active",
                owner: {
                  id: outcome.ownerUserId,
                  email: outcome.ownerEmail,
                  name: request.owner.name,
                },
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof FirmNameConflictError) {
          return problemJson(c, {
            type: "conflict",
            title: "Firm name already in use",
            status: 409,
            detail: "An active firm already holds this name.",
          });
        }
        if (isFirmActivationConflict(caught)) {
          // The activation fence fired: a concurrent provisioning of the same name committed its
          // activation first, and this run's whole batch rolled back (firm-provisioner.ts,
          // concurrency note). Nothing was stored — a retry observes the now-active firm.
          return problemJson(c, {
            type: "conflict",
            title: "Concurrent provisioning completed",
            status: 409,
            detail: "A concurrent provisioning of this firm completed first — retry to observe it.",
          });
        }
        if (isUserEmailConflict(caught)) {
          // The activation batch rolled back whole (owner user + audit + outbox + status flip +
          // idempotency record): steps 1-4 stay durable, the firm stays 'provisioning', and a
          // retry with a free email resumes from the activation step.
          return problemJson(c, {
            type: "email-in-use",
            title: "Owner email already in use",
            status: 422,
            detail: "A user with this email address already exists.",
          });
        }
        throw caught;
      }

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      if (result.kind === "replayed") {
        c.header("Idempotency-Replayed", "true");
      } else if (outcome?.kind === "ready-to-activate") {
        // Executed and the activation batch committed just now: send the owner's activation email
        // (the password-reset link — the reset creates the credential, Path A) through the
        // SendEmail port. After-commit by design; same accepted seam as members.invite — a send
        // that throws leaves the committed 201 replayable, recovered by requesting a fresh link.
        await authForEnv(c.env).api.requestPasswordReset({ body: { email: outcome.ownerEmail } });
        // Best-effort latency optimization (same seam as members.invite): close the up-to-5-minute
        // window where the owner could activate before the next */5 cron sweeps the member.provision
        // row (Owner/Admin) into the firm database — without it the owner reads permissions: [] and
        // 403s until the cron fires. The cron stays the at-least-once guarantee; overlapping sweeps
        // are safe per scheduled.ts's documented invariant. Off the response path via waitUntil.
        scheduleRequestPathSweep(c.executionCtx, c.env);
      }

      const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<
        typeof ProvisionFirmResponse
      >;
      return c.json(responseBody, 201);
    },
  );
}
