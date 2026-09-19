import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  selectFirmMembersStatement,
  selectRoleIdByNameStatement,
  ROLE_NAME_SEPARATOR,
  type FirmMemberRow,
} from "@magna-carta/data-access/member-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../bindings.ts";
import type { createAuth } from "../auth.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import {
  requireChokepointFirmContext,
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
    // The role the person arrives holding. Optional because a firm may genuinely want somebody set
    // up before it has decided what they do, but naming it here is the common case and the one
    // worth making possible: an invitation that lands with no role produces a member who can sign
    // in and reach nothing, and every firm hitting that has to go and fix it by hand.
    roleName: z
      .string()
      .min(1)
      .optional()
      .openapi({
        description:
          "A role of this firm, by name, for the invited member to hold on arrival. A name that " +
          "is not one of the firm's roles is refused rather than dropped — an invitation quietly " +
          "landing without the role somebody chose is worse than one that does not land.",
      }),
  })
  .openapi("InviteMemberRequest");

const InviteMemberResponse = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    roleName: z.string().nullable().openapi({
      description: "The role the invitation names, or null where it names none.",
    }),
  })
  .openapi("InviteMemberResponse");

// The firm's roster as a screen reads it. Four facts, and deliberately no fifth: a name to print, a
// status so a picker can offer the people who are still here without erasing the ones who are not,
// the roles held (the line under the name that says whom to ask), and whether a professional profile
// exists (so an administrator can see at a glance whose letterhead identity is still unwritten).
//
// No email address, no direct dial, no permission set. Those are the professional-profile read and
// the member's own settings; putting them here would make "who is on the firm" a heavier disclosure
// than it is, and firm:readMembers is seeded to every default role precisely because this shape is
// not.
const FirmMemberSummary = z
  .object({
    userId: z.string(),
    displayName: z.string(),
    /*
     * REPORTED HERE, SET NOWHERE. Nothing in the platform writes `deactivated` yet — the column
     * exists, every permission read gates on it, and this listing prints it, but the route that
     * turns a member off has not been built.
     *
     * WHEN IT IS, IT MUST RUN A PRECONDITION FIRST, and this is the place a person building it
     * will be standing. `readReviewSetsHeldOnlyBy` in @magna-carta/discovery/review-set-access-statements
     * answers "which review sets is this member the only active person on the list for". A
     * non-empty answer means deactivating them makes those corpora unreachable by everybody,
     * permanently: a deactivated member keeps their access row and is absent to every read, so
     * nothing is revoked and nothing refuses, and the list is fail-closed with no operator
     * override and no Owner bypass. The deactivation is refused until somebody else is added to
     * each one, and the refusal names them.
     *
     * That read is the only precondition discovery needs; another subsystem may add its own, and
     * the matter-close preconditions in @magna-carta/matters/close-preconditions are the shape to
     * copy if more than one ever exists.
     */
    status: z.enum(["active", "deactivated"]).openapi({
      description:
        "A deactivated member is still listed: they remain the responsible attorney on matters " +
        "they carried and the author of what they filed, and dropping the row would print those " +
        "cells as an unfilled gap rather than as the person who is no longer here. Nothing sets " +
        "this yet; no route deactivates a member.",
    }),
    roleNames: z.array(z.string()).openapi({
      description: "The names of the roles this member holds; empty where they hold none.",
    }),
    hasProfessionalProfile: z.boolean().openapi({
      description:
        "Whether a professional profile has been written for this member — the title, admissions " +
        "and signature block a pleading states. False means unwritten, never unreadable.",
    }),
  })
  .openapi("FirmMemberSummary");

// The bare { data } envelope rather than a cursor page, and the reasoning is recorded beside the
// other bounded reads in tooling/lint-list-pagination/unpaged-baseline.mjs: a member row exists only
// where a PERSON was added to the firm, through one insert statement reached from one queue consumer
// whose only producers are the invite route, firm provisioning and onboarding. The roster grows with
// the firm's headcount and stops; it does not grow with the firm's activity. Paging it would also
// break what it is for — a screen resolving names for the rows it is showing needs the whole lookup
// before it can render any of them honestly, and a half-read roster prints blanks that read as
// missing data.
const FirmMemberListResponse = z
  .object({ data: z.array(FirmMemberSummary) })
  .openapi("FirmMemberListResponse");

