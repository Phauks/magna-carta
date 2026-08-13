import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import {
  attemptLadderKey,
  type AttemptBudget,
  type AttemptLadder,
} from "../auth-attempt-budget.ts";
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
    // hold the mailbox.
    next: z.literal("checkEmail"),
  })
  .openapi("RedeemInvitationResponse");

const DEFAULT_INVITATION_LIFETIME_DAYS = 14;

/** How many redemption attempts one invitation allows before it locks itself. */
export const INVITATION_ATTEMPT_LIMIT = 5;

/** How long an invitation stays locked once its attempts are spent. */
export const INVITATION_LOCKOUT_SECONDS = 900;

// The single sentence every failed redemption gets, whatever went wrong.
const NEUTRAL_REDEMPTION_DETAIL =
  "That invitation could not be redeemed. Check the code, surname and date of birth against the " +
  "invitation, or ask the firm that invited you to send a new one.";

// An invitation id no row can hold, for the balancing write below. Every id is a generated
// identifier, so the empty string matches nothing — the same device as UNMATCHABLE_VERIFIER_HASH,
// applied to a write instead of a comparison.
const UNMATCHABLE_INVITATION_ID = "";

/**
 * THE refusal — the one and only construction of a failed redemption's answer.
 *
 * Everything in it is a constant except the budget, and the budget comes from the caller's own
 * ladder, which the caller already knows and which does not move when the lookup finds something.
 * Nothing read off an invitation row may be passed in here: a value that varies with what was found
 * is an oracle whatever the sentence beside it says.
 */
function neutralRedemptionRefusal(c: Context, budget: AttemptBudget): ProblemResponse<422> {
  return problemJson(c, {
    type: "invitation-not-redeemable",
    status: 422,
    title: "That invitation could not be redeemed",
    detail: NEUTRAL_REDEMPTION_DETAIL,
    attemptsRemaining: budget.remaining,
    ...(budget.lockoutSecondsRemaining !== null && {
      retryAfterSeconds: budget.lockoutSecondsRemaining,
    }),
  });
}

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
    "the link that sets their password. Every unsuccessful combination — an unknown code, a wrong " +
    "surname, a wrong date of birth, an invitation already used or expired — answers with one " +
    "identical refusal, so the form cannot be used to discover who was invited where.",
  request: {
    body: { content: { "application/json": { schema: RedeemInvitationRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The invitation was redeemed; the password-setting link has been sent",
      content: { "application/json": { schema: RedeemInvitationResponse } },
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
      const request = c.req.valid("json");
      const nowInstant = new Date().toISOString();

      // The caller's ladder, read before anything is looked up. A caller whose own budget is spent
      // is refused here, and this return is decided ENTIRELY by caller state — no code has been
      // hashed and no row has been read — so it cannot vary with what an invitation row would have
      // said. Refusing before the lookup also stops a locked-out prober from continuing to burn a
      // real invitation's attempts on the way past.
      const ladderKey = attemptLadderKey(c);
      const standing = redemptionAttemptLadder.read(ladderKey);
      if (standing.lockoutSecondsRemaining !== null) {
        return neutralRedemptionRefusal(c, standing);
      }

      // BOTH digests are computed BEFORE anything is looked up, and both are computed on every
      // path. The point is that the work this handler does must not depend on what it finds: a
      // wrong code and a wrong birthday take the same two hashes and the same one comparison.
      const [codeHash, presentedVerifier] = await Promise.all([
        invitationCodeHash(request.code),
        invitationVerifierHash({
          code: request.code,
          lastName: request.lastName,
          dateOfBirth: request.dateOfBirth,
        }),
      ]);

      const row = await c.env.DB_CONTROL.prepare(
        "SELECT id, firm_id, kind, email, display_name, verifier_hash, status, attempt_count, " +
          "locked_until, expires_at FROM invitation WHERE code_hash = ?1",
      )
        .bind(codeHash)
        .first<InvitationRow>();

      // The comparison runs even with no row, against a digest nothing can equal. An early return
      // here would make "no such code" measurably faster than "wrong date of birth", which is the
      // same oracle rebuilt out of a stopwatch instead of a status code.
      const verifierMatches = digestsMatch(
        row?.verifier_hash ?? UNMATCHABLE_VERIFIER_HASH,
        presentedVerifier,
      );
      const locked = row !== null && row.locked_until !== null && row.locked_until > nowInstant;
      const live = row !== null && row.status === "pending" && row.expires_at > nowInstant;

      if (!verifierMatches || !live || locked) {
        // The invitation's own ladder, spent when a real, live invitation was aimed at and missed.
        // It is what bounds DEPTH against a code somebody genuinely holds, and it stays exactly as
        // it was — the defect was never that this counter is kept, only that it was reported.
        const spendingRow = row !== null && live && !locked ? row : null;
        const spent = spendingRow !== null ? spendingRow.attempt_count + 1 : 0;
        const lockedUntil =
          spendingRow !== null && spent >= INVITATION_ATTEMPT_LIMIT
            ? new Date(Date.now() + INVITATION_LOCKOUT_SECONDS * 1000).toISOString()
            : null;
        // ONE write on every refusal, whatever was found. When there is nothing to spend against
        // the same statement runs against an id no row holds: zero rows changed, one round trip to
        // the control plane, the same cost. A conditional write would leave the difference the body
        // no longer carries sitting in a stopwatch instead — the same reasoning as comparing
        // against the unmatchable digest rather than returning early.
        await c.env.DB_CONTROL.prepare(
          "UPDATE invitation SET attempt_count = ?2, locked_until = ?3 WHERE id = ?1",
        )
          .bind(spendingRow?.id ?? UNMATCHABLE_INVITATION_ID, spent, lockedUntil)
          .run();

        // ONE problem type, ONE title, ONE detail, ONE status, ONE budget — for a code that does
        // not exist, a code aimed at the wrong person, a surname that does not match, a date of
        // birth that does not match, an invitation already redeemed, revoked, expired or locked.
        // The budget is the CALLER's, spent here and read back from their own ladder, so the answer
        // to "was there an invitation behind this code" is not in it.
        return neutralRedemptionRefusal(c, redemptionAttemptLadder.spend(ladderKey));
      }

      // Past here the row is non-null and every fact matched.
      const invitation = row;
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

      // After the commit, by design and for the same accepted reason members.invite states: a send
      // that throws leaves a committed redemption whose recovery is requesting a fresh link.
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
