import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as controlPlaneSchema from "@magna-carta/database/control-plane-schema";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { EntityType } from "@magna-carta/identifiers/registry";
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

// The ONE home for the Better Auth integration shape (slice 0·4 design spec). app.ts caches one
// instance per worker env; tests construct directly against the Miniflare control-plane D1.
// Routes mount at Better Auth's default basePath, /api/auth.
export function createAuth(env: Bindings, sendEmail: SendEmail) {
  const database = drizzle(env.DB_CONTROL, { schema: controlPlaneSchema });
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
        await sendEmail({ to: user.email, subject: "Set your Magna Carta password", text: url });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({ to: user.email, subject: "Verify your email", text: url });
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
    // databaseHooks.session.create.after is the seam where the sign-in audit write lands
    // (writeAuthAudit — Task 13); deliberately not wired yet.
    plugins: [twoFactor()],
  });
}
