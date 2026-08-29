/*
 * The password rule, in one place, because three surfaces now state it: registration (where a person
 * chooses their password), the reset screen (where they replace it), and any screen that has to
 * explain a refusal. The server's rule is Better Auth's configured minimum, mounted at the library
 * default in apps/api-worker/src/auth.ts and published on the registration request schema — this is
 * the client's copy of the same number, so a form can say the rule up front instead of discovering it
 * by being refused.
 *
 * A CLIENT-SIDE BOUND IS A COURTESY, NEVER THE ENFORCEMENT. The server refuses a short password
 * whatever this file says; what this buys is a submit button that stays shut and a sentence that
 * names the rule, rather than a round trip that ends in "no".
 */

/** The shortest password the server accepts. */
export const MINIMUM_PASSWORD_LENGTH = 8;

/** The longest. Stated so a paste of something enormous is refused here rather than at the server. */
export const MAXIMUM_PASSWORD_LENGTH = 128;
