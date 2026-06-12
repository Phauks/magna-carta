import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  idempotencyMiddleware,
  type IdempotencyContext,
} from "@magna-carta/data-access/hono-idempotency-middleware";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import { isUserEmailConflict } from "../control-plane-conflicts.ts";
import {
  DEV_FIRM_DATABASE_POOL_BINDING_NAMES,
  resolveFirmDatabase,
} from "../firm-binding-resolver.ts";
import {
  provisionFirm,
  type FirmProvisionerDependencies,
  type ProvisionFirmOutcome,
} from "../firm-provisioner.ts";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  type FirmResourceProvider,
} from "../firm-resource-provider.ts";
import { perFirmHeadSchemaVersion, perFirmMigrations } from "../per-firm-migrations.ts";
import {
  Problem,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPES,
  problemBody,
  unauthenticatedProblemResponse,
} from "../problem.ts";
import { requireIdempotencyKey } from "../require-idempotency-key.ts";

const ProvisionFirmRequest = z
  .object({
    name: z.string().min(1),
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

// Constant-time string comparison for the platform-admin secret. Both sides are folded through
// SHA-256 first so the inputs handed to timingSafeEqual are fixed-length — neither the secret's
// length nor a length mismatch can leak through timing (timingSafeEqual itself THROWS on unequal
// lengths). timingSafeEqual is the Workers runtime's constant-time primitive (a workerd extension
// on SubtleCrypto, available since compatibility with the 2022 runtime — typed by
// @cloudflare/workers-types).
async function constantTimeStringEquals(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftDigest, rightDigest);
}

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
    return unauthenticatedProblemResponse(c);
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
        "An active firm already holds this name with a different owner, or a request with this " +
        "Idempotency-Key is still in progress",
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

// How the provisioner's migrate step reaches a firm database: the binding resolver supplies the
// handle, the fleet migration runner applies the bundled per-firm lineage. A database this
// deployment cannot reach fails LOUD here (unlike the request-path ADR-0052 404): for production
// firms created through the REST adapter, the new database's binding lands by config commit +
// deploy — the documented manual step — and re-invoking afterwards resumes from this exact step.
function migrateFirmDatabaseToHeadForEnv(env: Bindings) {
  return async (databaseIdentifier: string): Promise<{ latestTag: string }> => {
    const firmDatabase = resolveFirmDatabase(env, databaseIdentifier);
    if (firmDatabase === null) {
      throw new Error(
        `firm database "${databaseIdentifier}" is not bound to this deployment — add its binding ` +
          "(config commit + deploy), then re-invoke provisioning to resume",
      );
    }
    const migrations = perFirmMigrations();
    await runPendingMigrations(d1MigrationTarget(firmDatabase), migrations);
    const latestTag = migrations.at(-1)?.tag;
    if (latestTag === undefined) throw new Error("per-firm migration lineage is empty");
    return { latestTag };
  };
}

// Adapter selection: deploy-time credentials present → real Cloudflare REST creation; otherwise
// the dev pool-claimer (local dev and tests — CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID are
// deploy-time secrets, deliberately absent from .dev.vars).
function resourceProviderForEnv(env: Bindings): FirmResourceProvider {
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (apiToken !== undefined && apiToken !== "" && accountId !== undefined && accountId !== "") {
    return createCloudflareRestFirmResourceProvider({ accountId, apiToken });
  }
  return createDevFirmResourceProvider({
    poolBindingNames: DEV_FIRM_DATABASE_POOL_BINDING_NAMES,
    claimedDatabaseIdentifiers: async () => {
      const { results } = await env.DB_CONTROL.prepare(
        "SELECT database_identifier FROM firm WHERE database_identifier IS NOT NULL",
      ).all<{ database_identifier: string }>();
      return results.map((row) => row.database_identifier);
    },
  });
}

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
        return c.json(
          problemBody({
            type: PROBLEM_TYPES.conflict,
            title: "Firm name already in use",
            status: 409,
            detail: "An active firm already holds this name.",
            instance: c.req.path,
          }),
          409,
          PROBLEM_CONTENT_TYPE,
        );
      }
      if (isUserEmailConflict(caught)) {
        // The activation batch rolled back whole (owner user + audit + outbox + status flip +
        // idempotency record): steps 1-4 stay durable, the firm stays 'provisioning', and a
        // retry with a free email resumes from the activation step.
        return c.json(
          problemBody({
            type: PROBLEM_TYPES.validation,
            title: "Owner email already in use",
            status: 422,
            detail: "A user with this email address already exists.",
            instance: c.req.path,
          }),
          422,
          PROBLEM_CONTENT_TYPE,
        );
      }
      throw caught;
    }

    // The two conflict kinds only reach the handler on a race the middleware pre-check missed —
    // its kind → status mapping is mirrored here, problem-shaped for this surface (members.ts
    // carries the same mapping).
    if (result.kind === "in-progress") {
      return c.json(
        problemBody({
          type: PROBLEM_TYPES.conflict,
          title: "Request in progress",
          status: 409,
          detail: "A request with this Idempotency-Key is still in progress.",
          instance: c.req.path,
        }),
        409,
        PROBLEM_CONTENT_TYPE,
      );
    }
    if (result.kind === "fingerprint-mismatch") {
      return c.json(
        problemBody({
          type: PROBLEM_TYPES.validation,
          title: "Idempotency-Key reused",
          status: 422,
          detail: "This Idempotency-Key was already used with a different request payload.",
          instance: c.req.path,
        }),
        422,
        PROBLEM_CONTENT_TYPE,
      );
    }

    if (result.kind === "replayed") {
      c.header("Idempotency-Replayed", "true");
    } else if (outcome?.kind === "ready-to-activate") {
      // Executed and the activation batch committed just now: send the owner's activation email
      // (the password-reset link — the reset creates the credential, Path A) through the
      // SendEmail port. After-commit by design; same accepted seam as members.invite — a send
      // that throws leaves the committed 201 replayable, recovered by requesting a fresh link.
      await authForEnv(c.env).api.requestPasswordReset({ body: { email: outcome.ownerEmail } });
    }

    if (result.responseBody === null) {
      // Impossible by construction — the effect always stores a response body, and a replay
      // returns what was stored. Answering a fabricated body would mask the corruption.
      throw new Error("idempotent effect returned no stored response body on a 201-storing route");
    }
    const responseBody = JSON.parse(result.responseBody) as z.infer<typeof ProvisionFirmResponse>;
    return c.json(responseBody, 201);
  });
}
