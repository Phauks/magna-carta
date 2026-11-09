import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../../bindings.ts";
import type { AttemptLadder } from "../../auth-attempt-budget.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointUserId } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  neutralRedemptionRefusal,
  resolveInvitationRedemption,
} from "../../invitation-redemption.ts";
import {
  confirmationTokenHash,
  generateConfirmationToken,
  isCalendarDate,
} from "../../../joining-secrets.ts";
import { readJoiningState } from "../../../joining-state.ts";
import { scheduleRequestPathSweep } from "../../request-path-sweep.ts";

// ONBOARDING — the two things a person with an account and no firm can do, and the only two routes
// in the platform that admit such a session.
//
// WHY THESE EXIST AT ALL. Joining is two acts: becoming a person, and becoming a member of a firm.
// The registration surface does the first and hands back an account; these do the second. Splitting
// them is what stops the front door from asking a stranger to classify themselves before anything
// about them exists.
//
// BOTH ARE `firmlessSession: "only"`, which is a stronger statement than it looks. The chokepoint
// answers the reserved 404 to any session that ALREADY holds a firm, so neither route is reachable
// by a member of a firm — a member cannot found a second firm and cannot attach themselves to
// another one. That is what makes `permission: null` correct here rather than a hole: the principal
// these routes admit belongs to no firm, so there is no firm in which they could hold a capability,
// and the routes are structurally unreachable for everybody who could.
//
// NEITHER SENDS MAIL. The account arrived here by proving its mailbox — spending the confirmation
// token that was sent to it — and it already holds the password its owner chose when they
// registered, so there is nothing left for another mail to prove and the person is standing in front
// of the screen.

const FoundFirmRequest = z
  .object({
    // Trimmed and Unicode-composed so the same typed name is the same name. NOT unique and never a
    // lookup key: firm names are not unique in the world, and a unique column over them would let a
    // stranger probe for any firm's existence by trying to register its name.
    firmName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .transform((value) => value.normalize("NFC")),
  })
  .openapi("FoundFirmRequest");

const FoundFirmResponse = z
  .object({
    // The firm is built off the request, so this answers "under way" rather than handing back a
    // firm that does not exist yet. The bootstrap call (GET /api/v1/me) is where the surface learns
    // it has arrived.
    status: z.literal("provisioning"),
  })
  .openapi("FoundFirmResponse");

const RedeemIntoAccountRequest = z
  .object({
    code: z.string().trim().min(1).max(64),
    lastName: z.string().trim().min(1).max(200),
    dateOfBirth: z.string().refine(isCalendarDate, "dateOfBirth must be a real calendar date"),
  })
  .openapi("RedeemIntoAccountRequest");

const RedeemIntoAccountResponse = z
  .object({
    firmId: z.string(),
    kind: z.enum(["firmMember", "clientOfFirm"]),
  })
  .openapi("RedeemIntoAccountResponse");

export const foundFirmMeta: RouteMeta = {
  operationId: "onboarding.foundFirm",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  // The tightest bucket: this is the one authenticated route that can cause a bucket to be created
  // and a key to be minted, and its caller has no firm whose budget could absorb it.
  rateLimit: "auth",
  firmlessSession: "only",
};

