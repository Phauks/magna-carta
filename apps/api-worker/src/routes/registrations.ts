import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { isUserEmailConflict } from "../control-plane-conflicts.ts";
import type { SendEmail } from "../email-port.ts";
import {
  enforceHumanVerification,
  humanVerificationTokenHeader,
  type HumanVerificationGateOptions,
} from "../human-verification/human-verification-gate.ts";
import {
  confirmationTokenHash,
  digestsMatch,
  generateConfirmationToken,
} from "../joining-secrets.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { scheduleRequestPathSweep } from "../request-path-sweep.ts";

// SELF-SERVE REGISTRATION — the platform's only anonymous write, and therefore the surface every
// other rule here is arranged around.
//
// THE THREE DOORS. A visitor says which of three things they are, because the three go to different
// places and asking later is worse: someone who is a client of a firm cannot create anything, and
// someone founding a firm must not be quietly handed a client account. Two of the three doors —
// "I am a client at a law firm" and "I work at a law firm" — end at invitation redemption, because
// membership of an existing firm is the firm's decision and never a stranger's. Only the third,
// founding a firm, creates anything.
//
// WHY THE ANSWER IS ALWAYS THE SAME. Registering with an address that already has an account, with
// one that does not, and with one mid-registration all answer 202 with the same body. The
// difference is only ever in the MAIL, which goes to the address in question and so tells the
// person who owns it something the person who typed it may not already know. Anything else turns
// the endpoint into a directory of who banks with this platform — and for a legal practice, the
// mere fact that a named person has an account is itself the confidential thing.
//
// WHY IT WRITES ALMOST NOTHING. Confirmed registration is what provisions a firm; the request
// itself only ever costs ONE control-plane row and one email. No bucket, no key mint, no Durable
// Object, no entry in the fleet-wide cron enumeration. That split is the primary anti-abuse control
// on the endpoint, ahead of any limit: a spam run against it buys a row per attempt and nothing
// that costs money.
//
// HUMAN VERIFICATION runs ahead of the mail, through the gate in
// human-verification/human-verification-gate.ts. It is dormant until a verifier credential is
// provisioned, and while it is dormant this route serves exactly as it did before — with every
// unprotected pass counted, so the gap is a number rather than an assumption. The IP-keyed limit the
// chokepoint applies is the other half of the defence and is sized to stand alone, which is what
// makes the dormant state survivable.

const RegistrationRole = z.enum(["account", "clientOfFirm", "firmMember", "foundFirm"]).openapi({
  description:
    "What is being registered. `account` — the default, and the only value the joining surface " +
    "sends — registers a PERSON: confirming it creates their account, and which firm they belong " +
    "to is settled afterwards, signed in. The other three are the superseded role fork, kept so a " +
    "registration started before the reflow still completes: `clientOfFirm` and `firmMember` are " +
    "joined by invitation, and `foundFirm` builds a firm at confirmation.",
});

const StartRegistrationRequest = z
  .object({
    // Optional, defaulting to the account door. A body that names no role is registering a person,
    // which is what the joining surface now sends and what a new caller should mean.
    role: RegistrationRole.optional(),
    email: z.email(),
    name: z.string().trim().min(1).max(200),
    // Only read for the founding door. Trimmed and Unicode-composed so the same typed name is the
    // same name; NOT unique and never used as a lookup key — see firm.display_name.
    firmName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .transform((value) => value.normalize("NFC"))
      .optional(),
  })
  .openapi("StartRegistrationRequest");

const StartRegistrationResponse = z
  .object({
    // What the surface should do next. Identical for every outcome within a door — a taken address
    // and a free one both answer "checkEmail", because the difference between them is not the
    // caller's to know.
    next: z.enum(["checkEmail", "redeemInvitation"]),
  })
  .openapi("StartRegistrationResponse");

const ConfirmRegistrationRequest = z
  .object({ token: z.string().trim().min(1).max(256) })
  .openapi("ConfirmRegistrationRequest");

const ConfirmRegistrationResponse = z
  .object({
    email: z.string(),
    // What the spent token bought. `accountCreated` — the account now exists and the link that
    // sets its password has been sent; which firm it belongs to is decided afterwards, signed in.
    // `provisioning` — a registration from the superseded founding door, whose firm is built in
    // the background, so it answers "accepted and under way" rather than handing back a firm that
    // does not exist yet.
    status: z.enum(["accountCreated", "provisioning"]),
  })
  .openapi("ConfirmRegistrationResponse");

// How long a confirmation link lives. Long enough to survive a mail queue and an evening, short
// enough that an old link in a mailbox is not a standing key.
const CONFIRMATION_LIFETIME_HOURS = 24;

