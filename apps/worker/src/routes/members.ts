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
import { loadEffectivePermissions, resolveSession } from "../session-context.ts";

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

type MemberEnv = { Bindings: Bindings; Variables: { idempotency?: IdempotencyContext } };

// `x-mc-idempotency: required` realized at the HTTP boundary: no Idempotency-Key → a 400 problem
// before anything else runs. The data-access middleware behind it would also 400, but with its
// generic JSON shape — the worker's surface answers RFC 9457 problems, so the requirement is
// enforced here and the middleware only ever sees keyed requests.
const requireIdempotencyKey: MiddlewareHandler<MemberEnv> = async (c, next) => {
  const key = c.req.header("Idempotency-Key");
  if (key === undefined || key === "") {
    return c.json(
      problemBody({
        type: PROBLEM_TYPES.invalidRequest,
        title: "Idempotency-Key required",
        status: 400,
        detail: "This operation requires an Idempotency-Key header.",
        instance: c.req.path,
      }),
      400,
      PROBLEM_CONTENT_TYPE,
    );
  }
  await next();
};

// The ADR-0063 HTTP boundary against the CONTROL-PLANE database (the invite writes live there).
// NOTE (slice 0·5 chokepoint): this pre-decision runs before the handler's session/permission
// checks, so a replay answers without re-authenticating. Replaying requires presenting the exact
// key AND an identical fingerprint (method + path + canonical body), so nothing is learnable that
// the caller did not already send; the ordered chokepoint middleware re-sequences this in 0·5.
const controlPlaneIdempotency: MiddlewareHandler<MemberEnv> = (c, next) => {
  // The data-access middleware is generic over its own minimal env; this route's env carries the
  // same idempotency variable plus the worker bindings, so the widening is sound.
  const middleware = idempotencyMiddleware({
    requirement: "required",
    database: c.env.DB_CONTROL,
  }) as unknown as MiddlewareHandler<MemberEnv>;
  return middleware(c, next);
};

const inviteMemberRoute = createRoute({
  method: "post",
  path: "/api/v1/members",
  operationId: "members.invite",
  tags: ["members"],
  description:
    "Invites a member into the session firm: creates the (unverified, account-less) user, " +
    "enqueues the per-firm member.provision outbox row, audits the invite — one atomic batch — " +
    "then sends the activation email (a password-reset link; the reset creates the credential).",
  middleware: [requireIdempotencyKey, controlPlaneIdempotency] as const,
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
});

// The losing batch's UNIQUE violation on user.email IS the duplicate-email signal: the whole
// batch (user + outbox + audit + idempotency record) rolled back, nothing was stored, and a
// retry safely re-executes. Same detection idiom as isIdempotencyKeyConflict — D1 surfaces
// SQLite's message text.
function isUserEmailConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("user.email")
  );
}

// The auth accessor is injected by app.ts (which owns the per-env Better Auth cache) so the route
// module never imports app.ts at value level — types only, no module cycle.
export function registerMembersRoute(
  app: OpenAPIHono<{ Bindings: Bindings }>,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  app.openapi(inviteMemberRoute, async (c) => {
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

    const request = c.req.valid("json");
    // Stored lowercased: Better Auth lowercases its email lookups (findUserByEmail), and the
    // activation flow must find the row the invite wrote.
    const email = request.email.trim().toLowerCase();
    const displayName = request.name;
    const idempotency = c.get("idempotency");

    let result;
    try {
      result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        key: idempotency?.key,
        fingerprint: idempotency?.fingerprint ?? "",
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
    const responseBody = JSON.parse(result.responseBody ?? "null") as z.infer<
      typeof InviteMemberResponse
    >;
    return c.json(responseBody, 201);
  });
}
