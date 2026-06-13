import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  idempotencyMiddleware,
  type IdempotencyContext,
} from "@magna-carta/data-access/hono-idempotency-middleware";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import { constantTimeStringEquals } from "../constant-time.ts";
import { isFirmActivationConflict, isUserEmailConflict } from "../control-plane-conflicts.ts";
import {
  provisionFirm,
  type FirmProvisionerDependencies,
  type ProvisionFirmOutcome,
} from "../firm-provisioner.ts";
import {
  migrateFirmDatabaseToHeadForEnv,
  resourceProviderForEnv,
} from "../firm-provisioner-wiring.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";
import { perFirmHeadSchemaVersion } from "../per-firm-migrations.ts";
import { scheduleRequestPathSweep } from "../request-path-sweep.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { requireIdempotencyKey } from "../require-idempotency-key.ts";

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

type FirmsEnv = {
  Bindings: Bindings;
  Variables: { idempotency?: IdempotencyContext };
};

// The platform-admin guard (slice 0·4 design spec §5): a Worker-secret header check, the
// single-operator reality of Phase 0 — a real platform-admin principal model is a named later
// seam. Fail closed: an unset/empty PLATFORM_ADMIN_KEY rejects every request, and a missing key,
// a wrong key, and an unconfigured deployment all answer the SAME 401 problem (no probe surface).
// Runs FIRST in the chain — nothing about the route (idempotency requirement included) is
// discoverable without the secret.
const platformAdminGuard: MiddlewareHandler<FirmsEnv> = async (c, next) => {
  const configuredKey = c.env.PLATFORM_ADMIN_KEY;
  const presentedKey = c.req.header("X-Platform-Admin-Key");
  if (
    configuredKey === undefined ||
    configuredKey === "" ||
    presentedKey === undefined ||
    presentedKey === "" ||
    !(await constantTimeStringEquals(presentedKey, configuredKey))
  ) {
    return problemJson(c, {
      type: "unauthenticated",
      title: "Authentication required",
      status: 401,
      detail: "Sign in to call this endpoint.",
    });
  }
  await next();
};

// The ADR-0063 boundary for the PLATFORM surface. The control-plane idempotency table is shared,
// so the stored key carries its scope: session routes use `${firmId}:${clientKey}` (members.ts);
// this route has NO firm or session — the platform-admin principal is the scope, so the
// documented platform prefix is `platform:${clientKey}`. The two namespaces cannot collide: every
// firm scope starts with the `firm_` handle prefix, never the literal `platform`. Ordering matches
// members.ts: the guard above runs first, so the idempotency table is unreachable without the
// admin secret.
const platformScopedControlPlaneIdempotency: MiddlewareHandler<FirmsEnv> = (c, next) => {
  const middleware = idempotencyMiddleware({
    requirement: "required",
    database: c.env.DB_CONTROL,
    deriveStoredKey: (clientKey) => `platform:${clientKey}`,
    // The pre-decision 409/422 — the COMMON conflict path — answers this route's declared
    // application/problem+json contract through the same single mapping the handler's rare
    // race path uses (idempotency-conflict-problems.ts).
    conflictResponse: problemResponseForIdempotencyConflict,
  }) as unknown as MiddlewareHandler<FirmsEnv>;
  return middleware(c, next);
};

const provisionFirmRoute = createRoute({
  method: "post",
  path: "/api/v1/firms",
  operationId: "firms.provision",
  tags: ["firms"],
  description:
    "Provisions a tenant firm (platform-admin only): firm row, per-firm database created and " +
    "migrated to head, bucket, owner user with the Owner/Admin role — resumable; re-invoking " +
    "with the same name no-ops completed steps and returns the existing firm.",
  request: {
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
  },
  "x-mc-operationId": "firms.provision",
  // No session surface fits the platform-admin secret; "public" (header-token auth, no cookie) is
  // the nearest of the contract spec's three until the platform-admin principal model (the named
  // slice 0·4 seam) earns its own.
  "x-mc-surface": "public",
  "x-mc-authenticated": true,
  // Registered as reserved in the access-control registry; enforced by the platform-admin secret
  // this slice, not by RBAC (no session exists to resolve permissions for).
  "x-mc-permission": "firm:provision",
  "x-mc-resource": "firm",
  "x-mc-audited": true,
  "x-mc-idempotency": "required",
  // Security order (ADR-0067 chokepoint order, route-local until slice 0·5): the platform-admin
  // guard first, then the key requirement, then the idempotency pre-decision.
  middleware: [
    platformAdminGuard,
    requireIdempotencyKey,
    platformScopedControlPlaneIdempotency,
  ] as const,
});

// Sentinel for the name-conflict outcome: thrown INSIDE the idempotent effect so nothing commits
// (the conflict response is deliberately not stored — a later retry re-evaluates the name).
class FirmNameConflictError extends Error {
  constructor() {
    super("an active firm already holds this name with a different owner");
  }
}

// The auth accessor is injected by app.ts (the per-env Better Auth cache) for the owner's
// post-commit activation email — types only, no module cycle.
export function registerFirmsRoute(
  app: OpenAPIHono<{ Bindings: Bindings }>,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  app.openapi(provisionFirmRoute, async (c) => {
    const request = c.req.valid("json");
    const idempotency = c.get("idempotency");
    if (idempotency === undefined) {
      // This route declares idempotency REQUIRED: a missing context means the middleware was
      // dropped from the chain — failing loud beats silently losing idempotency.
      throw new Error(
        "idempotency context missing — platformScopedControlPlaneIdempotency did not run on a required-idempotency route",
      );
    }

    const dependencies: FirmProvisionerDependencies = {
      controlPlaneDatabase: c.env.DB_CONTROL,
      resourceProvider: resourceProviderForEnv(c.env),
      migrateFirmDatabaseToHead: migrateFirmDatabaseToHeadForEnv(c.env),
      headSchemaVersion: perFirmHeadSchemaVersion(),
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
  });
}
