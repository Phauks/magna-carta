// The caller-identity port: "whose number is this, according to the telephone network?"
//
// One question, answered from the carriers' caller-name (CNAM) database and the number's own
// line-type record. It is a PAID question — every answer is a billed query against a database the
// carriers charge for — so nothing here is asked automatically: a surface asks only when a person
// presses for it, and the caller keeps the answer so one number is paid for once.
//
// NEVER A THROW. Every operation answers a typed outcome, so a caller pattern-matches rather than
// guessing which failures are exceptional.

/** A number in the two parts every store in this product keys it by: digits only, no plus. */
export interface CallerNumber {
  readonly countryCallingCode: string;
  readonly nationalNumber: string;
}

/**
 * What kind of line answers a number, in this product's words rather than any provider's.
 *
 * `fixedOrMobile` is a real answer and not a failure: some numbering plans cannot tell the two apart
 * from the number alone, and a provider that says so is being exact.
 */
export const CALLER_LINE_TYPES = Object.freeze([
  "mobile",
  "fixed",
  "fixedOrMobile",
  "voip",
  "tollFree",
  "other",
] as const);
export type CallerLineType = (typeof CALLER_LINE_TYPES)[number];

export function isCallerLineType(value: string): value is CallerLineType {
  return (CALLER_LINE_TYPES as readonly string[]).includes(value);
}

/**
 * Whether caller-name data exists for a number at all. Caller-name (CNAM) databases are a North
 * American institution — there is none for most of the world — so a query for any other number is a
 * billed query that can only come back empty, and no engine is asked one.
 */
export function callerNameCovered(number: CallerNumber): boolean {
  return number.countryCallingCode === "1";
}

/** What the network says about a number. Every field may be absent, and absent is not a failure. */
export interface CallerIdentity {
  /**
   * The name the caller-name database holds, exactly as it holds it — usually upper case, at most
   * fifteen characters, and for a mobile number often a city or `WIRELESS CALLER` rather than a
   * person. Null when the database holds nothing for the number.
   */
  readonly callerName: string | null;
  readonly lineType: CallerLineType | null;
  /** The company that serves the number now, which after a port is not the one that issued it. */
  readonly carrierName: string | null;
}

export type CallerLookupOutcome =
  | { readonly kind: "found"; readonly identity: CallerIdentity }
  // The provider holds no data for numbers in this country. Not the same as an empty answer, and a
  // surface must not show it as one: an empty answer invites nothing; this invites nothing either,
  // but it says why.
  | { readonly kind: "not-covered" }
  // No provider is provisioned. The surface shows no lookup control at all.
  | { readonly kind: "engine-not-implemented" }
  // The provider refused or did not answer. Transient; the person may press again.
  | { readonly kind: "failed"; readonly reason: "transport" | "refused" | "malformed" };

export interface CallerLookupPort {
  /** Which engine answers, for a metric dimension and for the surface to name its source. */
  readonly engine: "telnyx" | "deferred";
  lookUp(number: CallerNumber): Promise<CallerLookupOutcome>;
}

/**
 * The port while no provider is provisioned. Every answer is `engine-not-implemented`, which the
 * surface reads as "there is no paid lookup here", so the call record behaves exactly as it did
 * before the lookup existed. The day a key is set, the only thing that changes is which port the
 * Worker hands in.
 */
export function deferredCallerLookupPort(): CallerLookupPort {
  return {
    engine: "deferred",
    lookUp: () => Promise.resolve({ kind: "engine-not-implemented" }),
  };
}
