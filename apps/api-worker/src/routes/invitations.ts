import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import { attemptLadderKey, type AttemptLadder } from "../auth-attempt-budget.ts";
import { neutralRedemptionRefusal, resolveInvitationRedemption } from "../invitation-redemption.ts";
import type { createAuth } from "../auth.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { isUserEmailConflict } from "../control-plane-conflicts.ts";
import {
  enforceHumanVerification,
  humanVerificationTokenHeader,
  type HumanVerificationGateOptions,
} from "../human-verification/human-verification-gate.ts";
import {
  digestsMatch,
  generateInvitationCode,
  invitationCodeHash,
  invitationVerifierHash,
  isCalendarDate,
  UNMATCHABLE_VERIFIER_HASH,
} from "../joining-secrets.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../idempotency-conflict-problems.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { scheduleRequestPathSweep } from "../request-path-sweep.ts";

// INVITATIONS — how a person who is not a stranger gets in.
//
// THREE FACTS, ONE ANSWER. Redemption asks for the code, the invitee's last name and their date of
// birth. The code alone would be enough cryptographically; the other two are there because a code
// travels by email and email is forwarded, printed and left open, and because two facts the firm
// already holds about the person are cheap for the right person and unavailable to the wrong one.
//
// EVERY WRONG COMBINATION IS ONE MESSAGE, and the storage shape is what guarantees it rather than
// the handler's care: the row holds a single digest over all three facts (joining-secrets.ts), so
// there is no separate surname to compare and no separate birthday, and the handler is
// structurally incapable of saying which one was wrong. A form that answered "the code is right
// but the date of birth is not" is a machine for confirming that a named person was invited to a
// named firm, which for a law firm's client list is the confidential fact itself.
//
// THE BUDGET IS PER INVITATION, NOT ONLY PER CALLER. An address-keyed limit alone does not stop
// someone walking a date of birth from a rented address range, so the invitation row spends its own
// attempts and locks itself. The two limits compose: the caller-keyed one bounds breadth, the
// invitation-keyed one bounds depth.
//
// BUT ONLY THE CALLER'S BUDGET IS EVER SPOKEN ALOUD. The invitation's own count is a fact ABOUT THE
// INVITATION, and a refusal that publishes it answers the one question this route exists to refuse:
// a probe submitting a guessed code with invented facts reads "four left" and knows the code is
// live, "five left" and knows it is not, and the row lookup is keyed on the code alone, so the
// combined digest never enters that answer. The number in the body is therefore read from the
// CALLER's ladder — the same shared-ladder machinery the credential surfaces use
// (../auth-attempt-budget.ts) — which the caller already knows and which is identical whatever the
// lookup found. The invitation's ladder still runs; it is simply silent.
//
// The refusal is built in exactly one place (neutralRedemptionRefusal below) for the same reason
// the three facts share one digest: a second construction site is how a neutral answer stops being
// neutral. Nothing row-derived may enter it.

const InvitationKind = z.enum(["firmMember", "clientOfFirm"]).openapi({
  description:
    "What the invitee becomes: a member of the firm, or a client of it with portal access only.",
});

const IssueInvitationRequest = z
  .object({
    kind: InvitationKind,
    email: z.email(),
    name: z.string().trim().min(1).max(200),
    // The two facts the invitee proves. They are taken here, folded into the verifier, and NEVER
    // stored on their own — so this route is the only point at which the platform ever holds them,
    // and it holds them for the length of one request.
    lastName: z.string().trim().min(1).max(200),
    dateOfBirth: z
      .string()
      .refine(isCalendarDate, "dateOfBirth must be a real calendar date in YYYY-MM-DD form"),
    expiresInDays: z.number().int().min(1).max(90).optional(),
  })
  .openapi("IssueInvitationRequest");