// Reading who is on the firm is NOT the privilege that inviting somebody is, so it does not ride
// firm:manageMembers. It rides its own key, seeded to every default role including Read-only, on the
// same reasoning notifications:read carries: the facts here are ones a member already meets on every
// matter they are allowed to open, and withholding them only forces screens to print a raw handle or
// nothing at all.
export const membersListMeta: RouteMeta = {
  operationId: "members.list",
  surface: "app",
  authenticated: true,
  permission: "firm:readMembers",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const listMembersRoute = defineOpenAPIRoute(membersListMeta, {
  method: "get",
  path: "/api/v1/members",
  description:
    "Lists the firm's members — display name, status, the roles held, and whether a professional " +
    "profile has been written. Deactivated members are included: they still hold matters. Not " +
    "paged; a firm's roster is bounded by its headcount rather than by its activity.",
  responses: {
    200: {
      description: "The firm's members, ordered by display name",
      content: { "application/json": { schema: FirmMemberListResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:readMembers",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable from this deployment, or the session member is " +
        "deactivated (absent, never an existence oracle)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// The stored role list is one packed column; unpacking it is the route's job rather than the
// caller's. An empty pack is a member holding no role at all, which is a real state (the outbox
// mirrors a member before any role is named) and reads as an empty array, never as a role called "".
function unpackRoleNames(packed: string | null): string[] {
  if (packed === null || packed === "") return [];
  return packed.split(ROLE_NAME_SEPARATOR).filter((name) => name !== "");
}

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
        "The email is already in use, the named role is not one of this firm's, or the " +
        "Idempotency-Key was reused with a different payload",
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
  // GET /api/v1/members — the roster read. The firm database comes from the chokepoint context, so
  // the read is scoped by the session's own firm and by nothing the caller can name.
  app.openapi(
    { ...listMembersRoute, middleware: chokepointMiddleware(chokepoint, listMembersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await selectFirmMembersStatement(firm.firmDatabase).all<FirmMemberRow>();
      return c.json(
        {
          data: results.map((row) => ({
            userId: row.userId,
            displayName: row.displayName,
            // The column is a free-text SQLite value; anything that is not the known deactivated
            // literal reads as active, which is the schema's own default and the fail-open that
            // matters here — a row nobody has deactivated is a colleague who is still here.
            status: row.status === "deactivated" ? ("deactivated" as const) : ("active" as const),
            roleNames: unpackRoleNames(row.roleNames),
            hasProfessionalProfile: row.hasProfessionalProfile !== 0,
          })),
        } satisfies z.infer<typeof FirmMemberListResponse>,
        200,
      );
    },
  );

  app.openapi(
    {
      ...inviteMemberRoute,
      middleware: chokepointMiddleware(chokepoint, inviteMemberRoute),
    },
    async (c) => {
      const actingUserId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);

      const request = c.req.valid("json");
      // Stored lowercased: Better Auth lowercases its email lookups (findUserByEmail), and the
      // activation flow must find the row the invite wrote.
      const email = request.email.trim().toLowerCase();
      const displayName = request.name;
      const roleName = request.roleName ?? null;

      // The named role is resolved against THIS firm before anything is written. The provisioning
      // consumer resolves it again at consume time and dead-letters an unknown one, which is the
      // right failure for a message but the wrong one for a person: they would get a 201, no
      // member, and no way to tell. Checking here turns that into an answer they can act on.
      if (roleName !== null) {
        const firm = requireChokepointFirmContext(c);
        const { results } = await selectRoleIdByNameStatement(firm.firmDatabase, roleName).all<{
          id: string;
        }>();
        if (results.length === 0) {
          return problemJson(c, {
            type: "unknown-role",
            title: "Unknown role",
            status: 422,
            detail: `This firm has no role called ${JSON.stringify(roleName)}.`,
          });
        }
      }

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
                      roleName,
                    },
                  },
                ],
              },
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                id: invitedUserId,
                email,
                name: displayName,
                roleName,
              }),
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
