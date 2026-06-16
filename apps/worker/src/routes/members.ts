import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import {
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { isUserEmailConflict } from "../control-plane-conflicts.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { scheduleRequestPathSweep } from "../request-path-sweep.ts";

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

// The route metadata. The chokepoint, reading this at registration, enforces the WHOLE
// security order: session → firm (404 on absence/deactivation) → firm:manageMembers (403 +
// requestAccess) → Idempotency-Key requirement + the firm-scoped idempotency pre-decision → rate
// limit. The handler runs only past all of it. The earlier route-local middleware chain
// (authorizeMemberManagement + requireIdempotencyKey + firmScopedControlPlaneIdempotency) is GONE —
// the chokepoint owns every one of those gates now, retiring the per-handler-discipline failure
// mode where one route could forget a gate.
export const membersInviteMeta: RouteMeta = {
  operationId: "members.invite",
  surface: "app",
  authenticated: true,
  permission: "firm:manageMembers",
  resource: "firm",
  audited: true,
  idempotency: "required",
  // This route's business batch is control-plane (it creates the Better Auth user + the
  // member.provision outbox row in DB_CONTROL), so its idempotency record commits there too —
  // atomic with the business. The firm-scoped routes (matters/files) default to the per-firm store.
  idempotencyStore: "control",
  rateLimit: "default",
};

export const inviteMemberRoute = defineOpenAPIRoute(membersInviteMeta, {
  method: "post",
  path: "/api/v1/members",
  description:
    "Invites a member into the session firm: creates the (unverified, account-less) user, " +
    "enqueues the per-firm member.provision outbox row, audits the invite — one atomic batch — " +
    "then sends the activation email (a password-reset link; the reset creates the credential).",
  request: {
    headers: idempotencyKeyHeader,
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
        "The session's firm is not reachable from this deployment, or the session member is " +
        "deactivated (absent, never an existence oracle)",
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
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Registers POST /api/v1/members through the chokepoint. The handler runs only past the chokepoint
// (session + firm:manageMembers + the firm-scoped idempotency pre-decision, which set the
// idempotency context). It does business logic only: the atomic invite batch + the post-commit
// activation email. The inviting actor and firm come from the chokepoint context, never
// re-resolved. The auth accessor is injected by app.ts (which owns the per-env Better Auth cache) so
// the route module never imports app.ts at value level.
export function registerMembersRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  app.openapi(
    {
      ...inviteMemberRoute,
      middleware: chokepointMiddleware(chokepoint, membersInviteMeta, inviteMemberRoute),
    },
    async (c) => {
      const actingUserId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);

      const request = c.req.valid("json");
      // Stored lowercased: Better Auth lowercases its email lookups (findUserByEmail), and the
      // activation flow must find the row the invite wrote.
      const email = request.email.trim().toLowerCase();
      const displayName = request.name;
      const idempotency = requireChokepointIdempotency(c);

      let result;
      try {
        result = await runIdempotentEffect({
          database: c.env.DB_CONTROL,
          // Already firm-scoped: IdempotencyContext.key is the chokepoint gate's DERIVED stored key,
          // so this commit targets the exact row the pre-decision read.
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          // Speculative effect: statements + outbox rows described here commit in
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
                  // timestamps: the Better Auth tables' sanctioned exception to the platform's
                  // instants-as-ISO time convention.
                  c.env.DB_CONTROL.prepare(
                    'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
                  ).bind(invitedUserId, displayName, email, nowEpochMilliseconds, firmId),
                  insertAuthAuditStatement(c.env.DB_CONTROL, {
                    id: newIdentifier("authAudit"),
                    event: "member.invited",
                    userId: actingUserId, // the inviting actor
                    metadata: { invitedUserId, firmId },
                    now: nowInstant,
                  }),
                ],
                outboxMessages: [
                  {
                    topic: "member.provision",
                    payload: {
                      userId: invitedUserId,
                      firmId,
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
          return problemJson(c, {
            type: "email-in-use",
            title: "Email already in use",
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
      } else {
        // Executed (committed) just now: send the activation email — the password-reset link,
        // through the SendEmail port. After-commit by design; the only external side effect.
        // Accepted seam: a send that throws here leaves the committed 201 replayable WITHOUT the
        // email having gone out — the recovery is requesting a fresh reset link for the address.
        await authForEnv(c.env).api.requestPasswordReset({ body: { email } });
        // Best-effort latency optimization: close the up-to-5-minute window where the invitee could
        // activate before the next */5 cron sweeps the member.provision row into the firm database
        // (permissions: [] until then). The cron remains the at-least-once guarantee; overlapping
        // sweeps are safe by scheduled.ts's documented invariant. Off the response path via waitUntil.
        scheduleRequestPathSweep(c.executionCtx, c.env);
      }
      // Both arms answer the stored response: 201 by construction (this route's effect stores
      // nothing else, and the fingerprint pins replays to this method + path + body).
      const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<
        typeof InviteMemberResponse
      >;
      return c.json(responseBody, 201);
    },
  );
}
