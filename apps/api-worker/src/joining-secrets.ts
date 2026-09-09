// The secrets and the verifiers the joining surfaces are built on — invitation codes, registration
// confirmation tokens, and the three-fact verifier an invitation is redeemed against.
//
// Why this is one module rather than a helper beside each route: the enumeration defence is a
// property of how these values are DERIVED, and a second derivation written slightly differently is
// how a neutral failure stops being neutral. Both routes hash through the same functions, so a
// change to normalization changes both ends at once.
//
// Nothing here stores or transports a secret in the clear. A code is generated, shown once to the
// firm that will pass it on, and kept only as a hash; a confirmation token is generated, mailed, and
// kept only as a hash. A control plane read whole yields nothing anyone can redeem.

// The alphabet a human types off a printed page or a copied email. `I l 1 O 0` are excluded because
// they are the glyph pairs that get mistyped, and a code someone cannot type is a support call.
// Uppercase only, so a code is unambiguous when read aloud and case-folding on the way in is safe.
const UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Twelve characters over a 31-letter alphabet is a little under 60 bits. Chosen against the attempt
// ladder rather than against an offline attack: a code is only ever guessed online, five tries at a
// time, against a rate-limited endpoint, and it expires — so the bar is "unguessable within the
// budget by an enormous margin", which this clears with room to spare.
const INVITATION_CODE_LENGTH = 12;

// The confirmation token rides in a URL rather than being typed, so it is longer and drawn from the
// same alphabet only for consistency of the generator; length is what carries it.
const CONFIRMATION_TOKEN_LENGTH = 32;

// Draw `length` characters uniformly from the alphabet. Rejection-sampled rather than
// `byte % alphabet.length`: 256 is not a multiple of 31, so the modulo would make the first few
// letters measurably more likely, and a biased code is a smaller code.
function randomFromAlphabet(length: number, alphabet: string): string {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let drawn = "";
  while (drawn.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      drawn += alphabet[byte % alphabet.length];
      if (drawn.length === length) break;
    }
  }
  return drawn;
}

/** A fresh invitation code, in the form the firm passes on and the redeemer types. */
export function generateInvitationCode(): string {
  return randomFromAlphabet(INVITATION_CODE_LENGTH, UNAMBIGUOUS_ALPHABET);
}

/** A fresh registration confirmation token, for the emailed link. */
export function generateConfirmationToken(): string {
  return randomFromAlphabet(CONFIRMATION_TOKEN_LENGTH, UNAMBIGUOUS_ALPHABET);
}

/**
 * A typed code reduced to the one form the verifier is computed over: case folded and stripped of
 * everything that is not a letter or a digit, so the spaces and hyphens a surface may render the
 * code in — and the ones a person adds by habit — never decide whether it matches.
 *
 * No glyph is remapped, and that is the point of the alphabet rather than an omission: because a
 * generated code can never contain `I`, `l`, `1`, `O` or `0`, there is no pair of characters a
 * reader can confuse for one another, so there is nothing to guess at on the way back in. Mapping
 * one character onto another here would instead shrink the code's space for every code at once.
 */
export function normalizeInvitationCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A surname reduced to a comparable form: case folded, Unicode-composed, and stripped of the
 * spacing, hyphens and apostrophes people place differently on different days. `O'Brien`,
 * `o brien` and `OBrien` are one person, and refusing two of the three would be a wrong answer that
 * looks exactly like a wrong invitation.
 *
 * Accents are DELIBERATELY preserved (NFC, not a diacritic strip): folding them would merge names
 * that are genuinely different, and someone who has an accent in their name types it.
 */
export function normalizeLastName(lastName: string): string {
  return lastName
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s'’\-.]/g, "");
}

/*
 * A date of birth as the calendar date it is, with no timezone anywhere near it: the string the form
 * submits, validated to shape, is the string the verifier is computed over.
 *
 * Both halves of the check — the shape, and the day being one the calendar has — are
 * @magna-carta/civil-time's, under this module's own name.
 */
export { isCivilDate as isCalendarDate } from "@magna-carta/civil-time/civil-date";

const textEncoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The stored form of an invitation code — the only handle a redemption looks a row up by. */
export function invitationCodeHash(code: string): Promise<string> {
  return sha256Hex(`invitation-code\0${normalizeInvitationCode(code)}`);
}

/** The stored form of a registration confirmation token. */
export function confirmationTokenHash(token: string): Promise<string> {
  return sha256Hex(`registration-confirmation\0${token.trim()}`);
}

/**
 * The three-fact verifier: code, last name and date of birth folded into ONE digest.
 *
 * This is the whole enumeration defence for redemption, and it works by removing the choice. There
 * is no stored last name and no stored date of birth to compare against, so the redemption path has
 * no way to compute "the code was right but the birthday was wrong" — the only question it can ask
 * is whether one digest equals another. A future handler cannot accidentally leak the distinction,
 * because the distinction does not exist in the data.
 *
 * The NUL separators keep the fields from running together: without them `smith` + `1990-01-02` and
 * `smith1` + `990-01-02` would hash identically.
 */
export function invitationVerifierHash(input: {
  code: string;
  lastName: string;
  dateOfBirth: string;
}): Promise<string> {
  return sha256Hex(
    [
      "invitation-verifier",
      normalizeInvitationCode(input.code),
      normalizeLastName(input.lastName),
      input.dateOfBirth.trim(),
    ].join("\0"),
  );
}

// A digest of the right shape that no verifier can ever equal — the comparison a redemption makes
// when it found no invitation at all. Present so the not-found path runs the SAME comparison as the
// found path rather than returning early, which is what keeps the two indistinguishable in time.
export const UNMATCHABLE_VERIFIER_HASH = "0".repeat(64);

/**
 * Constant-time equality over two hex digests. Both sides are already fixed-length digests, so this
 * is a straight XOR fold — no length can leak, because the lengths are equal by construction and a
 * malformed stored value simply never matches.
 */
export function digestsMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
