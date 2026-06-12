import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { assertPermission } from "@magna-carta/access-control/registry";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  idempotencyMiddleware,
  type IdempotencyContext,
} from "@magna-carta/data-access/hono-idempotency-middleware";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import { isUserEmailConflict } from "../control-plane-conflicts.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import {
  forbiddenProblemResponse,
  notFoundProblemResponse,
  Problem,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPES,
  problemBody,
  unauthenticatedProblemResponse,
} from "../problem.ts";
import { requireIdempotencyKey } from "../require-idempotency-key.ts";
import {
  loadEffectivePermissions,
  resolveSession,
  type SessionContext,
} from "../session-context.ts";

const InviteMemberRequest = z
  .object({
    email: z.email(),
    name: z.string().min(1),
  })
  .openapi("InviteMemberRequest");

const InviteMemberResponse = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
  })
  .openapi("InviteMemberResponse");

type MemberEnv = {
  Bindings: Bindings;
  Variables: { idempotency?: IdempotencyContext; sessionContext?: SessionContext };
};

// The ADR-0063 HTTP boundary against the CONTROL-PLANE database (the invite writes live there).
// SECURITY ORDERING (ADR-0067 chokepoint order, enforced here until the 0·5 chokepoint middleware
// formalizes it globally): this runs AFTER authorizeMemberManagement, so the idempotency table is
// unreachable without a session holding firm:manageMembers — a stored response can never replay
// pre-auth, and an existing key is indistinguishable from an unknown one (both answer 401/403).
// The stored key is firm-scoped — `${firmId}:${clientKey}`, the control-plane convention (ADR-0063
// territory): this table is shared by every firm, so the tenant rides in the key; the per-firm
// databases are already physically tenant-isolated and store raw client keys. The derived key is
// server-internal — the client only ever sees its own header, and replay semantics
// (Idempotency-Replayed: true) are unchanged.
const firmScopedControlPlaneIdempotency: MiddlewareHandler<MemberEnv> = (c, next) => {
  // The data-access middleware is generic over its own minimal env; this route's env carries the
  // same idempotency variable plus the worker bindings, so the widening is sound.
  const middleware = idempotencyMiddleware({
    requirement: "required",
    database: c.env.DB_CONTROL,
    deriveStoredKey: (clientKey) => {
      const sessionContext = c.get("sessionContext");
      if (sessionContext === undefined) {
        // Mis-ordered middleware is a security regression, not a recoverable state — fail loud.
        throw new Error(
          "idempotency middleware ran without a resolved session — authorizeMemberManagement must precede it",
        );
      }
      return `${sessionContext.firmId}:${clientKey}`;
    },
  }) as unknown as MiddlewareHandler<MemberEnv>;
  return middleware(c, next);
};

