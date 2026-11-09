import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { createEmailVerificationToken } from "better-auth/api";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../../bindings.ts";
import type { createAuth } from "../../../auth.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { isUserEmailConflict } from "../../../control-plane-conflicts.ts";
import { sendMessage, type EmailDelivery } from "../../../email-delivery.ts";
import type { SendEmail } from "../../../email-port.ts";
import {
  hashChosenPassword,
  insertCredentialAccountStatement,
  PASSWORD_MAXIMUM_LENGTH,
  PASSWORD_MINIMUM_LENGTH,
} from "../../../joining-credentials.ts";
import {
  enforceHumanVerification,
  humanVerificationTokenHeader,
  type HumanVerificationGateOptions,
} from "../../human-verification/human-verification-gate.ts";
import {
  confirmationTokenHash,
  digestsMatch,
  generateConfirmationToken,
} from "../../../joining-secrets.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { scheduleRequestPathSweep } from "../../request-path-sweep.ts";

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
    // OPTIONAL, because the account door no longer asks for one. A name is a PROFILE fact, not part
    // of the credential, and the row it lands on needs a display name rather than a person's name:
    // absent, the address itself is used, which is a placeholder somebody can replace afterwards
    // rather than a guess split out of the address, which cannot be undone.
    name: z.string().trim().min(1).max(200).optional(),
    // The two parts the joining screen already asks for separately, and used to throw away by
    // joining them with a space. Carried so an account created from today holds real name parts
    // from its first moment and nobody has to have their name split back apart later — a split
    // that cannot be done without guessing. Optional, because a caller that only has the one line
    // (an older client, a door that asks differently) still registers exactly as before.
    givenName: z.string().trim().max(200).optional(),
    familyName: z.string().trim().max(200).optional(),
    // The password the visitor chooses, here rather than through a second mail. Hashed in this
    // request and never stored, logged or queued in the clear; what is kept until the token is
    // spent is the scrypt verifier, on a row that expires in 24 hours.
    //
    // OPTIONAL AT THE SCHEMA LAYER, REQUIRED BY THE TWO DOORS THAT CREATE SOMETHING. The bounds
    // below are Better Auth's own configured rule, so a password that is present is refused by a
    // published rule rather than opaquely; absence is the handler's 422, which lets the two
    // invitation doors — which create nothing and are redeemed elsewhere — keep answering a body
    // that has no password in it at all, including from a client built before this field existed.
    password: z
      .string()
      .min(PASSWORD_MINIMUM_LENGTH)
      .max(PASSWORD_MAXIMUM_LENGTH)
      .optional()
      .openapi({
        description:
          `The password the person is choosing, ${PASSWORD_MINIMUM_LENGTH}-${PASSWORD_MAXIMUM_LENGTH} ` +
          "characters. Required for the doors that create an account (`account`, `foundFirm`); " +
          "ignored by the two invitation doors, which create nothing.",
      }),
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
    // What the spent token bought. `accountCreated` — the account now exists, with the password
    // chosen at registration already attached; which firm it belongs to is decided afterwards,
    // signed in. `provisioning` — a registration from the superseded founding door, whose firm is
    // built in the background, so it answers "accepted and under way" rather than handing back a
    // firm that does not exist yet.
    status: z.enum(["accountCreated", "provisioning"]),
    // Where the person goes, which is a fact about whether they already hold a password AND about
    // whether this response carries a session:
    //
    //   signedIn      — the ordinary answer. The account exists, holds the password chosen at
    //                   registration, and this response Set-Cookie'd a session for it: spending the
    //                   token proved the mailbox, which is the same possession proof a mailed
    //                   sign-in link rests on, so there is nothing left to ask. The caller goes
    //                   straight into the app.
    //   signIn        — the credential exists but no session came with it, because minting one did
    //                   not work. Never a dead end: the password is already set, so the front door
    //                   opens on the first try.
    //   checkEmail    — a registration started BEFORE passwords were chosen at registration, which
    //                   carries no password to attach; the reset link that creates one has been
    //                   asked for instead.
    //
    // THERE IS DELIBERATELY NO "the mail did not send" VALUE on this response, and its absence is a
    // fact about the library rather than an omission: the reset mail is sent from inside Better
    // Auth, whose runInBackgroundOrAwait awaits the send and then swallows whatever it throws into
    // its own logger, so the endpoint resolves identically whether or not a mail left. A value here
    // would be a promise this route cannot keep. The failure is instead caught at the PORT, one
    // layer down (app.ts), where it is counted and correlated — visible to an operator, which is the
    // most this path can honestly offer until the reset token is minted by us rather than by the
    // library.
    next: z.enum(["signedIn", "signIn", "checkEmail"]),
  })
  .openapi("ConfirmRegistrationResponse");

