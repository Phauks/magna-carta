import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import * as controlPlaneSchema from "@magna-carta/database/control-plane-schema";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { EntityType } from "@magna-carta/identifiers/registry";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "./bindings.ts";
import type { SendEmail } from "./email-port.ts";
import { passwordResetEmailText, passwordResetScreenLink } from "./password-reset-link.ts";

// Better Auth model name -> identifiers-registry entity type, for minting prefixed handles
// (usr_/ses_/acc_/ver_/twf_). Unknown models fail loud below: silently minting some
// other prefix would defeat self-describing ids. Adding a Better Auth plugin that stores rows =
// one entry here + a registry prefix + a control-plane migration.
const ENTITY_TYPE_BY_MODEL: Partial<Record<string, EntityType>> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  twoFactor: "twoFactor",
};

// RECOVERY CODES — the codes a member writes down and comes back to a year later, so the shape is
// chosen for being read off paper and typed by hand rather than for looking cryptographic.
//
// The `MC` prefix makes a code recognisable in a password manager, a safe, or a printed sheet
// alongside codes from other services — the one thing that stops somebody trying an unrelated
// service's codes here and burning their attempt budget. It adds NO entropy, which is precisely why
// the random part is not shortened to pay for it: ten characters is what the library's own default
// carries and the prefix is on top, never instead.
//
// The alphabet excludes `I l 1 O 0` for the same reason the invitation alphabet does
// (joining-secrets.ts): those are the glyph pairs a person mistypes off paper, and a recovery code
// is used on the worst day somebody is having.
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_RANDOM_LENGTH = 10;
const RECOVERY_CODE_COUNT = 10;

function recoveryCodes(): string[] {
  // Rejection-sampled to stay uniform: 256 is not a multiple of the alphabet's length, so a bare
  // modulo would make the first few letters more likely and quietly shrink the code's space.
  const limit = Math.floor(256 / RECOVERY_CODE_ALPHABET.length) * RECOVERY_CODE_ALPHABET.length;
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    let random = "";
    while (random.length < RECOVERY_CODE_RANDOM_LENGTH) {
      for (const byte of crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_RANDOM_LENGTH * 2))) {
        if (byte >= limit) continue;
        random += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
        if (random.length === RECOVERY_CODE_RANDOM_LENGTH) break;
      }
    }
    codes.push(`MC${random}`);
  }
  return codes;
}

// Auth audit writes are observability, not gates: the INSERT failing must never break
// the auth flow it describes — Better Auth runs databaseHooks unguarded, so a throw here would
// surface as a 500 on the auth route. A failure is logged through the telemetry pipeline
// (operation.failed, the audit event name in the operation label; metadata is ids-only by contract
// and never echoed) and swallowed. The guarded-vs-batched audit split is documented at its one
// home: @magna-carta/data-access auth-audit-statements.ts.
async function writeAuthAuditGuarded(
  env: Bindings,
  input: { event: string; userId: string | null; metadata?: unknown },
): Promise<void> {
  try {
    await insertAuthAuditStatement(env.DB_CONTROL, {
      id: newIdentifier("authAudit"),
      event: input.event,
      userId: input.userId === null ? null : assertIdentifier(input.userId, "user"),
      metadata: input.metadata ?? null,
      now: new Date().toISOString(),
    }).run();
  } catch (caught) {
    logOperationFailed(
      createWorkersLogger(env.TELEMETRY),
      `auth-audit-write:${input.event}`,
      caught,
    );
  }
}