function createInviteMemberRoute(authorizeMemberManagement: MiddlewareHandler<MemberEnv>) {
  return createRoute({
    method: "post",
    path: "/api/v1/members",
    operationId: "members.invite",
    tags: ["members"],
    description:
      "Invites a member into the session firm: creates the (unverified, account-less) user, " +
      "enqueues the per-firm member.provision outbox row, audits the invite — one atomic batch — " +
      "then sends the activation email (a password-reset link; the reset creates the credential).",
    request: {
      body: {
        content: { "application/json": { schema: InviteMemberRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The invited user, pending activation through the emailed reset link",
        content: { "application/json": { schema: InviteMemberResponse } },
      },
      400: {
        description: "Missing Idempotency-Key (this operation requires one)",
        content: { "application/problem+json": { schema: Problem } },
      },
      401: {
        description: "No valid session",
        content: { "application/problem+json": { schema: Problem } },
      },
      403: {
        description: "The session member lacks firm:manageMembers",
        content: { "application/problem+json": { schema: Problem } },
      },
      404: {
        description:
          "The session's firm is not reachable from this deployment (ADR-0052 — absent, never an existence oracle)",
        content: { "application/problem+json": { schema: Problem } },
      },
      409: {
        description: "A request with this Idempotency-Key is still in progress",
        content: { "application/problem+json": { schema: Problem } },
      },
      422: {
        description:
          "The email is already in use, or the Idempotency-Key was reused with a different payload",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
    "x-mc-operationId": "members.invite",
    "x-mc-surface": "app",
    "x-mc-authenticated": true,
    "x-mc-permission": "firm:manageMembers",
    "x-mc-resource": "firm",
    "x-mc-audited": true,
    "x-mc-idempotency": "required",
    // The chain in its security order: authorization first, then the key requirement, then the
    // idempotency pre-decision — see the ordering comments on each middleware above.
    middleware: [
      authorizeMemberManagement,
      requireIdempotencyKey,
      firmScopedControlPlaneIdempotency,
    ] as const,
  });
}

// The auth accessor is injected by app.ts (which owns the per-env Better Auth cache) so the route
// module never imports app.ts at value level — types only, no module cycle.
export function registerMembersRoute(
  app: OpenAPIHono<{ Bindings: Bindings }>,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  // Step 1 of the route's middleware chain (the ADR-0067 chokepoint order, realized route-locally
  // until slice 0·5): session → firm → firm:manageMembers, each failure answering its RFC 9457
  // problem BEFORE any idempotency processing. Unauthenticated and unpermitted callers therefore
  // never reach the idempotency table — neither the replay path nor the fingerprint-mismatch 422
  // exists for them, so nothing about stored keys is learnable without the permission. The
  // resolved session is stashed for the key derivation and the handler.
  const authorizeMemberManagement: MiddlewareHandler<MemberEnv> = async (c, next) => {
    const sessionContext = await resolveSession(authForEnv(c.env), c);
    if (sessionContext === null) return unauthenticatedProblemResponse(c);

    const firmRow = await c.env.DB_CONTROL.prepare(
      "SELECT database_identifier FROM firm WHERE id = ?1",
    )
      .bind(sessionContext.firmId)
      .first<{ database_identifier: string }>();
    const firmDatabase =
      firmRow === null ? null : resolveFirmDatabase(c.env, firmRow.database_identifier);
    if (firmDatabase === null) return notFoundProblemResponse(c);

    const permissions = await loadEffectivePermissions(firmDatabase, sessionContext.userId);
    if (!permissions.has(assertPermission("firm:manageMembers"))) {
      return forbiddenProblemResponse(c);
    }

    c.set("sessionContext", sessionContext);
    await next();
  };

  app.openapi(createInviteMemberRoute(authorizeMemberManagement), async (c) => {
    const sessionContext = c.get("sessionContext");
    if (sessionContext === undefined) {
      // Unreachable when the middleware chain ran — and if it did not, answering is a regression.
      throw new Error("sessionContext missing — authorizeMemberManagement did not run");
    }

    const request = c.req.valid("json");
    // Stored lowercased: Better Auth lowercases its email lookups (findUserByEmail), and the
    // activation flow must find the row the invite wrote.
    const email = request.email.trim().toLowerCase();
    const displayName = request.name;
    const idempotency = c.get("idempotency");
    if (idempotency === undefined) {
      // This route declares idempotency REQUIRED: a missing context means the idempotency
      // middleware was dropped from the chain — failing loud beats silently losing idempotency.
      throw new Error(
        "idempotency context missing — firmScopedControlPlaneIdempotency did not run on a required-idempotency route",
      );
    }

    let result;
    try {
      result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        // Already firm-scoped: IdempotencyContext.key is the middleware's DERIVED stored key, so
        // this commit targets the exact row the pre-decision read.
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        // Speculative effect (ADR-0063/0064): statements + outbox rows described here commit in
        // ONE control-plane batch with the idempotency record — or roll back together.
        effect: () => {
          const invitedUserId = newIdentifier("user");
          const nowEpochMilliseconds = Date.now();
          const nowInstant = new Date(nowEpochMilliseconds).toISOString();
          return Promise.resolve({
            write: {
              statements: [
                // OUR write path into the Better Auth user table (invitation-only — the public
                // signup route is disabled): unverified, no credential account. Activation runs
                // through the password-reset flow, which creates the credential (Path A,
                // verified against the pinned 1.6.16 source by members.test.ts). Epoch-ms
                // timestamps: the Better Auth tables' sanctioned ADR-0055 exception.
                c.env.DB_CONTROL.prepare(
                  'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
                ).bind(
                  invitedUserId,
                  displayName,
                  email,
                  nowEpochMilliseconds,
                  sessionContext.firmId,
                ),
                insertAuthAuditStatement(c.env.DB_CONTROL, {
                  id: newIdentifier("authAudit"),
                  event: "member.invited",
                  userId: sessionContext.userId, // the inviting actor
                  metadata: { invitedUserId, firmId: sessionContext.firmId },
                  now: nowInstant,
                }),
              ],
              outboxMessages: [
                {
                  topic: "member.provision",
                  payload: {
                    userId: invitedUserId,
                    firmId: sessionContext.firmId,
                    displayName,
                    roleName: null,
                  },
                },
              ],
            },
            responseCode: 201,
            responseBody: canonicalJsonStringify({ id: invitedUserId, email, name: displayName }),
          });
        },
      });
    } catch (caught) {
      if (isUserEmailConflict(caught)) {
        return c.json(
          problemBody({
            type: PROBLEM_TYPES.validation,
            title: "Email already in use",
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
    // its kind → status mapping is mirrored here, problem-shaped for this surface.
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
    } else {
      // Executed (committed) just now: send the activation email — the password-reset link,
      // through the SendEmail port. After-commit by design; the only external side effect.
      // Accepted seam: a send that throws here leaves the committed 201 replayable WITHOUT the
      // email having gone out — the recovery is requesting a fresh reset link for the address.
      await authForEnv(c.env).api.requestPasswordReset({ body: { email } });
    }
    // Both arms answer the stored response: 201 by construction (this route's effect stores
    // nothing else, and the fingerprint pins replays to this method + path + body).
    if (result.responseBody === null) {
      // Impossible by construction — the effect above always stores a response body, and a replay
      // returns what was stored. Answering a fabricated body would mask the corruption.
      throw new Error("idempotent effect returned no stored response body on a 201-storing route");
    }
    const responseBody = JSON.parse(result.responseBody) as z.infer<typeof InviteMemberResponse>;
    return c.json(responseBody, 201);
  });
}
