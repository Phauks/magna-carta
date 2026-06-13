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
import type { Bindings } from "./app.ts";
import type { SendEmail } from "./email-port.ts";

// Better Auth model name -> identifiers-registry entity type, for minting prefixed handles
// (usr_/ses_/acc_/ver_/twf_, ADR-0062). Unknown models fail loud below: silently minting some
// other prefix would defeat self-describing ids. Adding a Better Auth plugin that stores rows =
// one entry here + a registry prefix + a control-plane migration.
const ENTITY_TYPE_BY_MODEL: Partial<Record<string, EntityType>> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  twoFactor: "twoFactor",
};

// Auth audit writes are observability, not gates (ADR-0038): the INSERT failing must never break
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

// The ONE home for the Better Auth integration shape (slice 0·4 design spec). app.ts caches one
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
    // transaction: false — D1 has no interactive transactions (BEGIN is rejected), so the
    // adapter runs multi-operation flows sequentially instead of wrapping them in one.
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: controlPlaneSchema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      // Membership is invitation-only (slice 0·4 design spec): the public signup route always
      // 4xxes; users are provisioned through the invitation flow instead.
      disableSignUp: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Set your Magna Carta password",
          text: url,
          messageClass: "password-reset",
        });
      },
      // Completing a reset proves control of the mailbox (the token only ever travels by email) —
      // the same possession proof email verification asks for, so the flag flips here. This is
      // also what activates invited users: the invite flow (members.invite) inserts them
      // unverified with no credential account, and the reset link is their activation link;
      // without this flip, requireEmailVerification would lock every invitee out at sign-in.
      onPasswordReset: async ({ user }) => {
        await env.DB_CONTROL.prepare(
          'UPDATE "user" SET email_verified = 1, updated_at = ?2 WHERE id = ?1',
        )
          .bind(user.id, Date.now())
          .run();
        // password.reset audit (decided #10): 1.6.16 exposes no password-reset databaseHook, so
        // this server hook — which receives the user post-reset — is the natural home.
        await writeAuthAuditGuarded(env, { event: "password.reset", userId: user.id });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Verify your email",
          text: url,
          messageClass: "email-verification",
        });
      },
    },
    // Every user belongs to exactly one tenant firm; input: false keeps the field out of every
    // request body — only server-side code (the invitation flow) ever sets it.
    user: {
      additionalFields: {
        firmId: { type: "string", required: true, input: false },
      },
    },
    advanced: {
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
          // to distinguish it inside this hook (decided #10).
          after: async (session) => {
            await writeAuthAuditGuarded(env, { event: "login.success", userId: session.userId });
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
    plugins: [twoFactor()],
  });
}