// The ONE home for the Better Auth integration shape. app.ts caches one
// instance per worker env; tests construct directly against the Miniflare control-plane D1.
// Routes mount at Better Auth's default basePath, /api/auth.
export function createAuth(env: Bindings, sendEmail: SendEmail) {
  const database = drizzle(env.DB_CONTROL, { schema: controlPlaneSchema });
  // Pairs user.update.before (which sees the PATCH) with user.update.after (which sees only the
  // updated row) so the two_factor audit is TRANSITION-exact: the pinned 1.6.16 flips
  // user.twoFactorEnabled through internalAdapter.updateUser (no dedicated plugin hook exists),
  // and auditing on the after-state alone would fire false two_factor.enabled events on every
  // unrelated update of an enrolled user (e.g. the verify-email flip). Better Auth passes the
  // SAME endpoint-context object to both halves of one update, so it keys the pairing; a null
  // context (an update outside an endpoint) skips the audit rather than guessing. WeakMap over
  // Map because an abandoned entry (a before whose after never runs) is garbage-collected with
  // its context — no cleanup path needed. The rejected alternative, reading the prior state back
  // from the database in the before hook, costs a SELECT on every user update on the hot path and
  // races concurrent updates of the same user. If a library upgrade stops passing one shared
  // context object to both halves, this pairing fails QUIET (the two_factor audit events simply
  // stop firing) — test/auth-audit.test.ts is the canary.
  const twoFactorPatchByHookContext = new WeakMap<object, boolean>();
  return betterAuth({
    secret: env.AUTH_SECRET,
    // THE PUBLIC ORIGIN THIS DEPLOYMENT IS REACHED AT. Left unset, Better Auth derives it from each
    // incoming request and warns that callbacks and redirects may not work — which is not a cosmetic
    // warning here: the same value is what a request-less path (a queue consumer sending mail) has
    // no way to derive at all, and a link built against the wrong origin is a link that goes
    // nowhere. Set from APP_BASE_URL when the deployment declares one, and left to the
    // request-derived default when it does not, so local development and the test pool — which are
    // reached at whatever host they happen to be served on — keep working unconfigured.
    ...(env.APP_BASE_URL !== undefined && env.APP_BASE_URL !== ""
      ? { baseURL: env.APP_BASE_URL }
      : {}),
    // …AND the origin a request actually arrived at, trusted alongside it.
    //
    // Setting `baseURL` above fixes the origin links are BUILT against. It also, as a side effect,
    // fixes the only origin the CSRF middleware will accept a cookie-bearing POST from — so the
    // moment APP_BASE_URL was declared, signing in anywhere the deployment is reached under another
    // name started answering 403 "Invalid origin": `wrangler dev` on 127.0.0.1, a preview
    // deployment, and every test in this app that signs in. An account nobody can sign into is the
    // failure mode this codebase has now paid for twice, so the two concerns are separated rather
    // than left coupled.
    //
    // Trusting the request's OWN origin is not a weakening of the check. A cross-site POST from an
    // attacker's page carries that page's origin, which still will not equal the origin the request
    // was addressed to; what this restores is exactly the per-request derivation Better Auth did
    // before a baseURL was declared. The function's result is unioned with the configured list, so
    // the production origin stays trusted whatever a request claims.
    // The parameter is OPTIONAL, and the library means it: this hook is called on server-side paths
    // that have no request at all (resolving the context, a queue consumer asking for a reset
    // link). Reading `.url` off the absent one throws a TypeError out of every such call, so the
    // absence is handled rather than assumed away — a request-less call simply contributes no extra
    // origin, leaving the configured one to answer.
    trustedOrigins: (request?: Request) =>
      request === undefined ? [] : [new URL(request.url).origin],
    // The encryption-key ROTATION ARRAY. Better Auth uses this same keyset to encrypt at-rest
    // credentials it owns outside the firm-keyed chokepoint — most importantly the TOTP seed (the
    // twoFactor plugin's symmetricEncrypt of the secret). A TOTP seed is a USER credential read at
    // login before any firm context exists, so it is encrypted here by structure, not oversight.
    // In the pinned better-auth 1.6.16 the option is `secrets` (NOT `encryptionKeys` — verified
    // against the pinned source; the rename is recorded in the slice's deviation note): an array of
    // { version, value }, element 0 the CURRENT key that encrypts, every element a decrypt key. A
    // future rotation prepends a new version and the old one keeps decrypting historical seeds —
    // a dual-read migration, never a flag day. Version 0 is the existing AUTH_SECRET, so already
    // stored values still decrypt; `secret` above stays set for signing and as the legacy fallback.
    secrets: [{ version: 0, value: env.AUTH_SECRET }],
    // transaction: false — D1 has no interactive transactions (BEGIN is rejected), so the
    // adapter runs multi-operation flows sequentially instead of wrapping them in one.
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: controlPlaneSchema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      // Membership is invitation-only: the public signup route always
      // 4xxes; users are provisioned through the invitation flow instead.
      disableSignUp: true,
      requireEmailVerification: true,
      // The mailed link goes straight at the screen that spends the token, never at the library's
      // own redirect endpoint (which spends it on a bare GET — a mail client's link preview would
      // burn it). Origin selection and the reasoning live in password-reset-link.ts. `request` is
      // present on the HTTP path and absent when a queue consumer asks (the firm-provision
      // owner-activation mail), which is what APP_BASE_URL is for.
      sendResetPassword: async ({ user, token }, request) => {
        const link = passwordResetScreenLink({
          token,
          requestUrl: request?.url,
          appBaseUrl: env.APP_BASE_URL,
        });
        await sendEmail({
          to: user.email,
          subject: "Set your Magna Carta password",
          text: passwordResetEmailText(link),
          messageClass: "password-reset",
        });
      },
      // Completing a reset proves control of the mailbox (the token only ever travels by email) —
      // the same possession proof email verification asks for, so the flag flips here.
      //
      // IT IS NO LONGER HOW SOMEBODY GETS THEIR FIRST PASSWORD, on the door most people arrive
      // through: a person registering chooses their password then, and confirming the emailed token
      // commits the credential with the account (routes/registrations.ts). Reset is back to being
      // what its name says — replacing a password you already have.
      //
      // It IS still the activation link on the two doors that cannot collect a password: invitation
      // redemption, where the mailed link is the only proof of the mailbox, and the operator door,
      // where an admin types a name and there is no password to have chosen. Both insert the user
      // unverified with no credential account, and Better Auth's reset endpoint creates the missing
      // credential account before setting the password (verified against the installed 1.6.22:
      // api/routes/password.mjs inserts one when findAccounts turns up no credential provider).
      // Without this flip, requireEmailVerification would then lock every such person out at
      // sign-in.
      onPasswordReset: async ({ user }) => {
        await env.DB_CONTROL.prepare(
          'UPDATE "user" SET email_verified = 1, updated_at = ?2 WHERE id = ?1',
        )
          .bind(user.id, Date.now())
          .run();
        // password.reset audit: 1.6.16 exposes no password-reset databaseHook, so
        // this server hook — which receives the user post-reset — is the natural home.
        await writeAuthAuditGuarded(env, { event: "password.reset", userId: user.id });
      },
    },
    emailVerification: {
      // A VERIFIED MAILBOX IS A SIGNED-IN PERSON. The verification token only ever travels by email,
      // so spending one proves possession of the address — the same proof a mailed sign-in link
      // rests on, and a stronger one than the password the next screen would otherwise ask for. This
      // is what lets registration end inside the product instead of at the front door:
      // routes/registrations.ts spends a freshly minted token the moment a confirmed registration's
      // account is committed, and forwards the session cookie this sets onto its own response.
      //
      // It changes nothing for a person who is ALREADY signed in when they verify — the endpoint
      // keeps their existing session rather than rotating it — and nothing at all for the reset
      // flow, which mints its own tokens and has its own hook below.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Verify your email",
          text: url,
          messageClass: "email-verification",
        });
      },
    },
    session: {
      // THE SESSION RIDES A SIGNED COOKIE FOR FIVE MINUTES AT A TIME. Without this, every API
      // request pays Better Auth's control-plane session lookup before any work starts — measured
      // in production at hundreds of milliseconds of the time a screen waits, multiplied by the
      // half-dozen parallel reads a screen fires. With it, getSession answers from an HMAC-signed
      // session_data cookie while that cookie is fresh, and re-signs it from the store when it is
      // not — session-context.ts forwards those refresh Set-Cookie headers to the caller, which is
      // what keeps the cache renewing past its first five minutes.
      //
      // What this trades, and why it holds (owner's direction, 2026-08-31: a signed-in member is
      // trusted to be here): a session revoked SERVER-side — sign-out-everywhere, an expired row —
      // stays believable on an already-issued cookie for up to maxAge. It does NOT loosen the
      // checks that answer for a person's standing in their firm, which run per request against
      // live stores regardless: the member-active gate and RBAC read the firm database every time,
      // and the firm row gate reads the control plane every time. Sign-out on the device itself
      // clears both cookies immediately. The one fact the cookie can hold stale — a firmless
      // session whose firm was attached by a direct control-plane write the library never saw —
      // is re-read fresh in session-context.ts before it is believed.
      cookieCache: {
        enabled: true,
        maxAge: 300,
      },
      // THE FRESHNESS DIAL, OFF — because in the pinned 1.6.22 it gates a READ and none of the
      // writes anybody would want it for. `freshSessionMiddleware` is mounted on exactly two
      // endpoints: /list-sessions and /unlink-account (no social provider is configured here, so
      // that one is unreachable). Revoking a session, changing a password and deleting an account
      // all go through `sensitiveSessionMiddleware`, which re-reads the session store and does NOT
      // consult freshAge. Left at the library default of one day, the only thing it would do here
      // is 403 the signed-in-devices screen (apps/web/src/routes/account/sessions) for anybody
      // signed in longer than a day — which is precisely the long-lived "keep me signed in"
      // session that screen exists to let somebody find and end. Being unable to SEE a suspicious
      // device while still being allowed to revoke one is not a security posture, it is a gap.
      //
      // This is not the step-up re-authentication the account surface is designed around; that is
      // a deliberate re-prompt in front of a named act, and it is still to be built. When it lands
      // it goes in front of the acts, not in front of a list.
      freshAge: 0,
    },
    // The one tenant firm this person belongs to; input: false keeps the field out of every
    // request body — only server-side code (the joining paths) ever sets it. required: false
    // because an account exists before it has a firm: the joining surface creates the person, and
    // the firm is attached afterwards by founding one or by redeeming an invitation. A session
    // carrying no firm is admitted by exactly three routes and answered with the reserved 404
    // everywhere else (chokepoint/chokepoint.ts).
    user: {
      additionalFields: {
        firmId: { type: "string", required: false, input: false },
      },
    },
    advanced: {
      // Cookies stay at Better Auth's HOST-ONLY default (crossSubDomainCookies off => the session
      // cookie carries no Domain attribute, so it is scoped to the exact host that set it). Do NOT
      // enable cross-subdomain cookies: every user belongs to exactly one firm, and firms get branded
      // per-firm subdomains (<firm>.magnacarta.esq) — a parent-scoped cookie would be sent to every
      // sibling firm's subdomain AND to the cookieless files.* delivery host, leaking a session across
      // tenants. (__Host- would harden this further, but the pinned better-auth emits __Secure-, not
      // __Host-, with no option to force it.) Pinned by test/auth-cookie-isolation.test.ts.
      database: {
        generateId: ({ model }) => {
          const entityType = ENTITY_TYPE_BY_MODEL[model];
          if (entityType === undefined) {
            throw new Error(
              `createAuth: no identifier prefix registered for Better Auth model "${model}"`,
            );
          }
          return newIdentifier(entityType);
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // login.success approximates session establishment: it fires on credential sign-in and
          // on the 2FA verify-totp completion — and ALSO on the session rotation Better Auth
          // performs when 2FA is enabled mid-session (pinned 1.6.16 behavior). Accepted: the
          // rotation is a fresh proof of the same principal's session, and 1.6.16 exposes no way
          // to distinguish it inside this hook.
          after: async (session) => {
            await writeAuthAuditGuarded(env, { event: "login.success", userId: session.userId });
          },
        },
        delete: {
          // WHICH SESSION DELETION MEANT SOMETHING — decided by the endpoint AND by whether the row
          // that went is the one that endpoint was asked to remove. The endpoint alone is not
          // enough, and the reason is worth stating because it is not visible from here.
          //
          // A session row is deleted by half a dozen paths in the pinned 1.6.22 that are not a
          // person ending a session: sweeping an EXPIRED row on a read, and the rotation the
          // two-factor plugin performs when a factor is enabled or disabled mid-session. Auditing
          // every deletion would put a departure in the trail at the moment somebody was signing IN
          // with a second factor, and a trail that says the opposite of what happened is worse than
          // one that says nothing.
          //
          // The endpoint gate alone still let one through. better-call resolves a nested endpoint's
          // path as `context.path || path` (better-call/dist/context.mjs), so the `getSession` the
          // revoke endpoints' own session middleware performs INHERITS the outer path — and when
          // that call finds the caller's session expired it deletes it, here, wearing the name
          // `/revoke-session`. The request then 401s, having revoked nothing, and an
          // endpoint-only gate filed `session.revoked` for it (test/auth-audit.test.ts pins this).
          //
          // So each path also says which row it means:
          //   /sign-out              — the caller's own session, and the endpoint deletes exactly
          //                            one row it read from the cookie. No nested getSession runs
          //                            under it, so the path is the whole test.
          //   /revoke-session        — the row whose token the request NAMED. A swept session is
          //                            the caller's cookie token, which is not the asked-for one.
          //   /revoke-other-sessions — any row that is NOT the caller's own. A sweep deletes
          //                            precisely the caller's own, and during that sweep the
          //                            endpoint's session is not yet established at all, so an
          //                            unresolvable caller is skipped rather than guessed at.
          //
          // /revoke-sessions is deliberately absent: it deletes through the MANY path, which does
          // not reach this hook, so listing it would claim a row that never gets written. Nothing
          // in this application calls it. A null context (a deletion outside any endpoint) is
          // skipped too — the same posture the two_factor transition detector above takes.
          after: async (session, endpointContext) => {
            const deletedToken = session.token;
            let event: string | null = null;
            if (endpointContext?.path === "/sign-out") {
              event = "logout";
            } else if (endpointContext?.path === "/revoke-session") {
              const body: unknown = endpointContext.body;
              const askedFor =
                typeof body === "object" && body !== null && "token" in body
                  ? (body as { token?: unknown }).token
                  : undefined;
              if (askedFor === deletedToken) event = "session.revoked";
            } else if (endpointContext?.path === "/revoke-other-sessions") {
              const callerToken = endpointContext.context.session?.session.token;
              if (callerToken !== undefined && callerToken !== deletedToken) {
                event = "session.revoked";
              }
            }
            if (event === null) return;
            await writeAuthAuditGuarded(env, { event, userId: session.userId });
          },
        },
      },
      user: {
        update: {
          // The transition detector — see twoFactorPatchByHookContext above.
          before: (user, hookContext) => {
            const patchValue = user["twoFactorEnabled"];
            if (hookContext !== null && typeof patchValue === "boolean") {
              twoFactorPatchByHookContext.set(hookContext, patchValue);
            }
            return Promise.resolve();
          },
          after: async (user, hookContext) => {
            if (hookContext === null) return;
            const enabled = twoFactorPatchByHookContext.get(hookContext);
            if (enabled === undefined) return;
            twoFactorPatchByHookContext.delete(hookContext);
            await writeAuthAuditGuarded(env, {
              event: enabled ? "two_factor.enabled" : "two_factor.disabled",
              userId: user.id,
            });
          },
        },
      },
    },
    plugins: [twoFactor({ backupCodeOptions: { customBackupCodesGenerate: recoveryCodes } })],
  });
}