// How long a confirmation link lives. Long enough to survive a mail queue and an evening, short
// enough that an old link in a mailbox is not a standing key.
const CONFIRMATION_LIFETIME_HOURS = 24;

// How long a caller is told to wait after a send that would not go through. Long enough for a
// transient provider fault to clear, short enough that somebody standing at the front door is not
// told to come back later than they will.
const MAIL_RETRY_AFTER_SECONDS = 30;

// The closed label this handler counts a mail failure under. A route template, so the counter
// answers "which door stopped mailing" without a dimension anything caller-supplied can reach.
const START_REGISTRATION_SURFACE = "POST /api/v1/registrations";

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
    "invitation redemption; anyone creating an account chooses their password here and is emailed a " +
    "confirmation link, and the account — with that password already set — is created only once " +
    "that link is followed. Every outcome within a door answers identically, so the response never " +
    "reveals whether an address already has an account.",
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
      description:
        "The request could not be verified, or the confirmation email could not be sent; the body " +
        "carries the retry window and an Error ID. Nothing the request committed is lost — retrying " +
        "supersedes it and sends a fresh mail.",
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
    "Completes a registration by presenting the emailed token: the account is created with the " +
    "password chosen at registration and the response carries a session for it, because the token " +
    "travelled by email and spending it proves the mailbox. A founding registration additionally " +
    "queues its firm's build. An unknown, spent or expired token answers one refusal that does not " +
    "distinguish between them.",
  request: {
    body: {
      content: { "application/json": { schema: ConfirmRegistrationRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "The registration is confirmed; `next` says whether a session came with it, and if not, " +
        "what the person does instead",
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
  readonly name_given: string | null;
  readonly name_family: string | null;
  readonly firm_display_name: string | null;
  readonly confirmation_hash: string;
  readonly status: string;
  readonly expires_at: string;
  // The password chosen at registration, hashed. Null for a registration started before the column
  // existed — the one branch that still owes an activation mail.
  readonly credential_hash: string | null;
}

/*
 * THE SESSION A CONFIRMED REGISTRATION IS HANDED, and the reason it is handed one at all: the token
 * spent to get here travelled by email and nothing else, so whoever spent it holds the mailbox. That
 * is the same possession proof a mailed sign-in link rests on and a strictly stronger one than the
 * password that would otherwise be asked for on the very next screen — so asking for the password
 * again buys nothing and costs somebody their first minute in the product.
 *
 * IT GOES THROUGH BETTER AUTH'S OWN VERIFY-EMAIL ENDPOINT rather than writing a session row and a
 * cookie by hand. That endpoint is the library's supported "the mailbox answered, let them in" path
 * (`emailVerification.autoSignInAfterVerification` in ../auth.ts turns the sign-in half on), and
 * going through it means the session row, the signed cookie, the cookie cache and the login.success
 * audit are whatever the installed library currently does, including across an upgrade that changes
 * any of them. Which is why the account is inserted UNVERIFIED and verified here: the endpoint
 * declines to mint a session for an address that is already verified, so flipping the column
 * ourselves first would silently cost the session.
 *
 * The token is minted and spent inside this one request and never travels — it is the library's own
 * verification JWT, the same one a verification mail would carry.
 *
 * A NULL RESULT IS NOT AN ERROR, it is "no session, sign in normally". The account and its credential
 * are already committed by the time this runs; the caller's fallback flips the verified column
 * directly and answers `signIn`, which is exactly the screen this feature removes on the happy path
 * and a working door on the unhappy one.
 */
async function sessionForConfirmedAccount(
  auth: ReturnType<typeof createAuth>,
  email: string,
): Promise<string[] | null> {
  try {
    const context = await auth.$context;
    const token = await createEmailVerificationToken(context.secret, email);
    const { headers } = await auth.api.verifyEmail({
      query: { token },
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie();
    return cookies.length > 0 ? cookies : null;
  } catch {
    return null;
  }
}

export function registerRegistrationRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  sendEmailForEnv: (env: Bindings) => SendEmail,
  // Better Auth is reached for three things here: its configured password hasher (the one sign-in
  // verifies against, so the credential this route writes is the credential that route reads); its
  // verify-email endpoint, which is what hands a confirmed registration its session
  // (sessionForConfirmedAccount above); and — only for a registration started before passwords were
  // chosen at registration — its reset flow. Passed in on the terms invitations.ts takes it: the
  // instance's lifetime belongs to the app, one per isolate.
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
      // The name the row is filed under. `display_name` is NOT NULL and is what a screen prints, so
      // a door that asks for no name files the address — visibly a placeholder, and true.
      const displayName = request.name ?? email;

      if (role === "clientOfFirm" || role === "firmMember") {
        // Joining an existing firm is that firm's decision. Nothing is written and nothing is
        // looked up — in particular the address is NOT checked against the user table, because a
        // lookup here would be an oracle with a timing signature even if its result were discarded.
        return c.json({ next: "redeemInvitation" as const }, 202);
      }

      // The two doors that CREATE an account need the password now, because the account is created
      // with it. Refused as a field-level 422 naming the rule rather than a bare rejection — the
      // schema publishes the bounds, and this publishes the requirement.
      if (request.password === undefined) {
        return problemJson(c, {
          type: "validation",
          status: 422,
          title: "Validation failed",
          errors: [
            {
              path: "password",
              code: "required",
              detail:
                `Choose a password of ${PASSWORD_MINIMUM_LENGTH}-${PASSWORD_MAXIMUM_LENGTH} ` +
                "characters. It is set when you confirm, so there is no second email to wait for.",
            },
          ],
        });
      }

      // Hashed HERE, in the only request the plaintext exists in, with Better Auth's own hasher.
      // Nothing downstream ever sees the password itself: the row carries the verifier, and the
      // batch at confirmation moves it onto the credential account.
      const credentialHash = await hashChosenPassword(authForEnv(c.env), request.password);

      const token = generateConfirmationToken();
      const confirmationHash = await confirmationTokenHash(token);
      const nowInstant = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + CONFIRMATION_LIFETIME_HOURS * 60 * 60 * 1000,
      ).toISOString();

      // Whether the one mail this endpoint owes actually went out. Declared here because both
      // branches below set it and the answer they share is decided once, after them.
      let delivery: EmailDelivery;

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
                  "confirmation_hash, status, expires_at, created_at, credential_hash, " +
                  "name_given, name_family) " +
                  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9, ?10, ?11)",
              ).bind(
                newIdentifier("registration"),
                // The row carries the door, and CONFIRMATION branches on the row rather than on
                // anything a caller says later — which is what lets a registration started under
                // the superseded founding door still complete under its own rules.
                role,
                email,
                displayName,
                // Only the founding door names a firm. An account-first registration names none,
                // because there is no firm yet to name; the person names one afterwards, signed in.
                role === "foundFirm" ? (request.firmName ?? displayName) : null,
                confirmationHash,
                expiresAt,
                nowInstant,
                credentialHash,
                request.givenName ?? null,
                request.familyName ?? null,
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
        delivery = await sendMessage({
          send: sendEmailForEnv(c.env),
          surface: START_REGISTRATION_SURFACE,
          logger: c.get("logger"),
          correlationId: c.get("correlationId") ?? "",
          message: {
            to: email,
            subject: `Confirm your Magna Carta ${produces}`,
            text: confirmationEmailText(new URL(c.req.url).origin, token, produces),
            messageClass: "registration-confirmation",
          },
        });
      } else {
        // The address already has an account. Telling the CALLER would be the oracle; telling the
        // ACCOUNT HOLDER is the opposite — it is how somebody finds out their address is being
        // used, and it costs an attacker nothing they did not already know.
        delivery = await sendMessage({
          send: sendEmailForEnv(c.env),
          surface: START_REGISTRATION_SURFACE,
          logger: c.get("logger"),
          correlationId: c.get("correlationId") ?? "",
          message: {
            to: email,
            subject: "Someone tried to create a Magna Carta workspace with your address",
            text: "Your address already has an account. If this was you, sign in instead; if it was not, no action is needed.",
            messageClass: "registration-address-in-use",
          },
        });
      }

      // NO MAIL, NO 202. Answering "check your email" when nothing was sent points somebody at an
      // inbox that will never receive anything, and they have no way to discover that — it is the
      // worst of the three available answers, worse than a refusal and worse than an outage.
      //
      // A 503, NOT A 500, for the reason the human-verification gate states in the same words: this
      // is a live dependency that would not answer, the caller CAN act on it, and retrying is a real
      // remedy here — a second registration for the same address supersedes the first and sends a
      // fresh mail, which is the operation's documented behaviour rather than a special case built
      // for this refusal.
      //
      // BOTH BRANCHES ANSWER IDENTICALLY, which is not incidental: the address-in-use branch and the
      // fresh-registration branch send to the same address through the same adapter, so they fail
      // together, and answering differently would turn a mail outage into the account-existence
      // oracle the whole endpoint is arranged to deny.
      if (!delivery.delivered) {
        return problemJson(c, {
          type: "mail-undeliverable",
          status: 503,
          title: "The confirmation email could not be sent",
          detail:
            "We could not send the confirmation email just now. Try again shortly — nothing was lost.",
          retryAfterSeconds: MAIL_RETRY_AFTER_SECONDS,
          errorId: delivery.errorId,
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
        "SELECT id, role, email, display_name, name_given, name_family, firm_display_name, confirmation_hash, status, " +
          "expires_at, credential_hash FROM registration WHERE confirmation_hash = ?1",
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

      // THE ACCOUNT DOOR. Spending the token creates the person and the credential they chose, and
      // nothing else: a `user` row carrying NO firm, its address VERIFIED — the token travelled by
      // mail and spending it is the possession proof verification asks for — and the credential
      // `account` row holding the password from the registration, committed in the SAME batch. No
      // bucket, no key, no firm, no queue, and no second mail: a person who has been given an
      // account can sign in with it immediately. Which firm they belong to is a decision they make
      // afterwards, signed in, on the joining screen; that is the whole point of registering a
      // person before a relationship.
      if (row.role === "account") {
        const createdUserId = newIdentifier("user");
        const nowEpochMilliseconds = Date.now();
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
                  'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id, name_given, name_family) ' +
                    "VALUES (?1, ?2, ?3, ?5, ?4, ?4, NULL, ?6, ?7)",
                ).bind(
                  createdUserId,
                  row.display_name,
                  row.email,
                  nowEpochMilliseconds,
                  // UNVERIFIED AT INSERT, on every path. Spending the token IS the proof the mailbox
                  // was reached, and the flip belongs to the act that also hands out the session:
                  // Better Auth's verify-email endpoint declines to mint one for an address already
                  // marked verified, so writing 1 here would quietly cost the sign-in it is the whole
                  // point of. sessionForConfirmedAccount performs it a few lines below, and the
                  // fallback there performs it directly when no session could be minted. A legacy row
                  // carrying no password keeps the unverified shape its own activation mail completes.
                  0,
                  // The parts the registration carried, or null where it carried none — never a
                  // split of `display_name`, which cannot be undone without guessing.
                  row.name_given,
                  row.name_family,
                ),
                // The credential, in the same batch as the person. Committing the user without it
                // is the state that made a mail failure an account nobody could ever sign in to.
                ...(row.credential_hash === null
                  ? []
                  : [
                      insertCredentialAccountStatement(c.env.DB_CONTROL, {
                        userId: createdUserId,
                        passwordHash: row.credential_hash,
                        nowEpochMilliseconds,
                      }),
                    ]),
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

        if (created) scheduleRequestPathSweep(c.executionCtx, c.env);

        // THE ORDINARY ANSWER, and the point of the whole reflow: the account exists, already holds
        // the password this person chose, and is signed in on the strength of the token they just
        // spent. There is no mail to wait for and no front door to walk back round to.
        if (created && row.credential_hash !== null) {
          const sessionCookies = await sessionForConfirmedAccount(authForEnv(c.env), row.email);
          if (sessionCookies !== null) {
            for (const cookie of sessionCookies) c.header("set-cookie", cookie, { append: true });
            return c.json(
              { email: row.email, status: "accountCreated" as const, next: "signedIn" as const },
              200,
            );
          }
          // No session, and the verified column is still 0 because the endpoint that would have
          // flipped it is the one that did not run. Flip it here rather than leave the account in
          // the one state it cannot sign in from: requireEmailVerification would refuse the very
          // password this registration just committed, which is the locked-out-forever failure the
          // whole credential-at-registration design exists to remove.
          await c.env.DB_CONTROL.prepare(
            'UPDATE "user" SET email_verified = 1, updated_at = ?2 WHERE id = ?1',
          )
            .bind(createdUserId, Date.now())
            .run();
          return c.json(
            { email: row.email, status: "accountCreated" as const, next: "signIn" as const },
            200,
          );
        }

        // TWO CASES REACH HERE AND BOTH WANT A RESET LINK RATHER THAN A CREDENTIAL WRITTEN FROM
        // THIS ROW. `!created` means the address already had an account: whoever holds this token
        // holds the mailbox, so the right thing is the ordinary recovery — and silently replacing a
        // standing password with one typed into a registration form would be an account takeover
        // wearing a registration's clothes. A null credential_hash means a registration started
        // before passwords were chosen at registration, which has no password to attach and
        // completes the way it began.
        // Awaited but never inspected: the send's outcome is recorded at the port (app.ts), which
        // is the only layer that can see it.
        await authForEnv(c.env).api.requestPasswordReset({ body: { email: row.email } });

        // NOT a 503, and not a report of whether the mail went: the token has been spent, so "try
        // again" is advice that cannot work, and the library gives this handler no way to know
        // whether the send succeeded (see the note on `next`). The screen's own remedy — Reset
        // Password from the sign-in screen — covers the case where nothing arrives.
        return c.json(
          { email: row.email, status: "accountCreated" as const, next: "checkEmail" as const },
          200,
        );
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

      // The credential travels on the registration row, not in the message — the consumer reads it
      // back by registration id and commits it with the owner. A password verifier has no business
      // in a queue payload that outlives the row it came from and is read by a different consumer.
      return c.json(
        {
          email: row.email,
          status: "provisioning" as const,
          // The owner's credential is created by the provisioning batch from the password they
          // chose, so sign-in is where they go once the workspace is up. A registration started
          // before that column existed still gets the activation mail the consumer sends.
          next: row.credential_hash === null ? ("checkEmail" as const) : ("signIn" as const),
        },
        200,
      );
    },
  );
}