const IssueInvitationResponse = z
  .object({
    id: z.string(),
    kind: InvitationKind,
    email: z.string(),
    // Returned ONCE, to the firm member who issued it, and never readable again — the row keeps
    // only a hash. A firm that loses the code issues another rather than recovering this one, which
    // is what makes a control-plane read worth nothing to an attacker.
    code: z.string(),
    expiresAt: z.string(),
  })
  .openapi("IssueInvitationResponse");

const RedeemInvitationRequest = z
  .object({
    code: z.string().trim().min(1).max(64),
    lastName: z.string().trim().min(1).max(200),
    dateOfBirth: z.string().refine(isCalendarDate, "dateOfBirth must be a real calendar date"),
  })
  .openapi("RedeemInvitationRequest");

const RedeemInvitationResponse = z
  .object({
    email: z.string(),
    kind: InvitationKind,
    // The redeemer sets a password through the link that has just been sent, so redemption ends by
    // pointing at a mailbox rather than by handing back a session. That also means a redemption
    // cannot be turned into an account takeover by someone who guessed all three facts but does not
    // hold the mailbox — which is why redemption does NOT collect a password the way registration
    // does: registration proves the mailbox by mailing a token and having it spent, and this path
    // has no such proof to lean on. The mailed link is the proof.
    //
    // THERE IS NO "the mail did not send" VALUE, and its absence is a fact about the library: the
    // reset mail leaves from inside Better Auth, whose runInBackgroundOrAwait swallows a failing
    // send into its own logger, so this endpoint resolves identically either way and a value here
    // would be a promise it cannot keep. The failure is caught at the PORT instead (app.ts), where
    // it is counted and correlated for an operator.
    next: z.literal("checkEmail"),
  })
  .openapi("RedeemInvitationResponse");

const DEFAULT_INVITATION_LIFETIME_DAYS = 14;

export const issueInvitationMeta: RouteMeta = {
  operationId: "invitations.issue",
  surface: "app",
  authenticated: true,
  // Inviting somebody into the firm is the same authority as inviting a member — reusing the
  // registered capability rather than minting a parallel one keeps one answer to "who may bring
  // people in", which is the question an administrator actually asks.
  permission: "firm:manageMembers",
  resource: "firm",
  audited: true,
  idempotency: "required",
  // The business batch is control-plane (the invitation row lives beside the user table), so its
  // idempotency record commits there too — atomic with the business, the same reasoning as
  // members.invite.
  idempotencyStore: "control",
  rateLimit: "default",
};