export const foundFirmRoute = defineOpenAPIRoute(foundFirmMeta, {
  method: "post",
  path: "/api/v1/me/firm",
  description:
    "Starts building a firm for the signed-in account, which becomes its owner. The firm is built " +
    "in the background, so this answers that the build is under way; the bootstrap call reports " +
    "when it has arrived. Answers the same way when a build is already under way, so a second " +
    "press never starts a second firm.",
  request: {
    body: { content: { "application/json": { schema: FoundFirmRequest } }, required: true },
  },
  responses: {
    202: {
      description: "The firm is being built",
      content: { "application/json": { schema: FoundFirmResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session already belongs to a firm (absent, never an existence oracle) — a person " +
        "belongs to exactly one firm, so there is no second one to found",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The request body is malformed",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description:
        "Rate limit exceeded; the body carries the remaining budget and the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const redeemIntoAccountMeta: RouteMeta = {
  operationId: "onboarding.redeemInvitation",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "auth",
  firmlessSession: "only",
};

export const redeemIntoAccountRoute = defineOpenAPIRoute(redeemIntoAccountMeta, {
  method: "post",
  path: "/api/v1/me/invitation-redemptions",
  description:
    "Redeems an invitation into the signed-in account, joining it to the inviting firm. The " +
    "invitation must name this account's own address. Every unsuccessful combination — an unknown " +
    "code, a wrong surname, a wrong date of birth, an invitation already used or expired, or one " +
    "addressed to somebody else — answers with one identical refusal, so the form cannot be used " +
    "to discover who was invited where.",
  request: {
    body: {
      content: { "application/json": { schema: RedeemIntoAccountRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The invitation was redeemed and the account now belongs to the firm",
      content: { "application/json": { schema: RedeemIntoAccountResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The session already belongs to a firm (absent, never an existence oracle)",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The invitation could not be redeemed, or the request body is malformed. The refusal is " +
        "identical for every unsuccessful combination; the attempt budget it carries counts the " +
        "caller's own attempts, never any invitation's",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description:
        "Rate limit exceeded; the body carries the remaining budget and the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

interface AccountRow {
  readonly name: string;
  readonly email: string;
}

async function readAccount(env: Bindings, userId: string): Promise<AccountRow> {
  const row = await env.DB_CONTROL.prepare('SELECT name, email FROM "user" WHERE id = ?1')
    .bind(userId)
    .first<AccountRow>();
  // The chokepoint resolved this user id from a live session; an absent row is control-plane
  // corruption, not a routine absence.
  if (row === null) {
    throw new Error(
      `session user ${userId} resolved by the chokepoint but absent from the control plane`,
    );
  }
  return row;
}

export function registerOnboardingRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  // The same ladder the anonymous redemption route spends, so signing in does not buy a second
  // allowance at guessing invitations.
  redemptionAttemptLadder: AttemptLadder,
): void {
  app.openapi(
    { ...foundFirmRoute, middleware: chokepointMiddleware(chokepoint, foundFirmRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const account = await readAccount(c.env, userId);
      const { firmName } = c.req.valid("json");

      // A build already under way answers the same 202 rather than queueing a second firm. The
      // state is read from the control plane rather than from an idempotency key, because the
      // press that needs collapsing is usually a person reloading a waiting screen on another
      // device, which carries no key of ours.
      if ((await readJoiningState(c.env.DB_CONTROL, account.email)).state === "firmProvisioning") {
        return c.json({ status: "provisioning" as const }, 202);
      }

      const nowInstant = new Date().toISOString();
      const registrationId = newIdentifier("registration");
      // A registration row IS the record of a firm being asked for, and reusing it is what lets the
      // existing provisioning consumer, its outbox row, its retries and its resume all work here
      // unchanged. The confirmation hash is a column this row has to fill and this path has no use
      // for: it is minted from a token that is never sent anywhere, so the row is unique and the
      // token is unspendable. Nothing about this registration is pending — the mailbox was proven
      // before the account existed, so it is written confirmed.
      const unusedConfirmationHash = await confirmationTokenHash(generateConfirmationToken());

      await commitEffectBatch(
        c.env.DB_CONTROL,
        {
          statements: [
            c.env.DB_CONTROL.prepare(
              "INSERT INTO registration (id, role, email, display_name, firm_display_name, " +
                "confirmation_hash, status, expires_at, confirmed_at, created_at) " +
                "VALUES (?1, 'foundFirm', ?2, ?3, ?4, ?5, 'confirmed', ?6, ?6, ?6)",
            ).bind(
              registrationId,
              account.email,
              account.name,
              firmName,
              unusedConfirmationHash,
              nowInstant,
            ),
            insertAuthAuditStatement(c.env.DB_CONTROL, {
              id: newIdentifier("authAudit"),
              event: "registration.confirmed",
              userId,
              metadata: { registrationId },
              now: nowInstant,
            }),
          ],
          // The transactional-outbox guarantee, exactly as the anonymous confirmation path takes
          // it: the row describing the work commits with the row that authorized it, so there is no
          // state in which somebody is waiting for a firm nothing is ever going to build. The
          // owner is named by ID here — this person already has an account, so provisioning ADOPTS
          // it rather than creating one, and no activation mail is sent.
          outboxMessages: [
            {
              topic: "firm.provision",
              payload: {
                registrationId,
                firmDisplayName: firmName,
                owner: { email: account.email, name: account.name, userId },
              },
            },
          ],
        },
        { now: () => nowInstant },
      );

      // Close the window where somebody watches a waiting screen until the next five-minute cron.
      // Best-effort and off the response path — the sweep remains the at-least-once guarantee.
      scheduleRequestPathSweep(c.executionCtx, c.env);

      return c.json({ status: "provisioning" as const }, 202);
    },
  );

  app.openapi(
    {
      ...redeemIntoAccountRoute,
      middleware: chokepointMiddleware(chokepoint, redeemIntoAccountRoute),
    },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const account = await readAccount(c.env, userId);
      const request = c.req.valid("json");
      // Keyed by the SESSION rather than by address: an authenticated caller is identified, so
      // charging their guesses to a shared office address would let one person spend a colleague's
      // budget. The same ladder holds both keys, so signing in is not a way to get a fresh one.
      const ladderKey = `user:${userId}`;

      const outcome = await resolveInvitationRedemption(
        c,
        c.env.DB_CONTROL,
        redemptionAttemptLadder,
        request,
        ladderKey,
      );
      if (outcome.kind === "refused") return outcome.response;
      const invitation = outcome.invitation;

      // THE INVITATION MUST NAME THIS ACCOUNT'S OWN ADDRESS, and a mismatch is the same one
      // refusal as a wrong code.
      //
      // This is the possession proof, preserved. In the anonymous flow the proof is that the
      // password-setting link goes to the INVITED mailbox, so somebody who guessed all three facts
      // but does not hold that mailbox gains nothing. Here no mail is sent, so without this check a
      // person who obtained a code, a surname and a date of birth could attach THEIR OWN account,
      // with their own credential, to somebody else's firm. Requiring the addresses to match
      // restores exactly what the mail was proving. Somebody invited at an address other than the
      // one they registered redeems it anonymously instead, which creates the account for the
      // address the firm actually invited.
      if (invitation.email !== account.email.trim().toLowerCase()) {
        return neutralRedemptionRefusal(c, redemptionAttemptLadder.spend(ladderKey));
      }

      const nowInstant = new Date().toISOString();
      await commitEffectBatch(
        c.env.DB_CONTROL,
        {
          statements: [
            // The redemption fence. A guarded UPDATE cannot abort a D1 batch at zero rows, so two
            // redemptions racing one invitation would both pass — the fence below is what stops the
            // second, by colliding with the user's own primary key unless this account still
            // belongs to no firm.
            c.env.DB_CONTROL.prepare(
              "UPDATE invitation SET status = 'redeemed', redeemed_at = ?2, redeemed_user_id = ?3 " +
                "WHERE id = ?1 AND status = 'pending'",
            ).bind(invitation.id, nowInstant, userId),
            c.env.DB_CONTROL.prepare(
              "INSERT INTO \"user\" (id, name, email, firm_id) SELECT ?1, '', '', NULL " +
                'WHERE (SELECT firm_id FROM "user" WHERE id = ?1) IS NOT NULL',
            ).bind(userId),
            // The attachment itself — the whole difference between this route and the anonymous
            // one. No user is created; the one signing in acquires a firm.
            c.env.DB_CONTROL.prepare(
              'UPDATE "user" SET firm_id = ?2, updated_at = ?3 WHERE id = ?1 AND firm_id IS NULL',
            ).bind(userId, invitation.firm_id, Date.now()),
            insertAuthAuditStatement(c.env.DB_CONTROL, {
              id: newIdentifier("authAudit"),
              event: "invitation.redeemed",
              userId,
              metadata: { invitationId: invitation.id, firmId: invitation.firm_id },
              now: nowInstant,
            }),
          ],
          outboxMessages: [
            {
              topic: "member.provision",
              payload: {
                userId,
                firmId: invitation.firm_id,
                displayName: invitation.display_name,
                roleName: null,
              },
            },
          ],
        },
        { now: () => nowInstant },
      );

      // A redemption that worked clears the caller's ladder: they were who they said they were, and
      // the mistypes that got them here should not follow them.
      redemptionAttemptLadder.clear(ladderKey);
      scheduleRequestPathSweep(c.executionCtx, c.env);

      return c.json(
        {
          firmId: invitation.firm_id,
          kind: invitation.kind as "firmMember" | "clientOfFirm",
        },
        200,
      );
    },
  );
}