// Where the emailed link lands: the screen that reads `?token=` into its field and spends it only
// on a deliberate press (apps/web/src/routes/register/confirm/+page.svelte) — a link fetched by a
// mail client's preview cannot burn the token, because opening the URL spends nothing.
const CONFIRMATION_SCREEN_PATH = "/register/confirm";

/**
 * The confirmation mail's whole body: a clickable link first, the typed code as the fallback for a
 * mail client that will not open links. `origin` comes from the request that asked for the mail —
 * request-serving paths derive their own origin (APP_BASE_URL exists only for background passes
 * that have no request, e.g. notifications/digest-send-port.ts).
 */
export function confirmationEmailText(
  origin: string,
  token: string,
  // What confirming actually produces, so the mail describes the thing the press creates. An
  // account-first registration makes an ACCOUNT; the superseded founding door makes a workspace.
  produces: "account" | "workspace" = "account",
): string {
  const confirmationLink = `${origin}${CONFIRMATION_SCREEN_PATH}?token=${encodeURIComponent(token)}`;
  return (
    `Open this link to confirm your new Magna Carta ${produces}:\n\n${confirmationLink}\n\n` +
    `Or enter this confirmation code at ${origin}${CONFIRMATION_SCREEN_PATH}:\n\n${token}\n\n` +
    `The link and the code expire in ${CONFIRMATION_LIFETIME_HOURS} hours. ` +
    `If you did not request this, no action is needed.`
  );
}

export const startRegistrationMeta: RouteMeta = {
  operationId: "registrations.start",
  // The anonymous surface: no session, no firm, no cookie. The chokepoint skips its
  // session/firm/RBAC gates and still owns the rate-limit gate, which is the whole enforcement this
  // route wants from it.
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: true,
  // Deliberately NOT "required". An Idempotency-Key is a header a browser form has no reason to
  // mint, and demanding one would turn a missing header into a 400 that distinguishes a
  // well-formed attempt from a malformed one on the most probed endpoint in the platform. The
  // operation is naturally re-runnable: a second registration for the same address supersedes the
  // first rather than creating a second thing.
  idempotency: "optional",
  // The tightest bucket the platform has, because this is the one route an anonymous script can
  // reach that sends mail.
  rateLimit: "auth",
};