export const issueInvitationRoute = defineOpenAPIRoute(issueInvitationMeta, {
  method: "post",
  path: "/api/v1/invitations",
  description:
    "Issues an invitation into the session firm and returns its code once. Redemption additionally " +
    "requires the invitee's surname and date of birth, which are folded into a single stored " +
    "verifier and never kept on their own.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: IssueInvitationRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The issued invitation, carrying the code for the only time it is readable",
      content: { "application/json": { schema: IssueInvitationResponse } },
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
      description: "The session member lacks the capability to bring people into the firm",
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
        "The request body is malformed, or the Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description:
        "Rate limit exceeded; the body carries the remaining budget and the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const redeemInvitationMeta: RouteMeta = {
  operationId: "invitations.redeem",
  // Anonymous by necessity: the whole point is that the redeemer has no account yet.
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "auth",
};

export const redeemInvitationRoute = defineOpenAPIRoute(redeemInvitationMeta, {
  method: "post",
  path: "/api/v1/invitations/redemptions",
  description:
    "Redeems an invitation with its code, the invitee's surname and their date of birth, and sends " +
    "the link that sets their password — the link is what proves control of the mailbox, which " +
    "redemption itself does not, so no password is collected here. Every unsuccessful combination — an unknown code, a wrong " +
    "surname, a wrong date of birth, an invitation already used or expired — answers with one " +
    "identical refusal, so the form cannot be used to discover who was invited where.",
  request: {
    headers: humanVerificationTokenHeader,
    body: { content: { "application/json": { schema: RedeemInvitationRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The invitation was redeemed; the password-setting link has been sent",
      content: { "application/json": { schema: RedeemInvitationResponse } },
    },
    403: {
      description:
        "Human verification is required and the presented challenge solution was absent, invalid, or already spent",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The invitation could not be redeemed, or the request body is malformed. The refusal is " +
        "identical for every unsuccessful combination, including a code that matches no " +
        "invitation at all; the attempt budget it carries counts the caller's own attempts, never " +
        "any invitation's",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description:
        "Rate limit exceeded; the body carries the remaining budget and the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "The request could not be verified; the body carries the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

interface InvitationRow {
  readonly id: string;
  readonly firm_id: string;
  readonly kind: string;
  readonly email: string;
  readonly display_name: string;
  readonly verifier_hash: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly locked_until: string | null;
  readonly expires_at: string;
}

export function registerInvitationRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
  // The caller-keyed ladder redemption spends and reports. Its lifetime belongs to the app (one per
  // isolate, never one per request), which is why it arrives here rather than being built here —
  // the same arrangement as the rate limiter and the credential ladder in app.ts.
  redemptionAttemptLadder: AttemptLadder,
  humanVerification: HumanVerificationGateOptions = {},
): void {
  app.openapi(
    {
      ...issueInvitationRoute,
      middleware: chokepointMiddleware(chokepoint, issueInvitationRoute),
    },
    async (c) => {
      const actingUserId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const request = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);

      const email = request.email.trim().toLowerCase();
      const code = generateInvitationCode();
      const [codeHash, verifierHash] = await Promise.all([
        invitationCodeHash(code),
        invitationVerifierHash({
          code,
          lastName: request.lastName,
          dateOfBirth: request.dateOfBirth,
        }),
      ]);
      const expiresAt = new Date(
        Date.now() + (request.expiresInDays ?? DEFAULT_INVITATION_LIFETIME_DAYS) * 86_400_000,
      ).toISOString();

      const result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        effect: () => {
          const invitationId = newIdentifier("invitation");
          const nowInstant = new Date().toISOString();
          return Promise.resolve({
            write: {
              statements: [
                c.env.DB_CONTROL.prepare(
                  "INSERT INTO invitation (id, firm_id, kind, email, display_name, code_hash, " +
                    "verifier_hash, status, attempt_count, expires_at, invited_by_user_id, created_at) " +
                    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?9, ?10)",
                ).bind(
                  invitationId,
                  firmId,
                  request.kind,
                  email,
                  request.name,
                  codeHash,
                  verifierHash,
                  expiresAt,
                  actingUserId,
                  nowInstant,
                ),
                insertAuthAuditStatement(c.env.DB_CONTROL, {
                  id: newIdentifier("authAudit"),
                  event: "invitation.issued",
                  userId: actingUserId,
                  // Ids and the kind only. Neither the code nor either proving fact has a slot
                  // here, which is what keeps the audit trail from becoming the thing it audits.
                  metadata: { invitationId, firmId, kind: request.kind },
                  now: nowInstant,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 201,
            // The code IS in the stored response, because a replay of this exact request must be
            // able to answer it — the alternative is an issuer who retried a request losing the
            // only copy of a code that was successfully created. The idempotency record is
            // control-plane, short-lived, and already the store for exactly-once responses.
            responseBody: canonicalJsonStringify({
              id: invitationId,
              kind: request.kind,
              email,
              code,
              expiresAt,
            }),
          });
        },
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");

      const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<
        typeof IssueInvitationResponse
      >;
      return c.json(responseBody, 201);
    },
  );

  app.openapi(
    {
      ...redeemInvitationRoute,
      middleware: chokepointMiddleware(chokepoint, redeemInvitationRoute),
    },
    async (c) => {
      // Ahead of the ladder deliberately: a caller who has not shown they are a person should not be
      // able to spend attempts — theirs or, by way of the shared caller key, anybody else's on the
      // same address. It is also decided entirely by caller state, so it cannot vary with what an
      // invitation row would have said and adds no signal to a prober.
      const unverified = await enforceHumanVerification(c, humanVerification);
      if (unverified !== null) return unverified;

      const request = c.req.valid("json");
      const nowInstant = new Date().toISOString();
      const ladderKey = attemptLadderKey(c);

      // The lookup, both budgets and the ONE refusal — in ../invitation-redemption.ts, because the
      // signed-in redemption route redeems the same invitations and must answer identically. What
      // stays here is only what is different: this route CREATES the account as it redeems.
      const outcome = await resolveInvitationRedemption(
        c,
        c.env.DB_CONTROL,
        redemptionAttemptLadder,
        request,
        ladderKey,
      );
      if (outcome.kind === "refused") return outcome.response;
      const invitation = outcome.invitation;
      const nowEpochMilliseconds = Date.now();
      const invitedUserId = newIdentifier("user");

      try {
        await commitEffectBatch(
          c.env.DB_CONTROL,
          {
            statements: [
              // The redemption fence. A guarded UPDATE cannot abort a D1 batch at zero rows, so the
              // guard has to be a statement whose own failure aborts: two redemptions racing the
              // same invitation both reach here, and the second one's user INSERT trips
              // UNIQUE(user.email) — caught below — while this UPDATE quietly no-ops. Reading the
              // affected rows afterwards would be a second round trip that still races.
              c.env.DB_CONTROL.prepare(
                "UPDATE invitation SET status = 'redeemed', redeemed_at = ?2, redeemed_user_id = ?3 " +
                  "WHERE id = ?1 AND status = 'pending'",
              ).bind(invitation.id, nowInstant, invitedUserId),
              // The same write into the Better Auth user table members.invite makes: unverified,
              // with no credential account. The password-setting link below is what creates the
              // credential and, in doing so, proves control of the mailbox.
              c.env.DB_CONTROL.prepare(
                'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) ' +
                  "VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)",
              ).bind(
                invitedUserId,
                invitation.display_name,
                invitation.email,
                nowEpochMilliseconds,
                invitation.firm_id,
              ),
              insertAuthAuditStatement(c.env.DB_CONTROL, {
                id: newIdentifier("authAudit"),
                event: "invitation.redeemed",
                userId: invitedUserId,
                metadata: { invitationId: invitation.id, firmId: invitation.firm_id },
                now: nowInstant,
              }),
            ],
            outboxMessages: [
              {
                topic: "member.provision",
                payload: {
                  userId: invitedUserId,
                  firmId: invitation.firm_id,
                  displayName: invitation.display_name,
                  roleName: null,
                },
              },
            ],
          },
          { now: () => nowInstant },
        );
      } catch (caught) {
        // The address is already a user — either this invitation was raced, or the firm invited
        // somebody who already has an account. Both answer the SAME neutral refusal as every other
        // failure: "that address is already registered" on an anonymous endpoint is precisely the
        // account-existence oracle the rest of this handler is built to deny. The caller's ladder
        // is spent here too, so this refusal is indistinguishable from a plain wrong guess at the
        // same rung — leaving it unspent would mark out the one caller who had all three facts
        // right.
        if (isUserEmailConflict(caught)) {
          return neutralRedemptionRefusal(c, redemptionAttemptLadder.spend(ladderKey));
        }
        throw caught;
      }

      // A redemption that worked clears the caller's ladder: they were who they said they were, and
      // the mistypes that got them here should not follow them to a second invitation.
      redemptionAttemptLadder.clear(ladderKey);

      // After the commit, by design: the membership is real before the mail, and it stays real if
      // the mail will not go. The send's outcome is recorded at the port (app.ts) — the only layer
      // that can observe it — so a mail that does not leave is a counted, correlated fact even
      // though this response cannot carry it.
      await authForEnv(c.env).api.requestPasswordReset({ body: { email: invitation.email } });
      scheduleRequestPathSweep(c.executionCtx, c.env);

      return c.json(
        {
          email: invitation.email,
          kind: invitation.kind as z.infer<typeof InvitationKind>,
          next: "checkEmail" as const,
        },
        200,
      );
    },
  );
}
