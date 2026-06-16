// Deterministic normalization of a plaintext before it is fed to a blind index, so equal values
// match regardless of case, whitespace, or unicode form. Pairs with blind-index.ts.
//
// These transforms are a frozen contract: committed golden vectors pin the exact output. Changing
// any transform changes which values collide, so it is a new blind-index version (a new digest),
// never an edit to one already in use — existing indexes must keep matching.

export type NormalizeErrorCode = "normalize-empty" | "normalize-no-digits";

export class NormalizeError extends Error {
  readonly code: NormalizeErrorCode;

  constructor(code: NormalizeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "NormalizeError";
    this.code = code;
  }
}

// Unicode canonical composition. Applied first inside every other transform so a composed grapheme
// (é, U+00E9) and its decomposed sequence (e + combining acute, U+0065 U+0301) normalize alike.
export function toNfc(value: string): string {
  return value.normalize("NFC");
}

// NFC, then keep only ASCII digits: "123-45-6789" and "123456789" both yield "123456789". Throws
// when no digits remain.
export function normalizeToDigits(value: string): string {
  const digits = toNfc(value).replace(/[^0-9]/g, "");

  if (digits.length === 0) {
    throw new NormalizeError("normalize-no-digits");
  }

  return digits;
}

// NFC, uppercase, then strip spaces, dashes, and dots. Throws when nothing remains.
export function normalizeUppercaseStrip(value: string): string {
  const stripped = toNfc(value)
    .toUpperCase()
    .replace(/[\s.-]/g, "");

  if (stripped.length === 0) {
    throw new NormalizeError("normalize-empty");
  }

  return stripped;
}

// The driver's-license transform: each side normalized through normalizeUppercaseStrip and joined
// with a colon, so a license number is only equal within the same issuing state.
export function withStatePrefix(state: string, value: string): string {
  return `${normalizeUppercaseStrip(state)}:${normalizeUppercaseStrip(value)}`;
}