export const startRegistrationRoute = defineOpenAPIRoute(startRegistrationMeta, {
  method: "post",
  path: "/api/v1/registrations",
  description:
    "Begins joining the platform. A visitor who is a client of a firm, or works at one, is sent to " +
    "invitation redemption; a visitor founding a firm is emailed a confirmation link, and the firm " +
    "is built only once that link is followed. Every outcome within a door answers identically, so " +
    "the response never reveals whether an address already has an account.",
  request: {
    headers: humanVerificationTokenHeader,
    body: { content: { "application/json": { schema: StartRegistrationRequest } }, required: true },
  },
  responses: {
    202: {
      description: "The registration was accepted; what to do next is in the body",
      content: { "application/json": { schema: StartRegistrationResponse } },
    },
    403: {
      description:
        "Human verification is required and the presented challenge solution was absent, invalid, or already spent",
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
    503: {
      description: "The request could not be verified; the body carries the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const confirmRegistrationMeta: RouteMeta = {
  operationId: "registrations.confirm",
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "auth",
};

export const confirmRegistrationRoute = defineOpenAPIRoute(confirmRegistrationMeta, {
  method: "post",
  path: "/api/v1/registrations/confirmations",
  description:
    "Completes a registration by presenting the emailed token: the firm's build is queued and the " +
    "owner is sent the link that sets their password. An unknown, spent or expired token answers " +
    "one refusal that does not distinguish between them.",
  request: {
    body: {
      content: { "application/json": { schema: ConfirmRegistrationRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The registration is confirmed and the firm is being built",
      content: { "application/json": { schema: ConfirmRegistrationResponse } },
    },
    422: {
      description: "The token will not confirm — unknown, already used, or expired",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description:
        "Rate limit exceeded; the body carries the remaining budget and the retry window",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

interface RegistrationRow {
  readonly id: string;
  readonly role: string;
  readonly email: string;
  readonly display_name: string;
  readonly firm_display_name: string | null;
  readonly confirmation_hash: string;
  readonly status: string;
  readonly expires_at: string;
}

export function registerRegistrationRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  sendEmailForEnv: (env: Bindings) => SendEmail,
  // Confirming an account-first registration ends by sending the link that sets the new account's
  // password, which is Better Auth's own reset flow — the same activation invitation redemption
  // uses. Passed in on the terms invitations.ts takes it: the instance's lifetime belongs to the
  // app, one per isolate.
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
  humanVerification: HumanVerificationGateOptions = {},
): void {
  app.openapi(
    {
      ...startRegistrationRoute,
      middleware: chokepointMiddleware(chokepoint, startRegistrationRoute),
    },
    async (c) => {
      // Before the row and before the mail: the two things an anonymous caller can make this
      // platform spend. Placed inside the handler rather than as route middleware so it runs AFTER
      // the chokepoint's IP-keyed limit — the reasoning is in the gate module.
      const unverified = await enforceHumanVerification(c, humanVerification);
      if (unverified !== null) return unverified;

      const request = c.req.valid("json");
      // Lowercased for the same reason every other write path lowercases: Better Auth's own lookups
      // do, and the activation that eventually finds this person has to find the row we wrote.
      const email = request.email.trim().toLowerCase();
      const role = request.role ?? "account";

      if (role === "clientOfFirm" || role === "firmMember") {
        // Joining an existing firm is that firm's decision. Nothing is written and nothing is
        // looked up — in particular the address is NOT checked against the user table, because a
        // lookup here would be an oracle with a timing signature even if its result were discarded.
        return c.json({ next: "redeemInvitation" as const }, 202);
      }

      const token = generateConfirmationToken();
      const confirmationHash = await confirmationTokenHash(token);
      const nowInstant = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + CONFIRMATION_LIFETIME_HOURS * 60 * 60 * 1000,
      ).toISOString();

      // Is the address already spoken for? The ANSWER never reaches the caller — it only decides
      // which mail goes to the address itself, which is a channel the caller does not necessarily
      // control. Both branches then do the same amount of work and return the same body.
      const existing = await c.env.DB_CONTROL.prepare(
        'SELECT 1 AS present FROM "user" WHERE email = ?1',
      )
        .bind(email)
        .first<{ present: number }>();

      if (existing === null) {
        // A previous unconfirmed registration for the same address is superseded rather than left
        // alongside: two live links for one address means the older one is a second way in that
        // nobody is tracking. The supersede and the insert ride ONE batch so a crash between them
        // cannot leave an address with no live registration at all.
        await commitEffectBatch(
          c.env.DB_CONTROL,
          {
            statements: [
              c.env.DB_CONTROL.prepare(
                "UPDATE registration SET status = 'superseded' WHERE email = ?1 AND status = 'pending'",
              ).bind(email),
              c.env.DB_CONTROL.prepare(
                "INSERT INTO registration (id, role, email, display_name, firm_display_name, " +
                  "confirmation_hash, status, expires_at, created_at) " +
                  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8)",
              ).bind(
                newIdentifier("registration"),
                // The row carries the door, and CONFIRMATION branches on the row rather than on
                // anything a caller says later — which is what lets a registration started under
                // the superseded founding door still complete under its own rules.
                role,
                email,
                request.name,
                // Only the founding door names a firm. An account-first registration names none,
                // because there is no firm yet to name; the person names one afterwards, signed in.
                role === "foundFirm" ? (request.firmName ?? request.name) : null,
                confirmationHash,
                expiresAt,
                nowInstant,
              ),
              insertAuthAuditStatement(c.env.DB_CONTROL, {
                id: newIdentifier("authAudit"),
                event: "registration.started",
                // No user exists yet, so the audit row is actor-less by construction. The metadata
                // is labels only — the address is the one thing that must not be logged, since this
                // row would otherwise become the enumeration list the endpoint refuses to be.
                userId: null,
                metadata: { role },
                now: nowInstant,
              }),
            ],
            outboxMessages: [],
          },
          { now: () => nowInstant },
        );
        const produces = role === "foundFirm" ? "workspace" : "account";
        await sendEmailForEnv(c.env)({
          to: email,
          subject: `Confirm your Magna Carta ${produces}`,
          text: confirmationEmailText(new URL(c.req.url).origin, token, produces),
          messageClass: "registration-confirmation",
        });
      } else {
        // The address already has an account. Telling the CALLER would be the oracle; telling the
        // ACCOUNT HOLDER is the opposite — it is how somebody finds out their address is being
        // used, and it costs an attacker nothing they did not already know.
        await sendEmailForEnv(c.env)({
          to: email,
          subject: "Someone tried to create a Magna Carta workspace with your address",
          text: "Your address already has an account. If this was you, sign in instead; if it was not, no action is needed.",
          messageClass: "registration-address-in-use",
        });
      }

      return c.json({ next: "checkEmail" as const }, 202);
    },
  );

  app.openapi(
    {
      ...confirmRegistrationRoute,
      middleware: chokepointMiddleware(chokepoint, confirmRegistrationRoute),
    },
    async (c) => {
      const { token } = c.req.valid("json");
      const presentedHash = await confirmationTokenHash(token);
      const row = await c.env.DB_CONTROL.prepare(
        "SELECT id, role, email, display_name, firm_display_name, confirmation_hash, status, " +
          "expires_at FROM registration WHERE confirmation_hash = ?1",
      )
        .bind(presentedHash)
        .first<RegistrationRow>();

      const nowInstant = new Date().toISOString();
      // Every refusal takes the same shape and the same comparison. The digest compare runs even
      // when no row was found — against a value nothing can equal — so the unknown-token path costs
      // what the known-token path costs.
      const usable =
        row !== null &&
        digestsMatch(row.confirmation_hash, presentedHash) &&
        row.status === "pending" &&
        row.expires_at > nowInstant;
      if (!usable) {
        return problemJson(c, {
          type: "registration-not-confirmable",
          status: 422,
          title: "That link will not confirm",
          detail:
            "This confirmation link cannot be used. Start again to have a new one sent, or sign in if the workspace already exists.",
        });
      }

      // THE ACCOUNT DOOR. Spending the token creates the person and nothing else: a `user` row
      // carrying NO firm, unverified and credential-less, exactly the shape invitation redemption
      // writes — and the password-setting link that follows is what creates the credential and, in
      // completing, marks the address verified. No bucket, no key, no firm, no queue. Which firm
      // this person belongs to is a decision they make afterwards, signed in, on the joining
      // screen; that is the whole point of registering a person before a relationship.
      if (row.role === "account") {
        const createdUserId = newIdentifier("user");
        let created = true;
        try {
          await commitEffectBatch(
            c.env.DB_CONTROL,
            {
              statements: [
                c.env.DB_CONTROL.prepare(
                  "UPDATE registration SET status = 'confirmed', confirmed_at = ?2 WHERE id = ?1 AND status = 'pending'",
                ).bind(row.id, nowInstant),
                c.env.DB_CONTROL.prepare(
                  'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) ' +
                    "VALUES (?1, ?2, ?3, 0, ?4, ?4, NULL)",
                ).bind(createdUserId, row.display_name, row.email, Date.now()),
                insertAuthAuditStatement(c.env.DB_CONTROL, {
                  id: newIdentifier("authAudit"),
                  event: "registration.confirmed",
                  userId: createdUserId,
                  metadata: { registrationId: row.id },
                  now: nowInstant,
                }),
              ],
              outboxMessages: [],
            },
            { now: () => nowInstant },
          );
        } catch (caught) {
          // The address already has an account — a second registration confirmed after the first,
          // or a token spent twice across a retry. Not an error to report: whoever holds this token
          // holds the mailbox it was sent to, so the right thing is the same thing, which is to
          // send them the link that gets them in. The batch rolled back whole, so the registration
          // row is untouched and nothing partial was written.
          if (!isUserEmailConflict(caught)) throw caught;
          created = false;
        }

        // The activation link, on both paths. A fresh account has no credential and this creates
        // it; an address that already had one gets the ordinary recovery. Sent AFTER the commit, on
        // the same accepted seam every other activation path takes: a send that throws leaves a
        // real account whose owner recovers with Reset Password from the sign-in screen.
        await authForEnv(c.env).api.requestPasswordReset({ body: { email: row.email } });
        if (created) scheduleRequestPathSweep(c.executionCtx, c.env);
        return c.json({ email: row.email, status: "accountCreated" as const }, 200);
      }

      // The firm is NOT built here. Provisioning creates a bucket, mints a key, and spends the
      // account's storage-API budget — none of which belongs in a request handler an anonymous
      // caller triggers. The outbox row commits with the status flip, and the sweep's consumer does
      // the work; the same row is the retry, so a build that dies part-way resumes rather than
      // stranding a half-made firm. Golden-rule-10 shape: the handler answers, the work happens off
      // the request.
      const firmDisplayName = row.firm_display_name ?? row.display_name;
      await commitEffectBatch(
        c.env.DB_CONTROL,
        {
          statements: [
            c.env.DB_CONTROL.prepare(
              "UPDATE registration SET status = 'confirmed', confirmed_at = ?2 WHERE id = ?1 AND status = 'pending'",
            ).bind(row.id, nowInstant),
            insertAuthAuditStatement(c.env.DB_CONTROL, {
              id: newIdentifier("authAudit"),
              event: "registration.confirmed",
              userId: null,
              metadata: { registrationId: row.id },
              now: nowInstant,
            }),
          ],
          // The transactional-outbox guarantee: the row describing the work commits with the status
          // flip that authorized it, so there is no state in which a registration reads confirmed
          // and nothing is ever going to build its firm.
          outboxMessages: [
            {
              topic: "firm.provision",
              payload: {
                registrationId: row.id,
                firmDisplayName,
                owner: { email: row.email, name: row.display_name },
              },
            },
          ],
        },
        { now: () => nowInstant },
      );

      // Close the window where a confirmed owner is waiting on the next five-minute cron before
      // their workspace exists. Best-effort and off the response path — the sweep remains the
      // at-least-once guarantee, exactly as members.invite and firms.provision treat it.
      scheduleRequestPathSweep(c.executionCtx, c.env);

      return c.json({ email: row.email, status: "provisioning" as const }, 200);
    },
  );
}
