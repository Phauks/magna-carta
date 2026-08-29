// THE ONE HOME FOR "somebody who has just been given an account can sign in with it."
//
// WHAT WENT WRONG BEFORE. Every joining path created a `user` row with no credential `account` row
// and relied on a mailed password-reset link to bring one into being. Better Auth's reset does
// create the missing credential account (verified against the installed 1.6.22 in
// api/routes/password.mjs — it inserts a credential account when findAccounts turns up none, and
// only updates the password when one exists), so the mechanism worked; what it cost was a second
// mail standing between a person and their first sign-in, and a `user` row that can hold no password
// at all until that mail is acted on. A mail that does not arrive therefore leaves an account nobody
// can ever get into, with `Credential account not found` at sign-in as the only symptom — which is
// exactly the state a deployment with no outbound mail configured produces.
//
// SO THE PASSWORD IS CHOSEN WHERE THE PERSON IS. Registration and invitation redemption both collect
// it, hash it here, and commit the credential account in the SAME batch as the user row. The
// password-reset flow goes back to being what its name says: replacing a password you already have.
//
// WHY THE HASH IS COMPUTED IN THE REQUEST THAT RECEIVES THE PASSWORD. It is the only moment the
// plaintext exists, and it must not outlive that moment — nothing here ever writes, logs, or queues
// a password, only the scrypt verifier Better Auth's own hasher produced. The cost is one scrypt per
// attempt on an anonymous endpoint, which is real: it is paid behind the chokepoint's tightest
// (auth) rate-limit bucket and behind the human-verification gate, and Better Auth already pays the
// same cost per sign-in attempt and per password-reset request, so this adds a third door at a price
// the other two already charge.
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import type { createAuth } from "./auth.ts";

// The length rule, from Better Auth's own configuration rather than a number picked here: the
// library's context defaults are 8 and 128 (context/create-context.mjs), and `createAuth` sets no
// override. Published on the request schema so a caller is refused by a rule they were told, never
// opaquely — and named once so the API, the sign-up screen's helper text, and the validator cannot
// drift into disagreeing about what a valid password is.
export const PASSWORD_MINIMUM_LENGTH = 8;
export const PASSWORD_MAXIMUM_LENGTH = 128;

/**
 * Hash a chosen password with the SAME hasher sign-in verifies against — Better Auth's configured
 * `password.hash`, reached through its context rather than reimplemented. Reimplementing scrypt with
 * the same parameters would produce a value that looks right and fails at sign-in for reasons no
 * test would explain; going through the library means the format is whatever the library currently
 * writes, including across an upgrade that changes it.
 */
export async function hashChosenPassword(
  auth: ReturnType<typeof createAuth>,
  password: string,
): Promise<string> {
  const context = await auth.$context;
  return context.password.hash(password);
}

/**
 * The credential `account` row for a user, as a statement to ride the batch that creates them. One
 * batch is the point: a `user` row that commits without its credential is precisely the state this
 * module exists to make unreachable, so the two never commit separately.
 *
 * `accountId` is the user's own id and `providerId` is the literal "credential" — the shape Better
 * Auth's sign-in looks for (`user.accounts.find((a) => a.providerId === "credential")`, api/routes/
 * sign-in.mjs) and the shape its own reset writes. Epoch-millisecond timestamps: the Better Auth
 * tables' sanctioned exception to the platform's instants-as-ISO convention.
 */
export function insertCredentialAccountStatement(
  database: D1Database,
  input: {
    readonly userId: UserId;
    /** Already hashed by hashChosenPassword — a plaintext password never reaches this function. */
    readonly passwordHash: string;
    readonly nowEpochMilliseconds: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) " +
        "VALUES (?1, ?2, 'credential', ?3, ?4, ?5, ?5)",
    )
    .bind(
      newIdentifier("account"),
      input.userId,
      input.userId,
      input.passwordHash,
      input.nowEpochMilliseconds,
    );
}
