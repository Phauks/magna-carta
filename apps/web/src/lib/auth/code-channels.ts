/*
 * The second-factor channels, and the SHAPE OF CODE EACH ONE ISSUES.
 *
 * A code field must match its issuer. An authenticator app and a spoken telephone code are both six
 * digits, so those entries stay numeric and raise a keypad. A texted or emailed code is generated
 * by this platform, and ours are eight characters from an alphabet that omits the glyphs people
 * confuse when reading aloud — so those entries must accept letters. Forcing digits everywhere
 * would reject a code we sent ourselves, which reads to the person holding it as "the code is
 * wrong", and sends them to support over a field validator.
 *
 * ONLY AUTHENTICATOR CODES ROTATE. A texted, spoken or emailed code lives until it is used, expires
 * by configuration, or is replaced by a newer send — so the "wrong code" sentence differs per
 * channel, and pointing someone at a rotation that does not happen is a wrong instruction.
 *
 * The authenticator numbers come from ./two-factor-policy.ts, which is the browser's copy of a
 * server-side fact. The eight-character length is this platform's own choice and lives here.
 */
import { VERIFICATION_CODE_LENGTH, VERIFICATION_CODE_PERIOD_SECONDS } from "./two-factor-policy.ts";

export type CodeChannel = "authenticator" | "text" | "call" | "email";

/** How long a code this platform generates is. Not the authenticator's — that is the plugin's. */
const PLATFORM_CODE_LENGTH = 8;

export interface CodeChannelShape {
  length: number;
  charset: "numeric" | "alphanumeric";
  /** The channel in the visitor's words, as the line under the heading. */
  origin: string;
  /** The rejection sentence, which names what to do about it for THIS channel. */
  rejection: string;
  /** Whether a fresh code can be requested. An authenticator issues its own; we cannot send one. */
  resendable: boolean;
}

const SHAPES: Record<CodeChannel, CodeChannelShape> = {
  authenticator: {
    length: VERIFICATION_CODE_LENGTH,
    charset: "numeric",
    origin: "From your authenticator app",
    rejection: `That code didn't work. Authenticator codes change every ${VERIFICATION_CODE_PERIOD_SECONDS} seconds, so enter the current one.`,
    resendable: false,
  },
  call: {
    length: VERIFICATION_CODE_LENGTH,
    charset: "numeric",
    origin: "Read to you by a call",
    rejection: "That code didn't verify. Use the most recent code we gave you.",
    resendable: true,
  },
  text: {
    length: PLATFORM_CODE_LENGTH,
    charset: "alphanumeric",
    origin: "Sent by text",
    rejection: "That code didn't verify. Use the most recent code we sent.",
    resendable: true,
  },
  email: {
    length: PLATFORM_CODE_LENGTH,
    charset: "alphanumeric",
    origin: "Sent to your email",
    rejection: "That code didn't verify. Use the most recent code we emailed.",
    resendable: true,
  },
};

export function codeChannelShape(channel: CodeChannel): CodeChannelShape {
  return SHAPES[channel];
}

/** How the shape reads in the field's own hint: "six digits", "eight characters". */
export function codeShapeDescription(channel: CodeChannel): string {
  const shape = SHAPES[channel];
  return shape.charset === "numeric" ? "six digits" : "eight characters";
}

/*
 * PHONE MASKING — one rule for the whole product, on every surface reached BEFORE authentication:
 * the country code is visible, everything between is masked, and the last four digits show.
 *
 * The tension is real and was weighed rather than split. More digits helps someone recognise which
 * of their numbers this is, and helps them notice a number an attacker enrolled. More digits also
 * helps someone holding a partial record confirm a full number, and an area code discloses rough
 * geography — which, for a law firm's client, can itself be the sensitive fact. Four digits is
 * enough for the person who owns the phone and too few for anyone else, so the mask stays tight.
 *
 * NIST SP 800-63B-4 permits a verifier to display an address but sets no masking granularity, so
 * this is a product decision and not a compliance one. Never mask what the visitor typed this
 * session — mask only stored channels they did not provide just now, where the mask protects
 * something.
 */
export function maskedPhoneNumber(countryCode: string, lastFourDigits: string): string {
  return `${countryCode} (···) ···-${lastFourDigits}`;
}
